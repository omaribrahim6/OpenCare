import re,sys
def ts(s):
    h,m,r=s.split(':'); return int(h)*3600+int(m)*60+float(r)
for f in sys.argv[1:]:
    txt=open(f,encoding='utf8').read()
    out=[];seen=set()
    for blk in txt.split('\n\n'):
        m=re.search(r'(\d\d:\d\d:\d\d\.\d+) --> ',blk)
        if not m: continue
        lines=[re.sub(r'<[^>]+>','',l).strip() for l in blk.split('\n')[1:]]
        for l in lines:
            if l and l not in seen and '-->' not in l:
                seen.add(l); out.append((ts(m.group(1)),l))
    print('#####',f)
    buf=[];start=None
    for t,l in out:
        if start is None: start=t
        buf.append(l)
        if len(' '.join(buf))>110:
            print(f"{int(start//60)}:{start%60:05.2f} {' '.join(buf)}"); buf=[];start=None
    if buf: print(f"{int(start//60)}:{start%60:05.2f} {' '.join(buf)}")
