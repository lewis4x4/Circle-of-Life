/* eslint-disable @next/next/no-css-tags */
import type { Metadata } from 'next';
import Script from 'next/script';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Facility Launch Center | Circle of Life',
  description: 'Facility DNA command center for Homewood launch readiness.',
  robots: { index: false, follow: false, nocache: true },
};

export default function FacilityLaunchPage() {
  return (
    <>
      <link rel="stylesheet" href="/facility-launch-static/styles.css?v=20260514-flc-push-hardened" />
      <header className="app-header">
        <h1>Facility Launch Center</h1>
        <p className="subhead">Facility DNA command center for Homewood launch readiness</p>
      </header>

      <main className="container">
        <nav id="tabs" className="tabs" />
        <section id="summary" className="panel" />
        <section id="view" className="panel" />
        <section className="panel">
          <div className="row-between">
            <h3>Decision Log (latest)</h3>
            <button id="load-round1-state" type="button">Load Round 1 Import</button>
            <button id="reset-demo" type="button">Reset Onboarding Shell</button>
          </div>
          <ul id="decision-log" />
        </section>
      </main>

      <Script
        src="/facility-launch-static/dist/app.bundle.js?v=20260514-flc-push-hardened"
        strategy="afterInteractive"
        type="module"
      />
    </>
  );
}
