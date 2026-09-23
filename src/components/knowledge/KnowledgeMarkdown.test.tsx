import { readFileSync } from "node:fs";
import path from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KnowledgeMarkdown } from "@/components/knowledge/KnowledgeMarkdown";

describe("KnowledgeMarkdown (COL-689)", () => {
  it("renders markdown as elements, never as literal syntax", () => {
    const { container } = render(
      <KnowledgeMarkdown source={"# Evacuation\n\n**Call 911** first. See [[Fire Plan]].\n\n- Exit A\n- Exit B"} />,
    );
    expect(screen.getByRole("heading", { name: "Evacuation" })).toBeInTheDocument();
    expect(screen.getByText("Call 911").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.textContent).not.toMatch(/\*\*|\[\[|^#/);
    expect(container.textContent).toContain("See Fire Plan.");
  });

  it("does not inject HTML found in document text", () => {
    const { container } = render(<KnowledgeMarkdown source={"<img src=x onerror=alert(1)> text"} />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("knowledge screens render document text through the markdown helpers (COL-689)", () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

  it("the document viewer renders chunks as markdown", () => {
    const source = read("src/app/(admin)/admin/knowledge/documents/[id]/page.tsx");
    expect(source).toContain("<KnowledgeMarkdown source={chunk.content}");
    expect(source).not.toMatch(/>\{chunk\.content\}</);
  });

  it("summaries and cited excerpts show plain text, not markdown syntax", () => {
    expect(read("src/app/(admin)/admin/knowledge/admin/review/[id]/page.tsx")).toContain("markdownToPlainText(document.summary)");
    expect(read("src/features/knowledge/components/DocumentTable.tsx")).toContain("markdownToPlainText(doc.summary)");
    expect(read("src/features/knowledge/components/ChatMessage.tsx")).toContain("markdownToPlainText(s.excerpt)");
  });
});
