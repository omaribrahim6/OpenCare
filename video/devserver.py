# Runs the OpenCare web app on :3001 with the repo root .env loaded (for the video recordings).
import os, re, subprocess, sys
root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
for l in open(root + '/.env', encoding='utf8'):
    m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)=(.*)$', l.strip())
    if m: os.environ[m.group(1)] = m.group(2).strip().strip('"')
os.environ['NEXT_PUBLIC_API_MODE'] = 'live'  # the repo .env leaves it blank (mock mode)
nx = root + '/node_modules/next/dist/bin/next'
if not os.environ.get('SKIP_BUILD'):
    rc = subprocess.call(['node', nx, 'build'], cwd=root + '/apps/web')
    if rc: sys.exit(rc)
sys.exit(subprocess.call(['node', nx, 'start', '-p', '3001'], cwd=root + '/apps/web'))
