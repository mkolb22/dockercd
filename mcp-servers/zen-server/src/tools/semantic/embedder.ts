/**
 * Embedding Model
 * Generates vector embeddings using local models or OpenAI
 */

import { pipeline } from "@huggingface/transformers";

export class EmbeddingModel {
  private modelName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private embeddingPipeline: any = null;
  private initialized = false;

  constructor(modelName: string = "local") {
    this.modelName = modelName;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.modelName === "local") {
      // Use local transformer model (Hugging Face model hub)
      this.embeddingPipeline = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2"
      );
    } else if (this.modelName === "openai") {
      // OpenAI embeddings handled in embed method
    } else {
      throw new Error(`Unknown embedding model: ${this.modelName}`);
    }

    this.initialized = true;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.modelName === "local" && this.embeddingPipeline) {
      return this.embedLocal(text);
    } else if (this.modelName === "openai") {
      return this.embedOpenAI(text);
    }

    throw new Error("Embedding model not initialized");
  }

  private async embedLocal(text: string): Promise<number[]> {
    if (!this.embeddingPipeline) {
      throw new Error("Pipeline not initialized");
    }

    // Truncate text if too long (model max ~512 tokens)
    const maxLength = 2000;
    const truncatedText = text.length > maxLength ? text.substring(0, maxLength) : text;

    const result = await this.embeddingPipeline(truncatedText, {
      pooling: "mean",
      normalize: true,
    });

    // Convert to plain array - handle Tensor output from transformers v3
    const data = (result as { data: Float32Array }).data;
    return Array.from(data);
  }

  private async embedOpenAI(text: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY environment variable required for OpenAI embeddings"
      );
    }

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data[0].embedding;
  }

  getDimensions(): number {
    if (this.modelName === "local") {
      return 384; // all-MiniLM-L6-v2
    } else if (this.modelName === "openai") {
      return 1536; // text-embedding-3-small
    }
    return 384;
  }
}
