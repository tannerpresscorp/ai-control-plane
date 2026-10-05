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

## Front Desk Voice Booking Demo

`apps/front-desk` is a runnable web app that demonstrates voice appointment
booking for a sample business with an in-memory demo calendar. The browser uses
WebRTC for the live voice session, while the Node server keeps OpenAI
credentials server-side, creates ephemeral realtime sessions, checks
availability, verifies details through the Responses API, and saves confirmed
bookings.

```sh
export OPENAI_API_KEY=sk-...
npm run front-desk
```

Then open `http://localhost:4173`. The app shows available times and confirmed
bookings, asks the browser for microphone permission when the voice session
starts, lets the caller interrupt or revise preferences, and closes the local
voice session when the caller or user ends the booking.

The seeded calendar and booking endpoints remain usable for local demos if the
Responses API is unavailable; live voice requires a valid server-side OpenAI API
key because the server must mint the ephemeral realtime session.

Optional environment variables:

- `FRONT_DESK_PORT`: local server port, default `4173`.
- `OPENAI_REALTIME_MODEL`: realtime voice model, default `gpt-live`.
- `OPENAI_RESPONSES_MODEL`: Responses API model used for booking summaries,
  default `gpt-4.1-mini`.
