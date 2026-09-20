#!/usr/bin/env python3
"""Deploy the publish-fix to the FlowTix extraction VPS (dist-based).

Uploads the rebuilt dist files for the publish worker + supabase tunnel probe,
restarts pm2, and verifies health + that the tunnel is actually usable from
the VPS. Credentials read in-process from pass.txt, never printed.
"""
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
lines = [l.strip() for l in (ROOT / "pass.txt").read_text(encoding="utf-8").split("\n")]
HOST, PORT, USER = "37.60.242.87", 2234, "khaled"
PASSWORD = lines[12]
REMOTE = "/www/wwwroot/api.flowtixtools.com"

FILES = [
    "dist/services/publish-worker.js",
    "dist/services/publish-worker.js.map",
    "dist/services/supabase.js",
    "dist/services/supabase.js.map",
    "dist/routes/publish.js",
    "dist/routes/publish.js.map",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=25)


def run(cmd, label, timeout=300):
    _, out, err = c.exec_command(cmd, timeout=timeout)
    o, e = out.read().decode(), err.read().decode()
    code = out.channel.recv_exit_status()
    print(f"[{label}] exit={code}")
    if o.strip():
        print(o.strip()[-1200:])
    if e.strip():
        print("STDERR:", e.strip()[-500:])
    return code, o, e


sftp = c.open_sftp()
for f in FILES:
    local = ROOT / "extraction-service" / f
    remote = f"{REMOTE}/{f}"
    print(f"upload {f} ...", end=" ")
    sftp.put(str(local), remote)
    print("ok")
sftp.close()

run(f"cd {REMOTE} && pm2 restart flowtix-extraction --update-env", "pm2 restart")
time.sleep(6)
run("curl -s -m 8 http://127.0.0.1:3100/health", "health")
run("curl -s -m 12 -x socks5h://127.0.0.1:13390 -o /dev/null -w 'tunnel->fb %{http_code} in %{time_total}s'", "tunnel probe")
run("ss -tln | grep 13390 || echo NO-TUNNEL-LISTENER", "tunnel listener")
c.close()
print("DEPLOY DONE")
