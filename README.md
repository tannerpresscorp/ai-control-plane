# Tannerpress AI Control Plane

The repository contains a dependency-free Python workflow implementation and a
TypeScript control-plane core for governed multi-agent engineering workflows.
The TypeScript package includes an OpenAI Agents SDK adapter that routes work
through registered capabilities and leaves approval to deterministic ledger
policy. The Python implementation provides capability-based task claims,
approval and verification gates, delivery control, and an append-only audit
history.

## Python requirements

Python 3.10 or later. No third-party packages are required.

## TypeScript OpenAI runtime

Install the package dependencies with `npm ci` and configure `OPENAI_API_KEY` in
the server environment. Register each executable capability and its evidence
mapping before creating a run:

```ts
import { z } from 'zod';
import {
  CapabilityRegistry,
  InMemoryRunLedger,
  OpenAIAgentRuntime
} from '@tannerpress/ai-control-plane';

const capabilities = new CapabilityRegistry();
capabilities.register({ name: 'repo.read', provider: 'local', risk: 'read' });

const runtime = new OpenAIAgentRuntime({
  ledger: new InMemoryRunLedger(),
  capabilities,
  tools: {
    'repo.read': {
      parameters: z.object({ path: z.string() }),
      criterionIds: ['repository-inspected'],
      execute: async (input) => `Inspected ${JSON.stringify(input)}`
    }
  }
});

const run = await runtime.createRun({
  id: 'run-1',
  objective: 'Inspect the repository'
});
const result = await runtime.execute(run.id);
```

Non-read capabilities require an `authorizeCapability` callback, which receives
the capability and exact tool input before execution. SDK tracing is disabled by
default. Approval and verification evidence remain enforced by the run ledger.

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
