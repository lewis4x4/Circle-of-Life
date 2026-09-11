#!/usr/bin/env python3
"""Local, operator-driven drive.file OAuth/Picker bootstrap (stdlib only).

Google references: https://developers.google.com/identity/protocols/oauth2/web-server
https://developers.google.com/workspace/drive/picker/guides/web-picker
No workbook writes. credentials.json supplies GOOGLE_REFRESH_TOKEN to worker.py.
"""
import argparse
import base64
import hashlib
import hmac
import html
import http.cookies
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
from pathlib import Path
import re
import secrets
import stat
import time
import urllib.parse
import urllib.request

ORIGIN = "http://localhost:8766"
REDIRECT = ORIGIN + "/oauth/callback"
SCOPE = "https://www.googleapis.com/auth/drive.file"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_BODY = 32768
HAVEN = "https://manfqmasfqppukpobpld.supabase.co"
HAVEN_ORG = "00000000-0000-0000-0000-000000000001"
FACILITY_NAMES = {"Homewood", "Oakridge", "Rising Oaks", "Plantation", "Grande Cypress"}


def private_json(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
        raise ValueError("Configuration must be an owned private regular file (0600)")
    with path.open() as handle:
        data = handle.read(MAX_BODY + 1)
    if len(data) > MAX_BODY:
        raise ValueError("Configuration too large")
    return json.loads(data)


def store_private(directory, name, data):
    directory = Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
        raise ValueError("State directory must be owned and private (0700)")
    temporary = directory / ("." + name + "." + secrets.token_hex(8))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(data, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, directory / name)
    finally:
        if temporary.exists():
            temporary.unlink()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise ValueError("Unexpected provider redirect")


def google_json(url, token=None, form=None):
    # URLs are built only from fixed provider endpoints and validated file IDs.
    headers = {"Authorization": "Bearer " + token} if token else {}
    body = urllib.parse.urlencode(form).encode() if form else None
    request = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
        raw = response.read(MAX_BODY + 1)
    if len(raw) > MAX_BODY:
        raise ValueError("Provider response too large")
    return json.loads(raw)


def validate_anon_key(value):
    if not isinstance(value, str) or len(value) > 4096:
        raise ValueError("Only the public Haven API key is accepted")
    if re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]{20,200}", value):
        return value
    try:
        parts = value.split(".")
        claims = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
        if len(parts) != 3 or claims.get("role") != "anon" or claims.get("ref") != "manfqmasfqppukpobpld":
            raise ValueError()
    except Exception:
        raise ValueError("Only this project's public anon key is accepted; service credentials are forbidden") from None
    return value


def haven_json(path, anon_key, token=None, data=None):
    headers = {"apikey": anon_key, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    body = json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(HAVEN + path, data=body, headers=headers)
    with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError("Haven response exceeds limit")
    return json.loads(raw)


class Bootstrap:
    def __init__(self, client, picker, state_dir, original_id):
        self.client = client["web"]
        if REDIRECT not in self.client.get("redirect_uris", []):
            raise ValueError("Client must authorize the fixed loopback callback")
        self.picker = picker
        if not str(picker["app_id"]).isdigit() or not self.client["client_id"].startswith(str(picker["app_id"]) + "-"):
            raise ValueError("Picker and OAuth must use the same Cloud project")
        self.state_dir = Path(state_dir)
        self.original_id = original_id
        self.session = secrets.token_urlsafe(32)
        self.csrf = secrets.token_urlsafe(32)
        self.started = time.monotonic()
        self.pending = None
        self.token = None
        self.token_until = 0
        self.selected = {}
        self.phase = "ready_to_connect"
        self.haven_phase = "not_configured"
        self.haven_key = None
        self.facility_map = None

    def configure_haven(self, key, mapping):
        self.haven_key = validate_anon_key(key)
        if not isinstance(mapping, dict) or set(mapping) != FACILITY_NAMES or len(set(mapping.values())) != 5 or any(not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", str(v)) for v in mapping.values()):
            raise ValueError("Exact reviewed five-facility mapping required")
        self.facility_map = mapping
        self.haven_phase = "ready_for_operator_login"

    def haven_session_saved(self):
        """Report a validated saved connection, not current token validity."""
        try:
            saved = private_json(self.state_dir / "haven-credentials.json")
            return (self.facility_map is not None
                    and saved.get("organization_id") == HAVEN_ORG
                    and set(saved.get("facility_ids", [])) == set(self.facility_map.values())
                    and isinstance(saved.get("HAVEN_STAND_UP_REFRESH_TOKEN"), str)
                    and bool(saved["HAVEN_STAND_UP_REFRESH_TOKEN"]))
        except (OSError, ValueError, TypeError):
            return False

    def connect_haven(self, email, password):
        if not self.haven_key or not self.facility_map:
            raise ValueError("Haven public key and facility mapping are not configured")
        if not isinstance(email, str) or not 3 <= len(email) <= 254 or "@" not in email or not isinstance(password, str) or not 1 <= len(password) <= 1024:
            raise ValueError("Email and password required")
        self.haven_phase = "authenticating_operator"
        result = haven_json("/auth/v1/token?grant_type=password", self.haven_key, data={"email": email, "password": password})
        password = None  # Never persist or render credentials entered by the operator.
        token, refresh = result.get("access_token"), result.get("refresh_token")
        if not isinstance(token, str) or not token or not isinstance(refresh, str) or not refresh or not result.get("user", {}).get("id"):
            raise ValueError("A complete Haven user session is required")
        self.haven_phase = "verifying_stand_up_facilities"
        workspace = haven_json("/rest/v1/rpc/stand_up_command", self.haven_key, token, {"p_action": "workspace", "p_payload": {}})
        facilities = workspace.get("facilities", [])
        expected = set(self.facility_map.values())
        if not isinstance(facilities, list) or len(facilities) != 5 or {f.get("id") for f in facilities} != expected:
            raise ValueError("Operator must have access to exactly the reviewed five facilities")
        self.haven_phase = "verifying_haven_organization"
        path = "/rest/v1/facilities?" + urllib.parse.urlencode({"select": "id,organization_id", "id": "in.(" + ",".join(sorted(expected)) + ")"})
        rows = haven_json(path, self.haven_key, token)
        if not isinstance(rows, list) or len(rows) != 5 or {r.get("id") for r in rows} != expected or any(r.get("organization_id") != HAVEN_ORG for r in rows):
            raise ValueError("Facility organization verification failed")
        store_private(self.state_dir, "haven-credentials.json", {"HAVEN_STAND_UP_REFRESH_TOKEN": refresh, "authorized_at": int(time.time()), "actor_id": result["user"]["id"], "organization_id": HAVEN_ORG, "facility_ids": sorted(expected)})
        self.haven_phase = "operator_session_saved"

    def resume(self):
        """Explicitly resume only this client and exactly the approved scope."""
        self.phase = "resume_credentials_validation"
        saved = private_json(self.state_dir / "credentials.json")
        if saved.get("client_id") != self.client["client_id"] or saved.get("scope") != SCOPE or not isinstance(saved.get("GOOGLE_REFRESH_TOKEN"), str) or not saved["GOOGLE_REFRESH_TOKEN"]:
            raise ValueError("Stored authorization does not match this client and scope")
        self.phase = "resume_token_exchange"
        result = google_json("https://oauth2.googleapis.com/token", form={
            "client_id": self.client["client_id"], "client_secret": self.client["client_secret"],
            "refresh_token": saved["GOOGLE_REFRESH_TOKEN"], "grant_type": "refresh_token",
        })
        self.phase = "resume_token_validation"
        if set(result.get("scope", "").split()) != {SCOPE} or result.get("token_type", "").lower() != "bearer" or not result.get("access_token"):
            raise ValueError("Provider did not return the approved permission")
        if result.get("refresh_token"):
            saved["GOOGLE_REFRESH_TOKEN"] = result["refresh_token"]
            store_private(self.state_dir, "credentials.json", saved)
        self.token_until = time.monotonic() + min(int(result.get("expires_in", 0)), 3600) - 60
        if self.token_until <= time.monotonic():
            raise ValueError("Provider access token is already expired")
        self.token = result["access_token"]
        selection_path = self.state_dir / "files.json"
        if selection_path.exists():
            saved_files = private_json(selection_path).get("files", {})
            if not isinstance(saved_files, dict) or not set(saved_files).issubset({"original", "rehearsal"}):
                raise ValueError("Stored selection roles are invalid")
            retained = {}
            for role, selected in saved_files.items():
                file_id = selected.get("id")
                meta = self.validate_selection(role, file_id)
                retained[role] = {"id": file_id, "name": meta["name"], "mime_type": XLSX, "selected_at": selected.get("selected_at")}
            self.selected = retained
        self.phase = "google_connected"

    def begin(self):
        self.token = None
        self.selected = {}
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        self.pending = (state, verifier, time.monotonic())
        self.phase = "awaiting_google_consent"
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
            "client_id": self.client["client_id"], "redirect_uri": REDIRECT,
            "response_type": "code", "scope": SCOPE, "access_type": "offline",
            "prompt": "consent", "state": state, "code_challenge": challenge,
            "code_challenge_method": "S256",
        })

    def callback(self, query):
        pending = self.pending
        if not pending or len(query.get("state", [])) != 1 or not hmac.compare_digest(query["state"][0], pending[0]):
            raise ValueError("Invalid authorization state")
        self.pending = None  # Valid state is single-use, including denied/failed exchanges.
        if time.monotonic() - pending[2] > 600 or "error" in query or len(query.get("code", [])) != 1:
            raise ValueError("Authorization expired or denied")
        self.phase = "authorization_code_exchange"
        result = google_json("https://oauth2.googleapis.com/token", form={
            "client_id": self.client["client_id"], "client_secret": self.client["client_secret"],
            "code": query["code"][0], "code_verifier": pending[1], "redirect_uri": REDIRECT,
            "grant_type": "authorization_code",
        })
        if set(result.get("scope", "").split()) != {SCOPE} or result.get("token_type", "").lower() != "bearer":
            raise ValueError("Expected only the requested drive.file permission")
        if not result.get("refresh_token") or not result.get("access_token"):
            raise ValueError("Offline authorization was not returned; reconnect")
        # Invalidate prior account/file selections before replacing credentials.
        store_private(self.state_dir, "files.json", {"files": {}, "complete": False, "sync_enabled": False})
        self.selected = {}
        store_private(self.state_dir, "credentials.json", {
            "GOOGLE_REFRESH_TOKEN": result["refresh_token"], "scope": SCOPE,
            "authorized_at": int(time.time()), "client_id": self.client["client_id"],
        })
        self.token = result["access_token"]
        self.token_until = time.monotonic() + min(int(result.get("expires_in", 0)), 3600) - 60

        self.phase = "google_connected"

    def configure_picker(self, data):
        key = data.get("browser_api_key", "")
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{20,200}", key):
            raise ValueError("Invalid browser API key")
        configured = {"app_id": str(self.picker["app_id"]), "browser_api_key": key}
        store_private(self.state_dir, "picker-config.json", configured)
        self.picker = configured
        self.phase = "picker_key_saved"

    def picker_config(self):
        if not self.token or time.monotonic() >= self.token_until:
            raise ValueError("Connect to Google first")
        if not self.picker.get("browser_api_key"):
            raise ValueError("Save the restricted browser API key first")
        return {"access_token": self.token, "app_id": str(self.picker["app_id"]), "browser_api_key": self.picker["browser_api_key"]}

    def validate_selection(self, role, file_id):
        self.picker_config()
        if role not in ("original", "rehearsal") or not isinstance(file_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{10,200}", file_id):
            raise ValueError("Invalid file selection")
        if (role == "original") != (file_id == self.original_id):
            raise ValueError("Choose the known original, or a distinct rehearsal copy")
        self.phase = "selected_file_metadata_validation"
        meta = google_json("https://www.googleapis.com/drive/v3/files/" + file_id + "?" + urllib.parse.urlencode({"fields": "id,name,mimeType,trashed,capabilities(canEdit)", "supportsAllDrives": "true"}), token=self.token)
        if meta.get("id") != file_id or meta.get("mimeType") != XLSX or meta.get("trashed") is not False or not meta.get("capabilities", {}).get("canEdit"):
            raise ValueError("Select an editable, non-trashed XLSX workbook")
        return meta

    def select(self, data):
        role, file_id = data.get("role"), data.get("id")
        meta = self.validate_selection(role, file_id)
        selected = {**self.selected, role: {"id": file_id, "name": meta["name"], "mime_type": XLSX, "selected_at": int(time.time())}}
        store_private(self.state_dir, "files.json", {"files": selected, "complete": set(selected) == {"original", "rehearsal"}, "sync_enabled": False})
        self.selected = selected
        self.phase = "both_files_selected" if len(selected) == 2 else "one_file_selected"
        return {"name": meta["name"], "complete": len(selected) == 2}


PAGE = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Haven Google connection</title>
<style>body{font:18px system-ui;max-width:760px;margin:50px auto;padding:20px;color:#183732}button{padding:14px;margin:8px 0;display:block;font:inherit}#status{white-space:pre-wrap}</style>
<h1>Connect the Stand Up workbook</h1>__CONNECTION_STATUS__<p><a href="/haven">Connect an existing Haven operator account</a></p><p>Authorize Google, then choose the original workbook and a separate rehearsal copy. This setup reads file details only. Synchronization stays off.</p>
<form method="post" action="/picker-key"><input type="hidden" name="csrf" value="__CSRF__"><label for="browser-key">Restricted Google Picker browser API key</label><input id="browser-key" name="browser_api_key" type="password" autocomplete="off" required minlength="20" maxlength="200"><button>Save browser API key</button></form>
<form method="post" action="/connect"><input type="hidden" name="csrf" value="__CSRF__"><button>1. Connect to Google</button></form>
<button id="original" disabled>2. Choose original workbook</button><button id="rehearsal" disabled>3. Choose rehearsal copy</button><p id="status" role="status">Loading file selector…</p>
<script nonce="__NONCE__">
const csrf='__CSRF__'; const status=document.getElementById('status');
async function choose(role){try{status.textContent='Preparing Google file selector…';const r=await fetch('/picker-config',{headers:{'X-CSRF-Token':csrf}});if(!r.ok)throw Error('Connect to Google first.');const config=await r.json();
status.textContent='Google file selector requested. If blank, check the restricted key allows this local origin and docs.google.com, with both Picker and Drive APIs.';
const view=new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes('__XLSX__').setMode(google.picker.DocsViewMode.LIST);
new google.picker.PickerBuilder().addView(view).setAppId(config.app_id).setDeveloperKey(config.browser_api_key).setOAuthToken(config.access_token).setOrigin(location.origin).setCallback(async data=>{
if(data.action!==google.picker.Action.PICKED)return;try{const response=await fetch('/select',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({role,id:data.docs[0].id})});const result=await response.json();if(!response.ok)throw Error(result.error);status.textContent=role+': '+result.name+(result.complete?'\\nBoth files selected. Synchronization remains off pending rehearsal.':'\\nChoose the other workbook next.');}catch(e){status.textContent=e.message;}}).build().setVisible(true);
}catch(e){status.textContent=e.message;}}
window.pickerLoaded=()=>gapi.load('picker',()=>{for(const role of ['original','rehearsal']){const button=document.getElementById(role);button.disabled=false;button.onclick=()=>choose(role);}fetch('/status',{headers:{'X-CSRF-Token':csrf}}).then(r=>r.json()).then(s=>{status.textContent=s.connected?'Google connected. Select the original and rehearsal workbooks.':'Connect to Google, then select both workbooks.';}).catch(()=>{status.textContent='Local status check failed. Reload this page.';});});
const loader=document.createElement('script');loader.src='https://apis.google.com/js/api.js';loader.nonce='__NONCE__';loader.onload=window.pickerLoaded;loader.onerror=()=>{status.textContent='Google file selector library could not load.';};document.head.appendChild(loader);
</script></html>'''


HAVEN_PAGE = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Haven operator connection</title>
<style>body{font:18px system-ui;max-width:680px;margin:50px auto;padding:20px;color:#183732}label,input,button{display:block;margin:12px 0;font:inherit}input,button{padding:10px;max-width:100%}</style>
<h1>Connect your Haven account</h1><p>Use your existing Haven login to authorize this Stand Up integration. The password is sent only to Haven and is not saved. A separate refresh token is saved privately after your five-facility access is verified.</p>
<p>Submitting replaces this connector's previously saved Haven session only after validation. Google authorization and workbook selections stay unchanged.</p>
<form method="post" action="/haven-connect"><input type="hidden" name="csrf" value="__CSRF__"><label for="haven-email">Haven email</label><input id="haven-email" name="email" type="email" autocomplete="username" required maxlength="254"><label for="haven-password">Haven password</label><input id="haven-password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><button>Authorize and replace this connector's Haven session</button></form>
<p role="status">Status: __HAVEN_PHASE__</p><a href="/">Return to Google connection</a></html>'''

HAVEN_SAVED_PAGE = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Haven connection saved</title>
<style>body{font:18px system-ui;max-width:680px;margin:50px auto;padding:20px;color:#183732}a{display:block;margin:20px 0}</style>
<h1>Haven connection saved</h1><p role="status">Your sign-in succeeded. Access to all five facilities was verified when this session was saved.</p>
<p>You do not need to enter your password again. The connector saved a separate session, not your password.</p>
<p>Your account setup is complete. The connector manages spreadsheet synchronization separately from this sign-in.</p>
<a href="/">View Google connection</a><a href="/haven?reconnect=1">Use a different Haven account or reconnect</a></html>'''


class Handler(BaseHTTPRequestHandler):
    server_version = "HavenLocal"
    def log_message(self, *_):
        pass  # Never log callback URLs, request bodies or credentials.

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    @property
    def app(self):
        return self.server.app

    def reply(self, status, body=b"", content_type="application/json", headers=None):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "strict-origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def guard(self, session=True, mutation=False):
        if self.headers.get_all("Host") != ["localhost:8766"] or len(self.path) > MAX_BODY or time.monotonic() - self.app.started > 3600:
            raise ValueError("Invalid local request")
        origin = self.headers.get("Origin")
        if origin is not None and origin != ORIGIN:
            raise ValueError("Invalid origin")
        if mutation and origin != ORIGIN:
            raise ValueError("Same-origin request required")
        if session:
            cookie = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
            if "haven_connect" not in cookie or not hmac.compare_digest(cookie["haven_connect"].value, self.app.session):
                raise ValueError("Missing local session")

    def do_GET(self):
        try:
            path = urllib.parse.urlsplit(self.path)
            self.guard(session=path.path in ("/oauth/callback", "/picker-config", "/status"))
            if path.path == "/haven":
                reconnect = urllib.parse.parse_qs(path.query).get("reconnect") == ["1"]
                page = HAVEN_SAVED_PAGE if self.app.haven_session_saved() and not reconnect else HAVEN_PAGE.replace("__CSRF__", self.app.csrf).replace("__HAVEN_PHASE__", self.app.haven_phase)
                self.reply(200, page, "text/html; charset=utf-8", {"Set-Cookie": f"haven_connect={self.app.session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"})
            elif path.path == "/":
                nonce = secrets.token_urlsafe(24)
                connected = bool(self.app.token and time.monotonic() < self.app.token_until)
                summary = "<p>Google connected.</p>" if connected else "<p>Google is not connected in this local session.</p>"
                if self.app.selected:
                    summary += "<ul>" + "".join("<li>" + html.escape(role.title() + ": " + selected["name"]) + "</li>" for role, selected in self.app.selected.items()) + "</ul>"
                page = PAGE.replace("__CSRF__", self.app.csrf).replace("__NONCE__", nonce).replace("__XLSX__", XLSX).replace("__CONNECTION_STATUS__", summary)
                if self.app.picker.get("browser_api_key"):
                    page = page.replace('<form method="post" action="/picker-key">', '<form method="post" action="/picker-key" hidden>')
                if connected:
                    page = page.replace("1. Connect to Google", "Reconnect Google (clears workbook selections)")
                csp = f"default-src 'none'; script-src 'nonce-{nonce}' https://apis.google.com; style-src 'unsafe-inline'; connect-src 'self' https://*.googleapis.com https://docs.google.com; frame-src https://docs.google.com https://drive.google.com; img-src https://*.google.com data:; form-action 'self' https://accounts.google.com; base-uri 'none'; frame-ancestors 'none'"
                self.reply(200, page, "text/html; charset=utf-8", {"Set-Cookie": f"haven_connect={self.app.session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600", "Content-Security-Policy": csp})
            elif path.path == "/oauth/callback":
                self.app.callback(urllib.parse.parse_qs(path.query, keep_blank_values=True, max_num_fields=20))
                self.reply(303, headers={"Location": "/"})
            elif path.path == "/status":
                if not hmac.compare_digest(self.headers.get("X-CSRF-Token", ""), self.app.csrf):
                    raise ValueError("Invalid session token")
                self.reply(200, json.dumps({"phase": self.app.phase, "haven_phase": self.app.haven_phase, "connected": bool(self.app.token and time.monotonic() < self.app.token_until), "picker_key_saved": bool(self.app.picker.get("browser_api_key"))}))
            elif path.path == "/picker-config":
                if not hmac.compare_digest(self.headers.get("X-CSRF-Token", ""), self.app.csrf):
                    raise ValueError("Invalid session token")
                self.reply(200, json.dumps(self.app.picker_config()))
            else:
                self.reply(404)
        except Exception:
            self.reply(400, json.dumps({"error": "Connection request rejected. Return to the local setup page and reconnect.", "phase": self.app.phase}))

    def do_POST(self):
        try:
            self.guard(mutation=True)
            lengths = self.headers.get_all("Content-Length") or []
            if len(lengths) != 1 or not lengths[0].isdigit() or not 0 < int(lengths[0]) <= MAX_BODY or self.headers.get("Transfer-Encoding"):
                raise ValueError("Invalid request size")
            raw = self.rfile.read(int(lengths[0]))
            if self.path == "/haven-connect":
                if self.headers.get("Content-Type") != "application/x-www-form-urlencoded":
                    raise ValueError("Invalid login form")
                data = urllib.parse.parse_qs(raw.decode(), keep_blank_values=True, max_num_fields=3)
                if data.get("csrf") != [self.app.csrf] or len(data.get("email", [])) != 1 or len(data.get("password", [])) != 1:
                    raise ValueError("Invalid session token")
                self.app.connect_haven(data["email"][0], data["password"][0])
                data.clear()
                self.reply(303, headers={"Location": "/haven"})
            elif self.path == "/picker-key":
                data = urllib.parse.parse_qs(raw.decode(), max_num_fields=2)
                if data.get("csrf") != [self.app.csrf] or len(data.get("browser_api_key", [])) != 1:
                    raise ValueError("Invalid session token")
                self.app.configure_picker({"browser_api_key": data["browser_api_key"][0]})
                self.reply(303, headers={"Location": "/"})
            elif self.path == "/connect":
                data = urllib.parse.parse_qs(raw.decode(), max_num_fields=2)
                if data.get("csrf") != [self.app.csrf]:
                    raise ValueError("Invalid session token")
                self.reply(303, headers={"Location": self.app.begin()})
            elif self.path == "/select":
                if self.headers.get("Content-Type") != "application/json" or not hmac.compare_digest(self.headers.get("X-CSRF-Token", ""), self.app.csrf):
                    raise ValueError("Invalid session token")
                self.reply(200, json.dumps(self.app.select(json.loads(raw))))
            else:
                self.reply(404)
        except Exception:
            if self.path == "/haven-connect":
                self.reply(400, json.dumps({"error": "Haven connection failed. Check your login and five-facility access; no new session saved.", "phase": self.app.haven_phase}))
                return
            self.reply(400, json.dumps({"error": "Request rejected. Select the correct editable XLSX workbook, or reconnect.", "phase": self.app.phase}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--haven-config", help="Private JSON containing anon_key; service keys refused")
    parser.add_argument("--facility-map", help="Reviewed JSON mapping all five facility names to UUIDs")
    parser.add_argument("--resume", action="store_true", help="Refresh existing private authorization without another consent")
    parser.add_argument("--client-file", required=True)
    parser.add_argument("--picker-config", help="Optional private JSON; key can also be entered locally")
    parser.add_argument("--app-id", help="Cloud project number when no picker config exists")
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--original-id", default="1rUozaY9YLhD77lS_jjdRbUW2LsdvgS1r")
    args = parser.parse_args()
    picker_path = Path(args.picker_config) if args.picker_config else Path(args.state_dir) / "picker-config.json"
    picker = private_json(picker_path) if picker_path.exists() else {"app_id": args.app_id}
    app = Bootstrap(private_json(args.client_file), picker, args.state_dir, args.original_id)
    if bool(args.haven_config) != bool(args.facility_map):
        parser.error("Haven key and facility mapping must be supplied together")
    if args.haven_config:
        haven_config = private_json(args.haven_config)
        if haven_config.get("url") != HAVEN:
            parser.error("Haven configuration must name the fixed production project")
        app.configure_haven(haven_config["anon_key"], private_json(args.facility_map))
    if args.resume:
        try:
            app.resume()
        except Exception:
            raise SystemExit("Resume failed at phase: " + app.phase + ". No token or provider details logged.") from None
        print("Existing Google authorization resumed.", flush=True)
    server = HTTPServer(("127.0.0.1", 8766), Handler)
    server.app = app
    print("Open http://localhost:8766 — local setup only; synchronization remains off.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
