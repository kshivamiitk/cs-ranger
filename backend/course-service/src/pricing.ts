// ============================================================
// Pure course-pricing resolution. Keeps the price/discount pair always valid
// against the DB CHECK constraint `discounted_price is null or
// (discounted_price >= 0 and discounted_price < price)`, so a price edit can
// never be silently rejected by Postgres and misreported as "Course not found".
//
// Tested exhaustively in backend/tests/course-pricing.test.ts.
// ============================================================

export type PricingPatch = { price?: number; discounted_price?: number };
export type PricingRow = { price: number; discounted_price: number | null };

export type PricingResult =
  | { ok: true; price: number; discounted_price: number | null }
  | { ok: false; error: string };

/**
 * Merge a partial price/discount patch onto the existing row and normalize the
 * result so it satisfies the DB constraint:
 *
 *   - An explicitly supplied discount that is >= an explicitly supplied price
 *     (paid course) is a user error → reject with a clear message.
 *   - A free course (price <= 0) carries no discount → discount cleared.
 *   - A discount that is no longer strictly below the (new) price — e.g. a stale
 *     discount left over from a higher price, or a premium→free switch — is
 *     dropped rather than left to violate the constraint.
 */
export function resolveCoursePricing(patch: PricingPatch, existing: PricingRow): PricingResult {
  if (
    patch.price !== undefined &&
    patch.discounted_price !== undefined &&
    patch.price > 0 &&
    patch.discounted_price >= patch.price
  ) {
    return { ok: false, error: "Discounted price must be lower than the price" };
  }

  const price = patch.price !== undefined ? patch.price : existing.price;
  let discounted_price = patch.discounted_price !== undefined ? patch.discounted_price : existing.discounted_price;

  if (price <= 0) discounted_price = null;
  else if (discounted_price != null && discounted_price >= price) discounted_price = null;

  return { ok: true, price, discounted_price };
}
