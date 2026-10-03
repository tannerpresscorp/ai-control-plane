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
- No runtime dependencies in the provider-neutral core
- OpenAI Agents SDK and Zod dependencies are isolated to the OpenAI runtime adapter

Supabase and other provider SDKs remain behind adapters.

## Commands

```bash
npm ci --ignore-scripts
npm run build
npm test
npm run check
```

## Testing Strategy

- Small deterministic tests for lifecycle, registry, verification, and ledger behavior.
- Integration tests will be added per adapter.
- End-to-end tests will be added only after an agent runtime and staging environment exist.
- A failed or missing acceptance criterion must prevent approval.
- Evidence is ordered; the newest record for a criterion supersedes older evidence.

## Boundaries

### Always

- Enter `approved` only through `RunLedger.approve(runId, updatedAt)`.
- Let the ledger evaluate its own current run and current-attempt evidence atomically.
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

- Let the Builder or Verifier approve its own run.
- Accept an independently supplied run/evidence pair as approval authority.
- Commit credentials or API keys.
- Bypass failing tests/evals to make CI green.
- Put provider credentials or service-role keys in browser code.

## Success Criteria

1. Generic transitions cannot enter `approved`.
2. Generic ledger create/update cannot persist `approved`.
3. Ledger approval rejects missing or failing current-attempt evidence.
4. Ledger approval succeeds only for a `verifying` run with passing current evidence.
5. `verifying -> building` supports correction/retry.
6. Newer evidence for a criterion supersedes older evidence.
7. Capabilities must be explicitly registered before resolution.
8. In-memory persistence behavior is covered by tests.
9. Package exports resolve to the compiled public API.
10. External providers remain behind ports/adapters.
