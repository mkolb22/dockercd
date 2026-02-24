/**
 * Tool Dispatcher
 * Centralized tool routing with timeout wrappers and fluent registration
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolModule, ToolResponse } from "./types.js";
import type { ToolAnnotation } from "./annotations.js";

/**
 * Handler function type
 */
export type HandlerFn = (args: Record<string, unknown>) => Promise<ToolResponse>;

/**
 * Handler with metadata
 */
interface RegisteredHandler {
  fn: HandlerFn;
  timeout: number;
  annotation?: ToolAnnotation;
}

/**
 * Default timeouts
 */
export const Timeouts = {
  quick: 5000,      // 5s for simple queries
  default: 30000,   // 30s for standard operations
  long: 120000,     // 2min for complex operations
  veryLong: 300000, // 5min for indexing/analysis
};

/**
 * Wrap a handler with timeout
 */
function withTimeout(fn: HandlerFn, timeoutMs: number): HandlerFn {
  return async (args: Record<string, unknown>): Promise<ToolResponse> => {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        fn(args),
        new Promise<ToolResponse>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Tool timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
    } finally {
      clearTimeout(timer!);
    }
  };
}

/**
 * Tool Dispatcher
 * Manages tool registration and dispatch with fluent API
 */
export class Dispatcher {
  private handlers: Map<string, RegisteredHandler> = new Map();

  /**
   * Register a handler with default timeout
   */
  register(name: string, fn: HandlerFn, annotation?: ToolAnnotation): this {
    return this.registerWithTimeout(name, fn, Timeouts.default, annotation);
  }

  /**
   * Register with quick timeout (5s)
   */
  registerQuick(name: string, fn: HandlerFn, annotation?: ToolAnnotation): this {
    return this.registerWithTimeout(name, fn, Timeouts.quick, annotation);
  }

  /**
   * Register with long timeout (2min)
   */
  registerLong(name: string, fn: HandlerFn, annotation?: ToolAnnotation): this {
    return this.registerWithTimeout(name, fn, Timeouts.long, annotation);
  }

  /**
   * Register with very long timeout (5min)
   */
  registerVeryLong(name: string, fn: HandlerFn, annotation?: ToolAnnotation): this {
    return this.registerWithTimeout(name, fn, Timeouts.veryLong, annotation);
  }

  /**
   * Register with custom timeout
   */
  registerWithTimeout(
    name: string,
    fn: HandlerFn,
    timeout: number,
    annotation?: ToolAnnotation
  ): this {
    this.handlers.set(name, {
      fn: withTimeout(fn, timeout),
      timeout,
      annotation,
    });
    return this;
  }

  /**
   * Dispatch a tool call
   */
  async dispatch(name: string, args: Record<string, unknown>): Promise<ToolResponse> {
    const handler = this.handlers.get(name);
    if (!handler) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }
    return handler.fn(args);
  }

  /**
   * Check if a tool is registered
   */
  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Get all registered tool names
   */
  names(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get annotation for a tool
   */
  getAnnotation(name: string): ToolAnnotation | undefined {
    return this.handlers.get(name)?.annotation;
  }

  /**
   * Get handler count
   */
  get size(): number {
    return this.handlers.size;
  }
}

/**
 * Create a new dispatcher
 */
export function createDispatcher(): Dispatcher {
  return new Dispatcher();
}

/**
 * Create a standard module export from tools array and dispatcher.
 * Replaces the repeated handleToolCall + module export boilerplate.
 */
export function createModule(tools: Tool[], dispatcher: Dispatcher): ToolModule {
  return {
    tools,
    handleToolCall: (name: string, args: Record<string, unknown>) =>
      dispatcher.dispatch(name, args),
  };
}
