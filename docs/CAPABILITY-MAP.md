# Capability Map: Tannerpress AI Control Plane

| Module id | Responsibility | Depends on |
|---|---|---|
| `core-orchestration` | Run states, acceptance criteria, verification rules, capability contracts | — |
| `run-ledger` | Durable run/evidence/event persistence behind a port | `core-orchestration` |
| `tool-registry` | Provider-neutral capability registration and policy metadata | `core-orchestration` |
| `verification-gates` | Convert CI/security/eval evidence into approval decisions | `core-orchestration`, `run-ledger` |
| `agent-runtime` | OpenAI Architect/Builder/Verifier orchestration | `core-orchestration`, `tool-registry`, `run-ledger` |
| `provider-adapters` | GitHub, CircleCI, Supabase, Drive, Sixtyfour, Data, Empire, Cloudflare | `tool-registry`, `run-ledger` |
| `control-dashboard` | Human review, run state, evidence, approvals, audit views | `agent-runtime`, `run-ledger` |

Build order:

`core-orchestration` → (`run-ledger`, `tool-registry`) → `verification-gates` → `agent-runtime` → `provider-adapters` → `control-dashboard`

## Rule

Provider adapters implement capabilities. Core orchestration never imports provider SDKs directly.
