import { child, descendants, nodeText, parseXml, type XmlNode } from "./xml.ts";

export const MAX_WORKBOOK_BYTES = 20 * 1024 * 1024;
// No accepted OOXML writer is present in this repository. The hosted handler is
// deliberately inbound-only until a byte-preserving patcher has independent
// provider rehearsal evidence; GoogleDriveClient.uploadConditional is not called.
export const OUTBOUND_XLSX_PATCH_SUPPORTED = false as const;
const MAX_EXPANDED_BYTES = 80 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10_000;
const decoder = new TextDecoder("utf-8", { fatal: true });

export const FACILITIES = [
  "Homewood",
  "Oakridge",
  "Rising Oaks",
  "Plantation",
  "Grande Cypress",
] as const;
export const KEYS = [
  "monthly_rent_roll_cents",
  "current_total_census",
  "sp_female_beds_open",
  "sp_male_beds_open",
  "sp_flexible_beds_open",
  "private_beds_open",
  "admissions_expected",
  "hospital_and_rehab_total",
  "expected_discharges",
  "callouts_last_week",
  "terminations_last_week",
  "current_open_positions",
  "overtime_reported",
  "tours_expected",
  "provider_activities_expected",
  "outreach_engagements",
] as const;
export type StandUpKey = typeof KEYS[number];
export type StandUpValues = Record<StandUpKey, number | null>;
export type FacilityMap = Record<typeof FACILITIES[number], string>;

const LABELS = new Map<string, StandUpKey>([
  ["current ar", "monthly_rent_roll_cents"],
  ["current total census", "current_total_census"],
  ["sp female beds open", "sp_female_beds_open"],
  ["sp male beds open", "sp_male_beds_open"],
  ["sp male or female beds open", "sp_flexible_beds_open"],
  ["private beds open", "private_beds_open"],
  ["admissions expected", "admissions_expected"],
  ["total at the hospital & rehab", "hospital_and_rehab_total"],
  ["expected discharges", "expected_discharges"],
  ["call outs last week", "callouts_last_week"],
  ["terminations last week", "terminations_last_week"],
  ["current open positions", "current_open_positions"],
  ["overtime", "overtime_reported"],
  ["tours expected", "tours_expected"],
  [
    "activities on the calendar to be completed by home health providers",
    "provider_activities_expected",
  ],
  [
    "outreach & engagements (providers, facilities, events)",
    "outreach_engagements",
  ],
]);
const HEADINGS = new Set([
  "accounts receivable & census",
  "current bed avaliability",
  "current bed availability",
  "expected admissions this week",
  "risk management",
  "staffing",
  "marketing plans for this week",
  "average rent",
  "total beds open",
]);

export class WorkbookError extends Error {}

type ZipEntry = {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressed: number;
  expanded: number;
  offset: number;
};

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}
function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateRaw(
  bytes: Uint8Array,
  expected: number,
): Promise<Uint8Array> {
  const owned = Uint8Array.from(bytes);
  const stream = new Blob([owned.buffer]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > expected) {
      await reader.cancel();
      throw new WorkbookError("Corrupt ZIP member");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

class SafeZip {
  readonly #raw: Uint8Array;
  readonly #entries = new Map<string, ZipEntry>();
  constructor(raw: Uint8Array) {
    if (raw.byteLength > MAX_WORKBOOK_BYTES) {
      throw new WorkbookError("Workbook exceeds 20 MiB limit");
    }
    this.#raw = raw;
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    let eocd = -1;
    for (
      let at = raw.length - 22;
      at >= Math.max(0, raw.length - 65_557);
      at--
    ) {
      if (u32(view, at) === 0x06054b50) {
        eocd = at;
        break;
      }
    }
    if (eocd < 0) throw new WorkbookError("Not a valid XLSX workbook");
    const count = u16(view, eocd + 10);
    if (
      u16(view, eocd + 4) !== 0 || u16(view, eocd + 6) !== 0 ||
      u16(view, eocd + 8) !== count
    ) {
      throw new WorkbookError("Multi-disk ZIP workbooks are not supported");
    }
    const directorySize = u32(view, eocd + 12);
    const directoryOffset = u32(view, eocd + 16);
    if (
      count === 0xffff || count > MAX_ZIP_ENTRIES ||
      directoryOffset + directorySize > eocd
    ) {
      throw new WorkbookError("Unsupported or oversized ZIP directory");
    }
    let at = directoryOffset;
    let expandedTotal = 0;
    for (let index = 0; index < count; index++) {
      if (at + 46 > raw.length || u32(view, at) !== 0x02014b50) {
        throw new WorkbookError("Invalid ZIP directory");
      }
      const flags = u16(view, at + 8);
      const method = u16(view, at + 10);
      const compressed = u32(view, at + 20);
      const expanded = u32(view, at + 24);
      const nameLength = u16(view, at + 28);
      const extraLength = u16(view, at + 30);
      const commentLength = u16(view, at + 32);
      const offset = u32(view, at + 42);
      if (at + 46 + nameLength + extraLength + commentLength > raw.length) {
        throw new WorkbookError("Invalid ZIP directory bounds");
      }
      const name = decoder.decode(raw.subarray(at + 46, at + 46 + nameLength));
      if (
        (flags & 1) || name.startsWith("/") || name.split("/").includes("..") ||
        this.#entries.has(name)
      ) {
        throw new WorkbookError("Unsupported encrypted or invalid ZIP member");
      }
      if (![0, 8].includes(method)) {
        throw new WorkbookError("Unsupported ZIP compression");
      }
      expandedTotal += expanded;
      if (expandedTotal > MAX_EXPANDED_BYTES) {
        throw new WorkbookError("Workbook expanded size exceeds limit");
      }
      this.#entries.set(name, {
        name,
        flags,
        method,
        crc: u32(view, at + 16),
        compressed,
        expanded,
        offset,
      });
      at += 46 + nameLength + extraLength + commentLength;
    }
    if (at !== directoryOffset + directorySize) {
      throw new WorkbookError("Invalid ZIP directory size");
    }
  }
  has(name: string): boolean {
    return this.#entries.has(name);
  }
  async read(name: string): Promise<Uint8Array> {
    const entry = this.#entries.get(name);
    if (!entry) {
      throw new WorkbookError(`Required XLSX member is missing: ${name}`);
    }
    const view = new DataView(
      this.#raw.buffer,
      this.#raw.byteOffset,
      this.#raw.byteLength,
    );
    const at = entry.offset;
    if (at + 30 > this.#raw.length || u32(view, at) !== 0x04034b50) {
      throw new WorkbookError("Invalid ZIP local header");
    }
    if (
      u16(view, at + 6) !== entry.flags || u16(view, at + 8) !== entry.method
    ) {
      throw new WorkbookError("ZIP local header differs from directory");
    }
    const nameLength = u16(view, at + 26);
    const extraLength = u16(view, at + 28);
    const start = at + 30 + nameLength + extraLength;
    if (
      start + entry.compressed > this.#raw.length ||
      decoder.decode(this.#raw.subarray(at + 30, at + 30 + nameLength)) !==
        entry.name
    ) {
      throw new WorkbookError("Invalid ZIP member bounds");
    }
    if (
      !(entry.flags & 8) &&
      (u32(view, at + 14) !== entry.crc ||
        u32(view, at + 18) !== entry.compressed ||
        u32(view, at + 22) !== entry.expanded)
    ) {
      throw new WorkbookError("ZIP local header differs from directory");
    }
    const compressed = this.#raw.subarray(start, start + entry.compressed);
    const output = entry.method === 0
      ? compressed.slice()
      : await inflateRaw(compressed, entry.expanded);
    if (output.length !== entry.expanded || crc32(output) !== entry.crc) {
      throw new WorkbookError("Corrupt ZIP member");
    }
    return output;
  }
  async xml(name: string): Promise<XmlNode> {
    const source = decoder.decode(await this.read(name));
    try {
      return parseXml(source);
    } catch (error) {
      throw new WorkbookError(
        error instanceof Error ? error.message : "Invalid XML",
      );
    }
  }
}

type Cell = {
  value: string | number | boolean | Date | null;
  formula: boolean;
  error: boolean;
  address: string;
};
type Sheet = { name: string; path: string; cells: Map<string, Cell> };

function attr(node: XmlNode, local: string): string | undefined {
  const entry = Object.entries(node.attributes).find(([name]) =>
    name === local || name.endsWith(`:${local}`)
  );
  return entry?.[1];
}

export function colIndex(address: string): [number, number] {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(address);
  if (!match) throw new WorkbookError("Invalid cell address");
  let column = 0;
  for (const character of match[1]) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  const row = Number(match[2]);
  if (column > 16_384 || row > 1_048_576) {
    throw new WorkbookError("Cell exceeds Excel coordinate limits");
  }
  return [column, row];
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}
function address(column: number, row: number): string {
  let result = "";
  while (column) {
    const remainder = (column - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    column = Math.floor((column - 1) / 26);
  }
  return result + row;
}

function excelDate(serial: number, epoch1904: boolean): Date {
  const epoch = Date.UTC(
    epoch1904 ? 1904 : 1899,
    epoch1904 ? 0 : 11,
    epoch1904 ? 1 : 30,
  );
  return new Date(epoch + Math.trunc(serial) * 86_400_000);
}

async function readSheets(raw: Uint8Array): Promise<Sheet[]> {
  const zip = new SafeZip(raw);
  const workbook = await zip.xml("xl/workbook.xml");
  const workbookPr = descendants(workbook, "workbookPr")[0];
  const epoch1904 = ["1", "true"].includes(
    attr(workbookPr ?? { attributes: {} } as XmlNode, "date1904") ?? "",
  );
  const relationshipRoot = await zip.xml("xl/_rels/workbook.xml.rels");
  const relationships = new Map(
    descendants(relationshipRoot, "Relationship")
      .filter((node) => attr(node, "TargetMode") !== "External")
      .map((node) => [attr(node, "Id")!, attr(node, "Target")!]),
  );
  const sharedStrings = zip.has("xl/sharedStrings.xml")
    ? descendants(await zip.xml("xl/sharedStrings.xml"), "si").map(nodeText)
    : [];
  const dateStyles = new Set<number>();
  if (zip.has("xl/styles.xml")) {
    const styles = await zip.xml("xl/styles.xml");
    const formats = new Map(
      descendants(styles, "numFmt").map((
        node,
      ) => [Number(attr(node, "numFmtId")), attr(node, "formatCode") ?? ""]),
    );
    const cellXfs = descendants(styles, "cellXfs")[0];
    cellXfs?.children.filter((node) => node.name === "xf").forEach(
      (node, index) => {
        const id = Number(attr(node, "numFmtId") ?? 0);
        const custom = (formats.get(id) ?? "").replace(
          /"[^"]*"|\[[^\]]*\]|\\./g,
          "",
        );
        if ((id >= 14 && id <= 22) || /[dy]/i.test(custom)) {
          dateStyles.add(index);
        }
      },
    );
  }
  const result: Sheet[] = [];
  const workbookSheets = descendants(workbook, "sheets")[0];
  if (!workbookSheets) throw new WorkbookError("Workbook sheets are missing");
  for (
    const sheet of workbookSheets.children.filter((node) =>
      node.name === "sheet"
    )
  ) {
    const target = relationships.get(attr(sheet, "id") ?? "");
    if (!target) throw new WorkbookError("Sheet relationship missing");
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    if (path.split("/").includes("..")) {
      throw new WorkbookError("Unsupported sheet relationship");
    }
    const root = await zip.xml(path);
    const cells = new Map<string, Cell>();
    const sheetData = descendants(root, "sheetData")[0];
    if (!sheetData) throw new WorkbookError("Worksheet data is missing");
    const inputCells = sheetData.children.filter((node) => node.name === "row")
      .flatMap((row) => row.children.filter((node) => node.name === "c"));
    for (const node of inputCells) {
      const cellAddress = attr(node, "r") ?? "";
      const [column, row] = colIndex(cellAddress);
      const kind = attr(node, "t");
      const valueText = child(node, "v")?.text ?? null;
      let value: Cell["value"] = valueText;
      if (kind === "s" && valueText !== null) {
        const index = Number(valueText);
        if (
          !Number.isSafeInteger(index) || sharedStrings[index] === undefined
        ) throw new WorkbookError("Invalid shared string index");
        value = sharedStrings[index];
      } else if (kind === "inlineStr") value = nodeText(child(node, "is"));
      else if (kind === "b") value = valueText === "1";
      else if (kind === "d" && valueText) {
        const date = new Date(`${valueText.slice(0, 10)}T00:00:00Z`);
        if (Number.isNaN(date.valueOf())) {
          throw new WorkbookError("Invalid numeric/date cell");
        }
        value = date;
      } else if (
        !["str", "e", "b", "d"].includes(kind ?? "") && valueText !== null
      ) {
        const number = Number(valueText);
        if (!Number.isFinite(number)) {
          throw new WorkbookError("Invalid numeric/date cell");
        }
        value = dateStyles.has(Number(attr(node, "s") ?? 0))
          ? excelDate(number, epoch1904)
          : number;
      }
      const coordinate = cellKey(row, column);
      if (cells.has(coordinate)) {
        throw new WorkbookError("Duplicate worksheet cell");
      }
      cells.set(coordinate, {
        value,
        formula: Boolean(child(node, "f")),
        error: kind === "e",
        address: cellAddress,
      });
    }
    result.push({ name: attr(sheet, "name") ?? "", path, cells });
  }
  return result;
}

function isoDay(value: Cell["value"]): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const direct = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (direct) {
    const date = new Date(`${trimmed}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) &&
        date.toISOString().slice(0, 10) === trimmed
      ? trimmed
      : null;
  }
  const slash = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (slash) return isoDay(`${slash[3]}-${slash[1]}-${slash[2]}`);
  const named =
    /^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})$/
      .exec(trimmed);
  if (!named) return null;
  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const month = months.indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
  return isoDay(
    `${named[3]}-${String(month).padStart(2, "0")}-${
      named[2].padStart(2, "0")
    }`,
  );
}

export function overtimeMinutes(value: number | null): number | null {
  if (value === null) return null;
  if (
    !Number.isFinite(value) || value < 0 || value > 35_791_394.59 ||
    Number(value.toFixed(2)) !== value
  ) {
    throw new WorkbookError(
      "Overtime must use hours and minutes with at most two decimal places",
    );
  }
  const hours = Math.trunc(value);
  const minutes = Math.round(Number((value - hours).toFixed(2)) * 100);
  const total = hours * 60 + minutes;
  if (minutes > 59 || total > 2_147_483_647) {
    throw new WorkbookError("Overtime minute component must be 00 through 59");
  }
  return total;
}

function cellNumber(
  cellValue: Cell | undefined,
  key: StandUpKey,
): number | null {
  if (!cellValue) return null;
  if (cellValue.formula || cellValue.error) {
    throw new WorkbookError(
      "Input contains formula/error; review source rather than using a cached result",
    );
  }
  if (cellValue.value === null || String(cellValue.value).trim() === "") {
    return null;
  }
  if (typeof cellValue.value === "boolean" || cellValue.value instanceof Date) {
    throw new WorkbookError("Expected numeric value");
  }
  const text = String(cellValue.value).trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    throw new WorkbookError("Expected numeric value");
  }
  let number = Number(text);
  if (!Number.isFinite(number) || number < 0) {
    throw new WorkbookError("Value must be finite and nonnegative");
  }
  if (key.endsWith("_cents")) number *= 100;
  if (key !== "overtime_reported" && !Number.isInteger(number)) {
    throw new WorkbookError("Count/cents must be whole numbers");
  }
  if (number > 2_147_483_647) {
    throw new WorkbookError("Value exceeds supported numeric bound");
  }
  if (key === "overtime_reported") overtimeMinutes(number);
  return number;
}

export type WorkbookIssue = Record<string, unknown> & {
  code: string;
  message: string;
};
export type WorkbookRecord = {
  facility_id: string;
  week_start: string;
  values: StandUpValues;
  provenance: Record<string, string>;
};
export type ParsedWorkbook = {
  schema_version: "standup-2026-v1";
  source_file_id: string;
  source_file_name: string;
  source_sha256: string;
  records: WorkbookRecord[];
  issues: WorkbookIssue[];
  locations: Record<
    string,
    { sheet: string; path: string; cells: Record<string, string> }
  >;
};

export async function sha256Hex(raw: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(raw).buffer),
    ),
  ).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function parseWorkbook(
  raw: Uint8Array,
  facilityMap: FacilityMap,
  fileId: string,
  filename: string,
  weeks?: string[],
): Promise<ParsedWorkbook> {
  if (
    Object.keys(facilityMap).length !== 5 ||
    !FACILITIES.every((name) => typeof facilityMap[name] === "string") ||
    new Set(Object.values(facilityMap)).size !== 5
  ) {
    throw new WorkbookError(
      "Provide exact reviewed mappings for all five facility headers",
    );
  }
  if (!fileId || !filename) {
    throw new WorkbookError("Source file identity required");
  }
  const records: WorkbookRecord[] = [], issues: WorkbookIssue[] = [];
  const locations: ParsedWorkbook["locations"] = {},
    seen: Record<string, string> = {};
  for (const sheet of await readSheets(raw)) {
    const cells = [...sheet.cells.entries()].map(([key, cell]) => ({
      row: Number(key.split(":")[0]),
      column: Number(key.split(":")[1]),
      cell,
    }));
    const dates = cells.filter(({ column, cell }) =>
      column === 1 && isoDay(cell.value)
    ).map(({ row, cell }) => [row, isoDay(cell.value)!] as const).sort((a, b) =>
      a[0] - b[0]
    );
    if (dates.length > 100) {
      throw new WorkbookError("Too many weekly blocks in one worksheet");
    }
    if (!dates.length && !weeks) {
      issues.push({
        code: "unmapped_sheet",
        sheet: sheet.name,
        message: "No dated weekly blocks; explicit disposition required",
      });
    }
    for (let index = 0; index < dates.length; index++) {
      const [start, week] = dates[index];
      if (weeks && !weeks.includes(week)) continue;
      const end = index + 1 < dates.length
        ? dates[index + 1][0] - 1
        : Math.max(start, ...cells.map(({ row }) => row));
      const headers = cells.filter(({ row, cell }) =>
        row === start + 1 &&
        FACILITIES.includes(cell.value as typeof FACILITIES[number])
      );
      if (
        new Set(headers.map(({ cell }) => cell.value)).size !== 5 ||
        headers.length !== 5
      ) {
        issues.push({
          code: "facility_headers",
          sheet: sheet.name,
          week_start: week,
          message: "Five unique facility headers required",
        });
        continue;
      }
      const labels = cells.filter(({ row, column }) =>
        column === 1 && row >= start + 2 && row <= end
      ).map(({ row, cell }) => [row, normalized(cell.value)] as const).sort((
        a,
        b,
      ) => a[0] - b[0]);
      const schema = labels.some(([, label]) => label === "current ar")
        ? "standup-2026-v1"
        : "legacy-unmapped";
      for (const { column, cell: header } of headers) {
        const name = header.value as typeof FACILITIES[number];
        const values = Object.fromEntries(
          KEYS.map((key) => [key, null]),
        ) as StandUpValues;
        const mapped: Record<string, string> = {};
        const localIssues: WorkbookIssue[] = [];
        let populated = false;
        for (const [row, label] of labels) {
          const cell = sheet.cells.get(cellKey(row, column));
          const hasValue = cell?.value !== null && cell?.value !== undefined &&
            String(cell.value).trim() !== "";
          if (!label || HEADINGS.has(label)) continue;
          if (hasValue) populated = true;
          const key = schema === "standup-2026-v1"
            ? LABELS.get(label)
            : undefined;
          if (key) {
            if (key in mapped) {
              localIssues.push({ code: "duplicate_label", message: label });
            }
            mapped[key] = cell?.address ?? address(column, row);
            try {
              values[key] = cellNumber(cell, key);
            } catch (error) {
              localIssues.push({
                code: "invalid_input",
                cell: address(column, row),
                raw_value: typeof cell?.value === "number" ? cell.value : null,
                message: error instanceof Error
                  ? error.message
                  : "Invalid input",
              });
            }
          } else if (hasValue) {
            localIssues.push({
              code: "unmapped_value",
              cell: address(column, row),
              message: `Unmapped source field: ${label}`,
            });
          }
        }
        const identity = `${facilityMap[name]}:${week}`;
        const complete = KEYS.every((key) => key in mapped);
        if (!populated) {
          issues.push(
            ...localIssues.map((issue) => ({
              ...issue,
              sheet: sheet.name,
              facility_id: facilityMap[name],
              week_start: week,
            })),
          );
          if (
            !localIssues.length && schema === "standup-2026-v1" && complete &&
            new Date(`${week}T00:00:00Z`).getUTCDay() === 1
          ) {
            if (identity in locations) {
              issues.push({
                code: "overlapping_week",
                sheet: sheet.name,
                facility_id: facilityMap[name],
                week_start: week,
                message: "Repeated empty weekly block",
              });
            }
            locations[identity] = {
              sheet: sheet.name,
              path: sheet.path,
              cells: mapped,
            };
          } else if (localIssues.length) delete locations[identity];
          continue;
        }
        if (new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) {
          localIssues.push({
            code: "non_monday",
            message: "Report date must be Monday",
          });
        }
        if (!complete) {
          localIssues.push({
            code: "unsupported_schema",
            message: "Complete versioned input mapping required",
          });
        }
        if (identity in locations) {
          localIssues.push({
            code: "overlapping_week",
            message:
              "Multiple blocks for facility/week; explicitly select authoritative sheets",
            other_sheet: seen[identity] ?? locations[identity].sheet,
          });
        }
        seen[identity] = sheet.name;
        issues.push(
          ...localIssues.map((issue) => ({
            ...issue,
            sheet: sheet.name,
            facility_id: facilityMap[name],
            week_start: week,
          })),
        );
        records.push({
          facility_id: facilityMap[name],
          week_start: week,
          values,
          provenance: {
            file_id: fileId,
            sheet: sheet.name,
            range: `${address(column, start)}:${address(column, end)}`,
            schema_version: schema,
          },
        });
        locations[identity] = {
          sheet: sheet.name,
          path: sheet.path,
          cells: mapped,
        };
      }
    }
  }
  return {
    schema_version: "standup-2026-v1",
    source_file_id: fileId,
    source_file_name: filename,
    source_sha256: await sha256Hex(raw),
    records,
    issues,
    locations,
  };
}

export type HeldBaseline = { file_values: StandUpValues };
export function retainUnchangedHeldOvertime(
  parsed: ParsedWorkbook,
  baselines: Record<string, HeldBaseline>,
): boolean {
  if (!parsed.issues.length) return false;
  for (const issue of parsed.issues) {
    if (
      issue.code !== "invalid_input" ||
      issue.message !== "Overtime minute component must be 00 through 59"
    ) return false;
    const identity = `${issue.facility_id}:${issue.week_start}`;
    const retained = baselines[identity]?.file_values.overtime_reported;
    if (
      retained === undefined || retained === null ||
      issue.raw_value !== retained
    ) return false;
    const record = parsed.records.find((candidate) =>
      candidate.facility_id === issue.facility_id &&
      candidate.week_start === issue.week_start
    );
    if (!record) return false;
    record.values.overtime_reported = retained;
  }
  parsed.issues = [];
  return true;
}
