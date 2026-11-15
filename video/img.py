# Generate a still with Gemini image on Vertex. usage: img.py out.png "prompt" [ref1.png ref2.png ...]
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from vx import PROJECT
from google import genai
from google.genai import types
c = genai.Client(vertexai=True, project=PROJECT, location='global')
out, prompt, refs = sys.argv[1], sys.argv[2], sys.argv[3:]
parts = [types.Part.from_bytes(data=open(r,'rb').read(), mime_type='image/png' if r.endswith('png') else 'image/jpeg') for r in refs]
parts.append(types.Part.from_text(text=prompt))
r = c.models.generate_content(model='gemini-2.5-flash-image', contents=[types.Content(role='user', parts=parts)],
    config=types.GenerateContentConfig(response_modalities=['IMAGE'], image_config=types.ImageConfig(aspect_ratio='16:9')))
for p in r.candidates[0].content.parts:
    if p.inline_data: open(out,'wb').write(p.inline_data.data); print('saved', out); break
else: print('no image', r.candidates[0].finish_reason)
open('cost.log','a').write(f'image {out} 0.04\n')
