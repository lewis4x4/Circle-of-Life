import { describe, expect, it } from "vitest";

import { markdownToPlainText, parseInline, parseMarkdown, replaceWikilinks } from "@/lib/knowledge/markdown-text";

describe("knowledge-base markdown (COL-689)", () => {
  it("turns wikilinks into their title or alias", () => {
    expect(replaceWikilinks("See [[Fall Policy]] and [[Med Pass#Timing|the med pass rule]].")).toBe(
      "See Fall Policy and the med pass rule.",
    );
  });

  it("parses headings, lists, quotes and code blocks", () => {
    const blocks = parseMarkdown("---\ntitle: x\n---\n# Falls\n\n- one\n- **two**\n\n1. first\n2. second\n\n> note\n\n```\ncode\n```");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "list", "list", "quote", "code"]);
  });

  it("keeps snake_case words intact and only links http or in-app paths", () => {
    expect(parseInline("file_name_here")).toEqual([{ kind: "text", text: "file_name_here" }]);
    expect(parseInline("[x](javascript:void)")).toEqual([{ kind: "text", text: "x" }]);
    expect(parseInline("[Policy](/admin/knowledge)")[0]).toMatchObject({ kind: "link", href: "/admin/knowledge" });
  });

  it("flattens to plain text for excerpts with no markdown syntax left", () => {
    const plain = markdownToPlainText("## Summary\n**Residents** at risk: see [[Grace Pack - Resident Attention]] and [the policy](https://example.com).");
    expect(plain).toBe("Summary Residents at risk: see Grace Pack - Resident Attention and the policy.");
    expect(plain).not.toMatch(/[#*[\]]/);
  });
});
