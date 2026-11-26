/** Host behavior of a closed Inspector source. */

import { MessageChannel } from 'node:worker_threads'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { HostBridgePublisher } from '../src/host/bridge/publisher.ts'
import { HostInspectorSource } from '../src/host/bridge/transport.ts'
import { inspectorId } from '../src/shared/bridge/ids.ts'
import type { InspectorStatePublisher } from '../src/shared/bridge/publisher.ts'
import type { InspectorSourceDescriptor } from '../src/shared/bridge/messages/observation.ts'
import { publishCordisTree } from '../src/shared/cordis/publisher.ts'

const source: InspectorSourceDescriptor = {
  sourceId: inspectorId<'InspectorSourceId'>('closed-source-test', 'sourceId'),
  generation: inspectorId<'InspectorSourceGeneration'>('generation-closed-source-test', 'generation'),
  kind: 'host',
  label: 'Host',
  timeOriginMs: performance.timeOrigin,
  capabilities: [],
}

function hostPublisher(port: MessageChannel['port1']): HostBridgePublisher {
  return new HostBridgePublisher(port, source, {
    topics: ['*'],
    maxQueuedRecords: 2,
    maxQueuedBytes: 32_768,
    maxRecordsPerFrame: 8,
    maxFrameBytes: 32_768,
  })
}

describe('Inspector closed Host source', () => {
  it('drops publications that arrive after the source closed', async () => {
    const channel = new MessageChannel()
    const messages: unknown[] = []
    channel.port2.on('message', (message: unknown) => { messages.push(message) })
    channel.port2.start()
    const publisher = hostPublisher(channel.port1)
    try {
      publisher.close()
      expect(publisher.isClosed()).toBe(true)
      expect(() => { publisher.setState('state/closed', { closed: true }) }).not.toThrow()
      expect(() => { publisher.publish('event/closed', { closed: true }) }).not.toThrow()
      await Promise.resolve()
      expect(messages).toEqual([])
    } finally {
      channel.port1.close()
      channel.port2.close()
    }
  })

  it('keeps a Cordis mutation inert after the source closed', async () => {
    const root = new Context()
    const channel = new MessageChannel()
    const messages: unknown[] = []
    channel.port2.on('message', (message: unknown) => { messages.push(message) })
    channel.port2.start()
    const publisher = hostPublisher(channel.port1)
    const dispose = publishCordisTree(root, publisher, { maxNodes: 100, maxBytes: 64 * 1_024 })
    try {
      publisher.close()
      const published = messages.length
      root.emit('internal/plugin', root.fiber)
      await Promise.resolve()
      expect(messages).toHaveLength(published)
    } finally {
      dispose()
      channel.port1.close()
      channel.port2.close()
      await root.fiber.dispose()
    }
  })

  it('stops Cordis observation once the publisher closes', async () => {
    const root = new Context()
    const setState = vi.fn()
    let closed = false
    const publisher: InspectorStatePublisher = {
      publish: vi.fn(),
      isClosed: () => closed,
      setState,
    }
    const dispose = publishCordisTree(root, publisher, { maxNodes: 100, maxBytes: 64 * 1_024 })
    try {
      expect(setState).toHaveBeenCalledTimes(1)
      closed = true
      root.emit('internal/plugin', root.fiber)
      await Promise.resolve()
      expect(setState).toHaveBeenCalledTimes(1)
      root.emit('internal/plugin', root.fiber)
      await Promise.resolve()
      expect(setState).toHaveBeenCalledTimes(1)
    } finally {
      dispose()
      await root.fiber.dispose()
    }
  })

  it('accepts a state publication on a closed Host source', async () => {
    const channel = new MessageChannel()
    const source = new HostInspectorSource(channel.port1, {
      label: 'Host',
      topics: ['*'],
      maxQueuedRecords: 2,
      maxQueuedBytes: 32_768,
      maxRecordsPerFrame: 8,
      maxFrameBytes: 32_768,
      queryTimeoutMs: 1_000,
    })
    try {
      source.close()
      expect(source.isClosed()).toBe(true)
      expect(() => { source.setState('debug/crash-repro', { closed: true }) }).not.toThrow()
    } finally {
      channel.port1.close()
      channel.port2.close()
    }
  })
})
