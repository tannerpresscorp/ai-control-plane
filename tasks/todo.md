# Tasks

- [x] Define run lifecycle and illegal transitions.
  - Acceptance: Builder cannot skip verification.
  - Verify: `tests/lifecycle.test.mjs`
- [x] Define evidence-based verifier.
  - Acceptance: missing or failed evidence blocks approval.
  - Verify: `tests/verifier.test.mjs`
- [x] Define capability registry.
  - Acceptance: unregistered capabilities do not resolve; duplicates fail.
  - Verify: `tests/capabilities.test.mjs`
- [x] Define run-ledger persistence port and local adapter.
- [x] Add CircleCI build/test gate.
- [ ] Implement Supabase `RunLedger` adapter with RLS-backed schema.
- [ ] Implement OpenAI Architect/Builder/Verifier runtime adapter.
- [ ] Add GitHub/Tunnel capability adapter.
- [ ] Add CircleCI evidence ingestion adapter.
- [ ] Add human approval policy for destructive/production actions.
