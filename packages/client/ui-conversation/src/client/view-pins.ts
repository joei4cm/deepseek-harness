/** Host-backed pin choices for the Conversation View tabs. */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConversationSettings } from '../submission-settings.ts'

/** View whose tab always shows and never enters the customization list. */
export const FIXED_VIEW_ID = 'chat'

/** Settings field carrying the unpinned View id list. */
const UNPINNED_VIEWS_FIELD = 'unpinnedViews'

const NO_VIEWS: readonly string[] = []

/** Unpinned View ids and their only mutation. */
export interface ViewPins {
  /** Unpinned View ids; ids of Views that are not registered stay listed. */
  readonly unpinned: ObservableSnapshot<readonly string[]>
  /**
   * Pin or unpin one View tab; the fixed View is ignored. A pinned tab still
   * enters More when the header's width budget cannot hold it.
   * @param id - View id.
   * @param pinned - Whether the tab is manually pinned.
   */
  readonly setPinned: (id: string, pinned: boolean) => void
  /** Release the Host settings subscription and abandon in-flight settlement. */
  readonly dispose: () => void
}

/** One queued pin write and the list it publishes on acceptance. */
interface PinWrite {
  readonly list: readonly string[]
}

/**
 * Create the shared View pin list backed by the Host settings form. The
 * published list stays optimistic while a write is in flight, so a Host value
 * that predates that write does not replace the user's choice. A refused or
 * failed write restores the last accepted list and reports the failure.
 * @param host - Shared conversation settings form.
 * @returns Unpinned View ids, the pin mutation, and its disposer.
 */
export function createViewPins(host: ConfigForm<ConversationSettings>): ViewPins {
  const store = createSnapshotStore<{ readonly unpinned: readonly string[] }>({ unpinned: NO_VIEWS })
  /** Latest list the Host accepted; empty before the first section arrives. */
  let confirmed: readonly string[] = NO_VIEWS
  /** Writes still in flight, oldest first; the newest owns the published list. */
  const flight: PinWrite[] = []
  /** Choices made before the first Host section arrived. */
  const pending = new Map<string, boolean>()
  let disposed = false

  const sameList = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((id, index) => id === right[index])
  const publish = (next: readonly string[]): void => {
    if (sameList(store.getSnapshot().unpinned, next)) return
    store.set({ unpinned: next })
  }
  const report = (reason: string, cause?: unknown): void => {
    const message = `[ui-conversation] view pin write ${reason}; the last accepted pin list is restored`
    if (cause === undefined) console.error(message)
    else console.error(message, cause)
  }

  /** Settle one write: acceptance advances the accepted list, failure restores it. */
  const settle = (token: PinWrite, accepted: boolean, cause?: unknown): void => {
    if (disposed) return
    const index = flight.indexOf(token)
    if (index >= 0) flight.splice(index, 1)
    if (accepted) {
      confirmed = token.list
      return
    }
    // A newer write still owns the published list; its own settlement restores.
    if (flight.length > 0) return
    publish(confirmed)
    report(cause === undefined ? 'was refused' : 'failed', cause)
  }

  /** Queue one durable write, keeping the optimistic list until it settles. */
  const write = (next: readonly string[]): void => {
    const token: PinWrite = { list: next }
    flight.push(token)
    void Promise.resolve(host.set(UNPINNED_VIEWS_FIELD, next)).then(
      (accepted) => { settle(token, accepted) },
      (error: unknown) => { settle(token, false, error) },
    )
  }

  const adopt = (): void => {
    const value = host.getSnapshot().value
    if (value === undefined) return
    const hostList = value.unpinnedViews.filter(id => id !== FIXED_VIEW_ID)
    confirmed = hostList
    const expected = flight.at(-1)?.list
    if (expected !== undefined && !sameList(hostList, expected)) return
    let next = hostList
    for (const [id, pinned] of pending) {
      next = pinned ? next.filter(entry => entry !== id) : next.includes(id) ? next : [...next, id]
    }
    const buffered = pending.size > 0
    pending.clear()
    if (buffered && !sameList(next, hostList)) write(next)
    publish(next)
  }

  const dispose = (): void => {
    disposed = true
    flight.length = 0
    pending.clear()
    unsubscribe()
  }
  const unsubscribe = host.subscribe(adopt)
  adopt()

  return {
    unpinned: { getSnapshot: () => store.getSnapshot().unpinned, subscribe: listener => store.subscribe(listener) },
    setPinned: (id, pinned) => {
      const current = store.getSnapshot().unpinned
      if (id === FIXED_VIEW_ID || pinned !== current.includes(id)) return
      const next = pinned ? current.filter(entry => entry !== id) : [...current, id]
      publish(next)
      if (host.getSnapshot().value === undefined) pending.set(id, pinned)
      else write(next)
    },
    dispose,
  }
}
