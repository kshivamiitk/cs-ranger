"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type UserProfile } from "@/lib/api";
import { meQueryOptions } from "@/lib/queries";

type Theme = "light" | "dark";
type RoleView = "learner" | "creator" | "admin";
interface AppContextValue {
  theme: Theme;
  toggleTheme: () => void;
  user: UserProfile | null;
  setUser: (u: UserProfile | null) => void;
  roleView: RoleView;
  setRoleView: (r: RoleView) => void;
  loadingUser: boolean;
  logout: () => Promise<void>;
}
const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <Providers>");
  return ctx;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
});

// Persisted session keys. We cache the user profile + chosen role view in
// localStorage so the navbar (and anything else that reads roles) can render
// the role toggle immediately on reload — no flicker while /users/me is in
// flight. The cached copy is replaced as soon as the fresh /me arrives.
const USER_CACHE_KEY = "learnrift:user";
const ROLE_VIEW_KEY = "learnrift:roleView";

function readCachedUser(): UserProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch { return null; }
}

function readCachedRoleView(): RoleView | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(ROLE_VIEW_KEY);
  return v === "creator" || v === "admin" || v === "learner" ? v : null;
}

// Routes a logged-in-but-not-onboarded user can still visit without being
// bounced into the wizard.
const ONBOARDING_EXEMPT = ["/onboarding", "/login", "/signup", "/verify", "/forgot-password", "/reset-password", "/cli-auth"];

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>("dark");
  // IMPORTANT: must start as null/default on BOTH server and client so the
  // first hydration render matches the server-rendered HTML. We populate from
  // localStorage in a useEffect below — that runs only on the client, after
  // hydration, so React doesn't throw "Hydration failed" when it sees the
  // cached user appear. The flicker is one frame; the alternative (lazy
  // localStorage read in initial state) breaks SSR pages with a hydration
  // mismatch on the navbar's role-switcher.
  const [user, setUserState] = useState<UserProfile | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [roleView, setRoleViewState] = useState<RoleView>("learner");

  function setUser(u: UserProfile | null) {
    setUserState(u);
    if (typeof window === "undefined") return;
    if (u) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_CACHE_KEY);
  }

  function setRoleView(r: RoleView) {
    setRoleViewState(r);
    if (typeof window !== "undefined") localStorage.setItem(ROLE_VIEW_KEY, r);
  }

  useEffect(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    const sys = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const initial = stored || sys;
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  // Bootstrap on mount (client-only). Two phases:
  //   1. Hydrate state from localStorage synchronously — the navbar gets a
  //      user object within one frame of mount, no /users/me round trip.
  //   2. Fire /users/me in the background to refresh the cached snapshot.
  // Since this runs in useEffect (post-hydration), there's no SSR mismatch.
  useEffect(() => {
    const cachedUser = readCachedUser();
    if (cachedUser) setUserState(cachedUser);
    const cachedRole = readCachedRoleView();
    if (cachedRole) setRoleViewState(cachedRole);

    (async () => {
      try {
        if (typeof window === "undefined" || !localStorage.getItem("access_token")) {
          setUser(null);
          setLoadingUser(false);
          return;
        }
        const me = await queryClient.fetchQuery(meQueryOptions);
        setUser(me);
        if (!cachedRole) {
          if (me.roles?.includes("admin")) setRoleView("admin");
          else if (me.roles?.includes("creator")) setRoleView("creator");
          else setRoleView("learner");
        }
      } catch {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        setUser(null);
      } finally {
        setLoadingUser(false);
      }
    })();
  }, []);

  // New users land in the 4-step onboarding wizard until they complete it.
  // Runs post-hydration only (useEffect), so there's no SSR mismatch.
  useEffect(() => {
    if (loadingUser || !user) return;
    if (user.has_completed_onboarding !== false) return;
    if (pathname === "/" || ONBOARDING_EXEMPT.some((p) => pathname === p || pathname.startsWith(p + "/"))) return;
    router.replace("/onboarding");
  }, [user, loadingUser, pathname, router]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem("theme", next);
  }

  async function logout() {
    const refresh = localStorage.getItem("refresh_token");
    try { if (refresh) await api.auth.logout(refresh); } catch { /* ignore */ }
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem(ROLE_VIEW_KEY);
    setUser(null);
    window.location.href = "/";
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AppContext.Provider value={{ theme, toggleTheme, user, setUser, roleView, setRoleView, loadingUser, logout }}>
        {children}
      </AppContext.Provider>
    </QueryClientProvider>
  );
}
