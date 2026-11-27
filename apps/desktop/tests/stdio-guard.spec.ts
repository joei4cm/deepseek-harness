import { expect, it, vi } from 'vitest'
import '../src/stdio-guard.ts'

it('absorbs stdout and stderr error events instead of raising them as uncaught exceptions', () => {
  const stdoutErrors = process.stdout.listenerCount('error')
  const stderrErrors = process.stderr.listenerCount('error')
  expect(stdoutErrors).toBeGreaterThan(0)
  expect(stderrErrors).toBeGreaterThan(0)
  expect(() => {
    process.stdout.emit('error', new Error('EPIPE: broken pipe, write'))
    process.stderr.emit('error', new Error('EPIPE: broken pipe, write'))
  }).not.toThrow()
})

it('attaches at most one guard listener per stream across module re-evaluation', async () => {
  const stdoutErrors = process.stdout.listenerCount('error')
  const stderrErrors = process.stderr.listenerCount('error')
  vi.resetModules()
  await import('../src/stdio-guard.ts')
  expect(process.stdout.listenerCount('error')).toBe(stdoutErrors)
  expect(process.stderr.listenerCount('error')).toBe(stderrErrors)
})
