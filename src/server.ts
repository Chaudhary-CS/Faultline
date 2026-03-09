// I'm extending AIChatAgent from @cloudflare/ai-chat — this is the new home
// after they split the agents SDK in Feb 2026. Handles WebSocket, SQLite
// message persistence, and streaming all automatically via Durable Objects.

import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { createWorkersAI } from "workers-ai-provider";
import {
  streamText,
  convertToModelMessages,
  pruneMessages,
  tool,
  stepCountIs,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";
import { z } from "zod";

export interface Env {
  AI: Ai;
  // DO binding name must match wrangler.toml and the class name
  ChatAgent: DurableObjectNamespace;
  CLOUDFLARE_RADAR_TOKEN: string;
  ASSETS: Fetcher;
}

const RADAR_BASE = "https://api.cloudflare.com/client/v4";

// Wraps every Radar call — handles auth, rate limits, and bad responses
// without crashing the whole agent
async function radarFetch(
  path: string,
  token: string,
  params?: Record<string, string>
): Promise<{ success: boolean; data: unknown; error?: string }> {
  try {
    const url = new URL(`${RADAR_BASE}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    url.searchParams.set("format", "json");

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (res.status === 429) {
      return { success: false, data: null, error: "rate_limited" };
    }
    if (!res.ok) {
      return { success: false, data: null, error: `HTTP ${res.status}` };
    }

    return { success: true, data: await res.json() };
  } catch (err) {
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

const SYSTEM_PROMPT = `You are an internet intelligence analyst powered by Cloudflare Radar. You translate raw internet infrastructure data — BGP events, route leaks, traffic anomalies, outages — into clear, human-readable narratives.

When you don't have data, say so honestly. Be concise, specific, and use plain English. Never use jargon without explaining it.

When describing outages, always mention: what happened, where, when, and potential impact.

Always call the relevant tool before answering questions about current internet conditions — don't make up numbers or events.

Format responses with:
- A brief headline summary (1 sentence)
- Key findings as bullet points
- A plain-English explanation of what it means for regular users

If Radar data is temporarily unavailable, say exactly that.`;

// ChatAgent is a Durable Object — one instance per browser session.
// The Agents SDK stores all messages in SQLite automatically; I don't
// have to manage any of that state myself.
export class ChatAgent extends AIChatAgent<Env> {
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
      system: SYSTEM_PROMPT,
      // convertToModelMessages turns UIMessages → CoreMessages for the model
      // pruneMessages keeps old tool calls from clogging the context window
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
      }),
      tools: {
        // Tool 1: current outages worldwide
        getCurrentOutages: tool({
          description:
            "Get the latest internet outages and anomalies from Cloudflare Radar. Use when asked about current outages, what's broken, or general internet health.",
          inputSchema: z.object({
            limit: z
              .number()
              .optional()
              .default(10)
              .describe("Number of outage events to retrieve"),
          }),
          execute: async ({ limit }) => {
            const r = await radarFetch(
              "/radar/annotations/outages",
              this.env.CLOUDFLARE_RADAR_TOKEN,
              { limit: String(limit) }
            );
            return r.success
              ? r.data
              : { error: "Radar data temporarily unavailable", detail: r.error };
          },
        }),

        // Tool 2: BGP hijacks — someone claiming IP space that isn't theirs
        getBGPHijacks: tool({
          description:
            "Get BGP hijack events. BGP hijacks happen when a network incorrectly claims ownership of IP address ranges, potentially redirecting or intercepting traffic. Use when asked about BGP hijacks, route hijacking, or traffic interception.",
          inputSchema: z.object({
            limit: z
              .number()
              .optional()
              .default(10)
              .describe("Number of hijack events to return"),
            minConfidence: z
              .number()
              .optional()
              .default(0.8)
              .describe("Minimum confidence score (0-1) for hijack detection"),
          }),
          execute: async ({ limit, minConfidence }) => {
            const r = await radarFetch(
              "/radar/bgp/hijacks/events",
              this.env.CLOUDFLARE_RADAR_TOKEN,
              { limit: String(limit), minConfidence: String(minConfidence) }
            );
            return r.success
              ? r.data
              : { error: "Radar data temporarily unavailable", detail: r.error };
          },
        }),

        // Tool 3: route leaks — routing announcements that propagate too far
        getRouteLeaks: tool({
          description:
            "Get BGP route leak events. Route leaks happen when routing announcements propagate beyond their intended scope. Use when asked about route leaks, BGP leaks, or routing anomalies.",
          inputSchema: z.object({
            limit: z
              .number()
              .optional()
              .default(10)
              .describe("Number of route leak events to return"),
          }),
          execute: async ({ limit }) => {
            const r = await radarFetch(
              "/radar/bgp/leaks/events",
              this.env.CLOUDFLARE_RADAR_TOKEN,
              { limit: String(limit) }
            );
            return r.success
              ? r.data
              : { error: "Radar data temporarily unavailable", detail: r.error };
          },
        }),

        // Tool 4: regional traffic anomalies — optionally filter by country
        getTrafficAnomalies: tool({
          description:
            "Get internet traffic anomalies for a specific location or region. Use when asked about traffic patterns or disruptions in a specific country or region.",
          inputSchema: z.object({
            location: z
              .string()
              .optional()
              .describe("ISO country code (e.g. 'US', 'CN', 'DE') or region"),
            limit: z.number().optional().default(10),
          }),
          execute: async ({ location, limit }) => {
            const params: Record<string, string> = { limit: String(limit) };
            if (location) params.location = location;
            const r = await radarFetch(
              "/radar/annotations/outages",
              this.env.CLOUDFLARE_RADAR_TOKEN,
              params
            );
            return r.success
              ? r.data
              : { error: "Radar data temporarily unavailable", detail: r.error };
          },
        }),

        // Tool 5: global routing table stats — proxy for overall internet health
        getInternetHealth: tool({
          description:
            "Get global BGP routing table statistics as a measure of internet health. Shows total routes, prefixes, and ASNs. Use when asked about overall internet health or routing stability.",
          inputSchema: z.object({}),
          execute: async () => {
            const r = await radarFetch(
              "/radar/bgp/route-stats",
              this.env.CLOUDFLARE_RADAR_TOKEN
            );
            return r.success
              ? r.data
              : { error: "Radar data temporarily unavailable", detail: r.error };
          },
        }),
      },
      stopWhen: stepCountIs(5),
      onFinish,
    });

    return result.toUIMessageStreamResponse();
  }
}

// routeAgentRequest handles /agents/ChatAgent/:id → DO routing automatically.
// Anything else gets served from Workers Assets (the built React frontend).
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routeAgentRequest(request, env)) ??
      env.ASSETS.fetch(request)
    );
  },
} satisfies ExportedHandler<Env>;
