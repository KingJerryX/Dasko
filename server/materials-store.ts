/**
 * Store uploaded PDFs/PPTX/etc. by session id; resolve to prompt text only when starting Live.
 */
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { extractFromBuffer } from './materials-extract';

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'materials');
const MAX_CONTEXT_CHARS = 100_000;

type ManifestFile = { name: string; storedName: string; mime: string; addedAt: string };
type Manifest = { files: ManifestFile[]; notes: string };

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
  } catch {
    /* ignore */
  }
}

/**
 * Build the materials string for system prompts: extract text from each stored file
 * and prepend document headers so students can refer to "the PDF" / "slide deck".
 */
export async function resolveMaterialsContext(materialsId: string): Promise<string> {
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

  for (const f of manifest.files || []) {
    const filePath = path.join(dir, f.storedName);
    let buf: Buffer;
    try {
      buf = await readFile(filePath);
    } catch {
      continue;
    }
    let result = await extractFromBuffer(buf, f.mime, f.name);
    if (!result.text && f.mime.startsWith('image/') && buf.length < 4 * 1024 * 1024) {
      // Image OCR path — duplicate of route logic; keep store self-contained by skipping here
      // or import ai — avoid circular deps; images in store without text stay as "[binary only]"
      if (!result.text) result = { text: `[Attached image: ${f.name} — no text extracted.]` };
    }
    if (result.text?.trim()) {
      parts.push(`## Document: ${f.name}\n${result.text.trim()}`);
    } else if (result.error) {
      parts.push(`## Document: ${f.name}\n[Could not extract text: ${result.error}]`);
    }
  }

  let combined = parts.join('\n\n---\n\n');
  if (combined.length > MAX_CONTEXT_CHARS) {
    combined = combined.slice(0, MAX_CONTEXT_CHARS) + '\n\n[… context truncated …]';
  }
  return combined;
}
