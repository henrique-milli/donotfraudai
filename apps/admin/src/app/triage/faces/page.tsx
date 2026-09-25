"use client";

/* eslint-disable @next/next/no-img-element -- images are authenticated object URLs */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ago, api, LEVEL_CLS, useImage, type Level } from "@/lib/triage";
import { Shell } from "../shell";
import "../triage.css";

type Cluster = {
  label: string;
  nCases: number;
  nDocs: number;
  last: string;
  documents: string[];
  selfieCase: number | null;
  cases: { number: number; document_number: string; status: string; risk_level: Level; created_at: string }[];
};

function Face({ n }: { n: number | null }) {
  const src = useImage(n ? `/analyst/cases/${n}/images/selfie` : null);
  return src ? <img src={src} alt="" /> : null;
}

function Faces({ fail }: { fail: (e: unknown) => void }) {
  const [rows, setRows] = useState<Cluster[] | null>(null);
  useEffect(() => {
    api<{ clusters: Cluster[] }>("/faces").then((r) => setRows(r.clusters)).catch(fail);
  }, [fail]);
  return (
    <section className="panel wide">
      <div className="ph"><h2>Faces</h2><span className="muted small">one row per live person (selfie clusters) · ranked by documents tried</span></div>
      <p className="muted small">
        A live selfie joins the cluster of any earlier live selfie it matches (SFace ≥ same-person threshold), whatever document it came with.
        Several documents on one face is the signature of synthetic identities and document mules.
      </p>
      <table className="audit faces">
        <tbody>
          <tr><th>Face</th><th>Attempts</th><th>Documents</th><th>Cases</th><th>Last seen</th></tr>
          {rows?.map((r) => (
            <tr key={r.label} className={r.documents.length > 1 ? "flagrow" : ""}>
              <td><span className="fid"><Face n={r.selfieCase} /><b>{r.label}</b></span></td>
              <td>{r.nCases}</td>
              <td>
                {r.documents.length ? r.documents.map((d, i) => <span key={d}><span className="mono">{d}</span>{i < r.documents.length - 1 ? ", " : ""}</span>) : "—"}
                {r.documents.length > 1 ? <> <span className="pill high">{r.documents.length} documents</span></> : null}
              </td>
              <td>{r.cases.map((c) => <span key={c.number}><Link href={`/triage?case=${c.number}`} className={`pill ${LEVEL_CLS[c.risk_level]}`}>#{c.number}</Link> </span>)}</td>
              <td className="small">{ago(r.last)}</td>
            </tr>
          ))}
          {rows && !rows.length ? <tr><td colSpan={5} className="muted">No selfies yet.</td></tr> : null}
        </tbody>
      </table>
    </section>
  );
}

export default function FacesPage() {
  return <Shell>{(fail) => <Faces fail={fail} />}</Shell>;
}
