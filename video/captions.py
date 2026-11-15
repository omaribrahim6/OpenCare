# Builds seg/captions.ass: the narration text, split into short single-line chunks,
# timed to the pauses inside each cleaned take.
import json, os, re, subprocess
os.chdir(os.path.dirname(os.path.abspath(__file__)))
MAXC = 44

def balanced(words, k):
    # split a word list into k pieces of roughly equal character length
    total = sum(len(w) + 1 for w in words); out, cur, acc = [], [], 0
    for w in words:
        cur.append(w); acc += len(w) + 1
        if len(out) < k - 1 and acc >= total * (len(out) + 1) / k: out.append(' '.join(cur)); cur = []
    if cur: out.append(' '.join(cur))
    return out

def chunks(text):
    out = []
    for sent in re.split(r'(?<=[.?!])\s+', text.strip()):
        if len(sent) <= MAXC: out.append(sent); continue
        clauses = re.split(r'(?<=[,;:])\s+', sent); packed = []
        for c in clauses:
            if packed and len(packed[-1]) + 1 + len(c) <= MAXC: packed[-1] += ' ' + c
            else: packed.append(c)
        for p in packed:
            if len(p) <= MAXC: out.append(p)
            else: out += balanced(p.split(), -(-len(p) // MAXC))
    merged = []  # glue tiny sentences together ("Insurance. The hospital.")
    for c in out:
        if merged and len(merged[-1]) < 18 and len(merged[-1]) + 1 + len(c) <= MAXC: merged[-1] += ' ' + c
        else: merged.append(c)
    return merged

def pauses(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'silencedetect=n=-35dB:d=0.16', '-f', 'null', '-'], capture_output=True, text=True).stderr
    s = [float(x) for x in re.findall(r'silence_start: ([0-9.]+)', r)]
    e = [float(x) for x in re.findall(r'silence_end: ([0-9.]+)', r)]
    return [(a + b) / 2 for a, b in zip(s, e)]

def ts(t):
    t = max(t, 0); h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f'{h}:{m:02d}:{s:05.2f}'

def build(timeline_path, vo_dir, out_path):
    T = json.load(open(timeline_path))
    text = dict(l.strip().split('|', 1) for l in open('vo/lines.txt', encoding='utf8') if l.strip())
    events = []
    for line, at, dur in sorted(T['vo'], key=lambda x: x[1]):
        cs = chunks(text[line]); weights = [len(c) for c in cs]; tot = sum(weights)
        ps = pauses(f'{vo_dir}/{line}.wav')
        bounds, acc = [], 0
        for w in weights[:-1]:
            acc += w; guess = dur * acc / tot
            near = min(ps, key=lambda p: abs(p - guess)) if ps else None
            bounds.append(near if near is not None and abs(near - guess) < 0.45 else guess)
        edges = [0.0] + bounds + [dur + 0.25]
        for i, c in enumerate(cs):
            events.append((at + edges[i], at + max(edges[i + 1], edges[i] + 0.6), c))
    head = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Segoe UI Semibold,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H8C000000,0,0,0,0,100,100,0.5,0,4,14,0,2,200,200,46,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    body = ''.join(f'Dialogue: 0,{ts(a)},{ts(b)},Cap,,0,0,0,,{{\\fad(80,80)}}{c}\n' for a, b, c in events)
    open(out_path, 'w', encoding='utf8').write(head + body)
    return events

if __name__ == '__main__':
    for a, b, c in build('out/opencare_demo_final_timeline.json', 'seg/vo_omar', 'seg/captions.ass'):
        print(f'{a:7.2f}-{b:7.2f} {c}')
