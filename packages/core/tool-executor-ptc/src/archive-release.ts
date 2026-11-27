/**
 * Archive-triggered release of an Agent's retained program environment.
 * Installed in the Agent's own scope, so the release lives exactly as long as
 * the environment it ends.
 * @module
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type {} from '@deepseek-ai/dsh-workspace'
import { toolErrorMessage } from '@deepseek-ai/dsh-tools/pipeline'
import type { PtcCalls } from './ptc-calls.ts'

/**
 * Release the retained program environments of an Agent when its Session is archived.
 *
 * A retained environment outlives the Session's turns, so an archived Session keeps its
 * runtime process alive until the Agent itself is unloaded. The release cancels the
 * Session's running programs first and then ends every environment the Agent retained.
 * No model-visible notice is queued: the archived Session is hidden, so nothing observes
 * the lost variables.
 * @param agent - Agent whose retained environments are released.
 * @param calls - Cancellation and reset coordination for the Agent's Session.
 * @param providers - Runtime providers holding a retained environment for the Agent.
 */
export function releaseRetainedOnArchive(
  agent: Agent,
  calls: PtcCalls,
  providers: () => Iterable<PtcRuntime>,
): void {
  agent.ctx.on('workspace/session-archived', ({ sessionId }) => {
    if (sessionId !== agent.session.id) return
    void calls.reset(agent.session.id, async () => {
      for (const provider of providers()) await provider.release(agent)
    }).catch((error: unknown) => {
      agent.ctx.logger.warn(`tools: releasing the retained program environment of an archived session failed: ${toolErrorMessage(error)}. That session's programs stay blocked until a later release succeeds`)
    })
  })
}
