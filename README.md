# Tannerpress AI Control Plane

A foundation for governed multi-agent engineering workflows, with a TypeScript
library, HTTP verification API, installable CLI, and a separate dependency-free
Python implementation. It provides persistent workflow state, capability-based task claims,
approval and verification gates, delivery control, and an append-only audit
history. Agent execution and verification remain external: workers claim tasks,
submit results, and a verifier records the outcome.

## Requirements

Node.js 22 or later for the package, CLI, and HTTP API. Python 3.10 or later
for the Python implementation, which requires no third-party packages.

## Quick start

```python
from ai_control_plane import ControlPlane

plane = ControlPlane("control_plane.db")
implementer = plane.register_agent("implementer", ["implementation"])
reviewer = plane.register_agent("reviewer", ["review"])

run_id = plane.create_run(
    "Ship search",
    [
        {"name": "implement", "capability": "implementation"},
        {"name": "review", "capability": "review", "depends_on": ["implement"]},
    ],
    requested_by="engineering-lead",
)
plane.decide_run(run_id, approved=True, decided_by="approver")

task = plane.claim_task(implementer)
plane.complete_task(task["id"], {"change": "Search is implemented"})
task = plane.claim_task(reviewer)
plane.complete_task(task["id"], {"approved": True})

plane.verify_run(run_id, passed=True, verified_by="ci")
plane.deliver_run(run_id, delivered_by="release-manager")
print(plane.get_run(run_id))
print(plane.get_audit_events(run_id))
plane.close()
```

Runs must be explicitly approved before work can be claimed. Task dependencies
must complete before dependent work becomes available, and delivery is allowed
only after every task is complete and verification passes. Each lifecycle
transition is recorded with its actor and details. Rejected and failed runs
cannot be delivered.

## Tests

```sh
python -m unittest discover -s tests -v
```

## Node package, CLI, and service deployment

This repository now ships three deployable surfaces:

1. **npm package** for library consumption.
2. **CLI** exposed as `ai-control-plane`.
3. **HTTP service** exposed by `node dist/server.js`.

### Package release workflow

```sh
npm ci
npm run check
npm run pack:dry-run
npm publish --access public
```

The `files` allowlist publishes only compiled `dist` output, this README, and
Supabase migrations and README. Source files, tests, local databases, environment
files, and CI metadata are excluded. `prepack` builds the output, including when
packing a fresh checkout; `prepublishOnly` runs the full Node test suite.
Publishing requires npm authentication and permission to publish under
`@tannerpress`. The release remains unpublished until `npm publish` succeeds.

### CLI usage

After installing the package globally or through `npx`, use:

```sh
ai-control-plane --help
ai-control-plane --version
ai-control-plane health
ai-control-plane verify-acceptance --file evidence.json
ai-control-plane serve
```

The `serve` command starts the same HTTP API service as `npm start`. Verification
also accepts `--json '<JSON>'`; `--file` avoids shell quoting issues. The JSON
output is `{ "approved": true, "missing": [], "failed": [] }` when every criterion
passes for the requested attempt. Verification exits with `0` for approval, `1`
for a failed or missing criterion, and `2` for invalid arguments or input.

Example `evidence.json`:

```json
{
  "acceptanceCriteria": ["build"],
  "evidence": [
    { "criterionId": "build", "status": "pass", "source": "ci", "detail": "built", "attempt": 1 }
  ],
  "attempt": 1
}
```

### HTTP service

Build and run locally:

```sh
npm ci
npm run build
npm start
```

Default service settings:

```sh
AI_CONTROL_PLANE_HOST=127.0.0.1
PORT=3000
```

Health endpoints:

```sh
GET /health
GET /ready
```

Both endpoints return JSON with service status, version, uptime, timestamp, and
credential-presence booleans, never secret values. `/ready` indicates that the
stateless service is ready; it does not check OpenAI or Supabase connectivity.

`POST /v1/verify-acceptance` accepts the same JSON as the CLI, with
`Content-Type: application/json`. It returns HTTP `200` with the verification
decision, including when evidence fails. Invalid JSON or field types return
`400`, unsupported content types return `415`, and bodies larger than 1 MiB
return `413`. Only evidence from the requested positive integer attempt counts;
the last evidence entry for a criterion in that attempt wins. Empty or blank
criteria cannot approve. Evidence status must be `pass` or `fail`.

This endpoint is a stateless evaluator of caller-supplied evidence. It does not
authenticate evidence sources, execute agents, write Supabase records, or grant
approval to persisted runs. Persisted workflow decisions still use the governed
runtime and its ledger checks. The CLI and API require no provider credentials.

Optional server-side environment variables:

```sh
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Set environment variables in the host or copy `.env.example` to `.env` and run
`node --env-file=.env dist/server.js`; `npm start` does not load `.env` automatically.
`AI_CONTROL_PLANE_HOST` takes priority over the legacy `HOST` variable. Missing or
invalid `PORT` values fall back to `3000`. Containers set the host to `0.0.0.0`.
Do not commit real secrets.

### Docker deployment

Build and run the service container:

```sh
docker build -t ai-control-plane:local .
docker run --rm -p 127.0.0.1:3000:3000 ai-control-plane:local
```

The Docker image uses `node:22-slim`, builds TypeScript in a separate stage,
prunes development dependencies, runs as the unprivileged `node` user, exposes
port `3000`, and includes a `/health` health check. No local environment files or
Supabase workspace files are copied into the image.

### Vercel deployment

`server.js` starts the built Node HTTP server when Vercel loads its entrypoint;
`vercel.json` builds TypeScript before deployment. All routes use the same
handler as the CLI and Docker service. The stateless API needs no provider secrets.
Deploy this branch as a preview and check `/health`, `/ready`, and a verification
POST before promoting it. Vercel Deployment Protection may require authenticated
access even when a deployment reports `READY`.

### Render deployment

`render.yaml` remains an alternative Docker-backed web service configuration with
`/health` as the health check path. Its optional provider environment entries are
for future provider-backed service operations:

```sh
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

The current verification API does not use these credentials. Configure and
validate live provider-backed workflows separately before exposing such operations.


Docker Compose is also available for local service runs without a `.env` file:

```sh
docker compose up --build
```

Set `PORT` to choose a different host port; the container continues listening on
port `3000`. The service is stateless and does not require a data volume.
