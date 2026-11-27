/** Initial execution environment supplied by the module system's startup carrier. */
import type { ScriptRealm } from '@deepseek-ai/dsh-client-script-realm/client'

/** A script executed but raised a window error while its element loaded. */
export class ScriptExecutionError extends Error {
  constructor(url: string, messages: readonly string[]) {
    super(`client-modules: bundle script ${url} raised an execution error: ${messages.join('; ')}`)
    this.name = 'ScriptExecutionError'
  }
}

/** Existing browser transport used when the carrier supplies no load hook. */
const loadPageBundle = (url: string): Promise<void> => new Promise((resolve, reject) => {
  const el = document.createElement('script')
  el.async = true
  el.src = url
  const scriptUrl = el.src
  const view = el.ownerDocument.defaultView
  const scriptErrors: string[] = []
  const onWindowError = (event: ErrorEvent): void => {
    if (event.filename === scriptUrl) scriptErrors.push(event.message.trim() || 'uncaught error without a message')
  }
  const cleanup = (): void => {
    view?.removeEventListener('error', onWindowError)
    el.remove()
  }
  view?.addEventListener('error', onWindowError)
  el.addEventListener('load', () => {
    cleanup()
    if (scriptErrors.length > 0) reject(new ScriptExecutionError(url, scriptErrors))
    else resolve()
  }, { once: true })
  el.addEventListener('error', () => {
    cleanup()
    reject(new Error(`client-modules: bundle script ${url} failed to load`))
  }, { once: true })
  document.head.append(el)
})

/** Owns execution requests without assuming the carrier has a browser document. */
export class MainScriptRealm implements Pick<ScriptRealm, 'id' | 'execute' | 'dispose'> {
  readonly id = 'main' as ScriptRealm['id']
  private readonly pending = new Set<Promise<void>>()
  private closed = false
  private disposal: Promise<void> | undefined

  /** @param loadBundle - Carrier execution hook; absent selects the existing page transport. */
  constructor(private readonly loadBundle: (url: string) => Promise<void> = loadPageBundle) {}

  /** @param script - Script requested by Modules. @returns The carrier's execution completion. */
  execute(script: Parameters<ScriptRealm['execute']>[0]): Promise<void> {
    if (this.closed) return Promise.reject(new Error('client-modules: Main Realm is disposed'))
    const task = this.loadBundle(script.url)
    this.pending.add(task)
    void task.then(() => { this.pending.delete(task) }, () => { this.pending.delete(task) })
    return task
  }

  /** Stop accepting requests and await existing carrier operations without cancelling them. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.closed = true
    this.disposal = Promise.allSettled([...this.pending]).then(() => {})
    return this.disposal
  }
}
