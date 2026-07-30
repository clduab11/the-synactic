import { describe, expect, it } from "vitest";

import { IsoTimestampSchema } from "./index.js";

describe("IsoTimestampSchema", () => {
  it("accepts UTC timestamps with Z", () => {
    const value = "2026-07-24T12:00:00.000Z";
    expect(IsoTimestampSchema.parse(value)).toBe(value);
  });

  it("accepts timestamps with a numeric offset", () => {
    const value = "2026-07-24T15:10:57-05:00";
    expect(IsoTimestampSchema.parse(value)).toBe(value);
  });

  it("accepts fractional seconds with an offset", () => {
    const value = "2026-07-24T15:10:57.123+02:00";
    expect(IsoTimestampSchema.safeParse(value).success).toBe(true);
  });

  it("rejects naive datetimes without a zone", () => {
    expect(IsoTimestampSchema.safeParse("2026-07-24T12:00:00").success).toBe(false);
    expect(IsoTimestampSchema.safeParse("2026-07-24T12:00:00.000").success).toBe(false);
  });

  it("rejects date-only strings", () => {
    expect(IsoTimestampSchema.safeParse("2026-07-24").success).toBe(false);
  });

  it("rejects garbage strings and non-strings", () => {
    expect(IsoTimestampSchema.safeParse("not a timestamp").success).toBe(false);
    expect(IsoTimestampSchema.safeParse(1753363200000).success).toBe(false);
    expect(IsoTimestampSchema.safeParse(null).success).toBe(false);
  });
});
