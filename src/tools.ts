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
    "get_current_date",
    {
      title: "Today, and the windows every other tool counts back from",
      description:
        "The server's current UTC date plus the start of each trailing window (7, 30, 90, 365 days). Call this BEFORE reasoning about dates: a model's idea of 'today' comes from its training data and is routinely months stale, and every other tool here counts backwards from the server's date, not yours. Getting this wrong produces a report confidently labelled with the wrong month.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      call(async () => {
        const now = new Date()
        const back = (n: number) => {
          const d = new Date(now)
          d.setUTCDate(d.getUTCDate() - n)
          return d.toISOString().slice(0, 10)
        }
        return {
          utc_now: now.toISOString(),
          today: now.toISOString().slice(0, 10),
          windows: { last_7_days: back(7), last_30_days: back(30), last_90_days: back(90), last_365_days: back(365) },
        }
      })
  )

  server.registerTool(
    "get_sentiment",
    {
      title: "How the engines frame each brand, with its denominator",
      description:
        "Recommended, negative and neutral counts per brand. THE DENOMINATOR IS `classified`, NOT `answers_naming_them`: the classifier abstains on listicle mentions where an engine named a brand without endorsing it, so classified is usually much smaller, and a share computed against mentions understates every brand. `recommended_share` is null below the sample floor, which means NOT ENOUGH CLASSIFIED MENTIONS and must never be rendered as 0%. There is no single sentiment score and you must not compute one." +
        RULES,
      inputSchema: {
        days: z.number().int().min(1).max(365).optional().describe("Trailing window in days. Default 30."),
        ...brandArg,
      },
      annotations: READ_ONLY,
    },
    async ({ days, brand }) =>
      call(async () => {
        const r = await client.get("/sentiment", { days, brand })
        return { brands: r.data, ...r.meta }
      })
  )

  server.registerTool(
    "get_share_of_voice",
    {
      title: "Mention share across the brands this workspace tracks",
      description:
        "Each tracked brand's mentions as a share of every tracked brand's, in the same answers. THE DENOMINATOR IS THE TRACKED SET, NOT THE MARKET: a workspace tracking two competitors and one tracking twelve produce incomparable numbers from identical answers, so always report `brands_counted` beside any share you quote. `share` is null when no brand was named at all, which is undefined rather than zero." +
        RULES,
      inputSchema: {
        days: z.number().int().min(1).max(365).optional().describe("Trailing window in days. Default 30."),
        ...brandArg,
      },
      annotations: READ_ONLY,
    },
    async ({ days, brand }) =>
      call(async () => {
        const r = await client.get("/share-of-voice", { days, brand })
        return { brands: r.data, ...r.meta }
      })
  )

  server.registerTool(
    "list_competitors",
    {
      title: "Who gets named instead of you",
      description:
        "Competitors ranked by how often the engines named them, with `answers_without_you`: answers that named them and never mentioned you. That is the actionable column, because 'named in 48 answers' is a fact about them and 'named in 47 answers that never mentioned you' is a fact about the customer. Pass quotes=1 for up to three supporting sentences each; leave it off when summarising, or a report becomes a transcript." +
        RULES,
      inputSchema: {
        days: z.number().int().min(1).max(365).optional().describe("Trailing window in days. Default 30."),
        quotes: z.boolean().optional().describe("Include up to 3 quoted sentences per competitor. Off by default."),
        ...brandArg,
      },
      annotations: READ_ONLY,
    },
    async ({ days, quotes, brand }) =>
      call(async () => {
        const r = await client.get("/competitors", { days, quotes: quotes ? 1 : undefined, brand })
        return { competitors: r.data, ...r.meta }
      })
  )

  /**
   * Search Console is gated because the integration is not enabled on every
   * deployment. A registered tool that always answers 404 is worse than an
   * absent one: it appears in the agent's tool list as a capability, gets
   * chosen for a task it cannot do, and spends a turn failing.
   *
   * Explicit rather than derived: this process talks to the API over HTTP and
   * cannot read the app's hasSearchConsole. Set AMT_SEARCH_CONSOLE=1 only
   * where GSC_CLIENT_ID and friends are set on the API. If the two ever
   * disagree, both directions are safe — the tool is absent, or it returns
   * the API's "not enabled on this deployment".
   */
  if (process.env.AMT_SEARCH_CONSOLE === "1") {
  server.registerTool(
    "list_search_console",
    {
      title: "What Google shows, against what the engines read",
      description:
        "Pages from the customer's own Search Console joined to the pages AI engines actually cited. `status` is the point: shown_not_cited means Google ranks the page and NO engine has ever read it, which is a structure problem on a named page rather than a reason to write more content; cited_not_shown means the engines read it and Google does not rank it; both means it is working. If `meta.connected` is false there is NO Search Console connection, which is not the same as having no findings and must never be reported as 'no issues' — say it is not connected. Use view=queries for the searches they are genuinely found for, with whether a prompt already tracks each one." +
        RULES,
      inputSchema: {
        view: z.enum(["pages", "queries"]).optional()
          .describe("pages (default) joins Google against citations; queries lists real search demand."),
        days: z.number().int().min(1).max(365).optional()
          .describe("Trailing window in days. Default 28."),
        ...brandArg,
      },
      annotations: READ_ONLY,
    },
    async ({ view, days, brand }) =>
      call(async () => {
        const r = await client.get("/search-console", { view, days, brand })
        return { rows: r.data, ...r.meta }
      })
  )

  }

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
