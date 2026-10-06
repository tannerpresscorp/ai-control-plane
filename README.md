# Tannerpress AI Control Plane

A small, dependency-free foundation for governed multi-agent engineering
workflows. It provides persistent workflow state, capability-based task claims,
approval and verification gates, delivery control, and an append-only audit
history. Agent execution and verification remain external: workers claim tasks,
submit results, and a verifier records the outcome.

## Requirements

Python 3.10 or later. No third-party packages are required.

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

The package publishes only the compiled `dist` output, README, docs, and Supabase migration documentation. Source files, tests, local databases, environment files, and CI metadata are excluded with `.npmignore`.

### CLI usage

After installing the package globally or through `npx`, use:

```sh
ai-control-plane --help
ai-control-plane --version
ai-control-plane health
ai-control-plane serve
```

The `serve` command starts the same HTTP API service as `npm start`.

### HTTP service

Build and run locally:

```sh
npm ci
npm run build
npm start
```

Default service settings:

```sh
HOST=0.0.0.0
PORT=3000
```

Health endpoints:

```sh
GET /health
GET /ready
```

Both endpoints return JSON with service status, version, uptime, timestamp, and whether required runtime credentials are present. They do not expose secret values.

Optional server-side environment variables:

```sh
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Copy `.env.example` when configuring a deployment target. Do not commit real secrets.

### Docker deployment

Build and run the service container:

```sh
docker build -t ai-control-plane:local .
docker run --rm -p 3000:3000 --env-file .env ai-control-plane:local
```

The Docker image uses `node:22-slim`, builds TypeScript in a separate stage, prunes development dependencies, exposes port `3000`, and includes a `/health` health check.

### Render deployment

`render.yaml` defines a Docker-backed web service named `ai-control-plane` with `/health` as the health check path. Configure these secrets in Render before production use:

```sh
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

The service can boot without these credentials for health checks, but live provider-backed workflows require the relevant server-side values.


Docker Compose is also available for local service runs:

```sh
docker compose up --build
```
