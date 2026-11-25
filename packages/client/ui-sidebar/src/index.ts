/** Host registration for sidebar preferences. */
import type {} from '@deepseek-ai/dsh-settings'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** User preferences for sidebar launchers. */
export interface Config {
  /** Panel ids whose launchers are unpinned. */
  unpinnedPanels: Volatile<string[]>
}

/** Sidebar preference schema. */
export const Config = z.object({
  unpinnedPanels: z.array(z.string()).default([]).volatile(),
})

/** Register sidebar preferences with the user settings document.
 * @param ctx - Host plugin context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
