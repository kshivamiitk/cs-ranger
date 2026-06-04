"use client";

import { ChevronDown, GraduationCap, PenSquare, Shield, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/app/providers";
import { prefetchLearnerDashboard, prefetchCreatorDashboard } from "@/lib/prefetch";
import { cn } from "@/lib/utils";

type Role = "learner" | "creator" | "admin";

// Stable display order; only the roles the account actually holds are shown.
const ROLE_ORDER: Role[] = ["learner", "creator", "admin"];
const ROLE_META: Record<Role, { label: string; href: string; icon: React.ReactNode }> = {
  learner: { label: "Learner", href: "/home", icon: <GraduationCap className="h-4 w-4" /> },
  creator: { label: "Creator", href: "/creator/overview", icon: <PenSquare className="h-4 w-4" /> },
  admin: { label: "Admin", href: "/admin/overview", icon: <Shield className="h-4 w-4" /> },
};

/**
 * Dropdown that replaces the old Learner|Creator segmented toggle. Lists every
 * role the account holds (Learner / Creator / Admin) and, on select, switches the
 * persisted roleView and navigates to that role's home — same effect the toggle
 * had, just consolidated into one menu. Renders nothing for single-role accounts.
 */
export function RoleSwitcher({ className, tourId }: { className?: string; tourId?: string }) {
  const { user, roleView, setRoleView } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  if (!user) return null;
  const userId = user.user_id || user.id;
  const roles = ROLE_ORDER.filter((r) => user.roles?.includes(r));
  if (roles.length <= 1) return null;

  const active = (ROLE_META[roleView as Role] ? roleView : "learner") as Role;

  function prefetch(role: Role) {
    if (role === "learner") prefetchLearnerDashboard(qc, userId);
    else if (role === "creator") prefetchCreatorDashboard(qc, userId);
  }
  function select(role: Role) {
    setRoleView(role);
    setOpen(false);
    router.push(ROLE_META[role].href);
  }

  return (
    <div className={cn("relative", className)} data-tour={tourId}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex w-full items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg transition hover:border-brand"
      >
        <span className="text-fg-dim">{ROLE_META[active].icon}</span>
        <span className="flex-1 text-left">{ROLE_META[active].label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-fg-dim" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-44 origin-top-right animate-slide-up overflow-hidden rounded-2xl glass-strong shadow-glow-lg">
            <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-widest text-fg-dim">Switch view</div>
            <div className="py-1">
              {roles.map((role) => {
                const isActive = role === active;
                return (
                  <button
                    key={role}
                    onClick={() => select(role)}
                    onMouseEnter={() => prefetch(role)}
                    onFocus={() => prefetch(role)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-surface-2",
                      isActive ? "text-fg" : "text-fg-dim",
                    )}
                  >
                    <span className={isActive ? "text-brand" : "text-fg-dim"}>{ROLE_META[role].icon}</span>
                    <span className="flex-1">{ROLE_META[role].label}</span>
                    {isActive && <Check className="h-4 w-4 text-brand" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
