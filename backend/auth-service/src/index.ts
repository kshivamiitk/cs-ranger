import { createService, ok, fail, mock, withDb, isSupabaseConfigured, supabaseAdmin, publish, Topics, sendEmail, emailLayout } from "@cs-ranger/shared";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";

const { app, listen, log } = createService("auth-service");
const PORT = Number(process.env.PORT_AUTH || 4001);

const ACCESS_TTL  = process.env.JWT_ACCESS_TTL  || "15m";
const REFRESH_TTL_DAYS = 30;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-replace-me";
const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Email verification is OPT-IN — only enforced when EMAIL_VERIFICATION=TRUE in the env.
// When off (the default), new accounts are auto-verified and no verification email is sent,
// so you can register and log in for testing without real inboxes.
const EMAIL_VERIFICATION = /^true$/i.test(process.env.EMAIL_VERIFICATION ?? "");

function sha256(s: string) { return createHash("sha256").update(s).digest("hex"); }
function genToken(bytes = 48) { return randomBytes(bytes).toString("hex"); }

type AppRole = "learner" | "creator" | "admin";

// Pick the most-privileged role as the token's primary `role` (used by checks that
// still read a single role), while the full set is carried in `roles`.
function primaryRole(roles: string[]): AppRole {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("creator")) return "creator";
  return "learner";
}

function signAccess(userId: string, roles: string[]) {
  const normalized = (roles.length ? roles : ["learner"]) as AppRole[];
  // ACCESS_TTL is an env string ("15m"); @types/jsonwebtoken v9 types expiresIn
  // as its branded StringValue, so narrow the plain string explicitly.
  return jwt.sign(
    { sub: userId, role: primaryRole(normalized), roles: normalized },
    JWT_SECRET,
    { expiresIn: ACCESS_TTL as SignOptions["expiresIn"] },
  );
}

async function issueRefresh(userId: string) {
  const raw = genToken();
  const hash = sha256(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000).toISOString();
  await withDb(async (db) => {
    await db.from("refresh_tokens").insert({ token_hash: hash, user_id: userId, expires_at: expiresAt });
    return null;
  }, null);
  return raw;
}

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/, "Must contain uppercase").regex(/[a-z]/, "Must contain lowercase").regex(/[0-9]/, "Must contain digit"),
  displayName: z.string().min(2).max(60),
  intent: z.enum(["learner", "creator", "both"]).default("learner"),
});

app.post("/register", async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const { email, password, displayName, intent } = parsed.data;

  if (!isSupabaseConfigured()) {
    // Dev mock path
    if (mock.users.some((u) => u.email === email)) return fail(res, 409, "Email already registered", "EMAIL_TAKEN");
    return ok(res, { userId: `u${Date.now()}`, status: EMAIL_VERIFICATION ? "verification_email_sent" : "active" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const verifyTokenRaw = genToken(32);
    const verifyTokenHash = sha256(verifyTokenRaw);

    const result = await withDb(async (db) => {
      // 0. Reject duplicate email up-front with a clear signal. (withDb swallows
      //    thrown errors and returns the fallback, so a unique-violation on insert
      //    would otherwise surface as a generic 500 instead of "already registered".)
      const { data: dup } = await db.from("users").select("id").eq("email", email).maybeSingle();
      if (dup) return { emailTaken: true as const };

      // 1. Insert user (citext unique on email surfaces conflict cleanly).
      //    Auto-verify unless EMAIL_VERIFICATION is on.
      const { data: user, error } = await db.from("users").insert({ email, password_hash: passwordHash, is_verified: !EMAIL_VERIFICATION }).select("id").single();
      if (error) throw error;
      const userId = user.id;

      // 2. Assign roles based on intent
      const roles = intent === "both" ? ["learner", "creator"] : [intent];
      for (const role of roles) {
        await db.from("user_roles").insert({ user_id: userId, role });
      }

      // 3. Generate a base username from display name; collisions auto-suffixed
      const baseUsername = displayName.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 24) || "user";
      let username = baseUsername;
      for (let i = 0; i < 10; i++) {
        const { data: existing } = await db.from("profiles").select("user_id").eq("username", username).maybeSingle();
        if (!existing) break;
        username = `${baseUsername}_${Math.floor(Math.random() * 9999)}`;
      }

      await db.from("profiles").insert({ user_id: userId, display_name: displayName, username });

      // 4. Verification token (24h) — only when verification is required.
      if (EMAIL_VERIFICATION) {
        await db.from("email_verification_tokens").insert({
          token_hash: verifyTokenHash,
          user_id: userId,
          expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
        });
      }
      return { userId };
    }, null);

    if (!result) return fail(res, 500, "Registration failed", "INTERNAL");
    if ("emailTaken" in result) return fail(res, 409, "Email already registered", "EMAIL_TAKEN");

    // 5. Publish event; dispatch the verification email only when verification is required.
    await publish(Topics.USER_REGISTERED, { userId: result.userId, email, displayName });
    if (EMAIL_VERIFICATION) {
      const verifyUrl = `${APP_URL}/verify-email?token=${verifyTokenRaw}`;
      await sendEmail({
        to: email,
        subject: `Verify your CS-Ranger account`,
        html: emailLayout(`<h1>Welcome, ${displayName.split(" ")[0]}!</h1>
          <p>Confirm your email to start learning (or teaching) on CS-Ranger.</p>
          <p style="margin:24px 0;"><a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:linear-gradient(135deg,#a78bfa,#22d3ee);color:white;text-decoration:none;font-weight:600;">Verify email</a></p>
          <p style="font-size:13px;color:#94a3b8;">Or paste this link: ${verifyUrl}</p>`),
      });
    }

    res.status(201);
    ok(res, { userId: result.userId, status: EMAIL_VERIFICATION ? "verification_email_sent" : "active" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate") || msg.includes("23505")) return fail(res, 409, "Email already registered", "EMAIL_TAKEN");
    log.error("register failed", { err: msg });
    fail(res, 500, "Registration failed", "INTERNAL");
  }
});

app.post("/verify-email", async (req, res) => {
  const token = String(req.body.token || "");
  if (!token) return fail(res, 400, "Missing token", "VALIDATION");
  const hash = sha256(token);
  const result = await withDb(async (db) => {
    const { data: row } = await db.from("email_verification_tokens").select("*").eq("token_hash", hash).maybeSingle();
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) return null;
    await db.from("email_verification_tokens").update({ used_at: new Date().toISOString() }).eq("token_hash", hash);
    await db.from("users").update({ is_verified: true }).eq("id", row.user_id);
    const { data: roles } = await db.from("user_roles").select("role").eq("user_id", row.user_id);
    return { userId: row.user_id, roles: roles?.map((r) => r.role) || ["learner"] };
  }, null);
  if (!result) return fail(res, 400, "Invalid or expired token", "INVALID_TOKEN");

  const accessToken = signAccess(result.userId, result.roles);
  const refreshToken = await issueRefresh(result.userId);
  ok(res, { userId: result.userId, accessToken, refreshToken, verified: true });
});

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
app.post("/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const { email, password } = parsed.data;

  if (!isSupabaseConfigured()) {
    const u = mock.users.find((x) => x.email === email);
    if (!u) return fail(res, 401, "Invalid credentials", "INVALID_CREDENTIALS");
    return ok(res, { user: { id: u.id, displayName: u.displayName, roles: u.roles }, accessToken: signAccess(u.id, u.roles), refreshToken: `dev-${u.id}` });
  }

  const result = await withDb(async (db) => {
    const { data: user } = await db.from("users").select("id, password_hash, is_verified, is_suspended").eq("email", email).maybeSingle();
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.password_hash || "");
    if (!ok) return null;
    if (user.is_suspended) return { suspended: true } as const;
    if (EMAIL_VERIFICATION && !user.is_verified) return { unverified: true } as const;
    const { data: roles } = await db.from("user_roles").select("role").eq("user_id", user.id);
    const { data: profile } = await db.from("profiles").select("display_name, username, avatar_url").eq("user_id", user.id).maybeSingle();
    await db.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);
    return { user: { id: user.id, displayName: profile?.display_name || "", username: profile?.username || "", avatarUrl: profile?.avatar_url, roles: roles?.map((r) => r.role) || ["learner"] } };
  }, null);

  if (!result) return fail(res, 401, "Invalid credentials", "INVALID_CREDENTIALS");
  if ("suspended" in result) return fail(res, 403, "Your account has been suspended. Contact support.", "SUSPENDED");
  if ("unverified" in result) return fail(res, 403, "Email not verified", "UNVERIFIED");

  const accessToken = signAccess(result.user.id, result.user.roles);
  const refreshToken = await issueRefresh(result.user.id);
  ok(res, { user: result.user, accessToken, refreshToken });
});

app.post("/refresh", async (req, res) => {
  const t = String(req.body.refreshToken || "");
  if (!t) return fail(res, 400, "Missing refresh token", "VALIDATION");
  const hash = sha256(t);
  const result = await withDb(async (db) => {
    const { data: row } = await db.from("refresh_tokens").select("*").eq("token_hash", hash).maybeSingle();
    if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) return null;
    // Suspended accounts cannot mint new sessions. (Suspension also revokes all
    // refresh tokens via user-service, so this is a belt-and-braces check for
    // tokens issued in the same instant as the suspension.)
    const { data: user } = await db.from("users").select("is_suspended").eq("id", row.user_id).maybeSingle();
    if (user?.is_suspended) return { suspended: true } as const;
    // Rotate: revoke old, issue new
    await db.from("refresh_tokens").update({ revoked_at: new Date().toISOString() }).eq("token_hash", hash);
    const { data: roles } = await db.from("user_roles").select("role").eq("user_id", row.user_id);
    return { userId: row.user_id, roles: roles?.map((r) => r.role) || ["learner"] };
  }, null);
  if (!result) return fail(res, 401, "Invalid refresh token", "INVALID_REFRESH");
  if ("suspended" in result) return fail(res, 403, "Your account has been suspended. Contact support.", "SUSPENDED");
  const accessToken = signAccess(result.userId, result.roles);
  const refreshToken = await issueRefresh(result.userId);
  ok(res, { accessToken, refreshToken });
});

app.post("/logout", async (req, res) => {
  const t = String(req.body.refreshToken || "");
  if (t) {
    const hash = sha256(t);
    await withDb(async (db) => { await db.from("refresh_tokens").update({ revoked_at: new Date().toISOString() }).eq("token_hash", hash); return null; }, null);
  }
  ok(res, { loggedOut: true });
});

app.post("/logout-all", async (req, res) => {
  const userId = req.header("x-user-id");
  if (!userId) return fail(res, 401, "Unauthorized", "UNAUTHORIZED");
  await withDb(async (db) => { await db.from("refresh_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", userId).is("revoked_at", null); return null; }, null);
  ok(res, { loggedOut: true });
});

app.post("/forgot-password", async (req, res) => {
  const email = String(req.body.email || "").toLowerCase();
  if (!email) return fail(res, 400, "Missing email", "VALIDATION");

  await withDb(async (db) => {
    const { data: user } = await db.from("users").select("id").eq("email", email).maybeSingle();
    if (!user) return null;
    const raw = genToken(32);
    await db.from("password_reset_tokens").insert({
      token_hash: sha256(raw),
      user_id: user.id,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    const resetUrl = `${APP_URL}/reset-password?token=${raw}`;
    await sendEmail({
      to: email,
      subject: "Reset your CS-Ranger password",
      html: emailLayout(`<h1>Reset your password</h1>
        <p>Click below to set a new password. The link expires in 1 hour.</p>
        <p style="margin:24px 0;"><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:linear-gradient(135deg,#a78bfa,#22d3ee);color:white;text-decoration:none;font-weight:600;">Set new password</a></p>
        <p style="font-size:13px;color:#94a3b8;">If you didn't request this, ignore this email.</p>`),
    });
    await publish(Topics.USER_PASSWORD_RESET, { userId: user.id, email });
    return null;
  }, null);

  // Always same response — prevents email enumeration
  ok(res, { message: "If that email is registered, you'll receive a reset link." });
});

const ResetSchema = z.object({ token: z.string(), password: z.string().min(8) });
app.post("/reset-password", async (req, res) => {
  const parsed = ResetSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const hash = sha256(parsed.data.token);
  const result = await withDb(async (db) => {
    const { data: row } = await db.from("password_reset_tokens").select("*").eq("token_hash", hash).maybeSingle();
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) return null;
    const newHash = await bcrypt.hash(parsed.data.password, 12);
    await db.from("users").update({ password_hash: newHash }).eq("id", row.user_id);
    await db.from("password_reset_tokens").update({ used_at: new Date().toISOString() }).eq("token_hash", hash);
    await db.from("refresh_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", row.user_id).is("revoked_at", null);
    return true;
  }, false);
  if (!result) return fail(res, 400, "Invalid or expired token", "INVALID_TOKEN");
  ok(res, { reset: true });
});

// Authenticated password change — verifies the current password, rotates the
// hash, and revokes every other refresh token so stolen sessions die with it.
const ChangePassword = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).regex(/[A-Z]/, "Must contain uppercase").regex(/[a-z]/, "Must contain lowercase").regex(/[0-9]/, "Must contain digit"),
});
app.post("/change-password", async (req, res) => {
  const userId = req.header("x-user-id");
  if (!userId) return fail(res, 401, "Unauthorized", "UNAUTHORIZED");
  const parsed = ChangePassword.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");

  const result = await withDb<"ok" | "wrong_password" | null>(async (db) => {
    const { data: user } = await db.from("users").select("id, password_hash").eq("id", userId).maybeSingle();
    if (!user) return null;
    const matches = await bcrypt.compare(parsed.data.currentPassword, user.password_hash || "");
    if (!matches) return "wrong_password";
    const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await db.from("users").update({ password_hash: newHash }).eq("id", userId);
    await db.from("refresh_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", userId).is("revoked_at", null);
    return "ok";
  }, null);

  if (result === null) return fail(res, 404, "Account not found", "NOT_FOUND");
  if (result === "wrong_password") return fail(res, 400, "Current password is incorrect", "INVALID_CREDENTIALS");
  ok(res, { changed: true });
});

// Self-service deactivation. Reuses the suspension machinery: login/refresh are
// blocked and all sessions are revoked. Reactivation goes through support/admin
// (admin user management can unsuspend).
const Deactivate = z.object({ password: z.string().min(1), confirm: z.literal("DEACTIVATE") });
app.post("/deactivate", async (req, res) => {
  const userId = req.header("x-user-id");
  if (!userId) return fail(res, 401, "Unauthorized", "UNAUTHORIZED");
  const parsed = Deactivate.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Type DEACTIVATE and your password to confirm", "VALIDATION");

  const result = await withDb<"ok" | "wrong_password" | null>(async (db) => {
    const { data: user } = await db.from("users").select("id, password_hash").eq("id", userId).maybeSingle();
    if (!user) return null;
    const matches = await bcrypt.compare(parsed.data.password, user.password_hash || "");
    if (!matches) return "wrong_password";
    await db.from("users").update({
      is_suspended: true,
      suspended_at: new Date().toISOString(),
      suspension_reason: "Self-deactivated from account settings",
    }).eq("id", userId);
    await db.from("refresh_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", userId).is("revoked_at", null);
    return "ok";
  }, null);

  if (result === null) return fail(res, 404, "Account not found", "NOT_FOUND");
  if (result === "wrong_password") return fail(res, 400, "Password is incorrect", "INVALID_CREDENTIALS");
  ok(res, { deactivated: true });
});

app.post("/oauth/google", async (_req, res) => {
  // OAuth is handled client-side via Supabase Auth Google provider; the
  // browser then exchanges the Supabase session for platform JWTs at
  // POST /oauth/exchange below.
  ok(res, { message: "Use the Supabase Auth client-side OAuth flow, then POST /auth/oauth/exchange." });
});

// ─── Google OAuth exchange ────────────────────────────────────────
// The browser completes Google sign-in through Supabase Auth (PKCE) and sends
// the resulting Supabase access token here. We verify it server-side with the
// service role, find-or-create the platform account (profile, learner role,
// onboarding incomplete), enforce suspension, and issue our own JWT pair so
// the rest of the app keeps using the existing auth model.
const OAuthExchange = z.object({ accessToken: z.string().min(20) });
app.post("/oauth/exchange", async (req, res) => {
  if (!isSupabaseConfigured()) {
    return fail(res, 503, "Google sign-in isn't configured on this server", "OAUTH_NOT_CONFIGURED");
  }
  const parsed = OAuthExchange.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");

  // 1. Verify the Supabase session token and pull the Google identity.
  let email = "";
  let fullName = "";
  let avatarUrl: string | undefined;
  try {
    const { data, error } = await supabaseAdmin().auth.getUser(parsed.data.accessToken);
    if (error || !data?.user?.email) {
      return fail(res, 401, "Google sign-in could not be verified — please try again", "INVALID_OAUTH_TOKEN");
    }
    email = data.user.email.toLowerCase();
    const meta = (data.user.user_metadata || {}) as { full_name?: string; name?: string; avatar_url?: string; picture?: string };
    fullName = meta.full_name || meta.name || email.split("@")[0];
    avatarUrl = meta.avatar_url || meta.picture;
  } catch (e) {
    log.error("oauth token verification failed", { err: e instanceof Error ? e.message : String(e) });
    return fail(res, 502, "Could not reach the identity provider", "OAUTH_VERIFY_FAILED");
  }

  // 2. Find or create the platform account.
  type ExchangeResult =
    | { suspended: true }
    | { isNew: boolean; user: { id: string; displayName: string; username: string; avatarUrl?: string | null; roles: string[] } };
  const result = await withDb<ExchangeResult | null>(async (db) => {
    const { data: existing } = await db.from("users").select("id, is_suspended").eq("email", email).maybeSingle();

    let userId: string;
    let isNew = false;
    if (existing) {
      if (existing.is_suspended) return { suspended: true };
      userId = existing.id;
    } else {
      isNew = true;
      const { data: created, error } = await db.from("users")
        .insert({ email, password_hash: null, is_verified: true })
        .select("id").single();
      if (error || !created) throw error || new Error("OAuth user insert failed");
      userId = created.id;
      await db.from("user_roles").insert({ user_id: userId, role: "learner" });

      // Username fallback from the Google display name, with collision suffixes.
      const baseUsername = fullName.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 24) || "learner";
      let username = baseUsername.length >= 3 ? baseUsername : `${baseUsername}_${Math.floor(Math.random() * 9999)}`;
      for (let i = 0; i < 10; i++) {
        const { data: taken } = await db.from("profiles").select("user_id").eq("username", username).maybeSingle();
        if (!taken) break;
        username = `${baseUsername}_${Math.floor(Math.random() * 9999)}`;
      }
      await db.from("profiles").insert({
        user_id: userId,
        display_name: fullName.slice(0, 60) || "New learner",
        username,
        avatar_url: avatarUrl || null,
        // has_completed_onboarding stays false → the wizard runs on first login.
      });
    }

    const [{ data: roles }, { data: profile }] = await Promise.all([
      db.from("user_roles").select("role").eq("user_id", userId),
      db.from("profiles").select("display_name, username, avatar_url").eq("user_id", userId).maybeSingle(),
    ]);
    await db.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", userId);
    return {
      isNew,
      user: {
        id: userId,
        displayName: profile?.display_name || fullName,
        username: profile?.username || "",
        avatarUrl: profile?.avatar_url,
        roles: roles?.map((r) => r.role) || ["learner"],
      },
    };
  }, null);

  if (!result) return fail(res, 500, "Google sign-in failed", "INTERNAL");
  if ("suspended" in result) return fail(res, 403, "Your account has been suspended. Contact support.", "SUSPENDED");

  const accessToken = signAccess(result.user.id, result.user.roles);
  const refreshToken = await issueRefresh(result.user.id);
  if (result.isNew) await publish(Topics.USER_REGISTERED, { userId: result.user.id, email, displayName: result.user.displayName });
  ok(res, { user: result.user, accessToken, refreshToken });
});

listen(PORT);
