import { z } from "zod";

/** Optional human-readable context on an agent write (#236). */
export const actionReason = z.string().trim().min(1).max(140).optional();
