"""Tes HTTP nyata untuk peluncur lokal, tanpa browser atau dependensi pihak ketiga."""
import http.client
import importlib.util
from pathlib import Path
import threading
import unittest
from http.server import ThreadingHTTPServer

spec = importlib.util.spec_from_file_location("baginota_server", Path(__file__).resolve().parents[1] / "server.py")
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)


class LocalServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), server_module.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)

    def request(self, path, method="GET"):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            connection.request(method, path)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_home_and_all_modules_are_served_with_correct_mime(self):
        for path, (_, mime) in server_module.ASSETS.items():
            with self.subTest(path=path):
                status, headers, body = self.request(path)
                self.assertEqual(status, 200)
                self.assertEqual(headers["Content-Type"], mime)
                self.assertGreater(len(body), 10)
                self.assertEqual(int(headers["Content-Length"]), len(body))
                self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertIn(b'lang="id"', self.request("/")[2])

    def test_private_paths_and_traversal_are_not_served(self):
        for path in ["/server.py", "/tests/test_server.py", "/README.md", "/../server.py", "/%2e%2e/server.py", "/.env", "/missing"]:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)

    def test_head_returns_headers_without_response_body(self):
        status, headers, body = self.request("/model.mjs", "HEAD")
        self.assertEqual(status, 200)
        self.assertGreater(int(headers["Content-Length"]), 0)
        self.assertEqual(body, b"")

    def test_policy_blocks_remote_scripts_connections_and_framing(self):
        headers = self.request("/")[1]
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("script-src 'self'", headers["Content-Security-Policy"])
        self.assertIn("connect-src 'none'", headers["Content-Security-Policy"])
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])

    def test_query_string_does_not_change_asset(self):
        self.assertEqual(self.request("/styles.css?version=1")[2], self.request("/styles.css")[2])

    def test_post_is_not_an_available_api(self):
        self.assertEqual(self.request("/", "POST")[0], 501)


if __name__ == "__main__":
    unittest.main()
