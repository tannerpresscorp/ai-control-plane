# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` holds the full contributor guidelines and the control-plane invariants. The invariants are summarized below. Read `AGENTS.md` before you change lifecycle, ledger, or verification behavior.

## Commands

The package needs Node 22+ (CI runs on Node 22 in CircleCI and Node 24 in GitHub Actions). The Python implementation needs Python 3.10+ and has no third-party dependencies.

```sh
npm ci                                   # install locked deps
npm run build                            # tsc -> dist/ (strict, emits .d.ts)
npm test                                 # build, then node --test tests/*.test.mjs (same as npm run check)
npm run build && node --test tests/verifier.test.mjs   # one test file
npm run build && node --test --test-name-pattern "attempt" tests/*.test.mjs   # tests matching a name
python -m unittest discover -s tests -v  # Python suite (tests/test_control_plane.py)
npm start                                # HTTP API from dist/server.js (127.0.0.1:3000)
node dist/cli.js --help                  # CLI (bin: ai-control-plane)
OPENAI_API_KEY=... node support-app/server.mjs   # realtime voice support app; run npm run build first
```

- The JS tests import the **compiled `dist/` output**, not `src/`. Rebuild before running any single test file, or the test runs against stale code.
- No linter or formatter is configured. Match the surrounding style: two-space indent, single quotes, semicolons, kebab-case filenames, and `.js` extensions on relative ESM imports (NodeNext).
- The README says `npm run support`, but `package.json` has no such script. Start the support app with `node support-app/server.mjs` instead.
- If a change touches workflow behavior that both implementations share, run both the Node and Python suites.

## Architecture

There are two independent implementations of a governed agent-workflow control plane:

1. **TypeScript package** (`src/`, published as `@tannerpress/ai-control-plane`). This is a deterministic Architect → Builder → Evidence → Verifier → Approval pipeline. `src/index.ts` is the public barrel export, and `./server` is a second package export.
2. **Python `ai_control_plane.py`** is a standalone SQLite `ControlPlane` class. It uses a different model: agents register capabilities, claim tasks from a dependency DAG, and runs pass through decide, verify, and deliver steps with an audit log. It shares no code with the TS package.

### TypeScript layers

- `src/core/`: pure domain logic.
  - `lifecycle.ts` holds the run state machine: `planned → building ⇄ verifying → …`, with `approved → completed`, and `failed` as a terminal state. `transitionRun` refuses to move a run to `approved`. Entering `building` from another state increments `attempt`. Every transition increments `revision`.
  - `verifier.ts` evaluates evidence for a single attempt. For each criterion, the last evidence entry wins. Missing or failed criteria block approval.
  - `capabilities.ts` is the registry. Capability names use the `domain.action` form, and risk metadata is attached when a capability is registered.
- `src/ledger/`: `RunLedger` port (`ports.ts`) with in-memory and Supabase adapters. Only the ledger can approve a run (`RunLedger.approve`). Approval reloads evidence and checks the revision, so an approval computed from stale evidence cannot be committed.
- `src/agents/`: governed Architect/Builder/Verifier cycle (`governed-agent-cycle.ts`, `openai-agents-runtime.ts`). It is built on a provider-neutral `StructuredAgentExecutor`. Structured outputs are validated locally (`schemas.ts`, `validators.ts`). Agent narratives are advisory and never grant approval.
- `src/providers/`: adapters for real SDKs.
  - `openai-agents-sdk-boundary.ts` and `openai-agents-executor.ts` wrap `@openai/agents`.
  - `supabase-js-client.ts` wraps `@supabase/supabase-js`.
  - `sixtyfour-intelligence.ts` connects to the Sixtyfour service.
  - The SDK versions are pinned exactly in `package.json`. Contract tests run against the installed SDKs.
- `src/intelligence/` and `src/commercial/`: governed account-qualification and commercial-ledger features. They are layered on the same pattern (see `docs/SPEC-v0.4*` and `docs/SPEC-v0.5*`).
- Deployable surfaces:
  - `src/server.ts` is the stateless HTTP API (`/health`, `/ready`, `POST /v1/verify-acceptance`).
  - `src/cli.ts` and `src/bin/` provide the CLI. The `verify-acceptance` exit codes are 0 for approved, 1 for not approved, and 2 for bad input.
  - `server.js` is the Vercel entry. It imports from `dist/`, and the same handler is used by Docker, Render, and Compose.
- `support-app/`: a separate Node server for the realtime voice demo. It mints short-lived OpenAI Realtime client secrets server-side and serves `public/` plus `dist/`. The `/api/support/*` routes are explicit placeholders.

### Specs and persistence

- `docs/SPEC-v0.1` … `v0.5` are the versioned design contracts. Update the relevant spec when you change a contract. `tasks/todo.md` tracks milestone status.
- Supabase: `supabase/schema/control_plane_ledger.sql` is the reviewed source. `supabase/migrations/` holds the applied migration, which must mirror the schema source. All writes go through RPCs (`create_/update_/approve_control_plane_run`, `append_control_plane_evidence`). `service_role` gets no direct INSERT or UPDATE, and `anon` and `authenticated` get no access. See `supabase/README.md`.

## Invariants (from AGENTS.md — do not weaken)

- No agent, Builder, or Verifier may approve its own work. Approval is a deterministic policy decision over ledger evidence from a single positive attempt.
- Approval reloads evidence immediately before deciding. Every evidence append bumps the run revision.
- Evidence may be appended only while a run is `building` or `verifying`. A verification retry returns the run to `building`, and `building → building` keeps the attempt number.
- Runtime plans and persisted acceptance criteria need at least one non-blank criterion.
- Advisory-agent failures must not bypass or suppress deterministic evidence evaluation.
- Test external SDK adapters through the consumer path, using a production-shaped fake or a pinned-SDK contract test. Callable-only mocks are not enough. Do not claim SDK type compatibility unless the real package is in the lockfile and the contract test compiles against it.
- `service_role` and `OPENAI_API_KEY` stay server-side. Browser code must never receive them.

## Conventions

- Commit subjects use a conventional prefix, for example `feat: add Supabase run ledger adapter`.
- JS tests are `tests/*.test.mjs` and use `node:test` with `node:assert/strict`. Python tests use `unittest` with temporary SQLite databases.
- Vercel deployments require signed (verified) commits. Unsigned Git-triggered deploys get canceled.
