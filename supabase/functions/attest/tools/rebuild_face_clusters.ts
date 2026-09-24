/**
 * Re-clusters every live selfie into face identities (oldest case first) and recomputes the 1:N signals
 * of each case as they would have been at intake, using the face service gallery.
 */
import * as audit from "../../_shared/audit.ts";
import { sql } from "../../_shared/db.ts";
import { clusterLabel, identity } from "../../_shared/facecheck.ts";
import { Unavailable } from "../../_shared/faceclient.ts";
import { rescore } from "../../_shared/intake.ts";

const IDENTITY = ["Face identity", "Same face, other documents", "Repeat attempt", "Document presented before", "Document photo reused"];

await sql.begin(async (tx) => {
  await tx`update attest.cases set face_cluster_id = null`;
  await tx`delete from attest.face_clusters`;
  for (const c of await tx`select id, number, session_id, document_number, created_at, risk_score, risk_level from attest.cases order by created_at`) {
    const t = Object.fromEntries((await tx`select kind, gallery_id from attest.face_templates where case_id = ${c.id} and gallery_id <> ''`).map((r) => [r.kind, r.gallery_id]));
    const selfie = t.selfie ?? null, ref = t.chipPhoto ?? t.portrait ?? null;
    if (!selfie && !ref) continue;
    let r;
    try {
      r = await identity(tx as any, { documentNumber: c.document_number, before: new Date(c.created_at), excludeSubject: c.session_id, selfieTemplate: selfie, portraitTemplate: ref });
    } catch (e) {
      if (e instanceof Unavailable) { console.error(`face service unavailable: ${e.message}`); throw e; }
      throw e;
    }
    await tx`delete from attest.signals where case_id = ${c.id} and grp = 'FACE' and source = 'SERVER' and label = any(${IDENTITY})`;
    for (const s of r.signals) {
      await tx`insert into attest.signals (case_id, grp, label, outcome, value, rule, risk_points, source)
               values (${c.id}, ${s.grp}, ${s.label}, ${s.outcome}, ${s.value}, ${s.rule}, ${["FAIL", "WARN"].includes(s.outcome) ? s.risk_points : 0}, 'SERVER')`;
    }
    let cluster: number | null = null;
    if (selfie) {
      cluster = r.cluster ?? (await tx`insert into attest.face_clusters default values returning id`)[0].id;
      await tx`update attest.cases set face_cluster_id = ${cluster} where id = ${c.id}`;
    }
    const s = await rescore(tx, c.id);
    await audit.record(tx, c as any, "system", "face_identity_rebuilt", { cluster: clusterLabel(cluster), before: [c.risk_score, c.risk_level], after: [s.score, s.level] });
    console.log(`#${c.number} ${(c.document_number || "—").padEnd(12)} ${(clusterLabel(cluster) ?? "no selfie").padEnd(9)} ${String(c.risk_score).padStart(3)} ${c.risk_level.padEnd(6)} → ${String(s.score).padStart(3)} ${s.level}`);
  }
});
await sql.end();
