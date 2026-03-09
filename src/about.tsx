// Faultline /about — Incident Report: Kartik Chaudhary
// Matches Faultline's exact dark aesthetic.

import React, { useState, useEffect, useRef, useCallback } from "react";
import { FooterBadge } from "./footer-badge";

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconEmail = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
);
const IconLinkedIn = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);
const IconGitHub = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
  </svg>
);
const IconGlobe = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);

// ── Count-up component ────────────────────────────────────────────────────────

function CountUp({ to, suffix = "", started }: { to: number; suffix?: string; started: boolean }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!started) return;
    let frame = 0;
    const total = 55;
    const id = setInterval(() => {
      frame++;
      const ease = 1 - Math.pow(1 - frame / total, 3);
      setVal(Math.floor(ease * to));
      if (frame >= total) { setVal(to); clearInterval(id); }
    }, 20);
    return () => clearInterval(id);
  }, [started, to]);
  return <>{val.toLocaleString()}{suffix}</>;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

interface Stats { routes: string; outages: string; updated: string }

async function fetchStats(): Promise<Stats> {
  try {
    const res = await fetch("/api/stats");
    if (!res.ok) throw new Error();
    return await res.json() as Stats;
  } catch {
    return { routes: "—", outages: "—", updated: new Date().toLocaleTimeString() };
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────

const LANGUAGES = ["Python", "TypeScript", "JavaScript", "Go", "Rust", "C/C++"];
const CF_TAGS = ["Cloudflare Workers", "Agents SDK", "Durable Objects", "Radar API"];
const STACK = ["Cloudflare Workers", "Agents SDK", "Durable Objects", "Radar API", "React", "PostgreSQL", "AWS", "Docker", "Git"];

// ── AboutPage ─────────────────────────────────────────────────────────────────

interface AboutPageProps {
  navigate: (path: string) => void;
}

export function AboutPage({ navigate }: AboutPageProps) {
  const [toast, setToast] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats & { loaded: boolean }>({ routes: "—", outages: "—", updated: "—", loaded: false });
  const [metricsStarted, setMetricsStarted] = useState(false);
  const metricsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { document.title = "Kartik Chaudhary · Faultline"; }, []);

  useEffect(() => {
    fetchStats().then(s => setStats({ ...s, loaded: true }));
  }, []);

  // Trigger count-up when metrics scroll into view
  useEffect(() => {
    const el = metricsRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setMetricsStarted(true); obs.disconnect(); } }, { threshold: 0.2 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const copyEmail = useCallback(() => {
    navigator.clipboard.writeText("chaudhary417@usf.edu").then(() => showToast("Copied! chaudhary417@usf.edu"));
  }, [showToast]);

  return (
    <div className="app">
      <div className="grid-bg" aria-hidden="true" />
      {toast && <div className="toast">{toast}</div>}

      <div className="container about-container">

        {/* ── Header ──────────────────────────────────────── */}
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
            <button className="new-chat-btn" onClick={() => navigate("/")} aria-label="Back to Faultline">
              ← Back
            </button>
          </div>
        </header>

        {/* ── Breadcrumb ───────────────────────────────────── */}
        <div className="breadcrumb">
          <button onClick={() => navigate("/")} className="breadcrumb-link">
            ← Back to Faultline
          </button>
          <span className="breadcrumb-sep">/</span>
          <span className="breadcrumb-cur">About</span>
        </div>

        <div className="about-content">

          {/* ══ SECTION 1: STATUS + TITLE ══════════════════ */}
          <div className="about-card about-title-card">
            <div className="about-status-row">
              <span className="about-available-badge">🟢 AVAILABLE</span>
            </div>
            <h1 className="about-h1">Incident Report: Kartik Chaudhary</h1>
            <p className="about-generated">Generated: March 2026 · USF Tampa, FL</p>
          </div>

          {/* ══ SECTION 2: SUMMARY ═════════════════════════ */}
          <div className="about-card">
            <h2 className="about-section-heading">## Summary</h2>
            <p className="about-body">
              CS student at the University of South Florida building production systems at internet scale.
              Built Faultline in <strong>3 hours</strong> entirely on Cloudflare&apos;s native stack as part of a SWE internship application.
              Seeking Summer 2026 Software Engineering Internship.
            </p>
          </div>

          {/* ══ SECTION 3: TIMELINE ════════════════════════ */}
          <div className="about-card">
            <h2 className="about-section-heading">## Timeline</h2>
            <div className="timeline">

              <div className="timeline-entry">
                <div className="timeline-dot" />
                <div className="timeline-meta">
                  <span className="timeline-date">May 2023</span>
                </div>
                <div className="timeline-body">
                  <div className="timeline-role">Testing Associate · <span className="timeline-company">Capgemini</span></div>
                  <div className="timeline-detail">Resolved 30+ defects · SQL integrity · Python automation · QA systems</div>
                </div>
              </div>

              <div className="timeline-entry">
                <div className="timeline-dot" />
                <div className="timeline-meta">
                  <span className="timeline-date">May 2024</span>
                </div>
                <div className="timeline-body">
                  <div className="timeline-role">Software Engineer · <span className="timeline-company">Vivint</span></div>
                  <div className="timeline-detail">Scaled Go/Rust systems to 500k+ users · IoT telemetry · real-time pipelines</div>
                </div>
              </div>

              <div className="timeline-entry">
                <div className="timeline-dot" />
                <div className="timeline-meta">
                  <span className="timeline-date">Jun 2025</span>
                </div>
                <div className="timeline-body">
                  <div className="timeline-role">Software Development Intern · <span className="timeline-company">Citi</span></div>
                  <div className="timeline-detail">Python/C++ pipelines · 1k+ analysts · 99.9% reliability · fraud systems</div>
                </div>
              </div>

              <div className="timeline-entry timeline-entry-current">
                <div className="timeline-dot timeline-dot-current" />
                <div className="timeline-meta">
                  <span className="timeline-date">Mar 2026</span>
                </div>
                <div className="timeline-body">
                  <div className="timeline-role">
                    Built Faultline · <span className="timeline-here-pill">YOU ARE HERE</span>
                  </div>
                  <div className="timeline-detail">
                    Cloudflare Workers · Agents SDK · Durable Objects · Radar API<br />
                    Shipped in <strong>3 hours</strong>
                  </div>
                  <a
                    href="https://faultline.kartikchoudhary085.workers.dev"
                    target="_blank"
                    rel="noreferrer"
                    className="timeline-live-link"
                  >
                    <span className="timeline-live-dot" /> LIVE — faultline.kartikchoudhary085.workers.dev
                  </a>
                </div>
              </div>

            </div>
          </div>

          {/* ══ SECTION 4: IMPACT METRICS ══════════════════ */}
          <div className="about-card" ref={metricsRef}>
            <h2 className="about-section-heading">## Impact</h2>
            <div className="about-metrics-grid">
              <div className="about-metric">
                <span className="about-metric-num">
                  <CountUp to={500} suffix="k+" started={metricsStarted} />
                </span>
                <span className="about-metric-label">USERS SERVED</span>
                <span className="about-metric-sub">@ Vivint</span>
              </div>
              <div className="about-metric">
                <span className="about-metric-num">
                  <CountUp to={1} suffix="k+" started={metricsStarted} />
                </span>
                <span className="about-metric-label">ANALYSTS</span>
                <span className="about-metric-sub">@ Citi</span>
              </div>
              <div className="about-metric">
                <span className="about-metric-num">
                  <CountUp to={150} suffix="+" started={metricsStarted} />
                </span>
                <span className="about-metric-label">STUDENTS LED</span>
                <span className="about-metric-sub">AI Society</span>
              </div>
              <div className="about-metric">
                <span className="about-metric-num">
                  <CountUp to={3} started={metricsStarted} />
                </span>
                <span className="about-metric-label">PROD SYSTEMS</span>
                <span className="about-metric-sub">in production</span>
              </div>
            </div>
          </div>

          {/* ══ SECTION 5: TECHNICAL STACK ═════════════════ */}
          <div className="about-card">
            <h2 className="about-section-heading">## Technical Stack</h2>
            <div className="tag-group">
              <p className="tag-group-label">Languages</p>
              <div className="tag-row">
                {LANGUAGES.map(t => <span key={t} className="tag">{t}</span>)}
              </div>
            </div>
            <div className="tag-group" style={{ marginTop: "10px" }}>
              <p className="tag-group-label">Stack</p>
              <div className="tag-row">
                {STACK.map(t => (
                  <span key={t} className={`tag ${CF_TAGS.includes(t) ? "tag-cf" : ""}`}>{t}</span>
                ))}
              </div>
            </div>
          </div>

          {/* ══ SECTION 6: PROJECTS ════════════════════════ */}
          <div className="about-card">
            <h2 className="about-section-heading">## Projects</h2>
            <div className="projects-grid">

              <div className="project-card">
                <div className="project-live-row">
                  <span className="project-live">● LIVE</span>
                  <span className="project-name">NavAI</span>
                </div>
                <div className="project-divider" />
                <p className="project-desc">
                  Production agentic macOS automation system.<br />
                  50+ workflows automated.
                </p>
                <div className="tag-row" style={{ marginTop: "8px" }}>
                  {["TypeScript", "Python", "LLM APIs", "RAG"].map(t => <span key={t} className="tag">{t}</span>)}
                </div>
                <div className="project-divider" />
                <div className="project-btns">
                  <a href="https://getnav.app" target="_blank" rel="noreferrer" className="project-btn">
                    <IconGlobe /> View Live
                  </a>
                  <a href="https://github.com/Chaudhary-CS" target="_blank" rel="noreferrer" className="project-btn">
                    <IconGitHub /> GitHub
                  </a>
                </div>
              </div>

              <div className="project-card">
                <div className="project-live-row">
                  <span className="project-live">● LIVE</span>
                  <span className="project-name">Faultline</span>
                </div>
                <div className="project-divider" />
                <p className="project-desc">
                  Internet intelligence agent built for this<br />
                  Cloudflare application. Shipped in 3hrs.
                </p>
                <div className="tag-row" style={{ marginTop: "8px" }}>
                  {["Workers", "Agents SDK", "Durable Objects", "Radar"].map(t => (
                    <span key={t} className="tag tag-cf">{t}</span>
                  ))}
                </div>
                <div className="project-divider" />
                <div className="project-btns">
                  <a href="https://faultline.kartikchoudhary085.workers.dev" target="_blank" rel="noreferrer" className="project-btn">
                    <IconGlobe /> View Live
                  </a>
                  <a href="https://github.com/Chaudhary-CS/cf_ai_Faultline" target="_blank" rel="noreferrer" className="project-btn">
                    <IconGitHub /> GitHub
                  </a>
                </div>
              </div>

            </div>
          </div>

          {/* ══ SECTION 7: CURRENT STATUS CTA ══════════════ */}
          <div className="cta-card">
            <h2 className="about-section-heading" style={{ marginBottom: "16px" }}>## Current Status: ACTIVELY SEEKING</h2>
            <div className="cta-grid">
              <div className="cta-info">
                {[
                  ["Available", "Summer 2026"],
                  ["Location", "Tampa, FL → Austin, TX → Anywhere"],
                  ["Response", "< 24 hours"],
                  ["GPA", "3.7 · Dean's List"],
                  ["Graduation", "December 2026"],
                ].map(([k, v]) => (
                  <div key={k} className="cta-row">
                    <span className="cta-key">{k}</span>
                    <span className="cta-val">{v}</span>
                  </div>
                ))}
              </div>

              <div className="cta-actions">
                <a href="mailto:chaudhary417@usf.edu" className="cta-btn">
                  <IconEmail /> Email Me
                </a>
                <a href="https://linkedin.com/in/Chaudhary-CS" target="_blank" rel="noreferrer" className="cta-btn">
                  <IconLinkedIn /> LinkedIn
                </a>
                <a href="https://github.com/Chaudhary-CS" target="_blank" rel="noreferrer" className="cta-btn">
                  <IconGitHub /> GitHub
                </a>
                <p className="cta-site">
                  <a href="https://getnav.app" target="_blank" rel="noreferrer" className="cta-site-link">
                    <IconGlobe /> getnav.app
                  </a>
                </p>
              </div>
            </div>
          </div>

          {/* ══ SECTION 8: EDUCATION ═══════════════════════ */}
          <div className="about-card">
            <h2 className="about-section-heading">## Education</h2>
            <div className="edu-row">
              <div className="edu-main">
                <div className="edu-school">University of South Florida</div>
                <div className="edu-degree">B.S. Computer Science · GPA 3.7 · Dec 2026</div>
              </div>
            </div>
            <div className="edu-badges">
              {["Dean's List", "Green & Gold Presidential Scholar", "Co-Founder AI Society at USF · $120k budget · 150+ students", "Microsoft Student Ambassador", "VP SASE"].map(b => (
                <span key={b} className="edu-badge">{b}</span>
              ))}
            </div>
          </div>

        </div>{/* end about-content */}

        {/* ── Stats bar ─────────────────────────────────── */}
        <div className="status-bar">
          <div className="metric-card">
            <span className="metric-label">Global BGP Routes</span>
            <span className="metric-value">{stats.loaded ? stats.routes : <span className="metric-loading" />}</span>
          </div>
          <div className="metric-divider" />
          <div className="metric-card">
            <span className="metric-label">Active Outages</span>
            <span className="metric-value">{stats.loaded ? stats.outages : <span className="metric-loading" />}</span>
          </div>
          <div className="metric-divider" />
          <div className="metric-card">
            <span className="metric-label">Last Updated</span>
            <span className="metric-value metric-time">
              {stats.loaded ? new Date(stats.updated).toLocaleTimeString() : <span className="metric-loading" />}
            </span>
          </div>
        </div>

        {/* ── Footer badge ───────────────────────────────── */}
        <FooterBadge onCopyEmail={showToast} />

        <p className="about-credits">
          *This report was generated by Faultline*<br />
          Powered by Cloudflare Workers · Built by Kartik Chaudhary
        </p>

      </div>
    </div>
  );
}
