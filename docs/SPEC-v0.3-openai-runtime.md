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

A later provider adapter will own the real `@openai/agents` `Agent` and `Runner` objects internally. This keeps the domain layer independent from SDK class shape while allowing the provider adapter to translate:

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

## Deferred integration

Pinning and importing `@openai/agents` is a separate provider-adapter slice. That slice must include a compile-time/runtime contract test against the installed SDK before it can be used in production.
