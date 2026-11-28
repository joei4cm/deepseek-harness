/** Schedule teardown keeps its archive admission usable until its own drain has finished. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { createAfterScheduleRecord } from '../src/domain.ts'
import { scheduleDomain, type ScheduleTask } from '../src/storage.ts'
import type { ScheduleId } from '../src/types.ts'
import { boundTask, gatedScheduleBackend, harness, seedTasks } from './harness.ts'
import { MemoryMediaPool } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const SESSION = brandString<SessionId>('archived-session')
const ACTOR = brandString<SessionId>('actor')
const tests: Awaited<ReturnType<typeof harness>>[] = []

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime('2026-09-16T00:00:00Z') })
afterEach(async () => {
  await Promise.all(tests.splice(0).map(test => test.ctx.fiber.dispose()))
  vi.useRealTimers()
})

/** One armed task that delivers to {@link SESSION} an hour from now. */
function armedTask(): ScheduleTask {
  const record = createAfterScheduleRecord(brandString<ScheduleId>('teardown'), 'Check status', 3600,
    Date.now() + 3_600_000, 'Check status')
  return boundTask(SESSION, record)
}

/**
 * Mount the service with one armed task and hold a durable write open.
 *
 * The held write keeps the service's queue busy, so the drain that a plugin
 * unload starts stays pending while the case observes it.
 * @returns The mounted service, its stored task, its storage facility, and the held write.
 */
async function setup() {
  const task = armedTask()
  let facility!: DomainFacility
  const pool = new MemoryMediaPool()
  const held = Promise.withResolvers<undefined>()
  const reached = Promise.withResolvers<undefined>()
  let armed = false
  const backend = gatedScheduleBackend(pool, {
    putRecord: async () => {
      if (!armed) return
      reached.resolve(undefined)
      await held.promise
    },
  })
  const test = await harness({
    pool,
    backend,
    beforeService: async (_ctx, opened) => {
      facility = opened
      await seedTasks(opened, [task])
    },
  })
  tests.push(test)
  armed = true
  const writing = test.service.create({
    title: 'Held write', prompt: 'Held write', timing: { kind: 'after', after_seconds: 3600 },
    target: { kind: 'session', sessionId: SESSION },
  }, ACTOR)
  // The write reaches the held row store, which keeps the queue busy.
  await reached.promise
  return { test, task, facility, held, writing }
}

it('keeps the archive admission installed while the service drains', async () => {
  const { test, task, held, writing } = await setup()
  const unloading = test.fiber.dispose()
  await vi.advanceTimersByTimeAsync(0)
  try {
    // An archive that races the unload still learns which tasks this service holds.
    const activity = await test.ctx.waterfall('workspace/session-activity', { sessionId: SESSION },
      () => Promise.resolve([]))
    expect(activity).toEqual([{ kind: 'schedule', items: [{ id: task.record.id, label: 'Check status' }] }])
  } finally {
    held.resolve(undefined)
    await writing
    await unloading
  }
})

it('deletes the armed rows when an archive stop arrives during the drain', async () => {
  const { test, facility, held, writing } = await setup()
  const unloading = test.fiber.dispose()
  await vi.advanceTimersByTimeAsync(0)
  try {
    // The stop queues behind the held write and still reaches its rows before the domain closes.
    const stopping = test.ctx.parallel('workspace/session-stop', { sessionId: SESSION })
    held.resolve(undefined)
    await writing
    await stopping
    await unloading
    const domain = await facility.open(scheduleDomain)
    try {
      expect([...domain.table('tasks').keys()]).toEqual([])
    } finally {
      await domain.close()
    }
  } finally {
    held.resolve(undefined)
    await unloading
  }
})
