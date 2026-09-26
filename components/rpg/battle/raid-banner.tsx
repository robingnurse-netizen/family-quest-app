"use client";

import { useId } from "react";
import { HeartIcon } from "@/components/ui/icons";

// The evening nudge as a pixel-art ribbon banner (under the stats row on
// /player): a night-sky band — deep blue on the left to sky blue on the
// right in hard, stair-stepped colour bands — with white "+" sparkles, an
// orange "+" gem near each end, and a swallowtail ribbon tail behind each
// end (a darker fold where it meets the band). All CSS / inline SVG, so the
// text stays crisp and wraps: on a narrow screen the band grows taller, the
// tails stay anchored to its lower corners and nothing overflows sideways.
// Styles: .raid-banner* in app/globals.css (pixel size --rb-px).
//
// No moon or paw icon exists yet, so the heart stays at the start.

/** The band's colour steps, left (night) → right (sky). White text is ≥ 4.6:1 on each. */
const BANDS = ["#1a2260", "#1f2f7a", "#274093", "#2e52a8", "#3663b8", "#3f74c4"];

/** Staircase between two bands: 3 steps of PX, repeating down the boundary. */
const PX = 4;
const STEPS = 3;

/** White "+" sparkles on the band: [x %, y %], kept near the top and bottom edges. */
const SPARKLES: [number, number][] = [
  [9, 22], [21, 74], [33, 18], [47, 80], [58, 20], [71, 76], [83, 24], [92, 72],
];

export function RaidBanner({ text }: { text: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <div className="raid-banner">
      <RibbonTail side="left" />
      <RibbonTail side="right" />
      <div className="raid-banner-band">
        <svg aria-hidden className="raid-banner-fill" shapeRendering="crispEdges">
          <defs>
            {BANDS.slice(1).map((color, i) => (
              <pattern
                key={color}
                id={`${id}-step-${i}`}
                width={PX * STEPS}
                height={PX * STEPS}
                patternUnits="userSpaceOnUse"
              >
                <rect width={PX * STEPS} height={PX * STEPS} fill={BANDS[i]} />
                {Array.from({ length: STEPS }, (_, row) => (
                  <rect
                    key={row}
                    x={PX * (STEPS - 1 - row)}
                    y={PX * row}
                    width={PX * (row + 1)}
                    height={PX}
                    fill={color}
                  />
                ))}
              </pattern>
            ))}
          </defs>
          {BANDS.map((color, i) => (
            <svg key={color} x={`${(i * 100) / BANDS.length}%`} overflow="visible">
              <rect width="100%" height="100%" fill={color} />
              {/* The stair-stepped edge into the band on the left. */}
              {i > 0 && <rect x={-PX * STEPS} width={PX * STEPS} height="100%" fill={`url(#${id}-step-${i - 1})`} />}
            </svg>
          ))}
          {SPARKLES.map(([x, y], i) => (
            <svg key={i} x={`${x}%`} y={`${y}%`} overflow="visible" className="raid-banner-sparkle" style={{ animationDelay: `${(i % 4) * 0.35}s` }}>
              <PixelPlus unit={2} color="#ffffff" />
            </svg>
          ))}
          <svg x={PX * 2} y="50%" overflow="visible">
            <PixelPlus unit={3} color="#fd7e14" core="#fff3bf" />
          </svg>
          <svg x="100%" y="50%" overflow="visible">
            <svg x={-PX * 2} overflow="visible">
              <PixelPlus unit={3} color="#fd7e14" core="#fff3bf" />
            </svg>
          </svg>
        </svg>
        <p className="raid-banner-text">
          <HeartIcon className="h-5 w-5 shrink-0" />
          {/* All Pixelify at weight 600, digits included (the digit rule's weight). */}
          <span>{text}</span>
        </p>
      </div>
    </div>
  );
}

/** A pixel "+" centred on (0, 0): `unit` px per pixel, with an optional centre colour. */
function PixelPlus({ unit, color, core }: { unit: number; color: string; core?: string }) {
  const u = unit;
  return (
    <g>
      <rect x={-u * 1.5} y={-u * 0.5} width={u * 3} height={u} fill={color} />
      <rect x={-u * 0.5} y={-u * 1.5} width={u} height={u * 3} fill={color} />
      {core && <rect x={-u * 0.5} y={-u * 0.5} width={u} height={u} fill={core} />}
    </g>
  );
}

// The tail behind the band's left end (the right one is mirrored), one
// character per --rb-px pixel. Rows 0–5 sit beside the band (column 9 is
// hidden behind it); rows 6–8 hang below its lower edge, where the dark fold
// (f) shows the ribbon turning back. The notch on the outer end is the
// swallowtail cut.
const TAIL = {
  // o = the band's outline colour (--color-world-deep).
  colors: { o: "#1b1535", h: "#a5d8ff", t: "#74b3ec", s: "#4f86cc", f: "#2a1d52" } as Record<string, string>,
  rows: [
    "oooooooooo",
    "ohhhhhhhhh",
    ".otttttttt",
    "..ottttttt",
    "...otttsss",
    "..ottttsss",
    ".otttttoff",
    "ottttttoof",
    "oooooooooo",
  ],
};

function RibbonTail({ side }: { side: "left" | "right" }) {
  const rects: React.ReactElement[] = [];
  TAIL.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === c) end++;
      const fill = TAIL.colors[c];
      if (fill) rects.push(<rect key={`${x},${y}`} x={x} y={y} width={end - x} height={1} fill={fill} />);
      x = end;
    }
  });
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${TAIL.rows[0].length} ${TAIL.rows.length}`}
      shapeRendering="crispEdges"
      className={`raid-banner-tail raid-banner-tail-${side}`}
    >
      {rects}
    </svg>
  );
}
