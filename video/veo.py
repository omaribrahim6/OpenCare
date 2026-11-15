# usage: veo.py name tier(std|fast) seconds first.png "prompt" [last.jpg]
import sys, time; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from vx import PROJECT
from google import genai
from google.genai import types
RATE = {'std': 0.40, 'fast': 0.15}; MODEL = {'std': 'veo-3.1-generate-001', 'fast': 'veo-3.1-fast-generate-001'}
CAP = 45.0
name, tier, secs, first, prompt = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
last = sys.argv[6] if len(sys.argv) > 6 else None
spent = sum(float(l.split()[-1]) for l in open('cost.log') if l.startswith('veo'))
cost = RATE[tier] * secs
if spent + cost > CAP: sys.exit(f'CAP: spent {spent:.2f}, this {cost:.2f}')
def img(p): return types.Image(image_bytes=open(p, 'rb').read(), mime_type='image/png' if p.endswith('png') else 'image/jpeg')
c = genai.Client(vertexai=True, project=PROJECT, location='us-central1')
cfg = types.GenerateVideosConfig(aspect_ratio='16:9', duration_seconds=secs, resolution='1080p', generate_audio=True,
                                 number_of_videos=1, person_generation='allow_adult', last_frame=img(last) if last else None)
op = c.models.generate_videos(model=MODEL[tier], prompt=prompt, image=img(first), config=cfg)
open('cost.log', 'a').write(f'veo {name} {tier} {secs}s {cost:.2f}\n')
while not op.done: time.sleep(10); op = c.operations.get(op)
if op.error: sys.exit(f'{name} ERROR {op.error}')
r = op.response
if not r or not r.generated_videos: sys.exit(f'{name} FILTERED {getattr(r, "rai_media_filtered_reasons", None)}')
open(f'veo/{name}.mp4', 'wb').write(r.generated_videos[0].video.video_bytes); print('saved', name)
