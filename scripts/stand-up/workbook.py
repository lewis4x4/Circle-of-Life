"""Bounded OOXML Stand Up reader/patcher. No formulas or external links are executed.

Only explicitly mapped facility input cells are writable. All other ZIP members,
styles, formulas and drawings retain their original bytes.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import re
import zipfile
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.etree import ElementTree as ET

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
ET.register_namespace("", NS)
ET.register_namespace("r", REL)
MAX_BYTES = 20 * 1024 * 1024
MAX_EXPANDED = 80 * 1024 * 1024
KEYS = (
    "monthly_rent_roll_cents", "current_total_census", "sp_female_beds_open",
    "sp_male_beds_open", "sp_flexible_beds_open", "private_beds_open",
    "admissions_expected", "hospital_and_rehab_total", "expected_discharges",
    "callouts_last_week", "terminations_last_week", "current_open_positions",
    "overtime_reported", "tours_expected", "provider_activities_expected", "outreach_engagements",
)
LABELS = dict(zip((
    "current ar", "current total census", "sp female beds open", "sp male beds open",
    "sp male or female beds open", "private beds open", "admissions expected",
    "total at the hospital & rehab", "expected discharges", "call outs last week",
    "terminations last week", "current open positions", "overtime", "tours expected",
    "activities on the calendar to be completed by home health providers",
    "outreach & engagements (providers, facilities, events)",
), KEYS))
HEADINGS = {
    "accounts receivable & census", "current bed avaliability", "current bed availability",
    "expected admissions this week", "risk management", "staffing", "marketing plans for this week",
    "average rent", "total beds open",
}
FACILITIES = ("Homewood", "Oakridge", "Rising Oaks", "Plantation", "Grande Cypress")


class WorkbookError(ValueError):
    pass


def normalized(value):
    return " ".join(str(value or "").strip().lower().split())


def col_index(address):
    match = re.fullmatch(r"([A-Z]+)([1-9][0-9]*)", address)
    if not match:
        raise WorkbookError("Invalid cell address")
    index = 0
    for char in match[1]:
        index = index * 26 + ord(char) - 64
    row = int(match[2])
    if index > 16384 or row > 1048576:
        raise WorkbookError("Cell exceeds Excel coordinate limits")
    return index, row


def open_archive(raw):
    if len(raw) > MAX_BYTES:
        raise WorkbookError("Workbook exceeds 20 MiB limit")
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
        infos = archive.infolist()
        if len(infos) > 10000 or sum(i.file_size for i in infos) > MAX_EXPANDED:
            raise WorkbookError("Workbook expanded size exceeds limit")
        if len({i.filename for i in infos}) != len(infos):
            raise WorkbookError("Duplicate ZIP member")
        if any(i.flag_bits & 1 or i.filename.startswith("/") or ".." in i.filename.split("/") for i in infos):
            raise WorkbookError("Unsupported encrypted or invalid ZIP member")
        return archive
    except zipfile.BadZipFile as exc:
        raise WorkbookError("Not a valid XLSX workbook") from exc


def xml(archive, name):
    raw = archive.read(name)
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise WorkbookError("XML entities are not supported")
    return ET.fromstring(raw)


def serialize_preserving_namespaces(root, original):
    """Retain declarations referenced only inside mc:Ignorable and other QName values."""
    namespaces = {}
    for _, (prefix, uri) in ET.iterparse(io.BytesIO(original), events=("start-ns",)):
        if prefix in namespaces and namespaces[prefix] != uri:
            raise WorkbookError("Nested namespace rebinding requires manual workbook review")
        namespaces[prefix] = uri
        if not re.fullmatch(r"ns\d+", prefix):
            ET.register_namespace(prefix, uri)
    data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    first_end = data.find(b">", data.find(b"?>") + 2)
    root_start = data[:first_end]
    from xml.sax.saxutils import quoteattr
    for prefix, uri in namespaces.items():
        attribute = "xmlns" + (":" + prefix if prefix else "")
        if not re.search(rb"\s" + re.escape(attribute.encode()) + rb"=", root_start):
            data = data[:first_end] + (" " + attribute + "=" + quoteattr(uri)).encode() + data[first_end:]
            first_end = data.find(b">", data.find(b"?>") + 2)
            root_start = data[:first_end]
    return data


def read_sheets(raw):
    archive = open_archive(raw)
    workbook = xml(archive, "xl/workbook.xml")
    props = workbook.find(f"{{{NS}}}workbookPr")
    epoch = date(1904, 1, 1) if props is not None and props.get("date1904") in ("1", "true") else date(1899, 12, 30)
    rels = {r.get("Id"): r.get("Target") for r in xml(archive, "xl/_rels/workbook.xml.rels") if r.get("TargetMode") != "External"}
    strings = []
    if "xl/sharedStrings.xml" in archive.namelist():
        strings = ["".join(n.itertext()) for n in xml(archive, "xl/sharedStrings.xml")]
    date_styles = set()
    if "xl/styles.xml" in archive.namelist():
        styles = xml(archive, "xl/styles.xml")
        formats = {int(n.get("numFmtId")): n.get("formatCode", "") for n in styles.findall(f"{{{NS}}}numFmts/{{{NS}}}numFmt")}
        for index, xf in enumerate(styles.findall(f"{{{NS}}}cellXfs/{{{NS}}}xf")):
            fmt = int(xf.get("numFmtId", "0"))
            custom = re.sub(r'"[^\"]*"|\[[^\]]*\]|\\.', "", formats.get(fmt, ""))
            if fmt in range(14, 23) or re.search(r"[dy]", custom, re.I):
                date_styles.add(index)
    result = []
    for sheet in workbook.findall(f"{{{NS}}}sheets/{{{NS}}}sheet"):
        target = rels.get(sheet.get(f"{{{REL}}}id"))
        if not target:
            raise WorkbookError("Sheet relationship missing")
        path = target.lstrip("/") if target.startswith("/") else "xl/" + target
        if ".." in path.split("/"):
            raise WorkbookError("Unsupported sheet relationship")
        root = xml(archive, path)
        cells = {}
        for node in root.findall(f"{{{NS}}}sheetData/{{{NS}}}row/{{{NS}}}c"):
            address = node.get("r", "")
            col, row = col_index(address)
            val_node = node.find(f"{{{NS}}}v")
            value = val_node.text if val_node is not None else None
            kind = node.get("t")
            if kind == "s" and value is not None:
                value = strings[int(value)]
            elif kind == "inlineStr":
                value = "".join(node.find(f"{{{NS}}}is").itertext())
            elif kind == "b":
                value = value == "1"
            elif kind not in ("str", "e", "b", "d") and value is not None:
                try:
                    value = Decimal(value)
                    if int(node.get("s", "0")) in date_styles:
                        value = epoch + timedelta(days=int(value))
                except (InvalidOperation, ValueError, OverflowError) as exc:
                    raise WorkbookError("Invalid numeric/date cell") from exc
            elif kind == "d" and value:
                value = date.fromisoformat(value[:10])
            cells[(row, col)] = {"value": value, "formula": node.find(f"{{{NS}}}f") is not None, "error": kind == "e", "address": address}
        result.append({"name": sheet.get("name"), "path": path, "cells": cells})
    return result


def parsed_day(value):
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            pass
    return None


def overtime_minutes(value):
    """Validated legacy HH.MM -> integer minutes; never treat it as decimal hours."""
    if value is None:
        return None
    if isinstance(value, bool):
        raise WorkbookError("Overtime must use hours and minutes")
    try:
        number = Decimal(str(value))
    except InvalidOperation as exc:
        raise WorkbookError("Overtime must use hours and minutes") from exc
    if not number.is_finite() or number < 0 or number > 35791394.59 or number != number.quantize(Decimal("0.01")):
        raise WorkbookError("Overtime must use hours and minutes with at most two decimal places")
    hours = int(number)
    minutes = (number - hours) * 100
    total = hours * 60 + int(minutes)
    if minutes > 59 or total > 2147483647:
        raise WorkbookError("Overtime minute component must be 00 through 59")
    return total


def cell_number(cell, key):
    if not cell or cell["value"] is None or str(cell["value"]).strip() == "":
        return None
    if cell["formula"] or cell["error"]:
        raise WorkbookError("Input contains formula/error; review source rather than using a cached result")
    value = cell["value"]
    if isinstance(value, bool) or isinstance(value, date):
        raise WorkbookError("Expected numeric value")
    try:
        # Numeric strings are permitted only in the ordinary decimal form, not currency/free text.
        number = Decimal(str(value).strip())
    except InvalidOperation as exc:
        raise WorkbookError("Expected numeric value") from exc
    if not number.is_finite() or number < 0:
        raise WorkbookError("Value must be finite and nonnegative")
    if key.endswith("_cents"):
        number *= 100
    if key != "overtime_reported" and number != number.to_integral_value():
        raise WorkbookError("Count/cents must be whole numbers")
    if number > 2147483647:
        raise WorkbookError("Value exceeds supported numeric bound")
    if key == "overtime_reported":
        overtime_minutes(number)
    return float(number) if key == "overtime_reported" else int(number)


def parse_workbook(raw, facility_map, file_id, filename, sheets=None, weeks=None):
    if set(facility_map) != set(FACILITIES) or len(set(facility_map.values())) != 5:
        raise WorkbookError("Provide exact reviewed mappings for all five facility headers")
    if not file_id or not filename:
        raise WorkbookError("Source file identity required")
    records, issues, locations = [], [], {}
    seen = {}
    all_sheets = read_sheets(raw)
    if sheets and set(sheets) - {s["name"] for s in all_sheets}:
        raise WorkbookError("Selected sheet is missing")
    for sheet in all_sheets:
        if sheets and sheet["name"] not in sheets:
            continue
        cells = sheet["cells"]
        dates = sorted((r, parsed_day(c["value"])) for (r, col), c in cells.items() if col == 1 and parsed_day(c["value"]))
        if len(dates) > 100:
            raise WorkbookError("Too many weekly blocks in one worksheet")
        if not dates and not weeks:
            issues.append({"code": "unmapped_sheet", "sheet": sheet["name"], "message": "No dated weekly blocks; explicit disposition required"})
        for index, (start, week) in enumerate(dates):
            if weeks and week.isoformat() not in weeks:
                continue
            end = dates[index + 1][0] - 1 if index + 1 < len(dates) else max((r for r, _ in cells), default=start)
            headers = {col: c["value"] for (r, col), c in cells.items() if r == start + 1 and c["value"] in facility_map}
            if set(headers.values()) != set(FACILITIES) or len(headers) != 5:
                issues.append({"code": "facility_headers", "sheet": sheet["name"], "week_start": week.isoformat(), "message": "Five unique facility headers required"})
                continue
            labels = sorted((r, normalized(c["value"])) for (r, col), c in cells.items() if col == 1 and start + 2 <= r <= end)
            schema = "standup-2026-v1" if any(label == "current ar" for _, label in labels) else "legacy-unmapped"
            for col, name in headers.items():
                values = dict.fromkeys(KEYS)
                mapped = {}
                populated = False
                local_issues = []
                for row, label in labels:
                    cell = cells.get((row, col))
                    has_value = cell and cell["value"] is not None and str(cell["value"]).strip() != ""
                    if label in HEADINGS or not label:
                        continue
                    if has_value:
                        populated = True
                    key = LABELS.get(label) if schema == "standup-2026-v1" else None
                    if key:
                        if key in mapped:
                            local_issues.append({"code": "duplicate_label", "message": label})
                        mapped[key] = cell["address"] if cell else _address(col, row)
                        try:
                            values[key] = cell_number(cell, key)
                        except WorkbookError as exc:
                            local_issues.append({"code": "invalid_input", "cell": _address(col, row), "message": str(exc)})
                    elif has_value:
                        local_issues.append({"code": "unmapped_value", "cell": _address(col, row), "message": "Unmapped source field: " + label})
                identity = facility_map[name] + ":" + week.isoformat()
                if not populated:
                    # Empty templates must satisfy the same mapping checks as populated blocks.
                    for issue in local_issues:
                        issues.append({**issue, "sheet": sheet["name"], "facility_id": facility_map[name], "week_start": week.isoformat()})
                    if local_issues:
                        locations.pop(identity, None)
                    # Keep validated empty-block coordinates for future writes, but do not import zero reports.
                    if not local_issues and schema == "standup-2026-v1" and set(mapped) == set(KEYS) and week.weekday() == 0:
                        if identity in locations:
                            issues.append({"code": "overlapping_week", "sheet": sheet["name"], "facility_id": facility_map[name], "week_start": week.isoformat(), "message": "Repeated empty weekly block"})
                        locations[identity] = {"sheet": sheet["name"], "path": sheet["path"], "cells": mapped}
                    continue
                if week.weekday() != 0:
                    local_issues.append({"code": "non_monday", "message": "Report date must be Monday"})
                if set(mapped) != set(KEYS):
                    local_issues.append({"code": "unsupported_schema", "message": "Complete versioned input mapping required"})
                provenance = {"file_id": file_id, "sheet": sheet["name"], "range": f"{_address(col,start)}:{_address(col,end)}", "schema_version": schema}
                record = {"facility_id": facility_map[name], "week_start": week.isoformat(), "values": values, "provenance": provenance}
                if identity in locations:
                    local_issues.append({"code": "overlapping_week", "message": "Multiple blocks for facility/week; explicitly select authoritative sheets", "other_sheet": seen.get(identity, locations[identity]["sheet"])})
                seen[identity] = sheet["name"]
                for issue in local_issues:
                    issues.append({**issue, "sheet": sheet["name"], "facility_id": facility_map[name], "week_start": week.isoformat()})
                records.append(record)
                locations[identity] = {"sheet": sheet["name"], "path": sheet["path"], "cells": mapped}
    return {"schema_version": "standup-2026-v1", "source_file_id": file_id, "source_file_name": filename,
            "source_sha256": hashlib.sha256(raw).hexdigest(), "records": records, "issues": issues, "locations": locations}


def _address(col, row):
    letters = ""
    while col:
        col, rem = divmod(col - 1, 26)
        letters = chr(65 + rem) + letters
    return letters + str(row)


def patch_workbook(raw, parsed, updates):
    if hashlib.sha256(raw).hexdigest() != parsed["source_sha256"] or parsed["issues"]:
        raise WorkbookError("Source changed or mapping has unresolved issues")
    archive = open_archive(raw)
    changed = {}
    for identity, values in updates.items():
        if set(values) != set(KEYS) or identity not in parsed["locations"]:
            raise WorkbookError("Unknown report identity or incomplete values")
        location = parsed["locations"][identity]
        root = changed.setdefault(location["path"], xml(archive, location["path"]))
        data = root.find(f"{{{NS}}}sheetData")
        for key, value in values.items():
            address = location["cells"][key]
            col, rownum = col_index(address)
            row = next((r for r in data if int(r.get("r", "0")) == rownum), None)
            if row is None:
                raise WorkbookError("Mapped input row disappeared")
            cell = next((c for c in row if c.get("r") == address), None)
            if cell is None:
                cell = ET.Element(f"{{{NS}}}c", {"r": address})
                row.append(cell)
                row[:] = sorted(row, key=lambda c: col_index(c.get("r"))[0])
            if cell.find(f"{{{NS}}}f") is not None:
                raise WorkbookError("Refusing to overwrite an input formula")
            if value is not None:
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise WorkbookError("Invalid patch number")
                number = Decimal(str(value))
                if not number.is_finite() or number < 0 or number > 2147483647 or (key != "overtime_reported" and number != number.to_integral_value()):
                    raise WorkbookError("Invalid patch numeric bounds")
                if key == "overtime_reported":
                    overtime_minutes(number)
                if key.endswith("_cents"):
                    number /= 100
            for node in list(cell):
                if node.tag in (f"{{{NS}}}v", f"{{{NS}}}is"):
                    cell.remove(node)
            cell.attrib.pop("t", None)
            if value is not None:
                ET.SubElement(cell, f"{{{NS}}}v").text = str(number)
    output = io.BytesIO()
    # Excel/Sheets must recalculate preserved formulas on open; provider activation also
    # requires observing recalculated displayed values in the rehearsal copy.
    calculation = xml(archive, "xl/workbook.xml")
    calc_pr = calculation.find(f"{{{NS}}}calcPr")
    if calc_pr is None:
        calc_pr = ET.SubElement(calculation, f"{{{NS}}}calcPr")
    calc_pr.attrib.update({"calcMode": "auto", "fullCalcOnLoad": "1", "forceFullCalc": "1"})
    changed["xl/workbook.xml"] = calculation
    with zipfile.ZipFile(output, "w") as target:
        for info in archive.infolist():
            content = serialize_preserving_namespaces(changed[info.filename], archive.read(info.filename)) if info.filename in changed else archive.read(info.filename)
            target.writestr(copy.copy(info), content)
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description="Stage XLSX Stand Up data. Never writes to Haven or Google.")
    parser.add_argument("workbook")
    parser.add_argument("--facility-map", required=True, help="JSON object mapping exact source headers to reviewed Haven UUIDs")
    parser.add_argument("--file-id", required=True)
    parser.add_argument("--sheet", action="append", help="Explicit sheet selection; resolves no duplicate periods automatically")
    parser.add_argument("--week", action="append", help="Explicit YYYY-MM-DD reporting scope; other source periods remain untouched")
    parser.add_argument("--output", required=True)
    parser.add_argument("--reason", default="Historical Stand Up workbook import")
    args = parser.parse_args()
    raw = Path(args.workbook).read_bytes()
    result = parse_workbook(raw, json.loads(Path(args.facility_map).read_text()), args.file_id, Path(args.workbook).name, args.sheet, args.week)
    result.pop("locations")
    result["rows"] = [{**row, "expected_version": 0} for row in result.pop("records")]
    result["reason"] = args.reason
    result["provenance"] = {"file_id": args.file_id, "source_file_name": Path(args.workbook).name, "source_sha256": result["source_sha256"], "schema_version": result["schema_version"]}
    output = Path(args.output)
    if output.exists():
        raise WorkbookError("Output already exists; choose a new review artifact")
    with output.open("x") as handle:
        output.chmod(0o600)
        json.dump(result, handle, indent=2)
    print(json.dumps({"records": len(result["rows"]), "issues": len(result["issues"]), "publishable": not result["issues"]}))


if __name__ == "__main__":
    main()
