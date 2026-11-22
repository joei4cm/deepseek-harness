import { describe, expect, it, vi } from 'vitest'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm/types'
import type { SubagentModelAdvice, SubagentModelAdviceRequest, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubagentModelSelectionConfig from '../src/model-selection-settings.ts'
import { callSubagent, setup, setupAgent, text } from './harness.ts'

const REASONING = {
  efforts: [
    { id: brandString<ReasoningEffortId>('low'), name: 'Low' },
    { id: brandString<ReasoningEffortId>('high'), name: 'High' },
  ],
  defaultEffort: brandString<ReasoningEffortId>('high'),
} as const

const PARENT_ROUTE = { provider: 'alpha', model: 'parent-model' }
const ADVISED_ROUTE = { provider: 'alpha', model: 'child-model' }

/** Parent whose inherited reasoning effort the advised route must drop. */
const PARENT_OPTIONS = { ...PARENT_ROUTE, reasoningEffort: brandString<ReasoningEffortId>('high') }

describe('dsh-tool-subagent model advice', () => {
  it('routes a delegation that names no route through the mounted advisors', async () => {
    const requests: SubagentStartRequest[] = []
    const adviceRequests: SubagentModelAdviceRequest[] = []
    const ctx = await setup({ provider: 'mock', modelAdvice: true, parentAgentOptions: PARENT_OPTIONS }, {
      onStart: (request) => { requests.push(request) },
    })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    const resolveCall = vi.spyOn(ctx.llm, 'resolveCallConfig')
    await ctx.plugin(SubagentModelSelectionConfig, { enabled: true, allowedModels: [ADVISED_ROUTE] })
    ctx.on('subagent/model-advice', async (request) => {
      adviceRequests.push(request)
      return ADVISED_ROUTE
    })

    const result = await callSubagent(ctx, { description: 'refactor tests', prompt: 'run the failing suite' })
    expect(result.isError, text(result)).toBe(false)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.agentOptions).toEqual(ADVISED_ROUTE)
    expect(adviceRequests).toHaveLength(1)
    expect(adviceRequests[0]).toMatchObject({
      toolName: 'subagent',
      provider: 'mock',
      label: 'refactor tests',
      prompt: 'run the failing suite',
    })
    expect(adviceRequests[0]?.agentPreset).toBeUndefined()
    expect(adviceRequests[0]?.parent.id).toBe(setupAgent(ctx).id)
    // The advised model owns its effort: the parent's inherited effort is gone.
    expect(resolveCall).toHaveBeenCalledWith({ provider: 'alpha', model: 'child-model' }, expect.anything())
  })

  it('keeps the configured tool route when no advisor answers', async () => {
    const requests: SubagentStartRequest[] = []
    const ctx = await setup({
      provider: 'mock', modelAdvice: true, parentAgentOptions: PARENT_OPTIONS,
      agentOptions: { provider: 'alpha', model: 'configured-model' },
    }, { onStart: (request) => { requests.push(request) } })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    const advise = vi.fn(() => Promise.resolve<SubagentModelAdvice | undefined>(undefined))
    ctx.on('subagent/model-advice', advise)

    const result = await callSubagent(ctx, { description: 'stay put', prompt: 'work' })
    expect(result.isError, text(result)).toBe(false)
    expect(requests[0]?.agentOptions).toEqual({ provider: 'alpha', model: 'configured-model' })
    // A route the tool configuration pins is a decision, not a default.
    expect(advise).not.toHaveBeenCalled()
  })

  it('does not consult advisors when the call names its own route', async () => {
    const requests: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', modelSelection: true, modelAdvice: true, parentAgentOptions: PARENT_OPTIONS }, {
      onStart: (request) => { requests.push(request) },
    })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    const advise = vi.fn(() => Promise.resolve<SubagentModelAdvice | undefined>(ADVISED_ROUTE))
    ctx.on('subagent/model-advice', advise)

    const result = await callSubagent(ctx, {
      description: 'explicit', prompt: 'work', provider: 'alpha', model: 'parent-model',
    })
    expect(result.isError, text(result)).toBe(false)
    expect(requests[0]?.agentOptions).toEqual(PARENT_ROUTE)
    expect(advise).not.toHaveBeenCalled()
  })

  it('lets the outermost advisor decide and stops the chain there', async () => {
    const ctx = await setup({ provider: 'mock', modelAdvice: true, parentAgentOptions: PARENT_OPTIONS })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    await ctx.plugin(SubagentModelSelectionConfig, { enabled: true, allowedModels: [ADVISED_ROUTE, { provider: 'alpha', model: 'other-model' }] })
    const inner = vi.fn(() => Promise.resolve<SubagentModelAdvice | undefined>({ provider: 'alpha', model: 'other-model' }))
    ctx.on('subagent/model-advice', () => Promise.resolve<SubagentModelAdvice | undefined>(ADVISED_ROUTE))
    ctx.on('subagent/model-advice', inner)

    const result = await callSubagent(ctx, { description: 'first wins', prompt: 'work' })
    expect(result.isError, text(result)).toBe(false)
    expect(inner).not.toHaveBeenCalled()
  })

  it('defers to the next advisor when an earlier one answers with none', async () => {
    const requests: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', modelAdvice: true, parentAgentOptions: PARENT_OPTIONS }, {
      onStart: (request) => { requests.push(request) },
    })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    await ctx.plugin(SubagentModelSelectionConfig, { enabled: true, allowedModels: [ADVISED_ROUTE] })
    ctx.on('subagent/model-advice', async (_request, next) => next())
    ctx.on('subagent/model-advice', () => Promise.resolve<SubagentModelAdvice | undefined>(ADVISED_ROUTE))

    const result = await callSubagent(ctx, { description: 'later advisor', prompt: 'work' })
    expect(result.isError, text(result)).toBe(false)
    expect(requests[0]?.agentOptions).toEqual(ADVISED_ROUTE)
  })

  it('refuses an advised route the Host setting does not authorize', async () => {
    const starts = vi.fn()
    const ctx = await setup({ provider: 'mock', modelAdvice: true, parentAgentOptions: PARENT_OPTIONS }, { onStart: starts })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    await ctx.plugin(SubagentModelSelectionConfig, { enabled: true, allowedModels: [{ provider: 'alpha', model: 'other-model' }] })
    ctx.on('subagent/model-advice', () => Promise.resolve<SubagentModelAdvice | undefined>(ADVISED_ROUTE))

    const refused = await callSubagent(ctx, { description: 'not allowed', prompt: 'work' })
    expect(refused.isError).toBe(true)
    expect(text(refused)).toContain('the delegation model advisor suggested child LLM route "alpha/child-model"')
    expect(refused.error?.info).toEqual({ name: 'SubagentError', code: 'MODEL_ROUTE_NOT_ALLOWED' })
    expect(starts).not.toHaveBeenCalled()
  })

  it('limits advice to the parent route while the Host setting is disabled', async () => {
    const requests: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', modelAdvice: true, parentAgentOptions: PARENT_OPTIONS }, {
      onStart: (request) => { requests.push(request) },
    })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    const stopFirst = ctx.on('subagent/model-advice', () => Promise.resolve<SubagentModelAdvice | undefined>(ADVISED_ROUTE))

    const refused = await callSubagent(ctx, { description: 'unset setting', prompt: 'work' })
    expect(refused.isError).toBe(true)
    expect(text(refused)).toContain('an advised route is limited to the parent route')

    stopFirst()
    ctx.on('subagent/model-advice', () => Promise.resolve<SubagentModelAdvice | undefined>(PARENT_ROUTE))
    const accepted = await callSubagent(ctx, { description: 'parent route', prompt: 'work' })
    expect(accepted.isError, text(accepted)).toBe(false)
    expect(requests[0]?.agentOptions).toEqual(PARENT_ROUTE)
  })

  it('accepts advice that reproduces the default route without an entry in the setting', async () => {
    const requests: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', modelAdvice: true, parentAgentOptions: PARENT_OPTIONS }, {
      onStart: (request) => { requests.push(request) },
    })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    await ctx.plugin(SubagentModelSelectionConfig, { enabled: true, allowedModels: [ADVISED_ROUTE] })
    ctx.on('subagent/model-advice', () => Promise.resolve<SubagentModelAdvice | undefined>(PARENT_ROUTE))

    const result = await callSubagent(ctx, { description: 'default route', prompt: 'work' })
    expect(result.isError, text(result)).toBe(false)
    expect(requests[0]?.agentOptions).toEqual(PARENT_ROUTE)
  })

  it('keeps the parent reasoning effort when advice repeats the parent route', async () => {
    const ctx = await setup({ provider: 'mock', modelAdvice: true, parentAgentOptions: PARENT_OPTIONS })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    const resolveCall = vi.spyOn(ctx.llm, 'resolveCallConfig')
    ctx.on('subagent/model-advice', () => Promise.resolve<SubagentModelAdvice | undefined>(PARENT_ROUTE))

    const result = await callSubagent(ctx, { description: 'same route', prompt: 'work' })
    expect(result.isError, text(result)).toBe(false)
    expect(resolveCall).toHaveBeenCalledWith({ ...PARENT_OPTIONS }, expect.anything())
  })

  it('advises a fork tool without changing its conversation inheritance', async () => {
    const requests: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', toolName: 'subagent_fork', modelAdvice: true, parentAgentOptions: PARENT_OPTIONS }, {
      inheritsParentContext: true,
      onStart: (request) => { requests.push(request) },
    })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    await ctx.plugin(SubagentModelSelectionConfig, { enabled: true, allowedModels: [ADVISED_ROUTE] })
    let advisedPrompt: string | undefined
    ctx.on('subagent/model-advice', (request) => {
      advisedPrompt = request.prompt
      return Promise.resolve<SubagentModelAdvice | undefined>(ADVISED_ROUTE)
    })

    const result = await executeToolFixture(ctx, {
      signal: new AbortController().signal,
      callId: brandString<ToolCallId>('fork-advice'),
      name: 'subagent_fork',
      arguments: { description: 'forked review', prompt: 'review the diff' },
      agent: setupAgent(ctx),
    })
    expect(result.isError, text(result)).toBe(false)
    expect(advisedPrompt).toBe('review the diff')
    expect(requests[0]?.agentOptions).toEqual(ADVISED_ROUTE)
    const schema = ctx.tools.schemas(setupAgent(ctx)).find(entry => entry.name === 'subagent_fork')!
    // The fork still sees the conversation prefix; only its route changed.
    expect(schema.description).toContain('inherits this conversation')
  })

  it('fails the mount when the provider cannot apply Agent options', async () => {
    await expect(setup(
      { provider: 'mock', modelAdvice: true },
      { capabilities: { agentOptions: false } },
    )).rejects.toThrow('provider "mock" does not support child model advice')
  })
})
