#!/usr/bin/env node
// GitHub webhook listener that triggers deploy/update.sh on push to main.
// Zero-dependency (Node 18+). Validates the X-Hub-Signature-256 HMAC so only
// GitHub with the matching secret can trigger a deploy.
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WEBHOOK_PORT || 17400);
const SECRET = process.env.WEBHOOK_SECRET || "";
const APP_DIR = process.env.APP_DIR || process.env.HOME;
const UPDATE_SCRIPT = path.join(__dirname, "update.sh");

if (!SECRET) {
  console.error("WEBHOOK_SECRET not set — refusing to start.");
  process.exit(1);
}

function verifySignature(rawBody, sigHeader) {
  if (!sigHeader) return false;
  const [algo, expectedHex] = sigHeader.split("=");
  if (algo !== "sha256" || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(
    crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex"),
    "hex"
  );
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

const server = http.createServer((req, res) => {
  let raw = Buffer.alloc(0);
  req.on("data", (c) => {
    raw = Buffer.concat([raw, c]);
  });
  req.on("end", () => {
    if (req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    const event = req.headers["x-github-event"];
    if (!verifySignature(raw, req.headers["x-hub-signature-256"])) {
      res.writeHead(401).end("bad signature");
      return;
    }
    if (event !== "push") {
      res.writeHead(202).end("ignored");
      return;
    }
    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }
    if (payload.ref !== "refs/heads/main") {
      res.writeHead(202).end("not main");
      return;
    }

    // Acknowledge immediately; GitHub won't wait for docker build.
    res.writeHead(202).end("deploying");
    const log = spawn(
      "bash",
      [UPDATE_SCRIPT],
      { env: { ...process.env, APP_DIR } }
    );
    log.stdout.pipe(process.stdout);
    log.stderr.pipe(process.stderr);
    log.on("error", (e) => console.error("[autodeploy] spawn error", e.message));
    log.on("exit", (code) =>
      console.log(`[autodeploy] update.sh exited with code ${code}`)
    );
  });
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`[autodeploy] listening on :${PORT}`)
);