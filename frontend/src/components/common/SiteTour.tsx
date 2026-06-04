"use client";

import { useEffect } from "react";
import { Sparkles } from "lucide-react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { useApp } from "@/app/providers";

// First-login walkthrough of the learner experience. Bump the version suffix if
// the steps change so returning users see the refreshed tour once.
const STORAGE_KEY = "learnrift-site-tour-v1";

// Candidate steps anchored to navbar elements present on /home. Each anchor is
// included only if it's actually visible at run time, so on narrow screens (where
// the desktop nav links / role switcher are collapsed) those steps are skipped
// rather than pointing at an invisible element.
const ANCHORED: { selector: string; title: string; description: string }[] = [
  {
    selector: "[data-tour='lnav-my-courses']",
    title: "Your courses live here",
    description: "Everything you enrol in shows up under <strong>My Courses</strong> so you can pick up right where you left off.",
  },
  {
    selector: "[data-tour='lnav-catalog']",
    title: "Discover something new",
    description: "Browse the full <strong>Catalog</strong> to find courses by topic, then enrol in one tap.",
  },
  {
    selector: "[data-tour='role-switcher']",
    title: "Switch between views",
    description: "Have a creator or admin account too? Use this dropdown to switch between <strong>Learner</strong>, <strong>Creator</strong>, and <strong>Admin</strong> views anytime.",
  },
  {
    selector: "[data-tour='notif-bell']",
    title: "Stay in the loop",
    description: "Replies to your doubts, course updates, and new releases from creators you follow land here.",
  },
  {
    selector: "[data-tour='avatar-menu']",
    title: "Your account",
    description: "Open this menu for your profile, transactions, and settings. That's the tour — happy learning! ✨",
  },
];

function isVisible(selector: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function markSeen() {
  try { window.localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
}

export function shouldAutoStartSiteTour(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(STORAGE_KEY) === null; } catch { return false; }
}

// Imperative trigger — used for auto-start on first login and for the "Take the
// tour" replay button. Builds the step list from whichever anchors are visible.
export function startSiteTour() {
  if (typeof window === "undefined") return;
  markSeen();
  const steps: DriveStep[] = [
    {
      popover: {
        title: "Welcome to LearnRift 🎉",
        description: "A quick 30-second tour of the essentials. Hit <strong>Next →</strong> to begin, or close anytime.",
      },
    },
    ...ANCHORED.filter((s) => isVisible(s.selector)).map<DriveStep>((s) => ({
      element: s.selector,
      popover: { title: s.title, description: s.description, side: "bottom", align: "end" },
    })),
  ];

  const d = driver({
    animate: true,
    allowClose: true,
    overlayOpacity: 0.6,
    stagePadding: 6,
    stageRadius: 8,
    // Same custom popover skin the creator tour uses (styled in globals.css).
    popoverClass: "cs-tour-popover",
    showProgress: true,
    showButtons: ["next", "previous", "close"],
    nextBtnText: "Next →",
    prevBtnText: "← Back",
    doneBtnText: "Finish",
    disableActiveInteraction: true,
    onDestroyed: () => markSeen(),
    steps,
  });
  d.drive();
}

// Invisible auto-starter. Mount on the learner home page; it kicks off the tour
// once for never-seen-it users after the navbar has settled.
export function SiteTour() {
  const { user } = useApp();
  useEffect(() => {
    if (!user) return;
    if (!shouldAutoStartSiteTour()) return;
    const t = setTimeout(() => startSiteTour(), 700);
    return () => clearTimeout(t);
  }, [user]);
  return null;
}

// Small replay affordance for the home page header.
export function SiteTourButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => startSiteTour()} className={className ?? "btn-ghost text-sm"} aria-label="Take the site tour">
      <Sparkles className="h-4 w-4" /> Take the tour
    </button>
  );
}
