/** Subscribe one Tail seat to a Turn's keyed record data. */
import { useSyncExternalStore } from 'react'
import type {
  ConversationLocationDataSource, ConversationLocationDataStore, ConversationTurnDataMap,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Subscribe to one value from a Turn's keyed Location-data store. A record can
 * settle after the Turn closed, when its tail Node is already built, so the
 * seat reads the store through this hook instead of once per render.
 * @param data - the Turn's data store.
 * @param key - declaration-merged business key.
 * @returns the current value for that key.
 */
export function useTurnDataValue<Key extends Extract<keyof ConversationTurnDataMap, string>>(
  data: ConversationLocationDataStore<ConversationTurnDataMap>,
  key: Key,
): Readonly<ConversationTurnDataMap[Key]> | undefined {
  const source: ConversationLocationDataSource<Readonly<ConversationTurnDataMap[Key]> | undefined> = data.source(key)
  return useSyncExternalStore(source.subscribe, source.getSnapshot)
}
