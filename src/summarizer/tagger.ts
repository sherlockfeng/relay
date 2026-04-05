import path from 'node:path';
import type { UnifiedTranscript } from '../types/index.js';

function hasExtension(files: string[], ext: string): boolean {
  const lower = ext.toLowerCase();
  return files.some((f) => f.toLowerCase().endsWith(lower));
}

/** Rule-based tag enrichment (platform, project basename, stack hints). */
export function enhanceTags(tags: string[], transcript: UnifiedTranscript): string[] {
  const out: string[] = [...tags];

  out.push(transcript.platform);

  if (transcript.project !== undefined && transcript.project.trim() !== '') {
    const base = path.basename(transcript.project.trim());
    if (base !== '' && base !== '.' && base !== path.sep) {
      out.push(base);
    }
  }

  const files = transcript.filesReferenced;
  if (hasExtension(files, '.tsx') || hasExtension(files, '.jsx')) {
    out.push('React');
  }
  if (hasExtension(files, '.py')) {
    out.push('Python');
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const t of out) {
    const key = t.trim();
    if (key === '') continue;
    const norm = key.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    deduped.push(key);
  }
  return deduped;
}
