/**
 * UI-V2 rule: pages cannot import directly from `src/design-system/components/**`
 * unless they also import from `src/design-system/templates`. Pages must compose
 * via templates so layout/region cardinality is enforced at the template
 * boundary, not at every page.
 *
 * Allowed import roots:
 *   - "@/design-system/templates"
 *   - "@/design-system/templates/*"
 *
 * Allowed component imports survive when paired with a template import on the
 * same file (incidental re-imports for typed props, e.g. `KPITileProps`).
 *
 * Scope: see eslint.config.mjs — only files under `src/app/(admin)/admin/v2/**`,
 * excluding the dev preview surface (`design-preview/**`) which intentionally
 * references the primitive registry.
 */
const COMPONENTS_PATH = /(?:^|\/)design-system\/components(?:\/|$)/;
const TEMPLATES_PATH = /(?:^|\/)design-system\/templates(?:\/|$)/;

function isComponentImport(source) {
  return COMPONENTS_PATH.test(source);
}

function isTemplateImport(source) {
  return TEMPLATES_PATH.test(source);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Pages under (admin)/admin/v2 must compose via design-system/templates rather than importing primitives directly.",
    },
    schema: [],
  },
  create(context) {
    const componentImports = [];
    let templateImported = false;

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== "string") return;
        if (isComponentImport(source)) componentImports.push(node);
        if (isTemplateImport(source)) templateImported = true;
      },
      "Program:exit"() {
        if (componentImports.length === 0) return;
        if (templateImported) return;
        for (const node of componentImports) {
          context.report({
            node,
            message:
              "UI-V2 pages must import from design-system/templates. Direct primitive imports are blocked unless a template import is also present in this file.",
          });
        }
      },
    };
  },
};
