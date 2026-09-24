import { execFileSync } from "node:child_process";
import { networkInterfaces } from "node:os";

const SKIP_IFACE = /^(lo|docker|br-|veth|virbr|tun|tap|tailscale|zt|wg)/i;
const SKIP_ADDR = /^(127\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

function fromDefaultRoute() {
  try {
    const out = execFileSync("ip", ["-4", "route", "get", "1.1.1.1"], {
      encoding: "utf8",
    });
    const match = out.match(/\bsrc\s+(\d+\.\d+\.\d+\.\d+)\b/);
    if (match && !SKIP_ADDR.test(match[1])) return match[1];
  } catch {
    // fall through to interface scan
  }
  return null;
}

export function detectLanIp() {
  const routed = fromDefaultRoute();
  if (routed) return routed;

  const nets = networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    if (SKIP_IFACE.test(name) || !addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (SKIP_ADDR.test(addr.address)) continue;
      return addr.address;
    }
  }
  return "127.0.0.1";
}

export const PORTS = {
  admin: 3000,
  metro: 8081,
  supabaseApi: 54321,
  supabaseDb: 54322,
  supabaseStudio: 54323,
  vision: 8001,
  risk: 8002,
};

/** Official local-demo JWTs from the Supabase CLI. Safe to commit; never use in prod. */
export const LOCAL_SUPABASE = {
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  serviceRoleKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
};

export function urlsFor(ip) {
  return {
    lanIp: ip,
    admin: `http://${ip}:${PORTS.admin}`,
    metro: `http://${ip}:${PORTS.metro}`,
    supabase: `http://${ip}:${PORTS.supabaseApi}`,
    studio: `http://127.0.0.1:${PORTS.supabaseStudio}`,
    vision: `http://${ip}:${PORTS.vision}`,
    risk: `http://${ip}:${PORTS.risk}`,
  };
}
