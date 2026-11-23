/** Scriptable OpenAI-compatible model-list and Chat Completions test server. */

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP, type AddressInfo } from 'node:net'

/** One model advertised by the mock `/v1/models` endpoint. */
export interface MockOpenAiModel {
  /** Model id accepted by Chat Completions. */
  readonly id: string
  /** Optional selector label. */
  readonly name?: string
  /** Optional context capacity emitted as `context_window`. */
  readonly contextWindow?: number
  /** Optional output capacity emitted as `max_tokens`. */
  readonly maxTokens?: number
}

/** One tool call emitted in a completed streamed response. */
export interface MockOpenAiToolCall {
  /** Provider call id. */
  readonly id: string
  /** Function name. */
  readonly name: string
  /** Raw function argument JSON. */
  readonly arguments: string
}

/** One deterministic completion served for every accepted chat request. */
export interface MockOpenAiCompletion {
  /** Assistant text content. */
  readonly content?: string
  /** Optional reasoning content emitted with the common `reasoning_content` extension. */
  readonly reasoning?: string
  /** Optional function calls. */
  readonly toolCalls?: readonly MockOpenAiToolCall[]
  /** OpenAI terminal choice reason; inferred from tool calls or text when absent. */
  readonly finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter'
  /** Prompt-token count in the final usage frame. */
  readonly promptTokens?: number
  /** Completion-token count in the final usage frame. */
  readonly completionTokens?: number
}

/** Options for one local OpenAI-compatible mock server. */
export interface MockOpenAiServerOptions {
  /** Loopback host by default. */
  readonly host?: string
  /** TCP port; zero requests an OS-assigned port. */
  readonly port?: number
  /** Models advertised by `GET /v1/models`. */
  readonly models: readonly MockOpenAiModel[]
  /** Completion returned for each `POST /v1/chat/completions`. */
  readonly completion?: MockOpenAiCompletion
  /** Optional exact Bearer key; omission accepts unauthenticated requests. */
  readonly apiKey?: string
}

/** Captured mock endpoint request. */
export interface MockOpenAiRequestRecord {
  /** Request method. */
  readonly method: string
  /** URL path. */
  readonly path: string
  /** Detached request headers. */
  readonly headers: Readonly<IncomingMessage['headers']>
  /** Parsed body for chat completion requests. */
  readonly body?: unknown
}

/** Running mock server with its captured requests. */
export interface MockOpenAiServer {
  /** Base URL without `/v1`. */
  readonly baseURL: string
  /** Actual bound TCP port. */
  readonly port: number
  /** Accepted requests in arrival order. */
  readonly requests: readonly MockOpenAiRequestRecord[]
  /** Stop accepting requests; idempotent. */
  close(): Promise<void>
}

const DEFAULT_COMPLETION: MockOpenAiCompletion = Object.freeze({
  content: 'mock response',
  promptTokens: 11,
  completionTokens: 7,
})

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array)
    total += bytes.byteLength
    if (total > 1024 * 1024) throw new Error('mock request body exceeds 1 MiB')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function writeFrame(response: ServerResponse, value: unknown): void {
  response.write(`data: ${JSON.stringify(value)}\n\n`)
}

function chunks(text: string): string[] {
  const points = Array.from(text)
  const output: string[] = []
  for (let index = 0; index < points.length; index += 5) output.push(points.slice(index, index + 5).join(''))
  return output
}

function replyModels(options: MockOpenAiServerOptions, response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({
    object: 'list',
    data: options.models.map(model => ({
      id: model.id,
      object: 'model',
      ...model.name === undefined ? {} : { name: model.name },
      ...model.contextWindow === undefined ? {} : { context_window: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { max_tokens: model.maxTokens },
    })),
  }))
}

function replyCompletion(options: MockOpenAiServerOptions, response: ServerResponse): void {
  const completion = options.completion ?? DEFAULT_COMPLETION
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
  response.flushHeaders()
  writeFrame(response, { id: 'mock-chat', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
  for (const text of chunks(completion.reasoning ?? '')) {
    writeFrame(response, { id: 'mock-chat', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { reasoning_content: text }, finish_reason: null }] })
  }
  for (const text of chunks(completion.content ?? '')) {
    writeFrame(response, { id: 'mock-chat', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
  }
  for (const [index, tool] of (completion.toolCalls ?? []).entries()) {
    const argumentsChunks = chunks(tool.arguments)
    const firstArguments = argumentsChunks.shift() ?? ''
    writeFrame(response, {
      id: 'mock-chat', object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { tool_calls: [{ index, id: tool.id, type: 'function', function: { name: tool.name, arguments: firstArguments } }] }, finish_reason: null }],
    })
    for (const args of argumentsChunks) {
      writeFrame(response, {
        id: 'mock-chat', object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: args } }] }, finish_reason: null }],
      })
    }
  }
  const finishReason = completion.finishReason ?? ((completion.toolCalls?.length ?? 0) > 0 ? 'tool_calls' : 'stop')
  writeFrame(response, {
    id: 'mock-chat', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  })
  writeFrame(response, {
    id: 'mock-chat', object: 'chat.completion.chunk', choices: [],
    usage: {
      prompt_tokens: completion.promptTokens ?? 11,
      completion_tokens: completion.completionTokens ?? 7,
      total_tokens: (completion.promptTokens ?? 11) + (completion.completionTokens ?? 7),
    },
  })
  response.write('data: [DONE]\n\n')
  response.end()
}

function sendError(response: ServerResponse, status: number, message: string, code: string): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: { message, code } }))
}

/**
 * Start a loopback OpenAI-compatible server for provider adapter tests.
 * @param options - advertised models, deterministic completion, and optional authentication.
 * @returns a handle whose close method releases the owned listener.
 */
export async function startMockOpenAiServer(options: MockOpenAiServerOptions): Promise<MockOpenAiServer> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 0
  if (host.length === 0) throw new Error('mock OpenAI host must not be empty')
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('mock OpenAI port must be between 0 and 65535')
  if (options.apiKey === '') throw new Error('mock OpenAI apiKey must not be empty')
  const requests: MockOpenAiRequestRecord[] = []
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    /* v8 ignore next -- node:http server requests always carry a URL despite the shared optional type */
    const path = new URL(request.url ?? '/', 'http://mock.invalid').pathname
    if (options.apiKey !== undefined && request.headers.authorization !== `Bearer ${options.apiKey}`) {
      sendError(response, 401, 'invalid mock API key', 'invalid_api_key')
      return
    }
    if (request.method === 'GET' && path.endsWith('/v1/models')) {
      requests.push({ method: 'GET', path, headers: { ...request.headers } })
      replyModels(options, response)
      return
    }
    if (request.method === 'POST' && path.endsWith('/v1/chat/completions')) {
      let body: unknown
      try { body = await readBody(request) } catch (_invalidMockRequest) {
        sendError(response, 400, 'request body must be valid JSON', 'invalid_json')
        return
      }
      requests.push({ method: 'POST', path, headers: { ...request.headers }, body })
      replyCompletion(options, response)
      return
    }
    response.writeHead(404).end()
  }
  const server = createServer((request, response) => {
    /* v8 ignore start -- last-resort containment for Node response failures after validated test inputs */
    void handle(request, response).catch((_handlerFailure: unknown) => {
      if (!response.headersSent) sendError(response, 500, 'mock OpenAI server failed', 'mock_server_error')
      else response.destroy()
    })
    /* v8 ignore stop */
  })
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => (closing ??= new Promise((resolveClose) => {
    server.close(() => { resolveClose() })
    server.closeAllConnections()
  }))
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, host, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address() as AddressInfo
  const advertisedHost = isIP(host) === 6 ? `[${host}]` : host
  return { baseURL: `http://${advertisedHost}:${address.port}`, port: address.port, requests, close }
}
