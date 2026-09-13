#!/usr/bin/env python3
"""Read-only source verification. No database, network, or working-tree writes.

Run from this checkout after fetching origin; redirect stdout to source-check.json.
Pinned upstreams are intentional: a moved main requires a new reconciliation.
"""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/facility-operations/col217-evidence"
MAIN = "50bc07c4c877b65e17f471895e4446ff11c4d69c"
INTEGRATION = "08fd3a43da2fbfaa42d2d37051774ab7d196eb07"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def sql_files(ref):
    return {
        Path(name).name: git("show", f"{ref}:{name}")
        for name in git("ls-tree", "-r", "--name-only", ref,
                        "supabase/migrations").decode().splitlines()
        if name.endswith(".sql")
    }


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


manifest = json.loads((EVIDENCE / "integration-manifest.json").read_text())
require(git("rev-parse", "origin/main").decode().strip() == MAIN,
        "origin/main moved: reconcile the new history before reusing this evidence")
sources = {name: sql_files(ref) for name, ref in {
    "main": MAIN, "finance": manifest["finance"], "hfo": manifest["hfo"],
    "integration": INTEGRATION,
}.items()}
current = {p.name: p.read_bytes() for p in (ROOT / "supabase/migrations").glob("*.sql")}
require(current == sources["integration"], "Installed canonical migration bytes changed")
require(all(current.get(n) == b for n, b in sources["main"].items()),
        "Main migration history changed")
mapping = []
for old, new in manifest["migration_renames"].items():
    owner = "hfo" if "_hfo_" in old else "finance"
    require(sources[owner][old] == current[new], f"Draft bytes changed: {old} -> {new}")
    mapping.append({"owner": owner, "original": old, "integrated": new,
                    "sha256": sha(current[new])})

historical = json.loads((EVIDENCE / "staging/applied-source-manifest-20260912T234558.json").read_text())
applied = json.loads((EVIDENCE / "staging/applied-source-manifest.json").read_text())
require({r["file"]: r["sha256"] for r in historical["migrations"]}
        == {n: sha(b) for n, b in current.items()}, "Recorded canonical boundary changed")
variants = applied["staging_seed_variant"]["files"]
require({r["file"]: r["original_sha256"] for r in variants}
        == {n: sha(b) for n, b in current.items()}, "Synthetic original boundary changed")
require({r["file"]: r["applied_sha256"] for r in variants}
        == {r["file"]: r["sha256"] for r in applied["migrations"]},
        "Recorded synthetic application hashes disagree")
variant_files = [r["file"] for r in variants if r["original_sha256"] != r["applied_sha256"]]

# Record every competing draft's numbered claim; duplicate content is not a collision.
claims = {}
refs = git("for-each-ref", "--format=%(refname)", "refs/heads/codex/").decode().splitlines()
for ref in ["origin/main", *refs]:
    for line in git("ls-tree", "-r", ref, "supabase/migrations").decode().splitlines():
        meta, name = line.split("\t")
        name = Path(name).name
        prefix = name.split("_", 1)[0]
        if len(prefix) == 3 and 336 <= int(prefix) <= 349:
            claims.setdefault(prefix, []).append({"ref": ref, "file": name,
                                                  "git_blob": meta.split()[2]})
collisions = {n: rows for n, rows in sorted(claims.items())
              if len({r["git_blob"] for r in rows}) > 1}
print(json.dumps({
    "result": "PASS", "scope": "source only; historical installation records, no live ledger query",
    "main": MAIN, "integration": git("rev-parse", INTEGRATION).decode().strip(),
    "finance": manifest["finance"], "hfo": manifest["hfo"],
    "main_files_unchanged": len(sources["main"]), "canonical_files_unchanged": len(current),
    "mapping": mapping, "preserved_synthetic_variants": variant_files,
    "draft_numeric_collisions": collisions,
    "migration_sha256": [{"file": n, "sha256": sha(b)} for n, b in sorted(current.items())],
}, indent=2))
