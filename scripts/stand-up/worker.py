"""Explicitly configured Stand Up bridge; run once under a supervisor every minute.

No browser credentials are read. Google writes are conditional and fail closed.
Secrets and pending requests live only in the operator's private state directory.
"""
from __future__ import annotations

import argparse
import base64
import fcntl
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import io
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from workbook import FACILITIES, KEYS, MAX_BYTES, WorkbookError, parse_workbook, patch_workbook, overtime_minutes

HAVEN = "https://manfqmasfqppukpobpld.supabase.co"
FRONT_OFFICE = "https://wecsjfiituxlityaacba.supabase.co/functions/v1/ingest"
PREFIXES = dict(zip(FACILITIES, ("homewood", "oakridge", "rising_oaks", "plantation", "grande_cypress")))
HISTORY_REFRESH_INTERVAL = timedelta(hours=6)


class BridgeError(RuntimeError):
    pass


class HttpFailure(BridgeError):
    def __init__(self, status):
        self.status = status
        super().__init__(f"Provider returned HTTP {status}; no successful synchronization recorded")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise BridgeError("Unexpected redirect refused")


def http(url, method="GET", body=None, headers=None):
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=25) as response:
            raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise BridgeError("Provider response exceeds size limit")
            return raw, response.headers
    except urllib.error.HTTPError as exc:
        raise HttpFailure(exc.code) from None
    except (urllib.error.URLError, TimeoutError) as exc:
        raise BridgeError("Provider outcome unknown; retained pending request for readback/retry") from exc


def compact(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise BridgeError("Missing configuration: " + name)
    return value


def reporting_week(now=None):
    day = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo("America/New_York")).date()
    return day + timedelta(days=1 if day.weekday() == 6 else -day.weekday())


def reject_history_state(data):
    if any(key.startswith("history_") for key in data):
        raise BridgeError("History-bound state cannot be used by the current publisher or Google connector")


class State:
    def __init__(self, directory, *, history=False):
        self.directory = Path(directory).expanduser().resolve()
        self.path = self.directory / "state.json"
        # Refuse an existing history identity before creating/changing its lock file.
        if not history and self.path.exists():
            reject_history_state(json.loads(self.path.read_text()))
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.directory.stat().st_mode & 0o077:
            raise BridgeError("State directory must be private (mode 0700)")
        self.lock = (self.directory / "worker.lock").open("a+")
        os.chmod(self.lock.name, 0o600)
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise BridgeError("Another bridge worker owns this state") from exc
        self.data = json.loads(self.path.read_text()) if self.path.exists() else {"baselines": {}}
        if not history:
            reject_history_state(self.data)  # Recheck after acquiring the lock.

    def save(self):
        temporary = self.directory / "state.next"
        descriptor = os.open(temporary, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(compact(self.data))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, self.path)
        directory_fd = os.open(self.directory, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)


class Haven:
    def __init__(self, state):
        reject_history_state(state.data)
        self.state = state
        self.anon = required("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        refresh = state.data.get("haven_refresh_token") or required("HAVEN_STAND_UP_REFRESH_TOKEN")
        raw, _ = http(HAVEN + "/auth/v1/token?grant_type=refresh_token", "POST", compact({"refresh_token": refresh}), {"apikey": self.anon, "content-type": "application/json"})
        result = json.loads(raw)
        self.token = result["access_token"]
        state.data["haven_refresh_token"] = result["refresh_token"]
        state.save()  # Persist rotated token before making any business command.

    def command(self, action, payload):
        reject_history_state(self.state.data)
        raw, _ = http(HAVEN + "/rest/v1/rpc/stand_up_command", "POST", compact({"p_action": action, "p_payload": payload}), {"apikey": self.anon, "authorization": "Bearer " + self.token, "content-type": "application/json"})
        return json.loads(raw)

    def mutate(self, action, payload):
        reject_history_state(self.state.data)
        pending = self.state.data.get("haven_pending")
        if pending:
            raise BridgeError("Resume the prior Haven command before a new mutation")
        payload = dict(payload)
        if action in ("save", "commit_recovery", "stage_import"):
            payload.setdefault("request_id", str(uuid.uuid4()))
        self.state.data["haven_pending"] = {"action": action, "payload": payload}
        self.state.save()
        return self.resume()

    def resume(self):
        reject_history_state(self.state.data)
        pending = self.state.data.get("haven_pending")
        if not pending:
            return None
        try:
            result = self.command(pending["action"], pending["payload"])
        except HttpFailure as exc:
            if exc.status in (400, 403, 404, 409, 422):
                self.state.data["last_command_rejection"] = {"action": pending["action"], "status": exc.status}
                self.state.data.pop("haven_pending")
                self.state.save()
            raise
        self.state.data.pop("haven_pending")
        self.state.save()
        return result


class Google:
    def __init__(self):
        form = urllib.parse.urlencode({"client_id": required("GOOGLE_CLIENT_ID"), "client_secret": required("GOOGLE_CLIENT_SECRET"), "refresh_token": required("GOOGLE_REFRESH_TOKEN"), "grant_type": "refresh_token"}).encode()
        raw, _ = http("https://oauth2.googleapis.com/token", "POST", form, {"content-type": "application/x-www-form-urlencoded"})
        self.token = json.loads(raw)["access_token"]

    def metadata(self, file_id):
        fields = "id,mimeType,etag,version,headRevisionId,md5Checksum,fileSize,labels(trashed)"
        raw, _ = http("https://www.googleapis.com/drive/v2/files/" + urllib.parse.quote(file_id, safe="") + "?" + urllib.parse.urlencode({"fields": fields, "supportsAllDrives": "true"}), headers={"authorization": "Bearer " + self.token})
        meta = json.loads(raw)
        if (meta.get("id") != file_id or meta.get("mimeType") != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                or meta.get("labels", {}).get("trashed") is not False or not strong_etag(meta.get("etag"))
                or not isinstance(meta.get("version"), str) or not meta["version"].isdigit()
                or not isinstance(meta.get("headRevisionId"), str) or not meta["headRevisionId"]
                or not re.fullmatch(r"[a-fA-F0-9]{32}", str(meta.get("md5Checksum", "")))
                or not isinstance(meta.get("fileSize"), str) or not meta["fileSize"].isdigit()
                or not 0 < int(meta["fileSize"]) <= MAX_BYTES):
            raise BridgeError("Google snapshot metadata lacks a valid binary revision and strong ETag")
        return meta

    def download(self, file_id):
        # Google can briefly expose changing metadata just after a write. Retry
        # only complete read-only snapshots, never carry an old ETag forward.
        for attempt in range(3):
            before = self.metadata(file_id)  # Malformed metadata fails immediately.
            raw, _ = http("https://www.googleapis.com/drive/v3/files/" + urllib.parse.quote(file_id, safe="") + "?alt=media&supportsAllDrives=true", headers={"authorization": "Bearer " + self.token})
            after = self.metadata(file_id)
            if before != after:
                reason = "metadata_changed"
            elif len(raw) != int(before["fileSize"]) or hashlib.md5(raw).hexdigest() != before["md5Checksum"].lower():
                reason = "checksum_or_size_mismatch"
            else:
                return raw, {"ETag": before["etag"], "X-Haven-Drive-Version": before["version"], "X-Haven-Drive-Head-Revision": before["headRevisionId"]}
            print(json.dumps({"google_snapshot": reason, "attempt": attempt + 1, "read_only": True}), file=sys.stderr)
            if attempt < 2:
                time.sleep(0.25 * (attempt + 1))
        raise BridgeError("Workbook snapshot did not stabilize after three complete reads (" + reason + "); no stable snapshot or write")

    def upload(self, file_id, data, etag):
        if not strong_etag(etag):
            raise BridgeError("A strong observed ETag is required; conditional overwrite is unavailable")
        # Live rehearsal proved v3 media PATCH ignored If-Match; v2 PUT rejected
        # a previously valid stale ETag. Never silently fall back to v3 writes.
        return http("https://www.googleapis.com/upload/drive/v2/files/" + urllib.parse.quote(file_id, safe="") + "?uploadType=media&supportsAllDrives=true", "PUT", data, {"authorization": "Bearer " + self.token, "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "If-Match": etag})


def strong_etag(value):
    return isinstance(value, str) and bool(re.fullmatch(r'"[\x21\x23-\x7e]+"', value))


class HistoryReader:
    """Service-only bounded archive; no Google or operator mutation methods."""
    def __init__(self, from_week, to_week):
        self.from_week, self.to_week = from_week, to_week
        if (from_week.weekday() != 0 or to_week.weekday() != 0
                or not 0 <= (to_week - from_week).days <= 721):
            raise BridgeError("History requires a Monday range of at most 104 weeks")
        self.key = required("SUPABASE_SERVICE_ROLE_KEY")
        self.organization = required("STAND_UP_ORGANIZATION_ID")
        uuid.UUID(self.organization)

    def archive(self):
        raw, _ = http(HAVEN + "/rest/v1/rpc/stand_up_export_history", "POST", compact({
            "p_organization_id": self.organization, "p_from_week": self.from_week.isoformat(),
            "p_to_week": self.to_week.isoformat()}), {"apikey": self.key,
            "authorization": "Bearer " + self.key, "content-type": "application/json"})
        return json.loads(raw)


class AggregateReader:
    """Haven-hosted publisher can only invoke the aggregate export RPC here."""
    def __init__(self, week):
        self.week = week
        self.key = required("SUPABASE_SERVICE_ROLE_KEY")
        self.organization = required("STAND_UP_ORGANIZATION_ID")
        uuid.UUID(self.organization)

    def workspace(self):
        raw, _ = http(HAVEN + "/rest/v1/rpc/stand_up_export_aggregate", "POST", compact({"p_organization_id": self.organization, "p_week_start": self.week.isoformat()}), {"apikey": self.key, "authorization": "Bearer " + self.key, "content-type": "application/json"})
        return json.loads(raw)


def file_target(mode):
    rehearsal = required("STAND_UP_REHEARSAL_FILE_ID")
    production = required("STAND_UP_PRODUCTION_FILE_ID")
    if rehearsal == production:
        raise BridgeError("Rehearsal and production file IDs must differ")
    if mode == "production":
        proof = json.loads(Path(required("STAND_UP_PROVIDER_PROOF")).read_text())
        if proof.get("transport") != "drive-v2-conditional-media-put" or not proof.get("real_stale_etag_rejection") or proof.get("rehearsal_file_id") != rehearsal or not proof.get("conditional_rejection") or not proof.get("unknown_outcome_readback") or not proof.get("recalculation_verified"):
            raise BridgeError("Production requires retained rehearsal conditional-write and recovery evidence")
        return production
    return rehearsal


def source_payload(workspace, facility_map, week, sequence, now=None):
    reports = [r for r in workspace["reports"] if r["week_start"] == week.isoformat()]
    by_facility = {r["facility_id"]: r for r in reports}
    if len(by_facility) != len(reports):
        raise BridgeError("Duplicate source facility/week")
    rows = [{"metric": "week_of_day", "value": (week - date(1970, 1, 1)).days}, {"metric": "expected_facilities", "value": 5}]
    times = []
    for name in FACILITIES:
        prefix = PREFIXES[name]
        report = by_facility.get(facility_map[name])
        if report and set(report["values"]) != set(KEYS):
            raise BridgeError("Unexpected source metric contract")
        reported = report is not None and any(value is not None for value in report["values"].values())
        rows.extend([{"metric": prefix + "_reported", "value": int(reported)}, {"metric": prefix + "_ready", "value": int(reported and report["status"] == "ready")}, {"metric": prefix + "_revision", "value": report["version"] if report else 0}])
        if report:
            raw_overtime = report["values"]["overtime_reported"]
            try:
                minutes = overtime_minutes(raw_overtime)
                issue = False
            except WorkbookError:
                minutes, issue = None, True
            if "overtime_minutes" in report and report["overtime_minutes"] != minutes:
                raise BridgeError("Canonical overtime does not match retained HH.MM source")
            if "overtime_issue" in report and report["overtime_issue"] is not issue:
                raise BridgeError("Canonical overtime review flag does not match source")
            rows.append({"metric": prefix + "_overtime_issue", "value": int(issue)})
            if minutes is not None:
                rows.append({"metric": prefix + "_overtime_minutes", "value": minutes})
            if "entry_origin" in report:
                origins = {"initialized": 0, "imported": 1, "manual": 2, "recovery": 3}
                if report["entry_origin"] not in origins:
                    raise BridgeError("Unexpected source entry origin")
                rows.append({"metric": prefix + "_entry_origin", "value": origins[report["entry_origin"]]})
            for field, metric in (("first_submitted_at", "first_submitted_epoch"), ("last_submitted_at", "last_submitted_epoch")):
                if report.get(field):
                    rows.append({"metric": prefix + "_" + metric, "value": int(aware_timestamp(report[field]).timestamp())})
            rows.append({"metric": prefix + "_needs_resubmission", "value": int(bool(report.get("last_submitted_at")) and report["status"] != "ready")})
        if not reported:
            continue  # An empty recovery baseline is not submitted facility data.
        as_of = report.get("source_as_of")
        if as_of:
            stamp = datetime.fromisoformat(as_of.replace("Z", "+00:00"))
            rows.append({"metric": prefix + "_as_of_epoch", "value": int(stamp.timestamp())})
            times.append(stamp)
        else:
            times.append(datetime.combine(week, datetime.min.time(), timezone.utc))
        for key in KEYS:
            if report["values"][key] is not None:
                value = report["values"][key]
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise BridgeError("Non-numeric aggregate refused")
                rows.append({"metric": prefix + "_" + key, "value": value})
    observed_at = now or datetime.now(timezone.utc)
    as_of = min([observed_at, *times]) if times else observed_at
    return {"source": "col", "dataset": "standup_weekly", "contractVersion": 1, "batchId": str(uuid.uuid4()), "sequence": sequence, "sourceAsOf": as_of.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "mode": "full", "complete": True, "rows": rows}


def aware_timestamp(value):
    if not isinstance(value, str):
        raise BridgeError("Explicit timezone timestamp required")
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise BridgeError("Invalid archive timestamp") from exc
    if stamp.tzinfo is None:
        raise BridgeError("Explicit timezone timestamp required")
    return stamp


def history_payloads(archive, mapping, first_sequence):
    generated = aware_timestamp(archive.get("archive_as_of"))
    snapshots = archive.get("snapshots")
    if not isinstance(snapshots, list) or len(snapshots) > 312:
        raise BridgeError("History archive exceeds 104 weeks and three snapshot kinds")
    identities, results = set(), []
    for snapshot in sorted(snapshots, key=lambda x: (x["week_start"], x["kind"])):
        week = date.fromisoformat(snapshot["week_start"])
        kind = snapshot["kind"]
        if week.weekday() != 0 or isinstance(kind, bool) or kind not in (0, 1, 2):
            raise BridgeError("Invalid history Monday or snapshot kind")
        meeting_cutoff = datetime(week.year, week.month, week.day, 9, 15, tzinfo=ZoneInfo("America/New_York"))
        if kind == 2 and generated < meeting_cutoff:
            raise BridgeError("Meeting snapshot is unavailable before Monday 09:15 Eastern")
        identity = week.isoformat() + ":" + str(kind)
        if identity in identities:
            raise BridgeError("Duplicate history week and snapshot kind")
        identities.add(identity)
        if not set(mapping.values()).issubset({f["id"] for f in snapshot["facilities"]}):
            raise BridgeError("History mapping does not belong to configured organization")
        if any(r["facility_id"] not in mapping.values() or r["week_start"] != week.isoformat() for r in snapshot["reports"]):
            raise BridgeError("Unexpected history facility or reporting week")
        payload = source_payload(snapshot, mapping, week, first_sequence + len(results), generated)
        payload.update(dataset="standup_weekly_history", sourceAsOf=generated.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"))
        payload["rows"].extend([{"metric": "snapshot_kind", "value": kind},
                                {"metric": "archive_as_of_epoch", "value": int(generated.timestamp())}])
        results.append((identity, payload))
    return results


def publish_front_office_history(state, archive, mapping):
    """Independent durable history sequence. sourceAsOf is archive generation only."""
    if (state.data.get("baselines") or "file_id" in state.data or
            any(key.startswith(("front_office_", "google_", "haven_")) for key in state.data)):
        raise BridgeError("History requires its own state directory; current publisher state is untouched")
    key_id = required("FRONT_OFFICE_HISTORY_INGEST_KEY_ID")
    secret = required("FRONT_OFFICE_HISTORY_INGEST_SECRET")
    if len(secret.encode()) < 32:
        raise BridgeError("Front Office history HMAC secret must be at least 32 bytes")
    binding = {"key_id": key_id, "mapping": mapping, "dataset": "standup_weekly_history"}
    if state.data.get("history_binding", binding) != binding:
        raise BridgeError("History state belongs to a different key or facility mapping")
    state.data["history_binding"] = binding

    def drain():
        accepted = 0
        queue = state.data.get("history_pending_queue", [])
        while queue:
            pending = queue[0]
            body = pending["body"].encode()
            sent = str(int(time.time()))
            signature = hmac.new(secret.encode(), f"front-office-ingest-v1\nPOST\napplication/json\n{key_id}\n{sent}\n".encode() + body, hashlib.sha256).hexdigest()
            try:
                raw, _ = http(FRONT_OFFICE, "POST", body, {"content-type": "application/json", "x-ingest-key-id": key_id,
                    "x-ingest-sent-at": sent, "x-ingest-signature": signature})
            except HttpFailure as exc:
                state.data["history_rejection"] = {"status": exc.status, "sequence": pending["sequence"]}
                state.save()  # Retain exact pending evidence; no sequence is advanced.
                raise
            receipt = json.loads(raw)
            if not receipt.get("receiptId"):
                raise BridgeError("Missing Front Office history acceptance receipt")
            state.data.update(history_sequence=pending["sequence"], history_last_receipt=receipt["receiptId"], history_source_as_of=pending["source_as_of"])
            state.data.setdefault("history_fingerprints", {})[pending["identity"]] = pending["fingerprint"]
            state.data.setdefault("history_published_at", {})[pending["identity"]] = pending["source_as_of"]
            state.data.pop("history_rejection", None)
            queue.pop(0)
            state.save()
            accepted += 1
        return accepted

    accepted = drain()  # Readback/retry old archive before generating any new batch.
    generated = aware_timestamp(archive.get("archive_as_of"))
    last = state.data.get("history_source_as_of")
    if last and generated < aware_timestamp(last):
        raise BridgeError("Archive generation timestamp regressed; history publication refused")
    queue = []
    fingerprints = state.data.get("history_fingerprints", {})
    published_at = state.data.get("history_published_at", {})
    for identity, payload in history_payloads(archive, mapping, state.data.get("history_sequence", 0) + 1):
        comparable = [r for r in payload["rows"] if r["metric"] != "archive_as_of_epoch"]
        fingerprint = hashlib.sha256(compact(comparable)).hexdigest()
        last_published = published_at.get(identity)
        # Renew archive evidence even when figures are unchanged. This timestamp
        # means source archive generation, never a new facility observation.
        if (fingerprints.get(identity) == fingerprint and last_published
                and generated - aware_timestamp(last_published) < HISTORY_REFRESH_INTERVAL):
            continue
        payload["sequence"] = state.data.get("history_sequence", 0) + len(queue) + 1
        queue.append({"identity": identity, "body": compact(payload).decode(), "fingerprint": fingerprint,
                      "sequence": payload["sequence"], "source_as_of": payload["sourceAsOf"]})
    state.data["history_pending_queue"] = queue
    state.save()  # Whole immutable archive queue is durable before the first request.
    accepted += drain()
    return {"accepted": accepted, "unchanged": not bool(accepted)}


def publish_front_office(state, workspace, mapping, week):
    reject_history_state(state.data)
    key_id, secret = required("FRONT_OFFICE_INGEST_KEY_ID"), required("FRONT_OFFICE_INGEST_SECRET")
    if len(secret.encode()) < 32:
        raise BridgeError("Front Office HMAC secret must be at least 32 bytes")
    pending = state.data.get("front_office_pending")
    if not pending:
        payload = source_payload(workspace, mapping, week, state.data.get("front_office_sequence", 0) + 1)
        fingerprint = hashlib.sha256(compact({"rows": payload["rows"], "sourceAsOf": payload["sourceAsOf"]})).hexdigest()
        if fingerprint == state.data.get("front_office_fingerprint"):
            return "unchanged"
        pending = {"body": compact(payload).decode(), "fingerprint": fingerprint, "sequence": payload["sequence"]}
        state.data["front_office_pending"] = pending
        state.save()
    sent = str(int(time.time()))
    body = pending["body"].encode()
    signature = hmac.new(secret.encode(), f"front-office-ingest-v1\nPOST\napplication/json\n{key_id}\n{sent}\n".encode() + body, hashlib.sha256).hexdigest()
    try:
        raw, _ = http(FRONT_OFFICE, "POST", body, {"content-type": "application/json", "x-ingest-key-id": key_id, "x-ingest-sent-at": sent, "x-ingest-signature": signature})
    except HttpFailure as exc:
        if exc.status in (400, 401, 403, 404, 409, 413, 415, 422):
            state.data["front_office_rejection"] = {"status": exc.status, "sequence": pending["sequence"]}
            state.data.pop("front_office_pending")
            state.save()
        raise
    receipt = json.loads(raw)
    if not receipt.get("receiptId"):
        raise BridgeError("Missing Front Office acceptance receipt")
    state.data.update(front_office_sequence=pending["sequence"], front_office_fingerprint=pending["fingerprint"], front_office_last_receipt=receipt["receiptId"])
    state.data.pop("front_office_pending")
    state.save()
    return "accepted"


def recover_pending_google(state, google, file_id):
    reject_history_state(state.data)
    pending = state.data.get("google_pending")
    if not pending:
        return
    if pending["file_id"] != file_id:
        raise BridgeError("Pending write belongs to a different file; use its original mode/configuration")
    current, _ = google.download(file_id)
    digest = hashlib.sha256(current).hexdigest()
    if digest == pending["after_sha256"]:
        state.data["baselines"].update(pending["baselines"])
        state.data.pop("google_pending")
        state.save()
        return
    if digest != pending["before_sha256"]:
        raise BridgeError("Workbook changed after unknown write; preserve pending evidence and reconcile manually")
    try:
        google.upload(file_id, base64.b64decode(pending["bytes"]), pending["etag"])
    except HttpFailure as exc:
        if exc.status in (400, 401, 403, 404, 412):
            state.data.pop("google_pending")
            state.save()  # A definite rejection never advances the baseline.
        raise
    current, _ = google.download(file_id)
    if hashlib.sha256(current).hexdigest() != pending["after_sha256"]:
        raise BridgeError("Uploaded workbook readback differs; pending state retained")
    state.data["baselines"].update(pending["baselines"])
    state.data.pop("google_pending")
    state.data["google_last_sync"] = datetime.now(timezone.utc).isoformat()
    state.save()


def probe_google(state, google, file_id):
    """Rehearsal only: real stale-ETag rejection and durable exact-byte restoration."""
    reject_history_state(state.data)
    if state.data.get("probe_original"):
        if state.data.get("probe_file_id") != file_id:
            raise BridgeError("Interrupted probe belongs to a different rehearsal copy")
        original = base64.b64decode(state.data["probe_original"])
        current, headers = google.download(file_id)
        if hashlib.sha256(current).hexdigest() not in (state.data["probe_after"], hashlib.sha256(original).hexdigest()):
            raise BridgeError("Rehearsal changed during probe; original retained for operator recovery")
        if current != original:
            expected = state.data.get("probe_restore_etag")
            if expected and expected != headers.get("ETag"):
                raise BridgeError("Rehearsal revision changed before restoration; operator review required")
            state.data["probe_phase"] = "restoring"
            state.save()
            google.upload(file_id, original, headers.get("ETag"))
        restored, _ = google.download(file_id)
        if restored != original:
            raise BridgeError("Rehearsal restoration not verified")
        state.data.pop("probe_original")
        state.data["probe_phase"] = "interrupted_restored"
        state.save()
        raise BridgeError("Interrupted rehearsal restored; rerun probe for complete evidence")
    original, headers = google.download(file_id)
    if not strong_etag(headers.get("ETag")):
        raise BridgeError("No strong ETag returned; provider concurrency support not proven")
    # ZIP comments change bytes while preserving all visible values and formulas.
    def with_comment(label):
        buffer = io.BytesIO(original)
        with zipfile.ZipFile(buffer, 'a') as archive:
            archive.comment = (label + " " + str(uuid.uuid4())).encode()
        return buffer.getvalue()
    changed = with_comment("Haven rehearsal")
    stale_payload = with_comment("Haven stale-write rejection probe")
    state.data.update(probe_original=base64.b64encode(original).decode(), probe_after=hashlib.sha256(changed).hexdigest(),
                      probe_file_id=file_id, probe_phase="writing_unique_bytes", probe_original_etag=headers["ETag"])
    state.data.pop("probe_restore_etag", None)
    state.save()  # Original and unique expected digest are durable before any upload.
    try:
        google.upload(file_id, changed, headers["ETag"])
    except BridgeError:
        pass  # Resolve unknown outcomes by readback, never blind retries.
    actual, latest_headers = google.download(file_id)
    if actual != changed or latest_headers.get("ETag") == headers["ETag"]:
        raise BridgeError("Unique-byte write not confirmed with a new revision; original retained")
    state.data.update(probe_restore_etag=latest_headers["ETag"], probe_phase="rejecting_real_stale_etag")
    state.save()
    try:
        google.upload(file_id, stale_payload, headers["ETag"])
    except HttpFailure as exc:
        if exc.status != 412:
            raise
    else:
        raise BridgeError("Provider accepted a stale ETag; automatic overwrite must remain disabled")
    unchanged, unchanged_headers = google.download(file_id)
    if unchanged != changed or unchanged_headers != latest_headers:
        raise BridgeError("Workbook or revision changed during stale rejection; original retained")
    state.data["probe_phase"] = "restoring"
    state.save()
    google.upload(file_id, original, latest_headers["ETag"])
    restored, _ = google.download(file_id)
    if restored != original:
        raise BridgeError("Probe restore readback differs; original retained")
    proof = {"rehearsal_file_id": file_id, "transport": "drive-v2-conditional-media-put", "conditional_rejection": True,
             "real_stale_etag_rejection": True, "unknown_outcome_readback": True, "recalculation_verified": False,
             "restored_sha256": hashlib.sha256(original).hexdigest(), "verified_at": datetime.now(timezone.utc).isoformat()}
    state.data.pop("probe_original")
    state.data["probe_phase"] = "complete"
    state.data["provider_proof"] = proof
    state.save()
    proof_path = state.directory / "provider-proof.json"
    descriptor = os.open(proof_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(proof, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    print(json.dumps({"provider_probe": "passed", "restoration": "verified"}))


def synchronize(state, haven, google, mapping, week, mode, adopt=None):
    reject_history_state(state.data)
    file_id = file_target(mode)
    if state.data.get("file_id") not in (None, file_id):
        raise BridgeError("Use separate state directories for separate source files")
    state.data["file_id"] = file_id
    state.save()
    recover_pending_google(state, google, file_id)
    raw, headers = google.download(file_id)
    parsed = parse_workbook(raw, mapping, file_id, "Stand Up.xlsx", weeks=[week.isoformat()])
    if parsed["issues"]:
        state.data["google_status"] = {"state": "mapping_required", "issues": parsed["issues"]}
        state.save()
        raise BridgeError("Workbook mapping has unresolved issues; no file write")
    incoming = {r["facility_id"] + ":" + r["week_start"]: r["values"] for r in parsed["records"]}
    updates, baselines = {}, {}
    for name in FACILITIES:
        facility = mapping[name]
        identity = facility + ":" + week.isoformat()
        if identity not in parsed["locations"]:
            raise BridgeError("Current week block missing for a facility")
        values = incoming.get(identity, dict.fromkeys(KEYS))
        exported = haven.command("export", {"facility_id": facility, "week_start": week.isoformat()})
        baseline = state.data["baselines"].get(identity)
        if baseline:
            if values != baseline["file_values"]:
                scope = {"baseline_id": baseline["baseline_id"], "facility_id": facility, "week_start": week.isoformat(), "values": values}
                decision = haven.command("find_recovery", scope)
                if not decision.get("resolved_result"):
                    preview = haven.command("preview_recovery", scope)
                    if preview["conflicts"] or preview["clears"]:
                        state.data["google_status"] = {"state": "review_required", "facility_id": facility, "preview": preview}
                        state.save()
                        raise BridgeError("Outage changes need conflict/clear review in Haven; workbook unchanged")
                    haven.mutate("commit_recovery", {"preview_id": preview["preview_id"], "facility_id": facility, "week_start": week.isoformat(), "resolutions": {}, "confirm_clears": False})
                exported = haven.command("export", {"facility_id": facility, "week_start": week.isoformat()})
        elif exported["baseline_id"] is None and values == dict.fromkeys(KEYS) and exported["values"] == dict.fromkeys(KEYS):
            # A genuinely empty new week needs a revision so later outage edits
            # have an immutable three-way recovery baseline. No data is inferred.
            haven.mutate("save", {"facility_id": facility, "week_start": week.isoformat(), "expected_version": exported["version"],
                                  "values": dict.fromkeys(KEYS), "status": "draft", "as_of": None,
                                  "reason": "Empty weekly fallback initialization", "provenance": {"file_id": file_id, "schema_version": "standup-2026-v1"}})
            exported = haven.command("export", {"facility_id": facility, "week_start": week.isoformat()})
        elif values != exported["values"] or exported["baseline_id"] is None:
            if adopt not in ("file", "haven"):
                raise BridgeError("First synchronization needs explicit --adopt file|haven after reviewing both versions")
            if adopt == "file" or exported["baseline_id"] is None:
                chosen = values if adopt == "file" else exported["values"]
                haven.mutate("save", {"facility_id": facility, "week_start": week.isoformat(), "expected_version": exported["version"], "values": chosen, "status": "draft", "as_of": None, "reason": "Explicit initial workbook adoption", "provenance": {"file_id": file_id, "schema_version": "standup-2026-v1"}})
                exported = haven.command("export", {"facility_id": facility, "week_start": week.isoformat()})
        updates[identity] = exported["values"]
        baselines[identity] = {"baseline_id": exported["baseline_id"], "file_values": exported["values"]}
    if all(incoming.get(identity, dict.fromkeys(KEYS)) == values for identity, values in updates.items()):
        # Equality readback ties an immutable server baseline to the observed file state.
        state.data["baselines"].update(baselines)
        state.data["google_status"] = {"state": "synchronized", "checked_at": datetime.now(timezone.utc).isoformat()}
        state.save()
        return
    etag = headers.get("ETag")
    if not etag:
        raise BridgeError("Google returned no conditional-write ETag; no overwrite attempted")
    patched = patch_workbook(raw, parsed, updates)
    state.data["google_pending"] = {"file_id": file_id, "before_sha256": hashlib.sha256(raw).hexdigest(), "after_sha256": hashlib.sha256(patched).hexdigest(), "etag": etag, "bytes": base64.b64encode(patched).decode(), "baselines": baselines}
    state.save()
    recover_pending_google(state, google, file_id)
    state.data["google_status"] = {"state": "synchronized", "checked_at": datetime.now(timezone.utc).isoformat()}
    state.save()


def changed_prior_weeks(state, google, mapping, current_week, mode):
    reject_history_state(state.data)
    weeks = sorted({identity.rsplit(":", 1)[1] for identity in state.data["baselines"] if identity.rsplit(":", 1)[1] != current_week.isoformat()})
    if not weeks:
        return []
    file_id = file_target(mode)
    raw, _ = google.download(file_id)
    parsed = parse_workbook(raw, mapping, file_id, "Stand Up.xlsx", weeks=weeks)
    if parsed["issues"]:
        raise BridgeError("A prior baseline week changed layout; review backlog before Google writes")
    incoming = {r["facility_id"] + ":" + r["week_start"]: r["values"] for r in parsed["records"]}
    changed = set()
    for identity, baseline in state.data["baselines"].items():
        week = identity.rsplit(":", 1)[1]
        if week not in weeks:
            continue
        if identity not in parsed["locations"]:
            raise BridgeError("A prior baseline week disappeared; review rather than treating as deletion")
        if incoming.get(identity, dict.fromkeys(KEYS)) != baseline["file_values"]:
            changed.add(week)
    return [date.fromisoformat(week) for week in sorted(changed)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--facility-map", required=True)
    parser.add_argument("--week", help="Default is Eastern reporting Monday (upcoming Monday on Sunday)")
    parser.add_argument("--mode", choices=("rehearsal", "production"), default="rehearsal")
    parser.add_argument("--adopt", choices=("file", "haven"), help="Explicitly select initial authority; does not resolve later conflicts")
    parser.add_argument("--google", action="store_true")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--publish-history", action="store_true", help="Dedicated service-only archive publisher with separate state and HMAC key")
    parser.add_argument("--from-week", help="Inclusive history Monday")
    parser.add_argument("--to-week", help="Inclusive history Monday; range at most 104 weeks")
    parser.add_argument("--publisher-service", action="store_true", help="Haven-hosted aggregate read only; cannot be combined with Google or adoption")
    parser.add_argument("--probe-google", action="store_true", help="Rehearsal copy only; verifies conditional writes and restores exact original bytes")
    args = parser.parse_args()
    if args.publish_history and (not args.publisher_service or args.publish or args.google or args.probe_google or args.adopt or not args.from_week or not args.to_week):
        raise BridgeError("History publication requires isolated service mode, dates and its own state")
    if args.publisher_service and (not (args.publish or args.publish_history) or args.google or args.probe_google or args.adopt):
        raise BridgeError("Service publisher is aggregate-read-only; Google recovery needs an authenticated operator")
    if args.probe_google:
        if args.mode != "rehearsal":
            raise BridgeError("Provider probe may only target rehearsal")
        state = State(args.state_dir)
        reject_history_state(state.data)
        probe_google(state, Google(), file_target("rehearsal"))
        return
    if not args.google and not args.publish and not args.publish_history:
        parser.error("Choose --google and/or --publish")
    mapping = json.loads(Path(args.facility_map).read_text())
    if set(mapping) != set(FACILITIES) or len(set(mapping.values())) != 5:
        raise BridgeError("Exact five-facility mapping required")
    week = date.fromisoformat(args.week) if args.week else reporting_week()
    if week.weekday() != 0:
        raise BridgeError("Week must be Monday")
    state = State(args.state_dir, history=args.publish_history)
    if not args.publish_history:
        reject_history_state(state.data)
    if args.publish_history:
        archive = HistoryReader(date.fromisoformat(args.from_week), date.fromisoformat(args.to_week)).archive()
        result = publish_front_office_history(state, archive, mapping)
        print(json.dumps({"front_office_history": result, "google": "disabled", "checked_at": datetime.now(timezone.utc).isoformat()}))
        return
    if args.publisher_service:
        workspace = AggregateReader(week).workspace()
        if not set(mapping.values()).issubset({f["id"] for f in workspace["facilities"]}):
            raise BridgeError("Publisher mapping does not belong to the configured organization")
        result = publish_front_office(state, workspace, mapping, week)
        print(json.dumps({"front_office": result, "google": "disabled", "checked_at": datetime.now(timezone.utc).isoformat()}))
        return
    haven = Haven(state)
    workspace = haven.command("workspace", {})
    if not set(mapping.values()).issubset({f["id"] for f in workspace["facilities"]}):
        raise BridgeError("Bridge actor lacks all mapped facilities")
    def google_lane():
        haven.resume()
        google = Google()
        recover_pending_google(state, google, file_target(args.mode))
        for prior_week in changed_prior_weeks(state, google, mapping, week, args.mode):
            synchronize(state, haven, google, mapping, prior_week, args.mode)
        synchronize(state, haven, google, mapping, week, args.mode, args.adopt)
        return state.data.get("google_status", {}).get("state", "unknown")
    outcomes, failures = run_lanes(google_lane if args.google else None, (lambda: publish_front_office(state, haven.command("workspace", {}), mapping, week)) if args.publish else None)
    print(json.dumps({**outcomes, "failures": failures}))
    if failures:
        sys.exit(1)


def run_lanes(google_lane=None, publisher_lane=None):
    outcomes, failures = {"google": "disabled", "front_office": "disabled"}, []
    for name, action in (("google", google_lane), ("front_office", publisher_lane)):
        if action is None:
            continue
        try:
            outcomes[name] = action()
        except Exception as error:
            outcomes[name] = "failed"
            message = str(error) if isinstance(error, (BridgeError, WorkbookError)) else "Invalid local/provider configuration or response; no successful receipt recorded"
            failures.append({"lane": name, "error": message})
    return outcomes, failures


if __name__ == "__main__":
    try:
        main()
    except (BridgeError, WorkbookError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
