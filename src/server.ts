// Faultline — AI-powered internet outage storyteller
// Architecture: RAG pattern — pre-fetch relevant Radar data, inject into LLM context.
// Features: watchlist cross-reference, incident timeline generator, daily email digest.

import { AIChatAgent } from "@cloudflare/ai-chat";
import { Agent, routeAgentRequest } from "agents";
import { createWorkersAI } from "workers-ai-provider";
import {
  streamText,
  convertToModelMessages,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";

export interface Env {
  AI: Ai;
  ChatAgent: DurableObjectNamespace;
  DigestAgent: DurableObjectNamespace;
  CLOUDFLARE_RADAR_TOKEN: string;
  RESEND_API_KEY?: string;
  ASSETS: Fetcher;
}

const RADAR_BASE = "https://api.cloudflare.com/client/v4";

// ── Radar fetch helper ───────────────────────────────────────────────────────

async function radarFetch(
  path: string,
  token: string,
  params?: Record<string, string>
): Promise<unknown> {
  try {
    const url = new URL(`${RADAR_BASE}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    url.searchParams.set("format", "json");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 429) return { error: "Rate limited by Radar API — try again in a moment" };

    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      console.error(`[radar] ${res.status} on ${path}:`, body.slice(0, 300));
      return { error: `Radar API returned HTTP ${res.status}`, detail: body.slice(0, 200) };
    }

    return await res.json();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fetch failed" };
  }
}

// ── Country name → ISO-3166 alpha-2 code ─────────────────────────────────────

const COUNTRY_CODES: Record<string, string> = {
  "iran": "IR", "iraq": "IQ", "cuba": "CU", "russia": "RU", "china": "CN",
  "turkey": "TR", "türkiye": "TR", "ethiopia": "ET", "myanmar": "MM",
  "sudan": "SD", "brazil": "BR", "india": "IN", "pakistan": "PK",
  "egypt": "EG", "ukraine": "UA", "venezuela": "VE", "nigeria": "NG",
  "indonesia": "ID", "bangladesh": "BD", "mexico": "MX", "kazakhstan": "KZ",
  "north korea": "KP", "syria": "SY", "libya": "LY", "afghanistan": "AF",
  "mali": "ML", "senegal": "SN", "germany": "DE", "france": "FR",
  "uk": "GB", "united kingdom": "GB", "united states": "US", "usa": "US",
  "japan": "JP", "south korea": "KR", "israel": "IL", "palestine": "PS",
  "kenya": "KE", "ghana": "GH", "tanzania": "TZ", "zimbabwe": "ZW",
  "uganda": "UG", "cameroon": "CM", "congo": "CD", "mozambique": "MZ",
  "argentina": "AR", "colombia": "CO", "peru": "PE", "chile": "CL",
  "thailand": "TH", "vietnam": "VN", "philippines": "PH", "malaysia": "MY",
};

function countryToCode(name: string): string | null {
  return COUNTRY_CODES[name.toLowerCase().trim()] ?? null;
}

function parseAsnNumber(value: string): string | null {
  // "AS13335" → "13335",  "13335" → "13335"
  const m = value.match(/^(?:as)?(\d+)$/i);
  return m ? m[1] : null;
}

// ── Standard RAG context fetch ───────────────────────────────────────────────

async function fetchRadarContext(
  userMessage: string,
  token: string,
  watchlistItems: string[] = []
): Promise<string> {
  const msg = userMessage.toLowerCase();

  const fetches: { label: string; path: string; params?: Record<string, string> }[] = [];

  // Always grab outages
  fetches.push({
    label: "Current Internet Outages & Annotations",
    path: "/radar/annotations/outages",
    params: { limit: "10", dateRange: "7d" },
  });

  if (
    msg.includes("hijack") || msg.includes("bgp") ||
    msg.includes("route") || msg.includes("routing") ||
    msg.includes("intercept") || msg.includes("broken") ||
    msg.includes("right now") || msg.includes("unusual") || msg.includes("anomal") ||
    msg.includes("watch") || msg.includes("monitor")
  ) {
    fetches.push({
      label: "BGP Hijack Events (global)",
      path: "/radar/bgp/hijacks/events",
      params: { per_page: "10", dateRange: "7d" },
    });
  }

  if (msg.includes("leak") || msg.includes("bgp") || msg.includes("route")) {
    fetches.push({
      label: "BGP Route Leak Events (global)",
      path: "/radar/bgp/leaks/events",
      params: { per_page: "10", dateRange: "7d" },
    });
  }

  if (
    msg.includes("health") || msg.includes("stable") ||
    msg.includes("global") || msg.includes("routing table") ||
    msg.includes("prefix") || msg.includes("status")
  ) {
    fetches.push({
      label: "Global BGP Routing Table Stats",
      path: "/radar/bgp/routes/stats",
      params: {},
    });
  }

  // ── Watchlist-targeted fetches ────────────────────────────────────────────
  // For each watched item, pull Radar data scoped to that ASN or country.
  // This ensures the LLM always has targeted info about watched entities,
  // even if they don't appear in the general feed.
  for (const item of watchlistItems) {
    const asnNum = parseAsnNumber(item);
    if (asnNum) {
      // Hijacks affecting this ASN
      fetches.push({
        label: `BGP Hijacks affecting AS${asnNum} (watched)`,
        path: "/radar/bgp/hijacks/events",
        params: { affectedAsn: asnNum, per_page: "10", dateRange: "7d" },
      });
      // Route leaks involving this ASN
      fetches.push({
        label: `BGP Route Leaks involving AS${asnNum} (watched)`,
        path: "/radar/bgp/leaks/events",
        params: { involvedAsn: asnNum, per_page: "10", dateRange: "7d" },
      });
      // ASN entity info (name, country, org)
      fetches.push({
        label: `ASN Info for AS${asnNum} (watched)`,
        path: `/radar/entities/asns/${asnNum}`,
        params: {},
      });
    } else {
      // Country watchlist item — try to fetch location-specific outages
      const code = countryToCode(item);
      if (code) {
        fetches.push({
          label: `Outages & Annotations for ${item} (watched)`,
          path: "/radar/annotations/outages",
          params: { location: code, limit: "10", dateRange: "7d" },
        });
      }
    }
  }

  const results = await Promise.all(
    fetches.map(async ({ label, path, params }) => {
      const data = await radarFetch(path, token, params);
      return `### ${label}\n${JSON.stringify(data, null, 2)}`;
    })
  );

  return results.join("\n\n");
}

// ── Incident timeline: parallel-fetch all 3 Radar sources ───────────────────

async function fetchIncidentData(subject: string, token: string): Promise<string> {
  const [outages, hijacks, leaks] = await Promise.all([
    radarFetch("/radar/annotations/outages", token, { limit: "20", dateRange: "7d" }),
    radarFetch("/radar/bgp/hijacks/events", token, { per_page: "20", dateRange: "7d" }),
    radarFetch("/radar/bgp/leaks/events", token, { per_page: "20", dateRange: "7d" }),
  ]);

  return [
    `### INCIDENT INVESTIGATION: ${subject}`,
    `### Outage Annotations (last 7 days)\n${JSON.stringify(outages, null, 2)}`,
    `### BGP Hijack Events (last 7 days)\n${JSON.stringify(hijacks, null, 2)}`,
    `### BGP Route Leak Events (last 7 days)\n${JSON.stringify(leaks, null, 2)}`,
  ].join("\n\n");
}

// Detect whether the user wants an incident timeline/report
function detectIncidentSubject(msg: string): string | null {
  const patterns = [
    /(?:generate|build|create)\s+(?:an?\s+)?(?:incident\s+report|timeline|post.?mortem)\s+(?:for|of|about|on)\s+(.+)/i,
    /(?:timeline|post.?mortem)\s+(?:of|for|about)\s+(.+)/i,
    /what\s+happened\s+(?:with|to)\s+(.+)/i,
    /(?:investigate|analyze)\s+(.+)\s+(?:outage|shutdown|hijack|disruption)/i,
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m) return m[1].replace(/\s*(outage|shutdown|hijack|disruption|incident)\s*$/i, "").trim();
  }
  return null;
}

function isIncidentRequest(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("incident report") ||
    lower.includes("build timeline") ||
    lower.includes("generate timeline") ||
    lower.includes("create timeline") ||
    lower.includes("timeline for") ||
    lower.includes("timeline of") ||
    lower.includes("what happened with") ||
    lower.includes("what happened to") ||
    lower.includes("post-mortem") ||
    lower.includes("post mortem") ||
    lower.includes("postmortem") ||
    lower.includes("investigate") && (lower.includes("outage") || lower.includes("shutdown"))
  );
}

// ── Message helpers ──────────────────────────────────────────────────────────

function getLastUserMessage(
  messages: Array<{ role: string; parts?: Array<{ type: string; text?: string }>; content?: string }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    if (msg.parts) {
      const textPart = msg.parts.find((p) => p.type === "text");
      if (textPart?.text) return textPart.text;
    }
    if (typeof msg.content === "string") return msg.content;
  }
  return "";
}

// Strip [watching:...] meta prefix — client injects this for watchlist cross-ref
function stripWatchingPrefix(text: string): string {
  return text.replace(/^\[watching:[^\]]*\]\s*/i, "").trim();
}

// Parse [watching:AS13335,Brazil,...] from message
function extractWatchlist(text: string): string[] {
  const m = text.match(/^\[watching:([^\]]+)\]/i);
  if (!m) return [];
  return m[1].split(",").map(s => s.trim()).filter(Boolean);
}

// ── Prompts ──────────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are an internet intelligence analyst powered by Cloudflare Radar. You translate raw internet infrastructure data — BGP events, route leaks, traffic anomalies, outages — into clear, human-readable narratives.

Be concise, specific, and use plain English. Never use jargon without explaining it. If there is no data or the data shows no issues, say so clearly.

When describing outages or BGP events, always mention: what happened, where, when, and potential impact.

Format your response as:
- A one-sentence headline summarizing the situation
- Key findings as bullet points (use "- " prefix)
- A brief plain-English explanation of what it means for regular internet users

If the Radar data shows errors or is unavailable, explain that Radar data is temporarily unavailable and describe what you would normally look for.`;

const INCIDENT_FORMAT_INSTRUCTIONS = `When responding to this incident timeline request, structure your response EXACTLY as follows:

# Incident Report: {SUBJECT}
Generated: {TIME}

## Summary
[2-3 sentence plain English summary of what happened]

## Timeline
[Chronological bullet points — use timestamps from the data if available, otherwise describe sequence]

## Impact
[Who and what was affected, estimated scope, affected ASNs/regions]

## Technical Details
[BGP specifics: ASNs involved, prefixes affected, hijack/leak details]

## Current Status
[Resolved / Ongoing — based on the data provided]

---
*Generated by Faultline using Cloudflare Radar data*`;

// ── Email helpers ────────────────────────────────────────────────────────────

function markdownToHtml(md: string): string {
  const body = md
    .replace(/^# (.+)$/gm, '<h1 style="color:#f6821f;font-size:22px;margin:16px 0 8px">$1</h1>')
    .replace(/^## (.+)$/gm, '<h2 style="color:#f6821f;font-size:16px;margin:14px 0 6px">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="color:#e4e4e7;font-size:14px;margin:12px 0 4px">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, '<li style="margin:3px 0;color:#d4d4d8">$1</li>')
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #333;margin:16px 0">')
    .replace(/\n\n/g, '<br><br>');
  return `<!DOCTYPE html>
<html>
<body style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#f4f4f5;padding:24px;line-height:1.6">
<div style="border-bottom:2px solid #f6821f;padding-bottom:12px;margin-bottom:20px">
  <strong style="font-size:20px;color:#f6821f">Fault<span style="color:#f4f4f5">line</span></strong>
  <span style="color:#71717a;font-size:13px;margin-left:8px">Internet Intelligence</span>
</div>
${body}
<div style="margin-top:24px;padding-top:12px;border-top:1px solid #27272a;font-size:11px;color:#52525b">
  Faultline · Powered by Cloudflare Radar · <a href="#" style="color:#f6821f">Unsubscribe</a>
</div>
</body>
</html>`;
}

async function sendEmail(to: string, content: string, env: Env): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Faultline <digest@faultline.dev>",
        to,
        subject: `🌐 Faultline Morning Brief — ${new Date().toDateString()}`,
        html: markdownToHtml(content),
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[digest] send failed for ${to}:`, err.slice(0, 200));
    }
  } catch (err) {
    console.error(`[digest] network error sending to ${to}:`, err);
  }
}

// ── DigestAgent: persistent email subscriber store ───────────────────────────

export class DigestAgent extends Agent<Env> {
  private initTable(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS subscribers (
        email      TEXT PRIMARY KEY,
        subscribed_at TEXT NOT NULL
      )
    `;
  }

  override async fetch(request: Request): Promise<Response> {
    this.initTable();
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/subscribe") {
      let email = "";
      try {
        const body = await request.json<{ email: string }>();
        email = (body.email ?? "").trim().toLowerCase();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json({ error: "Invalid email address" }, { status: 400 });
      }
      this.sql`INSERT OR IGNORE INTO subscribers (email, subscribed_at) VALUES (${email}, ${new Date().toISOString()})`;
      return Response.json({ ok: true, email });
    }

    if (request.method === "GET" && url.pathname === "/subscribers") {
      const rows = this.sql`SELECT email FROM subscribers` as Array<{ email: string }>;
      return Response.json(rows.map(r => r.email));
    }

    return new Response("Not found", { status: 404 });
  }
}

// ── ChatAgent ────────────────────────────────────────────────────────────────

export class ChatAgent extends AIChatAgent<Env> {
  async onChatMessage(onFinish: StreamTextOnFinishCallback<ToolSet>) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const rawUserMessage = getLastUserMessage(
      this.messages as Array<{ role: string; parts?: Array<{ type: string; text?: string }>; content?: string }>
    );

    // Extract watchlist items injected by the client as [watching:X,Y] prefix
    const watchlistItems = extractWatchlist(rawUserMessage);
    const userMessage = stripWatchingPrefix(rawUserMessage);
    const msgLower = userMessage.toLowerCase();

    // ── Handle email subscription commands ──────────────────────────────────
    let subscribeNote = "";
    const emailMatch = userMessage.match(
      /subscribe\s+([^\s]+@[^\s@]+\.[^\s]+)\s+to\s+(?:the\s+)?digest/i
    );
    if (emailMatch) {
      const email = emailMatch[1].trim().toLowerCase();
      try {
        const id = this.env.DigestAgent.idFromName("global");
        const stub = this.env.DigestAgent.get(id);
        await stub.fetch("https://do-internal/subscribe", {
          method: "POST",
          body: JSON.stringify({ email }),
          headers: { "Content-Type": "application/json" },
        });
        subscribeNote = `The user's email (${email}) has been successfully subscribed to the daily Faultline Morning Brief, which arrives at 9am UTC. Confirm this warmly and describe what the digest includes: overnight internet events, BGP activity, outages, and an internet health rating.`;
      } catch {
        subscribeNote = `There was an error subscribing ${email}. Tell the user to try again later.`;
      }
    }

    // ── Fetch Radar context ─────────────────────────────────────────────────
    let radarData: string;
    let incidentSubject: string | null = null;
    let isIncident = false;

    if (isIncidentRequest(userMessage)) {
      isIncident = true;
      incidentSubject = detectIncidentSubject(userMessage) ?? userMessage.replace(/^.*(for|of|about|with|to)\s+/i, "").trim();
      radarData = await fetchIncidentData(incidentSubject, this.env.CLOUDFLARE_RADAR_TOKEN);
    } else {
      // Pass watchlist so targeted ASN/country fetches are included
      radarData = await fetchRadarContext(userMessage, this.env.CLOUDFLARE_RADAR_TOKEN, watchlistItems);
    }

    // ── Build system prompt ─────────────────────────────────────────────────
    let systemPrompt = BASE_SYSTEM_PROMPT;

    if (isIncident && incidentSubject) {
      systemPrompt += `\n\n${INCIDENT_FORMAT_INSTRUCTIONS
        .replace("{SUBJECT}", incidentSubject)
        .replace("{TIME}", new Date().toUTCString())}`;
    }

    if (watchlistItems.length > 0) {
      systemPrompt += `\n\nWATCHLIST: The user is actively monitoring ${watchlistItems.join(", ")}. The Radar data below includes sections labelled "(watched)" with data fetched specifically for these entities.

Rules:
- If a "(watched)" section shows ANY events (hijacks, leaks, outages), PREFIX your entire response with "🔴 WATCHLIST ALERT: " and a one-sentence summary of what was found for the watched entity. Then continue the full response.
- If a "(watched)" section shows no events, explicitly confirm this — e.g. "AS13335 (Cloudflare) shows no hijacks or route leaks in the last 7 days."
- Always mention the watched items by name in your response, even if there's nothing to report.`;
    }

    if (subscribeNote) {
      systemPrompt += `\n\nSUBSCRIPTION ACTION: ${subscribeNote}`;
    }

    systemPrompt += `\n\n---\nLIVE CLOUDFLARE RADAR DATA (fetched at ${new Date().toUTCString()}):\n\n${radarData}\n---\n\nUse ONLY the data above when answering. Do not make up events or statistics.`;

    // Sanitize messages — strip [watching:...] meta prefix before sending to LLM
    const sanitizedMessages = (this.messages as Array<{
      role: string;
      parts?: Array<{ type: string; text?: string }>;
      content?: string;
      id?: string;
    }>).map((msg) => {
      if (msg.role !== "user") return msg;
      return {
        ...msg,
        parts: (msg.parts ?? []).map((part) => {
          if (part.type !== "text" || !part.text) return part;
          return { ...part, text: stripWatchingPrefix(part.text) };
        }),
      };
    });

    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
      system: systemPrompt,
      messages: await convertToModelMessages(sanitizedMessages as Parameters<typeof convertToModelMessages>[0]),
      onFinish,
    });

    return result.toUIMessageStreamResponse();
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────

function formatRoutes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ── Default export: fetch + scheduled ───────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // /api/stats — live status bar
    if (url.pathname === "/api/stats") {
      const [routeRes, outageRes] = await Promise.allSettled([
        // Correct endpoint: /radar/bgp/routes/stats (not /radar/bgp/route-stats)
        radarFetch("/radar/bgp/routes/stats", env.CLOUDFLARE_RADAR_TOKEN, {}),
        radarFetch("/radar/annotations/outages", env.CLOUDFLARE_RADAR_TOKEN, { limit: "50", dateRange: "7d" }),
      ]);

      let routes = 0;
      let outageCount = 0;

      if (routeRes.status === "fulfilled") {
        // Actual field is routes_total (e.g. 1412848)
        const d = routeRes.value as { result?: { stats?: { routes_total?: number } } };
        routes = d?.result?.stats?.routes_total ?? 0;
      }

      if (outageRes.status === "fulfilled") {
        // annotations is a flat array, not an object with outages key
        const d = outageRes.value as { result?: { annotations?: unknown[] } };
        outageCount = d?.result?.annotations?.length ?? 0;
      }

      return new Response(
        JSON.stringify({
          routes: routes > 0 ? formatRoutes(routes) : "—",
          outages: outageCount > 0 ? String(outageCount) : "0",
          updated: new Date().toUTCString(),
        }),
        { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
      );
    }

    // /api/subscribe — store email in DigestAgent DO
    if (url.pathname === "/api/subscribe" && request.method === "POST") {
      try {
        const id = env.DigestAgent.idFromName("global");
        const stub = env.DigestAgent.get(id);
        const body = await request.text();
        const res = await stub.fetch("https://do-internal/subscribe", {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();
        return Response.json(data, { status: res.status });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }

    return (
      (await routeAgentRequest(request, env)) ??
      env.ASSETS.fetch(request)
    );
  },

  // Runs daily at 9am UTC — generates and sends morning internet digest
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!env.RESEND_API_KEY) {
      console.warn("[digest] RESEND_API_KEY not configured — skipping digest send");
      return;
    }

    // Get subscriber list
    let subscribers: string[] = [];
    try {
      const id = env.DigestAgent.idFromName("global");
      const stub = env.DigestAgent.get(id);
      const res = await stub.fetch("https://do-internal/subscribers");
      subscribers = await res.json<string[]>();
    } catch (err) {
      console.error("[digest] Failed to fetch subscribers:", err);
      return;
    }

    if (!subscribers.length) {
      console.log("[digest] No subscribers — skipping");
      return;
    }

    // Fetch overnight Radar data
    const [outages, hijacks, leaks] = await Promise.all([
      radarFetch("/radar/annotations/outages", env.CLOUDFLARE_RADAR_TOKEN, { limit: "20", dateRange: "7d" }),
      radarFetch("/radar/bgp/hijacks/events", env.CLOUDFLARE_RADAR_TOKEN, { per_page: "20", dateRange: "1d" }),
      radarFetch("/radar/bgp/leaks/events", env.CLOUDFLARE_RADAR_TOKEN, { per_page: "20", dateRange: "1d" }),
    ]);

    // Generate digest with Llama
    let digestText = "Internet health data unavailable — please check Cloudflare Radar directly.";
    try {
      const aiRes = await env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as Parameters<typeof env.AI.run>[0],
        {
          messages: [
            {
              role: "system",
              content: `You are Faultline, an internet intelligence briefing service. Generate a concise morning digest. Format exactly:

# 🌐 Faultline Morning Brief — ${new Date().toDateString()}

Good morning. Here's what happened on the internet overnight:

## Critical Events
[List any BGP hijacks or internet shutdowns. If none, say "No critical events overnight."]

## Outages & Disruptions
[Summarize any outages. If none, say "No significant outages reported."]

## BGP Activity
[Summarize route changes, leaks, or unusual BGP activity]

## Internet Health: [NORMAL / ELEVATED / CRITICAL]

---
Faultline · Powered by Cloudflare Radar`,
            },
            {
              role: "user",
              content: `Generate the morning digest. Overnight data: ${JSON.stringify({ outages, hijacks, leaks })}`,
            },
          ],
        } as { messages: Array<{ role: string; content: string }> }
      ) as { response?: string };
      digestText = aiRes?.response ?? digestText;
    } catch (err) {
      console.error("[digest] AI generation failed:", err);
    }

    // Send to all subscribers
    const results = await Promise.allSettled(
      subscribers.map((email) => sendEmail(email, digestText, env))
    );

    const sent = results.filter(r => r.status === "fulfilled").length;
    console.log(`[digest] Sent to ${sent}/${subscribers.length} subscribers`);
  },
} satisfies ExportedHandler<Env>;
