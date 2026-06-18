import { z } from "zod";

// Example resource schema. Replace with your real API shape. The point is that
// every API payload is parsed before it reaches the UI (Principle IV, FR-008b).
export const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

export const itemListSchema = z.array(itemSchema);

export type Item = z.infer<typeof itemSchema>;
