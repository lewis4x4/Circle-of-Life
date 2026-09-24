import React from "react";

import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from "@/lib/knowledge/markdown-text";

/**
 * Renders knowledge-base Markdown as React elements (COL-689): headings, lists, quotes,
 * code, **bold**, *italic*, links, and `[[wikilinks]]` as their plain title. No HTML is
 * injected, so document text cannot carry markup of its own.
 */
function Inline({ nodes }: { nodes: MarkdownInline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.kind) {
          case "text":
            return <React.Fragment key={index}>{node.text}</React.Fragment>;
          case "strong":
            return (
              <strong key={index} className="font-semibold">
                <Inline nodes={node.children} />
              </strong>
            );
          case "em":
            return (
              <em key={index}>
                <Inline nodes={node.children} />
              </em>
            );
          case "code":
            return (
              <code key={index} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
                {node.text}
              </code>
            );
          case "link": {
            const external = /^https?:/i.test(node.href);
            return (
              <a
                key={index}
                href={node.href}
                className="text-primary underline-offset-2 hover:underline"
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                <Inline nodes={node.children} />
              </a>
            );
          }
        }
      })}
    </>
  );
}

const HEADING_CLASS: Record<number, string> = {
  1: "text-base font-semibold",
  2: "text-base font-semibold",
  3: "text-sm font-semibold",
  4: "text-sm font-semibold",
  5: "text-sm font-medium",
  6: "text-sm font-medium",
};

function Block({ block }: { block: MarkdownBlock }) {
  switch (block.kind) {
    case "heading": {
      const Tag = `h${Math.min(block.level + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
      return (
        <Tag className={HEADING_CLASS[block.level]}>
          <Inline nodes={block.children} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p>
          <Inline nodes={block.children} />
        </p>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List className={block.ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}>
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline nodes={item} />
            </li>
          ))}
        </List>
      );
    }
    case "quote":
      return (
        <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
          <Inline nodes={block.children} />
        </blockquote>
      );
    case "code":
      return <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{block.text}</pre>;
  }
}

export function KnowledgeMarkdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={className ?? "space-y-2"}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
