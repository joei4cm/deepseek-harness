/** Web opening aggregation over one observation and a shared transforming buffer. */

import type { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { HistoryController } from '../history/controller.ts'
import { addressId, rejectNotFound } from '../history.ts'
import { EventListener, ListenerBuffer } from '../history/listener.ts'
import type { SessionAssistantStreamsListener } from '../history/assistant-stream.ts'
import { history, projections, resolveHistoryRequest, validateObservationAddress } from '../history/controller.ts'
import type { SessionFollowFrame, SessionFollowRequest } from '../types.ts'

/** Combines opening data and consumes transformed listener output from one queue. */
export class WebController {

  /**
   * @param ctx - Host context carrying Session queries and identity projections.
   * @param historyController - passive reading and listener construction.
   * @param promote - background activation requested before an opening snapshot is delivered.
   */
  constructor(
    private readonly ctx: Context,
    private readonly historyController: HistoryController,
    private readonly promote: (observation: SessionObservation) => void,
  ) {}

  /**
   * Open a history snapshot and follow uncovered history and assistant notifications.
   * @param request - Session identity, page budget, assistant output and optional activation (default false).
   * @param signal - cancellation for opening and streaming.
   * @returns an opening snapshot followed by uncovered queued increments.
   */
  async *follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    const sessionId = addressId(request.address)
    const spec = resolveHistoryRequest(request)
    using queue = new ListenerBuffer<SessionFollowFrame>(this.ctx, signal)
    using listener = new EventListener(this.ctx, sessionId, signal, queue)
    const streams = this.historyController.streamsListener
    using assistantListener = request.assistantStream === true
      ? streams.bind(sessionId, signal, queue)
      : undefined
    // The observation lease closes in `opening`, one scope above the first
    // yield: a `using` record would otherwise pin the disposed observation —
    // and the full event history behind it — in this generator's resource
    // stack for the life of the follow stream.
    const opening = await this.opening(request, sessionId, spec, listener, assistantListener, signal)
    yield opening
    yield* queue.items()
  }

  /**
   * Build the opening snapshot inside one observation lease that closes with
   * this call. Increments come from the queue, so the opening ends this lease
   * in every branch; activation continues on its own retained lease. Promotion
   * starts before the opening is delivered, so a consumer that stops after the
   * snapshot still gets the activation it asked for.
   * @param request - external follow request, for address errors and activation.
   * @param sessionId - resolved Session identity the observation reads.
   * @param spec - validated history window from {@link resolveHistoryRequest}.
   * @param listener - stream listener whose cursor cuts buffered history at the snapshot.
   * @param assistantListener - bound assistant stream listener, when requested.
   * @param signal - cancellation for the observation read and promotion.
   * @returns the snapshot frame the generator yields first.
   */
  private async opening(
    request: SessionFollowRequest,
    sessionId: SessionId,
    spec: ReturnType<typeof resolveHistoryRequest>,
    listener: EventListener,
    assistantListener: ReturnType<SessionAssistantStreamsListener['bind']> | undefined,
    signal: AbortSignal,
  ): Promise<SessionFollowFrame> {
    using observation = await this.historyController.usingObservation({ sessionId, projection: true }, signal)
      .catch((error: unknown) => {
        if (remoteErrorOf(error)?.code === 'session/not-found') rejectNotFound(request.address)
        throw error
      })
    validateObservationAddress(request.address, observation)
    let opening: SessionFollowFrame = {
      type: 'snapshot',
      header: { ...observation.header },
      projections: projections(observation),
      ...history(observation, spec),
    }
    listener.setCursor(opening.cursor)
    if (assistantListener !== undefined) {
      const { baseline: assistantStream, ordinal } = assistantListener.snapshot()
      opening = { ...opening, assistantStream }
      assistantListener.setOrdinalCut(ordinal)
    }
    if (request.activate === true && !signal.aborted
      && observation.header.origin !== 'subagent' && observation.source === 'prepared') {
      const promotion = observation.retain()
      observation[Symbol.dispose]()
      try {
        this.promote(promotion)
      } catch (error: unknown) {
        promotion[Symbol.dispose]()
        throw error
      }
    } else {
      observation[Symbol.dispose]()
    }
    return opening
  }
}
