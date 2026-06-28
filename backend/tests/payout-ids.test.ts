import { describe, expect, it } from "vitest";
import { razorpayIdempotencyKey, razorpayReferenceId } from "../payout-service/src/ids";

const runId = "59fe8d0c-51d4-4b7b-8df3-a30710ad7654";
const creatorId = "b1d0615a-64fc-43ba-a1b8-96f9ae14d9cb";
const payoutItemId = "980d1090-21c5-4b3f-8c08-82df753d26ca";

describe("Razorpay payout identifiers", () => {
  it("keeps KYC contact references within Razorpay's 40 character limit", () => {
    const referenceId = razorpayReferenceId("creator", creatorId);

    expect(referenceId.length).toBeLessThanOrEqual(40);
    expect(referenceId).toMatch(/^creator_[A-Za-z0-9_-]+$/);
  });

  it("keeps bulk/manual/retry payout references within Razorpay's 40 character limit", () => {
    const references = [
      razorpayReferenceId("bulk", runId, creatorId),
      razorpayReferenceId("manual", runId, creatorId),
      razorpayReferenceId("retry", payoutItemId, 12),
    ];

    for (const referenceId of references) {
      expect(referenceId.length).toBeLessThanOrEqual(40);
      expect(referenceId).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("keeps payout idempotency keys bounded and deterministic", () => {
    const first = razorpayIdempotencyKey("manual", runId, creatorId);
    const second = razorpayIdempotencyKey("manual", runId, creatorId);

    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(36);
    expect(first).toMatch(/^manual_[A-Za-z0-9_-]+$/);
  });

  it("produces different identifiers for different payout targets", () => {
    expect(razorpayReferenceId("manual", runId, creatorId)).not.toBe(
      razorpayReferenceId("manual", runId, "c42a05a6-0c5a-49aa-98a2-1c1907c3380b"),
    );
    expect(razorpayIdempotencyKey("retry", payoutItemId, 1)).not.toBe(
      razorpayIdempotencyKey("retry", payoutItemId, 2),
    );
  });
});

