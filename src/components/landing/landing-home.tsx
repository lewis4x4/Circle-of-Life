"use client";

import Link from "next/link";
import Image from "next/image";
import React, { useEffect, useRef } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useTheme } from "next-themes";
import {
  Activity,
  ArrowRight,
  Banknote,
  CheckCircle2,
  ClipboardList,
  Heart,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const easeOut = [0.22, 1, 0.36, 1] as const;

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.65, ease: easeOut },
  }),
};

const bentoReveal = {
  hidden: { opacity: 0, y: 36, filter: "blur(8px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.7, ease: easeOut },
  },
};

const trustItems = [
  { icon: CheckCircle2, label: "HIPAA-ready architecture" },
  { icon: CheckCircle2, label: "SOC 2 Type II path" },
  { icon: CheckCircle2, label: "State survey alignment" },
  { icon: ShieldCheck, label: "RLS at the data layer" },
];

export default function LandingHome() {
  const { setTheme } = useTheme();
  const reduceMotion = useReducedMotion();
  const heroVisualRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroVisualRef,
    offset: ["start end", "end start"],
  });
  const parallaxY = useTransform(scrollYProgress, [0, 1], reduceMotion ? [0, 0] : [0, 56]);
  const parallaxSpring = useSpring(parallaxY, { stiffness: 80, damping: 28 });

  useEffect(() => {
    setTheme("dark");
  }, [setTheme]);

  return (
    <div
      className={cn(
        "landing-root relative flex min-h-screen flex-col overflow-hidden bg-[#030712] text-slate-50",
        "selection:bg-teal-500/40 selection:text-white",
      )}
    >
      <div className="landing-noise pointer-events-none absolute inset-0 z-0" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(45,212,191,0.14),transparent_50%),radial-gradient(ellipse_80%_50%_at_100%_0%,rgba(129,140,248,0.1),transparent_45%),radial-gradient(ellipse_60%_40%_at_0%_100%,rgba(20,184,166,0.08),transparent_50%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.35] bg-[linear-gradient(to_right,rgba(148,163,184,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.07)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"
        aria-hidden
      />

      <nav className="fixed top-0 z-50 w-full border-b border-white/[0.06] bg-[#030712]/70 backdrop-blur-2xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-6">
          <motion.div
            className="flex items-center gap-3"
            initial={reduceMotion ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: easeOut }}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400/90 to-teal-700/90 shadow-lg shadow-teal-500/20 ring-1 ring-white/20">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight text-white">Haven</span>
            <Badge
              variant="outline"
              className="hidden border-teal-500/35 bg-teal-500/10 text-[10px] font-semibold uppercase tracking-widest text-teal-200/90 sm:inline-flex"
            >
              Operations OS
            </Badge>
          </motion.div>

          <div className="hidden items-center gap-8 text-sm font-medium text-slate-400 md:flex">
            {["Platform", "Clinical", "Multi-entity", "Security"].map((label, i) => (
              <motion.span
                key={label}
                initial={reduceMotion ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 * i, duration: 0.45 }}
                whileHover={reduceMotion ? undefined : { y: -1 }}
              >
                <Link
                  href={`#${["platform", "clinical", "operations", "security"][i]}`}
                  className="border-b border-transparent pb-0.5 transition-colors hover:border-teal-400/80 hover:text-white"
                >
                  {label}
                </Link>
              </motion.span>
            ))}
          </div>

          <motion.div
            className="flex items-center gap-3"
            initial={reduceMotion ? false : { opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: easeOut }}
          >
            <Link
              href="/login"
              className="text-sm font-medium text-slate-400 transition-colors hover:text-white"
            >
              Sign in
            </Link>
            <Link
              href="/onboarding"
              className={cn(
                buttonVariants({ size: "sm" }),
                "hidden border border-teal-400/40 bg-teal-500/20 text-teal-50 hover:bg-teal-500/30 sm:inline-flex",
              )}
            >
              Onboarding
            </Link>
          </motion.div>
        </div>
      </nav>

      <main id="main-content" className="relative z-10 flex flex-1 flex-col">
        <section className="mx-auto grid w-full max-w-7xl gap-12 px-5 pb-20 pt-28 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:items-center lg:gap-16 lg:pb-28 lg:pt-36">
          <div className="flex flex-col">
            <motion.div
              custom={0}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-teal-500/25 bg-teal-500/[0.08] px-4 py-1.5 text-sm text-teal-100/95 backdrop-blur-sm"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-40" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-400" />
              </span>
              Haven for multi-site operators
              <ArrowRight className="h-3.5 w-3.5 opacity-70" />
            </motion.div>

            <motion.h1
              custom={1}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="font-display text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl md:text-6xl lg:text-[3.35rem] xl:text-[3.75rem]"
            >
              One calm layer for{" "}
              <span className="bg-gradient-to-r from-teal-300 via-emerald-200 to-cyan-300 bg-clip-text text-transparent">
                bedside to boardroom
              </span>{" "}
              operations.
            </motion.h1>

            <motion.p
              custom={2}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mt-6 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg"
            >
              Assisted living, home health, and HCBS on a single role-governed platform—census, clinical
              workflows, compliance signals, and owner visibility without the legacy patchwork.
            </motion.p>

            <motion.div
              custom={3}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center"
            >
              <Link
                href="/onboarding"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-12 rounded-xl bg-white px-7 text-base font-semibold text-slate-950 shadow-[0_0_48px_-12px_rgba(45,212,191,0.55)] hover:bg-slate-100",
                )}
              >
                Open onboarding portal
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
              <Link
                href="#demo"
                className={cn(
                  buttonVariants({ size: "lg", variant: "outline" }),
                  "h-12 rounded-xl border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08]",
                )}
              >
                Request early access
              </Link>
            </motion.div>

            <motion.div
              custom={4}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mt-10 flex flex-wrap gap-x-8 gap-y-2 text-xs text-slate-500"
            >
              <span className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-teal-500" />
                Facility-scoped by design
              </span>
              <span className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-indigo-400" />
                Audit-friendly trails
              </span>
            </motion.div>

            <motion.div
              custom={5}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mt-6 max-w-xl rounded-2xl border border-teal-400/25 bg-teal-500/[0.08] p-4 backdrop-blur-sm"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-500/20 text-teal-200">
                  <ClipboardList className="h-4 w-4" />
                </div>
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-200/90">
                    Onboarding Command Center
                  </p>
                  <p className="text-sm leading-relaxed text-slate-300">
                    Separate activation portal for leadership discovery, decisions, blockers, and document collection.
                  </p>
                  <div className="flex flex-wrap gap-2 text-[11px] text-slate-300">
                    <span className="rounded-full border border-white/15 bg-white/[0.03] px-2.5 py-1">22% complete</span>
                    <span className="rounded-full border border-white/15 bg-white/[0.03] px-2.5 py-1">4 blockers</span>
                    <span className="rounded-full border border-white/15 bg-white/[0.03] px-2.5 py-1">12 documents pending</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          <motion.div
            ref={heroVisualRef}
            style={{ y: parallaxSpring }}
            className="relative mx-auto w-full max-w-lg lg:max-w-none"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.85, delay: 0.15, ease: easeOut }}
          >
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-teal-500/25 via-transparent to-indigo-500/20 opacity-60 blur-3xl" />
            <div className="relative aspect-square overflow-hidden rounded-[1.75rem] border border-white/[0.08] shadow-2xl shadow-black/50 ring-1 ring-white/[0.06]">
              <Image
                src="/luxury-alf-interior.png"
                alt="Luxury Assisted Living Interior"
                fill
                className="object-cover object-center"
                priority
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#030712] via-[#030712]/40 to-transparent opacity-90" />
              <div className="absolute bottom-5 left-5 right-5 rounded-xl border border-white/10 bg-black/60 p-4 backdrop-blur-md">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-200/80">
                  Built for Care
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  Premium hospitality environments supported by invisible, high-precision operations technology.
                </p>
              </div>
            </div>
          </motion.div>
        </section>

        <section
          id="platform"
          className="relative mx-auto w-full max-w-6xl px-5 pb-24 sm:px-6"
        >
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            variants={bentoReveal}
          >
            <div className="absolute -inset-x-8 -top-8 h-64 rounded-full bg-teal-500/5 blur-3xl" aria-hidden />
            <Card className="relative overflow-hidden border-white/[0.08] bg-white/[0.03] py-0 text-slate-50 shadow-2xl ring-1 ring-white/[0.05] backdrop-blur-sm">
              <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.04] px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                </div>
                <div className="mx-auto hidden h-6 flex-1 max-w-md items-center justify-center rounded-md border border-white/[0.06] bg-black/20 sm:flex">
                  <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
                    app.haven.ops — secure session
                  </span>
                </div>
              </div>
              <CardContent className="grid h-[min(52vh,420px)] grid-cols-12 gap-4 p-4 sm:h-[min(56vh,520px)] sm:gap-6 sm:p-6 md:h-[min(60vh,600px)]">
                <div className="col-span-12 hidden flex-col gap-3 border-r border-white/[0.06] pr-4 md:col-span-3 md:flex">
                  <div className="h-5 w-20 rounded bg-white/10" />
                  {Array.from({ length: 7 }).map((_, i) => (
                    <motion.div
                      key={i}
                      className="h-3 rounded bg-white/[0.06]"
                      initial={reduceMotion ? false : { opacity: 0, x: -8 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.04 * i, duration: 0.4 }}
                    />
                  ))}
                </div>
                <div className="col-span-12 flex flex-col gap-4 md:col-span-9">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="h-7 w-44 rounded-md bg-white/10" />
                    <Badge className="border-0 bg-teal-500/20 text-teal-100">North Florida</Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <motion.div
                        key={i}
                        className="flex h-20 flex-col justify-between rounded-xl border border-white/[0.06] bg-white/[0.04] p-3 sm:h-24"
                        whileHover={reduceMotion ? undefined : { scale: 1.02 }}
                        transition={{ type: "spring", stiffness: 400, damping: 22 }}
                      >
                        <div className="h-2 w-1/2 rounded bg-white/15" />
                        <div className="h-5 w-3/4 rounded bg-gradient-to-r from-teal-400/40 to-white/20" />
                      </motion.div>
                    ))}
                  </div>
                  <div className="min-h-0 flex-1 rounded-xl border border-white/[0.06] bg-black/25 p-3">
                    <div className="mb-2 hidden h-8 border-b border-white/[0.06] sm:flex sm:items-center sm:gap-4">
                      <div className="h-2 w-6 rounded bg-white/20" />
                      <div className="h-2 w-24 rounded bg-white/15" />
                      <div className="h-2 w-16 rounded bg-white/15" />
                    </div>
                    <div className="flex flex-col gap-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <motion.div
                          key={i}
                          className="flex h-11 items-center gap-3 rounded-lg bg-white/[0.04] px-3"
                          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.05 * i }}
                        >
                          <div className="h-7 w-7 shrink-0 rounded-full bg-gradient-to-br from-slate-600 to-slate-800" />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="h-2 w-32 max-w-[70%] rounded bg-white/20" />
                            <div className="h-1.5 w-24 rounded bg-white/10" />
                          </div>
                          {i === 2 ? (
                            <span className="h-5 shrink-0 rounded-full bg-red-500/25 px-2 text-[10px] font-medium text-red-200 ring-1 ring-red-400/30">
                              Alert
                            </span>
                          ) : null}
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </section>

        <section
          id="clinical"
          className="border-y border-white/[0.06] bg-white/[0.02] py-10"
        >
          <div className="landing-marquee relative overflow-hidden">
            <div className="landing-marquee-track flex w-max gap-16 px-6">
              {[...trustItems, ...trustItems].map((item, idx) => (
                <div key={`${item.label}-${idx}`} className="flex items-center gap-2 text-slate-400">
                  <item.icon className="h-5 w-5 shrink-0 text-teal-400/90" />
                  <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.18em]">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="operations"
          className="relative mx-auto w-full max-w-7xl px-5 py-24 sm:px-6 lg:py-32"
        >
          <motion.div
            className="mb-16 text-center"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            variants={bentoReveal}
          >
            <h2 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Built for operators who cannot afford drift.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-400">
              Dense where it matters—census, clinical signals, workforce, and collections—without the noise of
              fifteen disconnected tools.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:grid-rows-[minmax(280px,auto)_minmax(240px,auto)]">
            <motion.div
              id="security"
              className="md:row-span-2"
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-40px" }}
              variants={bentoReveal}
            >
              <Card className="h-full border-white/[0.08] bg-white/[0.03] py-6 text-slate-50 ring-1 ring-white/[0.05] transition-colors hover:border-teal-500/20 hover:bg-white/[0.045]">
                <CardHeader>
                  <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-500/25 bg-teal-500/10">
                    <Activity className="h-6 w-6 text-teal-300" />
                  </div>
                  <CardTitle className="font-display text-2xl text-white">Clinical velocity</CardTitle>
                  <CardDescription className="text-base text-slate-400">
                    eMAR-aware flows, bedside-first UX, and incident discipline that stays tied to the resident
                    record.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-1 w-1/3 rounded-full bg-gradient-to-r from-teal-400 to-transparent" />
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              className="md:col-span-2"
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-40px" }}
              variants={bentoReveal}
            >
              <Card className="h-full border-white/[0.08] bg-white/[0.03] py-6 text-slate-50 ring-1 ring-white/[0.05] transition-colors hover:border-amber-500/20">
                <CardHeader className="relative">
                  <div className="absolute right-6 top-6 flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-500/25 bg-amber-500/10">
                    <Banknote className="h-5 w-5 text-amber-200" />
                  </div>
                  <CardTitle className="font-display max-w-md text-2xl text-white">
                    Multi-entity financial clarity
                  </CardTitle>
                  <CardDescription className="max-w-lg text-base text-slate-400">
                    Separate legal entities, shared discipline—census, AR signals, and revenue views without
                    spreadsheet archaeology.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mt-2 flex gap-2 opacity-90">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        className="relative h-14 w-8 overflow-hidden rounded-md border border-white/10 bg-white/[0.04]"
                      >
                        <motion.div
                          className="absolute bottom-0 left-0 right-0 bg-amber-400/35"
                          initial={reduceMotion ? { height: "40%" } : { height: 0 }}
                          whileInView={{ height: `${38 + (i % 4) * 12}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.8, delay: 0.06 * i, ease: easeOut }}
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-40px" }}
              variants={bentoReveal}
            >
              <Card className="h-full border-white/[0.08] bg-white/[0.03] py-6 text-slate-50 ring-1 ring-white/[0.05]">
                <CardHeader>
                  <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-slate-800/80">
                    <ShieldCheck className="h-5 w-5 text-slate-200" />
                  </div>
                  <CardTitle className="font-display text-xl text-white">RLS-native</CardTitle>
                  <CardDescription className="text-slate-400">
                    Policies at the database—roles see the slice they should, auditors see the trail.
                  </CardDescription>
                </CardHeader>
              </Card>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-40px" }}
              variants={bentoReveal}
            >
              <Card className="h-full border-white/[0.08] bg-white/[0.03] py-6 text-slate-50 ring-1 ring-white/[0.05] transition-colors hover:border-rose-500/25">
                <CardHeader>
                  <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-500/25 bg-rose-500/10">
                    <Heart className="h-5 w-5 text-rose-300" />
                  </div>
                  <CardTitle className="font-display text-xl text-white">Family-grade portal</CardTitle>
                  <CardDescription className="text-slate-400">
                    Warm, read-forward experiences for POA and loved ones—care summaries and billing without
                    clinical clutter.
                  </CardDescription>
                </CardHeader>
              </Card>
            </motion.div>
          </div>
        </section>

        <section id="demo" className="mx-auto max-w-3xl px-5 pb-28 text-center sm:px-6">
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            variants={bentoReveal}
          >
            <h3 className="font-display text-2xl font-semibold text-white sm:text-3xl">Start with a focused pilot.</h3>
            <p className="mt-3 text-slate-400">
              We onboard one facility pattern at a time so workflows, training, and governance stay sharp.
            </p>
            <Link
              href="/login"
              className={cn(
                buttonVariants({ size: "lg" }),
                "mt-8 inline-flex h-12 rounded-xl bg-teal-500 px-8 text-base font-semibold text-slate-950 hover:bg-teal-400",
              )}
            >
              Sign in to the sandbox
            </Link>
          </motion.div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.08] bg-[#020617] py-12">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 text-sm text-slate-400 md:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-teal-400/80 to-teal-700/90">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="font-display text-slate-200">Haven OS</span>
          </div>
          <p className="text-center text-slate-300 md:text-left">
            &copy; {new Date().getFullYear()} Circle of Life. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
