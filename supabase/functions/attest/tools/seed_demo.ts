/** Synthetic, clearly flagged demo cases through the real intake path (sealed with the active key). */
import { sql } from "../../_shared/db.ts";
import { activeKid, publicSpki, seal } from "../../_shared/envelope.ts";
import { ingest } from "../../_shared/intake.ts";
import { payload, SCENARIOS } from "./fixtures.ts";

if (Deno.args.includes("--once") && (await sql`select 1 from attest.cases limit 1`).length) {
  console.log("cases exist, skipping demo seed");
} else {
  const kid = activeKid(), spki = await publicSpki(kid);
  for (const [title, spec] of SCENARIOS) {
    const env = await seal({ payload: JSON.stringify(payload(title, spec)), sig: null }, spki, kid);
    const { case: c } = await ingest(sql, env, "203.0.113.10", true);
    console.log(`#${c.number} ${title.padEnd(34)} score=${String(c.risk_score).padEnd(3)} ${c.risk_level.padEnd(6)} → ${c.route.padEnd(13)} rec ${c.recommendation}`);
  }
}
await sql.end();
