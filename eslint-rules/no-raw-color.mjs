const RAW_COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

function inspectText(context, node, value) {
  if (typeof value !== "string") return;
  if (!RAW_COLOR_RE.test(value)) return;
  context.report({
    node,
    message: "Use UI-V2 semantic token classes instead of raw hex/rgb color values.",
  });
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow raw hex and rgb color values in UI-V2 scoped files.",
    },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        inspectText(context, node, node.value);
      },
      TemplateElement(node) {
        inspectText(context, node, node.value.raw);
      },
    };
  },
};
