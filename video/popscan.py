# Find wind/plosive pops: 50 ms windows where energy below 150 Hz is loud relative to the voice band.
import subprocess, sys, numpy as np
def load(path):
    raw = subprocess.run(['ffmpeg','-v','error','-i',path,'-ac','1','-ar','16000','-f','f32le','-'],capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)
def scan(x, sr=16000, win=0.05):
    n = int(sr*win); hits = []
    f = np.fft.rfftfreq(n, 1/sr)
    for i in range(0, len(x)-n, n):
        S = np.abs(np.fft.rfft(x[i:i+n]*np.hanning(n)))**2
        lo = S[(f>20)&(f<150)].sum(); mid = S[(f>300)&(f<3500)].sum(); tot = lo+mid+1e-12
        lo_db = 10*np.log10(lo/n+1e-12)
        if lo_db > -35 and lo/tot > 0.5: hits.append((i/sr, lo_db, lo/tot))
    return hits
if __name__ == '__main__':
    for p in sys.argv[1:]:
        h = scan(load(p)); print(p, len(h), 'pop windows', ' '.join(f'{t:.2f}' for t,_,_ in h[:40]))
