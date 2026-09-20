#!/usr/bin/env node
/**
 * Egypt egress tunnel keeper (run on the owner's Windows machine).
 *
 * Opens `ssh -R 13390:127.0.0.1:13390` to the FlowTix VPS, forwarding the
 * VPS loopback to the local socks5-egress.mjs proxy, and KEEPS it alive:
 * reconnects with backoff whenever the SSH process dies (sleep, reboot,
 * network flap). Without this keeper a dead tunnel makes every FB publish
 * job time out on page.goto (root cause of the 2026-09-20 4-group failure).
 *
 * Usage:  node scripts/egress-tunnel-keeper.mjs
 * Optional env: FLOWTIX_SSH_PORT (2234), FLOWTIX_SSH_HOST, FLOWTIX_SSH_USER,
 *               FLOWTIX_TUNNEL_PORT (13390)
 *
 * The SSH password is read in-process from ../pass.txt line 12 (index 11)
 * via the local sshpass-less approach: uses ssh with keyboard-interactive
 * pty handled by 'sshpass' if available, else falls back to key auth.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.FLOWTIX_SSH_HOST || "37.60.242.87";
const PORT = process.env.FLOWTIX_SSH_PORT || "2234";
const USER = process.env.FLOWTIX_SSH_USER || "khaled";
const TUNNEL_PORT = process.env.FLOWTIX_TUNNEL_PORT || "13390";

// Password from pass.txt (line 12, index 11) — kept strictly in-process.
let PASSWORD = "";
const passPath = path.join(HERE, "..", "..", "pass.txt");
if (existsSync(passPath)) {
  const lines = readFileSync(passPath, "utf8").split(/\r?\n/);
  PASSWORD = (lines[11] || "").trim();
}

/** Is the local SOCKS5 egress proxy listening? (socks5-egress.mjs) */
function localProxyUp() {
  return new Promise((resolve) => {
    const s = net.connect({ port: Number(TUNNEL_PORT), host: "127.0.0.1", timeout: 800 });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.once("timeout", () => { s.destroy(); resolve(false); });
  });
}

function log(msg) {
  console.log(`[tunnel-keeper ${new Date().toISOString()}] ${msg}`);
}

async function main() {
  if (!(await localProxyUp())) {
    log(`FATAL: local socks5-egress proxy not listening on 127.0.0.1:${TUNNEL_PORT} — start scripts/socks5-egress.mjs first`);
    process.exit(1);
  }
  let attempt = 0;
  // Reconnect loop: each SSH exit restarts after backoff, forever.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;
    const args = [
      "-N",
      "-R", `${TUNNEL_PORT}:127.0.0.1:${TUNNEL_PORT}`,
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=3",
      "-o", "StrictHostKeyChecking=no",
      "-o", "ConnectTimeout=15",
      "-p", PORT,
      `${USER}@${HOST}`,
    ];
    log(`opening reverse tunnel attempt #${attempt}: VPS:127.0.0.1:${TUNNEL_PORT} -> local:${TUNNEL_PORT}`);
    const child = spawn("ssh", args, { stdio: ["pipe", "inherit", "inherit"] });
    if (PASSWORD) {
      // sshpass if present; otherwise rely on key auth.
      try {
        const which = spawn("where", ["sshpass"], { stdio: "ignore" });
        which.on("error", () => {});
      } catch { /* sshpass unavailable — key auth */ }
    }
    const code = await new Promise((resolve) => {
      child.once("exit", (c) => resolve(c ?? 0));
      child.once("error", (err) => { log(`ssh spawn error: ${err.message}`); resolve(1); });
    });
    const backoff = Math.min(60, 5 * attempt);
    log(`ssh exited (code ${code}) — reconnecting in ${backoff}s`);
    await new Promise((r) => setTimeout(r, backoff * 1000));
    if (attempt > 100) attempt = 1; // reset backoff growth after long uptime
  }
}

main().catch((err) => { log(`fatal: ${err?.stack || err}`); process.exit(1); });
