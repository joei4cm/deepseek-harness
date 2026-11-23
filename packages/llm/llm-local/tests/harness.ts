import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { Config } from '../src/config.ts'
import * as Local from '../src/index.ts'
import { afterEach } from 'vitest'

const contexts = new Set<Context>()
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
})

/** Mount the real LLM service and local provider plugin in one test context. */
export async function setup(config: Config): Promise<Context> {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(Local, config)
  return ctx
}
