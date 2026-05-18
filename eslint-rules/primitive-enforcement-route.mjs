const UP = /\buppercase\b/;
const TRACK = /\btracking-(?:wider|widest)\b/;

/** @returns {Generator<string>} */
function* literalsFromJsxAttrValue(attrValueNode) {
  if (!attrValueNode) return;
  if (
    attrValueNode.type === "Literal" &&
    typeof attrValueNode.value === "string"
  ) {
    yield attrValueNode.value;
    return;
  }
  if (attrValueNode.type !== "JSXExpressionContainer") return;
  const ex = attrValueNode.expression;
  if (!ex) return;
  if (ex.type === "Literal" && typeof ex.value === "string") yield ex.value;
  if (
    ex.type === "TemplateLiteral" &&
    Array.isArray(ex.quasis)
  ) {
    for (const q of ex.quasis) {
      yield typeof q?.value?.cooked === "string"
        ? q.value.cooked
        : String(q?.value?.raw ?? "");
    }
  }
  if (ex.type === "CallExpression" && Array.isArray(ex.arguments)) {
    for (const arg of ex.arguments) {
      if (arg.type === "Literal" && typeof arg.value === "string") {
        yield arg.value;
      } else if (arg.type === "TemplateLiteral") {
        for (const q of arg.quasis) {
          yield typeof q?.value?.cooked === "string"
            ? q.value.cooked
            : String(q?.value?.raw ?? "");
        }
      }
    }
  }
}

function classNameSpansTrackedCaps(fragJoined) {
  const s = fragJoined.replace(/\s+/g, " ");
  return UP.test(s) && TRACK.test(s);
}

/** App route Quiet Operator primitives — ESLint scoped to `/src/app/**`. */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Prefer UI primitives (`Button`, `Select`, semantic `table` wrappers); ban tracked shouting-caps Tailwind combos in routes.",
    },
    schema: [],
  },

  /** @returns {import("eslint").Rule.RuleListener} */
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (!node.name || node.name.type !== "JSXIdentifier") return;
        const n = node.name.name;
        if (n === "button") {
          context.report({
            node,
            message:
              "Use `<Button>` from `@/components/ui/button` instead of `<button>` in app routes.",
          });
        }
        if (n === "select") {
          context.report({
            node,
            message:
              "Use `@/components/ui/select` instead of `<select>` in app routes.",
          });
        }
        /** Primitives internally render `<thead>` / `<th>` — ban raw markup in routes. */
        if (n === "thead" || n === "th") {
          context.report({
            node,
            message:
              "Use `@/components/ui/table` (`TableHeader`, `TableHead`) instead of raw `<thead>` / `<th>` in app routes.",
          });
        }

        const classAttr = Array.isArray(node.attributes)
          ? /** @type {import("eslint").Rule.Node[]} */ (node.attributes).find(
              (at) =>
                at?.type === "JSXAttribute" &&
                at?.name?.type === "JSXIdentifier" &&
                /** @type {{ name?: { name?: string } }} */ (at).name?.name === "className",
            )
          : null;

        if (!classAttr || classAttr.type !== "JSXAttribute") return;

        /** @type {import("eslint").Rule.Node | null | undefined} */
        const v = /** @type {{ value?: unknown }} */ (classAttr).value ?? null;

        /** @type {string[]} */
        const frags = [];
        for (const f of literalsFromJsxAttrValue(
          /** @type {never} */
          (v),
        )) {
          frags.push(f);
        }
        if (frags.length && classNameSpansTrackedCaps(frags.join(""))) {
          context.report({
            node: classAttr,
            message:
              "Avoid `uppercase` together with `tracking-wider` / `tracking-widest` on route JSX (Quiet Operator).",
          });
        }
      },
    };
  },
};
