// Clean Detector Configuration.
// Free of any target count influences or WA dependency structures.

export const CLEAN_DETECTOR_CONFIG = {
  algorithmVersion: 'v3-grammar-v1',
  parameterProvenance: 'Stage B-R1.2 approved opening-specific window grammar',
  expectedCountDependency: false,
  waDependency: false,

  // Geometry Thresholds (page units / px)
  OVERLAP_TOLERANCE: 10.0,
  ZERO_LENGTH_THRESHOLD: 0.5,
  PARALLEL_ANGLE_MAX_DEG: 5.0,
  PARALLEL_SPACING_MIN_PX: 2.0,
  PARALLEL_SPACING_MAX_PX: 50.0,
  FRAME_LINE_MIN_LENGTH_PX: 3.0,
  GAP_EDGE_MIN_LENGTH_PX: 2.0,

  // Continuous Wall Rejection Thresholds
  CONTINUOUS_WALL_FACE_MIN_LENGTH: 150.0,
  JAMB_MAX_LENGTH: 15.0,
  HATCH_MIN_RECURRENCE: 4,
  ENDPOINT_TOLERANCE: 10.0,

  // ROI in Stage A space: [306.12, 376.92, 1768.68, 1170.60]
  ROI: [306.12, 376.92, 1768.68, 1170.60] as [number, number, number, number]
};
