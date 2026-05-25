import type { Response } from "express";

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string };
  meta?: { page?: number; pageSize?: number; total?: number; [k: string]: unknown };
}

export function ok<T>(res: Response, data: T, meta?: ApiEnvelope<T>["meta"]) {
  res.json({ success: true, data, meta } satisfies ApiEnvelope<T>);
}

export function fail(res: Response, status: number, message: string, code?: string, meta?: Record<string, unknown>) {
  res.status(status).json({ success: false, error: { message, code, ...(meta ? { meta } : {}) } });
}

export function paginate<T>(items: T[], page = 1, pageSize = 20) {
  const total = items.length;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), meta: { page, pageSize, total } };
}
