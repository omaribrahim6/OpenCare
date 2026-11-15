# Records the admin pass: queue overview, the flagged request, John's case (#13), then the real approval.
import time, os
DRY=os.environ.get('DRY')=='1'
from playwright.sync_api import sync_playwright
from cast import Cast
EXE=os.environ.get('CHROME_PATH')  # optional: a Chromium binary; unset = Playwright's own
GRANT_ROW_INDEX=2  # third John Doe $310,645 row = #13, created 2:20 AM (grt_nsP4MayEeNLWFyxV)
log=open('rec/admin_marks.txt','w')
t0=None
def mark(s): log.write(f'{time.time()-t0:.2f} {s}\n'); log.flush()
def glide(pg,x,y,steps=25): pg.mouse.move(x,y,steps=steps)
def wheel(pg,dy,n=12):
    for _ in range(n): pg.mouse.wheel(0,dy/n); pg.wait_for_timeout(35)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=EXE)
    ctx=b.new_context(viewport={'width':1536,'height':864}, storage_state='admin_state.json', device_scale_factor=1.25)
    pg=ctx.new_page(); cast=Cast(pg,'rec/admin_frames'); t0=time.time(); mark('start')
    pg.goto('http://localhost:3001/admin'); pg.wait_for_selector('text=John Doe', timeout=60000); pg.wait_for_timeout(800); cast.start(); t0=time.time(); mark('queue_loaded')
    glide(pg,760,250); pg.wait_for_timeout(2500)
    glide(pg,1230,250); pg.wait_for_timeout(1500); mark('flag_card')
    glide(pg,800,600); wheel(pg,700); pg.wait_for_timeout(800); mark('table')
    # flagged request
    fr=pg.locator('tr', has_text='Flagged').first; fr.scroll_into_view_if_needed(); pg.wait_for_timeout(600)
    bb=fr.bounding_box(); glide(pg,bb['x']+250,bb['y']+bb['height']/2); pg.wait_for_timeout(500)
    fr.locator('td').nth(1).click(); pg.wait_for_timeout(2500); mark('flag_drawer')
    pg.wait_for_timeout(3000); pg.keyboard.press('Escape'); pg.wait_for_timeout(900)
    # John's request
    row=pg.locator('tr', has_text='John Doe').filter(has_text='310,645').nth(GRANT_ROW_INDEX)
    row.scroll_into_view_if_needed(); pg.wait_for_timeout(600)
    bb=row.bounding_box(); glide(pg,bb['x']+250,bb['y']+bb['height']/2); pg.wait_for_timeout(600)
    row.locator('text=John Doe').click(); pg.wait_for_timeout(1500); mark('john_drawer')
    glide(pg,1250,450); pg.wait_for_timeout(2500)
    wheel(pg,520,20); pg.wait_for_timeout(3000); mark('brief')
    wheel(pg,520,20); pg.wait_for_timeout(2800); mark('score')
    # approve
    btn=pg.get_by_role('button', name='Approve and pay $310,645')
    bb=btn.bounding_box(); glide(pg,bb['x']+bb['width']/2,bb['y']+bb['height']/2); pg.wait_for_timeout(700)
    if DRY:
        pg.wait_for_timeout(1000); cast.stop(); cast.build('rec/admin_dry.mp4'); b.close(); raise SystemExit('dry run done')
    btn.click(); pg.wait_for_timeout(1300); mark('confirm_dialog')
    cb=pg.get_by_role('dialog').get_by_role('button', name='Approve $310,645')
    bb=cb.bounding_box(); glide(pg,bb['x']+bb['width']/2,bb['y']+bb['height']/2,15); pg.wait_for_timeout(600)
    cb.click(); mark('approved_click')
    try:
        pg.wait_for_selector('text=Nessie payment', timeout=45000); mark('nessie_shown')
    except Exception as e: mark('nessie_timeout')
    pg.wait_for_timeout(5000); mark('end')
    open('rec/admin_after.txt','w',encoding='utf8').write(pg.inner_text('body'))
    pg.screenshot(path='rec/admin_after.png')
    cast.stop(); cast.build('rec/admin.mp4')
    ctx.close(); b.close()
