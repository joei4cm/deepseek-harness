/** Follow rebuild cadence for assistant rebaseline bursts. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REBASELINE_WINDOW_MS, RebaselineCoalescer } from '../src/client/rebaseline-coalescer.ts'

describe('RebaselineCoalescer', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('rebuilds the first rebaseline at once and absorbs the rest of its window', () => {
    const rebuild = vi.fn()
    const coalescer = new RebaselineCoalescer(rebuild)

    coalescer.request()
    expect(rebuild).toHaveBeenCalledTimes(1)
    for (let frame = 0; frame < 50; frame++) coalescer.request()
    vi.advanceTimersByTime(REBASELINE_WINDOW_MS - 1)
    expect(rebuild).toHaveBeenCalledTimes(1)

    coalescer.dispose()
  })

  it('closes a resolved window without another rebuild and rebuilds the next burst at once', () => {
    const rebuild = vi.fn()
    const coalescer = new RebaselineCoalescer(rebuild)

    coalescer.request()
    coalescer.request()
    coalescer.resolve()
    vi.advanceTimersByTime(REBASELINE_WINDOW_MS)
    expect(rebuild).toHaveBeenCalledTimes(1)

    coalescer.request()
    expect(rebuild).toHaveBeenCalledTimes(2)
    coalescer.dispose()
  })

  it('rebuilds an unresolved burst when its window closes, once per window', () => {
    const rebuild = vi.fn()
    const coalescer = new RebaselineCoalescer(rebuild)

    coalescer.request()
    coalescer.resolve()
    // A rebaseline after the fresh baseline is not covered by the first rebuild.
    coalescer.request()
    vi.advanceTimersByTime(REBASELINE_WINDOW_MS)
    expect(rebuild).toHaveBeenCalledTimes(2)

    // A storm that no baseline resolves costs one rebuild per window.
    for (let window = 0; window < 4; window++) {
      coalescer.request()
      vi.advanceTimersByTime(REBASELINE_WINDOW_MS)
    }
    expect(rebuild).toHaveBeenCalledTimes(6)

    coalescer.resolve()
    vi.advanceTimersByTime(REBASELINE_WINDOW_MS * 4)
    expect(rebuild).toHaveBeenCalledTimes(6)
    coalescer.dispose()
  })

  it('drops the pending rebuild and its timer on disposal', () => {
    const rebuild = vi.fn()
    const coalescer = new RebaselineCoalescer(rebuild)

    coalescer.request()
    coalescer.request()
    coalescer.dispose()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(REBASELINE_WINDOW_MS * 2)
    expect(rebuild).toHaveBeenCalledTimes(1)

    // Disposal without an open window is a no-op, and the coalescer remains usable.
    coalescer.dispose()
    coalescer.request()
    expect(rebuild).toHaveBeenCalledTimes(2)
    coalescer.dispose()
  })
})
