// I'm extending AIChatAgent from the Cloudflare Agents SDK — this handles
// WebSocket connections, message persistence via Durable Objects SQL, and
// streaming all out of the box. Way cleaner than rolling my own DO class.

import { AIChatAgent } from "@cloudflare/agents";
import { createDataStreamResponse, streamText, tool } from "ai";
import { createWorkersAI } from "@ai-sdk/cloudflare";
import { z } from "zod";

// Env bindings defined in wrangler.toml
export interface Env {
  AI: Ai;
  CHAT_AGENT: DurableObjectNamespace;
  CLOUDFLARE_RADAR_TOKEN: string;
  ASSETS: Fetcher;
}

// Base URL for all Cloudflare Radar API calls
const RADAR_BASE = "https://api.cloudflare.com/client/v4";

// Helper to hit Radar with auth + error handling
// I don't want the whole thing to crash if Radar rate-limits me
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
    // Always ask for JSON format
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
      return {
        success: false,
        data: null,
        error: `HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const json = await res.json();
    return { success: true, data: json };
  } catch (err) {
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : "Unknown fetch error",
    };
  }
}

// System prompt — tells Llama 3.3 to be a network analyst, not a chatbot
const SYSTEM_PROMPT = `You are an internet intelligence analyst powered by Cloudflare Radar. You translate raw internet infrastructure data — BGP events, route leaks, traffic anomalies, outages — into clear, human-readable narratives.

When you don't have data, say so honestly. Be concise, specific, and use plain English. Never use jargon without explaining it.

When describing outages, always mention: what happened, where, when, and potential impact.

You have access to live Cloudflare Radar data through your tools. Always call the relevant tool before answering questions about current internet conditions — don't make up numbers or events.

Format your responses with:
- A brief headline summary (1 sentence)
- Key findings as bullet points
- A plain-English explanation of what it means for regular internet users

If Radar data is temporarily unavailable, say exactly that and explain what the data would normally show.`;

// The main agent class — this is a Durable Object under the hood
// Agents SDK stores conversation history in SQLite automatically
export class ChatAgent extends AIChatAgent<Env> {
  async onChatMessage(onChunk: (chunk: string) => void) {
    // I'm using createWorkersAI so I get the Vercel AI SDK interface
    // on top of Workers AI — means I can use streamText and tools the normal way
    const workersai = createWorkersAI({ binding: this.env.AI });

    const model = workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast");

    const response = createDataStreamResponse({
      execute: async (dataStream) => {
        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          messages: this.messages,
          maxSteps: 5, // let it chain tool calls if needed
          tools: {
            // Tool 1: current outages and anomalies worldwide
            getCurrentOutages: tool({
              description:
                "Get the latest internet outages and anomalies from Cloudflare Radar. Use this when asked about current outages, what's broken, or general internet health.",
              parameters: z.object({
                limit: z
                  .number()
                  .optional()
                  .default(10)
                  .describe("Number of outage events to retrieve"),
              }),
              execute: async ({ limit }) => {
                const result = await radarFetch(
                  "/radar/annotations/outages",
                  this.env.CLOUDFLARE_RADAR_TOKEN,
                  { limit: String(limit) }
                );

                if (!result.success) {
                  return {
                    error: "Radar data temporarily unavailable",
                    detail: result.error,
                  };
                }

                return result.data;
              },
            }),

            // Tool 2: BGP hijack events — these are when someone wrongly announces
            // another network's IP prefixes, basically "stealing" their traffic
            getBGPHijacks: tool({
              description:
                "Get BGP hijack events from Cloudflare Radar. BGP hijacks are when a network incorrectly claims ownership of IP address ranges, potentially redirecting or intercepting traffic. Use when asked about BGP hijacks, route hijacking, or traffic interception.",
              parameters: z.object({
                limit: z
                  .number()
                  .optional()
                  .default(10)
                  .describe("Number of hijack events to return"),
                minConfidence: z
                  .number()
                  .optional()
                  .default(0.8)
                  .describe(
                    "Minimum confidence score (0-1) for hijack detection"
                  ),
              }),
              execute: async ({ limit, minConfidence }) => {
                const result = await radarFetch(
                  "/radar/bgp/hijacks/events",
                  this.env.CLOUDFLARE_RADAR_TOKEN,
                  {
                    limit: String(limit),
                    minConfidence: String(minConfidence),
                  }
                );

                if (!result.success) {
                  return {
                    error: "Radar data temporarily unavailable",
                    detail: result.error,
                  };
                }

                return result.data;
              },
            }),

            // Tool 3: BGP route leaks — different from hijacks, these are when
            // routing announcements get sent somewhere they shouldn't propagate
            getRouteLeaks: tool({
              description:
                "Get BGP route leak events. Route leaks happen when routing announcements propagate beyond their intended scope, potentially causing traffic to take suboptimal or unintended paths. Use when asked about route leaks, BGP leaks, or routing anomalies.",
              parameters: z.object({
                limit: z
                  .number()
                  .optional()
                  .default(10)
                  .describe("Number of route leak events to return"),
              }),
              execute: async ({ limit }) => {
                const result = await radarFetch(
                  "/radar/bgp/leaks/events",
                  this.env.CLOUDFLARE_RADAR_TOKEN,
                  { limit: String(limit) }
                );

                if (!result.success) {
                  return {
                    error: "Radar data temporarily unavailable",
                    detail: result.error,
                  };
                }

                return result.data;
              },
            }),

            // Tool 4: Traffic anomalies for a specific region/location
            getTrafficAnomalies: tool({
              description:
                "Get internet traffic anomalies for a specific location or region. Use when asked about traffic patterns, internet disruptions in a specific country or region, or unusual traffic behavior.",
              parameters: z.object({
                location: z
                  .string()
                  .optional()
                  .describe(
                    "ISO country code (e.g. 'US', 'CN', 'DE') or region name"
                  ),
                limit: z
                  .number()
                  .optional()
                  .default(10)
                  .describe("Number of anomaly events to return"),
              }),
              execute: async ({ location, limit }) => {
                const params: Record<string, string> = {
                  limit: String(limit),
                };
                if (location) {
                  params.location = location;
                }

                const result = await radarFetch(
                  "/radar/annotations/outages",
                  this.env.CLOUDFLARE_RADAR_TOKEN,
                  params
                );

                if (!result.success) {
                  return {
                    error: "Radar data temporarily unavailable",
                    detail: result.error,
                  };
                }

                return result.data;
              },
            }),

            // Tool 5: Global routing table health — number of prefixes, ASNs, etc.
            // I use this as a proxy for overall internet "health"
            getInternetHealth: tool({
              description:
                "Get global BGP routing table statistics as a measure of internet health. Shows total number of routes, prefixes, and ASNs in the global routing table. Use when asked about overall internet health, routing stability, or global connectivity.",
              parameters: z.object({}),
              execute: async () => {
                const result = await radarFetch(
                  "/radar/bgp/route-stats",
                  this.env.CLOUDFLARE_RADAR_TOKEN
                );

                if (!result.success) {
                  return {
                    error: "Radar data temporarily unavailable",
                    detail: result.error,
                  };
                }

                return result.data;
              },
            }),
          },
          onChunk(event) {
            // Forward each streamed chunk to the client
            dataStream.writeData(event.chunk);
          },
          onFinish: async ({ usage }) => {
            console.log(
              `[faultline] Finished — tokens used: ${JSON.stringify(usage)}`
            );
          },
        });

        result.mergeIntoDataStream(dataStream);
      },
      onError: (err) => {
        console.error("[faultline] Stream error:", err);
        return err instanceof Error ? err.message : "Something went wrong";
      },
    });

    return response;
  }
}

// Main Worker fetch handler — routes WebSocket upgrades to the DO,
// serves the frontend assets for everything else
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route /api/chat/* to the ChatAgent Durable Object
    // The Agents SDK expects requests at this path pattern
    if (url.pathname.startsWith("/api/chat")) {
      // Session ID comes from the URL — each unique ID = isolated chat history
      const sessionId = url.pathname.split("/")[3] ?? "default";
      const id = env.CHAT_AGENT.idFromName(sessionId);
      const stub = env.CHAT_AGENT.get(id);
      return stub.fetch(request);
    }

    // Serve static frontend assets (built React app)
    return env.ASSETS.fetch(request);
  },
};
