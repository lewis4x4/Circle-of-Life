// COL-656: the audit counted five-plus back-link styles ("← Queue",
// "‹ Back to admissions", "BACK TO PROFILE" pill, boxed "← HUB", "Back to
// cockpit" floating centre). Use the design-system BackLink, or the `backLink`
// prop on PageHeader / RecordDetailHeader.
//
// Flags: JSX text that starts with an arrow glyph (← ‹ «) or reads
// "back to …"; and a <Link>/<a> whose children include an ArrowLeft /
// ChevronLeft icon. Pre-existing ones are baselined in eslint-suppressions.json.

const ARROW_TEXT = /^\s*[←‹«]/;
const BACK_TO_TEXT = /^\s*back to\b/i;
const BACK_ICONS = new Set(["ArrowLeft", "ChevronLeft", "MoveLeft", "ArrowLeftCircle"]);
const LINK_ELEMENTS = new Set(["Link", "a"]);

const MESSAGE =
  "Use the design-system BackLink (or the `backLink` prop on PageHeader / RecordDetailHeader) instead of an ad-hoc back link (COL-656).";

function elementName(opening) {
  const name = opening?.name;
  if (!name) return "";
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return name.property.name;
  return "";
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Forbid ad-hoc back links; use BackLink." },
    schema: [],
  },
  create(context) {
    return {
      JSXText(node) {
        const text = node.value;
        if (ARROW_TEXT.test(text) || BACK_TO_TEXT.test(text)) {
          context.report({ node, message: MESSAGE });
        }
      },
      JSXElement(node) {
        if (!LINK_ELEMENTS.has(elementName(node.openingElement))) return;
        const hasBackIcon = node.children.some(
          (child) => child.type === "JSXElement" && BACK_ICONS.has(elementName(child.openingElement)),
        );
        if (hasBackIcon) context.report({ node: node.openingElement, message: MESSAGE });
      },
    };
  },
};
