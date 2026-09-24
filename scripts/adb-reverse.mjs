import { spawnSync } from "node:child_process";
import { PORTS } from "./lan.mjs";

const ports = [PORTS.metro, PORTS.supabaseApi, PORTS.vision, PORTS.risk, PORTS.admin];

const devices = spawnSync("adb", ["devices"], { encoding: "utf8" });
if (devices.status !== 0) {
  console.error("adb not found. Install Android platform-tools, plug the phone in, enable USB debugging.");
  process.exit(1);
}

const attached = devices.stdout
  .split("\n")
  .slice(1)
  .filter((line) => line.includes("\tdevice"));

if (attached.length === 0) {
  console.error("No phone in USB debugging mode. `adb devices` should list it as 'device'.");
  process.exit(1);
}

for (const port of ports) {
  const result = spawnSync("adb", ["reverse", `tcp:${port}`, `tcp:${port}`], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`adb reverse failed for ${port}`);
    process.exit(result.status ?? 1);
  }
}

console.log("Phone can now reach the laptop via localhost:");
for (const port of ports) console.log(`  http://127.0.0.1:${port}`);
console.log("\nIn the Expo app, set EXPO_PUBLIC_* URLs to 127.0.0.1 or just reload after `LAN_IP=127.0.0.1 pnpm lan`.");
