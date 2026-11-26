/** Client behavior of a closed Inspector source. */

import { describe, expect, it } from 'vitest'
import { ClientBridgePublisher } from '../src/client/bridge/publisher.ts'

describe('Inspector closed Client source', () => {
  it('drops publications that arrive after the source closed', () => {
    const publisher = new ClientBridgePublisher({
      topics: ['*'],
      maxQueuedRecords: 2,
      maxQueuedBytes: 32_768,
      maxRecordsPerFrame: 8,
      maxFrameBytes: 32_768,
    }, 32_768)
    publisher.close()
    expect(publisher.isClosed()).toBe(true)
    expect(() => { publisher.setState('state/closed', { closed: true }) }).not.toThrow()
    expect(() => { publisher.publish('event/closed', { closed: true }) }).not.toThrow()
  })
})
