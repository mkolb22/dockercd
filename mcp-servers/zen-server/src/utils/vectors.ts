/**
 * Vector Utilities
 * Shared vector operations for embeddings
 */

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Convert Float32Array to Buffer for SQLite storage
 */
export function float32ToBytes(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/**
 * Convert Buffer back to Float32Array
 */
export function bytesToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

/**
 * Convert number[] to Buffer
 */
export function numberArrayToBytes(arr: number[]): Buffer {
  return float32ToBytes(new Float32Array(arr));
}

/**
 * Convert Buffer to number[]
 */
export function bytesToNumberArray(buf: Buffer): number[] {
  return Array.from(bytesToFloat32(buf));
}

/**
 * Normalize a vector to unit length
 */
export function normalizeVector(v: number[]): number[] {
  let norm = 0;
  for (const x of v) {
    norm += x * x;
  }
  norm = Math.sqrt(norm);

  if (norm === 0) return v;

  return v.map(x => x / norm);
}

/**
 * Compute average of multiple vectors
 */
export function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];

  const dims = vectors[0].length;
  const result = new Array(dims).fill(0);

  for (const v of vectors) {
    for (let i = 0; i < dims; i++) {
      result[i] += v[i];
    }
  }

  for (let i = 0; i < dims; i++) {
    result[i] /= vectors.length;
  }

  return result;
}
