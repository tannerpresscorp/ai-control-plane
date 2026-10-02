# Tannerpress AI Control Plane

A governed AI engineering control plane for planning, building, verifying, and delivering software through evidence-backed agent workflows.

## v0.1 principle

> No agent declares its own work successful.

The control plane separates planning/building from verification. A run can move from `building` to `verifying`, but it cannot move directly from `building` to `approved`. Approval requires evidence for every acceptance criterion.

## Current slice

- Typed run lifecycle with guarded state transitions
- Capability registry with explicit registration
- Evidence-based verification gate
- Run-ledger interface plus in-memory adapter
- CircleCI build/test gate
- Architecture/spec/task documents for the next adapters

## Planned integrations

OpenAI Agents SDK, Supabase, GitHub/Tunnel Tools, CircleCI, Sixtyfour Intelligence, Google Drive, Data/Spreadsheets, Cloudflare, and Empire model benchmarking/routing.

## Commands

```bash
npm install --ignore-scripts
npm test
npm run build
```

Node.js 22+ is required.

## Design authority

The agent runtime will follow current OpenAI Agents SDK primitives rather than inventing provider APIs. The SDK documents agents, tools, agents-as-tools, MCP servers, handoffs, sessions, guardrails, human-in-the-loop patterns, and tracing:

- https://openai.github.io/openai-agents-js/
- https://openai.github.io/openai-agents-js/guides/quickstart/
- https://openai.github.io/openai-agents-js/guides/tools/
- https://openai.github.io/openai-agents-js/guides/tracing/

CircleCI configuration follows the 2.1 configuration model:

- https://circleci.com/docs/reference/configuration-reference/

Supabase persistence will be added behind the `RunLedger` port and will use RLS for application authorization:

- https://supabase.com/docs/guides/database/postgres/row-level-security
