import tempfile
import unittest
from pathlib import Path

from ai_control_plane import ControlPlane, ControlPlaneError


class ControlPlaneTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database = Path(self.temp_dir.name) / "control-plane.sqlite"
        self.plane = ControlPlane(self.database)

    def tearDown(self):
        self.plane.close()
        self.temp_dir.cleanup()

    def test_approved_tasks_follow_dependencies_and_delivery_gates(self):
        engineer = self.plane.register_agent("engineer", ["implementation"])
        reviewer = self.plane.register_agent("reviewer", ["review"])
        run_id = self.plane.create_run(
            "Add feature",
            [
                {"name": "implement", "capability": "implementation"},
                {
                    "name": "review",
                    "capability": "review",
                    "depends_on": ["implement"],
                },
            ],
            requested_by="requester",
        )

        self.assertIsNone(self.plane.claim_task(engineer))
        with self.assertRaisesRegex(ControlPlaneError, "verified"):
            self.plane.deliver_run(run_id, "release-manager")

        self.plane.decide_run(run_id, True, "approver", "Approved")
        implementation = self.plane.claim_task(engineer)
        self.assertEqual(implementation["name"], "implement")
        self.assertIsNone(self.plane.claim_task(reviewer))
        with self.assertRaisesRegex(ControlPlaneError, "completed"):
            self.plane.verify_run(run_id, True, "verifier")

        self.plane.complete_task(implementation["id"], {"commit": "abc123"})
        review = self.plane.claim_task(reviewer)
        self.assertEqual(review["name"], "review")
        self.plane.complete_task(review["id"], {"approved": True})
        self.plane.verify_run(run_id, True, "verifier", "Checks passed")
        self.plane.deliver_run(run_id, "release-manager")

        run = self.plane.get_run(run_id)
        self.assertEqual(run["status"], "delivered")
        self.assertEqual(run["tasks"][0]["result"], {"commit": "abc123"})
        self.assertEqual(
            [event["action"] for event in self.plane.get_audit_events(run_id)],
            [
                "run_created",
                "run_approved",
                "task_claimed",
                "task_completed",
                "task_claimed",
                "task_completed",
                "verification_passed",
                "run_delivered",
            ],
        )

    def test_rejected_or_failed_runs_cannot_be_executed_or_delivered(self):
        agent = self.plane.register_agent("engineer", ["general"])
        rejected = self.plane.create_run(
            "Rejected change", [{"name": "work"}], requested_by="requester"
        )
        self.plane.decide_run(rejected, False, "approver")
        self.assertIsNone(self.plane.claim_task(agent))
        with self.assertRaisesRegex(ControlPlaneError, "awaiting approval"):
            self.plane.decide_run(rejected, True, "approver")

        failed = self.plane.create_run(
            "Failed checks", [{"name": "work"}], requested_by="requester"
        )
        self.plane.decide_run(failed, True, "approver")
        task = self.plane.claim_task(agent)
        self.plane.complete_task(task["id"], "done")
        self.plane.verify_run(failed, False, "verifier", "Tests failed")
        with self.assertRaisesRegex(ControlPlaneError, "verified"):
            self.plane.deliver_run(failed, "release-manager")

    def test_run_state_and_audit_history_survive_reopening_database(self):
        agent = self.plane.register_agent("engineer", ["general"])
        run_id = self.plane.create_run(
            "Persistent run", [{"name": "work"}], requested_by="requester"
        )
        self.plane.decide_run(run_id, True, "approver")
        task = self.plane.claim_task(agent)
        self.plane.complete_task(task["id"], "done")
        self.plane.close()

        self.plane = ControlPlane(self.database)
        self.assertEqual(self.plane.get_run(run_id)["status"], "running")
        self.assertEqual(len(self.plane.get_audit_events(run_id)), 4)

    def test_invalid_dependency_graph_is_rejected(self):
        with self.assertRaisesRegex(ControlPlaneError, "cycles"):
            self.plane.create_run(
                "Cyclic run",
                [
                    {"name": "first", "depends_on": ["second"]},
                    {"name": "second", "depends_on": ["first"]},
                ],
                requested_by="requester",
            )


if __name__ == "__main__":
    unittest.main()
