# usage: lyria.py name "prompt" "negative"
import sys, base64, requests; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from vx import token, PROJECT
name, prompt, neg = sys.argv[1], sys.argv[2], sys.argv[3]
url = f'https://us-central1-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/us-central1/publishers/google/models/lyria-002:predict'
r = requests.post(url, headers={'Authorization': 'Bearer ' + token()}, json={'instances': [{'prompt': prompt, 'negative_prompt': neg}], 'parameters': {'sample_count': 2}}, timeout=300)
if not r.ok: sys.exit(f'{name} {r.status_code} {r.text[:300]}')
for i, p in enumerate(r.json()['predictions']):
    open(f'music/{name}_{i}.wav', 'wb').write(base64.b64decode(p['bytesBase64Encoded']))
open('cost.log', 'a').write(f'lyria {name} 0.12\n'); print('saved', name)
