"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, session, Unauthorized } from "@/lib/triage";

type Stats = { cases: number; open: number; byLevel: Record<string, number> };

/** Sidebar, header KPIs and the shared-token gate around every console page. */
export function Shell({ children, refresh = 0 }: { children: (fail: (e: unknown) => void) => ReactNode; refresh?: number }) {
  const path = usePathname();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const fail = useCallback((e: unknown) => {
    if (e instanceof Unauthorized) {
      session.clear();
      setAuthed(false);
    } else setError(e instanceof Error ? e.message : String(e));
  }, []);

  useEffect(() => {
    (session.token() ? api<Stats>("/stats") : Promise.reject(new Unauthorized()))
      .then((s) => {
        setStats(s);
        setAuthed(true);
      })
      .catch(fail);
  }, [fail, refresh, attempt]);

  if (authed === false) return <SignIn onDone={() => { setAuthed(null); setAttempt((a) => a + 1); }} />;
  if (authed === null) return <div className="tri"><p className="loading">Loading…</p></div>;

  const nav = [
    { href: "/triage", label: "Triage", on: path === "/triage", badge: stats?.open, icon: <path d="M4 12h4l3-7 4 14 3-7h2" /> },
    { href: "/triage/faces", label: "Faces", on: path.startsWith("/triage/faces"),
      icon: <><circle cx="12" cy="9" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></> },
    { href: "/triage/audit", label: "Audit trail", on: path.startsWith("/triage/audit"), icon: <path d="M7 3h8l4 4v14H7zM10 11h6M10 15h6M10 7h3" /> },
    { href: "/", label: "Lab", on: false, icon: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></> },
  ];
  const name = session.analyst();

  return (
    <div className="tri">
      <aside className="side">
        <div className="brand"><span className="mark" />Attest</div>
        <nav>
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={n.on ? "on" : ""}>
              <svg viewBox="0 0 24 24">{n.icon}</svg>
              {n.label}
              {n.badge ? <b>{n.badge}</b> : null}
            </Link>
          ))}
        </nav>
        <div className="me">
          <span className="avatar">{name.slice(0, 2).toUpperCase()}</span>
          <div><strong>{name}</strong><small>L1 Analyst</small></div>
          <form><button type="button" title="Sign out" onClick={() => { session.clear(); setAuthed(false); }}>⎋</button></form>
        </div>
      </aside>
      <main className="main">
        <header className="top">
          <div>
            <h1>AI-Assisted L1 Identity Fraud Triage</h1>
            <p>Every signal from the phone, verified server-side, with a recommendation and a clear next step.</p>
          </div>
          <div className="kpis">
            <div><span className="k-ic">⚡</span><strong>{stats?.cases ?? 0}</strong><small>sessions</small></div>
            <div><span className="k-ic">⏳</span><strong>{stats?.open ?? 0}</strong><small>awaiting a human</small></div>
            <div><span className="k-ic">⛨</span><strong>{stats?.byLevel?.HIGH ?? 0}</strong><small>high risk</small></div>
          </div>
        </header>
        {error ? <div className="err-banner">{error}</div> : null}
        {children(fail)}
      </main>
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [name, setName] = useState(session.analyst() === "analyst" ? "" : session.analyst());
  const [err, setErr] = useState(false);
  return (
    <div className="tri login">
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          session.set(token.trim(), name.trim() || "analyst");
          try {
            await api("/stats");
            onDone();
          } catch {
            session.clear();
            setErr(true);
          }
        }}
      >
        <div className="brand dark"><span className="mark" />Attest</div>
        <h2>L1 fraud triage</h2>
        {err ? <p className="err">Wrong token, or the API is not reachable.</p> : null}
        <label>Your name (for the audit trail)<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label>Analyst token<input type="password" value={token} onChange={(e) => setToken(e.target.value)} /></label>
        <button>Sign in</button>
      </form>
    </div>
  );
}
