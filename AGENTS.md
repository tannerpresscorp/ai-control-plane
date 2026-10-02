# Repository Guidelines

## Project Structure & Module Organization

`src/core/` contains TypeScript lifecycle rules, capability registration, verification, and shared types. `src/ledger/` holds the ledger interface and in-memory/Supabase adapters; `src/index.ts` defines public exports. `ai_control_plane.py` provides the Python/SQLite workflow implementation. Tests live in `tests/`. Design specifications and architecture notes are in `docs/`, reviewed database SQL is in `supabase/schema/`, and planning notes are in `tasks/`. Compiled JavaScript and declarations go to `dist/`.

## Build, Test, and Development Commands

Use Node.js 22+ and Python 3.10+. Run commands from the repository root:

- `npm ci`: install the locked TypeScript development dependencies.
- `npm run build`: compile strict TypeScript and emit declarations into `dist/`.
- `npm test`: build, then run all Node.js tests.
- `npm run check`: run the same build-and-test validation.
- `python -m unittest discover -s tests -v`: run the Python test suite.

This repository is a library; use the Python example in `README.md` to exercise workflows locally.

## Coding Style & Naming Conventions

Follow existing TypeScript style: two-space indentation, single quotes, semicolons, camelCase functions, PascalCase types/classes, and kebab-case module filenames. Preserve strict typing and `.js` extensions in relative ESM imports. Use four-space indentation and snake_case functions in Python. Name capabilities with `domain.action`, such as `repo.read`. No dedicated formatter or linter is configured; match surrounding code.

## Testing Guidelines

JavaScript tests use `node:test` and `node:assert/strict`, with filenames `tests/*.test.mjs`; they import compiled output. Python uses standard-library `unittest`, with `test_*.py` files and `test_*` methods. Add behavior-focused tests for lifecycle gates, missing/failed evidence, persistence, and error paths. Use temporary SQLite databases and isolated ledger fixtures. No numeric coverage threshold is configured. Run both suites for changes affecting shared workflow behavior.

## Commit & Pull Request Guidelines

Recent commits use concise subjects such as `feat: add Supabase run ledger adapter`. Prefer a conventional prefix and describe the concrete change. Pull requests should explain the problem, resulting behavior, and validation commands/results; link relevant issues and update specifications when contracts change.

## Security & Configuration Tips

Keep Supabase privileged credentials server-side. Preserve approval/verification gates and append-only audit behavior. Follow `supabase/README.md` when converting reviewed SQL into migrations, and validate database changes in a non-production environment first.
