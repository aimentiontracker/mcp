/**
 * The tools, and the rules they must carry.
 *
 * EVERY DESCRIPTION STATES THE HONESTY RULES, and that is not padding. A tool
 * description is the only documentation an agent ever reads. If it does not say
 * that a null rate means "not enough answers yet", an agent will render it as
 * 0% and report a collapse in visibility that did not happen — to a customer,
 * confidently, in our name. The docs site cannot prevent that; this file can.
 *
 * ALL TOOLS ARE READ-ONLY because v1 has no write endpoints, deliberately:
 * adding a prompt expands a metered bill and triggering a run spends real
 * vendor money, and an agent that can loop on either is the CLAUDE.md lesson
 * about never letting a vendor call bill the user silently.
 */
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Client, ApiError } from "./client.js"

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

/** Shared tail on every description, so no tool can quietly omit it. */
const RULES =
  " RULES: a null rate means NOT ENOUGH ANSWERS YET, never zero — never render it as 0%." +
  " Engines are reported separately and must never be averaged into one score."

const brandArg = {
  brand: z
    .string()
    .optional()
    .describe(
      "Which brand to report on, from list_brands. REQUIRED when the organisation has more than one brand: omitting it returns brand_required rather than guessing, because a silent default would file one customer's numbers under another's."
    ),
}

/** Tool errors are returned, not thrown — an agent can act on a message. */
async function call<T>(fn: () => Promise<T>): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const result = await fn()
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  } catch (err) {
    const e = err as ApiError
    const hint =
      e.code === "brand_required"
        ? " Call list_brands and pass the brand argument."
        : e.status === 401
          ? " The API key is missing, revoked or expired."
          : e.code === "no_subscription"
            ? " This organisation has never had a plan."
            : ""
    return {
      content: [{ type: "text", text: JSON.stringify({ error: { code: e.code ?? "error", message: (e.message ?? String(err)) + hint } }, null, 2) }],
      isError: true,
    }
  }
}

export function registerTools(server: McpServer, client: Client): void {
  server.registerTool(
    "get_me",
    {
      title: "Who this key is, and how to read the numbers",
      description:
        "Call this FIRST. Returns the organisation, plan, quota, which brand the key reads, and a reporting_rules block carrying the sample floor and the live alert thresholds. The thresholds are the only way to tell 'no alerts' from 'nothing changed'." +
        RULES,
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => call(async () => (await client.get("/me")).data)
  )

  server.registerTool(
    "list_brands",
    {
      title: "List brands",
      description:
        "Every brand this key may read, with the id to pass as the `brand` argument on the other tools. A key pinned to a single brand sees only that one." +
        RULES,
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => call(async () => (await client.get("/brands")).data)
  )

  server.registerTool(
    "get_visibility",
    {
      title: "Visibility per engine and per brand",
      description:
        "How often each AI engine named this brand and its competitors over a trailing window, each figure with its denominator. There is NO single visibility score and you must not compute one by averaging the engines: they disagree, and a mean describes no real surface." +
        RULES,
      inputSchema: {
        days: z.number().int().min(1).max(365).optional()
          .describe("Trailing window in days. Default 7."),
        ...brandArg,
      },
      annotations: READ_ONLY,
    },
    async ({ days, brand }) => call(async () => (await client.get("/visibility", { days, brand })).data)
  )

  server.registerTool(
    "list_answers",
    {
      title: "The stored answers",
      description:
        "The raw material every other number traces back to: each stored answer with the brands it mentioned and the sources it cited. Use it to show a customer the exact sentence behind a figure. `outcome: \"empty\"` is a real observation — the engine answered and named nobody — not a failure. Paginate with the cursor from meta.next_cursor." +
        RULES,
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe("Answers per page, default 50."),
        cursor: z.string().optional().describe("An answer id from a previous page's meta.next_cursor."),
        engine: z.string().optional().describe("Filter to one engine slug, e.g. chatgpt."),
        ...brandArg,
      },
      annotations: READ_ONLY,
    },
    async ({ limit, cursor, engine, brand }) =>
      call(async () => {
        const r = await client.get("/answers", { limit, cursor, engine, brand })
        return { answers: r.data, next_cursor: r.meta.next_cursor ?? null }
      })
  )

  server.registerTool(
    "list_sources",
    {
      title: "Domains the engines read before answering",
      description:
        "Which sites the AI engines consulted, and whether this brand was named in the answers that cited them. `answers_citing_you_without_naming_you` is the actionable number: a domain read on nine answers that named a competitor every time is a specific page to go and be on. Hosts are normalised, so www.example.com and example.com are one row." +
        RULES,
      inputSchema: {
        days: z.number().int().min(1).max(365).optional().describe("Trailing window in days. Default 30."),
        ...brandArg,
      },
      annotations: READ_ONLY,
    },
    async ({ days, brand }) => call(async () => (await client.get("/sources", { days, brand })).data)
  )

  server.registerTool(
    "list_alerts",
    {
      title: "Findings about this brand",
      description:
        "Changes worth acting on, newest first. AN EMPTY LIST DOES NOT MEAN NOTHING CHANGED: a finding is raised only when both comparison windows carry enough answers AND the move is larger than its own margin of error, which on a small plan excludes most real moves. Report an empty list as 'no change large enough to distinguish from noise at this sample size', never as stability. get_me returns the thresholds in force." +
        RULES,
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe("How many findings, default 50."),
        ...brandArg,
      },
      annotations: READ_ONLY,
    },
    async ({ limit, brand }) =>
      call(async () => {
        const r = await client.get<unknown[]>("/alerts", { limit, brand })
        return {
          findings: r.data,
          // Repeated in the PAYLOAD, not only the description: an agent that
          // skimmed the description still sees this next to the empty array.
          interpretation:
            (r.data as unknown[]).length === 0
              ? "No change large enough to distinguish from noise at this sample size. This is NOT the same as 'nothing changed'."
              : undefined,
        }
      })
  )
}
