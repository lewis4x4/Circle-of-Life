/** useRouter for the fixture: replace() updates the address bar the way the App Router would. */
export function useRouter() {
  return {
    replace: (href: string) => window.history.replaceState(null, "", href.replace("/admin/document-intake/accuracy", "/")),
    push: (href: string) => window.history.pushState(null, "", href),
  };
}
