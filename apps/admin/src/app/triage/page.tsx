"use client";

/* eslint-disable @next/next/no-img-element -- images are authenticated object URLs */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  ago, api, GLYPH, initials, LEVEL_CLS, LEVEL_LABEL, OUTCOME_CLS, REC, ROUTE, STATUS, truncate, useImage,
  type CaseDetail, type CaseRow, type Counts, type Img, type Signal,
} from "@/lib/triage";
import { Shell } from "./shell";
import "./triage.css";

export default function TriagePage() {
  return (
    <Suspense fallback={null}>
      <Triage />
    </Suspense>
  );
}

function Triage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") ?? "all";
  const q = params.get("q") ?? "";
  const selected = params.get("case");
  const [refresh, setRefresh] = useState(0);
  const href = (p: Record<string, string | number | null>) => {
    const u = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(p)) if (v === null || v === "") u.delete(k); else u.set(k, String(v));
    return `/triage?${u.toString()}`;
  };

  return (
    <Shell refresh={refresh}>
      {(fail) => (
        <Body tab={tab} q={q} selected={selected} href={href} fail={fail} refresh={refresh}
          onChange={() => setRefresh((x) => x + 1)} onSearch={(v) => router.replace(href({ q: v }))} />
      )}
    </Shell>
  );
}

function Body({ tab, q, selected, href, fail, refresh, onChange, onSearch }: {
  tab: string; q: string; selected: string | null; href: (p: Record<string, string | number | null>) => string;
  fail: (e: unknown) => void; refresh: number; onChange: () => void; onSearch: (v: string) => void;
}) {
  const [list, setList] = useState<(Counts & { cases: CaseRow[] }) | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [search, setSearch] = useState(q);

  useEffect(() => {
    api<Counts & { cases: CaseRow[] }>(`/cases?tab=${encodeURIComponent(tab)}&q=${encodeURIComponent(q)}`).then(setList).catch(fail);
  }, [tab, q, refresh, fail]);

  const number = selected ?? (list?.cases[0]?.number != null ? String(list.cases[0].number) : null);
  useEffect(() => {
    if (!number) return;
    api<CaseDetail>(`/cases/${number}`).then(setDetail).catch(fail);
  }, [number, refresh, fail]);

  const shown = number && detail && String(detail.case.number) === number ? detail : null;
  const counts = list?.counts ?? {};
  return (
    <div className="grid">
      <section className="panel queue">
        <div className="ph"><h2>Fraud triage queue <span className="muted">({list?.total ?? 0})</span></h2></div>
        <form className="search" onSubmit={(e) => { e.preventDefault(); onSearch(search); }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, document, case or session…" />
        </form>
        <div className="tabs">
          <Link href={href({ tab: "all", case: null })} className={tab === "all" ? "on" : ""}>All ({list?.total ?? 0})</Link>
          <Link href={href({ tab: "high", case: null })} className={`t-high ${tab === "high" ? "on" : ""}`}>High ({counts.HIGH ?? 0})</Link>
          <Link href={href({ tab: "medium", case: null })} className={tab === "medium" ? "on" : ""}>Medium ({counts.MEDIUM ?? 0})</Link>
          <Link href={href({ tab: "low", case: null })} className={tab === "low" ? "on" : ""}>Low ({counts.LOW ?? 0})</Link>
        </div>
        <ul className="items">
          {list?.cases.map((c) => (
            <li key={c.number} className={String(c.number) === number ? "sel" : ""}>
              <Link href={href({ case: c.number })}>
                <div className="row1">
                  <strong>#{c.number}</strong>
                  <span className={`pill ${LEVEL_CLS[c.risk_level]}`}>{LEVEL_LABEL[c.risk_level]}</span>
                  <time>{ago(c.created_at)}</time>
                </div>
                <div className="row2">
                  {STATUS[c.status] ?? c.status}
                  {c.demo_fixture ? <> <span className="demo">demo</span></> : null}
                  {c.pending_rv ? <> <span className="rvpending">liveness pending</span></> : null}
                </div>
                <div className="row3">{c.holder_name || c.session_id}</div>
              </Link>
            </li>
          ))}
          {list && !list.cases.length ? (
            <li className="empty">No sessions yet. Scan a card with the app, or run <code>deno task seed-demo</code>.</li>
          ) : null}
        </ul>
      </section>
      {shown ? <Case key={shown.case.number} d={shown} fail={fail} onChange={onChange} /> : <section className="panel case empty-case"><p>{number ? "Loading…" : "Select a case."}</p></section>}
    </div>
  );
}

function Pic({ img, alt }: { img: Img | null | undefined; alt?: string }) {
  const src = useImage(img?.url);
  return src ? <img src={src} alt={alt ?? img?.label ?? ""} title={img?.label} /> : <span className="noimg">{img ? "…" : ""}</span>;
}

function Open({ img, className, children }: { img: Img; className?: string; children: React.ReactNode }) {
  const src = useImage(img.url);
  return <a className={className} href={src ?? undefined} target="_blank" rel="noreferrer">{children}</a>;
}

const Oc = ({ o, sm }: { o: string; sm?: boolean }) => <span className={`oc ${sm ? "sm " : ""}${OUTCOME_CLS[o] ?? "info"}`}>{GLYPH[o] ?? "·"}</span>;
const tone = (o?: string) => (o === "PASS" ? "ok" : o === "WARN" ? "warn" : "bad");

function Case({ d, fail, onChange }: { d: CaseDetail; fail: (e: unknown) => void; onChange: () => void }) {
  const c = d.case;
  const f = d.face;
  const lvl = LEVEL_CLS[c.risk_level];
  const gaugeLen = 157.08;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const fs = f.signals;
  const match = fs["Face match 1:1"], live = fs["Passive liveness (server)"], docBefore = fs["Document presented before"];
  const repeat = fs["Repeat attempt"], reused = fs["Document photo reused"], portraitChip = fs["Printed photo vs chip photo"];
  const anyFace = !!(f.selfie || f.reverifications.length || Object.keys(fs).length);
  const signalCount = d.groups.reduce((a, g) => a + g.signals.length, 0);

  async function decide(action: string) {
    setBusy(true);
    try {
      await api(`/cases/${c.number}/decision`, { method: "POST", body: JSON.stringify({ action, note }) });
      setNote("");
      setFlash(`Case #${c.number}: ${REC[action]}`);
      onChange();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="panel case">
        <div className="casehead">
          <div>
            <h2>
              Case #{c.number} <span className={`pill ${lvl}`}>{LEVEL_LABEL[c.risk_level]} risk</span>
              {c.demo_fixture ? <> <span className="demo">demo fixture</span></> : null}
            </h2>
            <p className="muted">Opened {ago(c.created_at)} · {c.document_type || "document"} · session <code>{c.session_id}</code></p>
          </div>
          <span className={`status s-${c.status.toLowerCase()}`}>{STATUS[c.status] ?? c.status}</span>
        </div>

        <div className="idrow">
          <div className="card identity">
            {d.portrait ? (
              <Open img={d.portrait} className="photo img"><Pic img={d.portrait} /><small>{d.portrait.label}</small></Open>
            ) : (
              <div className="photo">{initials(c.holder_name)}<small>no images in this session</small></div>
            )}
            <dl>
              <dt>Holder</dt><dd>{c.holder_name || "—"}</dd>
              <dt>Document</dt><dd>{c.document_number || "—"} · {c.nationality || "—"}</dd>
              <dt>Born · expires</dt><dd>{c.birth_date || "—"} · {c.expiry_date || "—"}</dd>
              <dt>Identity source</dt><dd>{c.identity_source === "CHIP" ? "Chip (DG1), signature verified" : c.identity_source || "printed MRZ"}</dd>
              <dt>Route</dt><dd>{ROUTE[c.route] ?? c.route}</dd>
            </dl>
          </div>
          <div className="card gauge">
            <h3>Fraud risk assessment</h3>
            <svg viewBox="0 0 120 70">
              <path d="M10 62 A50 50 0 0 1 110 62" className="g-track" />
              <path d="M10 62 A50 50 0 0 1 110 62" className={`g-val ${lvl}`} strokeDasharray={`${(gaugeLen * c.risk_score) / 100} ${gaugeLen}`} />
            </svg>
            <div className="score"><strong>{c.risk_score}</strong><span>/100</span></div>
            <p className={`lvl ${lvl}`}>{LEVEL_LABEL[c.risk_level]} risk · {(ROUTE[c.route] ?? c.route).toLowerCase()}</p>
            <p className="muted small">Server score. Phone&apos;s own advisory score: {c.device_score ?? "—"}. Assurance: {c.assurance.toLowerCase()}.</p>
          </div>
        </div>

        {anyFace ? (
          <>
            <div className="ph"><h2>Face verification</h2><span className="muted small">open-source engine · YuNet · SFace · MiniFASNet</span></div>
            <div className="card facepanel">
              <div className="pair">
                <figure>{f.selfie ? <Open img={f.selfie}><Pic img={f.selfie} alt="Selfie" /></Open> : <div className="noimg">no selfie</div>}<figcaption>Selfie</figcaption></figure>
                <div className="vs">
                  {f.similarity !== null ? (
                    <><strong className={tone(match?.outcome)}>{Math.round(f.similarity * 100)}%</strong><span>similarity</span><small>match ≥ 36%</small></>
                  ) : <span className="muted">no 1:1</span>}
                </div>
                <figure>{f.reference ? <Open img={f.reference}><Pic img={f.reference} /></Open> : <div className="noimg">no reference</div>}<figcaption>{f.reference?.label ?? "Reference"}</figcaption></figure>
              </div>
              <div className="facestats">
                <div>
                  <span className="k">Passive liveness</span>
                  {f.liveness !== null ? <b className={tone(live?.outcome)}>{Math.round(f.liveness * 100)}% live</b> : <b className="muted">—</b>}
                  <small>{live?.value ?? ""}</small>
                </div>
                <div>
                  <span className="k">1:N search</span>
                  <b className={f.search.state === "multi" ? "bad" : f.search.state === "seen" ? "warn" : "ok"}>{f.search.title}</b>
                  <small>{f.search.detail}</small>
                </div>
                {portraitChip ? <div><span className="k">Printed vs chip photo</span><b className={portraitChip.outcome === "PASS" ? "ok" : "bad"}>{portraitChip.value}</b></div> : null}
                {docBefore ? <div><span className="k">Document seen before</span><b className={docBefore.outcome === "FAIL" ? "bad" : "ok"}>{docBefore.value}</b></div> : null}
              </div>
              {f.cluster ? (
                <div className={`identity-link ${f.documents.length > 1 ? "flag" : ""}`}>
                  <div className="il-head">
                    <Link href="/triage/faces"><b>{f.cluster}</b></Link>
                    <span>{f.attempts.length} attempt{f.attempts.length === 1 ? "" : "s"} · {f.documents.length} document{f.documents.length === 1 ? "" : "s"}</span>
                    {repeat?.outcome === "WARN" ? <span className="pill high">repeat after rejection</span> : null}
                    {f.documents.length > 1 ? <span className="pill high">same face, several documents</span> : null}
                  </div>
                  <div className="il-cases">
                    {f.attempts.map((a) => (
                      <Link key={a.number} href={`/triage?case=${a.number}`} className={a.number === c.number ? "me" : ""}>
                        <Pic img={{ kind: "selfie", label: "", url: `/analyst/cases/${a.number}/images/selfie`, sha256: "", width: 0, height: 0 }} />
                        <span><b>#{a.number}</b> {a.document_number || "—"}<br />
                          <small>{new Date(a.created_at).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · <span className={`pill ${LEVEL_CLS[a.risk_level]}`}>{STATUS[a.status] ?? a.status}</span></small>
                        </span>
                      </Link>
                    ))}
                  </div>
                  {docBefore ? <p className="small"><Oc o={docBefore.outcome} sm /> Document presented before: <span className="mono">{docBefore.value}</span></p> : null}
                  {reused?.outcome === "WARN" ? <p className="small"><Oc o="WARN" sm /> Document photo reused: <span className="mono">{reused.value}</span></p> : null}
                </div>
              ) : null}
              {f.frames.length ? (
                <div className="strip">{f.frames.map((im) => <Open key={im.kind} img={im}><Pic img={im} /></Open>)}<small>capture frames: the random actions, in order</small></div>
              ) : null}
              {f.reverifications.map((r) => (
                <div key={r.number} className={`rv s-${r.status.toLowerCase()}`}>
                  <div className="rvh">
                    <b>Active liveness #{r.number}</b>{" "}
                    <span className={`pill ${r.status === "PASSED" ? "low" : r.status === "FAILED" ? "high" : "med"}`}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</span>
                    <span className="muted small">requested by {r.requested_by} · {ago(r.created_at)} · gestures: {r.steps.join(", ").toLowerCase()}</span>
                  </div>
                  {r.selfie || r.frames.length ? (
                    <div className="strip">
                      {r.selfie ? <Open img={r.selfie}><Pic img={r.selfie} /></Open> : null}
                      {r.frames.map((im) => <Open key={im.kind} img={im}><Pic img={im} /></Open>)}
                    </div>
                  ) : null}
                  {r.signals.length ? r.signals.map((s, i) => (
                    <p key={i} className="small"><Oc o={s.outcome} sm /> {s.label} <span className="mono muted">{truncate(s.value, 90)}</span></p>
                  )) : <p className="small muted">Waiting for the applicant to complete the gestures in the app.</p>}
                </div>
              ))}
            </div>
          </>
        ) : null}

        <div className="ph"><h2>Fraud signals</h2><span className="muted small">{signalCount} signals · click a row for details</span></div>
        <div className="signals">
          {d.groups.map((g) => (
            <details key={g.key} open={g.open}>
              <summary>
                <Oc o={g.worst} />
                <span className="gname">{g.title}</span>
                <span className={`ghead ${OUTCOME_CLS[g.worst]}`}>{g.headline}</span>
                <span className="gdetail">{truncate(g.detail, 70)}</span>
                {g.points ? <span className="pts" title={g.capped ? `${g.raw} points fired, group capped` : undefined}>+{g.points}{g.capped ? <small className="muted"> cap</small> : null}</span> : <span />}
              </summary>
              <table>
                <tbody>
                  {g.signals.map((s: Signal, i) => (
                    <tr key={i}>
                      <td><Oc o={s.outcome} sm /></td>
                      <td>{s.label}{s.side ? <span className="muted"> · {s.side.toLowerCase()}</span> : null}</td>
                      <td className="mono">{truncate(s.value, 90)}</td>
                      <td className="muted small">{truncate(s.rule, 60)}</td>
                      <td className="pts">{s.risk_points ? `+${s.risk_points}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </div>

        <div className="ph"><h2>Evidence</h2><span className="muted small">{d.images.length} images · {d.evidence.length} data points · images covered by the device signature</span></div>
        {d.images.length ? (
          <div className="gallery">
            {d.images.map((im) => (
              <Open key={im.kind} img={im} className={`card shot ${im.kind}`}>
                <Pic img={im} />
                <span className="cap">{im.label}{c.signature_ok ? <> <span className="ok">✓ signed</span></> : null}</span>
                <small className="mono">{im.width}×{im.height} · {im.sha256.slice(0, 10)}…</small>
              </Open>
            ))}
          </div>
        ) : null}
        <div className="evidence">
          {d.evidence.map((e) => (
            <div key={e.title} className={`card ev ${e.flag ? "flag" : ""}`}><h4>{e.title}</h4><p>{e.line1}</p><small>{e.line2}</small></div>
          ))}
        </div>

        <details className="auditbox">
          <summary>Audit trail · {d.audit.length} events · hash-chained</summary>
          <table><tbody>{d.audit.map((a) => (
            <tr key={a.id}><td className="small muted">{new Date(a.at).toLocaleTimeString()}</td><td>{a.actor}</td><td>{a.kind}</td><td className="mono small">{a.hash.slice(0, 12)}…</td></tr>
          ))}</tbody></table>
        </details>
      </section>

      <section className="panel ai">
        <div className="ph"><h2><span className="spark">✦</span> Assessment summary</h2><span className="muted small">rule-based explainer</span></div>
        <p className="summary">{c.summary}</p>
        <div className={`rec r-${c.recommendation.toLowerCase()}`}>
          <div className="rh"><h3>Recommendation</h3><span className="conf">confidence {c.confidence.toFixed(2)}</span></div>
          <strong>{REC[c.recommendation] ?? c.recommendation}</strong>
          <p>{c.recommendation_text}</p>
        </div>
        <h3 className="why">Why not approve or reject?</h3>
        <div className="whys">
          <div className="w-no"><h4>Not approving because</h4><ul>{c.why_not_approve.length ? c.why_not_approve.map((x) => <li key={x}>{x}</li>) : <li className="muted">nothing blocks approval</li>}</ul></div>
          <div className="w-yes"><h4>Not rejecting because</h4><ul>{c.why_not_reject.length ? c.why_not_reject.map((x) => <li key={x}>{x}</li>) : <li className="muted">no mitigating evidence</li>}</ul></div>
        </div>
        <h3 className="why">Analyst decision</h3>
        {flash ? <div className="flash"><span>{flash}</span></div> : null}
        {d.decisions.length ? (
          <div className="decided">{d.decisions.map((x, i) => (
            <p key={i}><strong>{REC[x.action] ?? x.action}</strong> by {x.analyst} · {ago(x.created_at)}{x.followed_recommendation ? " · followed recommendation" : ""}
              {x.note ? <><br /><span className="muted">“{x.note}”</span></> : null}</p>
          ))}</div>
        ) : null}
        <form className="decide" onSubmit={(e) => e.preventDefault()}>
          <textarea maxLength={500} placeholder="Add a note (optional)…" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="btns">
            {[
              ["APPROVE", "b-approve", "✓ Approve", "Identity verified, close case"],
              ["REQUEST_VERIFICATION", "b-verify", "↻ Request verification", "Active liveness on the phone"],
              ["ESCALATE", "b-escalate", "⚠ Escalate", "Send to specialist team"],
              ["REJECT", "b-reject", "✕ Reject", "Block this identity"],
            ].map(([a, cls, t, sub]) => (
              <button key={a} type="button" disabled={busy} onClick={() => decide(a)} className={`${cls} ${c.recommendation === a ? "rec-on" : ""}`}>
                <b>{t}</b><small>{sub}</small>
              </button>
            ))}
          </div>
        </form>
      </section>
    </>
  );
}
