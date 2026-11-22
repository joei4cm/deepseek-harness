# Agent Note: Subagent model advice

Status: implemented

English | [中文](2026-11-23-subagent-model-advice.zh.md)

## Problem

A Host setting already lists the child LLM routes a delegation may use, and a model can pick one per call when the tool exposes route fields. Neither expresses a rule such as "run the checks on one model and complex work on another": the allowlist says which routes are permitted, not which task should use which route, and a call that names no route keeps the parent's route. Users who want those rules had to remind the model each time, or let a routing plugin bypass the native `subagent` and `subagent_fork` tools and spend its own model-facing entry point on the choice.

## Decision

`@deepseek-ai/dsh-subagent` declares `subagent/model-advice`, a waterfall that a delegation consumer dispatches before creating a child whose route nothing else fixed. `@deepseek-ai/dsh-tool-subagent` is the shipped dispatcher. It consults the chain only when its `modelAdvice` option is enabled and none of the tool call, the tool's `agentOptions`, and the backend's `agentRouteDefaults` names a route; the request carries the delegating Agent, tool name, backend provider, label, prompt, optional preset, and call signal so a plugin can map a task to a model without reading the session itself.

Advisors run outermost-first, and the first suggestion wins: a listener returns `{ provider, model }`, or calls `next()` to leave the decision to the remaining advisors. A chain with no listener, or one whose listeners all defer, leaves the configured default route unchanged.

A suggestion is never an authorization. The tool checks it with the same setting that governs explicit child model selection (`allowedRoutes()`), refuses a disallowed route with `MODEL_ROUTE_NOT_ALLOWED`, and then runs the same live-adapter preflight as any other resolved route. Advice that reproduces the default delegation route is accepted without an allowance, because ordinary delegation already runs the child there. So an advisor chooses only among routes the user already allowed, and a routing plugin mounted without a matching setting fails loudly instead of silently changing nothing.

`modelAdvice` is separate from `modelSelection`, which controls whether the model sees route fields. A fork tool can take routing advice while keeping its schema unchanged and its child seeded with the conversation prefix; a changed route still forfeits provider-side prefix reuse, which the existing fork limitation already states. An advised route change drops the parent's inherited reasoning effort, because the child-options merge treats it exactly like an explicit route.

## Alternatives considered

### Why not extend `modelSelection`?

Reusing `modelSelection` as the advice switch would tie plugin routing to a model-facing schema change, and shipped fork tools disable `modelSelection` to protect inherited-prefix reuse. Advice needed to reach `subagent_fork` without exposing route fields, so it got its own option.

### Why not a service registry?

A service with `register(advisor)` would have had exactly one consumer (`dsh-tool-subagent`) and one internal caller, which the package rules steer away from, and it would have needed a new package to own the registration surface or a second plugin entry point on an existing one. The waterfall gives plugins the same effect with no new service, no composition change, and the repository's documented override semantics.

### Why not let advice bypass the allowlist, or apply it inside `startActivation`?

The Discussion asks DSH to decide whether a suggested model may be used. Applying advice in the runtime would let every caller, including ones with no model-selection policy, be routed by a plugin, and validating there would move LLM knowledge into the transport seam. Keeping the dispatch in the delegation tool keeps the check next to the authorization it reuses.

### Why not have the model name the route every time?

That is the state the Discussion reports, and it fails for users who want a rule applied without rewriting their delegation habit on every call.

## Consequences

- Routing rules live in a plugin, apply to every ordinary `subagent` and `subagent_fork` call, and stay bounded by the Host setting.
- The route is visible in the child's own request header, so the log already reconstructs which model ran; no new session event was added.
- A routing plugin that suggests an unauthorized route now fails the delegation with `MODEL_ROUTE_NOT_ALLOWED` rather than being ignored, so a stale rule surfaces on the next call.
- `modelAdvice` adds no model-facing schema; only the wording of the omitted-field route changes on instances that enable it, because "your current model" would otherwise be false.
- Callers that do not enable `modelAdvice` (every other delegation surface today) never dispatch the chain and behave exactly as before.

## Testing

`packages/subagent/tool-subagent/tests/model-advice.spec.ts` covers the advised route, the unadvised default, explicit-selection precedence, configured-route precedence, outermost-first arbitration, `next()` delegation, `MODEL_ROUTE_NOT_ALLOWED` for a disallowed suggestion, the parent-route limit while the Host setting is disabled, reasoning-effort inheritance when advice repeats the parent route, the fork tool keeping its inheritance and schema, and the load failure for a provider without `agentOptions` support.
