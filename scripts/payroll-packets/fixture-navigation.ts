export const useRouter = () => ({ push: (path: string) => { window.location.href = path; }, refresh: () => window.location.reload() });
export const usePathname = () => window.location.pathname;
export const useSearchParams = () => new URLSearchParams(window.location.search);
