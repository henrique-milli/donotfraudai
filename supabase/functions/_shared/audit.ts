/**
 * Append-only, hash-chained audit trail: every event stores the hash of the previous one, so editing,
 * deleting or reordering any row breaks the chain (`deno task verify-audit`). The table also refuses
 * UPDATE/DELETE with a trigger.
 */
import type { Sql } from "./db.ts";
import { canonical, sha256Hex } from "./util.ts";

export const GENESIS = "0".repeat(64);

export interface AuditRow { id: number; case_number: number | null; at: Date | string; actor: string; kind: string; data: unknown; prev_hash: string; hash: string }

const body = (e: { case_number: number | null; at: string; actor: string; kind: string; data: unknown; prev: string }) =>
  canonical({ case: e.case_number, at: e.at, actor: e.actor, kind: e.kind, data: e.data ?? {}, prev: e.prev });

const iso = (d: Date | string) => new Date(d).toISOString();

// deno-lint-ignore no-explicit-any
const inTx = (sql: any) => typeof sql.savepoint === "function";

/** Appends one event to the chain. `c` is the case ({id, number}) or null for system events. */
// deno-lint-ignore no-explicit-any
export async function record(sql: Sql | any, c: { id: number; number: number } | null, actor: string, kind: string, data: Record<string, unknown> = {}) {
  // deno-lint-ignore no-explicit-any
  const run = async (tx: any) => {
    await tx`select pg_advisory_xact_lock(hashtext('attest.audit_events'))`;
    const [last] = await tx`select hash from attest.audit_events order by id desc limit 1`;
    const prev = last?.hash ?? GENESIS;
    const at = new Date().toISOString();
    const clean = JSON.parse(JSON.stringify(data));
    const hash = await sha256Hex(body({ case_number: c?.number ?? null, at, actor, kind, data: clean, prev }));
    await tx`insert into attest.audit_events (case_id, case_number, at, actor, kind, data, prev_hash, hash)
             values (${c?.id ?? null}, ${c?.number ?? null}, ${at}, ${actor}, ${kind}, ${tx.json(clean)}, ${prev}, ${hash})`;
    return hash;
  };
  return inTx(sql) ? await run(sql) : await sql.begin(run);
}

export async function verifyChain(sql: Sql): Promise<{ ok: boolean; checked: number; message: string }> {
  let prev = GENESIS, n = 0;
  const rows = await sql<AuditRow[]>`select id, case_number, at, actor, kind, data, prev_hash, hash from attest.audit_events order by id`;
  for (const e of rows) {
    n++;
    if (e.prev_hash !== prev) return { ok: false, checked: n, message: `event ${e.id}: prev_hash does not match the event before it (row deleted or reordered)` };
    const h = await sha256Hex(body({ case_number: e.case_number, at: iso(e.at), actor: e.actor, kind: e.kind, data: e.data, prev: e.prev_hash }));
    if (h !== e.hash) return { ok: false, checked: n, message: `event ${e.id}: content changed after it was written` };
    prev = e.hash;
  }
  return { ok: true, checked: n, message: "chain intact" };
}
