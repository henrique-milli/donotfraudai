"use client";

import { useEffect, useState } from "react";
import { env } from "./env";

/** Client for the attest Edge Function (supabase/functions/attest), analyst routes. */

const TOKEN = "triage.token";
const NAME = "triage.analyst";

function read(key: string) {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export const session = {
  token: () => read(TOKEN),
  analyst: () => read(NAME) || "analyst",
  set(token: string, analyst: string) {
    try {
      sessionStorage.setItem(TOKEN, token);
      sessionStorage.setItem(NAME, analyst);
    } catch {
      /* private mode: the token lives only in memory for this tab */
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(TOKEN);
    } catch {}
  },
};

export class Unauthorized extends Error {}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env.attestApiUrl}/analyst${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-analyst-token": session.token(),
      "x-analyst": session.analyst(),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Images need the analyst header, so they are fetched and shown as object URLs. */
export function useImage(url: string | null | undefined) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let revoke: string | null = null;
    let live = true;
    fetch(`${env.attestApiUrl}${url}`, { headers: { "x-analyst-token": session.token() } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b && live) {
          revoke = URL.createObjectURL(b);
          setSrc(revoke);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [url]);
  return src;
}

// ---------------------------------------------------------------- shapes returned by the API

export type Level = "LOW" | "MEDIUM" | "HIGH";
export type Outcome = "PASS" | "FAIL" | "WARN" | "INFO" | "SKIPPED";

export interface CaseRow {
  number: number;
  session_id: string;
  created_at: string;
  document_type: string;
  holder_name: string;
  document_number: string;
  risk_score: number;
  risk_level: Level;
  route: string;
  status: string;
  recommendation: string;
  demo_fixture: boolean;
  pending_rv: number;
}

export interface Counts {
  counts: Partial<Record<Level, number>>;
  total: number;
  open: number;
}

export interface Signal {
  grp: string;
  side: string;
  label: string;
  outcome: Outcome;
  value: string;
  rule: string;
  risk_points: number;
  source: string;
}

export interface Img {
  kind: string;
  label: string;
  url: string;
  sha256: string;
  width: number;
  height: number;
}

export interface Group {
  key: string;
  title: string;
  worst: Outcome;
  headline: string;
  detail: string;
  points: number;
  capped: boolean;
  raw: number;
  open: boolean;
  signals: Signal[];
}

export interface Reverification {
  number: number;
  steps: string[];
  requested_by: string;
  status: "PENDING" | "PASSED" | "FAILED" | "EXPIRED";
  created_at: string;
  selfie: Img | null;
  frames: Img[];
  signals: Signal[];
}

export interface Attempt {
  number: number;
  document_number: string;
  status: string;
  risk_level: Level;
  created_at: string;
}

export interface CaseDetail {
  case: CaseRow & {
    nationality: string;
    birth_date: string;
    expiry_date: string;
    identity_source: string;
    device_score: number | null;
    assurance: string;
    summary: string;
    recommendation_text: string;
    confidence: number;
    why_not_approve: string[];
    why_not_reject: string[];
    signature_ok: boolean | null;
    face_cluster: string | null;
  };
  groups: Group[];
  evidence: { title: string; line1: string; line2: string; flag: boolean }[];
  face: {
    cluster: string | null;
    attempts: Attempt[];
    documents: string[];
    search: { state: "new" | "seen" | "multi"; title: string; detail: string };
    selfie: Img | null;
    reference: Img | null;
    frames: Img[];
    similarity: number | null;
    liveness: number | null;
    signals: Record<string, Signal>;
    reverifications: Reverification[];
  };
  images: Img[];
  allImages: Img[];
  portrait: Img | null;
  decisions: { action: string; note: string; analyst: string; followed_recommendation: boolean; created_at: string }[];
  audit: { id: number; at: string; actor: string; kind: string; hash: string }[];
  drivers: Signal[];
  ladder?: {
    confidence: number;
    score: number;
    level: string;
    route: string;
    steps: {
      id: string;
      title: string;
      confidence: number;
      risk: number;
      outcome: Outcome;
      summary: string;
      signals: number;
      fired: number;
      weight: number;
    }[];
    agent: { confidence: number; summary: string; mode: string; lookups: string[] } | null;
  };
}

// ---------------------------------------------------------------- presentation helpers

export const LEVEL_CLS: Record<string, string> = { LOW: "low", MEDIUM: "med", HIGH: "high" };
export const LEVEL_LABEL: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };
export const OUTCOME_CLS: Record<string, string> = { PASS: "pass", FAIL: "fail", WARN: "warn", INFO: "info", SKIPPED: "info" };
export const GLYPH: Record<string, string> = { PASS: "✓", FAIL: "✕", WARN: "!", INFO: "i", SKIPPED: "–" };
export const REC: Record<string, string> = {
  APPROVE: "Approve",
  REQUEST_VERIFICATION: "Request verification",
  ESCALATE: "Escalate",
  INVITE_BRANCH: "Invite to branch",
  REJECT: "Reject",
};
export const STATUS: Record<string, string> = {
  AUTO_APPROVED: "Auto-approved",
  STEP_UP_REQUESTED: "Step-up requested",
  IN_TRIAGE: "In triage",
  BRANCH_INVITED: "Branch visit invited",
  ESCALATED: "Escalated",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};
export const ROUTE: Record<string, string> = {
  CONTINUE: "Auto-approved",
  MANUAL_REVIEW: "Online review",
  BRANCH_VISIT: "Branch visit",
  STEP_UP: "Step-up verification",
};

export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const truncate = (s: string, n: number) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s ?? "");

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase() || "?"
  );
}
