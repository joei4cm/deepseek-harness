// @vitest-environment jsdom
/** Conversation View pin choices follow the shared Host settings. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConversationSettings } from '../src/submission-settings.ts'
import { createViewPins } from '../src/client/view-pins.ts'

/** One Host write held until the test settles it. */
interface PendingWrite {
  readonly field: string
  readonly value: unknown
  readonly accept: () => void
  readonly refuse: () => void
  readonly fail: (error: Error) => void
}

/** Scope whose writes stay pending, so the test controls their settlement. */
function deferredWrites(host: StubConfigForm<ConversationSettings>) {
  const writes: PendingWrite[] = []
  const scope: ConfigForm<ConversationSettings> = {
    ...host.scope,
    set: (field, value) => new Promise<boolean>((resolve, reject) => {
      writes.push({
        field,
        value,
        accept: () => { resolve(true) },
        refuse: () => { resolve(false) },
        fail: (error: Error) => { reject(error) },
      })
    }),
  }
  return { scope, writes }
}

/** Let queued write settlements and their reactions run. */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** Drain the macrotask queue so Node can report an unhandled rejection. */
async function drain(): Promise<void> {
  await flush()
  await new Promise((resolve) => { setTimeout(resolve, 0) })
}

function ready(host: StubConfigForm<ConversationSettings>, unpinnedViews: readonly string[]): void {
  host.publish({ value: { busyEnter: 'queue', unpinnedViews: [...unpinnedViews] } })
}

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
afterEach(() => { unhandled.length = 0 })

describe('Conversation View pins', () => {
  it('restores saved choices and adopts later Host changes without writing them back', () => {
    const host = stubConfigForm<ConversationSettings>()
    ready(host, ['removed-view', 'chat'])
    const pins = createViewPins(host.scope)
    expect(pins.unpinned.getSnapshot()).toEqual(['removed-view'])
    const initial = pins.unpinned.getSnapshot()
    ready(host, ['removed-view', 'chat'])
    expect(pins.unpinned.getSnapshot()).toBe(initial)
    ready(host, ['timeline'])
    expect(pins.unpinned.getSnapshot()).toEqual(['timeline'])
    expect(host.set).not.toHaveBeenCalled()
    pins.dispose()
    ready(host, [])
    expect(pins.unpinned.getSnapshot()).toEqual(['timeline'])
    expect(host.listenerCount()).toBe(0)
  })

  it('merges choices made while settings load with the saved list', () => {
    const host = stubConfigForm<ConversationSettings>()
    const pins = createViewPins(host.scope)
    pins.setPinned('timeline', false)
    expect(host.set).not.toHaveBeenCalled()
    ready(host, ['removed-view'])
    expect(pins.unpinned.getSnapshot()).toEqual(['removed-view', 'timeline'])
    expect(host.set).toHaveBeenCalledWith('unpinnedViews', ['removed-view', 'timeline'])
    pins.dispose()
  })

  it('keeps a buffered choice the saved list already carries without writing it', () => {
    const host = stubConfigForm<ConversationSettings>()
    const pins = createViewPins(host.scope)
    pins.setPinned('timeline', false)
    ready(host, ['timeline'])
    expect(pins.unpinned.getSnapshot()).toEqual(['timeline'])
    expect(host.set).not.toHaveBeenCalled()
    pins.dispose()
  })

  it('publishes and writes pin changes while ignoring Chat and repeated choices', () => {
    const host = stubConfigForm<ConversationSettings>()
    ready(host, [])
    const pins = createViewPins(host.scope)
    const listener = vi.fn()
    pins.unpinned.subscribe(listener)
    pins.setPinned('trajectory', false)
    pins.setPinned('timeline', false)
    pins.setPinned('trajectory', true)
    expect(pins.unpinned.getSnapshot()).toEqual(['timeline'])
    expect(host.set.mock.calls).toEqual([
      ['unpinnedViews', ['trajectory']],
      ['unpinnedViews', ['trajectory', 'timeline']],
      ['unpinnedViews', ['timeline']],
    ])
    const snapshot = pins.unpinned.getSnapshot()
    pins.setPinned('chat', false)
    pins.setPinned('timeline', false)
    pins.setPinned('trajectory', true)
    expect(pins.unpinned.getSnapshot()).toBe(snapshot)
    expect(listener).toHaveBeenCalledTimes(3)
    pins.dispose()
  })

  it('keeps the optimistic choice when a Host value predating the in-flight write arrives', async () => {
    const host = stubConfigForm<ConversationSettings>()
    ready(host, [])
    const { scope, writes } = deferredWrites(host)
    const pins = createViewPins(scope)
    pins.setPinned('timeline', false)
    pins.setPinned('trajectory', false)
    expect(writes.map(write => write.value)).toEqual([['timeline'], ['timeline', 'trajectory']])

    // The first write's acceptance lands while the second is still in flight.
    ready(host, ['timeline'])
    expect(pins.unpinned.getSnapshot()).toEqual(['timeline', 'trajectory'])
    expect(writes).toHaveLength(2)

    // The second write's own acceptance keeps the published list.
    ready(host, ['timeline', 'trajectory'])
    expect(pins.unpinned.getSnapshot()).toEqual(['timeline', 'trajectory'])

    writes[0]!.accept()
    await flush()
    expect(pins.unpinned.getSnapshot()).toEqual(['timeline', 'trajectory'])
    writes[1]!.accept()
    await flush()
    expect(pins.unpinned.getSnapshot()).toEqual(['timeline', 'trajectory'])
    pins.dispose()
  })

  it('restores the last accepted list when a write is refused', async () => {
    const host = stubConfigForm<ConversationSettings>()
    ready(host, ['removed-view'])
    const { scope, writes } = deferredWrites(host)
    const pins = createViewPins(scope)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      pins.setPinned('timeline', false)
      expect(pins.unpinned.getSnapshot()).toEqual(['removed-view', 'timeline'])
      writes[0]!.refuse()
      await flush()
      expect(pins.unpinned.getSnapshot()).toEqual(['removed-view'])
      expect(error).toHaveBeenCalledOnce()
      expect(error.mock.calls[0]![0]).toContain('was refused')
      expect(writes).toHaveLength(1)
    } finally {
      error.mockRestore()
    }
    pins.dispose()
  })

  it('keeps the optimistic choice when an older write is refused and a newer one is in flight', async () => {
    const host = stubConfigForm<ConversationSettings>()
    ready(host, [])
    const { scope, writes } = deferredWrites(host)
    const pins = createViewPins(scope)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      pins.setPinned('timeline', false)
      pins.setPinned('trajectory', false)
      writes[0]!.refuse()
      await flush()
      expect(pins.unpinned.getSnapshot()).toEqual(['timeline', 'trajectory'])
      expect(error).not.toHaveBeenCalled()

      writes[1]!.accept()
      await flush()
      expect(pins.unpinned.getSnapshot()).toEqual(['timeline', 'trajectory'])
      expect(error).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
    pins.dispose()
  })

  it('restores the last accepted list and reports a failed write without an unhandled rejection', async () => {
    process.on('unhandledRejection', onUnhandled)
    const host = stubConfigForm<ConversationSettings>()
    ready(host, ['removed-view'])
    const { scope, writes } = deferredWrites(host)
    const pins = createViewPins(scope)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      pins.setPinned('timeline', false)
      expect(pins.unpinned.getSnapshot()).toEqual(['removed-view', 'timeline'])
      const failure = new Error('transport closed')
      writes[0]!.fail(failure)
      await drain()
      expect(pins.unpinned.getSnapshot()).toEqual(['removed-view'])
      expect(unhandled).toEqual([])
      expect(error).toHaveBeenCalledOnce()
      expect(error.mock.calls[0]![0]).toContain('failed')
      expect(error.mock.calls[0]![1]).toBe(failure)
    } finally {
      error.mockRestore()
      process.off('unhandledRejection', onUnhandled)
    }
    pins.dispose()
  })

  it('abandons the settlement of a write that is still in flight at disposal', async () => {
    const host = stubConfigForm<ConversationSettings>()
    ready(host, ['removed-view'])
    const { scope, writes } = deferredWrites(host)
    const pins = createViewPins(scope)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      pins.setPinned('timeline', false)
      pins.dispose()
      expect(host.listenerCount()).toBe(0)
      writes[0]!.refuse()
      await flush()
      expect(pins.unpinned.getSnapshot()).toEqual(['removed-view', 'timeline'])
      expect(error).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
})
