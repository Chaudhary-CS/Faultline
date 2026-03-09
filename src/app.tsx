// Main chat UI — Cloudflare aesthetic, dark + orange.
// New features: New Chat, Copy response, Follow-up suggestions, auto-refresh metrics.

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";

const SUGGESTED_QUERIES = [
  "What's broken right now?",
  "Recent BGP hijacks",
  "Traffic anomalies today",
  "Internet health status",
];

// Follow-up suggestions shown after each agent response — I pick these
// based on what the last agent message was about
function getFollowUps(lastAgentText: string): string[] {
  const t = lastAgentText.toLowerCase();
  if (t.includes("hijack") || t.includes("bgp")) {
    return ["Show route leaks too", "Which ASNs are most affected?", "Is this unusual activity?"];
  }
  if (t.includes("outage") || t.includes("broken") || t.includes("disruption")) {
    return ["Which regions are affected?", "Any BGP issues related?", "How long do these usually last?"];
  }
  if (t.includes("health") || t.includes("routing table") || t.includes("prefix")) {
    return ["Are there any active outages?", "Show BGP hijack events", "Traffic anomalies today"];
  }
  if (t.includes("traffic") || t.includes("anomal")) {
    return ["Show BGP hijacks", "Any outages in those regions?", "Internet health status"];
  }
  return ["Any BGP hijacks today?", "Show recent outages", "Global internet health"];
}

function getSessionId(): string {
  let id = localStorage.getItem("faultline-session");
  if (!id) {
    id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem("faultline-session", id);
  }
  return id;
}

function newSessionId(): string {
  const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem("faultline-session", id);
  return id;
}

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
      totalRoutes = d?.result?.meta?.totalIPv4RoutesAdvertised?.toLocaleString() ?? "—";
    }
    if (outageRes.status === "fulfilled" && outageRes.value.ok) {
      const d = (await outageRes.value.json()) as {
        result?: { annotations?: { outages?: unknown[] } };
      };
      activeOutages = String(d?.result?.annotations?.outages?.length ?? "—");
    }
    return { totalRoutes, activeOutages, lastUpdated: new Date().toLocaleTimeString() };
  } catch {
    return { totalRoutes: "—", activeOutages: "—", lastUpdated: new Date().toLocaleTimeString() };
  }
}

// Extract plain text from all text parts of a message
function extractText(parts: MessagePart[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("\n");
}

export function App() {
  const [sessionId, setSessionId] = useState(getSessionId);
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState({
    totalRoutes: "—", activeOutages: "—", lastUpdated: "—", loaded: false,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const agent = useAgent({ agent: "ChatAgent", name: sessionId });
  const { messages, sendMessage, status, clearHistory } = useAgentChat({ agent });

  const isLoading = status === "submitted" || status === "streaming";
  const isConnected = status !== "error";

  // Show Radar indicator while loading
  const showRadarBadge = isLoading;

  // Refresh metrics on load and every 60 seconds
  useEffect(() => {
    const load = () => fetchStatusMetrics().then((m) => setMetrics({ ...m, loaded: true }));
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = useCallback((text?: string) => {
    const t = (text ?? input).trim();
    if (!t || isLoading) return;
    sendMessage({ text: t });
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [input, isLoading, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  // New chat: clear history + generate a fresh session ID so we get a clean DO
  const handleNewChat = useCallback(() => {
    clearHistory();
    setSessionId(newSessionId());
    setInput("");
  }, [clearHistory]);

  // Copy agent message text to clipboard
  const handleCopy = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  // The last completed agent message (for follow-up suggestions)
  const lastAgentMsg = !isLoading
    ? [...messages].reverse().find((m) => m.role === "assistant")
    : null;

  const followUps = lastAgentMsg
    ? getFollowUps(extractText(lastAgentMsg.parts as MessagePart[]))
    : null;

  return (
    <div className="app">
      <div className="grid-bg" aria-hidden="true" />
      <div className="container">

        {/* ── Header ──────────────────────────────────── */}
        <header className="header">
          <div className="logo">
            <svg className="logo-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="#f6821f" strokeWidth="1.5" strokeDasharray="2 3" />
              <circle cx="12" cy="12" r="6" stroke="#f6821f" strokeWidth="1.5" opacity="0.5" />
              <circle cx="12" cy="12" r="2.5" fill="#f6821f" />
              <path d="M12 12 L18 6" stroke="#f6821f" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div>
              <h1 className="logo-title">Fault<span className="logo-accent">line</span></h1>
              <p className="logo-sub">Powered by Cloudflare Radar + Workers AI</p>
            </div>
          </div>

          <div className="header-actions">
            {messages.length > 0 && (
              <button className="new-chat-btn" onClick={handleNewChat} aria-label="Start new chat">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                New Chat
              </button>
            )}
            <div className={`status-badge ${isConnected ? "connected" : "connecting"}`}>
              <span className="status-dot" />
              <span>{isConnected ? "Live" : "Connecting..."}</span>
            </div>
          </div>
        </header>

        {/* ── Radar indicator ──────────────────────────── */}
        {showRadarBadge && (
          <div className="tool-indicator">
            <div className="tool-pulse" aria-hidden="true" />
            <span>Querying Cloudflare Radar...</span>
          </div>
        )}

        {/* ── Chat area ────────────────────────────────── */}
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
                Ask me about outages, BGP hijacks, route leaks, or traffic anomalies.
                I pull live data from Cloudflare Radar and explain it in plain English.
              </p>
              <div className="suggestions">
                {SUGGESTED_QUERIES.map((q) => (
                  <button key={q} className="suggestion-chip" onClick={() => handleSend(q)}>{q}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((msg, idx) => {
                const isLast = idx === messages.length - 1;
                const parts = msg.parts as MessagePart[];
                const plainText = extractText(parts);

                return (
                  <React.Fragment key={msg.id}>
                    <div className={`message ${msg.role === "user" ? "message-user" : "message-agent"}`}>
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
                        {renderParts(parts)}
                      </div>

                      {/* Copy button on agent messages */}
                      {msg.role === "assistant" && plainText && (
                        <button
                          className="copy-btn"
                          onClick={() => handleCopy(msg.id, plainText)}
                          aria-label="Copy response"
                          title="Copy to clipboard"
                        >
                          {copiedId === msg.id ? (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M20 6L9 17L4 12" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
                              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="2" />
                            </svg>
                          )}
                          <span>{copiedId === msg.id ? "Copied!" : "Copy"}</span>
                        </button>
                      )}
                    </div>

                    {/* Follow-up suggestions after the last agent message */}
                    {msg.role === "assistant" && isLast && !isLoading && followUps && (
                      <div className="followup-row">
                        {followUps.map((q) => (
                          <button key={q} className="followup-chip" onClick={() => handleSend(q)}>
                            {q}
                          </button>
                        ))}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}

              {isLoading && (
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

        {/* ── Input ────────────────────────────────────── */}
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
              onClick={() => handleSend()}
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

        {/* ── Status bar ───────────────────────────────── */}
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

// ── Message rendering ────────────────────────────────────────────────────────

type MessagePart =
  | { type: "text"; text: string }
  | { type: "step-start" }
  | { type: "reasoning"; reasoning: string }
  | { type: string; toolName?: string; state?: string; toolCallId?: string };

function renderParts(parts: MessagePart[]): React.ReactNode {
  return parts.map((part, i) => {
    if (part.type === "text") {
      return (
        <div key={i} className="part-text">
          {renderFormattedText((part as { type: "text"; text: string }).text)}
        </div>
      );
    }
    if (part.type === "step-start" || part.type === "reasoning") return null;
    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) return null;
    return null;
  });
}

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
