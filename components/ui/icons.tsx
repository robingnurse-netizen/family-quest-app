// Small inline SVG icons (lucide-style, 24×24, stroke = currentColor), so
// buttons render consistently across fonts instead of relying on glyphs
// like ‹ › or ×. Pixel-art game icons (coin, heart…) are at the bottom.

type IconProps = React.SVGProps<SVGSVGElement>;

function Icon({ children, className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      {...props}
    >
      {children}
    </svg>
  );
}

export const ChevronLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);

export const ChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
);

export const ArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </Icon>
);

export const XIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

// --- Pixel icons -------------------------------------------------------------
// Player RPG icons drawn on a pixel grid: one character per pixel, mapped to
// a colour ('.' is transparent). Each row is drawn as runs of <rect>s with
// crispEdges so they stay sharp at any size — size them in multiples of the
// grid for the crispest result.

type PixelArt = { colors: Record<string, string>; rows: string[] };

function PixelIcon({ art, className = "h-6 w-6", ...props }: IconProps & { art: PixelArt }) {
  const width = art.rows[0].length;
  const rects: React.ReactElement[] = [];
  art.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === c) end++;
      const fill = art.colors[c];
      if (fill) rects.push(<rect key={`${x},${y}`} x={x} y={y} width={end - x} height={1} fill={fill} />);
      x = end;
    }
  });
  return (
    <svg
      viewBox={`0 0 ${width} ${art.rows.length}`}
      shapeRendering="crispEdges"
      aria-hidden
      className={className}
      {...props}
    >
      {rects}
    </svg>
  );
}

const COIN: PixelArt = {
  colors: { o: "#5c3b00", f: "#fcc419", h: "#fff3bf", s: "#e67700", d: "#f59f00" },
  rows: [
    "....oooo....",
    "..oohhhhoo..",
    ".ohhffffffo.",
    ".ohffddffso.",
    "ohfffddfffso",
    "ohfffddfffso",
    "ohfffddfffso",
    "ohfffddfffso",
    ".offfddffso.",
    ".offffffsso.",
    "..oossssoo..",
    "....oooo....",
  ],
};
/** Gold */
export const CoinIcon = (p: IconProps) => <PixelIcon art={COIN} {...p} />;

const HEART: PixelArt = {
  colors: { o: "#4a0808", f: "#e03131", h: "#ffc9c9", s: "#a51d1d" },
  rows: [
    ".ooo...ooo.",
    "ohhfo.offfo",
    "ohfffofffso",
    "ohfffffffso",
    "offfffffsso",
    ".offfffsso.",
    "..offfsso..",
    "...offso...",
    "....oso....",
    ".....o.....",
  ],
};
/** Party HP */
export const HeartIcon = (p: IconProps) => <PixelIcon art={HEART} {...p} />;

const STAR: PixelArt = {
  colors: { o: "#5c3b00", f: "#fcc419", h: "#fff3bf", s: "#f59f00" },
  rows: [
    ".....o.....",
    "....oho....",
    "...ohffo...",
    "oooohfffooo",
    "ohhhfffffso",
    ".ohffffffo.",
    "..offfffo..",
    "..offoffo..",
    ".offo.osfo.",
    ".oso...oso.",
    ".oo.....oo.",
  ],
};
/** XP */
export const StarIcon = (p: IconProps) => <PixelIcon art={STAR} {...p} />;

const FLAME: PixelArt = {
  colors: { o: "#5c1a00", f: "#fd7e14", h: "#fff3bf", s: "#e03131", y: "#fcc419" },
  rows: [
    "....o......",
    "...ofo.....",
    "...offo..o.",
    "..offfo.ofo",
    "..offsfoofo",
    ".offsyffffo",
    ".ofsyyyfsfo",
    "ofsyyyyyfso",
    "ofsyyhyyfso",
    "ofsyhhhysso",
    ".ossyyysso.",
    "..ossssso..",
    "...ooooo...",
  ],
};
/** Streak */
export const FlameIcon = (p: IconProps) => <PixelIcon art={FLAME} {...p} />;

const SHIELD: PixelArt = {
  colors: { o: "#12141f", f: "#4dabf7", h: "#d0ebff", s: "#1c7ed6", g: "#fcc419" },
  rows: [
    "ooooooooooo",
    "ohhhhgffffo",
    "ohffggffffo",
    "ohfffgfffso",
    "oggggggggso",
    "ohfffgfffso",
    "offffgfffso",
    ".offfgffso.",
    ".offfgffso.",
    "..offgfso..",
    "...ofgso...",
    "....oso....",
    ".....o.....",
  ],
};
/** Level */
export const ShieldIcon = (p: IconProps) => <PixelIcon art={SHIELD} {...p} />;

const SKULL: PixelArt = {
  colors: { o: "#12141f", f: "#f1f3f5", h: "#ffffff", s: "#adb5bd", e: "#e03131" },
  rows: [
    "...ooooo...",
    "..ohhfffo..",
    ".ohfffffso.",
    "ohfffffffso",
    "ofoofffooso",
    "ofoeofoeoso",
    "ofoooooooso",
    ".offfofffo.",
    "..offffso..",
    "..ofofofo..",
    "...ooooo...",
  ],
};
/** Boss */
export const SkullIcon = (p: IconProps) => <PixelIcon art={SKULL} {...p} />;

const HOURGLASS: PixelArt = {
  colors: { o: "#3b2412", w: "#b89458", g: "#f1e2c0", s: "#f59f00" },
  rows: [
    "ooooooooo",
    ".owwwwwo.",
    ".og...go.",
    ".ogsssgo.",
    "..ogsgo..",
    "...oso...",
    "..og.go..",
    ".og.s.go.",
    ".ogsssgo.",
    ".owwwwwo.",
    "ooooooooo",
  ],
};
/** Time left on a quest */
export const HourglassIcon = (p: IconProps) => <PixelIcon art={HOURGLASS} {...p} />;

const PADLOCK: PixelArt = {
  colors: { o: "#12141f", s: "#a9b0c8", f: "#fcc419", d: "#f59f00", k: "#3b2412" },
  rows: [
    "...ooooo...",
    "..os...so..",
    ".os.....so.",
    ".os.....so.",
    "ooooooooooo",
    "offfkkkfffo",
    "offfkkkfffo",
    "offffkffffo",
    "offffkffffo",
    "odddddddddo",
    "ooooooooooo",
  ],
};
/** Fixed, can't be moved */
export const PadlockIcon = (p: IconProps) => <PixelIcon art={PADLOCK} {...p} />;

const CLOCK: PixelArt = {
  colors: { o: "#12141f", f: "#f1f3f5", h: "#12141f" },
  rows: [
    "...ooooo...",
    "..offfffo..",
    ".offfhfffo.",
    "offffhffffo",
    "offffhffffo",
    "offffhhhffo",
    "offfffffffo",
    "offfffffffo",
    ".offfffffo.",
    "..offfffo..",
    "...ooooo...",
  ],
};
/** Event time */
export const ClockIcon = (p: IconProps) => <PixelIcon art={CLOCK} {...p} />;

const PIN: PixelArt = {
  colors: { o: "#4a0808", r: "#e03131", h: "#ffc9c9", s: "#a51d1d", m: "#adb5bd", k: "#495057" },
  rows: [".ooo.", "ohrro", "orrso", "ossso", ".ooo.", "..m..", "..k.."],
};
/** A pushpin holding a note to the board */
export const PinIcon = (p: IconProps) => <PixelIcon art={PIN} {...p} />;

const SCROLL: PixelArt = {
  colors: { o: "#3b2412", p: "#f1e2c0", d: "#d9c9a3", l: "#b89458" },
  rows: [
    ".oooooooooo.",
    "oppppppppppo",
    "odoooooooodo",
    ".opppppppo..",
    ".oplllllpo..",
    ".opppppppo..",
    ".oplllllpo..",
    ".opppppppo..",
    "odoooooooodo",
    "oppppppppppo",
    ".oooooooooo.",
  ],
};
/** An empty quest slot */
export const ScrollIcon = (p: IconProps) => <PixelIcon art={SCROLL} {...p} />;
