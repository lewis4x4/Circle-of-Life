import test from "node:test";
import assert from "node:assert/strict";
import { main, reviewContext, parseCsv, normalizeRows, buildReviewPlan, validateReviewedPlan } from "./import-executive-standup-csv.mjs";

const facilities = [{ id: "facility-a", name: "A" }, { id: "facility-b", name: "B" }];
const definitions = [{ key: "census", label: "Census", section_key: "ar_census", value_type: "count", facility_scope: true, total_scope: true }];
const content = "week_of,facility_name,metric_key,value_numeric,value_text\n2026-01-05,A,census,0,\n";
const normalize = (csv = content) => normalizeRows(parseCsv(csv), facilities, definitions);
const plan = (extra = {}) => buildReviewPlan({ organizationId: "org", fileName: "source.csv", content, rows: normalize(), facilities, definitions, snapshots: [], existingMetrics: [], ...extra });

test("CSV handles BOM, quoted multiline fields and escaped quotes", () => {
  const rows = parseCsv('\uFEFFweek_of,facility_name,metric_key,value_text\r\n2026-01-05,A,census,"first\nsecond ""quoted"""\r\n');
  assert.equal(rows[0].value_text, 'first\nsecond "quoted"');
});

test("unsupported and malformed files reject before publication", () => {
  for (const csv of ["", "week_of,facility_name,metric_key\n", "January,A,B\n5,1,2", "week_of,facility_name,metric_key,metric_key\n2026-01-05,A,census,census", 'week_of,facility_name,metric_key\n2026-01-05,A,"census', 'week_of,facility_name,metric_key\n2026-01-05,A,census,extra']) {
    assert.throws(() => parseCsv(csv));
  }
});

test("explicit zero stays zero while uploaded blank stays null", () => {
  assert.equal(normalize()[0].value_numeric, 0);
  assert.equal(normalize(content.replace(",0,", ",,"))[0].value_numeric, null);
});

test("ambiguous counts and source units are rejected without rounding", () => {
  for (const value of ["1.21", "$10", "10%", "0x10", "1e3", "Infinity", "1.234", "1000000000000"]) {
    assert.throws(() => normalize(content.replace(",0,", `,${value},`)));
  }
});

test("invalid dates, unknown mapping and duplicate identities reject", () => {
  for (const csv of [content.replace("2026-01-05", "2026-02-30"), content.replace(",A,", ",Other,"), content.replace(",A,", ",,"), content.replace("census,0", "unknown,0"), content + "2026-01-05,A,census,1,\n"]) {
    assert.throws(() => normalize(csv));
  }
  assert.throws(() => normalizeRows(parseCsv(content), [...facilities, { id: "another", name: "A" }], definitions));
});

test("missing facilities and totals count against expected coverage", () => {
  const review = plan();
  assert.equal(review.comparisons[0].expected_cells, 3);
  assert.equal(review.comparisons[0].populated_cells, 1);
  assert.equal(review.comparisons[0].missing_cells, 2);
  assert.equal(review.comparisons[0].completeness_pct, 33.33);
  assert.equal(review.source_as_of, null);
});

test("review surfaces changed and disappearing cells without deleting anything", () => {
  const review = plan({ snapshots: [{ id: "snapshot", week_of: "2026-01-05", published_version: 4 }], existingMetrics: [
    { snapshot_id: "snapshot", facility_id: "facility-a", metric_key: "census", value_numeric: 5, value_text: null },
    { snapshot_id: "snapshot", facility_id: "facility-b", metric_key: "census", value_numeric: 7, value_text: null },
  ] });
  assert.equal(review.expected_versions["2026-01-05"], 4);
  assert.equal(review.comparisons[0].changed[0].before.value_numeric, 5);
  assert.equal(review.comparisons[0].removed[0].facility_id, "facility-b");
});

test("review must match exact source bytes, organization and current mapping", () => {
  const review = plan();
  validateReviewedPlan(review, "org", content, normalize(), reviewContext(facilities, definitions));
  assert.throws(() => validateReviewedPlan(review, "other", content, normalize(), reviewContext(facilities, definitions)));
  assert.throws(() => validateReviewedPlan(review, "org", content + "\n", normalize(), reviewContext(facilities, definitions)));
  assert.throws(() => validateReviewedPlan(review, "org", content, [{ ...normalize()[0], facility_id: "different" }], reviewContext(facilities, definitions)));
  assert.throws(() => validateReviewedPlan({ ...review, expected_versions: {} }, "org", content, normalize(), reviewContext(facilities, definitions)));
});


test("CLI preview is read-only; publication sends one atomic command with reviewed versions", async (t) => {
  const { default: fs } = await import("node:fs");
  const scratch = process.env.HCOL_TEST_RUN_DIR;
  if (!scratch) { t.skip("Set HCOL_TEST_RUN_DIR to an owned test-artifact directory."); return; }
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-only";
  console.log = () => {};
  globalThis.fetch = async (url, init) => {
    calls.push({ route: url.pathname, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    const offset = Number(url.searchParams.get("offset"));
    let data = [];
    if (url.pathname.endsWith("/facilities")) data = offset < facilities.length ? [facilities[offset]] : [];
    else if (url.pathname.endsWith("/exec_standup_metric_definitions")) data = offset === 0 ? definitions : [];
    else if (url.pathname.endsWith("/haven_publish_standup_import")) data = { duplicate: false, imported_week_count: 1 };
    return new Response(JSON.stringify(data), { status: 200 });
  };
  try {
    fs.writeFileSync(`${scratch}/source.csv`, content, { mode: 0o600 });
    const review = await main([`${scratch}/source.csv`, "org"]);
    assert.ok(calls.every((call) => call.method === "GET"));
    assert.equal(review.comparisons[0].expected_cells, 3, "must paginate beyond small server caps");
    fs.writeFileSync(`${scratch}/reviewed.json`, JSON.stringify(review), { mode: 0o600 });
    const result = await main([`${scratch}/source.csv`, "org", "--publish", "--plan", `${scratch}/reviewed.json`, "--definition-reference", "synthetic-review"]);
    assert.equal(result.imported_week_count, 1);
    const writes = calls.filter((call) => call.method !== "GET");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].route, "/rest/v1/rpc/haven_publish_standup_import");
    assert.deepEqual(writes[0].body.p_expected_versions, { "2026-01-05": 0 });
    fs.writeFileSync(`${scratch}/source.csv`, content.replace(",0,", ",1,"));
    await assert.rejects(main([`${scratch}/source.csv`, "org", "--publish", "--plan", `${scratch}/reviewed.json`, "--definition-reference", "synthetic-review"]), /does not match/);
    assert.equal(calls.filter((call) => call.method !== "GET").length, 1, "changed file must not write");
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});


test("malformed quotes cannot turn ambiguous source text into a number", () => {
  for (const value of ['1"2"', '"12"x', '"1""2"']) assert.throws(() => normalize(content.replace(",0,", `,${value},`)));
});

test("review rejects registry and facility coverage drift even when row mappings stay identical", () => {
  const review = plan();
  assert.throws(() => validateReviewedPlan(review, "org", content, normalize(), reviewContext([...facilities, { id: "facility-c", name: "C" }], definitions)), /changed after review/);
  assert.throws(() => validateReviewedPlan(review, "org", content, normalize(), reviewContext(facilities, [{ ...definitions[0], value_type: "currency" }])), /changed after review/);
});


test("review surfaces label-only changes", () => {
  const review = plan({ snapshots: [{ id: "snapshot", week_of: "2026-01-05", published_version: 4 }], existingMetrics: [
    { ...normalize()[0], snapshot_id: "snapshot", metric_label: "Old label" },
  ] });
  assert.equal(review.comparisons[0].changed.length, 1);
  assert.equal(review.comparisons[0].changed[0].before.metric_label, "Old label");
});
