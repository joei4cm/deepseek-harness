/** Pin choices for the global panel launchers. */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Panel whose launcher always shows and never enters the customization list. */
export const FIXED_PANEL_ID = 'plugins'

/** Resolved sidebar settings. */
export interface SidebarSettings { unpinnedPanels: string[] }
const NO_PANELS: readonly string[] = []

/** Unpinned panel ids and their only mutation. */
export interface PanelPins {
  /** Unpinned panel ids; ids of panels that are not registered stay listed. */
  readonly unpinned: ObservableSnapshot<readonly string[]>
  /** Pin or unpin one panel launcher; the fixed panel is ignored.
   * @param id - Panel id.
   * @param pinned - Whether the launcher is manually pinned.
   */
  readonly setPinned: (id: string, pinned: boolean) => void
  /** Release the settings subscription. */
  readonly dispose: () => void
}

/** Create a pin list backed by the user settings document.
 * @param host - Shared sidebar settings form.
 * @returns Unpinned panel ids and the pin mutation.
 */
export function createPanelPins(host?: ConfigForm<SidebarSettings>): PanelPins {
  const store = createSnapshotStore<{ readonly unpinned: readonly string[] }>({ unpinned: NO_PANELS })
  let pending = 0
  let disposed = false
  const earlyChoices = new Map<string, boolean>()
  const write = (next: readonly string[]): void => {
    if (host === undefined) return
    pending++
    void host.set('unpinnedPanels', next).catch((error: unknown) => {
      console.error('Failed to save sidebar pin settings; the saved state may be unknown.', error)
    }).finally(() => { pending--; adopt() })
  }
  const adopt = (): void => {
    if (disposed || pending > 0) return
    const value = host?.getSnapshot().value?.unpinnedPanels
    if (value === undefined) return
    let next: readonly string[] = value
    for (const [id, pinned] of earlyChoices) {
      next = pinned ? next.filter(entry => entry !== id) : next.includes(id) ? next : [...next, id]
    }
    const hasEarlyChoices = earlyChoices.size > 0
    earlyChoices.clear()
    const current = store.getSnapshot().unpinned
    if (current.length !== next.length || current.some((id, index) => id !== next[index])) store.set({ unpinned: next })
    if (hasEarlyChoices) write(next)
  }
  const unsubscribe = host?.subscribe(adopt)
  adopt()
  return {
    unpinned: { getSnapshot: () => store.getSnapshot().unpinned, subscribe: listener => store.subscribe(listener) },
    setPinned: (id, pinned) => {
      const current = store.getSnapshot().unpinned
      if (id === FIXED_PANEL_ID || pinned !== current.includes(id)) return
      const next = pinned ? current.filter(entry => entry !== id) : [...current, id]
      store.set({ unpinned: next })
      if (host === undefined) return
      if (host.getSnapshot().value === undefined) earlyChoices.set(id, pinned)
      else write(next)
    },
    dispose: () => { disposed = true; unsubscribe?.() },
  }
}
