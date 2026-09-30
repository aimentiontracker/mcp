/**
 * Hosted (Streamable HTTP) transport, for mcp.aimentiontracker.ai.
 *
 * THIS CONTAINER HOLDS ZERO SECRETS. No env file, no database, no vendor
 * credential, no service account. The caller's API key arrives in the
 * Authorization header and is passed straight through to /api/v1, which does
 * all authentication, tenancy, entitlement and rate limiting. Compromising this
 * process yields nothing that was not already in the request that reached it.
 *
 * A FRESH SERVER PER REQUEST, closed on response. Stateless
 * (sessionIdGenerator: undefined), so there is no session map to leak one
 * caller's context into another's, and no cross-request state to get wrong
 * under concurrency. It costs an object allocation per call and removes an
 * entire class of multi-tenant bug.
 */
import http from "node:http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { Client, VERSION } from "./client.js"
import { registerTools } from "./tools.js"

const PORT = Number(process.env.PORT || 3210)
const APP = process.env.AMT_APP_URL || "https://app.aimentiontracker.ai"
const SELF = process.env.AMT_MCP_URL || "https://mcp.aimentiontracker.ai"

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) })
  res.end(payload)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)

  // Liveness for the container healthcheck. Deliberately NOT a proxy to the
  // API: this endpoint answers "is this process up", and folding an upstream
  // check into it would restart a healthy container during an API blip.
  if (url.pathname === "/healthz") return json(res, 200, { ok: true, version: VERSION })

  /**
   * RFC 9728 protected-resource metadata.
   *
   * Tells a client that discovers this endpoint WITHOUT a key — the claude.ai
   * browser connector in particular — which authorization server to talk to.
   * We do not run OAuth yet, so this points at the app, where a human mints a
   * key by hand. Publishing it now means a future OAuth rollout is a change of
   * one document rather than a change of protocol.
   */
  if (url.pathname === "/.well-known/oauth-protected-resource") {
    return json(res, 200, {
      resource: SELF,
      authorization_servers: [APP],
      bearer_methods_supported: ["header"],
      resource_documentation: `${APP}/docs`,
    })
  }

  if (url.pathname !== "/" && url.pathname !== "/mcp") {
    return json(res, 404, {
      error:
        'Not found. This host speaks MCP at its root. Connect a client with an "Authorization: Bearer amt_live_..." header.',
    })
  }

  const apiKey = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!apiKey) {
    // WWW-Authenticate points at the metadata above, which is what lets a
    // browser-based client begin an auth flow rather than simply failing.
    res.setHeader(
      "WWW-Authenticate",
      `Bearer realm="AIMentionTracker MCP", resource_metadata="${SELF}/.well-known/oauth-protected-resource"`
    )
    return json(res, 401, {
      error: {
        code: "unauthorized",
        message: `Send "Authorization: Bearer amt_live_...". Create a key at ${APP}/api-keys.`,
      },
    })
  }

  // The body has to be read before the transport sees it, because Node's
  // request stream can only be consumed once.
  let parsed: unknown
  if (req.method === "POST") {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks).toString("utf8")
    try {
      parsed = raw ? JSON.parse(raw) : undefined
    } catch {
      return json(res, 400, { error: { code: "invalid_json", message: "Body was not valid JSON." } })
    }
  }

  const mcp = new McpServer({ name: "aimentiontracker", version: VERSION })
  registerTools(mcp, new Client(apiKey))
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })

  // Tear down with the response, not on a timer. A leaked transport per
  // request is a slow memory leak that only shows under load.
  res.on("close", () => {
    transport.close().catch(() => {})
    mcp.close().catch(() => {})
  })

  try {
    await mcp.connect(transport)
    await transport.handleRequest(req, res, parsed)
  } catch (err) {
    if (!res.headersSent) {
      json(res, 500, { error: { code: "mcp_error", message: err instanceof Error ? err.message : String(err) } })
    }
  }
})

server.listen(PORT, () => {
  process.stdout.write(`aimentiontracker-mcp ${VERSION} listening on :${PORT}\n`)
})
