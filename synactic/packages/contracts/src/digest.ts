import { z } from "zod";

import { SourceProvenanceSchema } from "./provenance.js";
import { IsoTimestampSchema } from "./timestamp.js";

/** Time window a digest covers. */
export const DigestWindowSchema = z
  .strictObject({
    since: IsoTimestampSchema,
    until: IsoTimestampSchema,
  })
  .refine((window) => Date.parse(window.until) > Date.parse(window.since), {
    message: "window.until must be after window.since",
  });

export type DigestWindow = z.infer<typeof DigestWindowSchema>;

export const DigestRequestSchema = z.strictObject({
  topics: z.array(z.string().min(1)).min(1),
  window: DigestWindowSchema,
  limit: z.number().int().positive(),
});

export type DigestRequest = z.infer<typeof DigestRequestSchema>;

export const DigestItemSchema = z.strictObject({
  id: z.uuid(),
  summary: z.string().min(1),
  provenance: SourceProvenanceSchema,
});

export type DigestItem = z.infer<typeof DigestItemSchema>;

export const DigestResponseSchema = z.strictObject({
  generatedAt: IsoTimestampSchema,
  items: z.array(DigestItemSchema),
});

export type DigestResponse = z.infer<typeof DigestResponseSchema>;
