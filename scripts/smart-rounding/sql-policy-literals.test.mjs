import { test } from "node:test";
import assert from "node:assert/strict";
import { functionBodies, policyFindings, effectiveBodies } from "./sql-policy-literals.mjs";

test("seed values are allowed but identical policy literals in a function are rejected", () => {
  const sql = `INSERT INTO facility_cadence_windows VALUES ('06:00');
CREATE FUNCTION public.observation_policy() RETURNS void LANGUAGE plpgsql AS $policy$
BEGIN v_grace := 60; PERFORM interval '30 minutes'; END;
$policy$;`;
  const definitions = functionBodies(sql);
  assert.equal(definitions.length, 1);
  assert.equal(policyFindings(definitions[0]).length, 2);
});

test("database configuration reads and unit arithmetic are not policy defaults", () => {
  const [definition] = functionBodies(`CREATE FUNCTION public.cadence_shape() RETURNS int LANGUAGE sql AS $$
SELECT extract(hour FROM w.due_at_local) * 60 + extract(minute FROM w.due_at_local) FROM facility_cadence_windows w;
$$;`);
  assert.deepEqual(policyFindings(definition), []);
});

test("fixed shift filters are rejected and comments do not supply executable policy", () => {
  const [definition] = functionBodies(`CREATE FUNCTION public.observation_policy() RETURNS void LANGUAGE plpgsql AS $$
-- v_grace := 60;
BEGIN PERFORM * FROM windows WHERE shift_key = 'night'; END;
$$;`);
  assert.deepEqual(policyFindings(definition).map((finding) => finding.kind), ["fixed shift"]);
});

test("transport lease exception is exact, not a whole migration exemption", () => {
  const body = "SELECT interval '10 minutes';";
  assert.deepEqual(policyFindings({ name: "haven.observation_delivery_claim_timeout", body, line: 1 }), []);
  assert.equal(policyFindings({ name: "haven.observation_grace", body, line: 1 }).length, 1);
});

test("literal SQL clock times cannot hide behind a seed-file exemption", () => {
  for (const expression of ["TIME '06:00'", "'18:00'::time"]) {
    assert.equal(policyFindings({ name: "public.cadence_window", body: `SELECT ${expression};`, line: 1 }).length, 1);
  }
});

test("a later overload does not hide another still executing overload", () => {
  const bodies = effectiveBodies([
    {file:"001.sql", sql:"CREATE FUNCTION public.observation_policy(p_id uuid) RETURNS int LANGUAGE sql AS $$ SELECT 1; $$; CREATE FUNCTION public.observation_policy(p_id uuid,p_other int) RETURNS int LANGUAGE plpgsql AS $$ BEGIN v_grace := 45; END $$;"},
    {file:"002.sql", sql:"CREATE OR REPLACE FUNCTION public.observation_policy(p_id uuid) RETURNS int LANGUAGE sql AS $$ SELECT 2; $$;"},
  ]);
  assert.equal(bodies.length, 2);
  assert.equal(bodies.flatMap(policyFindings).length, 1);
});
test("single quoted bodies and quoted identifiers are scanned", () => {
  const bodies = functionBodies(`CREATE FUNCTION "public"."observation_policy"() RETURNS int LANGUAGE sql AS 'SELECT interval ''45 minutes'';';`);
  assert.equal(bodies.length, 1);
  assert.equal(bodies.flatMap(policyFindings).length, 1);
});
test("a dropped overload is no longer executing policy", () => {
  const bodies = effectiveBodies([{file:"001.sql", sql:"CREATE FUNCTION public.observation_policy(p_id uuid) RETURNS int LANGUAGE sql AS $$ SELECT 1; $$; DROP FUNCTION public.observation_policy(uuid);"}]);
  assert.equal(bodies.length, 0);
});
