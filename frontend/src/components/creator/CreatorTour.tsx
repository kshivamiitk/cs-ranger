"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";

// Bump the version when STEPS changes so existing creators see the new tour once.
const STORAGE_KEY = "learnrift-creator-tour-v2";

interface TourStep {
  route: string;          // pathname where this step's anchor lives
  element?: string;       // CSS selector. Omit to center the popover on screen.
  title: string;
  description: string;
}

// One coherent narrative: welcome → stats → courses tab → New-course button →
// finance → storage → replay-button reminder → done.
const STEPS: TourStep[] = [
  {
    route: "/creator/overview",
    title: "Welcome to your creator dashboard 🎉",
    description:
      "This is a one-minute tour. We'll point at each major button — Courses, Finance, Storage — so you know where to click for what. Hit <strong>Next →</strong> to start.",
  },
  {
    route: "/creator/overview",
    element: "[data-tour='kpi-strip']",
    title: "Your stats at a glance",
    description:
      "Total earnings, student count, published courses, and average rating. Refreshes every few minutes — this is the first thing you'll see every login.",
  },
  {
    route: "/creator/overview",
    element: "[data-tour='nav-courses']",
    title: "Step 1 — open the Courses tab",
    description:
      "This is where every course you author lives. Drafts, published, archived — all here. Click <strong>Next →</strong> and we'll head over.",
  },
  {
    route: "/creator/courses",
    element: "[data-tour='new-course']",
    title: "Step 2 — create a new course",
    description:
      "Click this button to start a course. You'll fill in the title, subtitle, thumbnail, and price, then add modules → lessons inside the builder. A lesson can be a video, markdown article, quiz, PDF, or a live HTML/CSS/JS sandbox.",
  },
  {
    route: "/creator/overview",
    element: "[data-tour='nav-finance']",
    title: "Step 3 — Finance & payouts",
    description:
      "Every sale shows up here. 80% lands in your wallet, 20% is the platform commission. After KYC, you can withdraw to your bank. Refunds (7-day window) are auto-deducted.",
  },
  {
    route: "/creator/overview",
    element: "[data-tour='nav-storage']",
    title: "Step 4 — Storage quota",
    description:
      "PDFs and lesson attachments use your storage (1 MB free to start; buy more anytime). Video lessons live on our CDN separately, so they don't count.",
  },
  {
    route: "/creator/overview",
    element: "[data-tour='nav-analytics']",
    title: "Step 5 — Course analytics",
    description:
      "Enrollment trends, completion rates, per-course ratings. Useful once you have students — gives you signal on which courses to invest more in.",
  },
  {
    route: "/creator/overview",
    element: "[data-tour='replay-tour']",
    title: "Replay this tour anytime ✨",
    description:
      "If you ever want a refresher, hit this button on the Overview page and we'll walk through it again. You're all set — happy creating! Email <a href='mailto:support@learnrift.in' class='underline'>support@learnrift.in</a> if you get stuck.",
  },
];

// ───────────────────── localStorage state ─────────────────────
interface TourState { active: boolean; step: number; done?: boolean }

function getTourState(): TourState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TourState) : null;
  } catch { return null; }
}
function saveTourState(state: TourState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function finishTour() {
  saveTourState({ active: false, step: 0, done: true });
}

// Should the overview page auto-trigger a fresh tour on mount?
//
// Returns true ONLY for never-seen-it users. If the tour is currently in
// progress (state.active === true) we do NOT auto-start — the boot component
// in the creator layout is already resuming it across navigations. Without
// this guard, navigating mid-tour back to /creator/overview (e.g. to highlight
// the Finance nav link) would re-trigger startCreatorTour() and reset to step 1.
export function shouldAutoStartCreatorTour(): boolean {
  if (typeof window === "undefined") return false;
  const s = getTourState();
  return s === null; // null = never started before
}

// Kept for backward-compat callers; same semantics as before (true once tour
// has been finished or dismissed). Internal code uses shouldAutoStartCreatorTour.
export function hasSeenCreatorTour(): boolean {
  if (typeof window === "undefined") return true;
  const s = getTourState();
  return !!s?.done;
}

// Imperative trigger for the "Take the tour" button.
export function startCreatorTour() {
  saveTourState({ active: true, step: 0 });
  if (typeof window === "undefined") return;
  if (window.location.pathname !== STEPS[0].route) {
    window.location.href = STEPS[0].route;
  } else {
    window.dispatchEvent(new Event("cs-tour-start"));
  }
}

// ───────────────────── boot component ─────────────────────
// Mount once per creator page (via app/creator/layout.tsx). It reads tour state
// on every navigation; if a tour is active and the current step's route matches
// the current pathname, it spotlights the right element via driver.js. If the
// route doesn't match, it navigates to the right one — the new page's mount
// will re-trigger this hook.

export function CreatorTourBoot() {
  const router = useRouter();
  const pathname = usePathname();
  const driverRef = useRef<Driver | null>(null);

  // Run a single step (we re-create driver.js per step because driver.js doesn't
  // natively handle steps across navigations).
  const runStep = useCallback((stepIndex: number) => {
    const step = STEPS[stepIndex];
    if (!step) { finishTour(); return; }

    // Different page? Save state and navigate. The new page's mount picks up.
    if (step.route !== pathname) {
      saveTourState({ active: true, step: stepIndex });
      router.push(step.route);
      return;
    }

    // Wait briefly for the page to settle, then spotlight.
    const t = setTimeout(() => {
      // If the step has an element selector but the element isn't there yet, skip.
      if (step.element && !document.querySelector(step.element)) {
        // Try again once after another short delay (slow renders/queries).
        setTimeout(() => doRun(stepIndex), 400);
        return;
      }
      doRun(stepIndex);
    }, 250);
    return () => clearTimeout(t);
  }, [pathname, router]);

  const doRun = useCallback((stepIndex: number) => {
    const step = STEPS[stepIndex];
    if (!step) return;

    // Clean up any prior driver instance.
    if (driverRef.current) {
      try { driverRef.current.destroy(); } catch { /* ignore */ }
      driverRef.current = null;
    }

    const isLast = stepIndex === STEPS.length - 1;
    const isFirst = stepIndex === 0;

    const d = driver({
      animate: true,
      allowClose: true,
      overlayOpacity: 0.6,
      stagePadding: 6,
      stageRadius: 8,
      // Custom class hooks into globals.css so the popover matches the site's
      // dark surface, border, and brand-gradient buttons instead of driver.js
      // default light theme.
      popoverClass: "cs-tour-popover",
      showButtons: ["next", "previous", "close"],
      nextBtnText: isLast ? "Finish" : "Next →",
      prevBtnText: "← Back",
      doneBtnText: "Finish",
      progressText: `${stepIndex + 1} / ${STEPS.length}`,
      showProgress: true,
      disableActiveInteraction: true,
      steps: [
        {
          element: step.element,
          popover: {
            title: step.title,
            description: step.description,
            side: "bottom",
            align: "start",
          },
        },
      ],
      onCloseClick: () => { finishTour(); d.destroy(); driverRef.current = null; },
      onPrevClick: () => {
        d.destroy(); driverRef.current = null;
        if (!isFirst) runStep(stepIndex - 1);
      },
      onNextClick: () => {
        d.destroy(); driverRef.current = null;
        if (isLast) { finishTour(); }
        else { runStep(stepIndex + 1); }
      },
    });
    driverRef.current = d;
    d.drive();
  }, [runStep]);

  // On mount / pathname change: if a tour is in-progress and its step belongs
  // to this page, resume here.
  useEffect(() => {
    const state = getTourState();
    if (state?.active) {
      runStep(state.step);
    }
    function onStart() { saveTourState({ active: true, step: 0 }); runStep(0); }
    window.addEventListener("cs-tour-start", onStart);
    return () => {
      window.removeEventListener("cs-tour-start", onStart);
      if (driverRef.current) {
        try { driverRef.current.destroy(); } catch { /* ignore */ }
        driverRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
