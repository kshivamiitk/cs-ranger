"use client";

import { ChevronDown, LogOut, Settings as SettingsIcon, User as UserIcon, LayoutDashboard, Shield, ReceiptText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/app/providers";
import { prefetchCreatorDashboard } from "@/lib/prefetch";
import { Avatar } from "./Avatar";

export function AvatarMenu() {
  const { user, setRoleView, logout } = useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const creatorId = user.user_id || user.id;
  const displayName = user.display_name || user.displayName || "User";
  const username = user.username || "user";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 p-0.5 pr-2 transition hover:border-brand"
      >
        <Avatar name={displayName} src={user.avatar_url || user.avatarUrl} size={28} />
        <ChevronDown className="h-3.5 w-3.5 text-fg-dim" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-60 origin-top-right animate-slide-up overflow-hidden rounded-2xl glass-strong shadow-glow-lg">
            <div className="border-b border-border p-3">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-xs text-fg-dim">@{username}</p>
            </div>
            <div className="py-1">
              <MenuItem href={`/u/${username}`} icon={<UserIcon className="h-4 w-4" />} onClose={() => setOpen(false)}>View Profile</MenuItem>
              <MenuItem href="/profile/edit" icon={<UserIcon className="h-4 w-4" />} onClose={() => setOpen(false)}>Edit Profile</MenuItem>
              <MenuItem href="/transactions" icon={<ReceiptText className="h-4 w-4" />} onClose={() => setOpen(false)}>Transactions</MenuItem>
              <MenuItem href="/settings" icon={<SettingsIcon className="h-4 w-4" />} onClose={() => setOpen(false)}>Settings</MenuItem>
              {user.roles?.includes("creator") && (
                <MenuItem href="/creator/overview" icon={<LayoutDashboard className="h-4 w-4" />} onHover={() => prefetchCreatorDashboard(qc, creatorId)} onClose={() => { setRoleView("creator"); setOpen(false); }}>Creator Dashboard</MenuItem>
              )}
              {user.roles?.includes("admin") && (
                <MenuItem href="/admin/overview" icon={<Shield className="h-4 w-4" />} onClose={() => { setRoleView("admin"); setOpen(false); }}>Admin Panel</MenuItem>
              )}
            </div>
            <div className="border-t border-border py-1">
              <button onClick={() => { setOpen(false); logout(); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-danger transition hover:bg-surface-2">
                <span className="text-fg-dim"><LogOut className="h-4 w-4" /></span>
                Log Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ href, icon, children, onClose, onHover, danger }: { href: string; icon: React.ReactNode; children: React.ReactNode; onClose: () => void; onHover?: () => void; danger?: boolean }) {
  return (
    <Link
      href={href}
      onClick={onClose}
      onMouseEnter={onHover}
      onFocus={onHover}
      className={`flex items-center gap-2.5 px-3 py-2 text-sm transition hover:bg-surface-2 ${danger ? "text-danger" : "text-fg"}`}
    >
      <span className="text-fg-dim">{icon}</span>
      {children}
    </Link>
  );
}
