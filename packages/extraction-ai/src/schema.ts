// packages/extraction-ai/src/schema.ts
// VERBATIM PRESERVATION of StructuralSchema (Zod) from
// apps/editor/src/lib/orchestration/gemini-pipeline.ts
// (freeze sha256 c588b7969eeaa702…). §4: response schemas preserved.

import { z } from "zod";

export const StructuralSchema = z.object({
  projectInfo: z.object({
    name: z.string().optional(),
    estimatedArea: z.string().optional()
  }).optional(),
  drawingCalibration: z.object({
    orientation: z.enum(["landscape", "portrait"]).optional(),
    rotationDeg: z.number().optional().default(0),
    buildingRoiNormalized: z.object({
      topY: z.number(),
      leftX: z.number(),
      bottomY: z.number(),
      rightX: z.number(),
    }).optional(),
    buildingDimensionsM: z.object({
      widthM: z.number(),
      depthM: z.number(),
    }).optional(),
  }).optional(),
  walls: z.array(z.object({
    id: z.string().optional(),
    start: z.tuple([z.number(), z.number()]),
    end: z.tuple([z.number(), z.number()]),
    thickness: z.number().optional().default(0.2),
    height: z.number().optional().default(2.8),
    material: z.string().optional()
  })).optional().default([]),
  openings: z.array(z.object({
    id: z.string().optional(),
    type: z.string(),
    pos: z.tuple([z.number(), z.number()]),
    width: z.number(),
    height: z.number(),
    elevation: z.number().optional().default(0)
  })).optional().default([]),
  furniture: z.array(z.object({
    id: z.string().optional(),
    type: z.string(),
    pos: z.tuple([z.number(), z.number()]),
    rotation: z.number().optional().default(0),
    width: z.number().optional().default(1.0),
    depth: z.number().optional().default(1.0)
  })).optional().default([]),
  floors: z.array(z.object({
    id: z.string().optional(),
    boundary: z.array(z.tuple([z.number(), z.number()])),
    level: z.number().optional().default(0),
    material: z.string().optional()
  })).optional().default([]),
  ceilings: z.array(z.object({
    id: z.string().optional(),
    boundary: z.array(z.tuple([z.number(), z.number()])),
    level: z.number().optional().default(0),
    height: z.number().optional().default(2.5)
  })).optional().default([]),
  zones: z.array(z.object({
    id: z.string().optional(),
    name: z.string(),
    boundary: z.array(z.tuple([z.number(), z.number()])),
    color: z.string().optional()
  })).optional().default([])
});

export type StructuralSchemaType = z.infer<typeof StructuralSchema>;
