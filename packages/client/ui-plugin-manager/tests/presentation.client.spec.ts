/** Display sentences for global plugin management. */
import { expect, it } from 'vitest'
import { en, type PluginManagerLocaleKey } from '../src/client/locales.ts'
import { managementText, type Translate } from '../src/client/presentation.ts'

const t = ((key: PluginManagerLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    en[key],
  )) as Translate

it('keeps the localized sentence alone when the Host names no detail', () => {
  expect(managementText({ code: 'bundle-in-use' }, t)).toBe(en.reasonBundleInUse)
})

it("names what still holds a bundle in use after the Host's sentence", () => {
  const diagnostic = 'managed (file:///profile/node_modules/extra/plugin.mjs) still runs; only the profile root config lists it, and the next start resets that file'
  expect(managementText({ code: 'bundle-in-use', diagnostic }, t)).toBe(`${en.reasonBundleInUse}: ${diagnostic}`)
})

it('shows the Host diagnostic alone for an operation error', () => {
  expect(managementText({ code: 'operation-error', diagnostic: 'pnpm exited with 1' }, t)).toBe('pnpm exited with 1')
  expect(managementText({ code: 'operation-error' }, t)).toBe(en.reasonOperationError)
})
