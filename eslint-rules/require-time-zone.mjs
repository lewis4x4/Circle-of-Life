// COL-659: date/time text formatted without an explicit `timeZone` uses the
// runtime's zone — UTC during server render, the viewer's zone in the browser —
// so the same instant reads differently depending on which path rendered it.
// Use `@/lib/format/datetime` (which always passes the facility zone), or pass
// `timeZone` yourself.

const DATE_ONLY_METHODS = new Set(["toLocaleDateString", "toLocaleTimeString"]);
const DATE_OPTION_KEYS = new Set([
  "dateStyle",
  "timeStyle",
  "weekday",
  "era",
  "year",
  "month",
  "day",
  "dayPeriod",
  "hour",
  "minute",
  "second",
  "fractionalSecondDigits",
  "timeZoneName",
  "hour12",
  "hourCycle",
]);

const MESSAGE =
  "Format dates through @/lib/format/datetime, or pass an explicit `timeZone`: without one the server renders UTC and the browser renders local time (COL-659).";

function propertyName(prop) {
  if (prop.type !== "Property") return null;
  if (prop.key.type === "Identifier" && !prop.computed) return prop.key.name;
  if (prop.key.type === "Literal") return String(prop.key.value);
  return null;
}

/** Resolve an identifier to the object literal a `const` initialises it with. */
function resolveObjectExpression(context, node, depth = 0) {
  if (!node || depth > 3) return null;
  if (node.type === "ObjectExpression") return node;
  if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") {
    return resolveObjectExpression(context, node.expression, depth + 1);
  }
  if (node.type !== "Identifier") return null;
  let scope = context.sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get(node.name);
    if (variable) {
      const def = variable.defs[0];
      if (def && def.type === "Variable" && def.parent.kind === "const" && def.node.init) {
        return resolveObjectExpression(context, def.node.init, depth + 1);
      }
      return null;
    }
    scope = scope.upper;
  }
  return null;
}

/**
 * "missing" when the options are absent or a literal with no `timeZone`;
 * "ok" when `timeZone` is present or the options cannot be resolved statically.
 */
function classifyOptions(context, optionsNode, { requireDateKeys }) {
  if (!optionsNode) return requireDateKeys ? "ok" : "missing";
  const object = resolveObjectExpression(context, optionsNode);
  if (!object) return "ok";
  let hasDateKey = false;
  for (const prop of object.properties) {
    if (prop.type === "SpreadElement") {
      const spread = resolveObjectExpression(context, prop.argument);
      if (!spread) return "ok";
      if (classifyOptions(context, spread, { requireDateKeys: false }) === "ok") return "ok";
      if (spread.properties.some((p) => DATE_OPTION_KEYS.has(propertyName(p)))) hasDateKey = true;
      continue;
    }
    const name = propertyName(prop);
    if (name === "timeZone") return "ok";
    if (DATE_OPTION_KEYS.has(name)) hasDateKey = true;
  }
  if (requireDateKeys && !hasDateKey) return "ok";
  return "missing";
}

function isIntlDateTimeFormat(callee) {
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Intl" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "DateTimeFormat"
  );
}

function isNewDate(node) {
  return node.type === "NewExpression" && node.callee.type === "Identifier" && node.callee.name === "Date";
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require an explicit timeZone when formatting dates for display.",
    },
    schema: [],
  },
  create(context) {
    function checkIntl(node) {
      if (!isIntlDateTimeFormat(node.callee)) return;
      if (classifyOptions(context, node.arguments[1], { requireDateKeys: false }) === "missing") {
        context.report({ node, message: MESSAGE });
      }
    }

    return {
      NewExpression: checkIntl,
      CallExpression(node) {
        checkIntl(node);
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return;
        const method = callee.property.name;
        const options = node.arguments[1];
        if (DATE_ONLY_METHODS.has(method)) {
          if (classifyOptions(context, options, { requireDateKeys: false }) === "missing") {
            context.report({ node, message: MESSAGE });
          }
          return;
        }
        if (method === "toLocaleString") {
          // Number#toLocaleString is common; flag only calls that are clearly on
          // a Date (`new Date(...)`) or that pass date/time options.
          const onDate = isNewDate(callee.object);
          const verdict = classifyOptions(context, options, { requireDateKeys: !onDate });
          if (verdict === "missing") context.report({ node, message: MESSAGE });
        }
      },
    };
  },
};
