import { z } from 'zod';
export const FurnitureEvidenceSchema = z.object({
  id: z.string().optional(),
  familyId: z.string().min(1),
  type: z.string().optional(),
  pos: z.tuple([z.number().finite(), z.number().finite()]),
  width: z.number().positive().max(20),
  depth: z.number().positive().max(20),
  rotation: z.number().finite().default(0),
  zoneId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.enum(['visible-symbol', 'ambiguous-symbol']),
  sourceBoxPx: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
}).strict();
export const FurniturePassSchema = z.object({ furniture: z.array(FurnitureEvidenceSchema) }).strict();
// IMPORTANT: merge this schema into StructuralSchema. Do not parse furniture with
// the legacy schema because Zod may strip zoneId, confidence, evidence and sourceBoxPx.
