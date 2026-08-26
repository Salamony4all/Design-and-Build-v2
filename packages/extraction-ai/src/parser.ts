// packages/extraction-ai/src/parser.ts
// VERBATIM PRESERVATION of parseAIResponse from
// apps/editor/src/lib/orchestration/gemini-pipeline.ts (freeze sha256 c588b796…).
// §5: exact sanitization chain — control-char strip → bullet strip → brace
// extraction → key-quoting repair → balanced-block scan → JSON.parse →
// trailing-comma repair → Function-eval fallback → Zod validation.
// Do NOT replace with a generic implementation (parity requirement).

import { StructuralSchema, type StructuralSchemaType } from './schema';

export function parseAIResponse(text: string): StructuralSchemaType {
  // Clean control characters
  let cleanedText = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  cleanedText = cleanedText.replace(/^\s*\*\s*/gm, "");

  const firstBrace = cleanedText.indexOf('{');
  const lastBrace = cleanedText.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("No JSON structure found in AI response. The model may have returned only text.");
  }

  const potentialJson = cleanedText.substring(firstBrace, lastBrace + 1);

  let sanitizedJson = potentialJson
    .replace(/^\s*\*\s*/gm, "")
    .replace(/^[ \t]*[-+•]\s*/gm, "")
    .replace(/\\n/g, " ")
    .trim();

  // Ensure keys are double-quoted if they aren't
  sanitizedJson = sanitizedJson.replace(/^(\s*)(\w+):(\s*\{)/gm, '$1"$2":$3');
  sanitizedJson = sanitizedJson.replace(/^(\s*)(\w+):(\s*\[)/gm, '$1"$2":$3');

  const blocks: string[] = [];
  let startIdx = -1;
  let braceCount = 0;

  for (let i = 0; i < sanitizedJson.length; i++) {
    if (sanitizedJson[i] === '{') {
      if (braceCount === 0) startIdx = i;
      braceCount++;
    } else if (sanitizedJson[i] === '}') {
      braceCount--;
      if (braceCount === 0 && startIdx !== -1) {
        blocks.push(sanitizedJson.substring(startIdx, i + 1));
        startIdx = -1;
      }
    }
  }

  if (blocks.length === 0) throw new Error("No JSON objects found in AI response.");

  const sortedBlocks = blocks.sort((a, b) => b.length - a.length);

  let parsedData: any = null;
  for (const block of sortedBlocks) {
    try {
      parsedData = JSON.parse(block);
      break;
    } catch {
      try {
        const sanitized = block.replace(/,\s*([\]}])/g, '$1');
        parsedData = JSON.parse(sanitized);
        break;
      } catch {
        try {
          parsedData = new Function(`return (${block})`)();
          break;
        } catch {
          continue;
        }
      }
    }
  }

  if (!parsedData) throw new Error("AI returned multiple objects, but none were valid JSON structure.");

  try {
    return StructuralSchema.parse(parsedData);
  } catch (zodError: any) {
    console.error("Zod Validation Error:", zodError);
    throw new Error("AI returned data that did not match the expected structural schema. " + zodError.errors.map((e: any) => e.message).join(", "));
  }
}
