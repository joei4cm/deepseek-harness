/** Lifecycle-driven Cordis tree publication shared by Host and Client plugin faces. */

import { Context } from '@deepseek-ai/cordis'
import type { CordisTreeSnapshot } from './snapshot.ts'
import { CordisTreeCollector, type CordisTreeLimits } from './collector.ts'

/** Receives one complete semantic snapshot after a coalesced Cordis mutation. */
export type CordisTreeSnapshotListener = (snapshot: CordisTreeSnapshot) => void

/**
 * Observe one Cordis realm and publish immutable tree replacements.
 * @param ctx - Plugin context whose root is inspected and whose effects own listeners.
 * @param listener - Consumer of complete snapshots in the inspected realm.
 * @param limits - Snapshot node and encoded-byte limits.
 * @param isActive - Whether the consumer still accepts snapshots; a false value stops observation.
 * @returns A disposer that unregisters listeners and releases retained objects.
 */
export function observeCordisTree(
  ctx: Context,
  listener: CordisTreeSnapshotListener,
  limits: CordisTreeLimits,
  isActive: () => boolean = () => true,
): () => void {
  const collector = new CordisTreeCollector(ctx[Context.root], limits)
  let scheduled = false
  let closed = false
  const dispose = (): void => {
    if (closed) return
    closed = true
    for (const disposeListener of disposers) disposeListener()
    collector.close()
  }
  const publish = (): void => {
    scheduled = false
    if (closed) return
    if (!isActive()) {
      dispose()
      return
    }
    listener(collector.snapshot())
  }
  const schedule = (): void => {
    if (scheduled || closed) return
    scheduled = true
    queueMicrotask(publish)
  }
  const disposers = [
    ctx.on('internal/plugin', schedule, { global: true }),
    ctx.on('internal/status', schedule, { global: true }),
  ]
  publish()
  return dispose
}
