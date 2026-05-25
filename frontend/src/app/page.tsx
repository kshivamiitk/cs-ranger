"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Sparkles, BookOpen, GraduationCap, Wallet, Code2, Check, Quote } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { CourseCard } from "@/components/common/CourseCard";
import { Avatar } from "@/components/common/Avatar";
import { api } from "@/lib/api";
import { SITE_NAME, avatarUrl, formatCompact } from "@/lib/utils";

export default function LandingPage() {
  const { data: featured } = useQuery({ queryKey: ["featured-courses"], queryFn: () => api.search.courses({ sort: "popular", limit: 8 }) });
  const { data: creators } = useQuery({ queryKey: ["featured-creators"], queryFn: () => api.search.creators({ sort: "subscribers", limit: 8 }) });

  const featuredList = (featured?.items || []).slice(0, 8);
  const featuredCreators = (creators || []).slice(0, 4);

  return (
    <>
      <Navbar variant="public" />
      <main>
        {/* HERO */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute -left-32 -top-32 h-[40rem] w-[40rem] rounded-full bg-brand/20 blur-[120px]" />
            <div className="absolute -right-32 top-20 h-[40rem] w-[40rem] rounded-full bg-brand-accent/20 blur-[120px]" />
          </div>
          <div className="mx-auto max-w-7xl px-4 pb-20 pt-20 md:px-6 md:pb-32 md:pt-32">
            <div className="mx-auto max-w-3xl text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-fg-dim">
                <Sparkles className="h-3.5 w-3.5 text-brand" />
                Now open to creators. Set your price. Keep most of it.
              </span>
              <h1 className="mt-6 heading-1">
                Learn CS from people who <span className="gradient-text">just got it</span>.
              </h1>
              <p className="mt-5 text-lg text-fg-dim md:text-xl">
                {SITE_NAME} is a marketplace where students teach what they just learned — explained without the gatekeeping, with code, math, and quizzes in one place.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href="/signup" className="btn-primary">
                  Get Started Free <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/catalog" className="btn-ghost">
                  Explore Courses
                </Link>
              </div>
            </div>

            {featuredList.length > 0 && (
              <div className="relative mt-16 hidden md:block">
                <div className="absolute left-1/2 top-0 -z-10 h-72 w-[80%] -translate-x-1/2 rounded-[3rem] bg-mesh-1 opacity-30 blur-3xl" />
                <div className="mx-auto grid max-w-5xl grid-cols-3 gap-5">
                  {featuredList.slice(0, 3).map((c, i) => (
                    <div key={c.id} className={`animate-float ${i === 1 ? "translate-y-6" : ""}`} style={{ animationDelay: `${i * 0.4}s` }}>
                      <CourseCard course={c} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="relative py-20 md:py-28">
          <div className="mx-auto max-w-7xl px-4 md:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="heading-2">How it works</h2>
              <p className="mt-3 text-fg-dim">Three steps. No friction.</p>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {[
                { icon: BookOpen, title: "Discover", body: "Browse curated courses across DSA, web dev, math, ML, system design — by creators you trust." },
                { icon: GraduationCap, title: "Learn", body: "Videos, markdown notes with LaTeX, interactive code, quizzes, and a doubts thread on every lesson." },
                { icon: Wallet, title: "Earn", body: "Create courses, set your price, get paid directly to your bank account. We take a tiny cut." },
              ].map((s) => (
                <div key={s.title} className="card relative overflow-hidden">
                  <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-brand-gradient opacity-10 blur-2xl" />
                  <s.icon className="h-9 w-9 text-brand" />
                  <h3 className="mt-4 heading-3">{s.title}</h3>
                  <p className="mt-2 text-sm text-fg-dim">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FEATURED COURSES */}
        {featuredList.length > 0 && (
          <section className="py-20 md:py-28">
            <div className="mx-auto max-w-7xl px-4 md:px-6">
              <div className="mb-10 flex items-end justify-between">
                <div>
                  <span className="chip">Featured</span>
                  <h2 className="mt-3 heading-2">Hand-picked, this week</h2>
                </div>
                <Link href="/catalog" className="hidden text-sm font-medium text-brand hover:opacity-80 md:inline">
                  View all →
                </Link>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {featuredList.map((c) => <CourseCard key={c.id} course={c} />)}
              </div>
            </div>
          </section>
        )}

        {/* CREATORS SPOTLIGHT */}
        {featuredCreators.length > 0 && (
          <section className="py-20 md:py-28">
            <div className="mx-auto max-w-7xl px-4 md:px-6">
              <div className="mb-10 text-center">
                <span className="chip">Creators</span>
                <h2 className="mt-3 heading-2">Taught by people who get it</h2>
                <p className="mt-3 text-fg-dim">No celebrity instructors. Just students who recently struggled with the same material.</p>
              </div>
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
                {featuredCreators.map((u) => (
                  <Link key={u.user_id} href={`/u/${u.username}`} className="card group transition hover:-translate-y-0.5 hover:shadow-glow">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.display_name || ""} src={u.avatar_url || avatarUrl(u.username)} size={48} />
                      <div className="min-w-0">
                        <p className="truncate font-display font-semibold">{u.display_name}</p>
                        <p className="truncate text-xs text-fg-dim">{u.college}</p>
                      </div>
                    </div>
                    {u.bio && <p className="mt-3 line-clamp-2 text-sm text-fg-dim">{u.bio}</p>}
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* PRICING */}
        <section id="pricing" className="py-20 md:py-28">
          <div className="mx-auto max-w-5xl px-4 md:px-6">
            <div className="grid gap-10 md:grid-cols-2">
              <div>
                <span className="chip">For creators</span>
                <h2 className="mt-3 heading-2">You set the price. <span className="gradient-text">We take 15%</span>. You keep the rest.</h2>
                <p className="mt-4 text-fg-dim">No subscription fees. No revenue thresholds. Razorpay payouts hit your bank or UPI directly, after KYC.</p>
                <div className="mt-6 space-y-2.5">
                  {["No upfront cost to publish", "Free hosting on YouTube & Google Drive", "TDS handled automatically", "Quarterly tax certificates", "Real-time analytics on every lesson"].map((p) => (
                    <div key={p} className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-success" />
                      <span>{p}</span>
                    </div>
                  ))}
                </div>
                <Link href="/signup" className="btn-primary mt-8">
                  Become a Creator <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="card relative overflow-hidden p-8">
                <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-brand-gradient opacity-20 blur-3xl" />
                <p className="text-xs uppercase tracking-widest text-fg-dim">Example payout</p>
                <p className="mt-2 font-display text-5xl font-bold gradient-text">₹85,000</p>
                <p className="mt-1 text-sm text-fg-dim">For 100 enrollments at ₹999, after platform fee.</p>
                <div className="mt-8 space-y-3 text-sm">
                  <Row label="Gross revenue" value="₹99,900" />
                  <Row label="Platform fee (15%)" value="−₹14,985" muted />
                  <Row label="TDS (auto-handled)" value="−₹—" muted />
                  <div className="my-3 h-px bg-border" />
                  <Row label="Your payout" value="₹84,915" bold />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 md:py-28">
          <div className="mx-auto max-w-5xl px-4 md:px-6">
            <div className="relative overflow-hidden rounded-3xl border border-border bg-mesh-1 p-10 text-center md:p-16">
              <div className="absolute inset-0 bg-bg/30 backdrop-blur-sm" />
              <div className="relative">
                <Code2 className="mx-auto h-10 w-10 text-white" />
                <h2 className="mt-4 font-display text-3xl font-bold md:text-5xl text-white">
                  Ship knowledge. Get paid.
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-white/80">
                  Whether you're here to learn or teach — the next chapter starts with one click.
                </p>
                <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Link href="/signup" className="btn-primary">
                    Create your account <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/catalog" className="rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20">
                    Browse Courses
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-16 max-w-3xl px-4 md:px-6">
          <div className="card text-center">
            <p className="text-sm text-fg-dim">
              CS-Ranger is an online learning platform for digital courses.
            </p>
            <div className="mt-4 flex flex-col items-center justify-center gap-1 text-sm text-fg-dim sm:flex-row sm:gap-6">
              <span>
                Support:{" "}
                <a href="mailto:support@cs-ranger.in" className="text-brand hover:underline">
                  support@cs-ranger.in
                </a>
              </span>
              <span>
                Legal:{" "}
                <a href="mailto:legal@cs-ranger.in" className="text-brand hover:underline">
                  legal@cs-ranger.in
                </a>
              </span>
            </div>
            <nav className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm">
              <Link href="/terms" className="text-fg-dim hover:text-fg">Terms</Link>
              <span className="text-fg-dim">|</span>
              <Link href="/privacy" className="text-fg-dim hover:text-fg">Privacy Policy</Link>
              <span className="text-fg-dim">|</span>
              <Link href="/refund-policy" className="text-fg-dim hover:text-fg">Refund Policy</Link>
              <span className="text-fg-dim">|</span>
              <Link href="/digital-delivery-policy" className="text-fg-dim hover:text-fg">Digital Delivery Policy</Link>
              <span className="text-fg-dim">|</span>
              <Link href="/contact" className="text-fg-dim hover:text-fg">Contact Us</Link>
            </nav>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Row({ label, value, muted, bold }: { label: string; value: string; muted?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={muted ? "text-fg-dim" : ""}>{label}</span>
      <span className={`tabular-nums ${bold ? "font-display text-lg font-bold gradient-text" : muted ? "text-fg-dim" : "font-medium"}`}>{value}</span>
    </div>
  );
}
