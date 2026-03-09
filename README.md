# cf_ai_faultline — AI-Powered Internet Outage Storyteller

## 🚀 Try it now → [faultline.kartikchoudhary085.workers.dev](https://faultline.kartikchoudhary085.workers.dev)
> No sign-up required. Works instantly. Ask about any internet outage, BGP hijack, or route leak.

---

> **Find where the internet breaks.**

Faultline is a conversational AI agent that answers plain-English questions about internet health in real time. Ask it about outages, BGP hijacks, route leaks, or traffic anomalies — it pulls live data from Cloudflare Radar, feeds it to Llama 3.3 running on Workers AI, and streams back clear human-readable narratives.

**🔴 Live demo:** **[faultline.kartikchoudhary085.workers.dev](https://faultline.kartikchoudhary085.workers.dev)**
> No sign-up. No API key. Open and ask anything.

---

## What it does

| Feature | Description |
|---|---|
| **Conversational AI** | Full chat interface powered by Llama 3.3 70B on Workers AI |
| **Live Radar data** | Pulls BGP hijacks, route leaks, outages, and routing table stats from Cloudflare Radar on every query |
| **ASN/Region Watchlist** | Say "Watch AS13335" — Faultline fetches targeted Radar data for that ASN every query and alerts you if issues are found |
| **Incident Timeline Generator** | Say "Generate incident report for Iran" — fires 3 parallel Radar fetches and synthesizes a structured post-mortem |
| **Morning Email Digest** | Daily 9am UTC cron job generates an overnight internet briefing and emails it via Resend |
| **Persistent sessions** | Full conversation history stored per-session in Durable Objects SQLite |
| **Severity badges** | Responses are automatically tagged Critical / Warning / Info based on content |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **LLM** | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` via Cloudflare Workers AI |
| **Agent + WebSocket** | Cloudflare Agents SDK — `AIChatAgent` + `useAgentChat` |
| **Memory / State** | Durable Objects SQLite (conversation history, email subscribers) |
| **Frontend** | React 19 + TypeScript, served via Cloudflare Workers Assets |
| **Build** | Vite + `@cloudflare/vite-plugin` |
| **Data** | Cloudflare Radar API (BGP, outages, routing table, ASN entity info) |
| **Email** | Resend API (daily digest) |
| **Cron** | Cloudflare Workers Cron Triggers (`0 9 * * *`) |

Everything runs on Cloudflare. Zero external VMs, zero cold starts.

---

## Architecture

```
Browser (React 19 + useAgentChat hook)
        │  WebSocket (real-time streaming)
        ▼
┌──────────────────────────────────────────────────────┐
│               Cloudflare Worker (server.ts)           │
│                                                       │
│  /agent/ChatAgent/:sessionId  ──►  ChatAgent DO       │
│  /api/stats                   ──►  Live Radar stats   │
│  /api/subscribe               ──►  DigestAgent DO     │
│  (everything else)            ──►  Workers Assets     │
└─────────────────┬────────────────────────────────────┘
                  │  Two Durable Object classes
        ┌─────────┴──────────┐
        ▼                    ▼
┌───────────────┐   ┌────────────────────┐
│  ChatAgent    │   │  DigestAgent        │
│  (per-session)│   │  (global singleton) │
│  - Chat SQL   │   │  - Subscribers SQL  │
│  - streamText │   │  - fetch() HTTP RPC │
└───────┬───────┘   └────────────────────┘
        │  RAG pattern: pre-fetch Radar data,
        │  inject into system prompt
        ▼
┌──────────────────────────────────────────────────────┐
│          fetchRadarContext()  /  fetchIncidentData()  │
│                                                       │
│  Standard:    /radar/annotations/outages              │
│               /radar/bgp/hijacks/events               │
│               /radar/bgp/leaks/events                 │
│               /radar/bgp/route-stats                  │
│                                                       │
│  Watchlist:   /radar/bgp/hijacks/events?affectedAsn=X │
│               /radar/bgp/leaks/events?involvedAsn=X   │
│               /radar/entities/asns/X                  │
│               /radar/annotations/outages?location=XX  │
└──────────────────────────────────────────────────────┘
        │
        ▼
   Llama 3.3 70B (fp8-fast)
   via Workers AI binding
```

### Why RAG instead of tool calling?

During development I found that `llama-3.3-70b-instruct-fp8-fast` in streaming mode via the Workers AI binding outputs tool calls as raw JSON text rather than executing them. To keep the architecture reliable, I switched to a **RAG (Retrieval-Augmented Generation)** pattern: detect the user's intent from keywords, pre-fetch the relevant Radar endpoints in parallel, and inject the data directly into the system prompt. The LLM then narrates real data rather than deciding what to fetch.

---

## Try it live

**URL:** https://faultline.kartikchoudhary085.workers.dev

### Example queries to test every feature

**Basic internet health:**
- `"What's broken on the internet right now?"`
- `"Any BGP hijacks today?"`
- `"Internet health status"`
- `"Recent route leaks"`
- `"Traffic anomalies in Asia"`

**Watchlist (Feature 1):**
- `"Watch AS13335"` → adds Cloudflare's ASN to watchlist, pulls targeted Radar data on every future query
- `"Monitor Iran"` → adds Iran by country, fetches IR-specific outage data
- `"Show my watchlist"` → opens the watchlist panel
- `"Remove Iran from watchlist"`
- Ask any question while watchlist is active → response will explicitly mention the watched entity's status

**Incident Timeline (Feature 2):**
- `"Generate incident report for Iran"`
- `"Build timeline of Cuba outage"`
- `"Post-mortem for Turkey internet shutdown"`
- `"What happened to AS13335 recently?"`

**Email Digest (Feature 3):**
- Click `"📧 Get daily digest"` below the input → enter email → receive daily 9am UTC briefing
- Or type: `"Subscribe you@email.com to digest"`

---

## Local setup

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- A Cloudflare account (free tier works)
- Cloudflare Radar API token — create at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) with `Account → Cloudflare Radar → Read` permission
- *(Optional)* Resend API key for email digest — free tier at [resend.com](https://resend.com) (3,000 emails/month)

### Install

```bash
git clone https://github.com/Chaudhary-CS/cf_ai_faultline.git
cd cf_ai_faultline
npm install
```

### Configure secrets

```bash
# Required: Cloudflare Radar API token
npx wrangler secret put CLOUDFLARE_RADAR_TOKEN
# paste your token when prompted

# Optional: Resend API key (only needed for email digest)
npx wrangler secret put RESEND_API_KEY
```

For local dev, create `.dev.vars`:

```
CLOUDFLARE_RADAR_TOKEN=your_token_here
```

### Run locally

```bash
npm run dev
```

Open http://localhost:5173 — note: Workers AI requires a Cloudflare account. The dev server proxies AI calls to Cloudflare remotely.

### Deploy to Cloudflare

```bash
npm run deploy
```

Your Worker will be live at `https://faultline.<your-subdomain>.workers.dev`.

---

## Project structure

```
src/
  server.ts        # Worker entrypoint — ChatAgent, DigestAgent, fetch handler, scheduled cron
  app.tsx          # React chat UI — all features, watchlist state, incident cards
  client.tsx       # React entry point
  styles.css       # Cloudflare-aesthetic dark theme

index.html         # SPA shell (title + favicon)
vite.config.ts     # Vite + @cloudflare/vite-plugin
wrangler.toml      # Worker config — DOs, AI binding, cron, assets
```

---

## Radar endpoints used

| Endpoint | Used for |
|---|---|
| `GET /radar/annotations/outages` | Current internet outages (global + location-filtered) |
| `GET /radar/bgp/hijacks/events` | BGP hijack events (global + ASN-filtered) |
| `GET /radar/bgp/leaks/events` | BGP route leak events (global + ASN-filtered) |
| `GET /radar/bgp/route-stats` | Global routing table stats |
| `GET /radar/entities/asns/:asn` | ASN entity info (name, org, country) |

---

## Cloudflare products used

- **Workers** — serverless execution
- **Workers AI** — Llama 3.3 70B inference
- **Durable Objects** — persistent chat sessions + subscriber store (SQLite)
- **Cloudflare Agents SDK** — `AIChatAgent`, WebSocket streaming, `useAgentChat`
- **Workers Assets** — serving the React frontend
- **Cron Triggers** — daily email digest at 9am UTC

---

## Built by

**Kartik Chaudhary**
- GitHub: [github.com/Chaudhary-CS](https://github.com/Chaudhary-CS)

**Submission for:** Cloudflare AI Challenge 2026
**Repository:** [github.com/Chaudhary-CS/cf_ai_faultline](https://github.com/Chaudhary-CS/cf_ai_faultline)
