"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationBell } from "./NotificationBell";
import { AvatarMenu } from "./AvatarMenu";
import { useApp } from "@/app/providers";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { prefetchLearnerDashboard, prefetchCreatorDashboard } from "@/lib/prefetch";

const LEARNER_LINKS = [
  { href: "/home", label: "Home" },
  { href: "/my-courses", label: "My Courses" },
  { href: "/catalog", label: "Catalog" },
  { href: "/feed", label: "Feed" },
  { href: "/creators", label: "Creators" },
  { href: "/bookmarks", label: "Bookmarks" },
  { href: "/achievements", label: "Achievements" },
];

const CREATOR_LINKS = [
  { href: "/creator/overview", label: "Overview" },
  { href: "/creator/courses", label: "Courses" },
  { href: "/creator/analytics", label: "Analytics" },
  { href: "/creator/collaborations", label: "Collaborations" },
  { href: "/creator/doubts", label: "Doubts" },
  { href: "/creator/storage", label: "Storage" },
  { href: "/creator/finance", label: "Finance" },
];

const ADMIN_LINKS = [
  { href: "/admin/overview", label: "Overview" },
  { href: "/admin/payouts", label: "Payouts" },
  { href: "/admin/support", label: "Support" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/courses", label: "Courses" },
  { href: "/admin/flagged", label: "Flagged" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/audit-log", label: "Audit Log" },
  { href: "/admin/ops", label: "Ops" },
];

export function Navbar({ variant }: { variant?: "learner" | "creator" | "admin" | "public" }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { user, roleView, setRoleView } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const userId = user?.user_id || user?.id;

  // Switching role view navigates to that role's home. We prefetch the destination's
  // data on hover/focus so the dashboard is already in cache by the time it's clicked —
  // the round trip happens during the hover, not after the click.
  function goLearner() { setRoleView("learner"); router.push("/home"); }
  function goCreator() { setRoleView("creator"); router.push("/creator/overview"); }

  // Match the creator/admin SECTIONS exactly — note `/creators` (the public creators
  // directory) must NOT count as the `/creator` dashboard, so check for the trailing slash.
  const inCreatorSection = pathname === "/creator" || pathname.startsWith("/creator/");
  const inAdminSection = pathname === "/admin" || pathname.startsWith("/admin/");
  const v = variant ?? (inAdminSection ? "admin" : inCreatorSection ? "creator" : user ? "learner" : "public");
  const links = v === "admin" ? ADMIN_LINKS : v === "creator" ? CREATOR_LINKS : LEARNER_LINKS;
  const homeHref = v === "creator" ? "/creator/overview" : v === "admin" ? "/admin/overview" : v === "learner" ? "/home" : "/";

  // Pending collaboration invites — drives the badge next to the Collaborations link.
  const { data: pendingInvites } = useQuery({
    queryKey: ["my-collaborations", "pending"],
    queryFn: () => api.courses.myCollaborations("pending"),
    enabled: v === "creator" && !!user,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const pendingInviteCount = pendingInvites?.length ?? 0;
  const linkBadge = (href: string) =>
    href === "/creator/collaborations" && pendingInviteCount > 0 ? (
      <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-gradient px-1 text-[10px] font-bold text-white">
        {pendingInviteCount}
      </span>
    ) : null;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 md:px-6">
        <Logo href={homeHref} />
        {v !== "public" && (
          <nav className="ml-2 hidden items-center gap-1 lg:flex">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-medium transition",
                  pathname === l.href || pathname.startsWith(l.href + "/")
                    ? "bg-surface text-fg shadow-glass"
                    : "text-fg-dim hover:bg-surface-2 hover:text-fg",
                )}
              >
                {l.label}
                {linkBadge(l.href)}
              </Link>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-2">
          {user && (user.roles?.length ?? 0) > 1 && v !== "public" && (
            <div className="hidden items-center rounded-full border border-border bg-surface-2 p-0.5 text-xs md:flex">
              {user.roles?.includes("learner") && (
                <button
                  onClick={goLearner}
                  onMouseEnter={() => prefetchLearnerDashboard(qc, userId)}
                  onFocus={() => prefetchLearnerDashboard(qc, userId)}
                  className={cn("rounded-full px-2.5 py-1 transition", roleView === "learner" ? "bg-brand-gradient text-white shadow-glow" : "text-fg-dim hover:text-fg")}
                >
                  Learner
                </button>
              )}
              {user.roles?.includes("creator") && (
                <button
                  onClick={goCreator}
                  onMouseEnter={() => prefetchCreatorDashboard(qc, userId)}
                  onFocus={() => prefetchCreatorDashboard(qc, userId)}
                  className={cn("rounded-full px-2.5 py-1 transition", roleView === "creator" ? "bg-brand-gradient text-white shadow-glow" : "text-fg-dim hover:text-fg")}
                >
                  Creator
                </button>
              )}
            </div>
          )}
          <ThemeToggle />
          {user ? (
            <>
              <NotificationBell />
              <AvatarMenu />
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login" className="hidden text-sm font-medium text-fg-dim hover:text-fg md:inline">Log in</Link>
              <Link href="/signup" className="btn-primary px-4 py-1.5 text-sm">Get Started</Link>
            </div>
          )}
          {v !== "public" && (
            <button
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2 lg:hidden"
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>
      {mobileOpen && v !== "public" && (
        <nav className="border-t border-border bg-bg/95 backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex max-w-7xl flex-col gap-1 p-3">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "rounded-xl px-3 py-2 text-sm font-medium",
                  pathname === l.href ? "bg-surface text-fg" : "text-fg-dim hover:bg-surface-2",
                )}
              >
                {l.label}
                {linkBadge(l.href)}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
