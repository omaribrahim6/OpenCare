from PIL import Image, ImageDraw, ImageFilter
import random
src = 'photos/'
files = ['1.jpg','2.webp','3.jpg','4.webp']; angles = [-7, 5, -4, 8]
for i,(f,a) in enumerate(zip(files,angles)):
    im = Image.open(src+f).convert('RGB'); s = min(im.size)
    im = im.crop(((im.width-s)//2,(im.height-s)//2,(im.width+s)//2,(im.height+s)//2)).resize((340,340), Image.LANCZOS)
    # warm paper tone + slight grain
    card = Image.new('RGBA',(380,430),(250,247,240,255)); card.paste(im,(20,20))
    d = ImageDraw.Draw(card)
    # tape strip
    tape = Image.new('RGBA',(130,38),(236,226,190,190)); card.alpha_composite(tape.rotate(-a*1.5, expand=True),(125,-6))
    big = Image.new('RGBA',(560,600),(0,0,0,0))
    sh = Image.new('RGBA',card.size,(0,0,0,110)).filter(ImageFilter.GaussianBlur(0))
    big.alpha_composite(sh,(98,96)); big = big.filter(ImageFilter.GaussianBlur(10))
    big.alpha_composite(card,(85,80))
    big = big.rotate(a, resample=Image.BICUBIC, expand=False)
    big.save(f'gfx/team{i+1}.png')
print('ok')
