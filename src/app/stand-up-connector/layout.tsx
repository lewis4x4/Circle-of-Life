import type { ReactNode } from 'react';

const nav = [
  ['Overview', '/stand-up-connector'],
  ['Privacy policy', '/stand-up-connector/privacy'],
  ['Terms of use', '/stand-up-connector/terms'],
] as const;

export default function StandUpConnectorLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f2ea] text-[#1c2822]">
      <header className="border-b border-[#d9d2c4] bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-5 py-5">
          <a href="/stand-up-connector" className="font-serif text-xl font-semibold">Haven · Circle of Life</a>
          <nav aria-label="Stand Up connector information" className="flex flex-wrap gap-4 text-sm font-medium">
            {nav.map(([label, href]) => <a key={href} href={href} className="underline-offset-4 hover:underline">{label}</a>)}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-12">{children}</main>
      <footer className="border-t border-[#d9d2c4] px-5 py-8 text-center text-sm text-[#4e5b54]">
        Circle of Life Assisted Living Facilities · <a className="underline" href="https://circleoflifecommunities.com/contact-us/">Contact us</a>
      </footer>
    </div>
  );
}
