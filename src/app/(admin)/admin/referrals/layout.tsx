import { ReferralsHubNav } from "./referrals-hub-nav";

/** One referral tab strip for every referral page, in one place (COL-655). */
export default function ReferralsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <ReferralsHubNav />
      {children}
    </div>
  );
}
