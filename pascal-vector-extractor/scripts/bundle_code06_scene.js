import fs from 'fs';
import path from 'path';

const srcJson = path.resolve('C:/Users/Mohamad60025/.gemini/antigravity-ide/brain/d2d742db-4c1b-49a3-8eec-08e435517be0/scratch/CODE_06_pascal_scene.json');
const destTs = path.resolve('C:/Users/Mohamad60025/Desktop/App/Design And Build/apps/editor/src/lib/stamp/code06ConfirmedScene.ts');

const jsonData = JSON.parse(fs.readFileSync(srcJson, 'utf8'));

const tsContent = `// Confirmed CODE-06 Pascal Scene DTO Fixture
export const CODE06_CONFIRMED_SCENE_JSON = ${JSON.stringify(jsonData, null, 2)} as const;
`;

fs.writeFileSync(destTs, tsContent, 'utf8');
console.log('Bundled CODE06_CONFIRMED_SCENE_JSON into:', destTs);
