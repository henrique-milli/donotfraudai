/**
 * Postgres access. On Supabase, Edge Functions get SUPABASE_DB_URL automatically; locally (no
 * Supabase) set DATABASE_URL to any Postgres with pgvector. All tables live in schema `attest`.
 */
import postgres from "npm:postgres@3.4.5";

const url = Deno.env.get("DATABASE_URL") ?? Deno.env.get("SUPABASE_DB_URL");
if (!url) throw new Error("DATABASE_URL (or SUPABASE_DB_URL on Supabase) is not set");

// Rows are plain objects keyed by column; the queries are checked by the tests against the real schema.
// deno-lint-ignore no-explicit-any
export type Sql = any;

export const sql: Sql = postgres(url, {
  max: Number(Deno.env.get("DB_POOL") ?? 5),
  prepare: false, // works through Supabase's transaction pooler too
  ssl: Deno.env.get("DB_SSL") === "1" ? "require" : false,
  onnotice: () => {},
});

