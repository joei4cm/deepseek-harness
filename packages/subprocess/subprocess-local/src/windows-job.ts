/** Windows parent-side launch and ownership for the private Job runner. */

import { controlPipe } from './control-spawn.ts'
import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { devNull } from 'node:os'
import type { Readable, Writable } from 'node:stream'
import { SubprocessError } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  loadWin32ProcessBindings,
  probeCurrentTokenJobSupport,
} from '@deepseek-ai/dsh-win32-process'
import type { BoundProcessOwner, ManagedProcessLaunch } from './managed-owner.ts'
import {
  type SerializedRunnerError,
  type WindowsRunnerResult,
  deserializeRunnerError,
  parseWindowsRunnerResult,
} from './runner-protocol.ts'
import {
  runnerEnvironment,
  runnerInvocationAvailable,
  runnerStdio,
  spawnRunnerInvocation,
  WINDOWS_RUNNER_SELECTION,
} from './runner-launch.ts'
import type { RunnerInvocation } from './runner-launch.ts'

/** Classify a failure on the private runner channel, keeping an already coded failure. */
function runnerIpcFailure(error: unknown): SubprocessError {
  if (error instanceof SubprocessError) return error
  return new SubprocessError(
    `subprocess-local: Windows runner IPC failed: ${String(error)}`,
    'SUBPROCESS_RUNNER_IPC_FAILED',
    { cause: error },
  )
}

/** Bytes of the runner's own stderr kept for failure diagnostics. */
const RUNNER_STDERR_TAIL_BYTES = 4096

/** Text decoder for the captured runner stderr tail. */
const runnerStderrDecoder = new TextDecoder('utf-8')

/**
 * Decode the bounded runner stderr tail for the failure message. Bytes are
 * only kept whole at the end, so an invalid sequence can only sit at the
 * start: a lead byte truncated by the cap leaves trailing continuation bytes,
 * which decode as replacement characters and are dropped here.
 *
 * @param tail - the last captured bytes of the runner's stderr, or `undefined`
 *   when nothing was written.
 * @returns the trimmed decoded tail.
 */
function decodeRunnerStderrTail(tail: Buffer | undefined): string {
  if (tail === undefined) return ''
  return runnerStderrDecoder.decode(tail).replace(/^�+/, '').trim()
}

/**
 * The runner stderr suffix for a failure message, or `''` when the tail
 * decodes to nothing.
 *
 * @param tail - the captured runner stderr tail.
 * @returns the message suffix, including its leading separator.
 */
function runnerStderrSuffix(tail: Buffer | undefined): string {
  const text = decodeRunnerStderrTail(tail)
  return text === '' ? '' : `; runner stderr: ${text}`
}

/**
 * Format a runner exit code as its unsigned 32-bit decimal and hexadecimal
 * values, so a Windows status code reads without conversion.
 *
 * @param exitCode - the exit code reported by the runner process.
 * @returns the decimal value followed by the zero-padded hex form.
 */
function formatRunnerExitCode(exitCode: number): string {
  const unsigned = exitCode >>> 0
  return `${String(unsigned)} (0x${unsigned.toString(16).toUpperCase().padStart(8, '0')})`
}

/** Test seams for runner launch and dynamic capability checks. */
export interface WindowsJobInternals {
  spawn?: typeof spawn
  runnerInvocation?: RunnerInvocation
  resolveRunnerInvocation?: () => RunnerInvocation
  runnerAvailable?: (invocation: RunnerInvocation) => boolean
  loadWin32ProcessBindings?: typeof loadWin32ProcessBindings
  probeCurrentTokenJobSupport?: typeof probeCurrentTokenJobSupport
}

type RunnerProcess = Omit<ReturnType<typeof spawn>, 'send' | 'stdio'> & {
  send?: ReturnType<typeof spawn>['send']
  stdio: Array<Readable | Writable | null>
}

function isWindowsStartCancellationError(error: SerializedRunnerError): boolean {
  return error.name === 'Error'
    && error.message === 'subprocess target start was cancelled'
    && error.code === undefined
    && error.syscall === undefined
    && error.path === undefined
}

/**
 * Re-check the runner entry, bindings, and current Job capability for every spawn.
 * @param internals - optional runner and Win32 capability seams used by tests.
 * @returns whether the Windows native containment path is currently available.
 */
export function probeWindowsJob(internals: WindowsJobInternals = {}): boolean {
  try {
    const invocation = internals.runnerInvocation
      ?? (internals.resolveRunnerInvocation ?? spawnRunnerInvocation)()
    if (!(internals.runnerAvailable ?? runnerInvocationAvailable)(invocation)) return false
    const api = (internals.loadWin32ProcessBindings ?? loadWin32ProcessBindings)()
    ;(internals.probeCurrentTokenJobSupport ?? probeCurrentTokenJobSupport)(api)
    return true
  } catch {
    return false
  }
}

class WindowsJobOwner implements BoundProcessOwner {
  private cancellationReason: unknown
  private cancellationReasonSet = false
  private terminationSent = false

  constructor(
    private readonly runner: RunnerProcess,
    private readonly exited: Promise<void>,
    private readonly directResultType: () => WindowsRunnerResult['type'] | undefined,
    private readonly failInfrastructure: (error: unknown) => void,
  ) {
    void this.exited.catch(() => {})
  }

  signal(_signal: 'SIGTERM' | 'SIGKILL', cancellationReason?: unknown): void {
    if (!this.cancellationReasonSet) {
      this.cancellationReason = cancellationReason
      this.cancellationReasonSet = true
    }
    if (this.terminationSent || !this.runner.connected) return
    this.terminationSent = true
    try {
      this.runner.send?.({ type: 'terminate' }, (error) => {
        if (error === null || this.directResultType() !== undefined) return
        this.failInfrastructure(error)
        this.terminateForHostExit()
      })
    } catch (error) {
      this.failInfrastructure(error)
      this.terminateForHostExit()
    }
  }

  mapStartFailure(failure: unknown, serialized: SerializedRunnerError): unknown {
    return this.cancellationReasonSet && isWindowsStartCancellationError(serialized)
      ? this.cancellationReason
      : failure
  }

  async waitForExit(): Promise<void> {
    await this.exited
  }

  terminateForHostExit(): void {
    try { this.runner.kill('SIGKILL') } catch (_runnerKillFailed) { /* Host exit continues with other live runners. */ }
  }
}

/**
 * Launch one target through a runner that uniquely owns its Job handle.
 * @param spec - ordinary target request.
 * @param targetEnv - validated complete target environment.
 * @param internals - optional runner launch seams used by tests.
 * @returns direct streams, result, and runner-owned managed range.
 */
export function launchWindowsJob(
  spec: SubprocessSpawnSpec,
  targetEnv: Record<string, string>,
  internals: WindowsJobInternals = {},
): ManagedProcessLaunch {
  const invocation = internals.runnerInvocation ?? spawnRunnerInvocation()
  const [command, ...prefix] = invocation
  const ignoredStdinFd = spec.stdio.stdin === 'ignore' ? openSync(devNull, 'r') : undefined
  let child: RunnerProcess
  try {
    child = (internals.spawn ?? spawn)(command, [
      ...prefix,
      '--',
      ...spec.argv,
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      env: runnerEnvironment(WINDOWS_RUNNER_SELECTION, invocation),
      stdio: runnerStdio(spec, true, ignoredStdinFd ?? 'pipe'),
    }) as RunnerProcess
  } finally {
    if (ignoredStdinFd !== undefined) closeSync(ignoredStdinFd)
  }
  const targetStdin = child.stdio[4] as Writable | null

  // Keep a bounded tail of the runner's own stderr (fd 2; the target's stderr
  // rides fd 6) so a failed runner leaves its Node-level error text in the
  // message. A non-piped fd 2 keeps the previous byte-identical message.
  let runnerStderrTail: Buffer | undefined
  child.stdio[2]?.on('data', (chunk: Buffer) => {
    runnerStderrTail = runnerStderrTail === undefined ? chunk : Buffer.concat([runnerStderrTail, chunk])
    if (runnerStderrTail.length > RUNNER_STDERR_TAIL_BYTES) {
      runnerStderrTail = runnerStderrTail.subarray(runnerStderrTail.length - RUNNER_STDERR_TAIL_BYTES)
    }
  })

  const direct = Promise.withResolvers<SubprocessOutcome>()
  const rangeExit = Promise.withResolvers<void>()
  let directResultType: WindowsRunnerResult['type'] | undefined
  let runnerSpawned = false
  let runnerExit: { exitCode: number | null; signal: NodeJS.Signals | null } | undefined
  let ipcDisconnected = false
  const failInfrastructure = (error: unknown): void => {
    direct.reject(error)
    rangeExit.reject(error)
  }
  const runnerDiagnostic = (): string => runnerStderrSuffix(runnerStderrTail)
  const settleRange = (): void => {
    if (!runnerSpawned || runnerExit === undefined) return
    const { exitCode, signal } = runnerExit
    if (exitCode === 0 && signal === null) {
      if (directResultType !== undefined) {
        rangeExit.resolve()
        return
      }
      // The private IPC result may arrive after the process-exit notification.
      if (!ipcDisconnected) return
    }
    const status = signal !== null
      ? `signal ${signal}`
      : exitCode === null ? 'without an exit status' : `exit code ${formatRunnerExitCode(exitCode)}`
    failInfrastructure(new SubprocessError(
      `subprocess-local: Windows Job runner exited with ${status} before proving its managed range empty${runnerDiagnostic()}`,
      'SUBPROCESS_RUNNER_FAILED',
    ))
  }

  const owner = new WindowsJobOwner(
    child,
    rangeExit.promise,
    () => directResultType,
    failInfrastructure,
  )
  child.on('message', (value: unknown) => {
    if (directResultType !== undefined) {
      const error = new SubprocessError('subprocess-local: Windows runner emitted more than one direct result', 'SUBPROCESS_RUNNER_IPC_FAILED')
      failInfrastructure(error)
      owner.terminateForHostExit()
      return
    }
    let result: ReturnType<typeof parseWindowsRunnerResult>
    try {
      result = parseWindowsRunnerResult(value)
    } catch (error) {
      failInfrastructure(new SubprocessError(
        `subprocess-local: Windows runner emitted a malformed result: ${String(error)}`,
        'SUBPROCESS_RUNNER_IPC_FAILED',
        { cause: error },
      ))
      owner.terminateForHostExit()
      return
    }
    directResultType = result.type
    if (result.type === 'target-exit') {
      direct.resolve({ exitCode: result.exitCode, signal: null })
    } else {
      direct.reject(owner.mapStartFailure(deserializeRunnerError(result.error), result.error))
    }
    settleRange()
  })
  child.once('spawn', () => {
    runnerSpawned = true
    try {
      if (child.send === undefined) {
        throw new SubprocessError('subprocess-local: Windows runner has no IPC channel', 'SUBPROCESS_RUNNER_IPC_FAILED')
      }
      child.send({ type: 'start', cwd: spec.cwd, env: targetEnv, ...spec.stdio.control === undefined ? {} : { control: spec.stdio.control } }, (error) => {
        if (error === null) return
        failInfrastructure(runnerIpcFailure(error))
        owner.terminateForHostExit()
      })
    } catch (error) {
      failInfrastructure(runnerIpcFailure(error))
      owner.terminateForHostExit()
    }
  })
  child.once('error', (error) => {
    if (!runnerSpawned) {
      direct.reject(error)
      rangeExit.resolve()
      return
    }
    failInfrastructure(new SubprocessError(
      `subprocess-local: Windows Job runner failed after it started: ${String(error)}${runnerDiagnostic()}`,
      'SUBPROCESS_RUNNER_FAILED',
      { cause: error },
    ))
  })
  child.once('exit', (exitCode, signal) => {
    runnerExit = { exitCode, signal }
    settleRange()
  })
  child.once('disconnect', () => {
    ipcDisconnected = true
    settleRange()
  })

  return {
    stdin: spec.stdio.stdin === 'ignore' ? null : targetStdin,
    stdout: child.stdio[5] as Readable | null,
    stderr: child.stdio[6] as Readable | null,
    control: controlPipe(child, spec.stdio.control),
    direct: direct.promise,
    owner,
  }
}
