# Assembles the OpenCare demo video from the EDL below.
# usage: python build.py [--trumpcare] [--vo scratch|none|omar] [--out name]
import json, os, subprocess, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
TRUMPCARE = '--trumpcare' in args
VO = args[args.index('--vo') + 1] if '--vo' in args else 'scratch'
OUT = args[args.index('--out') + 1] if '--out' in args else 'opencare_demo'
DL = 'footage/'
PHONE = DL + 'kiosk_phone.mp4'
CARD = DL + 'card_tap.mov'
BERNIE_FUND = DL + 'bernie-basic-human-need.mp4'
os.makedirs('seg', exist_ok=True); os.makedirs('out', exist_ok=True)

def O(png, t0, t1=None, x=0, y=0): return {'png': png, 't0': t0, 't1': t1, 'x': x, 'y': y}
def S(id, src, ss, to, speed=1.0, gain=0, ov=(), vo=(), music=None, mvol=0.5, norm=False, kind='clip', fx='', grow='speed'):
    return dict(id=id, src=src, ss=ss, to=to, speed=speed, gain=gain, ov=list(ov), vo=list(vo), music=music, mvol=mvol, norm=norm, kind=kind, fx=fx, grow=grow)
P5, CBS, B9, AOC, AB, CNN = 'src/P5v2cjU0FJ4.mp4', 'src/bojGVg3t0zg.mp4', 'src/9H3swo8JtBs.mp4', 'src/sRAuhLh6AhU.mp4', 'src/42Z7KI3cbhQ.mp4', 'src/trumpcare_cnn.mp4'
team = [O(f'gfx/team{i+1}.png', 1.2 + i * 0.6, None, x, y) for i, (x, y) in enumerate([(110, 250), (560, 200), (1000, 270), (1420, 205)])]

EDL = [
    # A. cold open (Veo dramatization)
    S('a1', 'veo/v1.mp4', 0, 5.6, gain=0, ov=[O('gfx/src_veo.png', 0.3, 3.2)], music=None),
    S('a2', None, 0, 0.7, kind='black', music=None),
    S('a3', 'veo/v2.mp4', 1.0, 5.8, gain=-5, vo=[('L01', 0.8)], music='m1_open', mvol=0.55),
    S('a4', 'veo/v3.mp4', 0, 4.2, gain=-5, music='m1_open', mvol=0.55),
    S('a5', 'veo/v4.mp4', 0, 6.0, speed=0.64, gain=-14, ov=[O('gfx/bill_total.png', 2.4)], vo=[('L02', 0.3), ('L03', 5.2)], music='m1_open', mvol=0.55),
    # B. Canada
    S('b1', 'veo/v7.mp4', 0, 6.0, speed=0.51, gain=-14, ov=[O('gfx/canada_title.png', 0.5)] + team, vo=[('L04', 0.6)], music='m2_canada', mvol=0.6),
    # C. the fight
    S('c1', P5, 187.0, 190.2, gain=-10, grow='to', ov=[O('gfx/src_protest.png', 0.2, 3.0)], vo=[('L05', 0.5)], music='m3_fight', mvol=0.6),
    S('c2', B9, 32.5, 42.25, norm=True, ov=[O('gfx/lt_bernie.png', 0.3, 4.3)], music='m3_fight', mvol=0.16),
    S('c4', AOC, 261.85, 268.3, norm=True, ov=[O('gfx/lt_aoc.png', 0.3, 4.5)], music='m3_fight', mvol=0.16),
    S('c5', CBS, 10.0, 13.0, gain=-90, grow='to', ov=[O('gfx/src_cbs.png', 0.2, 2.8)], music='m3_fight', mvol=0.6),
    S('c6', B9, 2.8, 10.8, norm=True, music='m3_fight', mvol=0.16),
    S('c7', P5, 200.6, 205.2, gain=-10, grow='to', vo=[('L06', 0.2)], music='m3_fight', mvol=0.55),
]
if TRUMPCARE:
    EDL += [
        S('c8', CNN, 8.47, 21.55, norm=True, ov=[O('gfx/src_cnn.png', 0.2, 4.0)], music='m3_fight', mvol=0.12),
        S('c9a', 'gfx/tc_a.png', 0, 2.2, kind='image', vo=[('L07', 0.2)], music='m3_fight', mvol=0.35),
        S('c9b', 'gfx/tc_b.png', 0, 2.6, kind='image', music='m3_fight', mvol=0.35),
    ]
EDL += [
    # D. the card and the money
    S('d1', AB, 155.0, 163.9, norm=True, ov=[O('gfx/lt_abdul.png', 0.3, 4.3)], music='m2_canada', mvol=0.18),
    S('d2', AB, 172.35, 176.2, norm=True, music='m2_canada', mvol=0.18),
    S('d3', CARD, 0, 1.2, speed=0.3, gain=-30, vo=[('L08', 0.2)], music='m2_canada', mvol=0.55),
    S('d4', BERNIE_FUND, 0.35, 12.0, norm=True, ov=[O('gfx/lt_bernie.png', 0.3, 3.8)], music='m2_canada', mvol=0.15),
    S('d5', 'veo/v5.mp4', 0, 8.0, speed=0.49, gain=-40, fx=',boxblur=12:2,eq=brightness=-0.12:saturation=0.8',
      ov=[O('gfx/fd0.png', 0.3), O('gfx/fd1.png', 2.6), O('gfx/fd2.png', 6.0), O('gfx/fd3.png', 9.6), O('gfx/fd4.png', 12.6)],
      vo=[('L09', 0.3)], music='m4_demo', mvol=0.45),
    # E. the demo
    S('e1', 'veo/v5.mp4', 2.8, 8.0, gain=-14, ov=[O('gfx/src_veo.png', 0.2, 2.8)], vo=[('L10', 0.6)], music='m4_demo', mvol=0.5),
    S('e2', 'veo/v6.mp4', 4.85, 7.95, gain=-16, music='m4_demo', mvol=0.5),
    S('e3', CARD, 0, 6.3, gain=-10, ov=[O('gfx/src_real.png', 0.2, 4.0), O('gfx/tag_card.png', 0.4, 3.6), O('gfx/tag_kiosk.png', 3.8, 6.2)],
      vo=[('L11', 4.5)], music='m4_demo', mvol=0.5),
    S('e4', PHONE, 13.0, 37.5, speed=2.7, kind='phone',
      ov=[O('gfx/ph1.png', 0.2, 1.7), O('gfx/ph2.png', 1.7, 3.9), O('gfx/ph3.png', 3.9, 6.1), O('gfx/ph4.png', 6.1, 6.7), O('gfx/ph5.png', 6.7)],
      music='m4_demo', mvol=0.5),
    S('e5a', 'rec/admin.mp4', 0.0, 5.0, speed=1.45, ov=[O('gfx/ad_queue.png', 0.2)], vo=[('L12', 0.3)], music='m4_demo', mvol=0.5),
    S('e5b', 'rec/admin.mp4', 8.0, 16.5, speed=1.45, ov=[O('gfx/ad_flag.png', 1.4)], music='m4_demo', mvol=0.5),
    S('e5c', 'rec/admin.mp4', 17.6, 29.0, speed=1.45, ov=[O('gfx/ad_case.png', 0.6)], music='m4_demo', mvol=0.5),
    S('e5d', 'rec/admin.mp4', 30.6, 34.0, speed=1.0, ov=[O('gfx/ad_human.png', 0.2)], music='m4_demo', mvol=0.5),
    S('e6', 'rec/decided.mp4', 0.3, 6.3, ov=[O('gfx/nessie.png', 0.6)], vo=[('L13', 0.2)], music='m4_demo', mvol=0.5),
    S('e7', 'rec/explorer.mp4', 0.5, 8.0, ov=[O('gfx/solana.png', 0.5)], vo=[('L14', 0.3)], music='m4_demo', mvol=0.5),
    S('e8a', 'rec/fund.mp4', 0.0, 2.6, vo=[('L15', 1.0)], music='m5_close', mvol=0.5),
    S('e8b', 'rec/fund.mp4', 7.2, 13.0, fx=',crop=1080:608:840:0,scale=1920:1080:flags=lanczos', ov=[O('gfx/led_tag.png', 0.2)], music='m5_close', mvol=0.5),
    # F. close
    S('f1', 'rec/landing.mp4', 0.5, 11.0, vo=[('L16', 1.0)], music='m5_close', mvol=0.55),
    S('f2', 'gfx/endcard.png', 0, 6.5, kind='image', vo=[('L17', 0.6)], music='m5_close', mvol=0.6),
]

FPS = 30
GAP_AFTER = 0.7   # narration must end this long before a politician starts talking
GAP_BEFORE = 0.5  # and start this long after one stops
GAP_LINES = 0.35  # and two narration lines never touch
SPEECH = lambda s: s['norm']

def run(cmd): subprocess.check_call(cmd)

def probe(path, stream=None):
    sel = ['-select_streams', stream] if stream else []
    r = subprocess.run(['ffprobe', '-v', 'error', *sel, '-show_entries', ('stream' if stream else 'format') + '=duration', '-of', 'csv=p=0', path], capture_output=True, text=True)
    return float(r.stdout.strip().splitlines()[0])

def has_audio(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', path], capture_output=True, text=True)
    return bool(r.stdout.strip())

def atempo(speed):
    parts, s = [], speed
    while s < 0.5: parts.append('atempo=0.5'); s /= 0.5
    while s > 2.0: parts.append('atempo=2.0'); s /= 2.0
    parts.append(f'atempo={s:.5f}'); return ','.join(parts)

def fdur(seg): return round((seg['to'] - seg['ss']) / seg['speed'] * FPS) / FPS

def grow(h, need):
    if h['grow'] == 'to': h['to'] += need * h['speed']
    else: h['speed'] = (h['to'] - h['ss']) / (fdur(h) + need)

# 0. clean narration takes: trim silence at both ends, normalize, measure
vo_len = {}
if VO != 'none':
    vdir = 'vo' if VO == 'scratch' else 'vo_omar'; cdir = f'seg/vo_{VO}'; os.makedirs(cdir, exist_ok=True)
    trim = 'silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.08'
    for seg in EDL:
        for line, _ in seg['vo']:
            src = next((f'{vdir}/{line}.{e}' for e in ('wav', 'm4a', 'mp3', 'aac', 'mov', 'mp4') if os.path.exists(f'{vdir}/{line}.{e}')), None)
            if not src: print('MISSING narration', line); continue
            dst = f'{cdir}/{line}.wav'
            # Omar's phone mic: cut wind rumble, squash plosive pops in the low band, denoise hiss/breath, de-ess, level
            clean = ('aformat=channel_layouts=mono,highpass=f=95:poles=2,highpass=f=95:poles=2,acrossover=split=250:order=4th[lo][hi];'
                     '[lo]acompressor=threshold=0.02:ratio=12:attack=0.5:release=50:knee=2[loc];[loc][hi]amix=inputs=2:normalize=0,'
                     'afftdn=nr=16:nf=-48:tn=1,adeclick,agate=threshold=0.012:ratio=3:range=0.25:attack=5:release=220,deesser=i=0.35,'
                     'equalizer=f=3200:t=q:w=1:g=2,acompressor=threshold=0.1:ratio=2.5:attack=8:release=150:makeup=1.5,') if VO == 'omar' else ''
            run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vn', '-filter_complex',
                 f'[0:a]{clean}aformat=channel_layouts=stereo,afade=in:d=0.06,areverse,afade=in:d=0.12,areverse,loudnorm=I=-16:TP=-2,aresample=48000[o]', '-map', '[o]', '-ar', '48000', dst])
            vo_len[line] = probe(dst)

# 1. make room: if a line would run into a politician (or the next line), stretch the shot before it
for it in range(40):
    t = 0; starts = []
    for seg in EDL: starts.append(t); t += fdur(seg)
    ev = sorted(((starts[i] + off, i, k, line) for i, seg in enumerate(EDL) for k, (line, off) in enumerate(seg['vo']) if line in vo_len))
    changed = False
    for n, (at, i, k, line) in enumerate(ev):
        seg = EDL[i]; off = seg['vo'][k][1]
        if i > 0 and SPEECH(EDL[i - 1]) and off < GAP_BEFORE - 1e-3:
            seg['vo'][k] = (line, GAP_BEFORE); changed = True; break
        end = at + vo_len[line]
        if n + 1 < len(ev) and end + GAP_LINES > ev[n + 1][0] + 1e-3:
            need = end + GAP_LINES - ev[n + 1][0]; _, i2, k2, line2 = ev[n + 1]
            if i2 == i: EDL[i2]['vo'][k2] = (line2, EDL[i2]['vo'][k2][1] + need)
            else: grow(EDL[i2 - 1], need + 1.0 / FPS)  # a frame of slack so frame rounding can't stall the loop
            print(f'room: {line} ran {need:.2f}s into {line2}'); changed = True; break
        j = next((j for j in range(i + 1, len(EDL)) if SPEECH(EDL[j])), None)
        limit = (starts[j] - GAP_AFTER) if j is not None else (t - 0.6)
        if end > limit + 1e-3:
            need = end - limit + 0.05; grow(EDL[j - 1] if j is not None else EDL[-1], need)
            print(f'room: {line} ran {need:.2f}s into {EDL[j]["id"] if j is not None else "the end"}'); changed = True; break
    if not changed: break

def render(seg):
    dur = fdur(seg); seg['dur'] = dur
    mov = f"seg/{seg['id']}.mov"
    cmd = ['ffmpeg', '-v', 'error', '-y']
    k = seg['kind']
    if k == 'black': cmd += ['-f', 'lavfi', '-t', f'{dur}', '-i', f'color=black:s=1920x1080:r={FPS}']
    elif k == 'image': cmd += ['-loop', '1', '-t', f'{dur}', '-i', seg['src']]
    else: cmd += ['-ss', f"{seg['ss']}", '-to', f"{seg['to'] + 0.5}", '-i', seg['src']]
    for o in seg['ov']: cmd += ['-loop', '1', '-t', f'{dur}', '-i', o['png']]
    sp = seg['speed']
    if k == 'phone':
        v = (f"[0:v]setpts=(PTS-STARTPTS)/{sp},fps={FPS},split[pa][pb];"
             f"[pa]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=30:3,eq=brightness=-0.28:saturation=0.7[bg];"
             f"[pb]scale=-2:1000,format=rgba[ph];[bg][ph]overlay=x=330:y=40[v0]")
    elif k == 'black': v = '[0:v]format=yuv420p[v0]'
    elif k == 'image': v = f'[0:v]scale=1920:1080,fps={FPS},format=yuv420p[v0]'
    else: v = f"[0:v]setpts=(PTS-STARTPTS)/{sp},scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps={FPS}{seg['fx']}[v0]"
    chain = [v]; last = 'v0'
    for i, o in enumerate(seg['ov'], start=1):
        t1 = o['t1'] if o['t1'] is not None else dur
        fo = f",fade=out:st={max(t1 - 0.25, 0):.3f}:d=0.25:alpha=1" if o['t1'] is not None else ''
        chain.append(f"[{i}:v]format=rgba,fade=in:st={o['t0']:.3f}:d=0.25:alpha=1{fo}[o{i}]")
        chain.append(f"[{last}][o{i}]overlay=x={o['x']}:y={o['y']}:enable='between(t,{o['t0']:.3f},{t1:.3f})'[v{i}]"); last = f'v{i}'
    chain.append(f"[{last}]trim=end_frame={round(dur * FPS)},setpts=PTS-STARTPTS,format=yuv420p[vout]")
    ns = round(dur * 48000)
    # audio is cut to exactly the picture's sample count, so nothing drifts when segments are joined
    if k == 'clip' and has_audio(seg['src']):
        a = f"[0:a]asetpts=PTS-STARTPTS,{atempo(sp)},aresample=48000,aformat=channel_layouts=stereo"
        a += ',loudnorm=I=-17:TP=-2:LRA=11,aresample=48000' if seg['norm'] else f",volume={seg['gain']}dB"
        a += f',asetpts=N/SR/TB,apad,atrim=end_sample={ns},asetpts=PTS-STARTPTS[aout]'
        chain.append(a)
    else:
        cmd += ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
        chain.append(f"[{len(seg['ov']) + 1}:a]atrim=end_sample={ns}[aout]")
    cmd += ['-filter_complex', ';'.join(chain), '-map', '[vout]', '-map', '[aout]',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', str(FPS), '-c:a', 'pcm_s16le', '-ar', '48000', mov]
    key = json.dumps(cmd) + ''.join(str(os.path.getmtime(o['png'])) for o in seg['ov'])
    kf = f"seg/{seg['id']}.key"
    if not (os.path.exists(mov) and os.path.exists(kf) and open(kf).read() == key):
        run(cmd); open(kf, 'w').write(key)
    vd, ad = probe(mov, 'v:0'), probe(mov, 'a:0')
    if abs(vd - ad) > 0.002: print(f"WARNING {seg['id']} video {vd:.3f} vs audio {ad:.3f}")
    return mov, vd

# 2. segments, timed by their real picture length
t = 0.0; files = []
for seg in EDL:
    f, vd = render(seg); seg['start'] = t; seg['dur'] = vd; t += vd; files.append(f)
    print(f"{seg['id']:5s} {seg['start']:7.2f} +{vd:5.2f}", flush=True)
TOTAL = t
open('seg/list.txt', 'w').write(''.join(f"file '{os.path.basename(f)}'\n" for f in files))
run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'seg/list.txt', '-c', 'copy', 'seg/picture.mov'])

# 3. music bed
sections = []
for seg in EDL:
    if sections and sections[-1]['cue'] == seg['music']: sections[-1]['end'] = seg['start'] + seg['dur']
    else: sections.append({'cue': seg['music'], 'start': seg['start'], 'end': seg['start'] + seg['dur']})
inputs, filt, labels = [], [], []
for i, s in enumerate(sections):
    if not s['cue']: continue
    d = s['end'] - s['start']; inputs += ['-stream_loop', '-1', '-i', f"music/{s['cue']}_0.wav"]; n = len(inputs) // 4 - 1
    filt.append(f"[{n}:a]atrim=0:{d + 1.0:.3f},aresample=48000,aformat=channel_layouts=stereo,afade=in:d=1.2,afade=out:st={d - 0.2:.3f}:d=1.2,adelay={int(s['start'] * 1000)}|{int(s['start'] * 1000)}[m{i}]")
    labels.append(f'[m{i}]')
vol_terms = '+'.join(f"between(t,{s['start']:.3f},{s['start'] + s['dur']:.3f})*{(s['mvol'] if s['music'] else 0):.3f}" for s in EDL)
filt.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0,volume='{vol_terms}':eval=frame,atrim=0:{TOTAL:.3f}[mus]")
run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', ';'.join(filt), '-map', '[mus]', '-c:a', 'pcm_s16le', 'seg/music.wav'])

# 4. narration track, then a hard check that it is silent while any politician speaks
vo_events = [(line, seg['start'] + off) for seg in EDL for line, off in seg['vo'] if line in vo_len]
json.dump({'total': TOTAL, 'vo': [(l, a, vo_len[l]) for l, a in vo_events], 'segments': [{k: s[k] for k in ('id', 'start', 'dur', 'norm')} for s in EDL]},
          open(f'out/{OUT}_timeline.json', 'w'), indent=1)
if vo_events:
    inputs, filt = [], []
    for n, (line, at) in enumerate(vo_events):
        inputs += ['-i', f'seg/vo_{VO}/{line}.wav']
        filt.append(f"[{n}:a]adelay={round(at * 1000)}|{round(at * 1000)}[v{n}]")
    filt.append(''.join(f'[v{i}]' for i in range(len(vo_events))) + f"amix=inputs={len(vo_events)}:normalize=0,apad,atrim=0:{TOTAL:.3f}[vo]")
    run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', ';'.join(filt), '-map', '[vo]', '-c:a', 'pcm_s16le', 'seg/vo.wav'])
    bad = []
    for s in EDL:
        if not SPEECH(s): continue
        a0, a1 = max(s['start'] - 0.3, 0), s['start'] + s['dur'] + 0.2
        r = subprocess.run(['ffmpeg', '-hide_banner', '-ss', f'{a0:.3f}', '-to', f'{a1:.3f}', '-i', 'seg/vo.wav', '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
        mx = float(r.split('max_volume:')[1].split('dB')[0]) if 'max_volume:' in r else -99.0
        print(f"check {s['id']}: narration peak {mx:.1f} dB while the clip speaks", '' if mx < -50 else '<-- OVERLAP')
        if mx >= -50: bad.append(s['id'])
    if bad: sys.exit(f'narration overlaps speech in {bad}; not exporting')
    mix = ("[0:a]aformat=channel_layouts=stereo[clip];[2:a]asplit=2[vo][key];"
           "[1:a][key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=350[duck];"
           "[clip][duck][vo]amix=inputs=3:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]")
    ain = ['-i', 'seg/music.wav', '-i', 'seg/vo.wav']
else:
    mix = "[0:a]aformat=channel_layouts=stereo[clip];[clip][1:a]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]"
    ain = ['-i', 'seg/music.wav']
vf = []
if '--captions' in args and vo_events:
    import captions
    captions.build(f'out/{OUT}_timeline.json', f'seg/vo_{VO}', 'seg/captions.ass')
    mix = '[0:v]subtitles=seg/captions.ass[vcap];' + mix; vmap = '[vcap]'
else: vmap = '0:v'
# Mix to a WAV first, then mux. Mixing straight into the AAC encode dropped ~9 s of audio frames at quiet
# stretches (timestamp gaps), which slid narration and clips out of sync with the picture.
amix_only = mix.split(';', 1)[1] if mix.startswith('[0:v]') else mix
run(['ffmpeg', '-v', 'error', '-y', '-i', 'seg/picture.mov', *ain, '-filter_complex', amix_only + ';[a]asetpts=N/SR/TB[ao]',
     '-map', '[ao]', '-c:a', 'pcm_s16le', '-ar', '48000', 'seg/mix.wav'])

run(['ffmpeg', '-v', 'error', '-y', '-i', 'seg/picture.mov', '-i', 'seg/mix.wav',
     *(['-vf', 'subtitles=seg/captions.ass'] if vmap == '[vcap]' else []),
     '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
     '-ar', '48000', '-movflags', '+faststart', f'out/{OUT}.mp4'])
print(f'TOTAL {TOTAL:.2f}s -> out/{OUT}.mp4')
subprocess.run([sys.executable, 'verify.py', OUT], check=True)
