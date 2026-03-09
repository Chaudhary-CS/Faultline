// FooterBadge — expandable contact card used on both main page and /about

import React, { useState, useRef, useEffect, useCallback } from "react";

// ── SVG icons ─────────────────────────────────────────────────────────────────

const IconEmail = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
);

const IconLinkedIn = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);

const IconGitHub = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
  </svg>
);

const IconGlobe = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);

// ── Component ─────────────────────────────────────────────────────────────────

interface FooterBadgeProps {
  onCopyEmail: (msg: string) => void;
}

export function FooterBadge({ onCopyEmail }: FooterBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  const copyEmail = useCallback(() => {
    navigator.clipboard.writeText("chaudhary417@usf.edu").then(() => {
      onCopyEmail("Copied! chaudhary417@usf.edu");
    });
  }, [onCopyEmail]);

  return (
    <div className="footer-badge-wrap" ref={cardRef}>
      {/* Collapsed: single line */}
      <button
        className={`footer-badge-line ${expanded ? "footer-badge-line-hidden" : ""}`}
        onClick={() => setExpanded(true)}
        aria-label="View contact info"
      >
        Built by Kartik Chaudhary · Cloudflare SWE Intern Candidate 2026 ·{" "}
        <span className="footer-badge-cta">→ Let&apos;s talk</span>
      </button>

      {/* Expanded: contact card */}
      {expanded && (
        <div className="contact-card">
          <div className="contact-header-row">
            <div className="contact-name-wrap">
              <span className="contact-live-dot" />
              <span className="contact-name">KARTIK CHAUDHARY</span>
            </div>
            <button className="contact-close" onClick={() => setExpanded(false)} aria-label="Close">✕</button>
          </div>

          <p className="contact-sub">CS Student · USF · Dec 2026</p>

          <div className="contact-divider" />

          <p className="contact-build">
            Built Faultline in <strong>3hrs</strong> on Cloudflare
          </p>
          <p className="contact-stack-text">
            Workers · Agents SDK · Durable Objects · Radar API · Cron Triggers
          </p>

          <div className="contact-divider" />

          <div className="contact-links">
            <a href="mailto:chaudhary417@usf.edu" className="contact-link">
              <IconEmail /> chaudhary417@usf.edu
            </a>
            <a href="https://linkedin.com/in/Chaudhary-CS" target="_blank" rel="noreferrer" className="contact-link">
              <IconLinkedIn /> linkedin.com/in/Chaudhary-CS
            </a>
            <a href="https://github.com/Chaudhary-CS" target="_blank" rel="noreferrer" className="contact-link">
              <IconGitHub /> github.com/Chaudhary-CS
            </a>
            <a href="https://getnav.app" target="_blank" rel="noreferrer" className="contact-link">
              <IconGlobe /> getnav.app
            </a>
          </div>

          <div className="contact-divider" />

          <div className="contact-buttons">
            <button className="contact-btn" onClick={copyEmail}>
              <IconEmail /> Copy Email
            </button>
            <a href="https://linkedin.com/in/Chaudhary-CS" target="_blank" rel="noreferrer" className="contact-btn">
              <IconLinkedIn /> LinkedIn
            </a>
            <a href="https://github.com/Chaudhary-CS" target="_blank" rel="noreferrer" className="contact-btn">
              <IconGitHub /> GitHub
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
