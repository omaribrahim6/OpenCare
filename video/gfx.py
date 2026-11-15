# Builds every transparent 1920x1080 overlay PNG for the cut.
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
os.chdir(os.path.dirname(os.path.abspath(__file__)))
W, H = 1920, 1080
F = 'C:/Windows/Fonts/'
def font(n, s): return ImageFont.truetype(F + n, s)
B = lambda s: font('segoeuib.ttf', s)
R = lambda s: font('segoeui.ttf', s)
L = lambda s: font('segoeuil.ttf', s)
PR = lambda s: font('segoeprb.ttf', s)
IRIS = (77, 85, 212); WHITE = (255, 255, 255); INK = (18, 20, 40); MUTED = (80, 84, 110)

def canvas(): return Image.new('RGBA', (W, H), (0, 0, 0, 0))

def shadow_text(im, xy, text, f, fill=WHITE, anchor='la', blur=8, alpha=170):
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(sh)
    d.text((xy[0] + 2, xy[1] + 3), text, font=f, fill=(0, 0, 0, alpha), anchor=anchor)
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(blur)))
    ImageDraw.Draw(im).text(xy, text, font=f, fill=fill, anchor=anchor)

def panel(im, box, r=22, fill=(255, 255, 255, 235)):
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((box[0] + 4, box[1] + 10, box[2] + 4, box[3] + 10), r, fill=(0, 0, 0, 90))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(16)))
    ImageDraw.Draw(im).rounded_rectangle(box, r, fill=fill)

def save(im, n):
    import io
    b = io.BytesIO(); im.save(b, 'PNG'); path = f'gfx/{n}.png'
    if os.path.exists(path) and open(path, 'rb').read() == b.getvalue(): return  # unchanged: keep mtime so cached segments stay valid
    open(path, 'wb').write(b.getvalue())

def lower_third(n, name, role):
    im = canvas(); d = ImageDraw.Draw(im)
    w = max(d.textlength(name, font=B(44)), d.textlength(role, font=R(28))) + 70
    panel(im, (90, 840, 90 + w, 968), r=14, fill=(255, 255, 255, 240))
    d = ImageDraw.Draw(im); d.rectangle((90, 840, 100, 968), fill=IRIS)
    d.text((125, 852), name, font=B(44), fill=INK); d.text((125, 914), role, font=R(28), fill=MUTED)
    save(im, n)

lower_third('lt_bernie', 'Sen. Bernie Sanders', 'Independent, Vermont')
lower_third('lt_aoc', 'Rep. Alexandria Ocasio-Cortez', 'House Oversight hearing on Medicare for All, 2022')
lower_third('lt_abdul', 'Abdul El-Sayed', 'Physician. Senator-elect, Michigan')

def source_tag(n, text):
    im = canvas(); d = ImageDraw.Draw(im); w = d.textlength(text, font=R(24)) + 36
    d.rounded_rectangle((W - 60 - w, 48, W - 60, 92), 10, fill=(0, 0, 0, 140))
    d.text((W - 60 - w + 18, 55), text, font=R(24), fill=(235, 235, 240)); save(im, n)

source_tag('src_cnn', 'CNN, The Source with Kaitlan Collins, Nov 10, 2026')
source_tag('src_protest', 'March for Medicare for All, Washington DC (News2Share)')
source_tag('src_cbs', 'Medicare for All march, South Gate CA (CBS LA)')
source_tag('src_veo', 'Dramatization generated with Google Veo')
source_tag('src_real', 'Real footage: our 3D-printed CareCard and the kiosk')

# the bill
im = canvas(); shadow_text(im, (W // 2, 470), '$456,832.16', B(170), anchor='mm', blur=14, alpha=200)
shadow_text(im, (W // 2, 600), "John's hospital bill. Uninsured.", R(46), anchor='mm'); save(im, 'bill_total')

# canada
im = canvas(); shadow_text(im, (W // 2, 150), 'Our team is from Canada.', PR(76), anchor='mm', blur=10, alpha=210); save(im, 'canada_title')

# trumpcare card (two states)
im = Image.new('RGBA', (W, H), (14, 15, 24, 255)); d = ImageDraw.Draw(im)
d.text((W // 2, 330), 'Our working name:', font=L(54), fill=(190, 192, 210), anchor='mm')
d.text((W // 2, 470), 'TrumpCare', font=B(150), fill=WHITE, anchor='mm'); save(im, 'tc_a')
im2 = im.copy(); d = ImageDraw.Draw(im2); tw = d.textlength('TrumpCare', font=B(150))
d.line((W // 2 - tw / 2 - 20, 478, W // 2 + tw / 2 + 20, 462), fill=(235, 70, 80), width=14)
wm = Image.open('gfx/opencare-wordmark-white.png'); wm = wm.resize((int(wm.width * 0.62), int(wm.height * 0.62)))
im2.alpha_composite(wm, (W // 2 - wm.width // 2, 640)); save(im2, 'tc_b')

# fund diagram, one layer per element
def box(im, xy, title, sub, accent):
    x, y = xy; panel(im, (x, y, x + 470, y + 190), r=24); d = ImageDraw.Draw(im)
    d.rounded_rectangle((x + 28, y + 30, x + 40, y + 160), 6, fill=accent)
    d.text((x + 64, y + 40), title, font=B(40), fill=INK)
    d.multiline_text((x + 64, y + 100), sub, font=R(26), fill=MUTED, spacing=6)

cols = [(96, 175, 140), (77, 85, 212), (240, 140, 90)]
items = [('Hospitals', 'Charity care they already owe\nto keep their tax exemption'),
         ('Public programs', 'e.g. Massachusetts\nHealth Safety Net'),
         ('Donors', 'Anyone, by card or\ndevnet SOL')]
for i, (t, s) in enumerate(items):
    im = canvas(); box(im, (150, 210 + i * 240), t, s, cols[i]); d = ImageDraw.Draw(im)
    d.line((640, 305 + i * 240, 900, 540), fill=(255, 255, 255, 220), width=6); save(im, f'fd{i + 1}')
im = canvas(); panel(im, (910, 400, 1440, 680), r=30, fill=(77, 85, 212, 245)); d = ImageDraw.Draw(im)
d.text((1175, 490), 'Community', font=B(54), fill=WHITE, anchor='mm')
d.text((1175, 560), 'Care Fund', font=B(54), fill=WHITE, anchor='mm')
d.text((1175, 630), 'a person approves every grant', font=R(26), fill=(225, 228, 255), anchor='mm'); save(im, 'fd0')
im = canvas(); d = ImageDraw.Draw(im)
d.line((1450, 540, 1560, 540), fill=WHITE, width=6); d.polygon([(1560, 524), (1590, 540), (1560, 556)], fill=WHITE)
panel(im, (1600, 420, 1860, 660), r=24); d = ImageDraw.Draw(im)
d.text((1730, 500), 'Pays the', font=R(32), fill=INK, anchor='mm')
d.text((1730, 545), 'hospital', font=B(40), fill=INK, anchor='mm')
d.text((1730, 600), 'directly', font=R(32), fill=INK, anchor='mm'); save(im, 'fd4')

def tag(n, text, xy, anchor='la', size=34):
    im = canvas(); d = ImageDraw.Draw(im); f = B(size); w = d.textlength(text, font=f)
    x, y = xy; x0 = x if anchor == 'la' else x - w - 44
    panel(im, (x0, y, x0 + w + 44, y + size + 30), r=16, fill=(255, 255, 255, 238))
    ImageDraw.Draw(im).text((x0 + 22, y + 12), text, font=f, fill=INK); save(im, n)

tag('tag_card', "John's CareCard: 3D-printed, NFC inside", (80, 880))
tag('tag_kiosk', 'Hospital kiosk phone', (W - 80, 880), anchor='ra')

# phone side panels (discount steps build up)
steps = [('Itemized bill', '$456,832.16', INK), ('Uninsured self-pay discount', '-$54,819.86', (20, 140, 90)),
         ('Hospital charity care', '-$68,524.82', (20, 140, 90)), ('Prompt-pay discount', '-$22,842.48', (20, 140, 90))]
for k in range(1, 5):
    im = canvas()
    for i, (a, b_, c) in enumerate(steps[:k]):
        y = 250 + i * 120; panel(im, (1150, y, 1820, y + 96), r=18); d = ImageDraw.Draw(im)
        d.text((1180, y + 48), a, font=R(32), fill=(70, 72, 95), anchor='lm')
        d.text((1790, y + 48), b_, font=B(36), fill=c, anchor='rm')
    if k == 4:
        shadow_text(im, (1160, 760), 'Hospital decisions are simulated for the demo.', R(26))
    save(im, f'ph{k}')
im = canvas(); panel(im, (1150, 250, 1820, 520), r=24, fill=(77, 85, 212, 245)); d = ImageDraw.Draw(im)
d.text((1185, 290), 'Left after the hospital', font=R(32), fill=(225, 228, 255))
d.text((1185, 345), '$310,645', font=B(92), fill=WHITE)
d.text((1185, 465), 'sent to the community fund, one tap', font=R(28), fill=(225, 228, 255)); save(im, 'ph5')
im = canvas(); panel(im, (100, 330, 760, 560), r=24, fill=(255, 255, 255, 240)); d = ImageDraw.Draw(im)
d.text((140, 365), 'No forms.', font=B(64), fill=INK)
d.text((140, 455), 'The card is the whole application.', font=R(30), fill=MUTED); save(im, 'ph_noforms')

# admin call-outs
tag('ad_queue', 'Ordered by a published need formula. Everyone is eligible.', (90, 870), size=32)
tag('ad_flag', 'Flagged: hidden instructions in a bill. Nothing changes.', (90, 870), size=32)
tag('ad_case', "John's case: need score 80 / 100", (90, 870), size=32)
tag('ad_human', 'A person approves every grant', (90, 870), size=32)

def card(n, title, lines, accent):
    im = canvas(); panel(im, (1060, 700, 1840, 980), r=26); d = ImageDraw.Draw(im)
    d.rounded_rectangle((1090, 730, 1104, 950), 7, fill=accent); d.text((1130, 725), title, font=B(40), fill=INK)
    for i, l in enumerate(lines): d.text((1130, 790 + i * 48), l, font=R(30), fill=(70, 72, 95))
    save(im, n)

card('nessie', 'Capital One Nessie API', ['Paid Valley General Hospital (fictional)', '$310,645  ·  payment e69921ab…', 'Mock banking for the demo'], (204, 40, 40))
card('solana', 'Solana devnet receipt', ['Confirmed  ·  tx 67WUe1…QswGWH', 'No names. No diagnosis.', 'Anyone can verify it'], (153, 69, 255))
tag('led_tag', 'Public ledger, case OC-8B87', (90, 870), size=32)

# end card
im = Image.new('RGBA', (W, H), (246, 245, 252, 255)); g = Image.new('RGBA', (W, H)); gd = ImageDraw.Draw(g)
for r_, c in [(900, (201, 193, 240, 90)), (700, (190, 220, 250, 80)), (520, (255, 214, 190, 70))]:
    gd.ellipse((W // 2 - r_, H // 2 - r_ - 80, W // 2 + r_, H // 2 + r_ - 80), fill=c)
im.alpha_composite(g.filter(ImageFilter.GaussianBlur(120)))
wm = Image.open('gfx/opencare-wordmark.png'); im.alpha_composite(wm, (W // 2 - wm.width // 2, 300))
d = ImageDraw.Draw(im)
d.text((W // 2, 600), 'Care for all.', font=L(72), fill=INK, anchor='mm')
d.text((W // 2, 690), 'Tap your card. Watch your bill shrink. A person approves the rest.', font=R(34), fill=MUTED, anchor='mm')
d.text((W // 2, 800), 'Built at HackUMass XIV', font=B(30), fill=IRIS, anchor='mm')
d.multiline_text((W // 2, 960),
    'Independent hackathon prototype. Fictional patient data, Capital One Nessie mock banking, Solana devnet. Not affiliated with or endorsed by any political figure.\n'
    'Clips: Sen. Bernie Sanders, Abdul El-Sayed, Forbes Breaking News, CNN, News2Share, CBS LA. Generated scenes: Google Veo. Music: Google Lyria.',
    font=R(22), fill=(110, 112, 135), anchor='mm', align='center', spacing=8)
save(im, 'endcard')
print('ok')
