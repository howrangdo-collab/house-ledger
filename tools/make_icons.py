# -*- coding: utf-8 -*-
"""앱 아이콘 생성. 둥근 사각형 배경 + '마감' 글자."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "app" / "public"
BG = (61, 107, 92)      # --accent
FG = (244, 241, 236)

def font_for(size):
    for name in ("malgunbd.ttf", "malgun.ttf", "NanumGothicBold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()

def make(px, path, rounded=True):
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, px - 1, px - 1], radius=int(px * 0.22), fill=BG)
    else:
        d.rectangle([0, 0, px - 1, px - 1], fill=BG)

    f = font_for(int(px * 0.34))
    text = "마감"
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    d.text(((px - (r - l)) / 2 - l, (px - (b - t)) / 2 - t), text, font=f, fill=FG)
    img.save(path)
    return path.name

made = [
    make(180, OUT / "apple-touch-icon.png", rounded=False),  # iOS가 알아서 둥글게 깎는다
    make(192, OUT / "icon-192.png"),
    make(512, OUT / "icon-512.png"),
]
print("생성:", ", ".join(made))
