/** Keyless-by-default OpenAI-compatible adapter for local inference endpoints. */

import type {} from '@deepseek-ai/cordis-plugin-loader'
import { Context } from '@deepseek-ai/cordis'
import { Config, resolveLocalProfiles } from './config.ts'
import { LocalInferenceAdapter } from './adapter.ts'

export { Config } from './config.ts'
export type { LocalModelProfile, LocalProviderProfile } from './config.ts'

export const name = 'llm-local'
export const inject = ['llm']

/**
 * Register each configured local inference route and endpoint model discovery.
 * @param ctx - plugin context providing the shared LLM runtime.
 * @param config - validated local provider profiles.
 */
export function apply(ctx: Context, config: Config): void {
  const profiles = resolveLocalProfiles(config)
  const adapter = new LocalInferenceAdapter(profiles, ctx)
  ctx.llm.registerAdapter([...profiles.keys()], adapter)
  const settingsNs = ctx.fiber.entry?.options.id ?? name
  ctx.llm.registerModelDiscovery(settingsNs, (request, signal) => adapter.discoverModels(request, signal))
}
