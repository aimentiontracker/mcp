#!/usr/bin/env node
/**
 * Local (stdio) transport.
 *
 * The key comes from AMT_API_KEY in the client's own MCP config, so it never
 * leaves the user's machine. This is the transport for Claude Desktop, Claude
 * Code and Cursor when somebody would rather not point at a hosted endpoint.
 *
 *   claude mcp add aimentiontracker -e AMT_API_KEY=amt_live_... \
 *     -- npx -y @aimentiontracker/mcp
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { Client, VERSION } from "./client.js"
import { registerTools } from "./tools.js"

const key = process.env.AMT_API_KEY?.trim()
if (!key) {
  // stderr, never stdout: stdout IS the protocol channel and a stray line
  // there is a parse error at the client rather than a readable message.
  process.stderr.write(
    "AMT_API_KEY is not set. Create a key at https://app.aimentiontracker.ai/api-keys " +
      "and pass it to this server, e.g.\n" +
      "  claude mcp add aimentiontracker -e AMT_API_KEY=amt_live_... -- npx -y @aimentiontracker/mcp\n"
  )
  process.exit(1)
}

const server = new McpServer({ name: "aimentiontracker", version: VERSION })
registerTools(server, new Client(key))

await server.connect(new StdioServerTransport())
