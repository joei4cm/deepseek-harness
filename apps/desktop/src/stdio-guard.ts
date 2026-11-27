/** Main-process stdio guard: a detached console pipe must not crash the app. */

const GUARD_MARKER = 'dsh.desktop.stdioGuard'

// Node emits stream `error` events asynchronously, outside any `try`/`catch`
// around `console.*`. When the process's stdout or stderr is a pipe whose
// reader has gone away (for example a launcher that exited while the app keeps
// logging), every later console write raises `EPIPE` as an uncaught exception,
// which Electron surfaces as its blocking error dialog. With the pipe gone no
// consumer remains for the output, so the failure is dropped. The marker keeps
// the attachment idempotent across module re-evaluation in tests.
for (const stream of [process.stdout, process.stderr]) {
  const marked = stream as NodeJS.WriteStream & { [GUARD_MARKER]?: true }
  if (marked[GUARD_MARKER] === true) continue
  Object.defineProperty(stream, GUARD_MARKER, { value: true })
  stream.on('error', () => {})
}

export {}
