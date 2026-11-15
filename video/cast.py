# CDP screencast helper: captures JPEG frames with timestamps; build() turns them into a constant-30fps mp4.
import base64, os, subprocess, time
class Cast:
    def __init__(self, page, outdir):
        self.page, self.dir, self.frames = page, outdir, []
        os.makedirs(outdir, exist_ok=True)
        self.cdp = page.context.new_cdp_session(page)
        self.cdp.on('Page.screencastFrame', self._frame)
    def _frame(self, ev):
        n = len(self.frames); path = f'{self.dir}/f{n:05d}.jpg'
        open(path, 'wb').write(base64.b64decode(ev['data']))
        self.frames.append((time.time(), path))
        try: self.cdp.send('Page.screencastFrameAck', {'sessionId': ev['sessionId']})
        except Exception: pass
    def start(self): self.t0 = time.time(); self.cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 92, 'everyNthFrame': 1})
    def stop(self): self.t1 = time.time(); self.cdp.send('Page.stopScreencast')
    def build(self, out):
        lst = f'{self.dir}/list.txt'
        with open(lst, 'w') as f:
            fr = self.frames
            for i, (t, p) in enumerate(fr):
                nxt = fr[i + 1][0] if i + 1 < len(fr) else self.t1
                f.write(f"file '{os.path.basename(p)}'\nduration {max(nxt - t, 0.001):.4f}\n")
            f.write(f"file '{os.path.basename(fr[-1][1])}'\n")
        subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '16', out])
