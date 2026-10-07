# AI Control Plane

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
