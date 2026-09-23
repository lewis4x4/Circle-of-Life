/**
 * COL-658: a button whose only content is lucide icons has no accessible
 * name (axe `button-name`, critical) unless it carries `aria-label`,
 * `aria-labelledby` or `title`. Also covers a conditional icon swap
 * (`{open ? <ChevronDown /> : <ChevronRight />}`).
 *
 * Applies to native `<button>` and the `Button` primitive. Icon components are
 * recognised by their import from "lucide-react".
 */
const NAME_PROPS = new Set(["aria-label", "aria-labelledby", "title"]);

function jsxName(nameNode) {
  if (!nameNode) return "";
  if (nameNode.type === "JSXIdentifier") return nameNode.name;
  if (nameNode.type === "JSXMemberExpression") return jsxName(nameNode.property);
  return "";
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Require an accessible name on icon-only buttons." },
    schema: [],
    messages: {
      unnamed: "Icon-only button has no accessible name — add aria-label (COL-658).",
    },
  },
  create(context) {
    const icons = new Set();

    function isIconOnly(node) {
      if (!node) return false;
      if (node.type === "JSXElement") {
        return icons.has(jsxName(node.openingElement.name)) && node.children.every(isBlankOrIcon);
      }
      if (node.type === "JSXExpressionContainer") return isIconOnly(node.expression);
      if (node.type === "ConditionalExpression") return isIconOnly(node.consequent) && isIconOnly(node.alternate);
      if (node.type === "LogicalExpression") return isIconOnly(node.right);
      return false;
    }

    function isBlankOrIcon(child) {
      if (child.type === "JSXText") return child.value.trim() === "";
      return isIconOnly(child);
    }

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "lucide-react") return;
        for (const specifier of node.specifiers) icons.add(specifier.local.name);
      },
      JSXElement(node) {
        const name = jsxName(node.openingElement.name);
        if (name !== "button" && name !== "Button") return;
        const attributes = node.openingElement.attributes;
        if (attributes.some((a) => a.type === "JSXSpreadAttribute")) return;
        if (attributes.some((a) => a.type === "JSXAttribute" && NAME_PROPS.has(a.name?.name))) return;
        const children = node.children.filter((child) => !(child.type === "JSXText" && child.value.trim() === ""));
        if (children.length === 0) return;
        if (children.every(isIconOnly)) context.report({ node: node.openingElement, messageId: "unnamed" });
      },
    };
  },
};
