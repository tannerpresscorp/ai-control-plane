# AI Control Plane

A small, dependency-free foundation for governed multi-agent engineering
workflows. It provides persistent workflow state, capability-based task claims,
approval and verification gates, delivery control, and an append-only audit
history. Agent execution and verification remain external: workers claim tasks,
submit results, and a verifier records the outcome.

## Requirements

Python 3.10 or later. Node.js 22+ is required for the TypeScript package and realtime support app.

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

## Realtime voice support app

The repository includes a minimal browser voice-support surface using the OpenAI Realtime API and the OpenAI Agents SDK. The browser never receives `OPENAI_API_KEY`; the local server exchanges that server-side key for a short-lived Realtime client secret.

```sh
npm ci
export OPENAI_API_KEY="your-server-side-key"
npm run support
```

Open `http://localhost:3000`, then choose **Start call**. The click initiates the `RealtimeSession` connection so microphone permission and WebRTC setup happen from a user gesture. The session uses `gpt-realtime-2.1` and relies on the SDK for WebRTC audio, server VAD, natural turn taking, and normal barge-in.

Support actions under `/api/support/context` and `/api/support/request` are intentionally labeled **PLACEHOLDER** routes because this repository currently has no production support or ticket backend. Replace them with authenticated application APIs before production use.

The support page imports the pinned browser SDK through an import map and therefore requires network access to `esm.sh` when loading the page. Production deployments should bundle the browser dependencies into the application build instead.

## Tests

```sh
npm test
python -m unittest discover -s tests -v
```
