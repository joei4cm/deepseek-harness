/** Request metadata exposed to pi-ai transport-header contributors. */

import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

/** Model-hidden routing metadata from the exact prepared adapter call. */
export interface PiAiRequestHeaderContext extends Readonly<Pick<GenerateOptions<string>,
  'provider' | 'model' | 'sessionId' | 'purpose'>> {
  /** Resolved endpoint of the model selected for this call. */
  readonly baseURL: string
}

/** The endpoint and protocol a model-listing interrogation is about to ask. */
export interface PiAiDiscoveryHeaderContext {
  /** Configured provider route the draft names, or absent for a new route. */
  readonly provider?: string
  /** Endpoint the interrogation is directed at. */
  readonly baseURL: string
  /** Wire protocol the listing request will speak. */
  readonly api: string
}
