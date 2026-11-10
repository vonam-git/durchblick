"""Erzeugt das Programm-Icon (Lupe auf violettem Kreis) als PNG und ICO.
Aufruf: python installer/make_icon.py   (benötigt Pillow)"""
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).parent
S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.ellipse((32, 32, S - 32, S - 32), fill=(109, 74, 255, 255))
d.ellipse((240, 220, 640, 620), outline=(255, 255, 255, 255), width=78)
d.line((590, 570, 790, 770), fill=(255, 255, 255, 255), width=110)
d.ellipse((735, 715, 845, 825), fill=(255, 255, 255, 255))  # runde Griffspitze
img.resize((256, 256), Image.LANCZOS).save(HERE / "durchblick.png")
img.save(HERE / "durchblick.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("Icon erstellt.")
