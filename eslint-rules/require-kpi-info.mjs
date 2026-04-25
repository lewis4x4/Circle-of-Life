function getJsxName(nameNode) {
  if (!nameNode) return "";
  if (nameNode.type === "JSXIdentifier") return nameNode.name;
  if (nameNode.type === "JSXMemberExpression") return getJsxName(nameNode.property);
  return "";
}

function hasProp(node, propName) {
  return node.attributes.some(
    (attribute) => attribute.type === "JSXAttribute" && attribute.name?.name === propName,
  );
}

function valueLooksComputed(node) {
  const valueProp = node.attributes.find(
    (attribute) => attribute.type === "JSXAttribute" && attribute.name?.name === "value",
  );
  if (!valueProp || valueProp.type !== "JSXAttribute") return false;
  if (!valueProp.value) return false;
  if (valueProp.value.type === "Literal") return false;
  if (valueProp.value.type !== "JSXExpressionContainer") return true;

  const expression = valueProp.value.expression;
  return expression.type !== "Literal";
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require KPI tooltip copy for computed KPITile values.",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (getJsxName(node.name) !== "KPITile") return;
        if (!valueLooksComputed(node)) return;
        if (hasProp(node, "info")) return;

        context.report({
          node,
          message: "Computed KPITile values must include an info tooltip contract string.",
        });
      },
    };
  },
};
