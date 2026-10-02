# Spec: AI Control Plane v0.1 Core

## Objective

Establish a small, deterministic foundation for a governed agent system before adding live model/provider integrations. v0.1 must prove that run lifecycle rules and verification gates can be tested independently of LLM behavior.

## Tech Stack

- Node.js 22+
- TypeScript 5.8.x
- Node built-in test runner
- CircleCI 2.1 configuration
- No runtime dependencies in the core package

OpenAI Agents SDK, Supabase, and external provider SDKs are deliberately deferred to adapters in later slices.

## Commands

```bash
npm install --ignore-scripts
npm run build
npm test
npm run check
```

## Project Structure

```text
src/core/       deterministic lifecycle, capability and verification rules
src/ledger/     persistence port and local in-memory adapter
tests/          behavioral tests against compiled output
docs/           capability map, architecture and specifications
tasks/          implementation plan and task list
.circleci/      CI verification gate
```

## Code Style

Use small pure functions for policy decisions and ports/interfaces for external boundaries.

```ts
if (!canTransition(run.status, nextStatus)) {
  throw new Error(`Illegal run transition: ${run.status} -> ${nextStatus}`);
}
```

Provider-specific code must not be imported into `src/core`.

## Testing Strategy

- Small deterministic tests for lifecycle, registry and verification rules.
- Integration tests will be added per adapter.
- End-to-end tests will be added only after an agent runtime and staging environment exist.
- A failed/missing acceptance criterion must prevent approval.

## Boundaries

### Always

- Require evidence for acceptance criteria.
- Keep core policy provider-neutral.
- Run tests before proposing a merge.
- Treat secrets as external configuration.

### Ask first

- Production deployment.
- Destructive provider actions.
- Schema migrations that remove/transform persisted data.
- Changes that weaken verification requirements.

### Never

- Let the Builder approve its own run.
- Commit credentials or API keys.
- Bypass failing tests/evals to make CI green.
- Put provider credentials or service-role keys in browser code.

## Success Criteria

1. `building -> approved` is rejected by the lifecycle.
2. `verifying -> approved` is allowed.
3. Approval fails when any acceptance criterion is missing or failed.
4. Capabilities must be explicitly registered before resolution.
5. All v0.1 tests pass locally and in CircleCI.
6. External providers remain behind ports/adapters.

## Open Questions

- Exact Supabase project/region and data-retention policy.
- CircleCI project connection and context names.
- OpenAI project/key boundary and spend limits.
- Which writes require human approval per provider.
