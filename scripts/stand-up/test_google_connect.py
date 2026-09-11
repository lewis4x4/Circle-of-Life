"""Synthetic bootstrap security tests; never reads actual connector secrets."""
import base64
import http.client
import json
from pathlib import Path
import threading
import time
import unittest
from unittest.mock import patch
import urllib.parse

from google_connect import Bootstrap, Handler, HTTPServer, ORIGIN, REDIRECT, SCOPE, XLSX, HAVEN_ORG, validate_anon_key
from test_workbook import MAP


def app():
    return Bootstrap({"web": {"client_id": "123-synthetic.apps.googleusercontent.com", "client_secret": "synthetic-only", "redirect_uris": [REDIRECT]}}, {"app_id": "123", "browser_api_key": "synthetic-key"}, Path("/not-written-by-tests"), "original_file_123")


class BootstrapTest(unittest.TestCase):
    def setUp(self):
        self.app = app()

    def begin(self):
        return urllib.parse.parse_qs(urllib.parse.urlsplit(self.app.begin()).query)

    def test_scope_offline_and_pkce(self):
        query = self.begin()
        self.assertEqual(query["scope"], [SCOPE])
        self.assertEqual(query["access_type"], ["offline"])
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertNotIn("client_secret", query)

    @patch("google_connect.private_json")
    @patch("google_connect.google_json")
    def test_resume_refreshes_matching_private_authorization(self, call, read):
        read.return_value = {"scope": SCOPE, "client_id": self.app.client["client_id"], "GOOGLE_REFRESH_TOKEN": "synthetic-refresh"}
        call.return_value = {"scope": SCOPE, "token_type": "Bearer", "access_token": "new-access", "expires_in": 3600}
        self.app.resume()
        self.assertEqual(self.app.token, "new-access")
        self.assertEqual(self.app.phase, "google_connected")
        self.assertEqual(call.call_args.kwargs["form"]["grant_type"], "refresh_token")
        self.assertIsNone(self.app.pending)

    @patch("google_connect.store_private")
    @patch("google_connect.Path.exists", return_value=True)
    @patch("google_connect.private_json")
    @patch("google_connect.google_json")
    def test_resume_revalidates_and_retains_selections_without_writes(self, call, read, exists, store):
        read.side_effect = [{"scope": SCOPE, "client_id": self.app.client["client_id"], "GOOGLE_REFRESH_TOKEN": "synthetic-refresh"}, {"files": {"original": {"id": "original_file_123", "selected_at": 123}, "rehearsal": {"id": "rehearsal_file_123", "selected_at": 456}}}]
        call.side_effect = [{"scope": SCOPE, "token_type": "Bearer", "access_token": "new-access", "expires_in": 3600}, {"id": "original_file_123", "name": "Original.xlsx", "mimeType": XLSX, "trashed": False, "capabilities": {"canEdit": True}}, {"id": "rehearsal_file_123", "name": "Rehearsal.xlsx", "mimeType": XLSX, "trashed": False, "capabilities": {"canEdit": True}}]
        self.app.resume()
        self.assertEqual(set(self.app.selected), {"original", "rehearsal"})
        self.assertEqual(self.app.selected["original"]["name"], "Original.xlsx")
        self.assertEqual(self.app.selected["rehearsal"]["selected_at"], 456)
        self.assertEqual(call.call_count, 3)
        store.assert_not_called()

    @patch("google_connect.private_json")
    @patch("google_connect.google_json")
    def test_resume_rejects_client_or_scope_mismatch_before_network(self, call, read):
        for values in ({"scope": SCOPE, "client_id": "another-client", "GOOGLE_REFRESH_TOKEN": "synthetic-refresh"}, {"scope": "https://www.googleapis.com/auth/drive", "client_id": self.app.client["client_id"], "GOOGLE_REFRESH_TOKEN": "synthetic-refresh"}):
            read.return_value = values
            with self.assertRaises(ValueError):
                self.app.resume()
        call.assert_not_called()

    @patch("google_connect.private_json")
    @patch("google_connect.google_json")
    def test_resume_rejects_broad_provider_scope(self, call, read):
        read.return_value = {"scope": SCOPE, "client_id": self.app.client["client_id"], "GOOGLE_REFRESH_TOKEN": "synthetic-refresh"}
        call.return_value = {"scope": "https://www.googleapis.com/auth/drive", "token_type": "Bearer", "access_token": "new-access", "expires_in": 3600}
        with self.assertRaises(ValueError):
            self.app.resume()
        self.assertIsNone(self.app.token)

    @patch("google_connect.google_json")
    def test_wrong_duplicate_missing_expired_state_never_exchanges(self, call):
        state = self.begin()["state"]
        for query in ({}, {"state": ["bad"], "code": ["x"]}, {"state": state * 2, "code": ["x"]}):
            with self.assertRaises(ValueError):
                self.app.callback(query)
        pending = self.app.pending
        self.app.pending = (*pending[:2], time.monotonic() - 601)
        with self.assertRaises(ValueError):
            self.app.callback({"state": state, "code": ["x"]})
        call.assert_not_called()

    @patch("google_connect.store_private")
    @patch("google_connect.google_json")
    def test_callback_single_use_private_refresh_only(self, call, store):
        self.app.selected = {"rehearsal": {"id": "old-account-file"}}
        state = self.begin()["state"]
        self.assertEqual(self.app.selected, {})
        call.return_value = {"scope": SCOPE, "token_type": "Bearer", "access_token": "access", "refresh_token": "refresh", "expires_in": 3600}
        query = {"state": state, "code": ["authorization-code"]}
        self.app.callback(query)
        self.assertEqual(store.call_args_list[0].args[1], "files.json")
        self.assertFalse(store.call_args_list[0].args[2]["complete"])
        self.assertEqual(store.call_args.args[2]["GOOGLE_REFRESH_TOKEN"], "refresh")
        self.assertNotIn("access_token", store.call_args.args[2])
        with self.assertRaises(ValueError):
            self.app.callback(query)
        self.assertEqual(call.call_count, 1)
        self.assertIn("code_verifier", call.call_args.kwargs["form"])

    @patch("google_connect.store_private")
    @patch("google_connect.google_json")
    def test_broad_scope_refused(self, call, store):
        state = self.begin()["state"]
        call.return_value = {"scope": SCOPE + " https://www.googleapis.com/auth/drive", "token_type": "Bearer", "access_token": "access", "refresh_token": "refresh"}
        with self.assertRaises(ValueError):
            self.app.callback({"state": state, "code": ["x"]})
        store.assert_not_called()

    @patch("google_connect.store_private")
    @patch("google_connect.google_json")
    def test_explicit_distinct_editable_xlsx_selection(self, call, store):
        self.app.token = "access"
        self.app.token_until = time.monotonic() + 60
        for role, file_id in (("original", "original_file_123"), ("rehearsal", "rehearsal_file_123")):
            call.return_value = {"id": file_id, "name": "Workbook.xlsx", "mimeType": XLSX, "trashed": False, "capabilities": {"canEdit": True}}
            self.app.select({"role": role, "id": file_id})
        self.assertTrue(store.call_args.args[2]["complete"])
        self.assertFalse(store.call_args.args[2]["sync_enabled"])
        for data in ({"role": "rehearsal", "id": "original_file_123"}, {"role": "original", "id": "wrong_file_123"}, {"role": "original", "id": "../escape"}):
            with self.assertRaises(ValueError):
                self.app.select(data)
        call.return_value["mimeType"] = "application/vnd.google-apps.spreadsheet"
        with self.assertRaises(ValueError):
            self.app.select({"role": "rehearsal", "id": "rehearsal_file_123"})


class HavenConnectTests(unittest.TestCase):
    def setUp(self):
        self.app = app()
        self.app.configure_haven("sb_publishable_" + "x" * 30, MAP)
        self.session = {"access_token": "synthetic-access", "refresh_token": "synthetic-refresh", "user": {"id": "synthetic-user"}}
        self.workspace = {"facilities": [{"id": value} for value in MAP.values()]}
        self.facilities = [{"id": value, "organization_id": HAVEN_ORG} for value in MAP.values()]

    @patch("google_connect.store_private")
    @patch("google_connect.haven_json")
    def test_password_failure_does_not_save(self, request, store):
        request.side_effect = ValueError("synthetic sign in rejection")
        with self.assertRaises(ValueError):
            self.app.connect_haven("person@example.test", "synthetic-password")
        store.assert_not_called()

    @patch("google_connect.store_private")
    @patch("google_connect.haven_json")
    def test_wrong_facility_scope_does_not_save(self, request, store):
        request.side_effect = [self.session, {"facilities": self.workspace["facilities"][:4]}]
        with self.assertRaises(ValueError):
            self.app.connect_haven("person@example.test", "synthetic-password")
        store.assert_not_called()
        self.assertEqual(request.call_count, 2)

    @patch("google_connect.store_private")
    @patch("google_connect.haven_json")
    def test_wrong_organization_does_not_save(self, request, store):
        self.facilities[0]["organization_id"] = "other-org"
        request.side_effect = [self.session, self.workspace, self.facilities]
        with self.assertRaises(ValueError):
            self.app.connect_haven("person@example.test", "synthetic-password")
        store.assert_not_called()

    @patch("google_connect.store_private")
    @patch("google_connect.haven_json")
    def test_valid_session_saved_without_password_or_google_mutation(self, request, store):
        request.side_effect = [self.session, self.workspace, self.facilities]
        self.app.selected = {"original": {"id": "unchanged"}}
        self.app.token = "google-unchanged"
        self.app.connect_haven("person@example.test", "synthetic-password")
        self.assertEqual(store.call_args.args[1], "haven-credentials.json")
        self.assertEqual(store.call_args.args[2]["HAVEN_STAND_UP_REFRESH_TOKEN"], "synthetic-refresh")
        self.assertNotIn("password", json.dumps(store.call_args.args[2]))
        self.assertNotIn("access_token", store.call_args.args[2])
        self.assertEqual(self.app.token, "google-unchanged")
        self.assertEqual(self.app.selected, {"original": {"id": "unchanged"}})
        self.assertEqual(request.call_args_list[1].args[3]["p_action"], "workspace")

    def test_service_or_other_project_key_rejected(self):
        def jwt(role, ref):
            claims = base64.urlsafe_b64encode(json.dumps({"role": role, "ref": ref}).encode()).decode().rstrip("=")
            return "synthetic." + claims + ".signature"
        for key in ("sb_secret_" + "x" * 30, jwt("service_role", "manfqmasfqppukpobpld"), jwt("anon", "wrong-project")):
            with self.assertRaises(ValueError):
                validate_anon_key(key)
        self.assertTrue(validate_anon_key(jwt("anon", "manfqmasfqppukpobpld")))


class HTTPTest(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.server.app = app()
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        conn.request(method, path, body, {"Host": "localhost:8766", **(headers or {})})
        response = conn.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        conn.close()
        return result

    def headers(self):
        return {"Origin": ORIGIN, "Cookie": "haven_connect=" + self.server.app.session, "X-CSRF-Token": self.server.app.csrf}

    def test_bad_host_origin_callback_session(self):
        self.assertEqual(self.request("GET", "/", headers={"Host": "evil.example"})[0], 400)
        self.assertEqual(self.request("GET", "/", headers={"Origin": "https://evil.example"})[0], 400)
        state = urllib.parse.parse_qs(urllib.parse.urlsplit(self.server.app.begin()).query)["state"][0]
        with patch("google_connect.google_json") as call:
            self.assertEqual(self.request("GET", "/oauth/callback?state=" + state + "&code=x")[0], 400)
            call.assert_not_called()

    def test_post_requires_origin_session_and_csrf(self):
        body = urllib.parse.urlencode({"csrf": self.server.app.csrf})
        for headers in ({}, {"Origin": ORIGIN}, {"Cookie": "haven_connect=" + self.server.app.session}, {**self.headers(), "Origin": "https://evil.example"}):
            self.assertEqual(self.request("POST", "/connect", body, headers)[0], 400)
        self.assertEqual(self.request("POST", "/connect", "csrf=bad", self.headers())[0], 400)
        self.assertEqual(self.request("POST", "/connect", body, self.headers())[0], 303)

    def test_config_guard_and_no_secret_html(self):
        status, headers, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("HttpOnly", headers["Set-Cookie"])
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertNotIn(b"synthetic-only", body)
        self.server.app.token = "access"
        self.server.app.token_until = time.monotonic() + 60
        self.assertEqual(self.request("GET", "/picker-config")[0], 400)
        self.assertEqual(self.request("GET", "/picker-config", headers=self.headers())[0], 200)

    @patch("google_connect.store_private")
    def test_browser_key_form_csrf_and_private_storage(self, store):
        body = urllib.parse.urlencode({"csrf": self.server.app.csrf, "browser_api_key": "synthetic-restricted-browser-key"})
        self.assertEqual(self.request("POST", "/picker-key", body)[0], 400)
        store.assert_not_called()
        self.assertEqual(self.request("POST", "/picker-key", body, self.headers())[0], 303)
        self.assertEqual(store.call_args.args[1], "picker-config.json")
        self.assertNotIn(b"synthetic-restricted-browser-key", self.request("GET", "/")[2])

    def test_diagnostics_are_bound_and_do_not_expose_secrets(self):
        self.assertEqual(self.request("GET", "/status")[0], 400)
        status, _, body = self.request("GET", "/status", headers=self.headers())
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["phase"], "ready_to_connect")
        self.assertNotIn(b"synthetic", body)
        self.assertNotIn(self.server.app.csrf.encode(), body)

    def test_connected_page_hides_key_prompt_and_escapes_selected_names(self):
        self.server.app.token = "synthetic"
        self.server.app.token_until = time.monotonic() + 60
        self.server.app.selected = {"original": {"name": "<img src=x>"}}
        _, _, body = self.request("GET", "/")
        self.assertIn(b'action="/picker-key" hidden', body)
        self.assertIn(b'&lt;img src=x&gt;', body)
        self.assertNotIn(b'<img src=x>', body)
        self.assertIn(b'Reconnect Google (clears workbook selections)', body)

    def test_haven_page_has_no_google_or_other_scripts(self):
        status, headers, body = self.request("GET", "/haven")
        self.assertEqual(status, 200)
        self.assertNotIn(b"<script", body)
        self.assertNotIn(b"apis.google.com", body)
        self.assertIn("default-src 'none'", headers["Content-Security-Policy"])

    def test_haven_login_csrf_prevents_password_request(self):
        body = urllib.parse.urlencode({"csrf": "wrong", "email": "person@example.test", "password": "synthetic-password"})
        with patch("google_connect.haven_json") as request:
            headers = {**self.headers(), "Content-Type": "application/x-www-form-urlencoded"}
            status, _, result = self.request("POST", "/haven-connect", body, headers)
            self.assertEqual(status, 400)
            self.assertNotIn(b"synthetic-password", result)
            request.assert_not_called()

    def test_oversized_body_rejected(self):
        self.assertEqual(self.request("POST", "/select", "x" * 32769, self.headers())[0], 400)


if __name__ == "__main__":
    unittest.main()
