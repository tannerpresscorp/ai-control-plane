# Spec: AI Control Plane v0.1 Core

## Objective

Establish a small, deterministic foundation for a governed agent system before adding live
model/provider integrations. v0.1 must prove that run lifecycle rules and verification gates can
be tested independently of LLM behavior.

## Tech Stack

- Node.js 22+
- TypeScript 5.8.3
- Node built-in test runner
- CircleCI 2.1 configuration
- No runtime dependencies in the core package

OpenAI Agents SDK, Supabase, and external provider SDKs are deliberately deferred to adapters in
later slices.

## Commands

```bash
npm ci --ignore-scripts
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

## Testing Strategy

- Small deterministic tests for lifecycle, registry, verification, and ledger behavior.
- Integration tests will be added per adapter.
- End-to-end tests will be added only after an agent runtime and staging environment exist.
- A failed or missing acceptance criterion must prevent approval.
- Evidence is ordered; the newest record for a criterion supersedes older evidence.

## Boundaries

### Always

- Require `approveRun` and passing evidence before entering `approved`.
- Allow failed verification to return to `building` for another attempt.
- Keep core policy provider-neutral.
- Run tests before proposing a merge.
- Treat secrets as external configuration.

### Ask first

- Production deployment.
- Destructive provider actions.
- Schema migrations that remove or transform persisted data.
- Changes that weaken verification requirements.

### Never

- Let the Builder approve its own run.
- Commit credentials or API keys.
- Bypass failing tests/evals to make CI green.
- Put provider credentials or service-role keys in browser code.

## Success Criteria

1. Generic transitions cannot enter `approved`.
2. `approveRun` rejects missing or failing evidence.
3. `approveRun` succeeds only from `verifying` with passing evidence.
4. `verifying -> building` supports correction/retry.
5. Newer evidence for a criterion supersedes older evidence.
6. Capabilities must be explicitly registered before resolution.
7. In-memory persistence behavior is covered by tests.
8. Package exports resolve to the compiled public API.
9. CI uses the committed lockfile with `npm ci`.
10. External providers remain behind ports/adapters.

## Open Questions

- Exact Supabase project/region and data-retention policy.
- CircleCI project connection and context names.
- OpenAI project/key boundary and spend limits.
- Which writes require human approval per provider.
