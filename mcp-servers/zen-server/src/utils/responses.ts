/**
 * Response formatting utilities for tool handlers
 */

import type { ToolResponse } from "../core/types.js";

/**
 * Format a successful tool response
 */
export function successResponse(data: unknown): ToolResponse {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Format an error tool response
 */
export function errorResponse(message: string): ToolResponse {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Type-safe argument extraction helpers
 */
export const args = {
  string(a: Record<string, unknown>, key: string, defaultValue?: string): string {
    const value = a[key];
    if (value === undefined || value === null) {
      if (defaultValue !== undefined) return defaultValue;
      throw new Error(`Missing required argument: ${key}`);
    }
    return String(value);
  },

  stringOptional(a: Record<string, unknown>, key: string): string | undefined {
    const value = a[key];
    return value !== undefined && value !== null ? String(value) : undefined;
  },

  number(a: Record<string, unknown>, key: string, defaultValue: number): number {
    const value = a[key];
    return typeof value === "number" ? value : defaultValue;
  },

  numberOptional(a: Record<string, unknown>, key: string): number | undefined {
    const value = a[key];
    return typeof value === "number" ? value : undefined;
  },

  boolean(a: Record<string, unknown>, key: string, defaultValue: boolean): boolean {
    const value = a[key];
    return typeof value === "boolean" ? value : defaultValue;
  },

  booleanOptional(a: Record<string, unknown>, key: string): boolean | undefined {
    const value = a[key];
    return typeof value === "boolean" ? value : undefined;
  },

  array<T = string>(a: Record<string, unknown>, key: string, defaultValue: T[] = []): T[] {
    const value = a[key];
    return Array.isArray(value) ? (value as T[]) : defaultValue;
  },

  arrayOptional<T = string>(a: Record<string, unknown>, key: string): T[] | undefined {
    const value = a[key];
    return Array.isArray(value) ? (value as T[]) : undefined;
  },

  object<T = Record<string, unknown>>(a: Record<string, unknown>, key: string): T | undefined {
    const value = a[key];
    return typeof value === "object" && value !== null ? (value as T) : undefined;
  },
};
