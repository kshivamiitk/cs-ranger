import type { Request, Response, NextFunction } from "express";

type AppRole = "learner" | "creator" | "admin";

declare module "express-serve-static-core" {
  interface Request {
    // `role` is the primary/active role; `roles` is the full set the user holds.
    user?: { id: string; role: AppRole; roles: AppRole[] };
  }
}

/**
 * Dev-mode JWT shim: reads `x-user-id`, `x-user-role`, and `x-user-roles`
 * (comma-separated) headers from the api-gateway. In production this validates a
 * real signed JWT. `roles` lets authorization respect every role a user holds —
 * a "both" user (learner + creator) must pass requireRole("creator") even when
 * their primary role is "learner".
 */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const id = req.header("x-user-id");
  const role = (req.header("x-user-role") as AppRole | undefined) || "learner";
  const rolesHeader = req.header("x-user-roles");
  const roles = (rolesHeader ? rolesHeader.split(",").map((r) => r.trim()).filter(Boolean) : [role]) as AppRole[];
  if (id) req.user = { id, role, roles: roles.length ? roles : [role] };
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ success: false, error: { message: "Unauthorized", code: "UNAUTHORIZED" } });
  next();
}

export function requireRole(...roles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ success: false, error: { message: "Unauthorized", code: "UNAUTHORIZED" } });
    // Pass if ANY role the user holds is allowed (fall back to the single primary role).
    const held = req.user.roles?.length ? req.user.roles : [req.user.role];
    if (!held.some((r) => roles.includes(r))) return res.status(403).json({ success: false, error: { message: "Forbidden", code: "FORBIDDEN" } });
    next();
  };
}
