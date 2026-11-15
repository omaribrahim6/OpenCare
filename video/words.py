# Print word-level timings from YouTube auto-caption VTT between t0 and t1 seconds.
import re, sys
def ts(s): h,m,r=s.split(':'); return int(h)*3600+int(m)*60+float(r)
f,t0,t1=sys.argv[1],float(sys.argv[2]),float(sys.argv[3])
txt=open(f,encoding='utf8').read(); out=[]
for blk in txt.split('\n\n'):
    m=re.search(r'(\d\d:\d\d:\d\d\.\d+) --> (\d\d:\d\d:\d\d\.\d+)',blk)
    if not m or '<c>' not in blk: continue
    line=[l for l in blk.split('\n') if '<c>' in l or re.search(r'<\d\d:',l)]
    if not line: continue
    L=line[-1]; start=ts(m.group(1))
    first=re.split(r'<\d\d:',L)[0]; first=re.sub(r'<[^>]+>','',first).strip()
    if first: out.append((start,first))
    for tm,w in re.findall(r'<(\d\d:\d\d:\d\d\.\d+)><c>([^<]*)</c>',L): out.append((ts(tm),w.strip()))
print(' '.join(f'{w}@{t:.2f}' for t,w in out if t0<=t<=t1))
