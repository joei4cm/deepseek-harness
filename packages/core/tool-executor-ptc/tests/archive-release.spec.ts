/**
 * Archive-triggered release of a Session's retained program environment.
 *
 * The composition mounts the real Workspace registry beside the real PTC tool
 * executor, so the archive flow and the event it dispatches are the shipped
 * ones. Only the storage domain peers are controlled.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcRunRequest, PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import SessionStore, { type SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { RUN_CODE_NAME, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { PtcExecutor } from '../src/index.ts'

const testSignal = new AbortController().signal

/** A runtime that keeps one environment per owner and records every release. */
class RetainingRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fake'
  override get retainsState(): boolean { return true }
  /** Owners whose environment was released, in release order. */
  readonly released: object[] = []
  /** Whether a program waits for its signal instead of settling at once. */
  hang = false
  /** Whether a release rejects instead of ending the environment. */
  fail = false
  /** Resolves when a hanging program starts. */
  readonly started = Promise.withResolvers<undefined>()
  /** Abort reasons observed by hanging programs. */
  readonly aborted: string[] = []

  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? 120_000 }
  }

  run(request: PtcRunRequest): Promise<PtcRunResult> {
    if (!this.hang) return Promise.resolve({ output: [{ type: 'text', text: 'retained' }] })
    return new Promise((_resolve, reject) => {
      this.started.resolve(undefined)
      request.signal?.addEventListener('abort', () => {
        this.aborted.push(String(request.signal?.reason))
        reject(request.signal?.reason instanceof Error ? request.signal.reason : new Error('the program was aborted'))
      }, { once: true })
    })
  }

  override async release(owner: object): Promise<void> {
    if (this.fail) throw new Error('the runtime process could not be ended')
    this.released.push(owner)
  }
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Boot the real registry, executor, and runtime over controlled persistence. */
async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-ptc-archive-'))
  cleanups.push(() => rm(temporary, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('sessionPersistence', {
    list: async () => [],
    open: () => { throw new Error('the fixture archives a live Session') },
    stat: () => { throw new Error('the fixture archives a live Session') },
  } as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(LocalFileSystem, { cwd: temporary })
  await ctx.plugin(WorkingDirectoryService, { defaultDirectory: temporary })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(RetainingRuntime)
  const runtime = ctx.ptcRuntime as RetainingRuntime
  ctx.tools.setExecutor(new PtcExecutor(ctx))
  const session = ctx.sessions.create(brandString<SessionId>('ptc-archive'), { meta: { cwd: temporary } })
  const agent = { ctx, session } as Agent
  return { ctx, session, agent, runtime, temporary }
}

/** Run one program so the Agent retains an environment. */
async function runProgram(ctx: Context, agent: Agent): Promise<ToolExecutionResult> {
  const batch = await ctx.tools.execute({
    calls: [{
      type: 'tool-call',
      id: brandString<ToolCallId>('ptc-archive-call'),
      name: RUN_CODE_NAME,
      arguments: JSON.stringify({ code: 'const retained = 1', description: 'Retain an environment' }),
    }],
    signal: testSignal,
    agent,
  })
  return batch.results[0]!.result
}

describe('archive-triggered release of a retained program environment', () => {
  it('ends the environment of an archived Session', async () => {
    const f = await fixture()
    expect((await runProgram(f.ctx, f.agent)).isError).toBe(false)
    expect(f.runtime.released).toEqual([])

    await f.ctx.workspaceRegistry.archiveSession(f.session.id)

    await vi.waitFor(() => { expect(f.runtime.released).toHaveLength(1) })
    expect(f.runtime.released[0]).toBe(f.agent)
  })

  it('cancels a running program before it ends the environment', async () => {
    const f = await fixture()
    f.runtime.hang = true
    const running = runProgram(f.ctx, f.agent)
    await f.runtime.started.promise

    await f.ctx.workspaceRegistry.archiveSession(f.session.id)

    await vi.waitFor(() => { expect(f.runtime.released).toHaveLength(1) })
    expect(f.runtime.aborted).toHaveLength(1)
    await running
  })

  it('keeps the environment of a Session that is not archived', async () => {
    const f = await fixture()
    expect((await runProgram(f.ctx, f.agent)).isError).toBe(false)

    const other = f.ctx.sessions.create(brandString<SessionId>('ptc-other'), { meta: { cwd: f.temporary } })
    await f.ctx.workspaceRegistry.archiveSession(other.id)

    expect(f.runtime.released).toEqual([])
  })

  it('reports a release that fails without undoing the archive', async () => {
    const f = await fixture()
    expect((await runProgram(f.ctx, f.agent)).isError).toBe(false)
    f.runtime.fail = true
    const warn = vi.spyOn(f.ctx.logger, 'warn')

    await f.ctx.workspaceRegistry.archiveSession(f.session.id)

    await vi.waitFor(() => { expect(warn).toHaveBeenCalled() })
    expect(String(warn.mock.calls[0]?.[0])).toContain('releasing the retained program environment')
    expect(f.ctx.workspaceRegistry.archivedSessionIds).toContain(f.session.id)
  })
})
