/** Rebuild cadence for a Session follow window after an assistant rebaseline. */

/**
 * Minimum gap between two follow rebuilds caused by one assistant rebaseline burst.
 *
 * A rebaseline storm arrives as one frame per few milliseconds; rebuilding the
 * follow window for each of them replaces the whole conversation window every
 * time. This internal client cadence bounds that cost. It is not deployment
 * configuration.
 */
export const REBASELINE_WINDOW_MS = 250

/**
 * Rebuilds the follow window once per assistant rebaseline burst.
 *
 * The first rebaseline of a burst rebuilds at once; the ones that follow are
 * absorbed until the window closes, so a burst costs one rebuild per window
 * instead of one per frame. A fresh baseline resolves the burst: the window
 * then closes without another rebuild. A burst that no baseline resolved
 * rebuilds again when the window closes, so the fold never waits for a repair
 * that nothing performs.
 */
export class RebaselineCoalescer {
  /** Whether a rebaseline is still waiting for a fresh baseline. */
  private pending = false
  /** The open window's closing timer. */
  private timer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param rebuild - rebuild the Session's current follow window.
   */
  constructor(private readonly rebuild: () => void) {}

  /**
   * Request one rebuild for a rebaseline burst.
   *
   * The open window absorbs the request: its rebuild covers the whole burst.
   */
  request(): void {
    this.pending = true
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => { this.close() }, REBASELINE_WINDOW_MS)
    this.rebuild()
  }

  /**
   * Note that a fresh baseline resolved the burst.
   *
   * The open window stays: a rebaseline that arrives after this baseline is
   * absorbed by it and rebuilt when the window closes.
   */
  resolve(): void {
    this.pending = false
  }

  /** Close the window and drop its pending rebuild. */
  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.pending = false
  }

  /** Close the window; rebuild again when the burst is still unresolved. */
  private close(): void {
    this.timer = undefined
    if (!this.pending) return
    this.pending = false
    this.timer = setTimeout(() => { this.close() }, REBASELINE_WINDOW_MS)
    this.rebuild()
  }
}
