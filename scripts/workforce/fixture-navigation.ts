export const usePathname = () => ({ today: "/admin/staffing", schedule: "/admin/schedules/synthetic-schedule", people: "/admin/staff", timecards: "/admin/timecards" }[new URLSearchParams(window.location.search).get("view") ?? "today"] ?? "/admin/staffing");
export const useRouter = () => ({ push: (url: string) => { window.location.href = url; }, refresh: () => window.location.reload() });
export const useSearchParams = () => new URLSearchParams(window.location.search);

export const useParams = () => ({ id: "synthetic-schedule" });
