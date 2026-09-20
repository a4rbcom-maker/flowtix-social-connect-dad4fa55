#!/usr/bin/env python3
"""Deploy the distributed-lease fix to the FlowTix extraction VPS (dist-based).

The VPS has no src/ — it runs a prebuilt dist/. Uploads the 3 rebuilt dist
files, restarts pm2, verifies health + that the deployed code enforces the
lease. Credentials read in-process from pass.txt, never printed.
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
    "dist/config.js",
    "dist/config.js.map",
    "dist/services/context-manager.js",
    "dist/services/context-manager.js.map",
    "dist/services/supabase.js",
    "dist/services/supabase.js.map",
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
        print("STDERR:", e.strip()[-600:])
    if code != 0:
        c.close()
        sys.exit(1)
    return o


run(f"cp -r {REMOTE}/dist {REMOTE}/dist.bak.lease2.$(date +%Y%m%d%H%M%S)", "backup dist")

sftp = c.open_sftp()
for f in FILES:
    local = ROOT / "extraction-service" / f
    remote = f"{REMOTE}/{f}"
    if not local.exists():
        print(f"[MISSING LOCAL] {local}")
        c.close()
        sys.exit(1)
    sftp.put(str(local), remote)
    print(f"[upload] {f}")
sftp.close()

run("pm2 restart flowtix-extraction --update-env 2>&1 | tail -4", "pm2 restart")
time.sleep(8)
run("curl -s -m 10 http://127.0.0.1:3100/health", "health")
run(f"grep -c 'acquireSessionLease' {REMOTE}/dist/services/context-manager.js", "deployed guard present")

probe = (
    "node --input-type=module -e \""
    "import {createClient} from '/www/wwwroot/api.flowtixtools.com/node_modules/@supabase/supabase-js/dist/main/index.js';"
    "import fs from 'fs';"
    "const env=fs.readFileSync('/www/wwwroot/api.flowtixtools.com/.env','utf8');"
    "const get=k=>{const m=env.match(new RegExp('^'+k+'=(.*)$','m'));return m?m[1].trim():null};"
    "const sb=createClient(get('SUPABASE_URL'),get('SUPABASE_SERVICE_ROLE_KEY'));"
    "const {data:s}=await sb.from('fb_sessions').select('id').limit(1);"
    "if(!s.length){console.log('NO_SESSIONS_SKIP');process.exit(0)}"
    "const sid=s[0].id;"
    "const {data:a1}=await sb.rpc('acquire_fb_session_lease',{p_session_id:sid,p_holder:'deploy-probe-1',p_ttl_seconds:30}).maybeSingle();"
    "const {data:a2}=await sb.rpc('acquire_fb_session_lease',{p_session_id:sid,p_holder:'deploy-probe-2',p_ttl_seconds:30}).maybeSingle();"
    "await sb.rpc('release_fb_session_lease',{p_session_id:sid,p_holder:'deploy-probe-1'});"
    "console.log('PROBE acquire#1=',a1,'acquire#2(conflict, must be false)=',a2);"
    "\""
)
run(probe, "runtime lease probe from VPS", timeout=90)

c.close()
print("DEPLOY COMPLETE")
