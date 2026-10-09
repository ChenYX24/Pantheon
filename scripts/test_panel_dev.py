"""Publication tests use an in-memory Caddy model, never the host's admin API."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location("panel_dev", Path(__file__).with_name("panel-dev.py"))
panel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(panel)


class RouteTests(unittest.TestCase):
    def test_publish_update_withdraw_preserve_other_routes_and_are_idempotent(self):
        unrelated = [{"@id": "another-service", "handle": [{"handler": "static_response", "body": "keep"}]}, {"match": [{"host": ["example.test"]}]}]
        routes = copy.deepcopy(unrelated)
        mutations = []
        version = 0

        def api(path, data=None, method="GET", etag=None):
            nonlocal version
            if method == "GET":
                return copy.deepcopy(routes), str(version)
            self.assertEqual(etag, str(version))
            index = int(path.rsplit("/", 1)[1])
            if method == "PUT": routes.insert(index, data)
            elif method == "PATCH": routes[index] = data
            elif method == "DELETE": routes.pop(index)
            else: self.fail(method)
            version += 1
            mutations.append(method)
            return None, None

        with patch.object(panel, "caddy_request", api):
            self.assertTrue(panel.reconcile_route(True))
            self.assertEqual(routes[1:], unrelated)
            self.assertFalse(panel.reconcile_route(True))
            routes[0]["terminal"] = False
            self.assertTrue(panel.reconcile_route(True))
            self.assertEqual(routes[1:], unrelated)
            self.assertTrue(panel.reconcile_route(False))
            self.assertEqual(routes, unrelated)
            self.assertFalse(panel.reconcile_route(False))
            self.assertEqual(mutations, ["PUT", "PATCH", "DELETE"])

    def test_concurrent_writer_gets_fresh_etag_and_array_index(self):
        routes = []
        reads = 0
        def api(path, data=None, method="GET", etag=None):
            nonlocal reads
            if method == "GET":
                reads += 1
                return copy.deepcopy(routes), str(reads)
            if reads == 1:
                routes.append({"@id": "arrived-concurrently"})
                raise urllib.error.HTTPError("local-fixture", 412, "conflict", {}, None)
            self.assertEqual(etag, "2")
            routes.insert(0, data)
            return None, None
        with patch.object(panel, "caddy_request", api):
            panel.reconcile_route(True)
        self.assertEqual(routes[1], {"@id": "arrived-concurrently"})

    def test_cron_retains_unrelated_lines(self):
        original = "# existing configuration\n@reboot /other/service\n* * * * * /other/service\n"
        with patch.object(panel, "cron_text", return_value=original + "@reboot /old " + panel.CRON_MARKER + "\n"), patch.object(panel.subprocess, "run") as run:
            panel.update_cron(False)
        self.assertEqual(run.call_args.kwargs["input"], original)

    def test_watchdog_never_installs_a_working_tree_build(self):
        with patch.object(panel, "publication_enabled", return_value=True), patch.object(panel, "running", return_value=None), patch.object(panel, "start") as start, patch.object(panel, "healthy"), patch.object(panel, "reconcile_route", return_value=False):
            panel.ensure_published()
        start.assert_called_once_with(refresh_binary=False)

if __name__ == "__main__":
    unittest.main()
