const RAW_SPACING_RE = /\[[^\]]*(?:px|rem|em)[^\]]*\]/;

function getStaticClassName(node) {
  if (!node.value) return null;
  if (node.value.type === "Literal" && typeof node.value.value === "string") {
    return node.value.value;
  }
  if (
    node.value.type === "JSXExpressionContainer" &&
    node.value.expression.type === "Literal" &&
    typeof node.value.expression.value === "string"
  ) {
    return node.value.expression.value;
  }
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow raw px/em/rem arbitrary values in UI-V2 className strings.",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name?.name !== "className") return;
        const className = getStaticClassName(node);
        if (!className || !RAW_SPACING_RE.test(className)) return;
        context.report({
          node,
          message: "Use UI-V2 spacing tokens instead of raw px/em/rem values in className.",
        });
      },
    };
  },
};
