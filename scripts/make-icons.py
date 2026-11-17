# Alkalmazás ikonok generálása (PIL). Futtatás: python3 scripts/make-icons.py
from PIL import Image, ImageDraw
import os
res = 'android/app/src/main/res'
GREEN=(11,93,75,255); YEL=(255,200,61,255); WHITE=(255,253,248,255); INK=(20,35,31,255)

def bus(d, S, ox=0, oy=0, k=1.0):
    # busz-sziluett a (0..S) vászon közepén, k = méretarány
    def p(x,y): return (ox+S*(0.5+(x-0.5)*k), oy+S*(0.5+(y-0.5)*k))
    d.rounded_rectangle([*p(0.22,0.20), *p(0.78,0.74)], radius=S*0.09*k, fill=WHITE)
    d.rounded_rectangle([*p(0.27,0.26), *p(0.73,0.46)], radius=S*0.035*k, fill=GREEN)      # ablak
    d.rectangle([*p(0.22,0.54), *p(0.78,0.585)], fill=YEL)                                  # sárga sáv
    for cx in (0.34,0.66):
        c=p(cx,0.645); r=S*0.04*k; d.ellipse([c[0]-r,c[1]-r,c[0]+r,c[1]+r], fill=INK)       # lámpák
    for cx in (0.31,0.69):
        d.rounded_rectangle([*p(cx-0.045,0.72), *p(cx+0.045,0.82)], radius=S*0.02*k, fill=WHITE)  # kerekek

def full(S, round_=False):
    im = Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(im)
    if round_: d.ellipse([0,0,S-1,S-1], fill=GREEN)
    else: d.rounded_rectangle([0,0,S-1,S-1], radius=int(S*0.22), fill=GREEN)
    bus(d,S,k=1.0); return im
def fg(S):
    im = Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(im); bus(d,S,k=0.62); return im

dens={'mdpi':1,'hdpi':1.5,'xhdpi':2,'xxhdpi':3,'xxxhdpi':4}
for n,m in dens.items():
    dp=os.path.join(res,f'mipmap-{n}')
    full(int(48*m)).save(os.path.join(dp,'ic_launcher.png'))
    full(int(48*m),True).save(os.path.join(dp,'ic_launcher_round.png'))
    fg(int(108*m)).save(os.path.join(dp,'ic_launcher_foreground.png'))
open(os.path.join(res,'values','ic_launcher_background.xml'),'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B5D4B</color>\n</resources>\n')
# a sablon vektoros előtér/háttér nem kell (a mipmap PNG-ket használjuk)
for f in ('drawable-v24/ic_launcher_foreground.xml','drawable/ic_launcher_background.xml'):
    p=os.path.join(res,f)
    if os.path.exists(p): os.remove(p)
print('ikonok kész')
