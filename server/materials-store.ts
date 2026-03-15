/**
 * Store uploaded PDFs/PPTX/videos/etc. by session id.
 * Resolves to rich context using Gemini Vision (Phase 1-3) when starting Live.
 */
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { extractFromBuffer } from './materials-extract';
import type { GoogleGenAI } from '@google/genai';
import {
  analyzePdfWithVision,
  analyzePdfChunked,
  analyzeImageWithVision,
  generateContextualUnderstanding,
  formatForContext,
  type VisionAnalysisResult,
} from './materials-vision';
import {
  processVideoMaterial,
  formatVideoForContext,
  isVideoMime,
  type VideoAnalysisResult,
} from './materials-video';

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'materials');
const MAX_CONTEXT_CHARS = 200_000; // increased from 100k for richer vision output

type ManifestFile = { name: string; storedName: string; mime: string; addedAt: string };
type Manifest = { files: ManifestFile[]; notes: string };

// Cache for analysis results to avoid re-processing
const analysisCache = new Map<string, VisionAnalysisResult | VideoAnalysisResult>();

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

function manifestPath(sessionId: string) {
  return path.join(UPLOAD_ROOT, sessionId, 'manifest.json');
}

function sessionDir(sessionId: string) {
  return path.join(UPLOAD_ROOT, sessionId);
}

export async function createMaterialsSession(): Promise<{ materialsId: string }> {
  const materialsId = randomUUID();
  await ensureDir(sessionDir(materialsId));
  const manifest: Manifest = { files: [], notes: '' };
  await writeFile(manifestPath(materialsId), JSON.stringify(manifest, null, 0), 'utf-8');
  return { materialsId };
}

export async function saveMaterialsNotes(materialsId: string, notes: string): Promise<void> {
  const mpath = manifestPath(materialsId);
  let manifest: Manifest = { files: [], notes: '' };
  try {
    manifest = JSON.parse(await readFile(mpath, 'utf-8')) as Manifest;
  } catch {
    return;
  }
  manifest.notes = notes.slice(0, 50_000);
  await writeFile(mpath, JSON.stringify(manifest, null, 0), 'utf-8');
}

export async function uploadMaterialFile(
  materialsId: string,
  buf: Buffer,
  originalName: string,
  mime: string,
): Promise<{ filename: string; error?: string }> {
  const dir = sessionDir(materialsId);
  await ensureDir(dir);
  const mpath = manifestPath(materialsId);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(mpath, 'utf-8')) as Manifest;
  } catch {
    manifest = { files: [], notes: '' };
  }

  const safeBase = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
  const storedName = `${Date.now()}_${safeBase}`;
  const filePath = path.join(dir, storedName);
  await writeFile(filePath, buf);
  manifest.files.push({
    name: originalName,
    storedName,
    mime: mime || 'application/octet-stream',
    addedAt: new Date().toISOString(),
  });
  await writeFile(mpath, JSON.stringify(manifest, null, 0), 'utf-8');
  return { filename: originalName };
}

export async function listMaterialFiles(materialsId: string): Promise<ManifestFile[]> {
  try {
    const manifest = JSON.parse(await readFile(manifestPath(materialsId), 'utf-8')) as Manifest;
    return manifest.files || [];
  } catch {
    return [];
  }
}

export async function removeMaterialFile(materialsId: string, storedName: string): Promise<void> {
  const dir = sessionDir(materialsId);
  const mpath = manifestPath(materialsId);
  try {
    const manifest = JSON.parse(await readFile(mpath, 'utf-8')) as Manifest;
    manifest.files = (manifest.files || []).filter(f => f.storedName !== storedName);
    await writeFile(mpath, JSON.stringify(manifest, null, 0), 'utf-8');
    await unlink(path.join(dir, storedName)).catch(() => {});
    // Clear cache for removed file
    analysisCache.delete(`${materialsId}/${storedName}`);
  } catch {
    /* ignore */
  }
}

/**
 * Build the materials string for system prompts using Gemini Vision.
 * PDFs and images are analyzed with native vision (sees diagrams, charts, equations).
 * Videos are transcribed and visually summarized.
 * Text/PPTX files use the legacy text extraction.
 *
 * @param onProgress - optional callback for per-file progress updates
 */
export async function resolveMaterialsContext(
  materialsId: string,
  ai?: GoogleGenAI,
  onProgress?: (filename: string, status: 'processing' | 'done' | 'error', current: number, total: number) => void,
): Promise<string> {
  const dir = sessionDir(materialsId);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath(materialsId), 'utf-8')) as Manifest;
  } catch {
    return '';
  }

  const parts: string[] = [];

  if (manifest.notes?.trim()) {
    parts.push('## Teacher notes (additional context)\n' + manifest.notes.trim());
  }

  const files = manifest.files || [];
  const total = files.length;

  // Process files in parallel with Promise.allSettled for robustness
  const results = await Promise.allSettled(
    files.map(async (f, idx) => {
      const cacheKey = `${materialsId}/${f.storedName}`;
      onProgress?.(f.name, 'processing', idx + 1, total);

      const filePath = path.join(dir, f.storedName);
      let buf: Buffer;
      try {
        buf = await readFile(filePath);
      } catch {
        onProgress?.(f.name, 'error', idx + 1, total);
        return null;
      }

      const lower = f.name.toLowerCase();
      const isPdf = f.mime === 'application/pdf' || lower.endsWith('.pdf');
      const isImage = f.mime.startsWith('image/');
      const isVideo = isVideoMime(f.mime);

      // ── Vision path (requires ai instance) ──
      if (ai && (isPdf || isImage || isVideo)) {
        // Check cache first
        const cached = analysisCache.get(cacheKey);
        if (cached) {
          onProgress?.(f.name, 'done', idx + 1, total);
          if ('transcription' in cached) return formatVideoForContext(cached);
          return formatForContext(cached as VisionAnalysisResult);
        }

        try {
          if (isVideo) {
            // Phase 3: Video processing
            const videoResult = await processVideoMaterial(ai, buf, f.name, f.mime);
            analysisCache.set(cacheKey, videoResult);
            onProgress?.(f.name, 'done', idx + 1, total);
            return formatVideoForContext(videoResult);
          }

          if (isPdf) {
            // Phase 1: PDF vision analysis
            // Get approximate page count for chunking decision
            let pageCount = 0;
            try {
              const { PDFParse } = await import('pdf-parse');
              const parser = new PDFParse({ data: new Uint8Array(buf) });
              const text = await parser.getText();
              // Rough page estimate: ~3000 chars per page
              pageCount = Math.max(1, Math.ceil((text?.text?.length || 0) / 3000));
              await parser.destroy().catch(() => {});
            } catch {
              pageCount = Math.ceil(buf.length / 50000); // rough estimate from file size
            }

            let visionResult: VisionAnalysisResult;
            if (pageCount > 30) {
              visionResult = await analyzePdfChunked(ai, buf, f.name, pageCount);
            } else {
              visionResult = await analyzePdfWithVision(ai, buf, f.name);
            }
            visionResult.pageCount = pageCount;

            // Phase 2: Contextual understanding (if enough content)
            if (visionResult.text.length > 200) {
              const conceptMap = await generateContextualUnderstanding(ai, visionResult);
              if (conceptMap) visionResult.conceptMap = conceptMap;
            }

            analysisCache.set(cacheKey, visionResult);
            onProgress?.(f.name, 'done', idx + 1, total);
            return formatForContext(visionResult);
          }

          if (isImage) {
            // Phase 1: Image vision analysis
            const imageResult = await analyzeImageWithVision(ai, buf, f.mime, f.name);
            analysisCache.set(cacheKey, imageResult);
            onProgress?.(f.name, 'done', idx + 1, total);
            return formatForContext(imageResult);
          }
        } catch (e: any) {
          console.error(`[Materials] Vision analysis failed for ${f.name}, falling back to text:`, e.message);
          // Fall through to legacy text extraction
        }
      }

      // ── Legacy text extraction path (PPTX, text files, or fallback) ──
      const result = await extractFromBuffer(buf, f.mime, f.name);
      onProgress?.(f.name, 'done', idx + 1, total);

      if (result.text?.trim()) {
        return `## Document: ${f.name}\n${result.text.trim()}`;
      } else if (result.error) {
        return `## Document: ${f.name}\n[Could not extract: ${result.error}]`;
      }
      return null;
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      parts.push(r.value);
    }
  }

  let combined = parts.join('\n\n---\n\n');
  if (combined.length > MAX_CONTEXT_CHARS) {
    combined = combined.slice(0, MAX_CONTEXT_CHARS) + '\n\n[… context truncated …]';
  }
  return combined;
}
