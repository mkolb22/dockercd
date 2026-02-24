/**
 * MCP Server Setup and Configuration
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { ToolHandler } from "./types.js";

/**
 * Configuration for creating the MCP server
 */
export interface ServerConfig {
  name: string;
  version: string;
  tools: Tool[];
  handleToolCall: ToolHandler;
}

/**
 * Create a configured MCP server with standard tool handling
 */
export function createServer(config: ServerConfig): Server {
  const server = new Server(
    { name: config.name, version: config.version },
    { capabilities: { tools: {} } }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: config.tools,
  }));

  // Register tool call handler with error wrapping
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await config.handleToolCall(name, args as Record<string, unknown>);
      // Return as expected by MCP SDK
      return result as unknown as { content: Array<{ type: "text"; text: string }>; isError?: boolean };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Run an MCP server with stdio transport
 */
export async function runServer(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
