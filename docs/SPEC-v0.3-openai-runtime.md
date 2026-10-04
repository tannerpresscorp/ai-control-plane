# Spec: AI Control Plane v0.3 OpenAI Agent Runtime

## Objective

Connect the deterministic control-plane core to OpenAI agent execution without transferring approval authority to an LLM.

The runtime exposes three bounded roles:

- **Architect** — converts a request into an objective, non-empty acceptance criteria, and requested capabilities.
- **Builder** — performs or reports bounded implementation work.
- **Verifier** — supplies advisory observations over recorded evidence.

The deterministic core remains authoritative for lifecycle transitions and approval.

## Adapter boundary

The control plane depends on a narrow `StructuredAgentExecutor` port rather than re-declaring OpenAI SDK classes.

```ts
interface StructuredAgentExecutor {
  run(definition: StructuredAgentDefinition, input: string): Promise<unknown>;
}
```

The provider adapter (`OpenAIAgentsSdkBoundary`) owns the real `@openai/agents` `Agent` and `Runner` objects internally. This keeps the domain layer independent from SDK class shape while allowing the provider adapter to translate:

```text
StructuredAgentDefinition -> OpenAI Agent -> Runner.run(agent, input) -> finalOutput
```

Raw JSON Schema output remains locally validated before becoming a domain type.

## Governance rules

1. Acceptance criteria are validated again at the governed cycle boundary; no runtime implementation can persist an empty criteria set.
2. Builder retries may reuse an already-`building` run instead of attempting an illegal self-transition.
3. Verifier output is advisory. Verifier failure is recorded but does not suppress deterministic evidence evaluation.
4. Advisory verification receives evidence for the current build attempt.
5. After advisory verification, the cycle reloads the run record **before** reloading evidence.
6. Approval/retry is computed from that refreshed run revision and fresh evidence.
7. Every evidence append increments run revision, so an append racing the final state update makes that update fail optimistic concurrency rather than commit a stale decision.
8. Missing or failing evidence returns the run to `building` even when the Verifier narrative claims readiness.
9. Passing evidence may approve even if the advisory Verifier is unavailable.

## Testing

- Drive the OpenAI boundary through a production-shaped executor fake rather than a mock-specific SDK imitation.
- Reject malformed structured output locally.
- Reject plans with empty acceptance criteria at the governance boundary.
- Retry the Builder after verification failure and after Builder transport failure.
- Append new failing evidence during advisory verification and prove both run revision and evidence are refreshed before retry.
- Cover both passing and missing evidence when the advisory Verifier rejects.

## Current OpenAI references

- https://openai.github.io/openai-agents-js/
- https://openai.github.io/openai-agents-js/guides/running-agents/
- https://openai.github.io/openai-agents-js/guides/results/
- https://openai.github.io/openai-agents-js/guides/schemas/

## Provider boundary

`OpenAIAgentsExecutor` implements `StructuredAgentExecutor` by delegating to an
injected `OpenAIAgentsBoundary` that models the SDK translation:

```text
StructuredAgentDefinition -> OpenAIAgentsBoundary.createAgent -> run(agent, input) -> finalOutput
```

This is a normalized application boundary, **not** a live `@openai/agents`
integration or a claim of SDK compatibility. There are no credentials, network
calls, or new dependencies in this slice. The executor only forwards the
boundary's `finalOutput`; the raw JSON Schema output is still locally validated
by the runtime before becoming a domain type.

## Installed SDK boundary

`OpenAIAgentsSdkBoundary` (`src/providers/openai-agents-sdk-boundary.ts`) binds
`OpenAIAgentsBoundary` to the exactly pinned `@openai/agents` package
(`0.18.0`). It is a server-side module:

- `createAgent` builds an SDK `Agent` with `name`, `instructions`, an optional
  `model` (the SDK default applies when omitted), and a defensive copy of the
  strict JSON Schema `outputType`. No tools or handoffs are attached.
- `run` only accepts agent handles it created, calls an injected SDK `Runner`
  (default `new Runner()`), and returns the normalized `{ finalOutput }` shape.
  A run without a final output is rejected. SDK `Agent`/`RunResult` objects are
  not exposed through application contracts; the agent handle is `unknown`.
- `finalOutput` remains advisory raw output. `OpenAIAgentsRuntime` still
  validates it locally, and the governed cycle still approves only through
  `RunLedger.approve` over ledger evidence.

`tests/openai-agents-sdk-boundary.test.mjs` is the installed-SDK contract test.
It drives the real SDK `Agent` and `Runner` with a fake SDK `ModelProvider`/
`Model` and tracing disabled, so it needs no API key or network access. It
proves the agent fields and output schema reach the model request, that
`finalOutput` maps into the normalized shape, and that SDK output violating the
domain contract is still rejected by local validation.

## Deployment concern

Live credentialed execution is a separate deployment concern. Production
callers must construct the boundary on the server, supply `OPENAI_API_KEY` (or
a configured SDK `Runner`/model provider) from server-side configuration, and
decide on SDK tracing settings. API keys must never be committed or sent to
browser code.
