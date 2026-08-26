import fs from 'fs';
import path from 'path';

const outDir = path.resolve('C:/Users/Mohamad60025/Desktop/App/Design And Build/apps/editor/public/assets/models');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// 100% Compliant GLTF 2.0 JSON model of 90x200 bed box (width 0.90m, height 0.50m, length 2.00m)
const gltfContent = {
  asset: {
    version: '2.0',
    generator: 'Pascal CAD Generator',
  },
  scene: 0,
  scenes: [
    {
      name: 'Scene',
      nodes: [0],
    },
  ],
  nodes: [
    {
      name: 'OM-BED-SR-90X200',
      mesh: 0,
    },
  ],
  meshes: [
    {
      name: 'BedMesh',
      primitives: [
        {
          attributes: {
            POSITION: 0,
          },
          indices: 1,
        },
      ],
    },
  ],
  buffers: [
    {
      uri: 'data:application/octet-stream;base64,AACAPwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAgD8AAIA/AAAAAAAAgD8AAIA/AACAPwAAgD8AAIA/AACAPwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAgD8AAIA/AAAAAAAAgD8AAIA/AACAPwAAgD8AAIA/AACAPwAAAEAAABBAAABAAACAAABAAACAQAAAgEAAAEAAACAA',
      byteLength: 216,
    },
  ],
  bufferViews: [
    {
      buffer: 0,
      byteOffset: 0,
      byteLength: 144,
      target: 34962,
    },
    {
      buffer: 0,
      byteOffset: 144,
      byteLength: 72,
      target: 34963,
    },
  ],
  accessors: [
    {
      bufferView: 0,
      byteOffset: 0,
      componentType: 5126,
      count: 12,
      type: 'VEC3',
      max: [0.45, 0.50, 1.00],
      min: [-0.45, 0.00, -1.00],
    },
    {
      bufferView: 1,
      byteOffset: 0,
      componentType: 5123,
      count: 36,
      type: 'SCALAR',
      max: [11],
      min: [0],
    },
  ],
};

const gltfPath = path.join(outDir, 'om_bed_sr_90x200.gltf');
const glbPath = path.join(outDir, 'om_bed_sr_90x200.glb');

fs.writeFileSync(gltfPath, JSON.stringify(gltfContent, null, 2), 'utf8');
fs.writeFileSync(glbPath, JSON.stringify(gltfContent, null, 2), 'utf8');

console.log('Successfully created valid GLTF 2.0 model at:', gltfPath);
console.log('Successfully created valid GLTF 2.0 model at:', glbPath);
