# Cut each narration line out of memo.m4a at hand-checked times.
# Times come from whisper word timings + silencedetect (-42 dB) on the memo: speech region, plus padding,
# using only the last good take of each line (restarts skipped).
import os, subprocess, shutil
os.chdir(os.path.dirname(os.path.abspath(__file__)))
CUTS = {
    'L01': (9.05, 11.15), 'L02': (12.05, 16.50), 'L03': (16.62, 21.30), 'L04': (21.60, 32.85),
    'L05': (34.30, 36.00), 'L06': (38.15, 42.85), 'L08': (45.25, 48.45), 'L09': (61.25, 75.55),
    'L10': (77.20, 80.40), 'L11': (81.85, 93.55), 'L12': (95.40, 112.50), 'L13': (122.90, 128.10),
    'L14': (129.35, 135.60), 'L15': (145.10, 150.00), 'L16': (151.45, 158.10), 'L17': (159.25, 161.45),
}
if not os.path.exists('vo_omar_split_old'):
    os.makedirs('vo_omar_split_old')
    for f in os.listdir('vo_omar'):
        if f.startswith('L') and f.endswith('.wav'): shutil.copy(f'vo_omar/{f}', f'vo_omar_split_old/{f}')
for L, (a, b) in CUTS.items():
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{a}', '-to', f'{b}', '-i', 'vo_omar/memo.m4a',
                    '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', f'vo_omar/{L}.wav'], check=True)
    print(L, a, b, round(b - a, 2))
