export type Axis = 'H' | 'V';
export type TraceStatus = 'confirmed' | 'unresolved' | 'rejected';
export type VectorClass = 'wall' | 'structure' | 'partition' | 'unclassified';

export interface WorldTransform {
  pixelsPerMeter: number;
  roiPixelOrigin: [number, number];
  roiWorldOrigin: [number, number];
}

export interface RawMaximalLine {
  id: string;
  axis: Axis;
  coordinateM: number;
  startM: number;
  endM: number;
  detectorConfigId: string;
  source: 'guide' | 'pdf-vector';
  sourceId?: string;
  confidence: number;
  vectorClass?: 'wall' | 'structure' | 'partition' | 'unclassified';
}

export interface MaximalFace {
  id: string;
  axis: Axis;
  coordinateM: number;
  startM: number;
  endM: number;
  lengthM: number;
  configurationSupport: number;
  sourceIds: string[];
  confidence: number;
  status: TraceStatus;
}

export interface WallBand {
  id: string;
  axis: Axis;
  nearFace: MaximalFace;
  farFace: MaximalFace;
  centerlineStart: [number, number];
  centerlineEnd: [number, number];
  thicknessM: number;
  overlapRatio: number;
  confidence: number;
  componentId?: string;
  sourceIds: string[];
  status: TraceStatus;
}

export interface TraceJunction {
  id: string;
  point: [number, number];
  incidentBandIds: string[];
}

export interface HostedGap {
  id: string;
  hostBandId: string;
  startAlongM: number;
  endAlongM: number;
  widthM: number;
  classification: 'door' | 'window' | 'open-passage' | 'unresolved';
  connectedSpaceIds: string[];
  confidence: number;
}

export interface GuideTraceGraph {
  faces: MaximalFace[];
  wallBands: WallBand[];
  acceptedBands: WallBand[];
  rejectedBands: WallBand[];
  junctions: TraceJunction[];
  hostedGaps: HostedGap[];
  metrics: {
    rawLineCount: number;
    maximalFaceCount: number;
    wallBandCount: number;
    acceptedBandCount: number;
    graphComponentCount: number;
    principalComponentRate: number;
    endpointSupportRate: number;
    danglingEndpointCount: number;
  };
}
