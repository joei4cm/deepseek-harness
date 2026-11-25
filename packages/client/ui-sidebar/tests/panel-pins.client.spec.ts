// @vitest-environment jsdom
/** Sidebar launcher pins follow user settings and ignore the fixed Plugins panel. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPanelPins, type SidebarSettings } from '../src/client/panel-pins.ts'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { pinSettingsFixture } from './pin-settings-fixture.ts'

const KEY = 'dsh.slot.manual-order.sidebar.panellist.v1'
afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('sidebar panel pins', () => {
  it('merges choices made before the saved settings arrive', () => {
    let value: SidebarSettings | undefined = undefined
    let listener = () => {}
    const set = vi.fn(async () => true)
    const host: ConfigForm<SidebarSettings> = {
      getSnapshot: () => ({ status: value === undefined ? 'loading' : 'ready', value, base: {}, user: {}, revision: 1, writable: true }),
      subscribe: (next) => { listener = next; return () => {} },
      set,
      unset: async () => false,
      mutate: async () => false,
    }
    const pins = createPanelPins(host)
    pins.setPinned('tasks', false)
    expect(set).not.toHaveBeenCalled()
    value = { unpinnedPanels: ['notes'] }
    listener()
    expect(pins.unpinned.getSnapshot()).toEqual(['notes', 'tasks'])
    expect(set).toHaveBeenCalledWith('unpinnedPanels', ['notes', 'tasks'])
    pins.dispose()
  })

  it('restores rapid changes after recreating the pin list', async () => {
    const form = pinSettingsFixture().get()
    const pins = createPanelPins(form as never)
    pins.setPinned('notes', false)
    pins.setPinned('tasks', false)
    await vi.waitFor(() => { expect(form.getSnapshot().value.unpinnedPanels).toEqual(['notes', 'tasks']) })
    pins.dispose()
    const restored = createPanelPins(form as never)
    expect(restored.unpinned.getSnapshot()).toEqual(['notes', 'tasks'])
    restored.dispose()
  })

  it('keeps the latest choice while earlier writes settle', async () => {
    let value: SidebarSettings = { unpinnedPanels: [] }
    let listener = () => {}
    const settle: Array<(accepted: boolean) => void> = []
    const host: ConfigForm<SidebarSettings> = {
      getSnapshot: () => ({ status: 'ready', value, base: {}, user: {}, revision: 1, writable: true }),
      subscribe: (next) => { listener = next; return () => {} },
      set: () => new Promise<boolean>((resolve) => { settle.push(resolve) }),
      unset: async () => false,
      mutate: async () => false,
    }
    const pins = createPanelPins(host)
    pins.setPinned('notes', false)
    pins.setPinned('tasks', false)
    value = { unpinnedPanels: ['notes'] }
    listener()
    settle[0]?.(true)
    await Promise.resolve()
    expect(pins.unpinned.getSnapshot()).toEqual(['notes', 'tasks'])
    value = { unpinnedPanels: ['notes', 'tasks'] }
    listener()
    settle[1]?.(true)
    await vi.waitFor(() => { expect(pins.unpinned.getSnapshot()).toEqual(['notes', 'tasks']) })
    pins.dispose()
  })

  it('restores accepted settings and rolls back a refused write', async () => {
    let value: SidebarSettings = { unpinnedPanels: ['notes'] }
    const listeners = new Set<() => void>()
    const getSnapshot = (): ConfigFormSnapshot<SidebarSettings> => ({ status: 'ready', value, base: {}, user: {}, revision: 1, writable: true })
    const host: ConfigForm<SidebarSettings> = {
      getSnapshot,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: async () => false,
      unset: async () => false,
      mutate: async () => false,
    }
    const pins = createPanelPins(host)
    expect(pins.unpinned.getSnapshot()).toEqual(['notes'])
    pins.setPinned('tasks', false)
    expect(pins.unpinned.getSnapshot()).toEqual(['notes', 'tasks'])
    await vi.waitFor(() => { expect(pins.unpinned.getSnapshot()).toEqual(['notes']) })
    value = { unpinnedPanels: ['tasks'] }
    listeners.forEach((listener) => { listener() })
    expect(pins.unpinned.getSnapshot()).toEqual(['tasks'])
    pins.dispose()
    expect(listeners.size).toBe(0)
  })

  it('keeps unpinned panel ids in memory without restoring them in a new instance', () => {
    const pins = createPanelPins()
    const listener = vi.fn()
    pins.unpinned.subscribe(listener)
    const initial = pins.unpinned.getSnapshot()
    expect(initial).toEqual([])
    expect(pins.unpinned.getSnapshot()).toBe(initial)
    pins.setPinned('notes', false)
    pins.setPinned('tasks', false)
    expect(pins.unpinned.getSnapshot()).toEqual(['notes', 'tasks'])
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(createPanelPins().unpinned.getSnapshot()).toEqual([])
    pins.setPinned('notes', true)
    expect(pins.unpinned.getSnapshot()).toEqual(['tasks'])
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('ignores Plugins and repeated choices without republishing', () => {
    const pins = createPanelPins()
    pins.setPinned('notes', false)
    const snapshot = pins.unpinned.getSnapshot()
    const listener = vi.fn()
    pins.unpinned.subscribe(listener)
    pins.setPinned('plugins', false)
    pins.setPinned('notes', false)
    pins.setPinned('absent', true)
    expect(pins.unpinned.getSnapshot()).toBe(snapshot)
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps ids of panels that are not registered', () => {
    const pins = createPanelPins()
    pins.setPinned('removed-plugin', false)
    pins.setPinned('notes', false)
    expect(pins.unpinned.getSnapshot()).toEqual(['removed-plugin', 'notes'])
  })

  it('ignores a legacy stored list instead of restoring it', () => {
    localStorage.setItem(KEY, JSON.stringify({ unpinned: ['notes'] }))
    const pins = createPanelPins()
    const snapshot = pins.unpinned.getSnapshot()
    expect(snapshot).toEqual([])
    expect(pins.unpinned.getSnapshot()).toBe(snapshot)
    pins.setPinned('notes', false)
    expect(pins.unpinned.getSnapshot()).toEqual(['notes'])
  })
})
