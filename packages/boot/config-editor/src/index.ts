/** Profile-owned configuration edits, serialized with Loader hot reload. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { Context, FiberState, Service } from '@deepseek-ai/cordis'
import { parseEntryYaml, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { Entry, EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-hmr'
import { composeEntries, loadProfileDirectory, readProfilePatches, reconcileProfilePatches } from '@deepseek-ai/dsh-app-boot'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isMap, isSeq, parseDocument, Scalar, visit } from 'yaml'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Persistent edits to the active profile's plugin configuration. */
    configEditor: ConfigEditor
  }
}

function flatten(rows: EntryOptions[]): EntryOptions[] {
  return rows.flatMap(row => [row, ...row.group && Array.isArray(row.config) ? flatten(row.config as EntryOptions[]) : []])
}

/** The plugin's own config in the profile patch file, and the row that carries it. */
interface UserConfig {
  /** Config of the row that carries it. */
  config: Record<string, unknown>
  /** The row lives inside an insert list. */
  inserted: boolean
}

/**
 * Find the plugin's own config in a patch list.
 * A top-level row and a row inside an insert list both carry user config, and the later row
 * wins: the patch order replaces an inserted entry with a later one. A group row holds its
 * children rather than a config, so it carries none.
 */
function userConfig(patches: readonly PatchOptions[], id: string): UserConfig | undefined {
  let found: UserConfig | undefined
  for (const patch of patches) {
    if (patch.insert !== undefined) {
      for (const row of patch.insert) {
        if (row.id === id && row.config !== undefined && !Array.isArray(row.config)) {
          found = { config: row.config as Record<string, unknown>, inserted: true }
        }
      }
      continue
    }
    if (patch.id === id && patch.config !== undefined && !Array.isArray(patch.config)) {
      found = { config: patch.config as Record<string, unknown>, inserted: false }
    }
  }
  return found
}

/** The row without the config it carries. */
function withoutConfig(row: EntryOptions): EntryOptions {
  const rest = { ...row }
  Reflect.deleteProperty(rest, 'config')
  return rest
}

/** Persist complete raw configs and apply them through the normal Loader path. */
export class ConfigEditor extends Service {
  static inject = ['loader', 'profileContext']

  constructor(private readonly ownerContext: Context) {
    super(ownerContext, 'configEditor')
  }

  /** The profile patch edited by this service. */
  get documentPath(): string { return this.ownerContext.profileContext.patchPath }

  /** Addressable profile rows; nested Includes have independent configuration ownership.
   * @returns Active entries with unique profile patch ids.
   */
  entries(): Entry[] {
    const candidates = [...this.ownerContext.loader.entries()].filter(entry => entry.parent.tree.ctx.fiber.entry?.id === 'include')
    const counts = new Map<string, number>()
    for (const entry of candidates) counts.set(entry.options.id, (counts.get(entry.options.id) ?? 0) + 1)
    return candidates.filter(entry => counts.get(entry.options.id) === 1)
  }

  /** Read inherited and explicit profile values for the active entries.
   * @returns Detached layer values alongside their Loader entries.
   */
  configuration(): Array<{ entry: Entry; inherited: Record<string, unknown>; override: Record<string, unknown> }> {
    const profile = this.ownerContext.profileContext
    const loaded = loadProfileDirectory('dsh', profile.dir, profile.installAnchor)
    const entries = this.entries()
    // A plugin's own config lives in the profile file, in a top-level row or in a row inside an
    // insert list. An own config key can replace inherited config even when its value is undefined.
    const overridden = new Set<string>()
    for (const patch of loaded.patches) {
      if (patch.insert === undefined) {
        if (Object.hasOwn(patch, 'config') && patch.id !== undefined) overridden.add(patch.id)
        continue
      }
      for (const row of patch.insert) {
        if (row.config !== undefined && !Array.isArray(row.config)) overridden.add(row.id)
      }
    }
    const composed = new Map<string, EntryOptions>()
    if (entries.some(entry => !overridden.has(entry.options.id))) {
      for (const row of flatten(composeEntries([...loaded.layers.map(layer => layer.patches), loaded.patches]))) {
        if (!composed.has(row.id)) composed.set(row.id, row)
      }
    }
    return entries.map(entry => ({
      entry,
      inherited: overridden.has(entry.options.id)
        ? this.inherited(entry, loaded)
        : structuredClone((composed.get(entry.options.id)?.config ?? {}) as Record<string, unknown>),
      override: structuredClone(userConfig(loaded.patches, entry.options.id)?.config ?? {}),
    }))
  }

  private inherited(entry: Entry, loaded: ReturnType<typeof loadProfileDirectory>): Record<string, unknown> {
    const location = userConfig(loaded.patches, entry.options.id)
    const patches = loaded.patches.map((patch) => {
      if (patch.insert !== undefined) {
        // A row inside an insert list carries the plugin's own config only when no top-level
        // row does; the config of an inserted row is the inherited value otherwise.
        if (location?.inserted !== true) return patch
        return { ...patch, insert: patch.insert.map(row => row.id === entry.options.id ? withoutConfig(row) : row) }
      }
      if (patch.id !== entry.options.id) return patch
      const rest = { ...patch }; Reflect.deleteProperty(rest, 'config')
      return rest
    })
    const row = flatten(composeEntries([...loaded.layers.map(layer => layer.patches), patches])).find(row => row.id === entry.options.id)
    return structuredClone((row?.config ?? {}) as Record<string, unknown>)
  }

  /** Validate, persist, and reconcile a plugin's next config; ordinary fields keep normal lifecycle rules.
   * @param entry Current Loader entry, also used to detect replacement during the write.
   * @param change Derive a raw config from the current entry and its inherited layer.
   * @returns Fulfillment after Loader reconciliation completes.
   */
  async edit(
    entry: Entry,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void> {
    const run = async (): Promise<void> => {
      const path = this.documentPath
      await withFileLock(join(this.ownerContext.profileContext.dir, 'package.json'), async () => {
        if (!this.entries().includes(entry) || entry.fiber === undefined) throw new Error('Configuration entry is no longer available')
        const beforePatches = readProfilePatches('dsh', this.ownerContext.profileContext)
        await reconcileProfilePatches(this.ownerContext[Context.root], beforePatches, 'dsh')
        if (!this.entries().includes(entry)) throw new Error('Configuration entry changed during reload')
        const current = structuredClone((entry.options.config ?? {}) as Record<string, unknown>)
        const inherited = this.inherited(entry, loadProfileDirectory('dsh', this.ownerContext.profileContext.dir, this.ownerContext.profileContext.installAnchor))
        const next = change(current, inherited)
        const fiber = entry.fiber
        if (fiber.state !== FiberState.ACTIVE) throw new Error('Configuration plugin is no longer active')
        fiber.resolveConfig(next)
        let before: string
        try { before = await readFile(path, 'utf8') }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          before = '[]\n'
        }
        const document = parseDocument(before, {
          customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
        })
        if (document.errors[0] !== undefined) throw document.errors[0]
        if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
        document.contents.flow = false
        const matches = (item: unknown, itemIndex: number): boolean => isMap(item)
          && document.getIn([itemIndex, 'id']) === entry.options.id && !item.has('insert')
          && (!item.has('name') || document.getIn([itemIndex, 'name']) === entry.options.name)
        const index = document.contents.items.findLastIndex(matches)
        // The plugin's own config lives in one place in this file: a top-level row, or a row
        // inside an insert list. The later row wins, as the patch order replaces an inserted entry.
        let inserted: readonly [number, number] | undefined
        for (let patchIndex = document.contents.items.length - 1; patchIndex >= 0 && inserted === undefined; patchIndex--) {
          const patch = document.contents.items[patchIndex]
          if (!isMap(patch) || patch.has('id')) continue
          const list = patch.get('insert', true)
          if (!isSeq(list)) continue
          for (let rowIndex = list.items.length - 1; rowIndex >= 0; rowIndex--) {
            const row = list.items[rowIndex]
            if (isMap(row) && !row.has('insert') && row.get('id') === entry.options.id
              && (row.get('name') === undefined || row.get('name') === entry.options.name)) {
              inserted = [patchIndex, rowIndex]
              break
            }
          }
        }
        const location: { top?: number; inserted?: readonly [number, number] } | undefined =
          inserted !== undefined && (index < 0 || inserted[0] > index) ? { inserted }
            : index >= 0 ? { top: index } : undefined
        if (isDeepStrictEqual(next, inherited)) {
          if (location?.inserted !== undefined) {
            const row = document.getIn([location.inserted[0], 'insert', location.inserted[1]], true)
            if (isMap(row)) row.delete('config')
          } else {
            for (let index = document.contents.items.length - 1; index >= 0; index--) {
              const row = document.contents.items[index]
              if (!isMap(row) || document.getIn([index, 'id']) !== entry.options.id || row.has('insert')) continue
              row.delete('config')
              if (row.items.length === Number(row.has('id')) + Number(row.has('name'))) document.delete(index)
            }
          }
        } else if (location?.inserted !== undefined) {
          document.setIn([location.inserted[0], 'insert', location.inserted[1], 'config'], document.createNode(next))
        } else if (location?.top !== undefined) {
          document.setIn([location.top, 'config'], document.createNode(next))
        } else document.add(document.createNode({ id: entry.options.id, name: entry.options.name, config: next }))
        visit(document, { Map(_key, node) {
          if (node.items.length !== 1 || typeof node.get('__jsExpr') !== 'string') return
          const expression = new Scalar(node.get('__jsExpr'))
          expression.tag = 'tag:yaml.org,2002:js'
          return expression
        } })
        const profile = this.ownerContext.profileContext
        const loaded = loadProfileDirectory('dsh', profile.dir, profile.installAnchor)
        const patches = readProfilePatches('dsh', profile, { ...loaded, patches: parseEntryYaml(String(document)) as PatchOptions[] })
        const effective = flatten(composeEntries([patches])).find(row => row.id === entry.options.id)
        if (!isDeepStrictEqual(effective?.config ?? {}, next)) {
          throw new Error(`Configuration for "${entry.options.id}" is overridden by a home patch or command-line overlay`)
        }
        await writeFileAtomic(path, String(document), { mode: 0o600 })
        try {
          await reconcileProfilePatches(this.ownerContext[Context.root], patches, 'dsh', [entry.options.id])
        } catch (error) {
          await writeFileAtomic(path, before, { mode: 0o600 })
          await reconcileProfilePatches(this.ownerContext[Context.root], beforePatches, 'dsh')
          throw error
        }
      })
    }
    const hmr = this.ownerContext.get('hmr')
    await (hmr === undefined ? run() : hmr.runExclusive(run))
  }
}

export default ConfigEditor
