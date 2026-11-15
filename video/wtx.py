# Word-level transcript of the voice memo with faster-whisper -> vo_omar/memo_words.json
import json, sys, os
from faster_whisper import WhisperModel
os.chdir(os.path.dirname(os.path.abspath(__file__)))
src = sys.argv[1] if len(sys.argv) > 1 else 'vo_omar/memo.m4a'
m = WhisperModel('medium.en', device='cpu', compute_type='int8')
segs, info = m.transcribe(src, word_timestamps=True, vad_filter=False, beam_size=5, condition_on_previous_text=False)
words = []
for s in segs:
    for w in s.words:
        words.append([round(w.start, 3), round(w.end, 3), w.word.strip(), round(w.probability, 3)])
    print(f'{s.start:7.2f}-{s.end:7.2f} {s.text}', flush=True)
json.dump(words, open('vo_omar/memo_words.json', 'w'), indent=0)
print(len(words), 'words')
