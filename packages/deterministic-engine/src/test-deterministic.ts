import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { PolymorphicRouter } from './router';
import { CrossReferenceCompiler } from './compiler';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTest() {
  console.log('=== STARTING INTEGRATION VERIFICATION FOR DETAILED DETERMINISTIC ENGINE (TRACK 2) ===');
  
  // 1. Setup paths
  const realtimePdfPath = path.join(__dirname, '../realtime_test.pdf');
  const realtimePngPath = path.join(__dirname, '../realtime_test.png');
  
  const dummyPdfPath = path.join(__dirname, '../mock_blueprint.pdf');
  const dummyPngPath = path.join(__dirname, '../mock_blueprint.png');
  const testIfcPath = path.join(__dirname, '../test_export.ifc');

  // Find correct python executable (our newly set up virtualenv)
  const pythonPath = path.join(__dirname, '../../../.venv/Scripts/python.exe');
  const hasVenv = fs.existsSync(pythonPath);
  const cmd = hasVenv ? pythonPath : 'python';

  let pdfPathToLoad = dummyPdfPath;
  let pngPathToLoad = dummyPngPath;

  try {
    if (fs.existsSync(realtimePdfPath)) {
      console.log(`[Test] Real-time PDF drawing detected at: ${realtimePdfPath}. Skipping dummy generation.`);
      pdfPathToLoad = realtimePdfPath;
    } else {
      // Generate structurally valid vector PDF using PyMuPDF
      console.log('[Test] Generating structurally valid vector PDF using PyMuPDF...');
      await new Promise<void>((resolve, reject) => {
        const pyCode = `
import fitz
doc = fitz.open()
p = doc.new_page()
p.draw_line(fitz.Point(100, 100), fitz.Point(400, 100))
p.draw_line(fitz.Point(400, 100), fitz.Point(400, 400))
p.draw_line(fitz.Point(400, 400), fitz.Point(100, 400))
p.draw_line(fitz.Point(100, 400), fitz.Point(100, 100))
p.draw_bezier(fitz.Point(100, 250), fitz.Point(175, 300), fitz.Point(225, 200), fitz.Point(300, 250))
p.draw_line(fitz.Point(300, 250), fitz.Point(400, 250))
p.insert_text(fitz.Point(200, 175), "Desk 1200x600")
doc.save(r"${dummyPdfPath}")
`;
        const process = spawn(cmd, ['-c', pyCode]);
        let stderr = '';
        process.stderr.on('data', (d) => stderr += d.toString());
        process.on('close', (code) => {
          if (code !== 0) reject(new Error(`Failed to generate mock PDF: ${stderr}`));
          else resolve();
        });
      });
      console.log(`[Test] Created dummy PDF at: ${dummyPdfPath}`);
    }

    const pdfBuffer = await fs.promises.readFile(pdfPathToLoad);

    if (fs.existsSync(realtimePngPath)) {
      console.log(`[Test] Real-time PNG drawing detected at: ${realtimePngPath}. Skipping dummy generation.`);
      pngPathToLoad = realtimePngPath;
    } else {
      // Generate a dummy PNG text buffer (non-PDF is treated as Raster)
      await fs.promises.writeFile(dummyPngPath, Buffer.from('MOCK_PNG_DATA'));
      console.log(`[Test] Created dummy PNG at: ${dummyPngPath}`);
    }

    const pngBuffer = await fs.promises.readFile(pngPathToLoad);

    const router = new PolymorphicRouter();
    const compiler = new CrossReferenceCompiler();

    // Setup dummy grid alignment
    const gridIntersections: Array<[number, number]> = [[5.0, 5.0], [10.0, 10.0]];
    const verticalSections = [
      { gridRef: 'FFL', elevation: 0.15 },
      { gridRef: 'CEILING', elevation: 2.95 }
    ];
    const gridAlignment = compiler.alignGridAndLevels(gridIntersections, verticalSections);

    // ==========================================
    // TRACK 1: VECTOR PDF TEST RUN
    // ==========================================
    console.log('\n--- E2E TEST RUN 1: VECTOR PDF ---');
    
    const isVectorSniffed = PolymorphicRouter.sniffIsVectorPdf(pdfBuffer, 'application/pdf');
    console.log(`[Test] Vector PDF Sniffer: ${isVectorSniffed}`);

    const vectorResult = await router.route(pdfBuffer, 'application/pdf');
    console.log(`[Test] Routed Track: ${vectorResult.track}`);
    console.log(`[Test] Primitives count: ${vectorResult.vectorPrimitives.length}`);
    
    const vectorPayload = compiler.compile(vectorResult, gridAlignment);
    console.log(`[Test] Compiled shell walls count: ${vectorPayload.shell.walls.length}`);
    console.log(`[Test] Compiled joinery fixedFixtures count: ${vectorPayload.joinery.fixedFixtures.length}`);

    // Compile vector output to IFC
    await compileIfc(cmd, vectorPayload, testIfcPath);
    console.log(`[Test] Generated Vector IFC successfully. File size: ${fs.statSync(testIfcPath).size} bytes`);
    await fs.promises.unlink(testIfcPath); // remove for next run
    if (vectorResult.fallbackRasterPath && fs.existsSync(vectorResult.fallbackRasterPath)) {
      await fs.promises.unlink(vectorResult.fallbackRasterPath).catch(() => {});
    }

    // ==========================================
    // TRACK 2: RASTER IMAGE TEST RUN
    // ==========================================
    console.log('\n--- E2E TEST RUN 2: RASTER IMAGE (PNG) ---');

    const isImageSniffed = PolymorphicRouter.sniffIsVectorPdf(pngBuffer, 'image/png');
    console.log(`[Test] Raster Image Sniffer: ${isImageSniffed}`);

    const rasterResult = await router.route(pngBuffer, 'image/png');
    console.log(`[Test] Routed Track: ${rasterResult.track}`);
    console.log(`[Test] Symbols detected: ${rasterResult.detectedSymbols.length}`);

    const rasterPayload = compiler.compile(rasterResult, gridAlignment);
    console.log(`[Test] Compiled core slabs count: ${rasterPayload.core.slabs.length}`);
    console.log(`[Test] Compiled ffe looseFurniture count: ${rasterPayload.ffe.looseFurniture.length}`);

    // Compile raster output to IFC
    await compileIfc(cmd, rasterPayload, testIfcPath);
    console.log(`[Test] Generated Raster IFC successfully. File size: ${fs.statSync(testIfcPath).size} bytes`);

    console.log('\n=== ALL E2E VERIFICATIONS COMPLETED SUCCESSFULLY ===');
    console.log('Both PDF and PNG/JPEG tracks run cleanly through Router -> Compiler -> IFC generation.');

  } finally {
    // Cleanup files (do not delete the user's real-time files!)
    if (fs.existsSync(dummyPdfPath)) await fs.promises.unlink(dummyPdfPath).catch(() => {});
    if (fs.existsSync(dummyPngPath)) await fs.promises.unlink(dummyPngPath).catch(() => {});
    if (fs.existsSync(testIfcPath)) await fs.promises.unlink(testIfcPath).catch(() => {});
  }
}

async function compileIfc(pythonPath: string, payload: any, outputIfcPath: string) {
  const pythonScript = path.join(__dirname, '../python/ifc_compiler.py');
  const tempDir = os.tmpdir();
  const tempJsonPath = path.join(tempDir, `pascal_scene_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.json`);

  await fs.promises.writeFile(tempJsonPath, JSON.stringify(payload));

  try {
    await new Promise<void>((resolve, reject) => {
      const process = spawn(pythonPath, [pythonScript, outputIfcPath, tempJsonPath]);
      
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (d) => stdout += d.toString());
      process.stderr.on('data', (d) => stderr += d.toString());

      process.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`IFC compiler exited with code ${code}. Error: ${stderr}`));
          return;
        }
        resolve();
      });
    });
  } finally {
    if (fs.existsSync(tempJsonPath)) {
      await fs.promises.unlink(tempJsonPath).catch(() => {});
    }
  }
}

runTest().catch((err) => {
  console.error('\n=== INTEGRATION VERIFICATION FAILED ===');
  console.error(err);
  process.exit(1);
});
