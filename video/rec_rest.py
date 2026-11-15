import os
# Records: admin Decided tab, Solana explorer receipt, public /fund ledger, John's /user portal, landing 3D scene.
import sys, time
from playwright.sync_api import sync_playwright
from cast import Cast
EXE=os.environ.get('CHROME_PATH')  # optional: a Chromium binary; unset = Playwright's own
SIG='67WUe1NqDrmriwJhiUbtUgUkiYZvbvkUFmPX3ixh7pEv6QyMWuMYPAbMJRF3n87V8rFfMCTZQhKK3jB2WQdswGWH'
which=sys.argv[1:] or ['decided','explorer','fund','user','landing']
def glide(pg,x,y,steps=25): pg.mouse.move(x,y,steps=steps)
def wheel(pg,dy,n=14):
    for _ in range(n): pg.mouse.wheel(0,dy/n); pg.wait_for_timeout(35)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=EXE, args=['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist'])
    def page(state=None, scale=1.25, w=1536, h=864):
        ctx=b.new_context(viewport={'width':w,'height':h}, device_scale_factor=scale, storage_state=state); return ctx, ctx.new_page()
    if 'decided' in which:
        ctx,pg=page('admin_state.json'); pg.goto('http://localhost:3001/admin'); pg.wait_for_selector('text=Decided',timeout=60000)
        pg.get_by_text('Decided', exact=True).first.click(); pg.wait_for_selector('text=John Doe',timeout=60000); pg.wait_for_timeout(1500)
        c=Cast(pg,'rec/decided_frames'); c.start(); glide(pg,700,300); pg.wait_for_timeout(2500)
        r=pg.locator('tr', has_text='John Doe').first; bb=r.bounding_box(); glide(pg,bb['x']+400,bb['y']+bb['height']/2); pg.wait_for_timeout(3500)
        c.stop(); c.build('rec/decided.mp4'); open('rec/decided.txt','w',encoding='utf8').write(pg.inner_text('body')); ctx.close()
    if 'explorer' in which:
        ctx,pg=page(); pg.goto(f'https://explorer.solana.com/tx/{SIG}?cluster=devnet'); pg.wait_for_timeout(9000)
        c=Cast(pg,'rec/explorer_frames'); c.start(); glide(pg,600,400); pg.wait_for_timeout(2000); wheel(pg,500); pg.wait_for_timeout(2500); wheel(pg,600); pg.wait_for_timeout(2500)
        c.stop(); c.build('rec/explorer.mp4'); ctx.close()
    if 'fund' in which:
        ctx,pg=page(); pg.goto('http://localhost:3001/fund'); pg.wait_for_timeout(6000)
        c=Cast(pg,'rec/fund_frames'); c.start(); glide(pg,700,300); pg.wait_for_timeout(2500); wheel(pg,650); pg.wait_for_timeout(2000)
        row=pg.locator('tr.lc-clickable').first; bb=row.bounding_box(); glide(pg,bb['x']+300,bb['y']+bb['height']/2); pg.wait_for_timeout(700)
        row.click(); pg.wait_for_timeout(4500); wheel(pg,400); pg.wait_for_timeout(2500)
        c.stop(); c.build('rec/fund.mp4'); open('rec/fund.txt','w',encoding='utf8').write(pg.inner_text('body')); ctx.close()
    if 'user' in which:
        ctx,pg=page(); pg.goto('http://localhost:3001/user'); pg.wait_for_timeout(4000)
        c=Cast(pg,'rec/user_frames'); c.start(); pg.wait_for_timeout(800)
        # demo patient's seeded test values (fictional John Doe, SPEC demo data)
        pg.locator('input[placeholder="otc7-jd4-rx19"]').click(); pg.keyboard.type('otc7-jd4-rx19', delay=60)
        pg.locator('input[type=date]').fill('1999-01-01'); pg.wait_for_timeout(600); pg.keyboard.press('Enter')
        pg.wait_for_timeout(5000); glide(pg,700,400); pg.wait_for_timeout(1500); wheel(pg,500); pg.wait_for_timeout(3000)
        c.stop(); c.build('rec/user.mp4'); open('rec/user.txt','w',encoding='utf8').write(pg.inner_text('body')); ctx.close()
    if 'landing' in which:
        ctx,pg=page(); pg.goto('http://localhost:3001/'); pg.wait_for_timeout(5000)
        c=Cast(pg,'rec/landing_frames'); c.start(); pg.wait_for_timeout(4500)
        for name in ['Ocasio-Cortez','Sanders','El-Sayed']:
            btn=pg.get_by_role('button', name=name).first; bb=btn.bounding_box(); glide(pg,bb['x']+bb['width']/2,bb['y']+bb['height']/2); pg.wait_for_timeout(400); btn.click(); pg.wait_for_timeout(4800)
        c.stop(); c.build('rec/landing.mp4'); ctx.close()
    b.close()
