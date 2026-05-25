import { z } from "zod";

/**
 * Admin refund decision recorded on a refund-linked support ticket.
 * Approval needs no reason; rejection must explain why (shared with the learner).
 * Kept in its own module so it can be unit-tested without booting the service.
 */
export const RefundDecision = z.object({
  approved: z.boolean(),
  reason: z.string().min(5).max(500).optional(),
}).refine((d) => d.approved || !!d.reason, { message: "A reason is required when rejecting a refund" });
