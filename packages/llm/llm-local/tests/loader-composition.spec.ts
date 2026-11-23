import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { startMockOpenAiServer } from '@deepseek-ai/dsh-llm-mock-server'
import type { MockOpenAiServer } from '@deepseek-ai/dsh-llm-mock-server'
import * as Local from '../src/index.ts'

let root: string | undefined
let context: Context | undefined
let server: MockOpenAiServer | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  await server?.close()
  server = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Supply only the source modules named by the test composition. */
function sourceModuleLoader(modules: ReadonlyMap<string, unknown>): ModuleLoaderV2 {
  return {
    version: 'v2',
    loadCache: new Map(),
    import: (specifier) => {
      const module = modules.get(specifier)
      if (module === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return Promise.resolve(module)
    },
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
}

async function loadComposition(baseURL: string): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-llm-local-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: '@deepseek-ai/dsh-llm'",
    '- id: llm-local',
    "  name: '@deepseek-ai/dsh-llm-local'",
    '  config:',
    '    providers:',
    '      intel-local:',
    '        displayName: Intel local endpoint',
    `        baseURL: ${JSON.stringify(baseURL)}`,
    '        models:',
    '          - id: qwen-local',
    '            contextWindow: 8192',
    '            maxTokens: 1024',
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = sourceModuleLoader(new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-llm-local', Local],
  ]))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return ctx
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('llm-local real Loader composition', () => {
  it('loads cordis.yml, discovers the local model, streams a request, and disposes its route', async () => {
    server = await startMockOpenAiServer({ models: [{ id: 'qwen-local', name: 'Qwen local' }], completion: { content: 'ready' } })
    const ctx = await loadComposition(`${server.baseURL}/v1`)

    const llm = ctx.llm
    expect(llm.listProviders()).toEqual([{ id: 'intel-local', name: 'Intel local endpoint' }])
    await expect(llm.listModels('intel-local')).resolves.toEqual([{
      provider: 'intel-local', id: 'qwen-local', name: 'Qwen local', inputModalities: ['text'],
    }])
    const chunks = await collect(llm.stream({
      provider: 'intel-local', model: 'qwen-local',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })],
    }))
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(server.requests.map(request => request.path)).toEqual(['/v1/models', '/v1/chat/completions'])
    expect(server.requests.every(request => request.headers.authorization === undefined)).toBe(true)

    await ctx.fiber.dispose()
    expect(llm.listProviders()).toEqual([])
  })
})
