# Writes NARRATION_SCRIPT.md from the main cut's timeline.
import json, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open('out/opencare_demo_timeline.json'))
lines = dict(l.strip().split('|', 1) for l in open('vo/lines.txt', encoding='utf8') if l.strip())
pic = {'a3': 'Crash aftermath (Veo)', 'a5': 'John in a hospital bed with the bill', 'b1': 'Snowy Toronto, your team photos',
       'c1': 'Protest: "Everyone in, nobody out"', 'c7': 'Protest: "RIP Aetna denied my claim"', 'd3': 'Close-up of the real CareCard',
       'd5': 'Funding diagram', 'e1': 'John at the hospital desk (Veo)', 'e3': 'Your real tap on the kiosk phone',
       'e5a': 'Admin: queue, flagged case, John\'s case, approve', 'e6': 'Admin "Decided": Paid + Nessie card',
       'e7': 'Solana explorer receipt', 'e8a': 'Public ledger, case OC-8B87', 'f1': 'Landing page, the 3 figures', 'f2': 'End card'}
names = {'c2': 'Bernie: cancer and bankruptcy', 'c4': 'AOC: Elmhurst treats everyone', 'c6': 'Bernie: over 60% support Medicare for All',
         'd1': 'Abdul: "imagine you had another card"', 'd2': 'Abdul: "no premium, no copay, no deductible"', 'd4': 'Bernie: "health care should be funded that way"'}
def seg_of(at): return next(s['id'] for s in T['segments'] if s['start'] <= at < s['start'] + s['dur'])
def mmss(t): return f"{int(t // 60)}:{t % 60:04.1f}"
rows = [f"| {l} | {mmss(at)} | {pic.get(seg_of(at), '')} | {lines[l]} |" for l, at, d in sorted(T['vo'], key=lambda x: x[1])]
clips = [f"- {mmss(s['start'])} to {mmss(s['start'] + s['dur'])}: {names[s['id']]}" for s in T['segments'] if s['id'] in names]
doc = f"""# OpenCare demo video: narration script

Main cut, {mmss(T['total'])} long. Record every line in one voice memo, top to bottom, with about 2 seconds of silence between lines. If you flub a line, pause and say the whole line again; the last take is kept. Put the memo in `video/vo_omar/memo.m4a`; it gets split into lines and checked against this script.

The edit trims the silence around each take and places it at its timecode. If a take runs long, the edit stretches the shot before the next politician instead of talking over them. The build refuses to export if any narration overlaps a politician speaking (0.7 s clear before, 0.5 s after).

Tone: calm documentary, a little dry. Don't rush; there is room.

| Line | Starts at | Over this picture | Say |
| --- | --- | --- | --- |
{chr(10).join(rows)}

## Politicians speaking (no narration here)

{chr(10).join(clips)}

## Notes

- The kiosk's discount step on screen says "AI is checking your bill", but those three discounts are scripted for the demo, so the narration says "OpenCare runs the bill through every assistance policy" rather than claiming live AI there.
- John's decision brief says **standard template** in the admin drawer, so the narration doesn't say Gemini wrote it. Add a Gemini line only if you can point to a case whose brief says "written by Gemini, numbers checked".
- Rebuild once your takes are in: `python build.py --vo omar` (about 10 minutes).
"""
open('NARRATION_SCRIPT.md', 'w', encoding='utf8').write(doc); print(doc[:400])
