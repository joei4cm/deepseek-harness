/** Root-fiber shutdown drains buffered session events durably (both mount orders). */

import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { describe, expect, it, afterEach, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { type SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from './mock-adapter.ts'
import { brandString } from '@deepseek-ai/dsh-brand'

const dirs: string[] = []
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }) })

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

async function mount(order: 'backend-first' | 'loop-first', adapter = new MockAdapter([textResponse('done')])): Promise<{
  ctx: Context
  root: string
  adapter: MockAdapter
  disposePersistence: () => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-shutdown-drain-'))
  dirs.push(root)
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  let persistenceFiber: { dispose: () => Promise<void> } | undefined
  if (order === 'backend-first') {
    persistenceFiber = await ctx.plugin(JsonlSessionPersistence, { root })
    await ctx.plugin(AgentLoop, { agents: [] })
  } else {
    await ctx.plugin(AgentLoop, { agents: [] })
    persistenceFiber = await ctx.plugin(JsonlSessionPersistence, { root })
  }
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, root, adapter, disposePersistence: () => persistenceFiber.dispose() }
}

describe.each(['backend-first', 'loop-first'] as const)('root shutdown drain (%s)', (order) => {
  it('persists buffered turn events without an explicit flush before dispose', async () => {
    const { ctx, root } = await mount(order)
    const sessionId = brandString<SessionId>('shutdown-drain')
    const handle = await ctx.agents.create({ sessionId, agentOptions: { provider: 'mock', model: 'mock' } })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, handle.agent)
    // No explicit flush and no agent dispose: root teardown must drain.
    await ctx.fiber.dispose()

    const verify = new Context()
    await verify.plugin(JsonlSessionPersistence, { root })
    const reader = await verify.sessionPersistence.open(sessionId, 'read')
    const { events } = await reader.read()
    await reader.close()
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await verify.fiber.dispose()
  })

  it('persists the live closing events of an agent stopped by backend withdrawal', async () => {
    const { ctx, root, adapter, disposePersistence } = await mount(order, new MockAdapter(['hang']))
    const sessionId = brandString<SessionId>('withdrawal-drain')
    const handle = await ctx.agents.create({ sessionId, agentOptions: { provider: 'mock', model: 'mock' } })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } }))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    // Withdraw the backend while the turn hangs: the agent must stop and
    // publish its closing events before the router detaches.
    await disposePersistence()

    const live = handle.agent.session.snapshotEvents()
    expect(live.at(-1)?.type).toBe('turn/end')
    const verify = new Context()
    await verify.plugin(JsonlSessionPersistence, { root })
    const reader = await verify.sessionPersistence.open(sessionId, 'read')
    const { events } = await reader.read()
    await reader.close()
    expect(events).toEqual(live)
    await verify.fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('completes backend withdrawal and reports an agent teardown failure', async () => {
    const { ctx, disposePersistence } = await mount(order)
    const errors: string[] = []
    ctx.logger.error = ((error: unknown) => { errors.push(String(error)) }) as typeof ctx.logger.error
    const sessionId = brandString<SessionId>('withdrawal-failure')
    const handle = await ctx.agents.create({ sessionId, agentOptions: { provider: 'mock', model: 'mock' } })
    const machine = handle.agent as Agent & { scope: { dispose: () => Promise<void> } }
    vi.spyOn(machine.scope, 'dispose').mockRejectedValue(new Error('scope exploded'))

    await disposePersistence()
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(errors.some(error => error.includes('scope exploded'))).toBe(true)
    await ctx.fiber.dispose()
  })
})
