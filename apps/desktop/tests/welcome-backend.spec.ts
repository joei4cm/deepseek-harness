import { expect, it, vi } from 'vitest'
import { connectDesktopWelcome } from '../src/welcome-backend.ts'

const ORIGIN = 'http://127.0.0.1:9876'

function okResponse(rpcId: string, value: unknown): Response {
  return new Response(JSON.stringify({
    type: 'server-response', rpcId, result: { ok: true, value },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

interface RecordedCall { readonly url: string; readonly rpcId: string; readonly method: string }

function recordingSend(respond: (payload: { rpcId: string; method: string }, attempt: number) => Response) {
  const calls: RecordedCall[] = []
  const send = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const payload = JSON.parse(String(init?.body)) as { rpcId: string; method: string; payload: { args: unknown } }
    calls.push({ url: input, rpcId: payload.rpcId, method: payload.method })
    return respond(payload, calls.length)
  })
  return { calls, send }
}

it('retries a read-only invoke once on a transport TypeError and answers with a fresh rpcId', async () => {
  const { calls, send } = recordingSend((payload, attempt) => {
    if (attempt === 1) throw new TypeError('fetch failed')
    return okResponse(payload.rpcId, { namespaces: [{ ns: 'locale', value: {} }] })
  })
  const backend = connectDesktopWelcome(`${ORIGIN}/`, 'session-cookie', send)
  await expect(backend.readLocalePreference()).resolves.toBeNull()
  expect(calls).toHaveLength(2)
  expect(calls[0]!.method).toBe('settings/describe')
  expect(calls[1]!.method).toBe('settings/describe')
  expect(calls[0]!.rpcId).not.toBe(calls[1]!.rpcId)
  expect(calls[1]!.url).toBe(`${ORIGIN}/api/settings/describe`)
})

it('retries the account state read through the shared invoke path', async () => {
  const { calls, send } = recordingSend((payload, attempt) => {
    if (attempt === 1) throw new TypeError('fetch failed')
    return okResponse(payload.rpcId, {
      status: 'signed-out',
      links: { usageUrl: 'http://127.0.0.1:9000/usage', topUpUrl: 'https://example.com/top-up' },
      attempt: null,
    })
  })
  const backend = connectDesktopWelcome(ORIGIN, 'session-cookie', send)
  await expect(backend.account.state()).resolves.toMatchObject({ status: 'signed-out' })
  expect(calls.map(call => call.method)).toEqual(['account/getState', 'account/getState'])
})

it('does not retry a mutating or analytics call on the same transport failure', async () => {
  const { calls, send } = recordingSend((payload, attempt) => {
    if (attempt === 1) throw new TypeError('fetch failed')
    return okResponse(payload.rpcId, {})
  })
  const backend = connectDesktopWelcome(ORIGIN, 'session-cookie', send)
  await expect(backend.report({ type: 'event', name: 'probe' } as never)).rejects.toThrow('fetch failed')
  expect(calls).toHaveLength(1)

  const account = connectDesktopWelcome(ORIGIN, 'session-cookie',
    recordingSend((payload, attempt) => {
      if (attempt === 1) throw new TypeError('fetch failed')
      return okResponse(payload.rpcId, {})
    }).send)
  await expect(account.account.start({ appVersion: '0', language: 'en' } as never)).rejects.toThrow('fetch failed')
})

it('propagates a caller deadline instead of retrying an aborted attempt', async () => {
  // The one-second caller deadline aborts the request itself: a timeout is
  // not a TypeError and must surface without a second attempt.
  const send = vi.fn(async (_input: string, _init?: RequestInit): Promise<Response> => {
    return await Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
  })
  const backend = connectDesktopWelcome(ORIGIN, 'session-cookie', send)
  await expect(backend.analyticsEnabled()).rejects.toThrow('aborted')
  expect(send).toHaveBeenCalledOnce()
})

it('propagates the second transport failure after the single retry', async () => {
  const { calls, send } = recordingSend(() => { throw new TypeError('fetch failed') })
  const backend = connectDesktopWelcome(ORIGIN, 'session-cookie', send)
  await expect(backend.readLocalePreference()).rejects.toThrow('fetch failed')
  expect(calls).toHaveLength(2)
})
