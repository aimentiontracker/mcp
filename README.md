# @aimentiontracker/mcp

Track how often ChatGPT, Claude, Gemini, Perplexity and Google AI Overviews name and cite your brand, from inside your MCP client. Ten read-only tools over AI visibility, share of voice, sentiment and competitor mentions, with the answers they came from.

This is answer engine optimisation (AEO) data, not rank tracking: the unit is an answer an assistant gave a real question, and whether you were in it.

## Hosted (no install)

```bash
claude mcp add --transport http aimentiontracker https://mcp.aimentiontracker.ai \
  --header "Authorization: Bearer amt_live_YOUR_KEY"
```

## Local (stdio)

```bash
claude mcp add aimentiontracker -e AMT_API_KEY=amt_live_... -- npx -y @aimentiontracker/mcp
```

Create a key at [app.aimentiontracker.ai/api-keys](https://app.aimentiontracker.ai/api-keys). Keys are read-only and scoped to one organisation; they cannot change billing, the team, or what is tracked.

## Tools

All read-only. v1 has no write endpoints, deliberately: adding a prompt expands a metered bill and triggering a run spends real vendor money.

| Tool | What it answers |
|---|---|
| `get_me` | Who this key is, the plan, and the reporting thresholds. **Call first.** |
| `get_current_date` | Today in UTC, and the trailing windows every other tool counts back from. **Call before reasoning about dates.** |
| `list_brands` | Which brands this key can read, and their ids |
| `get_visibility` | Presence per engine and per brand over a window |
| `get_share_of_voice` | Each tracked brand's mentions as a share of the tracked set |
| `get_sentiment` | Recommended, negative and neutral counts per brand, against the classified denominator |
| `list_competitors` | Who gets named instead of you, including answers that named them and never mentioned you |
| `list_answers` | The stored answers, with mentions and citations |
| `list_sources` | Domains the engines read before answering |
| `list_alerts` | Findings worth acting on |

One further tool, `list_search_console`, registers only where the Google Search Console integration is enabled. A tool that always answers 404 is worse than an absent one: an agent picks it for a task it cannot do and spends a turn failing.

## Three rules the tools enforce

1. **A null rate means "not enough answers yet", never zero.** Rendering it as 0% reports a collapse that did not happen.
2. **Engines are never averaged.** They disagree; a mean describes no real surface.
3. **An empty findings list does not mean nothing changed.** `list_alerts` says so in the payload, not just the description.

Every tool that reports a measurement carries these rules in its own description, because an agent reads the tool, not the README.

## Why the denominators are in the payload

`get_share_of_voice` returns `brands_counted`, and `get_sentiment` counts against `classified` rather than total mentions. A workspace tracking two competitors and one tracking twelve produce incomparable shares from identical answers, and the sentiment classifier abstains on listicle mentions where an engine named a brand without endorsing it. Both numbers are meaningless without the denominator beside them, so the tools return it rather than trusting the caller to ask.

## Security

The hosted server **holds no secrets**. No database, no vendor credentials, no service account. Your key arrives in the `Authorization` header and is passed straight through to the API, which does all authentication, tenancy, entitlement and rate limiting. Each request gets a fresh, stateless server instance that is closed when the response ends.

## More

- [What it tracks](https://aimentiontracker.ai/features) and [pricing](https://aimentiontracker.ai/pricing)
- Per engine: [ChatGPT](https://aimentiontracker.ai/platforms/chatgpt), [Claude](https://aimentiontracker.ai/platforms/claude), [Perplexity](https://aimentiontracker.ai/platforms/perplexity)
- [MCP server docs](https://aimentiontracker.ai/docs/mcp) and the [REST API](https://aimentiontracker.ai/docs/api)

MIT.
