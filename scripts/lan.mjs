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
  supabaseApi: 54321,
  supabaseDb: 54322,
  supabaseStudio: 54323,
  face: 8003,
};

export function urlsFor(ip) {
  return {
    lanIp: ip,
    admin: `http://${ip}:${PORTS.admin}`,
    supabase: `http://${ip}:${PORTS.supabaseApi}`,
    studio: `http://127.0.0.1:${PORTS.supabaseStudio}`,
    face: `http://${ip}:${PORTS.face}`,
    attest: `http://${ip}:${PORTS.supabaseApi}/functions/v1/attest`,
  };
}
