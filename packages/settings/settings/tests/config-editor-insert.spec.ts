/** Edits to profile rows that a same-file insert list defines. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { configurationFixture as fixture } from './configuration-fixture.ts'

interface PatchRow {
  id?: string
  name?: string
  config?: Record<string, unknown>
}

interface PatchDocument extends PatchRow {
  insert?: PatchRow[]
}

function readDocument(path: string): PatchDocument[] {
  return parse(readFileSync(path, 'utf8')) as PatchDocument[]
}

const insertedPatch = `- insert:
    - id: inserted-row
      name: cordis:probe
      config:
        ordinary: inserted
`

it('rewrites the row inside a same-file insert list instead of adding a top-level override', async () => {
  const { ctx, profile } = await fixture({ hmr: false, patch: insertedPatch })
  await ctx.settings.update('inserted-row', { count: 9 })
  const document = readDocument(profile.patchPath)
  expect(document).toHaveLength(1)
  expect(document[0]?.insert).toEqual([{ id: 'inserted-row', name: 'cordis:probe', config: { ordinary: 'inserted', count: 9 } }])
  expect(ctx.settings.describe().find(row => row.ns === 'inserted-row')!.value).toMatchObject({ count: 9 })
})

it('keeps a same-file top-level override ahead of the inserted row', async () => {
  const { ctx, profile } = await fixture({ hmr: false, patch: `${insertedPatch}- id: inserted-row
  name: cordis:probe
  config:
    ordinary: inserted
    count: 4
` })
  await ctx.settings.update('inserted-row', { count: 9 })
  const document = readDocument(profile.patchPath)
  expect(document).toHaveLength(2)
  expect(document[0]?.insert).toEqual([{ id: 'inserted-row', name: 'cordis:probe', config: { ordinary: 'inserted' } }])
  expect(document[1]).toEqual({ id: 'inserted-row', name: 'cordis:probe', config: { ordinary: 'inserted', count: 9 } })
  expect(ctx.settings.describe().find(row => row.ns === 'inserted-row')!.value).toMatchObject({ count: 9 })
})

it('restores the inherited value of an inserted row and keeps the config the user wrote', async () => {
  const { ctx, profile } = await fixture({ hmr: false, patch: insertedPatch })
  await ctx.settings.update('inserted-row', { count: 9 })
  await ctx.settings.replace('inserted-row', {})
  const document = readDocument(profile.patchPath)
  expect(document).toEqual([{ insert: [{ id: 'inserted-row', name: 'cordis:probe', config: { ordinary: 'inserted' } }] }])
  expect(ctx.settings.describe().find(row => row.ns === 'inserted-row')!.value).toEqual({ count: 2, list: [] })
})

it('reports the config of an inserted row as the user layer', async () => {
  const { ctx } = await fixture({ hmr: false, patch: insertedPatch })
  const row = ctx.configEditor.configuration().find(row => row.entry.options.id === 'inserted-row')!
  expect(row.inherited).toEqual({})
  expect(row.override).toEqual({ ordinary: 'inserted' })
})
