const POST_AUTH_REDIRECT_KEY = "learnrift_post_auth_redirect";

function safeSameOriginPath(raw: string, expectedPathname?: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    if (expectedPathname && url.pathname !== expectedPathname) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function setPostAuthRedirect(raw: string): void {
  if (typeof window === "undefined") return;
  const safePath = safeSameOriginPath(raw);
  if (!safePath) return;
  sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, safePath);
}

export function consumePostAuthRedirect(expectedPathname?: string): string | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(POST_AUTH_REDIRECT_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(POST_AUTH_REDIRECT_KEY);
  return safeSameOriginPath(raw, expectedPathname);
}
