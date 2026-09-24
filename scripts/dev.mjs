#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectLanIp, PORTS } from "./lan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const skipSupabase = args.has("--no-supabase");

function run(cmd, cmdArgs, opts = {}) {
  const child = spawn(cmd, cmdArgs, {
    cwd: root,
    stdio: "inherit",
    ...opts,
  });
  child.on("error", (err) => {
    console.error(`failed to spawn ${cmd}:`, err.message);
    process.exit(1);
  });
  return child;
}

function bin(name) {
  const local = join(root, "node_modules", ".bin", name);
  return existsSync(local) ? local : name;
}

console.log("\n  DoNotFraud.ai  —  local lab\n");

spawnSync(process.execPath, [join(root, "scripts", "write-env.mjs")], {
  cwd: root,
  stdio: "inherit",
});

const ip = process.env.LAN_IP || detectLanIp();

if (!skipSupabase) {
  const docker = spawnSync("docker", ["info"], { encoding: "utf8" });
  if (docker.status !== 0) {
    console.warn(
      "\nDocker is not running — skipping Supabase.\nStart Docker, then `pnpm supabase:start`.\nThe console and the face service will still boot.\n",
    );
  } else {
    const status = spawnSync(bin("supabase"), ["status", "-o", "env"], {
      cwd: root,
      encoding: "utf8",
    });
    if (status.status !== 0) {
      console.log("\nStarting local Supabase (first run pulls Docker images)...\n");
      const started = spawnSync(bin("supabase"), ["start"], {
        cwd: root,
        stdio: "inherit",
      });
      if (started.status !== 0) {
        console.warn(
          "\nSupabase failed to start. Continuing without it.\n  pnpm supabase:start\n",
        );
      }
    } else {
      console.log("Supabase already running.");
    }
  }
}

const children = [];

children.push(
  run(bin("concurrently"), [
    "-n",
    "admin,face,faceswap",
    "-c",
    "cyan,blue,magenta",
    "--kill-others-on-fail=false",
    `pnpm --filter @donotfraud/admin dev --hostname 0.0.0.0 --port ${PORTS.admin}`,
    `uv run --directory services/face uvicorn app.main:app --host 0.0.0.0 --port ${PORTS.face} --reload`,
    `uv run --directory services/faceswap uvicorn app.main:app --host 0.0.0.0 --port ${PORTS.faceswap} --reload`,
  ], {
    env: { ...process.env, LAN_IP: ip },
  }),
);

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) shutdown(code);
  });
}
