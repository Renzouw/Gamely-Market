"""
Draws Gamely's app icon and its variants from one design: a price line that
steps down to the lime "lowest price" dot (the game page chart, in miniature).

    python scripts/make-icons.py

Writes into assets/. Changing the icon needs a new APK (it's native), so after
running this, raise "version" in app.json and run `npm run build:android`.
"""
from pathlib import Path

from PIL import Image, ImageDraw

INK = (15, 15, 14, 255)  # theme bg (dark)
PAPER = (244, 242, 236, 255)  # theme text (dark)
LIME = (200, 240, 74, 255)  # signal
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)

# The mark, in a 100 x 100 design grid
LINE = [(24, 30), (42, 30), (42, 46), (56, 46), (56, 62), (64, 62)]
STROKE = 7
DOT = ((74, 62), 8)
# Centre of the mark's bounding box (x 20.5-82, y 26.5-70), so it can be centred
MARK_CENTER = (51.25, 48.25)

SS = 4  # draw 4x larger, then shrink: smooth edges
ASSETS = Path(__file__).resolve().parent.parent / "assets"


def draw(size, scale=1.0, bg=CLEAR, line=PAPER, dot=LIME, rounded=0.0):
    """The mark at `scale` (1 = as designed), centred on a size x size canvas."""
    big = size * SS
    img = Image.new("RGBA", (big, big), CLEAR)
    d = ImageDraw.Draw(img)
    if bg[3]:
        if rounded:
            d.rounded_rectangle((0, 0, big - 1, big - 1), radius=rounded * big, fill=bg)
        else:
            d.rectangle((0, 0, big, big), fill=bg)
    unit = big / 100

    def at(p):
        x = 50 + (p[0] - MARK_CENTER[0]) * scale
        y = 50 + (p[1] - MARK_CENTER[1]) * scale
        return (x * unit, y * unit)

    w = STROKE * scale * unit
    pts = [at(p) for p in LINE]
    d.line(pts, fill=line, width=round(w), joint="curve")
    for x, y in pts:  # round caps and corners
        d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=line)
    (cx, cy), r = at(DOT[0]), DOT[1] * scale * unit
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=dot)
    return img.resize((size, size), Image.LANCZOS)


def save(img, name):
    img.save(ASSETS / name, optimize=True)
    print("wrote", name, img.size)


# Store / legacy / iOS icon: full square, the OS rounds the corners
save(draw(1024, scale=1.05, bg=INK), "icon.png")
# Android adaptive icon: the mark must sit inside the middle 66% (any mask shape)
save(draw(1024, scale=0.78), "android-icon-foreground.png")
save(Image.new("RGBA", (1024, 1024), INK), "android-icon-background.png")
# Themed (Material You) icons tint this one-colour version
save(draw(1024, scale=0.78, line=WHITE, dot=WHITE), "android-icon-monochrome.png")
# Notification small icon: white on transparent, drawn large in its square
save(draw(96, scale=1.35, line=WHITE, dot=WHITE), "notification-icon.png")
# Splash: the mark alone on the ink background (set in app.json). Android crops it to the middle circle too
save(draw(1024, scale=0.8), "splash-icon.png")
# Browser tab
save(draw(48, scale=1.15, bg=INK, rounded=0.22), "favicon.png")
