import { describe, expect, it } from "vitest";
import { bucketForDuration, createMetricsStore } from "../shared/observability";

describe("bucketForDuration", () => {
  it("maps durations to the documented buckets", () => {
    expect(bucketForDuration(0)).toBe("lt50ms");
    expect(bucketForDuration(49.9)).toBe("lt50ms");
    expect(bucketForDuration(50)).toBe("lt200ms");
    expect(bucketForDuration(199)).toBe("lt200ms");
    expect(bucketForDuration(200)).toBe("lt1000ms");
    expect(bucketForDuration(999)).toBe("lt1000ms");
    expect(bucketForDuration(1000)).toBe("gte1000ms");
    expect(bucketForDuration(15_000)).toBe("gte1000ms");
  });
});

describe("createMetricsStore", () => {
  it("counts requests, 4xx and 5xx separately and averages latency", () => {
    let clock = 1_000_000;
    const store = createMetricsStore(() => clock);
    store.record(200, 10);
    store.record(201, 30);
    store.record(404, 100);
    store.record(500, 1200);
    clock += 5_000;

    const snap = store.snapshot();
    expect(snap.requestsTotal).toBe(4);
    expect(snap.errors4xx).toBe(1);
    expect(snap.errors5xx).toBe(1);
    expect(snap.avgLatencyMs).toBeCloseTo(335, 0);
    expect(snap.latencyBuckets).toEqual({ lt50ms: 2, lt200ms: 1, lt1000ms: 0, gte1000ms: 1 });
    expect(snap.uptimeSeconds).toBe(5);
  });

  it("starts at zero and reports 0 average latency with no traffic", () => {
    const snap = createMetricsStore().snapshot();
    expect(snap.requestsTotal).toBe(0);
    expect(snap.errors4xx).toBe(0);
    expect(snap.errors5xx).toBe(0);
    expect(snap.avgLatencyMs).toBe(0);
  });

  it("snapshot returns a copy — mutating it does not affect the store", () => {
    const store = createMetricsStore();
    store.record(200, 10);
    const snap = store.snapshot();
    snap.latencyBuckets.lt50ms = 999;
    expect(store.snapshot().latencyBuckets.lt50ms).toBe(1);
  });
});
