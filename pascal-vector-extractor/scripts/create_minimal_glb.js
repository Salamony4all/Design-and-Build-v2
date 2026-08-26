import fs from 'fs';
import path from 'path';

const outDir = path.resolve('C:/Users/Mohamad60025/Desktop/App/Design And Build/apps/editor/public/assets/models');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const jsonStr = '{"asset":{"version":"2.0"},"scenes":[{"nodes":[0]}],"nodes":[{"name":"OM-BED-SR-90X200"}]}';
const jsonBuffer = Buffer.from(jsonStr.padEnd(Math.ceil(jsonStr.length / 4) * 4, ' '), 'utf8');

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46544c47, 0); // "glTF"
header.writeUInt32LE(2, 4);          // version 2
header.writeUInt32LE(12 + 8 + jsonBuffer.length, 8); // total length

const chunkHeader = Buffer.alloc(8);
chunkHeader.writeUInt32LE(jsonBuffer.length, 0);
chunkHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

const glbBuffer = Buffer.concat([header, chunkHeader, jsonBuffer]);
const outFile = path.join(outDir, 'om_bed_sr_90x200.glb');
fs.writeFileSync(outFile, glbBuffer);
console.log('Created valid GLB model file at:', outFile);
