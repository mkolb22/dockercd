/**
 * Shared EmbeddingModel Singleton
 * Shared embedder singleton across memory and semantic modules
 */

import { createLazyLoader } from "./lazy.js";
import { EmbeddingModel } from "../tools/semantic/embedder.js";
import { config } from "../core/config.js";

export const getSharedEmbedder = createLazyLoader(() => {
  const cfg = config();
  const model =
    cfg.embeddingModel === "all-MiniLM-L6-v2" ? "local" : cfg.embeddingModel;
  return new EmbeddingModel(model);
});
