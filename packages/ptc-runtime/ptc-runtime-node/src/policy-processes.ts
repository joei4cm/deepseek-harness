/** Node PTC process invalidation after a committed Session file-policy or workspace-root change. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-working-directory'

interface Process {
  sessionId: SessionId
  mode: SandboxMode
  workspaceRoot: string
  release: () => Promise<void>
  invalidated: boolean
  /** Retirement came from a workspace-root move rather than a mode change. */
  rootRetired: boolean
  /** Shared idempotent cleanup promise; cleared again when cleanup fails. */
  cleanup?: Promise<void>
  /** Retirement already started by an invalidation; admission waits for it. */
  retire?: Promise<void>
  /**
   * Retained-process coordination: resolves after the current evaluation settles. Registrations
   * without it are per-call admissions, which a workspace-root move must not cancel.
   */
  settled?: () => Promise<void>
}

/** Owns asynchronous process cleanup without delaying permission setters. */
export class PolicyProcesses {
  private readonly processes = new Set<Process>()

  /**
   * Begin cleanup on policy and workspace-root changes, even when no subsequent program runs.
   * @param ctx - Node provider lifecycle and Session services.
   */
  constructor(private readonly ctx: Context) {
    ctx.on('session/event', (session, event) => {
      if (event.type === 'sandbox/mode') {
        for (const process of this.processes) {
          if (process.sessionId !== session.id || process.mode === event.data.mode) continue
          this.retireNow(process)
        }
        return
      }
      if (event.type === 'workspace-root/change') {
        for (const process of this.processes) {
          const { settled } = process
          // A retained process keeps its launch-time directory grants; retiring it after the moving
          // evaluation settles keeps that evaluation's own result and frees the next admission to
          // start under the new root.
          if (settled === undefined || process.sessionId !== session.id || process.workspaceRoot === event.data.cwd) continue
          this.retireAfterSettlement(process, settled)
        }
      }
    }, { global: true })
    ctx.effect(() => async () => {
      await this.settle([...this.processes])
    }, 'Node PTC policy cleanup')
  }

  /**
   * Track an admitted call or retained process until its owner confirms cleanup.
   * @param policy - Resolved process policy, including an optional Session identity.
   * @param release - Idempotent cancellation and awaited cleanup.
   * @param settled - Retained-process idle coordination; omit for per-call admissions.
   * @returns Removal after successful process cleanup.
   */
  register(policy: SandboxExecutionPolicy, release: () => Promise<void>, settled?: () => Promise<void>): () => void {
    if (policy.sessionId === undefined) return () => {}
    const session = this.ctx.get('sessions')?.get(policy.sessionId)
    const process: Process = {
      sessionId: policy.sessionId,
      mode: session === undefined ? policy.mode : this.ctx.sandboxPolicy.resolve({ session }).mode,
      workspaceRoot: policy.workspaceRoot,
      release,
      invalidated: false,
      rootRetired: false,
      ...settled === undefined ? {} : { settled },
    }
    this.processes.add(process)
    return () => { this.processes.delete(process) }
  }

  /**
   * Wait for invalidated processes before admitting another program. A root move that starts while
   * an earlier root retirement is pending is awaited too, so the admitted program always starts
   * under the session's settled directory. A mode invalidation that starts during this admission is
   * not awaited: it can be this admission's own cancellation, whose release awaits the admission.
   * @param sessionId - Session carried by the resolved policy.
   * @returns Completion after prior cleanup; a failure rejects and remains retryable.
   */
  async wait(sessionId: SessionId | undefined): Promise<void> {
    if (sessionId === undefined) return
    for (;;) {
      const pending = [...this.processes].filter(process => process.sessionId === sessionId && process.invalidated)
      if (pending.length === 0) return
      await this.settle(pending)
      if (![...this.processes].some(process => process.sessionId === sessionId && process.invalidated && process.rootRetired)) return
    }
  }

  /** Release at once: mode changes cancel active evaluations as well as pending admissions. */
  private retireNow(process: Process): void {
    process.invalidated = true
    const immediate = this.release(process)
    void immediate.catch((error: unknown) => { this.ctx.logger.warn(error) })
    if (process.retire === undefined) process.retire = immediate
  }

  /** Release after the current evaluation settles; the program that moved the root completes first. */
  private retireAfterSettlement(process: Process, settled: () => Promise<void>): void {
    process.invalidated = true
    process.rootRetired = true
    if (process.retire !== undefined) return
    const retiring = settled().then(() => this.release(process))
    void retiring.catch((error: unknown) => { this.ctx.logger.warn(error) })
    process.retire = retiring
  }

  private release(process: Process): Promise<void> {
    if (process.cleanup !== undefined) return process.cleanup
    process.cleanup = process.release().then(() => { this.processes.delete(process) }, (error: unknown) => {
      delete process.cleanup
      delete process.retire
      throw error
    })
    return process.cleanup
  }

  private async settle(processes: Process[]): Promise<void> {
    const results = await Promise.allSettled(processes.map(process => process.retire ?? this.release(process)))
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }
}
