import { beforeEach, describe, expect, it } from "vitest";

import {
  parseSelectedFacilityCookieValue,
  readSelectedFacilityCookie,
  SELECTED_FACILITY_COOKIE,
  syncSelectedFacilityCookie,
} from "./selected-facility-cookie";

const HOMEWOOD = "00000000-0000-0000-0002-000000000003";
const GRANDE_CYPRESS = "00000000-0000-0000-0002-000000000005";

function clearCookie() {
  document.cookie = `${SELECTED_FACILITY_COOKIE}=; Path=/; Max-Age=0`;
}

describe("selected facility cookie", () => {
  beforeEach(clearCookie);

  it("parses a uuid, treats 'all' and junk as no scope", () => {
    expect(parseSelectedFacilityCookieValue(HOMEWOOD)).toBe(HOMEWOOD);
    expect(parseSelectedFacilityCookieValue("all")).toBeNull();
    expect(parseSelectedFacilityCookieValue("")).toBeNull();
    expect(parseSelectedFacilityCookieValue("not-a-uuid")).toBeNull();
    expect(parseSelectedFacilityCookieValue(undefined)).toBeNull();
  });

  it("reads back what it wrote", () => {
    expect(readSelectedFacilityCookie()).toBeNull();
    syncSelectedFacilityCookie(HOMEWOOD);
    expect(readSelectedFacilityCookie()).toBe(HOMEWOOD);
    syncSelectedFacilityCookie(null);
    expect(readSelectedFacilityCookie()).toBeNull();
  });

  it("reports a change only when the server-facing scope changes", () => {
    // Missing cookie and "all" are the same scope: no change, no refresh.
    expect(syncSelectedFacilityCookie(null)).toBe(false);
    expect(syncSelectedFacilityCookie(null)).toBe(false);

    // The drift that showed Grande Cypress's census under Homewood's name.
    expect(syncSelectedFacilityCookie(GRANDE_CYPRESS)).toBe(true);
    expect(syncSelectedFacilityCookie(GRANDE_CYPRESS)).toBe(false);
    expect(syncSelectedFacilityCookie(HOMEWOOD)).toBe(true);
    expect(syncSelectedFacilityCookie(HOMEWOOD)).toBe(false);
    expect(syncSelectedFacilityCookie(null)).toBe(true);
  });

  it("treats an unparseable cookie as no scope", () => {
    document.cookie = `${SELECTED_FACILITY_COOKIE}=%E0%A4%A; Path=/`;
    expect(readSelectedFacilityCookie()).toBeNull();
    expect(syncSelectedFacilityCookie(null)).toBe(false);
  });
});
