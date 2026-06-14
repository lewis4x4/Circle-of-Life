import { describe, expect, it } from "vitest";

import {
  importBookmarkBody,
  isMappable,
  parseManifest,
  type DriveFileRow,
} from "./drive-import";

function fileRow(overrides: Partial<DriveFileRow>): DriveFileRow {
  return {
    id: "f1",
    batch_id: "b1",
    source_name: "Policy.pdf",
    source_path: "Policies/2026",
    source_drive_id: "drive-abc",
    mime_type: "application/pdf",
    size_bytes: 1024,
    web_view_link: "https://drive.google.com/file/d/drive-abc",
    destination: "unassigned",
    owner_user_id: null,
    team_space_id: null,
    status: "pending",
    imported_ref_type: null,
    imported_ref_id: null,
    error: null,
    ...overrides,
  };
}

describe("parseManifest", () => {
  it("returns nothing for empty input", () => {
    expect(parseManifest("")).toEqual([]);
    expect(parseManifest("   ")).toEqual([]);
  });

  it("parses a JSON array (Drive API files.list shape)", () => {
    const raw = JSON.stringify([
      { id: "1", name: "Handbook.docx", mimeType: "application/msword", size: "2048", webViewLink: "http://x/1" },
      { id: "2", name: "", mimeType: "text/plain" },
    ]);
    const rows = parseManifest(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source_name: "Handbook.docx",
      source_drive_id: "1",
      mime_type: "application/msword",
      size_bytes: 2048,
      web_view_link: "http://x/1",
    });
  });

  it("parses a wrapped { files: [...] } object", () => {
    const raw = JSON.stringify({ files: [{ name: "A.txt" }] });
    expect(parseManifest(raw)).toHaveLength(1);
  });

  it("parses CSV with a header row and quoted commas", () => {
    const raw = [
      "name,path,id,mimeType,size,webViewLink",
      '"Menu, June.pdf",Dietary/Menus,d9,application/pdf,500,http://x/d9',
      "Empty,,,,,",
    ].join("\n");
    const rows = parseManifest(raw);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      source_name: "Menu, June.pdf",
      source_path: "Dietary/Menus",
      source_drive_id: "d9",
      size_bytes: 500,
    });
    expect(rows[1].source_name).toBe("Empty");
    expect(rows[1].source_path).toBeNull();
  });

  it("ignores malformed JSON", () => {
    expect(parseManifest("[ {bad json } ")).toEqual([]);
  });
});

describe("isMappable", () => {
  it("requires an owner for a private page", () => {
    expect(isMappable(fileRow({ destination: "private_page" }))).toBe(false);
    expect(isMappable(fileRow({ destination: "private_page", owner_user_id: "u1" }))).toBe(true);
  });

  it("requires a team for a team page", () => {
    expect(isMappable(fileRow({ destination: "team_page" }))).toBe(false);
    expect(isMappable(fileRow({ destination: "team_page", team_space_id: "t1" }))).toBe(true);
  });

  it("allows KB and skip without further mapping", () => {
    expect(isMappable(fileRow({ destination: "knowledge_base" }))).toBe(true);
    expect(isMappable(fileRow({ destination: "skip" }))).toBe(true);
  });

  it("rejects unassigned", () => {
    expect(isMappable(fileRow({ destination: "unassigned" }))).toBe(false);
  });
});

describe("importBookmarkBody", () => {
  it("includes path and link, omits missing fields", () => {
    const body = importBookmarkBody(fileRow({ mime_type: null }));
    expect(body).toContain("Policies/2026");
    expect(body).toContain("https://drive.google.com/file/d/drive-abc");
    expect(body).not.toContain("Type:");
  });
});
