// COL-656: `font-mono` became a house style (neon "engine" tiles, ALL-CAPS mono
// labels, mono buttons and body copy) and is behind most of the axe contrast
// failures the 2026-09-22 audit found. Monospace is for code and identifiers
// only. Put those in <code>/<kbd>/<pre>/<samp>, or use the shared `IdText`
// helper. Numbers that must line up take `tabular-nums`, not a mono face.
//
// Pre-existing uses are baselined in eslint-suppressions.json; convert them and
// run `npx eslint src --prune-suppressions`.

const MONO_TOKEN = /(^|[\s:"'`])font-mono(?=$|[\s"'`])/;
const CODE_ELEMENTS = new Set(["code", "kbd", "pre", "samp"]);

const MESSAGE =
  "`font-mono` is for code and identifiers only: wrap them in <code>/<kbd>/<pre>/<samp> or `IdText`; use `tabular-nums` to align numbers (COL-656).";

function jsxElementName(node) {
  const name = node?.name;
  if (!name) return "";
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return name.property.name;
  return "";
}

function insideCodeElement(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "JSXOpeningElement") return CODE_ELEMENTS.has(jsxElementName(current)) || jsxElementName(current) === "IdText";
    if (current.type === "JSXElement") {
      return CODE_ELEMENTS.has(jsxElementName(current.openingElement)) || jsxElementName(current.openingElement) === "IdText";
    }
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Forbid font-mono outside code and identifier contexts." },
    schema: [],
  },
  create(context) {
    function check(node, text) {
      if (typeof text !== "string" || !MONO_TOKEN.test(text)) return;
      if (insideCodeElement(node)) return;
      context.report({ node, message: MESSAGE });
    }
    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value?.cooked ?? node.value?.raw);
      },
    };
  },
};
