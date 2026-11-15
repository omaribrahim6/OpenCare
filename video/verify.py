# Checks a finished cut against its own stems: the audio must be complete (no dropped frames) and the
# narration and every clip's audio must sit at lag 0 in the final mix. Exits non-zero on any failure.
import sys, os, json, subprocess, numpy as np
os.chdir(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else 'opencare_demo_final'
SR = 16000
def pcm(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.float32)
T = json.load(open(f'out/{OUT}_timeline.json'))
fin, vo, pic = pcm(f'out/{OUT}.mp4'), pcm('seg/vo.wav'), pcm('seg/picture.mov')
fails = []
got, want = len(fin) / SR, T['total']
print(f'audio length {got:.3f}s, picture {want:.3f}s')
if abs(got - want) > 0.08: fails.append(f'audio is {got:.2f}s but the picture is {want:.2f}s')
def lag(ref, t0, t1, maxlag=0.5):
    a = ref[int(t0 * SR):int(t1 * SR)]
    lo = max(int((t0 - maxlag) * SR), 0); seg = fin[lo:int((t1 + maxlag) * SR)]
    c = np.correlate(seg, a, 'valid'); k = int(np.argmax(np.abs(c)))
    return (lo + k) / SR - t0
probes = [(f"narration {l}", vo, at + 0.3, min(at + 1.8, at + d)) for l, at, d in T['vo']]
probes += [(f"clip {s['id']}", pic, s['start'] + 0.5, s['start'] + 2.0) for s in T['segments'] if s['norm']]
for name, ref, t0, t1 in probes:
    if np.abs(ref[int(t0 * SR):int(t1 * SR)]).max() < 1e-3: continue
    l = lag(ref, t0, t1)
    ok = abs(l) < 0.01
    print(f"{'ok ' if ok else 'BAD'} {name:16s} at {t0:6.2f}s  lag {l * 1000:+.0f} ms")
    if not ok: fails.append(f'{name} is {l:.2f}s off')
if fails: sys.exit('VERIFY FAILED: ' + '; '.join(fails))
print('VERIFY OK')
