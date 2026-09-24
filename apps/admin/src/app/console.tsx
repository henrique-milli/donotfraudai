"use client";

import { useCallback, useState, type ReactNode } from "react";
import { env } from "@/lib/env";

type Ping = { name: string; ok: boolean; detail: string };
type Score = {
  decision: string;
  score: number;
  liveness_score?: number;
  deepfake_score?: number;
};

const QUEUE = [
  {
    id: "ses_8f21",
    subject: "onboarding · CH-ZH",
    status: "needs_review",
    reason: "liveness 0.41 · injection likely",
  },
  {
    id: "ses_1c90",
    subject: "account_recovery · SIM swap flag",
    status: "needs_review",
    reason: "new device + deepfake 0.62",
  },
  {
    id: "ses_ok12",
    subject: "onboarding · pass",
    status: "auto_pass",
    reason: "risk 0.11",
  },
];

export function Console() {
  const [pings, setPings] = useState<Ping[] | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [busy, setBusy] = useState(false);

  const probe = useCallback(async () => {
    const targets = [
      ["Supabase", `${env.supabaseUrl}/auth/v1/health`],
      ["Vision", `${env.visionUrl}/health`],
      ["Risk", `${env.riskUrl}/health`],
    ] as const;
    const next = await Promise.all(
      targets.map(async ([name, url]) => {
        try {
          const res = await fetch(url, { cache: "no-store" });
          return { name, ok: res.ok || res.status === 401, detail: `${res.status}` };
        } catch (error) {
          return {
            name,
            ok: false,
            detail: error instanceof Error ? error.message : "offline",
          };
        }
      }),
    );
    setPings(next);
  }, []);

  const runStub = useCallback(async (hint: "pass" | "fail") => {
    setBusy(true);
    try {
      const vision = await fetch(`${env.visionUrl}/v1/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: "console-demo",
          kind: "selfie",
          meta: { hint },
        }),
      });
      const analysis = await vision.json();
      const risk = await fetch(`${env.riskUrl}/v1/score`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: "console-demo",
          purpose: "onboarding",
          ...analysis,
        }),
      });
      const scored = await risk.json();
      setScore({ ...analysis, ...scored });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.2em] text-teal-300/80">
          Zürich Hackathon 2026
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          DoNotFraud console
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-teal-50/70">
          Review queue for investigators and humans-in-the-loop. Laptop is
          advertised on LAN as{" "}
          <code className="font-mono text-teal-200">{env.lanIp}</code>.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <Card title="Local stack">
          <dl className="space-y-2 font-mono text-xs text-teal-50/80">
            <Row k="supabase" v={env.supabaseUrl} />
            <Row k="vision" v={env.visionUrl} />
            <Row k="risk" v={env.riskUrl} />
          </dl>
          <button type="button" className="btn" onClick={probe}>
            Probe services
          </button>
          <ul className="space-y-1 text-sm">
            {pings?.map((ping) => (
              <li key={ping.name}>
                <span className={ping.ok ? "text-teal-300" : "text-rose-300"}>
                  {ping.ok ? "●" : "○"}
                </span>{" "}
                {ping.name}{" "}
                <span className="text-teal-50/50">{ping.detail}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Stub pipeline">
          <p className="text-sm text-teal-50/70">
            Calls vision then risk. Replace the service bodies, keep these
            routes.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn" disabled={busy} onClick={() => runStub("pass")}>
              Live selfie
            </button>
            <button
              type="button"
              className="btn btn-warn"
              disabled={busy}
              onClick={() => runStub("fail")}
            >
              Deepfake
            </button>
          </div>
          {score ? (
            <p className="font-mono text-sm">
              {score.decision} · risk {score.score} · liveness{" "}
              {score.liveness_score} · deepfake {score.deepfake_score}
            </p>
          ) : null}
        </Card>

        <Card title="Studio">
          <p className="text-sm text-teal-50/70">
            Auth, storage, and SQL live in local Supabase Studio.
          </p>
          <a className="btn" href="http://127.0.0.1:54323" target="_blank" rel="noreferrer">
            Open Studio
          </a>
        </Card>
      </section>

      <section className="overflow-hidden rounded-2xl border border-teal-100/10 bg-teal-950/40">
        <div className="border-b border-teal-100/10 px-5 py-3 text-sm font-medium">
          Review queue
        </div>
        <table className="w-full text-left text-sm">
          <thead className="text-teal-50/50">
            <tr>
              <th className="px-5 py-3 font-medium">Session</th>
              <th className="px-5 py-3 font-medium">Subject</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Why flagged</th>
            </tr>
          </thead>
          <tbody>
            {QUEUE.map((row) => (
              <tr key={row.id} className="border-t border-teal-100/10">
                <td className="px-5 py-3 font-mono text-xs">{row.id}</td>
                <td className="px-5 py-3">{row.subject}</td>
                <td className="px-5 py-3">{row.status}</td>
                <td className="px-5 py-3 text-teal-50/70">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-teal-100/10 bg-teal-950/40 p-5">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="uppercase tracking-wide text-teal-50/40">{k}</dt>
      <dd className="break-all">{v}</dd>
    </div>
  );
}
