# Tannerpress AI Control Plane

A governed AI engineering control plane for planning, building, verifying, and delivering software
through evidence-backed agent workflows.

## v0.1 principle

> No agent declares its own work successful.

The control plane separates planning/building from verification. Generic lifecycle transitions
cannot enter `approved`; callers must use `approveRun`, which evaluates the run's current evidence
against every acceptance criterion. A failed verification can return to `building` for correction,
and the newest evidence for each criterion supersedes older evidence.

## Current slice

- Typed run lifecycle with guarded state transitions
- Dedicated evidence-backed approval operation
- Verification retry path back to the Builder
- Capability registry with explicit registration
- Evidence-based verification gate
- Run-ledger interface plus tested in-memory adapter
- Reproducible CircleCI build/test gate using `npm ci`
- Architecture/spec/task documents for the next adapters

## Planned integrations

OpenAI Agents SDK, Supabase, GitHub/Tunnel Tools, CircleCI, Sixtyfour Intelligence, Google Drive,
Data/Spreadsheets, Cloudflare, and Empire model benchmarking/routing.

## Commands

```bash
npm ci --ignore-scripts
npm test
npm run build
```

Node.js 22+ is required.
