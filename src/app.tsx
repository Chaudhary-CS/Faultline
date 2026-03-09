// Faultline chat UI
// Features: watchlist, incident timelines, email digest, severity badges,
//           query chips, copy/download, follow-up chips, live status bar

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { FooterBadge } from "./footer-badge";

// ── Suggested query chips ────────────────────────────────────────────────────

const QUERY_CHIPS = [
  "What's broken right now?",
  "Any BGP hijacks today?",
  "Recent route leaks",
  "Internet health status",
  "Traffic anomalies in Asia",
  "Iran internet shutdown details",
];

// ── Watchlist ────────────────────────────────────────────────────────────────

interface WatchlistItem {
  id: string;
  type: "asn" | "country";
  value: string;
  addedAt: string;
}

function loadWatchlist(): WatchlistItem[] {
  try {
    const s = localStorage.getItem("faultline-watchlist");
    return s ? (JSON.parse(s) as WatchlistItem[]) : [];
  } catch { return []; }
}

function saveWatchlist(items: WatchlistItem[]): void {
  localStorage.setItem("faultline-watchlist", JSON.stringify(items));
}

function makeWatchlistItem(value: string): WatchlistItem {
  const v = value.trim();
  const isAsn = /^as\d+$/i.test(v) || /^\d{3,}$/.test(v);
  return {
    id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: isAsn ? "asn" : "country",
    value: isAsn ? v.toUpperCase().replace(/^(\d)/, "AS$1") : v,
    addedAt: new Date().toISOString(),
  };
}

// Detect watchlist management commands typed by the user
function parseWatchlistCommand(text: string): { action: string; value?: string } | null {
  const t = text.trim();
  const addMatch = t.match(/^(?:watch|monitor|track)\s+(.+)$/i);
  if (addMatch) return { action: "add", value: addMatch[1].trim() };

  const removeMatch = t.match(/^(?:remove|unwatch|stop watching)\s+(.+?)(?:\s+from\s+(?:my\s+)?watchlist)?$/i);
  if (removeMatch) return { action: "remove", value: removeMatch[1].trim() };

  const tl = t.toLowerCase();
  if (tl === "show my watchlist" || tl === "my watchlist" || tl === "watchlist" || tl === "show watchlist")
    return { action: "show" };
  if (tl === "clear watchlist" || tl === "clear my watchlist")
    return { action: "clear" };

  return null;
}

// ── Incident timeline helpers ────────────────────────────────────────────────

function isIncidentReportRequest(text: string): boolean {
  const lower = text.toLowerCase();
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
    lower.includes("postmortem")
  );
}

function extractIncidentSubjectFromReport(text: string): string {
  const m = text.match(/^#\s+Incident Report:\s+(.+)$/m);
  return m ? m[1].trim() : "incident";
}

function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Strip [watching:...] meta prefix the client injects before displaying messages
function stripWatchingPrefix(text: string): string {
  return text.replace(/^\[watching:[^\]]*\]\s*/i, "").trim();
}

// ── Severity badge ────────────────────────────────────────────────────────────

type SeverityLevel = "CRITICAL" | "WARNING" | "INFO" | null;

function getSeverity(content: string): SeverityLevel {
  const lower = content.toLowerCase();

  const hasNoData =
    lower.includes("unavailable") ||
    lower.includes("no specific") ||
    lower.includes("cannot provide") ||
    lower.includes("not clear");
  if (hasNoData) return "INFO";

  const isCritical =
    (lower.includes("hijack") ||
      lower.includes("shutdown") ||
      lower.includes("disconnection")) &&
    !lower.includes("no hijack");
  if (isCritical) return "CRITICAL";

  const isWarning =
    lower.includes("anomaly") ||
    lower.includes("outage") ||
    lower.includes("leak") ||
    lower.includes("elevated");
  if (isWarning) return "WARNING";

  return null;
}

// ── Tool-call JSON filter ─────────────────────────────────────────────────────

function shouldHide(content: string): boolean {
  if (!content || typeof content !== "string") return false;
  const trimmed = content.trim();
  return (
    trimmed.startsWith('{"type": "function"') ||
    trimmed.startsWith('{"type":"function"') ||
    (trimmed.startsWith("{") &&
      trimmed.includes('"name":') &&
      trimmed.includes('"parameters":'))
  );
}

function isToolCallMessage(parts: MessagePart[]): boolean {
  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("");
  return shouldHide(text);
}

// ── Text extraction ───────────────────────────────────────────────────────────

function extractText(parts: MessagePart[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("\n");
}

// ── Session management ────────────────────────────────────────────────────────

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

// ── Stats ─────────────────────────────────────────────────────────────────────

interface Stats { routes: string; outages: string; updated: string }

async function fetchStats(): Promise<Stats> {
  try {
    const res = await fetch("/api/stats");
    if (!res.ok) throw new Error("stats failed");
    return await res.json() as Stats;
  } catch {
    return { routes: "—", outages: "—", updated: new Date().toLocaleTimeString() };
  }
}

// ── Follow-up chips ───────────────────────────────────────────────────────────

function getFollowUps(text: string): string[] {
  const t = text.toLowerCase();
  if (t.includes("hijack") || t.includes("bgp"))
    return ["Show route leaks too", "Which ASNs are most affected?", "How long do hijacks usually last?"];
  if (t.includes("outage") || t.includes("broken") || t.includes("disruption"))
    return ["Which regions are affected?", "Any BGP issues related?", "Show internet health status"];
  if (t.includes("health") || t.includes("routing table"))
    return ["Are there any active outages?", "Show BGP hijack events", "Traffic anomalies today"];
  if (t.includes("traffic") || t.includes("anomal") || t.includes("asia"))
    return ["Show BGP hijacks", "Any outages in those regions?", "Global internet health"];
  if (t.includes("leak") || t.includes("route leak"))
    return ["Show BGP hijacks too", "Which ASNs are leaking?", "Internet health status"];
  return ["Any BGP hijacks today?", "Show recent outages", "Global internet health"];
}

// ── App ───────────────────────────────────────────────────────────────────────

export function App({ navigate = (p: string) => { window.location.href = p; } }: { navigate?: (path: string) => void }) {
  const [sessionId, setSessionId] = useState(getSessionId);
  const [input, setInput] = useState("");
  const [hasStarted, setHasStarted] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats & { loaded: boolean }>({
    routes: "—", outages: "—", updated: "—", loaded: false,
  });

  // Watchlist state
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(loadWatchlist);
  const [showWatchlistPanel, setShowWatchlistPanel] = useState(false);

  // Incident loading steps
  const [incidentSteps, setIncidentSteps] = useState<string[]>([]);
  const incidentTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Email subscribe form
  const [showSubscribeForm, setShowSubscribeForm] = useState(false);
  const [digestEmail, setDigestEmail] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const agent = useAgent({ agent: "ChatAgent", name: sessionId });
  const { messages, sendMessage, status, clearHistory } = useAgentChat({ agent });

  const isLoading = status === "submitted" || status === "streaming";
  const isConnected = status !== "error";

  const visibleMessages = messages.filter(
    (m) => !(m.role === "assistant" && isToolCallMessage(m.parts as MessagePart[]))
  );
  const showChips = !hasStarted && visibleMessages.length === 0 && !isLoading;

  // Load + auto-refresh stats
  useEffect(() => {
    const load = () => fetchStats().then((s) => setStats({ ...s, loaded: true }));
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Clear incident loading steps when response arrives
  useEffect(() => {
    if (!isLoading) {
      incidentTimers.current.forEach(clearTimeout);
      setIncidentSteps([]);
    }
  }, [isLoading]);

  const showToast = useCallback((msg: string, duration = 2500) => {
    setToast(msg);
    setTimeout(() => setToast(null), duration);
  }, []);

  // ── Watchlist management ────────────────────────────────────────────────────

  const addToWatchlist = useCallback((value: string) => {
    const item = makeWatchlistItem(value);
    setWatchlist((prev) => {
      if (prev.some(w => w.value.toLowerCase() === item.value.toLowerCase())) return prev;
      const next = [...prev, item];
      saveWatchlist(next);
      return next;
    });
  }, []);

  const removeFromWatchlist = useCallback((id: string) => {
    setWatchlist((prev) => {
      const next = prev.filter(w => w.id !== id);
      saveWatchlist(next);
      return next;
    });
  }, []);

  const clearWatchlistAll = useCallback(() => {
    setWatchlist([]);
    saveWatchlist([]);
  }, []);

  // ── Send message ────────────────────────────────────────────────────────────

  const handleSend = useCallback((text?: string) => {
    const raw = (text ?? input).trim();
    if (!raw || isLoading) return;

    // Handle watchlist commands client-side (no LLM needed for show/remove/clear)
    const cmd = parseWatchlistCommand(raw);
    if (cmd) {
      if (cmd.action === "show") {
        setShowWatchlistPanel(true);
        setHasStarted(true);
        setInput("");
        return;
      }
      if (cmd.action === "add" && cmd.value) {
        addToWatchlist(cmd.value);
        showToast(`👁 Watching ${cmd.value}`);
        // Fall through — also send to server for LLM confirmation
      }
      if (cmd.action === "remove" && cmd.value) {
        setWatchlist((prev) => {
          const next = prev.filter(
            w => w.value.toLowerCase() !== cmd.value!.toLowerCase()
          );
          saveWatchlist(next);
          return next;
        });
        showToast(`Removed ${cmd.value} from watchlist`);
        setInput("");
        setHasStarted(true);
        return;
      }
      if (cmd.action === "clear") {
        clearWatchlistAll();
        showToast("Watchlist cleared");
        setInput("");
        setHasStarted(true);
        return;
      }
    }

    // Animate incident loading steps
    if (isIncidentReportRequest(raw)) {
      incidentTimers.current.forEach(clearTimeout);
      setIncidentSteps([]);
      incidentTimers.current = [
        setTimeout(() => setIncidentSteps(["Fetching outages... ✓"]), 600),
        setTimeout(() => setIncidentSteps((s) => [...s, "Fetching BGP hijacks... ✓"]), 1400),
        setTimeout(() => setIncidentSteps((s) => [...s, "Fetching route leaks... ✓"]), 2200),
        setTimeout(() => setIncidentSteps((s) => [...s, "Synthesizing timeline..."]), 2800),
      ];
    }

    // Inject watchlist context as [watching:X,Y,Z] prefix (stripped in UI display)
    const meta = watchlist.length > 0
      ? `[watching:${watchlist.map(w => w.value).join(",")}] `
      : "";
    sendMessage({ text: `${meta}${raw}` });

    setInput("");
    setHasStarted(true);
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [input, isLoading, sendMessage, watchlist, addToWatchlist, clearWatchlistAll, showToast]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  const handleNewChat = useCallback(() => {
    clearHistory();
    setSessionId(newSessionId());
    setInput("");
    setHasStarted(false);
    setIncidentSteps([]);
    incidentTimers.current.forEach(clearTimeout);
  }, [clearHistory]);

  const handleCopy = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      showToast("Copied to clipboard!");
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, [showToast]);

  const handleSubscribeSubmit = useCallback(() => {
    const email = digestEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast("Please enter a valid email address");
      return;
    }
    handleSend(`Subscribe ${email} to digest`);
    setShowSubscribeForm(false);
    setDigestEmail("");
  }, [digestEmail, handleSend, showToast]);

  // Last completed agent message (for follow-up chips)
  const lastAgentMsg = !isLoading
    ? [...visibleMessages].reverse().find((m) => m.role === "assistant")
    : null;
  const followUps = lastAgentMsg
    ? getFollowUps(extractText(lastAgentMsg.parts as MessagePart[]))
    : null;

  return (
    <div className="app">
      <div className="grid-bg" aria-hidden="true" />

      {toast && <div className="toast">{toast}</div>}

      {/* ── Watchlist panel ────────────────────────────────────────── */}
      {showWatchlistPanel && (
        <div className="watchlist-overlay" onClick={() => setShowWatchlistPanel(false)}>
          <div className="watchlist-panel" onClick={(e) => e.stopPropagation()}>
            <div className="watchlist-panel-header">
              <span className="watchlist-panel-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke="#f6821f" strokeWidth="2" />
                  <circle cx="12" cy="12" r="3.5" fill="#f6821f" />
                </svg>
                My Watchlist
              </span>
              <button className="watchlist-close" onClick={() => setShowWatchlistPanel(false)}>✕</button>
            </div>

            {watchlist.length === 0 ? (
              <p className="watchlist-empty">
                No items yet.<br />
                Say <code>"Watch AS13335"</code> or <code>"Monitor Brazil"</code> to add items.
                I'll flag any Radar events that match.
              </p>
            ) : (
              <>
                <ul className="watchlist-items">
                  {watchlist.map((item) => (
                    <li key={item.id} className="watchlist-item">
                      <span className={`watchlist-type watchlist-type-${item.type}`}>
                        {item.type === "asn" ? "ASN" : "🌍"}
                      </span>
                      <span className="watchlist-value">{item.value}</span>
                      <button
                        className="watchlist-remove"
                        onClick={() => removeFromWatchlist(item.id)}
                        aria-label={`Remove ${item.value}`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
                <button className="watchlist-clear-btn" onClick={() => { clearWatchlistAll(); showToast("Watchlist cleared"); }}>
                  Clear all
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="container">

        {/* ── Header ──────────────────────────────────────────────── */}
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
            {/* Watchlist pill — visible when items exist */}
            {watchlist.length > 0 && (
              <button className="watchlist-pill" onClick={() => setShowWatchlistPanel(true)}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="12" r="3" fill="currentColor" />
                </svg>
                {watchlist.slice(0, 2).map(w => w.value).join(", ")}
                {watchlist.length > 2 && ` +${watchlist.length - 2}`}
              </button>
            )}

            {/* Watchlist button — always available */}
            <button
              className="new-chat-btn"
              onClick={() => setShowWatchlistPanel(true)}
              aria-label="My Watchlist"
              title="My Watchlist"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
              Watchlist
            </button>

            {/* About link */}
            <button className="new-chat-btn" onClick={() => navigate("/about")} aria-label="About">
              About
            </button>

            {visibleMessages.length > 0 && (
              <button className="new-chat-btn" onClick={handleNewChat} aria-label="New chat">
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

        {/* ── Loading indicator ────────────────────────────────────── */}
        {isLoading && (
          <div className="tool-indicator">
            {incidentSteps.length > 0 ? (
              <div className="incident-loading">
                {incidentSteps.map((step, i) => (
                  <span
                    key={i}
                    className={`incident-step ${i === incidentSteps.length - 1 && !step.endsWith("✓") ? "incident-step-active" : "incident-step-done"}`}
                  >
                    {step}
                  </span>
                ))}
              </div>
            ) : (
              <>
                <div className="tool-pulse" aria-hidden="true" />
                <span>Querying Cloudflare Radar...</span>
              </>
            )}
          </div>
        )}

        {/* ── Chat area ───────────────────────────────────────────── */}
        <main className="chat-area">
          {visibleMessages.length === 0 && !isLoading ? (
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
                Ask about outages, BGP hijacks, route leaks, or traffic anomalies.
                Live data from Cloudflare Radar, explained in plain English.
              </p>
              <div className="suggestions">
                {QUERY_CHIPS.slice(0, 4).map((q) => (
                  <button key={q} className="suggestion-chip" onClick={() => handleSend(q)}>{q}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {visibleMessages.map((msg, idx) => {
                const isLastMsg = idx === visibleMessages.length - 1;
                const parts = msg.parts as MessagePart[];
                const rawText = extractText(parts);
                // Strip watchlist meta prefix from user messages before display
                const plainText = msg.role === "user" ? stripWatchingPrefix(rawText) : rawText;

                const severityLevel = msg.role === "assistant" ? getSeverity(plainText) : null;
                const isWatchlistAlert = msg.role === "assistant" && plainText.includes("WATCHLIST ALERT");
                const isIncidentReport = msg.role === "assistant" && plainText.includes("# Incident Report:");

                return (
                  <React.Fragment key={msg.id}>
                    <div className={[
                      "message",
                      msg.role === "user" ? "message-user" : "message-agent",
                      isWatchlistAlert ? "message-watchlist-alert" : "",
                      isIncidentReport ? "message-incident" : "",
                    ].filter(Boolean).join(" ")}>

                      {msg.role === "assistant" && (
                        <div className="agent-header">
                          <div className="agent-label">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <circle cx="12" cy="12" r="10" stroke="#f6821f" strokeWidth="2" strokeDasharray="2 3" />
                              <circle cx="12" cy="12" r="2.5" fill="#f6821f" />
                            </svg>
                            <span>Faultline</span>
                            {isWatchlistAlert && (
                              <span className="alert-indicator">🔴 WATCHLIST MATCH</span>
                            )}
                          </div>
                          <div className="agent-actions">
                            {severityLevel && (
                              <span className={`severity-badge severity-${severityLevel.toLowerCase()}`}>
                                {severityLevel === "CRITICAL" && "⚠ Critical"}
                                {severityLevel === "WARNING" && "⚡ Warning"}
                                {severityLevel === "INFO" && "ℹ Info"}
                              </span>
                            )}
                            {plainText && (
                              <button
                                className="copy-btn"
                                onClick={() => handleCopy(msg.id, plainText)}
                                aria-label="Copy response"
                                title="Copy"
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
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="message-bubble">
                        {msg.role === "user"
                          ? renderFormattedText(plainText)
                          : renderParts(parts)}
                      </div>

                      {/* Incident report action buttons */}
                      {isIncidentReport && !isLoading && (
                        <div className="incident-actions">
                          <button
                            className="incident-btn"
                            onClick={() => handleCopy(msg.id + "-report", plainText)}
                          >
                            {copiedId === msg.id + "-report" ? "✓ Copied!" : "📋 Copy Report"}
                          </button>
                          <button
                            className="incident-btn"
                            onClick={() => downloadMarkdown(
                              plainText,
                              `incident-report-${extractIncidentSubjectFromReport(plainText).replace(/\s+/g, "-").toLowerCase()}.md`
                            )}
                          >
                            ⬇ Download .md
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Follow-up chips after last agent reply */}
                    {msg.role === "assistant" && isLastMsg && !isLoading && followUps && (
                      <div className="followup-row">
                        {followUps.map((q) => (
                          <button key={q} className="followup-chip" onClick={() => handleSend(q)}>{q}</button>
                        ))}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}

              {isLoading && (
                <div className="message message-agent">
                  <div className="agent-header">
                    <div className="agent-label">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" stroke="#f6821f" strokeWidth="2" strokeDasharray="2 3" />
                        <circle cx="12" cy="12" r="2.5" fill="#f6821f" />
                      </svg>
                      <span>Faultline</span>
                    </div>
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

        {/* ── Input + chips ─────────────────────────────────────────── */}
        <footer className="input-area">
          {showChips && (
            <div className="query-chips">
              {QUERY_CHIPS.map((q) => (
                <button key={q} className="query-chip" onClick={() => handleSend(q)}>{q}</button>
              ))}
            </div>
          )}

          <div className="input-wrapper">
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder='Ask about outages, BGP hijacks... or "Watch AS13335" to track an ASN'
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
              aria-label="Chat message"
            />
            <button
              className="send-btn"
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              aria-label="Send"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Email digest subscribe */}
          <div className="footer-row">
            {!showSubscribeForm ? (
              <button className="digest-link" onClick={() => setShowSubscribeForm(true)}>
                📧 Get daily digest
              </button>
            ) : (
              <div className="subscribe-form">
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={digestEmail}
                  onChange={(e) => setDigestEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubscribeSubmit(); }}
                  className="email-input"
                  autoFocus
                />
                <button className="subscribe-btn" onClick={handleSubscribeSubmit}>Subscribe</button>
                <button
                  className="cancel-link"
                  onClick={() => { setShowSubscribeForm(false); setDigestEmail(""); }}
                >
                  Cancel
                </button>
              </div>
            )}
            <p className="input-footer-text">
              Cloudflare Workers AI · Llama 3.3 · Real-time Radar
            </p>
          </div>
        </footer>

        {/* ── Status bar ─────────────────────────────────────────────── */}
        <div className="status-bar">
          <div className="metric-card">
            <span className="metric-label">Global BGP Routes</span>
            <span className="metric-value">
              {stats.loaded ? stats.routes : <span className="metric-loading" />}
            </span>
          </div>
          <div className="metric-divider" aria-hidden="true" />
          <div className="metric-card">
            <span className="metric-label">Active Outages</span>
            <span className="metric-value">
              {stats.loaded ? stats.outages : <span className="metric-loading" />}
            </span>
          </div>
          <div className="metric-divider" aria-hidden="true" />
          <div className="metric-card">
            <span className="metric-label">Last Updated</span>
            <span className="metric-value metric-time">
              {stats.loaded
                ? new Date(stats.updated).toLocaleTimeString()
                : <span className="metric-loading" />}
            </span>
          </div>
        </div>

        {/* ── Footer badge ─────────────────────────────────────────────── */}
        <FooterBadge onCopyEmail={showToast} />

      </div>
    </div>
  );
}

// ── Types + rendering ─────────────────────────────────────────────────────────

type MessagePart =
  | { type: "text"; text: string }
  | { type: "step-start" }
  | { type: "reasoning" }
  | { type: string; toolName?: string; state?: string };

function renderParts(parts: MessagePart[]): React.ReactNode {
  return parts.map((part, i) => {
    if (part.type === "text") {
      const text = (part as { type: "text"; text: string }).text;
      if (shouldHide(text)) return null;
      return <div key={i} className="part-text">{renderFormattedText(text)}</div>;
    }
    return null;
  });
}

function renderFormattedText(text: string): React.ReactNode {
  return text.split("\n").map((line, i) => {
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
    if (line.startsWith("# ")) {
      return <p key={i} className="msg-h1">{line.slice(2)}</p>;
    }
    if (line.startsWith("## ") || line.startsWith("### ")) {
      return <p key={i} className="msg-heading">{line.replace(/^#{2,3}\s/, "")}</p>;
    }
    if (line.startsWith("---")) {
      return <hr key={i} className="msg-hr" />;
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
