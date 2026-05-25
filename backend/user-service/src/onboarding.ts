import type { Express } from "express";
import { z } from "zod";
import { ok, fail, requireAuth, withDb } from "@cs-ranger/shared";

/**
 * Resumable 4-step onboarding (gateway path: /api/users/me/onboarding*).
 *   step 1 — role selection (learner / creator / both)
 *   step 2 — profile basics (display name, unique username, bio, avatar)
 *   step 3 — preferences (domains, skill level, language, notifications)
 *   step 4 — creator setup (headline) / completion
 * Answers are merged into profiles.onboarding_data; the step pointer makes the
 * wizard resumable across sessions; completion flips has_completed_onboarding.
 */

const RolesSchema = z.enum(["learner", "creator", "both"]);

// Exported for unit tests — the wizard's PATCH payload contract.
export const OnboardingPatch = z.object({
  step: z.number().int().min(0).max(4).optional(),
  roles: RolesSchema.optional(),
  profile: z.object({
    displayName: z.string().min(2).max(60).optional(),
    username: z.string().regex(/^[a-z0-9_]{3,30}$/, "Username must be 3–30 chars: lowercase letters, digits, underscore").optional(),
    bio: z.string().max(500).optional(),
  }).strict().optional(),
  preferences: z.object({
    domains: z.array(z.string().max(60)).max(10).optional(),
    skillLevel: z.enum(["beginner", "intermediate", "advanced"]).optional(),
    language: z.string().max(40).optional(),
    emailNotifications: z.boolean().optional(),
    inappNotifications: z.boolean().optional(),
  }).strict().optional(),
  creator: z.object({
    headline: z.string().max(120).optional(),
  }).strict().optional(),
}).strict();

interface OnboardingState {
  completed: boolean;
  step: number;
  data: Record<string, unknown>;
  roles: string[];
  profile: { display_name?: string; username?: string; bio?: string | null; avatar_url?: string | null };
}

export function registerOnboardingRoutes(app: Express) {
  app.get("/me/onboarding", requireAuth, async (req, res) => {
    const state = await withDb<OnboardingState | null>(async (db) => {
      const [{ data: profile }, { data: roles }] = await Promise.all([
        db.from("profiles").select("display_name, username, bio, avatar_url, has_completed_onboarding, onboarding_step, onboarding_data").eq("user_id", req.user!.id).maybeSingle(),
        db.from("user_roles").select("role").eq("user_id", req.user!.id),
      ]);
      if (!profile) return null;
      return {
        completed: !!profile.has_completed_onboarding,
        step: profile.onboarding_step || 0,
        data: profile.onboarding_data || {},
        roles: roles?.map((r) => r.role) || ["learner"],
        profile: { display_name: profile.display_name, username: profile.username, bio: profile.bio, avatar_url: profile.avatar_url },
      };
    }, () => ({ completed: false, step: 0, data: {}, roles: ["learner"], profile: {} }));
    if (!state) return fail(res, 404, "Profile not found", "NOT_FOUND");
    ok(res, state);
  });

  app.patch("/me/onboarding", requireAuth, async (req, res) => {
    const parsed = OnboardingPatch.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
    const patch = parsed.data;

    const result = await withDb<{ saved: true } | { error: { status: number; message: string; code: string } }>(async (db) => {
      // 1. Role selection — additive inserts into the existing user_roles structure.
      if (patch.roles) {
        const roles = patch.roles === "both" ? ["learner", "creator"] : [patch.roles];
        for (const role of roles) {
          await db.from("user_roles").upsert({ user_id: req.user!.id, role }, { onConflict: "user_id,role", ignoreDuplicates: true });
        }
      }

      // 2. Profile basics — username uniqueness surfaces as a friendly error.
      if (patch.profile && Object.keys(patch.profile).length > 0) {
        const { error } = await db.from("profiles").update({
          display_name: patch.profile.displayName,
          username: patch.profile.username,
          bio: patch.profile.bio,
        }).eq("user_id", req.user!.id);
        if (error) {
          if (String(error.message).toLowerCase().includes("duplicate") || error.code === "23505") {
            return { error: { status: 409, message: "That username is already taken", code: "USERNAME_TAKEN" } };
          }
          throw error;
        }
      }

      // 3. Preferences / creator answers — merged into onboarding_data; the
      //    notification toggles also land in notification_preferences.
      if (patch.preferences || patch.creator || patch.roles || patch.step != null) {
        const { data: current } = await db.from("profiles").select("onboarding_data, onboarding_step").eq("user_id", req.user!.id).maybeSingle();
        const mergedData = {
          ...(current?.onboarding_data || {}),
          ...(patch.roles ? { roleIntent: patch.roles } : {}),
          ...(patch.preferences ? { preferences: { ...((current?.onboarding_data || {}).preferences || {}), ...patch.preferences } } : {}),
          ...(patch.creator ? { creator: { ...((current?.onboarding_data || {}).creator || {}), ...patch.creator } } : {}),
        };
        const nextStep = patch.step != null ? Math.max(patch.step, current?.onboarding_step || 0) : current?.onboarding_step || 0;
        await db.from("profiles").update({ onboarding_data: mergedData, onboarding_step: nextStep }).eq("user_id", req.user!.id);
      }

      if (patch.preferences && (patch.preferences.emailNotifications != null || patch.preferences.inappNotifications != null)) {
        const email = patch.preferences.emailNotifications ?? true;
        const inapp = patch.preferences.inappNotifications ?? true;
        await db.from("notification_preferences").upsert(
          ["course_updates", "doubt_replies", "payouts", "achievements"].map((eventType) => ({
            user_id: req.user!.id, event_type: eventType, email_enabled: email, inapp_enabled: inapp,
          })),
          { onConflict: "user_id,event_type" },
        );
      }

      return { saved: true };
    }, { saved: true });

    if ("error" in result) return fail(res, result.error.status, result.error.message, result.error.code);
    ok(res, result);
  });

  app.post("/me/onboarding/complete", requireAuth, async (req, res) => {
    await withDb(async (db) => {
      await db.from("profiles").update({ has_completed_onboarding: true, onboarding_step: 4 }).eq("user_id", req.user!.id);
      return null;
    }, null);
    ok(res, { completed: true });
  });
}
