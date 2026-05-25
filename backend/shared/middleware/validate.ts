import type { Request, Response, NextFunction } from "express";
import type { ZodTypeAny } from "zod";

export function validateBody(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    const r = schema.safeParse(req.body);
    if (!r.success) return res.status(400).json({ success: false, error: { message: r.error.issues[0].message, code: "VALIDATION" } });
    req.body = r.data;
    next();
  };
}

export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    const r = schema.safeParse(req.query);
    if (!r.success) return res.status(400).json({ success: false, error: { message: r.error.issues[0].message, code: "VALIDATION" } });
    next();
  };
}
