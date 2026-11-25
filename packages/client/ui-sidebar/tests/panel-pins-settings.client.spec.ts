/** Sidebar pin choices persist through the real Host Settings service and profile patch. */
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { createPanelPins, type SidebarSettings } from '../src/client/panel-pins.ts'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import { patchText, SIDEBAR_NAMESPACE, sidebarSettingsHost, type SidebarSettingsHost } from './settings-profile-fixture.client.ts'

/** ConfigForm face over the real Host Settings service, as the settings Remote serves it. */
function hostForm(host: SidebarSettingsHost, ns: string): ConfigForm<SidebarSettings> {
  const listeners = new Set<() => void>()
  let tail = Promise.resolve()
  const notify = (): void => { listeners.forEach((listener) => { listener() }) }
  return {
    getSnapshot: (): ConfigFormSnapshot<SidebarSettings> => {
      const view = host.view(ns)
      if (view === undefined) {
        return { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: host.settings.writable }
      }
      return {
        status: 'ready', value: view.value as SidebarSettings,
        base: view.base, user: view.user, revision: view.revision, writable: host.settings.writable,
      }
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (field, value) => {
      const write = tail.then(async () => { await host.settings.update(ns, { [field]: value }); notify() })
      tail = write.catch(() => {})
      return write.then(() => true)
    },
    unset: async (field) => { await host.settings.mutate(ns, [{ op: 'unset', path: [field] }]); return true },
    mutate: async (ops: readonly SettingsPathOpView[]) => { await host.settings.mutate(ns, ops); return true },
  }
}

/** Wait until the Host descriptor, the profile patch, and the pin list all carry the same unpinned ids. */
async function expectPersisted(
  host: SidebarSettingsHost, pins: { unpinned: { getSnapshot: () => readonly string[] } }, unpinned: string[],
): Promise<void> {
  await vi.waitFor(() => {
    expect(host.view(SIDEBAR_NAMESPACE).value).toEqual({ unpinnedPanels: unpinned })
    if (unpinned.length > 0) expect(patchText(host)).toContain('unpinnedPanels')
    expect(pins.unpinned.getSnapshot()).toEqual(unpinned)
  })
}

it('persists unpinned panel ids to the profile patch and restores them after restart', async () => {
  const host = await sidebarSettingsHost()
  const fiber = host.entryFiber(SIDEBAR_NAMESPACE)
  const pins = createPanelPins(hostForm(host, SIDEBAR_NAMESPACE))
  expect(pins.unpinned.getSnapshot()).toEqual([])
  expect(host.view(SIDEBAR_NAMESPACE).value).toEqual({ unpinnedPanels: [] })

  pins.setPinned('notes', false)
  pins.setPinned('tasks', false)
  await expectPersisted(host, pins, ['notes', 'tasks'])
  // The Host write reaches the entry's live Config without remounting its fiber.
  expect(host.entryFiber(SIDEBAR_NAMESPACE)).toBe(fiber)

  pins.setPinned('notes', true)
  await expectPersisted(host, pins, ['tasks'])
  expect(patchText(host)).toContain('unpinnedPanels')

  pins.dispose()
  await host.dispose()
  const restarted = await host.restart()
  const restoredPins = createPanelPins(hostForm(restarted, SIDEBAR_NAMESPACE))
  expect(restoredPins.unpinned.getSnapshot()).toEqual(['tasks'])
  restoredPins.dispose()
})

it('clears the persisted pin list when every panel is pinned again', async () => {
  const host = await sidebarSettingsHost()
  const pins = createPanelPins(hostForm(host, SIDEBAR_NAMESPACE))
  pins.setPinned('notes', false)
  await expectPersisted(host, pins, ['notes'])
  pins.setPinned('notes', true)
  await expectPersisted(host, pins, [])
  expect(patchText(host)).toContain('unpinnedPanels: []')
  pins.dispose()
})

it('rolls the pin list back to the stored settings after a refused write', async () => {
  const host = await sidebarSettingsHost()
  const before = patchText(host)
  const pins = createPanelPins({ ...hostForm(host, SIDEBAR_NAMESPACE), set: async () => false })
  pins.setPinned('notes', false)
  expect(pins.unpinned.getSnapshot()).toEqual(['notes'])
  await expectPersisted(host, pins, [])
  expect(patchText(host)).toBe(before)
  pins.dispose()
})

it('rejects edits to fields the sidebar schema does not mark volatile', async () => {
  const host = await sidebarSettingsHost()
  const before = patchText(host)
  await expect(host.settings.update(SIDEBAR_NAMESPACE, { unpinnedPanels: ['notes'] })).resolves.toBeUndefined()
  expect(host.view(SIDEBAR_NAMESPACE).value).toEqual({ unpinnedPanels: ['notes'] })
  await expect(host.settings.update(SIDEBAR_NAMESPACE, { pinnedPanels: ['notes'] })).rejects.toThrow('not volatile')
  await expect(host.settings.mutate(SIDEBAR_NAMESPACE, [{ op: 'set', path: ['unpinnedPanels', 'x'], value: 1 }])).rejects.toThrow()
  expect(host.view(SIDEBAR_NAMESPACE).value).toEqual({ unpinnedPanels: ['notes'] })
  expect(readFileSync(host.patchPath, 'utf8')).toContain('unpinnedPanels')
  expect(before).not.toContain('unpinnedPanels')
})
