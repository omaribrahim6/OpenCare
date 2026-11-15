# Transcribe every take in a folder with faster-whisper and compare it to vo/lines.txt word for word.
import sys, os, re, glob, json, subprocess
from faster_whisper import WhisperModel
os.chdir(os.path.dirname(os.path.abspath(__file__)))
d = sys.argv[1]
m = WhisperModel('medium.en', device='cpu', compute_type='int8')
text = dict(l.strip().split('|', 1) for l in open('vo/lines.txt', encoding='utf8') if l.strip())
NUM = {'456,000': 'four hundred and fifty six thousand', '$456,000': 'four hundred and fifty six thousand', '$0': 'zero', '0': 'zero'}
def norm(s):
    s = s.lower().replace('-', ' ').replace("'s", 's').replace("’s", 's')
    s = re.sub(r'\$?456,000', ' four hundred and fifty six thousand ', s); s = re.sub(r'\$0\b', ' zero ', s)
    s = re.sub(r'\$?146,000', ' a hundred and forty six thousand ', s)
    return re.findall(r'[a-z]+', s)
bad = 0; report = {}
for f in sorted(glob.glob(f'{d}/L*.wav')):
    L = os.path.basename(f)[:-4]
    if L not in text: continue
    segs, _ = m.transcribe(f, word_timestamps=True, beam_size=5, condition_on_previous_text=False, vad_filter=False)
    ws = [w for s in segs for w in s.words]
    got = ' '.join(w.word.strip() for w in ws)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout)
    a, b = norm(text[L]), norm(got)
    # tolerate whisper spelling (opencare/open care, nessie etc.): compare first 2 and last 2 words + length
    ok = a[:2] == b[:2] and a[-2:] == b[-2:] and abs(len(a) - len(b)) <= 2
    first = ws[0].start if ws else None; last = ws[-1].end if ws else None
    if not ok: bad += 1
    report[L] = dict(ok=ok, dur=round(dur, 2), first=first, last=last, got=got)
    print(('OK  ' if ok else 'BAD ') + f'{L} {dur:5.2f}s first={first} last={last} | {got}', flush=True)
json.dump(report, open(f'{d}/_check.json', 'w'), indent=1)
print('BAD:', bad)
