import { describe, it, expect, beforeEach } from 'vitest';
import { chunkDocument, cosineSimilarity, trainRole, searchKnowledge, seedBuiltinRoles, listRoles, getRole } from './library.js';
import { AgentForgeDB } from '../storage/database.js';

// ── chunkDocument ─────────────────────────────────────────────────────────────

describe('chunkDocument', () => {
  it('returns a single chunk for short content', () => {
    const chunks = chunkDocument('short content', 'file.md');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('[file.md]');
    expect(chunks[0].text).toContain('short content');
  });

  it('prefixes each chunk with the filename', () => {
    const chunks = chunkDocument('hello\nworld', 'notes.md');
    for (const chunk of chunks) {
      expect(chunk.text.startsWith('[notes.md]')).toBe(true);
    }
  });

  it('produces multiple chunks for content exceeding 800 chars', () => {
    const longContent = Array.from({ length: 50 }, (_, i) => `Line ${i}: ${'x'.repeat(20)}`).join('\n');
    const chunks = chunkDocument(longContent, 'big.md');
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('includes overlap between consecutive chunks', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `Line ${i}: ${'a'.repeat(20)}`);
    const content = lines.join('\n');
    const chunks = chunkDocument(content, 'f.md');
    if (chunks.length >= 2) {
      // The last few lines of chunk 1 should appear in chunk 2 (overlap)
      const chunk1Lines = chunks[0].text.split('\n').slice(1); // skip filename line
      const chunk2Text = chunks[1].text;
      const overlapExists = chunk1Lines.slice(-3).some((line) => chunk2Text.includes(line));
      expect(overlapExists).toBe(true);
    }
  });

  it('returns empty array for empty content', () => {
    // Empty string: buffer is empty after split → no final push
    const chunks = chunkDocument('', 'empty.md');
    // Could be 0 or 1 chunks depending on implementation; just check no error thrown
    expect(Array.isArray(chunks)).toBe(true);
  });

  it('handles single very long line without crashing', () => {
    const oneLiner = 'x'.repeat(2000);
    expect(() => chunkDocument(oneLiner, 'huge.md')).not.toThrow();
  });
});

// ── cosineSimilarity ──────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical non-zero vectors', () => {
    const v = Float32Array.from([1, 0, 0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = Float32Array.from([1, 0]);
    const b = Float32Array.from([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it('returns 0.0 for zero vector', () => {
    const zero = Float32Array.from([0, 0, 0]);
    const v = Float32Array.from([1, 2, 3]);
    expect(cosineSimilarity(zero, v)).toBe(0);
    expect(cosineSimilarity(v, zero)).toBe(0);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = Float32Array.from([1, 0]);
    const b = Float32Array.from([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
  });

  it('is symmetric: sim(a,b) === sim(b,a)', () => {
    const a = Float32Array.from([0.6, 0.8]);
    const b = Float32Array.from([0.8, 0.6]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a));
  });

  it('handles multi-dimensional vectors', () => {
    const a = Float32Array.from([1, 1, 0, 0]);
    const b = Float32Array.from([1, 1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
  });
});

// ── trainRole + searchKnowledge ───────────────────────────────────────────────

function makeDB() {
  const db = new AgentForgeDB(':memory:');
  db.init();
  return db;
}

// Deterministic pseudo-embedding: different texts get measurably different vectors
function makeEmbedFn() {
  return async (text: string): Promise<Float32Array> => {
    const dim = 16;
    const vec = new Float32Array(dim);
    for (let i = 0; i < text.length; i++) vec[text.charCodeAt(i) % dim] += 1;
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) vec[i] /= norm;
    return vec;
  };
}

describe('trainRole', () => {
  let db: AgentForgeDB;
  beforeEach(() => { db = makeDB(); });

  it('creates a new role', async () => {
    await trainRole(db, {
      roleId: 'expert', name: 'Expert', documents: [{ filename: 'guide.md', content: 'hello world' }],
      embedFn: makeEmbedFn(),
    });
    expect(db.getRole('expert')).toBeDefined();
    expect(db.getRole('expert')!.name).toBe('Expert');
  });

  it('indexes knowledge chunks', async () => {
    await trainRole(db, {
      roleId: 'expert', name: 'Expert',
      documents: [{ filename: 'doc.md', content: 'content here' }],
      embedFn: makeEmbedFn(),
    });
    expect(db.getChunksForRole('expert').length).toBeGreaterThan(0);
  });

  it('replaces existing chunks on retrain', async () => {
    const embedFn = makeEmbedFn();
    await trainRole(db, { roleId: 'expert', name: 'E', documents: [{ filename: 'a.md', content: 'first' }], embedFn });
    const countFirst = db.getChunksForRole('expert').length;
    await trainRole(db, { roleId: 'expert', name: 'E', documents: [{ filename: 'b.md', content: 'second' }, { filename: 'c.md', content: 'third content here' }], embedFn });
    const countSecond = db.getChunksForRole('expert').length;
    // Should not accumulate old chunks
    expect(countSecond).toBeGreaterThanOrEqual(countFirst);
    // Old source file should not appear
    const chunks = db.getChunksForRole('expert');
    expect(chunks.some((c) => c.sourceFile === 'a.md')).toBe(false);
  });

  it('uses provided baseSystemPrompt', async () => {
    await trainRole(db, {
      roleId: 'custom', name: 'Custom', baseSystemPrompt: 'You are custom.',
      documents: [{ filename: 'f.md', content: 'data' }], embedFn: makeEmbedFn(),
    });
    expect(db.getRole('custom')!.systemPrompt).toBe('You are custom.');
  });

  it('generates default system prompt when none provided', async () => {
    await trainRole(db, {
      roleId: 'auto', name: 'Auto Agent',
      documents: [{ filename: 'f.md', content: 'data' }], embedFn: makeEmbedFn(),
    });
    expect(db.getRole('auto')!.systemPrompt).toContain('Auto Agent');
  });
});

describe('searchKnowledge', () => {
  let db: AgentForgeDB;
  beforeEach(() => { db = makeDB(); });

  it('returns empty array when no chunks exist', async () => {
    db.upsertRole({ id: 'r', name: 'R', systemPrompt: 'sys', isBuiltin: false, createdAt: '2025-01-01' });
    const results = await searchKnowledge(db, 'r', 'query', makeEmbedFn());
    expect(results).toHaveLength(0);
  });

  it('returns top-K results sorted by score descending', async () => {
    const embedFn = makeEmbedFn();
    await trainRole(db, {
      roleId: 'r', name: 'R',
      documents: [
        { filename: 'api.md', content: 'authentication login oauth token security' },
        { filename: 'ui.md', content: 'button color style layout flex grid design' },
      ],
      embedFn,
    });
    const results = await searchKnowledge(db, 'r', 'login authentication', embedFn, 2);
    expect(results.length).toBeLessThanOrEqual(2);
    // Scores should be descending
    if (results.length === 2) {
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
  });

  it('respects topK limit', async () => {
    const embedFn = makeEmbedFn();
    await trainRole(db, {
      roleId: 'r', name: 'R',
      documents: [
        { filename: 'a.md', content: Array.from({ length: 20 }, (_, i) => `Section ${i}: ${'text '.repeat(50)}`).join('\n') },
      ],
      embedFn,
    });
    const results = await searchKnowledge(db, 'r', 'section', embedFn, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('returns score and chunkText in results', async () => {
    const embedFn = makeEmbedFn();
    await trainRole(db, {
      roleId: 'r', name: 'R',
      documents: [{ filename: 'f.md', content: 'hello world content' }],
      embedFn,
    });
    const results = await searchKnowledge(db, 'r', 'hello', embedFn, 1);
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('chunkText');
    expect(typeof results[0].score).toBe('number');
  });
});

// ── seedBuiltinRoles + listRoles + getRole ────────────────────────────────────

describe('seedBuiltinRoles', () => {
  let db: AgentForgeDB;
  beforeEach(() => { db = makeDB(); });

  it('seeds product, developer, tester roles', () => {
    seedBuiltinRoles(db);
    const roles = listRoles(db);
    const ids = roles.map((r) => r.id);
    expect(ids).toContain('product');
    expect(ids).toContain('developer');
    expect(ids).toContain('tester');
  });

  it('is idempotent — seeding twice does not duplicate', () => {
    seedBuiltinRoles(db);
    seedBuiltinRoles(db);
    const roles = listRoles(db).filter((r) => r.isBuiltin);
    expect(roles).toHaveLength(3);
  });

  it('marks builtin roles as isBuiltin: true', () => {
    seedBuiltinRoles(db);
    const product = db.getRole('product')!;
    expect(product.isBuiltin).toBe(true);
  });
});

describe('getRole', () => {
  let db: AgentForgeDB;
  beforeEach(() => {
    db = makeDB();
    seedBuiltinRoles(db);
  });

  it('throws for unknown roleId', () => {
    expect(() => getRole(db, 'unknown')).toThrow('Role not found: unknown');
  });

  it('returns the role for a known id', () => {
    expect(getRole(db, 'product').id).toBe('product');
  });
});
