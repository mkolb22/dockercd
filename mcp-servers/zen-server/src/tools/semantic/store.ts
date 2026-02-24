/**
 * Vector Store
 * SQLite-backed storage for embeddings with similarity search
 */

import { BaseStore } from "../../core/store.js";
import type { CodeChunk, SearchResult } from "../../core/types.js";
import { cosineSimilarity, numberArrayToBytes, bytesToNumberArray } from "../../utils/vectors.js";

export class VectorStore extends BaseStore {
  constructor(dbPath: string) {
    super(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vec_chunks (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        file TEXT NOT NULL,
        language TEXT,
        kind TEXT,
        name TEXT,
        start_line INTEGER,
        end_line INTEGER,
        hash TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_vec_chunks_file ON vec_chunks(file);
      CREATE INDEX IF NOT EXISTS idx_vec_chunks_kind ON vec_chunks(kind);
      CREATE INDEX IF NOT EXISTS idx_vec_chunks_name ON vec_chunks(name);

      CREATE TABLE IF NOT EXISTS vec_embeddings (
        chunk_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        FOREIGN KEY (chunk_id) REFERENCES vec_chunks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS vec_file_hashes (
        file TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS vec_metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  addEmbeddings(
    items: Array<{ chunk: CodeChunk; embedding: number[] }>
  ): void {
    const fileHashes = new Map<string, string>();

    this.transaction(() => {
      for (const { chunk, embedding } of items) {
        // Insert chunk
        this.execute(
          `INSERT OR REPLACE INTO vec_chunks
           (id, content, file, language, kind, name, start_line, end_line, hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            chunk.id,
            chunk.content,
            chunk.metadata.file,
            chunk.metadata.language,
            chunk.metadata.kind,
            chunk.metadata.name,
            chunk.metadata.startLine,
            chunk.metadata.endLine,
            chunk.hash,
          ]
        );

        // Insert embedding as blob
        const buffer = numberArrayToBytes(embedding);
        this.execute(
          `INSERT OR REPLACE INTO vec_embeddings (chunk_id, embedding) VALUES (?, ?)`,
          [chunk.id, buffer]
        );

        fileHashes.set(chunk.metadata.file, chunk.hash);
      }

      // Update file hashes
      for (const [file, hash] of fileHashes) {
        this.execute(
          `INSERT OR REPLACE INTO vec_file_hashes (file, hash, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)`,
          [file, hash]
        );
      }
    });
  }

  search(options: {
    embedding: number[];
    limit?: number;
    threshold?: number;
    filter?: Record<string, string>;
  }): SearchResult[] {
    const { embedding, limit = 5, threshold = 0.3, filter } = options;

    let sql = `
      SELECT c.*, e.embedding
      FROM vec_chunks c
      JOIN vec_embeddings e ON c.id = e.chunk_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (filter?.language) {
      sql += ` AND c.language = ?`;
      params.push(filter.language);
    }
    if (filter?.path) {
      sql += ` AND c.file LIKE ?`;
      params.push(`%${filter.path}%`);
    }
    if (filter?.kind) {
      sql += ` AND c.kind = ?`;
      params.push(filter.kind);
    }

    const rows = this.query<Record<string, unknown>>(sql, params);

    // Calculate similarities
    const results: SearchResult[] = [];
    for (const row of rows) {
      const storedEmbedding = bytesToNumberArray(row.embedding as Buffer);
      const similarity = cosineSimilarity(embedding, storedEmbedding);

      if (similarity >= threshold) {
        results.push({
          id: row.id as string,
          content: row.content as string,
          metadata: {
            file: row.file as string,
            language: row.language as string,
            kind: row.kind as string,
            name: row.name as string,
            startLine: row.start_line as number,
            endLine: row.end_line as number,
          },
          similarity,
        });
      }
    }

    // Sort by similarity and limit
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  getFileHashes(): Record<string, string> {
    const rows = this.query<{ file: string; hash: string }>(
      `SELECT file, hash FROM vec_file_hashes`
    );

    const hashes: Record<string, string> = {};
    for (const row of rows) {
      hashes[row.file] = row.hash;
    }
    return hashes;
  }

  getChunkCount(): number {
    const row = this.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM vec_chunks`
    );
    return row?.count ?? 0;
  }

  getVectorStats(): {
    totalChunks: number;
    totalFiles: number;
    byLanguage: Record<string, number>;
    byKind: Record<string, number>;
    lastUpdated: string | null;
  } {
    const totalChunks = this.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM vec_chunks`
    )?.count ?? 0;

    const totalFiles = this.queryOne<{ count: number }>(
      `SELECT COUNT(DISTINCT file) as count FROM vec_chunks`
    )?.count ?? 0;

    const byLanguage: Record<string, number> = {};
    const langRows = this.query<{ language: string | null; count: number }>(
      `SELECT language, COUNT(*) as count FROM vec_chunks GROUP BY language`
    );
    for (const row of langRows) {
      byLanguage[row.language || "unknown"] = row.count;
    }

    const byKind: Record<string, number> = {};
    const kindRows = this.query<{ kind: string | null; count: number }>(
      `SELECT kind, COUNT(*) as count FROM vec_chunks GROUP BY kind`
    );
    for (const row of kindRows) {
      byKind[row.kind || "unknown"] = row.count;
    }

    const lastUpdated = this.queryOne<{ last: string | null }>(
      `SELECT MAX(updated_at) as last FROM vec_file_hashes`
    )?.last ?? null;

    return {
      totalChunks,
      totalFiles,
      byLanguage,
      byKind,
      lastUpdated,
    };
  }

  clearVectors(): void {
    this.db.exec(`
      DELETE FROM vec_embeddings;
      DELETE FROM vec_chunks;
      DELETE FROM vec_file_hashes;
    `);
  }
}
