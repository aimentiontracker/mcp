/**
 * The v1 client. One place that knows the wire format, shared by both
 * transports.
 *
 * ZERO KNOWLEDGE OF ANY SECRET BEYOND THE CALLER'S OWN KEY. There is no
 * database handle here, no vendor credential and no service account. The key
 * arrives from the caller — an env var under stdio, an Authorization header
 * over HTTP — and is passed straight through to the API, which does all auth,
 * tenancy, entitlement and rate limiting. That is what makes the hosted
 * container safe to run: compromising it yields nothing that was not already
 * in the request.
 */
export const VERSION = "0.1.1"

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = "ApiError"
  }
}

export interface Envelope<T> {
  data: T
  meta: Record<string, unknown>
}

export class Client {
  constructor(
    private readonly key: string,
    private readonly base = process.env.AMT_API_BASE ||
      "https://app.aimentiontracker.ai/api/v1"
  ) {}

  async get<T = unknown>(
    path: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<Envelope<T>> {
    const url = new URL(this.base.replace(/\/+$/, "") + path)
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v))
    }
    const res = await fetch(url, {
      headers: {
        "x-api-key": this.key,
        accept: "application/json",
        "user-agent": `amt-mcp/${VERSION}`,
      },
    })
    if (!res.ok) {
      let code = `http_${res.status}`
      let message = `Request failed with ${res.status}`
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } }
        if (body?.error?.code) code = body.error.code
        if (body?.error?.message) message = body.error.message
      } catch {
        /* a proxy or outage can put HTML in front of us */
      }
      throw new ApiError(res.status, code, message)
    }
    return (await res.json()) as Envelope<T>
  }
}
