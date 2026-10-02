"""A small, persistent orchestration core for governed engineering workflows."""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class ControlPlaneError(ValueError):
    """Raised when a requested workflow transition is not allowed."""


class ControlPlane:
    """Coordinate capability-matched agents through approval and delivery gates."""

    def __init__(self, database: str | Path = "control_plane.db") -> None:
        self._connection = sqlite3.connect(str(database), check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA foreign_keys = ON")
        self._lock = threading.RLock()
        self._connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                capabilities TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES runs(id),
                name TEXT NOT NULL,
                capability TEXT NOT NULL,
                position INTEGER NOT NULL,
                status TEXT NOT NULL,
                assigned_agent TEXT REFERENCES agents(id),
                result TEXT
            );
            CREATE TABLE IF NOT EXISTS dependencies (
                task_id TEXT NOT NULL REFERENCES tasks(id),
                depends_on TEXT NOT NULL REFERENCES tasks(id),
                PRIMARY KEY (task_id, depends_on)
            );
            CREATE TABLE IF NOT EXISTS audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT REFERENCES runs(id),
                action TEXT NOT NULL,
                actor TEXT NOT NULL,
                details TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    def register_agent(self, name: str, capabilities: list[str] | None = None) -> str:
        name = self._required_text(name, "Agent name")
        if capabilities is None:
            capabilities = []
        if not isinstance(capabilities, list) or any(
            not isinstance(item, str) or not item.strip() for item in capabilities
        ):
            raise ControlPlaneError("Agent capabilities must be non-empty strings")
        capabilities = [item.strip() for item in capabilities]

        agent_id = str(uuid.uuid4())
        with self._transaction():
            try:
                self._connection.execute(
                    "INSERT INTO agents (id, name, capabilities) VALUES (?, ?, ?)",
                    (agent_id, name, json.dumps(sorted(set(capabilities)))),
                )
            except sqlite3.IntegrityError as error:
                raise ControlPlaneError(f"Agent already exists: {name}") from error
        return agent_id

    def create_run(
        self,
        name: str,
        tasks: list[dict[str, Any]],
        requested_by: str,
    ) -> str:
        name = self._required_text(name, "Run name")
        requested_by = self._required_text(requested_by, "Requester")
        if not isinstance(tasks, list) or not tasks:
            raise ControlPlaneError("A run must contain at least one task")

        normalized_tasks = []
        task_ids: dict[str, str] = {}
        for task in tasks:
            if not isinstance(task, dict):
                raise ControlPlaneError("Each task must be an object")
            task_name = self._required_text(task.get("name"), "Task name")
            if task_name in task_ids:
                raise ControlPlaneError(f"Duplicate task name: {task_name}")
            task_ids[task_name] = str(uuid.uuid4())
            capability = self._required_text(
                task.get("capability", "general"), "Task capability"
            )
            dependencies = task.get("depends_on", [])
            if (
                not isinstance(dependencies, list)
                or any(not isinstance(item, str) for item in dependencies)
            ):
                raise ControlPlaneError("Task dependencies must be a list of task names")
            normalized_tasks.append(
                {
                    "name": task_name,
                    "capability": capability,
                    "depends_on": list(
                        dict.fromkeys(
                            self._required_text(item, "Dependency name")
                            for item in dependencies
                        )
                    ),
                }
            )

        for task in normalized_tasks:
            for dependency in task["depends_on"]:
                if dependency not in task_ids:
                    raise ControlPlaneError(f"Unknown task dependency: {dependency}")
                if dependency == task["name"]:
                    raise ControlPlaneError("A task cannot depend on itself")
        self._validate_acyclic(normalized_tasks)

        run_id = str(uuid.uuid4())
        with self._transaction():
            self._connection.execute(
                "INSERT INTO runs (id, name, status, created_at) VALUES (?, ?, ?, ?)",
                (run_id, name, "awaiting_approval", self._now()),
            )
            for position, task in enumerate(normalized_tasks):
                task_id = task_ids[task["name"]]
                self._connection.execute(
                    """
                    INSERT INTO tasks (id, run_id, name, capability, position, status)
                    VALUES (?, ?, ?, ?, ?, 'pending')
                    """,
                    (task_id, run_id, task["name"], task["capability"], position),
                )
                for dependency in task["depends_on"]:
                    self._connection.execute(
                        "INSERT INTO dependencies (task_id, depends_on) VALUES (?, ?)",
                        (task_id, task_ids[dependency]),
                    )
            self._record_event(
                run_id,
                "run_created",
                requested_by,
                {"name": name, "task_count": len(tasks)},
            )
        return run_id

    def decide_run(
        self,
        run_id: str,
        approved: bool,
        decided_by: str,
        reason: str = "",
    ) -> None:
        decided_by = self._required_text(decided_by, "Approver")
        if not isinstance(approved, bool):
            raise ControlPlaneError("Approval decision must be a boolean")
        if not isinstance(reason, str):
            raise ControlPlaneError("Approval reason must be a string")
        with self._transaction():
            run = self._get_run_row(run_id)
            if run["status"] != "awaiting_approval":
                raise ControlPlaneError("Only runs awaiting approval can be decided")
            status = "queued" if approved else "rejected"
            self._connection.execute(
                "UPDATE runs SET status = ? WHERE id = ?", (status, run_id)
            )
            self._record_event(
                run_id,
                "run_approved" if approved else "run_rejected",
                decided_by,
                {"reason": reason},
            )

    def claim_task(self, agent_id: str) -> dict[str, Any] | None:
        with self._transaction():
            agent = self._connection.execute(
                "SELECT * FROM agents WHERE id = ? AND active = 1", (agent_id,)
            ).fetchone()
            if agent is None:
                raise ControlPlaneError("Agent is missing or inactive")
            capabilities = set(json.loads(agent["capabilities"]))
            candidates = self._connection.execute(
                """
                SELECT t.*, r.status AS run_status
                FROM tasks AS t
                JOIN runs AS r ON r.id = t.run_id
                WHERE t.status = 'pending'
                  AND r.status IN ('queued', 'running')
                  AND NOT EXISTS (
                      SELECT 1
                      FROM dependencies AS d
                      JOIN tasks AS prerequisite ON prerequisite.id = d.depends_on
                      WHERE d.task_id = t.id AND prerequisite.status != 'completed'
                  )
                ORDER BY r.created_at, t.position
                """
            ).fetchall()
            task = next(
                (candidate for candidate in candidates
                 if candidate["capability"] in capabilities),
                None,
            )
            if task is None:
                return None

            self._connection.execute(
                "UPDATE tasks SET status = 'running', assigned_agent = ? WHERE id = ?",
                (agent_id, task["id"]),
            )
            self._connection.execute(
                "UPDATE runs SET status = 'running' WHERE id = ?", (task["run_id"],)
            )
            self._record_event(
                task["run_id"],
                "task_claimed",
                agent["name"],
                {"task_id": task["id"], "task_name": task["name"]},
            )
            return {
                "id": task["id"],
                "run_id": task["run_id"],
                "name": task["name"],
                "capability": task["capability"],
            }

    def complete_task(self, task_id: str, result: Any) -> None:
        try:
            serialized_result = json.dumps(result, allow_nan=False)
        except (TypeError, ValueError) as error:
            raise ControlPlaneError("Task result must be JSON serializable") from error
        with self._transaction():
            task = self._connection.execute(
                """
                SELECT t.*, a.name AS agent_name
                FROM tasks AS t
                JOIN agents AS a ON a.id = t.assigned_agent
                WHERE t.id = ?
                """,
                (task_id,),
            ).fetchone()
            if task is None or task["status"] != "running":
                raise ControlPlaneError("Only a running task can be completed")
            self._connection.execute(
                "UPDATE tasks SET status = 'completed', result = ? WHERE id = ?",
                (serialized_result, task_id),
            )
            self._record_event(
                task["run_id"],
                "task_completed",
                task["agent_name"],
                {"task_id": task_id},
            )

    def verify_run(self, run_id: str, passed: bool, verified_by: str, details: str = "") -> None:
        verified_by = self._required_text(verified_by, "Verifier")
        if not isinstance(passed, bool):
            raise ControlPlaneError("Verification result must be a boolean")
        if not isinstance(details, str):
            raise ControlPlaneError("Verification details must be a string")
        with self._transaction():
            run = self._get_run_row(run_id)
            if run["status"] != "running":
                raise ControlPlaneError("Only a running run can be verified")
            unfinished = self._connection.execute(
                "SELECT COUNT(*) FROM tasks WHERE run_id = ? AND status != 'completed'",
                (run_id,),
            ).fetchone()[0]
            if unfinished:
                raise ControlPlaneError("All tasks must be completed before verification")
            status = "verified" if passed else "verification_failed"
            self._connection.execute(
                "UPDATE runs SET status = ? WHERE id = ?", (status, run_id)
            )
            self._record_event(
                run_id,
                "verification_passed" if passed else "verification_failed",
                verified_by,
                {"details": details},
            )

    def deliver_run(self, run_id: str, delivered_by: str) -> None:
        delivered_by = self._required_text(delivered_by, "Delivery actor")
        with self._transaction():
            run = self._get_run_row(run_id)
            if run["status"] != "verified":
                raise ControlPlaneError("Only a verified run can be delivered")
            self._connection.execute(
                "UPDATE runs SET status = 'delivered' WHERE id = ?", (run_id,)
            )
            self._record_event(run_id, "run_delivered", delivered_by, {})

    def get_run(self, run_id: str) -> dict[str, Any]:
        with self._lock:
            run = self._get_run_row(run_id)
            tasks = self._connection.execute(
                """
                SELECT id, name, capability, status, assigned_agent, result
                FROM tasks WHERE run_id = ? ORDER BY position
                """,
                (run_id,),
            ).fetchall()
            return {
                "id": run["id"],
                "name": run["name"],
                "status": run["status"],
                "created_at": run["created_at"],
                "tasks": [
                    {
                        **dict(task),
                        "result": json.loads(task["result"]) if task["result"] else None,
                    }
                    for task in tasks
                ],
            }

    def get_audit_events(self, run_id: str) -> list[dict[str, Any]]:
        with self._lock:
            events = self._connection.execute(
                """
                SELECT action, actor, details, created_at
                FROM audit_events WHERE run_id = ? ORDER BY id
                """,
                (run_id,),
            ).fetchall()
            return [
                {**dict(event), "details": json.loads(event["details"])}
                for event in events
            ]

    @staticmethod
    def _required_text(value: Any, label: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ControlPlaneError(f"{label} must be a non-empty string")
        return value.strip()

    @staticmethod
    def _validate_acyclic(tasks: list[dict[str, Any]]) -> None:
        dependencies = {task["name"]: task.get("depends_on", []) for task in tasks}
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(name: str) -> None:
            if name in visiting:
                raise ControlPlaneError("Task dependencies must not contain cycles")
            if name in visited:
                return
            visiting.add(name)
            for dependency in dependencies[name]:
                visit(dependency)
            visiting.remove(name)
            visited.add(name)

        for task_name in dependencies:
            visit(task_name)

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _get_run_row(self, run_id: str) -> sqlite3.Row:
        run = self._connection.execute(
            "SELECT * FROM runs WHERE id = ?", (run_id,)
        ).fetchone()
        if run is None:
            raise ControlPlaneError(f"Unknown run: {run_id}")
        return run

    def _record_event(
        self,
        run_id: str,
        action: str,
        actor: str,
        details: dict[str, Any],
    ) -> None:
        self._connection.execute(
            """
            INSERT INTO audit_events (run_id, action, actor, details, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (run_id, action, actor, json.dumps(details), self._now()),
        )

    class _Transaction:
        def __init__(self, plane: "ControlPlane") -> None:
            self.plane = plane

        def __enter__(self) -> None:
            self.plane._lock.acquire()
            try:
                self.plane._connection.execute("BEGIN IMMEDIATE")
            except BaseException:
                self.plane._lock.release()
                raise

        def __exit__(self, exception_type: Any, exception: Any, traceback: Any) -> None:
            try:
                if exception_type is None:
                    self.plane._connection.commit()
                else:
                    self.plane._connection.rollback()
            finally:
                self.plane._lock.release()

    def _transaction(self) -> "ControlPlane._Transaction":
        return self._Transaction(self)
