# Shared Vertex helpers. Reads creds path and project from the repo .env; never prints secrets.
import os, re
def env():
    d={}
    for l in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env'),encoding='utf8'):
        m=re.match(r'^([A-Z_]+)=(.*)$',l.strip())
        if m: d[m.group(1)]=m.group(2).strip().strip('"')
    return d
E=env()
os.environ['GOOGLE_APPLICATION_CREDENTIALS']=E['GOOGLE_APPLICATION_CREDENTIALS']
PROJECT=E['GOOGLE_CLOUD_PROJECT']
def token():
    import google.auth, google.auth.transport.requests
    c,_=google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
    c.refresh(google.auth.transport.requests.Request()); return c.token
