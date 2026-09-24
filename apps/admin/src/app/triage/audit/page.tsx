"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, truncate } from "@/lib/triage";
import { Shell } from "../shell";
import "../triage.css";

type Audit = {
  chain: { ok: boolean; checked: number; message: string };
  events: { id: number; at: string; actor: string; kind: string; data: unknown; hash: string; case_number: number | null }[];
};

function AuditLog({ fail }: { fail: (e: unknown) => void }) {
  const [a, setA] = useState<Audit | null>(null);
  useEffect(() => {
    api<Audit>("/audit").then(setA).catch(fail);
  }, [fail]);
  return (
    <section className="panel wide">
      <div className="ph">
        <h2>Audit trail</h2>
        {a ? <span className={`chain ${a.chain.ok ? "ok" : "bad"}`}>{a.chain.ok ? "✓" : "✕"} {a.chain.message} · {a.chain.checked} events verified</span> : null}
      </div>
      <p className="muted small">
        Signals, recommendation, human decision and outcome are recorded. Each event stores the hash of the one before it, so any edit or
        deletion breaks the chain; the database also refuses updates and deletes on this table.
      </p>
      <table className="audit">
        <tbody>
          <tr><th>#</th><th>When</th><th>Case</th><th>Actor</th><th>Event</th><th>Data</th><th>Hash</th></tr>
          {a?.events.map((e) => (
            <tr key={e.id}>
              <td>{e.id}</td>
              <td className="small">{new Date(e.at).toLocaleString()}</td>
              <td>{e.case_number ? <Link href={`/triage?case=${e.case_number}`}>#{e.case_number}</Link> : "—"}</td>
              <td>{e.actor}</td>
              <td>{e.kind}</td>
              <td className="mono small">{truncate(JSON.stringify(e.data), 110)}</td>
              <td className="mono small">{e.hash.slice(0, 10)}…</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function AuditPage() {
  return <Shell>{(fail) => <AuditLog fail={fail} />}</Shell>;
}
