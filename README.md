# @aimentiontracker/mcp

MCP server for [AIMentionTracker](https://app.aimentiontracker.ai): how often AI assistants name and cite your brand.

## Hosted (no install)

```bash
claude mcp add --transport http aimentiontracker https://mcp.aimentiontracker.ai \
  --header "Authorization: Bearer amt_live_YOUR_KEY"
```

## Local (stdio)

```bash
claude mcp add aimentiontracker -e AMT_API_KEY=amt_live_... -- npx -y @aimentiontracker/mcp
```

Create a key at [app.aimentiontracker.ai/api-keys](https://app.aimentiontracker.ai/api-keys).

## Tools

All read-only. v1 has no write endpoints, deliberately: adding a prompt expands a metered bill and triggering a run spends real vendor money.

| Tool | What it answers |
|---|---|
| `get_me` | Who this key is, the plan, and the reporting thresholds. **Call first.** |
| `list_brands` | Which brands this key can read, and their ids |
| `get_visibility` | Presence per engine and per brand over a window |
| `list_answers` | The stored answers, with mentions and citations |
| `list_sources` | Domains the engines read before answering |
| `list_alerts` | Findings worth acting on |

## Three rules the tools enforce

1. **A null rate means "not enough answers yet", never zero.** Rendering it as 0% reports a collapse that did not happen.
2. **Engines are never averaged.** They disagree; a mean describes no real surface.
3. **An empty findings list does not mean nothing changed.** `list_alerts` says so in the payload, not just the description.

## Security

The hosted server **holds no secrets**. No database, no vendor credentials, no service account. Your key arrives in the `Authorization` header and is passed straight through to the API, which does all authentication, tenancy, entitlement and rate limiting. Each request gets a fresh, stateless server instance that is closed when the response ends.

MIT.
