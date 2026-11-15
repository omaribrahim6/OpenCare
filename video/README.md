# OpenCare demo video kit

Everything used to cut the HackUMass demo video, so anyone on the team can make their own version.
The finished cut is `final/opencare_demo.mp4` (3:20, Omar narrating, captions burned in). It's a compressed copy because GitHub rejects files over 100 MB.

The edit is code: `build.py` holds the whole cut as a list of shots (the EDL) and renders it with ffmpeg.
Change the list, rebuild, and you get a new video.

## What's here

| Path | What it is |
| --- | --- |
| `build.py` | The edit. EDL of shots `S(id, source, in, out, ...)` with overlays, narration cues, music cues; renders and mixes everything. |
| `gfx.py` | Draws every overlay PNG in `gfx/` (lower thirds, funding diagram, phone panels, end card...). Needs Pillow and Chromium (Playwright). |
| `captions.py` | Builds the burned-in captions from `vo/lines.txt`, timed to pauses in each take. |
| `verify.py` | Run automatically after a build. Fails if the final audio is shorter than the picture or if any narration line or clip's audio drifts from where the timeline put it. |
| `cut_memo.py` | Cuts the narrator's single voice memo (`vo_omar/memo.m4a`) into one file per line (`vo_omar/L01.wav`...). |
| `wtx.py`, `wcheck.py` | Whisper transcription: word timings for the memo, and a check that each cut take contains its whole line. |
| `veo.py`, `img.py`, `lyria.py`, `vx.py` | Vertex AI: Veo 3.1 clips, Gemini stills, Lyria music. `vx.py` reads the Google creds from the repo `.env`. |
| `rec_admin.py`, `rec_rest.py`, `cast.py`, `devserver.py` | Screen recordings of the app (CDP screencast) against a local production build on :3001. |
| `NARRATION_SCRIPT.md`, `vo/lines.txt` | The narration, line by line, with where each line plays. |
| `gfx/` `music/` `veo/` `rec/` | Rendered overlays, Lyria music beds, Veo shots and stills, app recordings. |
| `vo_omar/` | Omar's voice memo and the per-line takes cut from it. |
| `footage/` | Real footage: the kiosk phone screen recording, the card tap, and the Bernie funding clip. |

**Not committed:** the YouTube news and protest clips in `src/` (about 800 MB, third-party). Fetch them with `./fetch_sources.sh` before building. Also not committed are the build caches `seg/` and `out/`.

## Build it

Requirements: Python 3.11+, ffmpeg 8 on PATH, `pip install numpy pillow playwright faster-whisper google-genai requests`, and `yt-dlp` for the sources.

```bash
cd video
./fetch_sources.sh
python build.py --vo omar --captions --out my_cut
```

The output is `out/my_cut.mp4`. The first build takes about 10 minutes; shots are cached in `seg/`, so later builds only re-render what changed. `--vo scratch` uses placeholder narration from `vo/` (no wavs committed; skip it), and `--vo none` builds with no narration.

## Make your own version

- **Reorder or trim shots:** edit the `EDL` list in `build.py`. Each `S(...)` takes a source, in and out points, speed, gain, overlays (`ov=[O(png, t0, t1)]`), narration cues (`vo=[('L05', offset)]`) and a music cue. `norm=True` marks a shot where someone is speaking. Narration is never allowed over those shots.
- **New narration:**
  1. Edit `vo/lines.txt`.
  2. Run `python make_script.py` to get a script with timecodes.
  3. Record one memo with a pause between lines and put it in `vo_omar/memo.m4a`.
  4. Run `python wtx.py` to get word timings, then set the `CUTS` times in `cut_memo.py` (keep about 0.2 s of padding at both ends).
  5. Run `python cut_memo.py`, then `python wcheck.py vo_omar`. Every line must show its full first and last words.
- **New graphics:** edit `gfx.py` and run it. Changed PNGs invalidate only the shots that use them.
- **New AI shots or music:** `veo.py` and `lyria.py` call Vertex with Omar's Google key. Ask Omar for the `.env` values (AGENTS.md §7). Veo costs $0.15–0.40 per second, so don't loop it.

## Rules the build enforces (learned the hard way)

- **Narration never overlaps a politician speaking.** If a line runs long, the shot before the next speaker stretches instead (0.7 s clear before a speaker, 0.5 s after, 0.35 s between lines). The build refuses to export if the narration track is above −50 dB during any speech shot.
- **Mix to WAV, then mux.** Mixing straight into the AAC encode silently dropped about 9 s of audio at quiet stretches. That slid every line and clip out of sync after the first long pause. `verify.py` now catches this.
- **No silence trimming on the takes.** `silenceremove` on the cleaned voice ate the ends of words ("tap", "decides"). Takes are cut by hand with padding instead.
- **The voice cleanup chain** (in `build.py` step 0) handles a phone mic: rumble highpass, a low-band compressor for plosive pops, denoise, de-ess and level.
- **Muted b-roll audio.** The CBS shot is muted. Its reporter's voice played as a random voice between the AOC and Bernie clips.

## Facts the narration is careful about

- The kiosk's three discounts are scripted for the demo, so the narration doesn't call it live AI.
- John's decision brief uses the standard template, so the narration doesn't say Gemini wrote it.
