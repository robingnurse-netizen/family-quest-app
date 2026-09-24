"""Make the lit-windows overlay for the meadow background at night.

Usage: python scripts/make-night-windows.py
Reads  assets/bg-meadow-day-final.png (not modified)
Writes assets/bg-meadow-night-windows.png: same size, transparent except the
       cottage's window glass, in a warm lit-window yellow.

The glass is the dark pixels (#040403 / #15181c) inside each window frame;
the brown frame and bars (#4d3e39) and the frame's own dark outline stay
transparent, so they still read on top of whatever is beneath. A window's
rectangle includes its frame, so its 1 px border is never lit.

Windows listed in FRAME_GLOW also light their bars between the lit panes
(every non-glass pixel inside the box around the lit glass) in a dimmer
amber, so they read as frame glow rather than more glass.
"""

from PIL import Image

SRC = "assets/bg-meadow-day-final.png"
DST = "assets/bg-meadow-night-windows.png"

# (x0, y0, x1, y1), inclusive, frame included.
WINDOWS = {
    "gable": (140, 40, 144, 46),
    "right wing": (182, 54, 187, 63),
}
GLASS = {(4, 4, 3), (21, 24, 28)}  # #040403, #15181c
LIT = (242, 201, 76, 255)  # #f2c94c
GLOW = (168, 116, 58, 255)  # #a8743a: darker, duller amber
FRAME_GLOW = {"right wing"}

src = Image.open(SRC).convert("RGB")
assert src.size == (320, 128), src.size
out = Image.new("RGBA", src.size, (0, 0, 0, 0))

for name, (x0, y0, x1, y1) in WINDOWS.items():
    lit = []
    for y in range(y0 + 1, y1):
        for x in range(x0 + 1, x1):
            if src.getpixel((x, y)) in GLASS:
                out.putpixel((x, y), LIT)
                lit.append((x, y))
    print(f"{name}: {len(lit)} px lit {lit}")
    if name in FRAME_GLOW:
        xs, ys = [x for x, _ in lit], [y for _, y in lit]
        glow = [(x, y) for y in range(min(ys), max(ys) + 1) for x in range(min(xs), max(xs) + 1)
                if (x, y) not in lit]
        for p in glow:
            out.putpixel(p, GLOW)
        print(f"{name}: {len(glow)} px frame glow {glow}")

out.save(DST)
print(f"wrote {DST}: {out.size[0]} x {out.size[1]}")
