/**
 * REAL composition: an ordinary fork of a workspace-owned Session inherits the
 * workspace membership through the shipped remote, so the sidebar groups the
 * child under the source's workspace (Discussion #14262).
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { type SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { createSessionTestRemote, installSessionReadTestServices } from './test-remote.ts'

const sid = (id: string): SessionId => brandString<SessionId>(id)

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** Boot the shipped registry and Session services over in-memory storage. */
async function composed() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(AgentRegistry)
  await installSessionReadTestServices(ctx)
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve([]),
    open: () => Promise.reject(new Error('cold reads are out of scope for this composition')),
    stat: () => Promise.reject(new Error('cold stats are out of scope for this composition')),
  } as never)
  const fiber = await ctx.plugin(WorkspaceRegistry)
  ctx.agents.setFactory({
    createAgent: async (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
        ...options.inheritedEventCount === undefined
          ? {}
          : { inheritedEventCount: options.inheritedEventCount },
      })
      const agent = {} as Agent
      Object.assign(agent, { id: session.id, session, status: 'idle', ctx: ownerCtx })
      await options.setup?.(ownerCtx, agent)
      await ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('fork test sources are live')),
  })
  return { ctx, fiber }
}

describe('fork workspace inheritance (real registry)', () => {
  it('attaches the fork child to the workspace that owns the source', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-fork-workspace-')))
    dirs.push(root)
    const { ctx, fiber } = await composed()
    try {
      const workspace = await ctx.workspaceRegistry.create(root)
      const source = ctx.sessions.create(sid('workspace-source'), { meta: { cwd: root } })
      source.append('turn/start', { turn: 1 })
      source.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'work' }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      await workspace.attachSession(source.id)
      expect(workspace.sessionIds).toEqual([source.id])

      const result = await (await createSessionTestRemote(ctx, {
        defaultModelSelection: () => ({ provider: 'default-provider', model: 'default-model' }),
        cwd: root,
      })).fork({ sessionId: source.id })

      if (!result.ok) throw new Error(`fork failed: ${result.error.code}: ${result.error.message}`)
      expect(workspace.sessionIds).toContain(result.value.sessionId)
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })
})
