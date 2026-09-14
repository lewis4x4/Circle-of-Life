#!/usr/bin/env python3
"""Compare saved schema-catalog.sql results without treating drift as approval.

Exit 0: identical catalogs; 1: differences needing review; 2: invalid evidence.
This does not prove data migrations, grants, or execution history.
"""
import argparse
import json
from pathlib import Path


def index(rows):
    if not isinstance(rows, list) or not rows:
        raise ValueError("catalog must be a nonempty list")
    result = {}
    for row in rows:
        if not isinstance(row, dict) or any(
            not isinstance(row.get(field), str) or not row[field]
            for field in ("kind", "identity", "digest")
        ):
            raise ValueError("each catalog row needs kind, identity and digest")
        key = (row["kind"], row["identity"])
        if key in result:
            raise ValueError(f"duplicate object: {key}")
        result[key] = row
    return result


def compare(production, reference):
    prod, ref = index(production), index(reference)
    return {
        "production_count": len(prod),
        "reference_count": len(ref),
        "production_only": [prod[k] for k in sorted(prod.keys() - ref.keys())],
        "reference_only": [ref[k] for k in sorted(ref.keys() - prod.keys())],
        "changed": [
            {"kind": k[0], "identity": k[1],
             "production_digest": prod[k]["digest"],
             "reference_digest": ref[k]["digest"]}
            for k in sorted(prod.keys() & ref.keys())
            if prod[k]["digest"] != ref[k]["digest"]
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("production", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = compare(json.loads(args.production.read_text()),
                         json.loads(args.reference.read_text()))
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    except (OSError, ValueError) as error:
        parser.exit(2, f"Invalid catalog evidence: {error}\n")
    counts = {k: len(result[k]) for k in
              ("production_only", "reference_only", "changed")}
    print(json.dumps(counts))
    return int(any(counts.values()))


if __name__ == "__main__":
    raise SystemExit(main())
