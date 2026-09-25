export const useParams = () => ({ id: "33333333-3333-4333-8333-333333333333" });
export const useRouter = () => ({ push: (url: string) => { window.location.href = url; }, refresh: () => window.location.reload() });
export const usePathname = () => window.location.pathname;
export const useSearchParams = () => new URLSearchParams(window.location.search);
