import { z } from "zod";

/**
 * Canonical timestamp representation for all contracts:
 * ISO 8601 datetime strings with explicit timezone information
 * (UTC "Z" or a numeric offset, e.g. "2026-07-24T15:10:57-05:00").
 *
 * Naive/local datetimes without offset are rejected so every
 * timestamp denotes an unambiguous instant.
 */
export const IsoTimestampSchema = z.iso.datetime({ offset: true });

export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;
