#!/usr/bin/env node
// Builds the open-source face models (YuNet, SFace, MiniFASNet→ONNX) in Docker and copies them to
// services/face/face_models for `pnpm dev`. Pinned SHA-256 in services/face/tools/build_face_models.py.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svc = join(root, "services", "face");
const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
sh("docker", ["build", "--target", "face-models", "-t", "donotfraud-face-models", svc]);
const id = spawnSync("docker", ["create", "donotfraud-face-models"], { encoding: "utf8" }).stdout.trim();
sh("docker", ["cp", `${id}:/models/.`, join(svc, "face_models")]);
sh("docker", ["rm", id]);
console.log("face models in services/face/face_models");
