# Repository Guidelines

## Project Structure & Module Organization

`src/core/` contains TypeScript lifecycle rules, capability registration, verification, and shared types. `src/ledger/` holds the ledger interface and in-memory/Supabase adapters; `src/index.ts` defines public exports. `ai_control_plane.py` provides the Python/SQLite workflow implementation. Tests live in `tests/`. Design specifications and architecture notes are in `docs/`, reviewed database SQL is in `supabase/schema/`, and planning notes are in `tasks/`. Compiled JavaScript and declarations go to `dist/`.

## Build, Test, and Development Commands

Use Node.js 22+ and Python 3.10+. Run commands from the repository root:

- `npm ci`: install the locked TypeScript development dependencies.
- `npm run build`: compile strict TypeScript and emit declarations into `dist/`.
- `npm test`: build, run contract typechecks, then run all Node.js tests.
- `npm run check`: run the same Node.js validation.
- `python -m unittest discover -s tests -v`: run the Python test suite.

For changes to shared workflow behavior, run both `npm test` and `python -m unittest discover -s tests -v` before requesting merge.

## Non-negotiable Control-Plane Invariants

- No agent, Builder, or Verifier narrative may approve its own work. Approval is a deterministic policy decision over ledger evidence.
- Approval must use evidence from the current build attempt and must reload that evidence immediately before the decision.
- A verification retry returns the run to `building`; `buildRun()` must be able to reuse an already-`building` run rather than forcing an illegal self-transition.
- Advisory-agent failures must not bypass or suppress deterministic evidence evaluation.
- Runtime plans must contain at least one non-empty acceptance criterion at the governance boundary.
- External SDK adapters must be exercised through the consumer path with a production-shaped fake or contract test; callable-only mocks are insufficient.
- Keep privileged Supabase credentials server-side. Browser code must never receive `service_role` credentials.

## Coding Style & Naming Conventions

Follow existing TypeScript style: two-space indentation, single quotes, semicolons, camelCase functions, PascalCase types/classes, and kebab-case module filenames. Preserve strict typing and `.js` extensions in relative ESM imports. Use four-space indentation and snake_case functions in Python. Name capabilities with `domain.action`, such as `repo.read`. No dedicated formatter or linter is configured; match surrounding code.

## Testing Guidelines

JavaScript tests use `node:test` and `node:assert/strict`, with filenames `tests/*.test.mjs`; they import compiled output. Python uses standard-library `unittest`, with `test_*.py` files and `test_*` methods. Add behavior-focused tests for lifecycle gates, missing/failed evidence, persistence, concurrency, retry behavior, and error paths. Use temporary SQLite databases and isolated ledger fixtures. No numeric coverage threshold is configured.

## Commit & Pull Request Guidelines

Recent commits use concise subjects such as `feat: add Supabase run ledger adapter`. Prefer a conventional prefix and describe the concrete change. Pull requests should explain the problem, resulting behavior, and validation commands/results; link relevant issues and update specifications when contracts change.

## Security & Configuration Tips

Keep Supabase privileged credentials server-side. Preserve approval/verification gates and append-only audit behavior. Follow `supabase/README.md` when converting reviewed SQL into migrations, and validate database changes in a non-production environment first.
