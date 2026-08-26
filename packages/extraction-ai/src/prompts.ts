// packages/extraction-ai/src/prompts.ts
// VERBATIM PRESERVATION from apps/editor/src/lib/orchestration/gemini-pipeline.ts
// (freeze sha256 c588b7969eeaa702f530b14756ac0b3709e69133259b450c660432491a2de5d3).
// §9: prompt text, composition, role structure and pass inputs are preserved
// EXACTLY. Do not improve prompts during parity migration.

export const CATALOG_SLUGS = ["ac-block", "air-conditioner", "air-conditioner-block", "air-conditioning", "alarm-keypad", "ball", "barbell", "barbell-stand", "basket-hoop", "bathroom-sink", "bathtub", "bean-bag", "bedside-table", "books", "bookshelf", "bunkbed", "bush", "cactus", "car-toy", "ceiling-fan", "ceiling-lamp", "ceiling-light", "circular-ceiling-light", "closet", "coat-rack", "coffee-machine", "coffee-table", "column", "computer", "couch-medium", "couch-small", "cutting-board", "desk", "dining-chair", "dining-table", "door", "door-bar", "door-with-bar", "doorway-front", "double-bed", "dresser", "drying-rack", "duct", "easel", "electric-panel", "ev-wall-charger", "exercise-bike", "exit-sign", "fence", "fir-tree", "fire-alarm", "fire-detector", "fire-extinguisher", "flat-screen-tv", "floor-lamp", "freezer", "fridge", "fruits", "frying-pan", "glass-door", "guitar", "hedge", "high-fence", "hood", "hydrant", "indoor-plant", "iron", "ironing-board", "kettle", "kitchen", "kitchen-cabinet", "kitchen-counter", "kitchen-fridge", "kitchen-shelf", "kitchen-utensils", "laundry-bag", "livingroom-chair", "lounge-chair", "low-fence", "medium-fence", "meeting-table", "microwave", "office-chair", "office-table", "outdoor-playhouse", "palm", "pantry-table", "parking-spot", "patio-umbrella", "piano", "picture", "pillar", "pool-table", "reception-sofa", "recessed-light", "rectangular-carpet", "rectangular-ceiling-light", "rectangular-mirror", "round-carpet", "round-mirror", "scooter", "sewing-machine", "shelf", "shower", "shower-angle", "shower-rug", "shower-square", "side-table", "single-bed", "sink-cabinet", "skate", "small-indoor-plant", "small-kitchen-cabinet", "smoke-detector", "sofa", "sprinkler", "stairs", "stereo-speaker", "stool", "stove", "sunbed", "suspended-fireplace", "table", "table-lamp", "television", "tesla", "thermostat", "threadmill", "toaster", "toilet", "toilet-brush", "toilet-paper", "toy", "trash-bin", "tree", "tub", "tv-stand", "wall-art-06", "wall-sink", "washing-machine", "window-double", "window-large", "window-rectangle", "window-round", "window-simple", "window-small", "window-small-2", "window-square", "window1-black-open-1731", "wine-bottle"];

export const MATERIALS = [
  "white-plaster", "glass", "metal", "wood-oak", "wood-dark", "granite", "marble", "parquet", "wallpaper-classic", "wallpaper-modern"
];

const BASE_RULES = `
CRITICAL REQUIREMENTS FOR 1:1 REPLICA:
- (0,0) is bottom-left. Use absolute coordinates in METERS.
- ZERO OMISSIONS. If there are 30 objects, output 30 individual JSON nodes. DO NOT group them.
- MATCH EXACTLY. Do not hallucinate coordinates outside the visible floor plan.
- OUTPUT ONLY VALID JSON. Start with '{' and end with '}'. No markdown formatting.
- ONLY use the provided native catalog slugs for 'type'.
- ONLY use the provided materials for 'material'.

NATIVE CATALOG SLUGS (Use ONLY these for 'type'):
${CATALOG_SLUGS.join(", ")}

AVAILABLE MATERIALS:
${MATERIALS.join(", ")}
`;

export function getShellPrompt() {
  return `You are a Master Structural Engineer.
TASK: Extract the drawing calibration (orientation, architectural wall ROI bounding box, dimensions in meters), foundation boundaries, ceilings, and main zones from the provided 2D plan.
IGNORE: Walls, doors, windows, and all furniture.
${BASE_RULES}
EXPECTED JSON SCHEMA:
{
  "projectInfo": { "name": "Design & Build BIM", "estimatedArea": "m2" },
  "drawingCalibration": {
    "orientation": "landscape",
    "rotationDeg": 0,
    "buildingRoiNormalized": { "topY": 0.20, "leftX": 0.08, "bottomY": 0.95, "rightX": 0.98 },
    "buildingDimensionsM": { "widthM": 11.4, "depthM": 3.8 }
  },
  "floors": [ { "boundary": [[x, z], [x, z], [x, z], [x, z]], "level": 0, "material": "parquet" } ],
  "ceilings": [ { "boundary": [[x, z], [x, z], [x, z], [x, z]], "level": 0, "height": 2.8 } ],
  "zones": [ { "name": "Meeting Room", "boundary": [[x, z], [x, z], [x, z], [x, z]], "color": "#E0F2F1" } ]
}`;
}

export function getCorePrompt() {
  return `You are a Master Structural Engineer.
TASK: Extract ONLY the Walls, Partitions, Doors, and Windows.
IGNORE: All furniture, fixtures, and equipment.
${BASE_RULES}
EXPECTED JSON SCHEMA:
{
  "walls": [ { "id": "w1", "start": [x, z], "end": [x, z], "thickness": 0.2, "height": 2.8, "material": "white-plaster" } ],
  "openings": [ { "id": "d1", "type": "door", "pos": [x, z], "width": 0.9, "height": 2.1, "elevation": 0 } ]
}`;
}

export function getFitoutPrompt(wallsContext: any[]) {
  return `You are a Fit-Out Architect.
TASK: Extract ONLY the Fixed Furniture and Joinery (Fit-out package).
TARGETS: Kitchen cabinets, counters, sink cabinets, toilets, bathtubs, and built-in closets.
IGNORE: Loose FF&E items (desks, chairs, sofas) and structural elements.
${BASE_RULES}
CONTEXT: 
Ensure fixed furniture aligns against these mapped structural walls:
${JSON.stringify(wallsContext)}
EXPECTED JSON SCHEMA:
{
  "furniture": [ { "type": "kitchen-counter", "pos": [x, z], "rotation": 0, "width": 2.0, "depth": 0.6 } ]
}`;
}

export function getFFEPrompt(wallsContext: any[]) {
  return `You are an Interior AI Architect.
TASK: Count and map EVERY single piece of Loose FF&E (Furniture, Fixtures, & Equipment).
TARGETS: Office chairs, office tables, desks, sofas, lounge chairs, indoor plants.
IGNORE: Fixed furniture (kitchens, toilets) as they are a different package. Ignore walls and doors.
${BASE_RULES}
CONTEXT:
Ensure loose furniture is placed logically within these mapped walls:
${JSON.stringify(wallsContext)}
EXPECTED JSON SCHEMA:
{
  "furniture": [ { "type": "office-chair", "pos": [x, z], "rotation": 0, "width": 1.0, "depth": 1.0 } ]
}`;
}
