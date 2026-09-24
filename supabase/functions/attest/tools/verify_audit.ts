/** Walks the hash chain of the audit trail. Exit code 1 if it is broken. */
import { verifyChain } from "../../_shared/audit.ts";
import { sql } from "../../_shared/db.ts";

const r = await verifyChain(sql);
console.log(`${r.ok ? "OK" : "BROKEN"} · ${r.checked} event(s) · ${r.message}`);
await sql.end();
Deno.exit(r.ok ? 0 : 1);
