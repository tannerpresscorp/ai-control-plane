# Architecture

## Governing flow

```text
Request
  │
  ▼
Architect ── creates objective + acceptance criteria + requested capabilities
  │
  ▼
Builder ─── performs bounded work through registered capabilities
  │
  ▼
Evidence ── tests / scans / evals / provider receipts
  │
  ▼
Verifier ── evaluates evidence against acceptance criteria
  │
  ├── fail/missing ──► back to Builder or Failed
  │
  └── pass ─────────► Approved ─► human/release gate ─► Completed
```

## Separation of authority

- **Architect:** defines work and acceptance criteria.
- **Builder:** performs work. It cannot transition directly to `approved`.
- **Verifier:** interprets independently produced evidence.
- **Run Ledger:** records run state and evidence.
- **Capability Registry:** maps provider-neutral capability names to adapters and risk metadata.

## OpenAI runtime direction

OpenAI's current Agents SDK supports agents, function tools, agents-as-tools, MCP servers, sandbox capabilities, handoffs and built-in tracing. v0.1 does not yet bind to the SDK; the later `agent-runtime` module will adapt these primitives to the deterministic core.

Sources:
- https://openai.github.io/openai-agents-js/
- https://openai.github.io/openai-agents-js/guides/tools/
- https://openai.github.io/openai-agents-js/guides/handoffs/
- https://openai.github.io/openai-agents-js/guides/tracing/

## Persistence direction

The core depends on the `RunLedger` interface. Supabase will implement that port later. Tables exposed to application clients will use RLS; privileged service credentials remain server-side.

Source:
- https://supabase.com/docs/guides/database/postgres/row-level-security

## Capability naming

Initial provider-neutral names should follow `domain.action`, for example:

- `repo.read`
- `repo.write`
- `ci.inspect`
- `ci.run`
- `db.query`
- `db.migrate`
- `drive.search`
- `research.company`
- `analytics.validate`
- `model.benchmark`
- `deploy.staging`
- `deploy.production`

Risk policy is attached to each registered capability, not inferred from its string name.
