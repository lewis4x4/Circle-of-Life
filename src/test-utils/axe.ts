import axe from "axe-core";

/**
 * Run axe-core over a rendered container and return the violation ids
 * (COL-658). Colour contrast is excluded — the test DOM has no computed
 * styles; contrast is covered by the design-token tests.
 */
export async function axeViolations(container: Element, rules?: string[]): Promise<string[]> {
  const result = await axe.run(container, {
    runOnly: rules ? { type: "rule", values: rules } : { type: "tag", values: ["wcag2a", "wcag2aa"] },
    rules: { "color-contrast": { enabled: false } },
    resultTypes: ["violations"],
  });
  return result.violations.map((violation) => violation.id);
}
