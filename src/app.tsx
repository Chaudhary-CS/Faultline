// Main chat UI — built to look like Cloudflare's own dashboard.
// useAgent handles the WebSocket to the DO, useAgentChat wraps the
// AI SDK v6 chat interface on top of it.

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";

const SUGGESTED_QUERIES = [
  "What's broken right now?",
  "Recent BGP hijacks",
  "Traffic anomalies today",
  "Internet health status",
];

// Maps tool names to what the UI shows in the "Querying Radar..." bar
const TOOL_LABELS: Record<string, string> = {
  getCurrentOutages: "Fetching current outages",
  getBGPHijacks: "Scanning BGP hijack events",
  getRouteLeaks: "Checking route leak events",
  getTrafficAnomalies: "Analyzing traffic anomalies",
  getInternetHealth: "Pulling global routing stats",
};

// Persist session ID in localStorage so each tab has its own chat history
function getSessionId(): string {
  let id = localStorage.getItem("faultline-session");
  if (!id) {
    id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem("faultline-session", id);
  }
  return id;
}

// Pull status bar metrics on load — two Radar endpoints in parallel
// Falls back gracefully if either fails (e.g. token not set yet)
async function fetchStatusMetrics() {
  try {
    const [routeRes, outageRes] = await Promise.allSettled([
      fetch("/api/radar/route-stats"),
      fetch("/api/radar/outages"),
    ]);

    let totalRoutes = "—";
    let activeOutages = "—";

    if (routeRes.status === "fulfilled" && routeRes.value.ok) {
      const d = (await routeRes.value.json()) as {
        result?: { meta?: { totalIPv4RoutesAdvertised?: number } };
      };
      totalRoutes =
        d?.result?.meta?.totalIPv4RoutesAdvertised?.toLocaleString() ?? "—";
    }
    if (outageRes.status === "fulfilled" && outageRes.value.ok) {
      const d = (await outageRes.value.json()) as {
        result?: { annotations?: { outages?: unknown[] } };
      };
      activeOutages = String(
        d?.result?.annotations?.outages?.length ?? "—"
      );
    }

    return {
      totalRoutes,
      activeOutages,
      lastUpdated: new Date().toLocaleTimeString(),
    };
  } catch {
    return {
      totalRoutes: "—",
      activeOutages: "—",
      lastUpdated: new Date().toLocaleTimeString(),
    };
  }
}

export function App() {
  const sessionId = useRef(getSessionId());
  const [input, setInput] = useState("");
  const [metrics, setMetrics] = useState({
    totalRoutes: "—",
    activeOutages: "—",
    lastUpdated: "—",
    loaded: false,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // useAgent opens a WebSocket to /agents/ChatAgent/{sessionId} on the Worker.
  // routeAgentRequest on the server side routes it to the right DO instance.
  const agent = useAgent({
    agent: "ChatAgent",
    name: sessionId.current,
  });

  // useAgentChat wraps AI SDK v6's useChat with the agent WebSocket transport.
  // messages, status, sendMessage are the main things I use from this.
  const { messages, sendMessage, status } = useAgentChat({ agent });

  const isLoading = status === "submitted" || status === "streaming";

  // Derive active tools from message parts — look for tool parts that are
  // still waiting on input or output (not yet 'output-available')
  const activeTools = React.useMemo(() => {
    const active = new Set<string>();
    if (!isLoading) return active;
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      for (const part of msg.parts) {
        const type = (part as { type: string }).type;
        if (type === "dynamic-tool" || type.startsWith("tool-")) {
          const p = part as {
            type: string;
            toolName?: string;
            state?: string;
          };
          const toolName = p.toolName ?? type.replace(/^tool-/, "");
          const state = p.state ?? "";
          if (
            state === "input-streaming" ||
            state === "input-available"
          ) {
            active.add(toolName);
          }
        }
      }
    }
    return active;
  }, [messages, isLoading]);

  useEffect(() => {
    fetchStatusMetrics().then((m) => setMetrics({ ...m, loaded: true }));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    sendMessage({ text });
    setInput("");
    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [input, isLoading, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  const isConnected = status !== "error";

  return (
    <div className="app">
      <div className="grid-bg" aria-hidden="true" />

      <div className="container">
        {/* ── Header ─────────────────────────────────────── */}
        <header className="header">
          <div className="logo">
            <svg className="logo-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="#f6821f" strokeWidth="1.5" strokeDasharray="2 3" />
              <circle cx="12" cy="12" r="6" stroke="#f6821f" strokeWidth="1.5" opacity="0.5" />
              <circle cx="12" cy="12" r="2.5" fill="#f6821f" />
              <path d="M12 12 L18 6" stroke="#f6821f" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div>
              <h1 className="logo-title">
                Fault<span className="logo-accent">line</span>
              </h1>
              <p className="logo-sub">Powered by Cloudflare Radar + Workers AI</p>
            </div>
          </div>

          <div className={`status-badge ${isConnected ? "connected" : "connecting"}`}>
            <span className="status-dot" />
            <span>{isConnected ? "Live" : "Connecting..."}</span>
          </div>
        </header>

        {/* ── Tool call indicator ─────────────────────────── */}
        {activeTools.size > 0 && (
          <div className="tool-indicator">
            <div className="tool-pulse" aria-hidden="true" />
            <span>
              {[...activeTools].map((t) => TOOL_LABELS[t] ?? t).join(" · ")}...
            </span>
          </div>
        )}

        {/* ── Chat area ───────────────────────────────────── */}
        <main className="chat-area">
          {messages.length === 0 && !isLoading ? (
            <div className="empty-state">
              <div className="empty-icon" aria-hidden="true">
                <svg viewBox="0 0 64 64" fill="none">
                  <circle cx="32" cy="32" r="30" stroke="#1d1d1d" strokeWidth="2" />
                  <circle cx="32" cy="32" r="20" stroke="#1d1d1d" strokeWidth="2" />
                  <circle cx="32" cy="32" r="10" stroke="#f6821f" strokeWidth="2" opacity="0.5" />
                  <circle cx="32" cy="32" r="3" fill="#f6821f" />
                  <path d="M32 32 L48 16" stroke="#f6821f" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
                  <path d="M2 32 H62" stroke="#1d1d1d" strokeWidth="1" strokeDasharray="3 4" />
                  <path d="M32 2 V62" stroke="#1d1d1d" strokeWidth="1" strokeDasharray="3 4" />
                </svg>
              </div>
              <h2 className="empty-title">Find where the internet breaks</h2>
              <p className="empty-sub">
                Ask me about outages, BGP hijacks, route leaks, or traffic
                anomalies. I pull live data from Cloudflare Radar and explain
                it in plain English.
              </p>
              <div className="suggestions">
                {SUGGESTED_QUERIES.map((q) => (
                  <button
                    key={q}
                    className="suggestion-chip"
                    onClick={() => sendMessage({ text: q })}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`message ${msg.role === "user" ? "message-user" : "message-agent"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="agent-label">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" stroke="#f6821f" strokeWidth="2" strokeDasharray="2 3" />
                        <circle cx="12" cy="12" r="2.5" fill="#f6821f" />
                      </svg>
                      <span>Faultline</span>
                    </div>
                  )}
                  <div className="message-bubble">
                    {renderParts(msg.parts as MessagePart[])}
                  </div>
                </div>
              ))}

              {/* Blinking cursor while streaming but no tool is active */}
              {isLoading && activeTools.size === 0 && (
                <div className="message message-agent">
                  <div className="agent-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" stroke="#f6821f" strokeWidth="2" strokeDasharray="2 3" />
                      <circle cx="12" cy="12" r="2.5" fill="#f6821f" />
                    </svg>
                    <span>Faultline</span>
                  </div>
                  <div className="message-bubble">
                    <span className="typing-cursor" aria-label="Loading" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </main>

        {/* ── Input ───────────────────────────────────────── */}
        <footer className="input-area">
          <div className="input-wrapper">
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder="Ask about internet outages, BGP hijacks, traffic anomalies..."
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
              aria-label="Chat message input"
            />
            <button
              className="send-btn"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              aria-label="Send message"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <p className="input-footer-text">
            Powered by Cloudflare Workers AI · Llama 3.3 · Real-time Radar data
          </p>
        </footer>

        {/* ── Status bar ──────────────────────────────────── */}
        <div className="status-bar">
          <div className="metric-card">
            <span className="metric-label">Global BGP Routes</span>
            <span className="metric-value">
              {metrics.loaded ? metrics.totalRoutes : <span className="metric-loading" />}
            </span>
          </div>
          <div className="metric-divider" aria-hidden="true" />
          <div className="metric-card">
            <span className="metric-label">Active Outages</span>
            <span className="metric-value">
              {metrics.loaded ? metrics.activeOutages : <span className="metric-loading" />}
            </span>
          </div>
          <div className="metric-divider" aria-hidden="true" />
          <div className="metric-card">
            <span className="metric-label">Last Updated</span>
            <span className="metric-value metric-time">
              {metrics.loaded ? metrics.lastUpdated : <span className="metric-loading" />}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Message rendering ──────────────────────────────────────────────────────

type MessagePart =
  | { type: "text"; text: string }
  | { type: "step-start" }
  | { type: "reasoning"; reasoning: string }
  | { type: string; toolName?: string; state?: string; toolCallId?: string };

// Render all parts of a message — text gets formatted, tool calls get a
// subtle "used tool X" badge so the user can see what data was fetched
function renderParts(parts: MessagePart[]): React.ReactNode {
  return parts.map((part, i) => {
    if (part.type === "text") {
      return (
        <div key={i} className="part-text">
          {renderFormattedText((part as { type: "text"; text: string }).text)}
        </div>
      );
    }

    if (part.type === "step-start") {
      return null; // internal SDK part, nothing to show
    }

    if (part.type === "reasoning") {
      return null; // skip reasoning traces in the UI
    }

    // Any tool part (dynamic-tool or tool-{name}) that completed
    if (
      part.type === "dynamic-tool" ||
      part.type.startsWith("tool-")
    ) {
      const p = part as { type: string; toolName?: string; state?: string };
      const name = p.toolName ?? part.type.replace(/^tool-/, "");
      const state = p.state ?? "";
      if (state === "output-available") {
        return (
          <div key={i} className="tool-badge">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{TOOL_LABELS[name] ?? name}</span>
          </div>
        );
      }
      return null;
    }

    return null;
  });
}

// Simple text formatter — handles bullet points, bold, inline code,
// headings, numbered lists. No markdown library needed for this.
function renderFormattedText(text: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("- ") || line.startsWith("• ")) {
      return (
        <div key={i} className="msg-bullet">
          <span className="bullet-dot" aria-hidden="true">▸</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    }
    if (/^\d+\.\s/.test(line)) {
      return (
        <div key={i} className="msg-bullet">
          <span className="bullet-dot" aria-hidden="true">{line.match(/^\d+/)?.[0]}.</span>
          <span>{renderInline(line.replace(/^\d+\.\s/, ""))}</span>
        </div>
      );
    }
    if (line.startsWith("## ") || line.startsWith("### ")) {
      return <p key={i} className="msg-heading">{line.replace(/^#{2,3}\s/, "")}</p>;
    }
    if (line.trim() === "") return <div key={i} className="msg-spacer" />;
    return <p key={i}>{renderInline(line)}</p>;
  });
}

function renderInline(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} className="inline-code">{part.slice(1, -1)}</code>;
    return part;
  });
}
