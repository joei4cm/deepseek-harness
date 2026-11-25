/** Real profile composition for sidebar settings: the Host Settings service over a profile patch. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { onTestFinished } from 'vitest'
import type { Fiber } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings, { type SettingsDescriptor, type SettingsForms } from '@deepseek-ai/dsh-settings'
import * as SidebarHost from '../src/index.ts'

/** Profile entry id the sidebar Host plugin is composed under. */
export const SIDEBAR_NAMESPACE = 'ui-sidebar'

/** One booted Host composition serving the sidebar settings namespace. */
export interface SidebarSettingsHost {
  /** Real user-settings service over the active profile patch. */
  readonly settings: SettingsForms
  /** Profile patch document the settings service persists edits to. */
  readonly patchPath: string
  /** Live descriptor of one settings namespace.
   * @param ns - profile entry id serving the namespace.
   * @returns the descriptor the Settings service currently publishes.
   */
  view(ns: string): SettingsDescriptor
  /** Fiber currently serving one Loader entry.
   * @param ns - profile entry id.
   * @returns the entry's active fiber.
   */
  entryFiber(ns: string): Fiber
  /** Boot a fresh context over the same profile directory. */
  restart(): Promise<SidebarSettingsHost>
  /** Dispose the booted context. */
  dispose(): Promise<void>
}

async function bootHost(profile: ProfileContext): Promise<SidebarSettingsHost> {
  const ctx = await boot('test', join(profile.dir, 'cordis.yml'), readProfilePatches('test', profile), (prepared) => {
    prepared.provide('profileContext', profile)
    prepared.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
    Object.assign(prepared.loader.builtins, { editor: ConfigEditor, settings: Settings, sidebar: SidebarHost })
  })
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const settings = ctx.get('settings') as SettingsForms
  return {
    settings,
    patchPath: profile.patchPath,
    view: ns => settings.describe().find(row => row.ns === ns)!,
    entryFiber: ns => [...ctx.loader.entries()].find(entry => entry.options.id === ns)!.fiber!,
    restart: () => bootHost(profile),
    dispose: () => ctx.fiber.dispose(),
  }
}

/** Boot a profile whose bundle composes the real sidebar Host plugin behind the real Settings service. */
export async function sidebarSettingsHost(): Promise<SidebarSettingsHost> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'sidebar-settings-')))
  const dir = join(home, 'profiles', 'test')
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: SIDEBAR_NAMESPACE, name: 'cordis:sidebar' },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlayPaths: [], telemetryDisabledEnv: undefined,
  }
  return await bootHost(profile)
}

/** Text of the profile patch the settings service writes.
 * @param host - booted composition.
 * @returns the current patch document.
 */
export function patchText(host: SidebarSettingsHost): string {
  return readFileSync(host.patchPath, 'utf8')
}
