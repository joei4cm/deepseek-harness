/** Minimal settings form for sidebar component fixtures. */
export function pinSettingsFixture() {
  let value = { unpinnedPanels: [] as string[] }
  const listeners = new Set<() => void>()
  const form = {
    getSnapshot: () => ({ status: 'ready', value, base: {}, user: {}, revision: 1, writable: true }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: async (_field: string, next: string[]) => {
      value = { unpinnedPanels: next }
      listeners.forEach((listener) => { listener() })
      return true
    },
    unset: async () => false,
    mutate: async () => false,
  }
  return { get: () => form }
}
