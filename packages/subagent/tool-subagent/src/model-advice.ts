/** Consumer side of the `subagent/model-advice` routing extension point. */

import type { Context } from '@deepseek-ai/cordis'
import type { SubagentModelAdvice, SubagentModelAdviceRequest } from '@deepseek-ai/dsh-subagent'

/**
 * Ask mounted routing plugins for one delegation's child LLM route. Advisors
 * run outermost-first and the first suggestion wins; a chain with no listener,
 * or whose listeners all defer, leaves the route to the tool configuration.
 * @param ctx - context dispatching the advice chain.
 * @param request - the delegation awaiting a child route.
 * @returns the suggested route, or undefined when every advisor defers.
 */
export function adviseChildRoute(
  ctx: Context,
  request: SubagentModelAdviceRequest,
): Promise<SubagentModelAdvice | undefined> {
  return ctx.waterfall('subagent/model-advice', request, () => Promise.resolve(undefined))
}
