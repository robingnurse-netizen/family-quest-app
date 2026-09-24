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

/** Settings (lucide "settings"). */
export const GearIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

/** Sound on (lucide "volume-2"). */
export const SpeakerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
    <path d="M16 9a5 5 0 0 1 0 6" />
    <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
  </Icon>
);

/** Sound off (lucide "volume-x"). */
export const SpeakerOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
    <path d="m22 9-6 6M16 9l6 6" />
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

// --- Reward icons (the item shop) -------------------------------------------

const GIFT: PixelArt = {
  colors: { o: "#3b0a0a", r: "#e03131", d: "#a51d1d", y: "#fcc419", h: "#fff3bf" },
  rows: [
    "...yy..yy...",
    "..yhy..yhy..",
    "...yyyyyy...",
    "oooooyyooooo",
    "orrrryyrrrro",
    "oddddyyddddo",
    ".orrryyrrro.",
    ".orrryyrrro.",
    ".orrryyrrro.",
    ".odddyydddo.",
    ".oooooooooo.",
  ],
};
/** Gift */
export const GiftIcon = (p: IconProps) => <PixelIcon art={GIFT} {...p} />;

const CASH: PixelArt = {
  colors: { o: "#1b4332", g: "#40c057", d: "#2b8a3e", l: "#b2f2bb", w: "#ebfbee" },
  rows: [
    "oooooooooooo",
    "oggggggggggo",
    "oglwwwwwwlgo",
    "ogw.oddo.wgo",
    "ogw.dldd.wgo",
    "ogw.oddo.wgo",
    "oglwwwwwwlgo",
    "oddddddddddo",
    "oooooooooooo",
  ],
};
/** Pocket money */
export const CashIcon = (p: IconProps) => <PixelIcon art={CASH} {...p} />;

const CONTROLLER: PixelArt = {
  colors: { o: "#12141f", b: "#4a5170", h: "#a9b0c8", r: "#e03131", g: "#40c057", y: "#fcc419" },
  rows: [
    "..oooooooo..",
    ".obhbbbbbbo.",
    "obhhhbbbybbo",
    "obbhbbbrbgbo",
    "obbbbbbbbbbo",
    "obbbooooobbo",
    ".obo....obo.",
    "..o......o..",
  ],
};
/** Games / screen time */
export const ControllerIcon = (p: IconProps) => <PixelIcon art={CONTROLLER} {...p} />;

const TREAT: PixelArt = {
  colors: { o: "#3b2412", p: "#f783ac", w: "#fff0f6", c: "#d9a066", k: "#a86f43", r: "#e03131" },
  rows: [
    "....orro....",
    "...ooppoo...",
    "..opwwpppo..",
    ".opwppppppo.",
    ".oppppppppo.",
    "oooooooooooo",
    ".okcckcckco.",
    "..okcckcko..",
    "...okccko...",
    "....okco....",
    ".....oo.....",
  ],
};
/** Treat */
export const TreatIcon = (p: IconProps) => <PixelIcon art={TREAT} {...p} />;

const TICKET: PixelArt = {
  colors: { o: "#5c3b00", y: "#fcc419", d: "#f59f00", r: "#c92a2a", w: "#fff3bf" },
  rows: [
    "oooooooooooo",
    "oyyyyydyyyyo",
    ".oyrrydywyyo",
    "..oyrrdyyyyo",
    ".oyrrydywyyo",
    "oyyyyydyyyyo",
    "oooooooooooo",
  ],
};
/** Day out */
export const TicketIcon = (p: IconProps) => <PixelIcon art={TICKET} {...p} />;

const TOY: PixelArt = {
  colors: { o: "#3b2412", b: "#c77d3a", l: "#e8b27a", k: "#12141f", p: "#f783ac" },
  rows: [
    ".oo......oo.",
    "oblo....olbo",
    "obboooooobbo",
    ".obbbbbbbbo.",
    ".obkbbbbkbo.",
    ".obbbllbbbo.",
    ".obblkklbbo.",
    "..obbllbbo..",
    ".obbbpbbbbo.",
    "oblbbbbbblbo",
    ".oboooooobo.",
  ],
};
/** Toy */
export const ToyIcon = (p: IconProps) => <PixelIcon art={TOY} {...p} />;

const BOOK: PixelArt = {
  colors: { o: "#12141f", b: "#1c7ed6", d: "#1864ab", p: "#f1e2c0", y: "#fcc419" },
  rows: [
    ".ooooooooooo",
    "obbbbbbbbbbo",
    "obbyyyyyybbo",
    "obbbbbbbbbbo",
    "obbbyyyybbbo",
    "obbbbbbbbbbo",
    "obbbbbbbbbbo",
    "odpppppppppo",
    "odoooooooooo",
    ".o..........",
  ],
};
/** Book */
export const BookIcon = (p: IconProps) => <PixelIcon art={BOOK} {...p} />;

const PIZZA: PixelArt = {
  colors: { o: "#5c3b00", c: "#e8b27a", k: "#c77d3a", y: "#fcc419", r: "#e03131", h: "#fff3bf" },
  rows: [
    "oooooooooooo",
    "okkkkkkkkkko",
    ".oyyryyyyyo.",
    ".oyrryyhyyo.",
    "..oyyyyrro..",
    "..oyhyyrro..",
    "...oyyyyo...",
    "...oyryo....",
    "....oyyo....",
    "....oyo.....",
    ".....o......",
  ],
};
/** Pizza */
export const PizzaIcon = (p: IconProps) => <PixelIcon art={PIZZA} {...p} />;

const MOVIE: PixelArt = {
  colors: { o: "#12141f", w: "#f1f3f5", k: "#343a40", g: "#868e96" },
  rows: [
    "owwokkowwokk",
    ".owwokkowwok",
    "..oooooooooo",
    "oooooooooooo",
    "okkkkkkkkkko",
    "okwwwwwwwwko",
    "okkkkkkkkkko",
    "okgggggggkko",
    "okkkkkkkkkko",
    "oooooooooooo",
  ],
};
/** Movie */
export const MovieIcon = (p: IconProps) => <PixelIcon art={MOVIE} {...p} />;

const COINSTACK: PixelArt = {
  colors: { o: "#5c3b00", f: "#fcc419", h: "#fff3bf", s: "#e67700" },
  rows: [
    "...oooooo...",
    "..ohhhfffo..",
    "..osssssso..",
    "..ofhfffffo.",
    ".oooooooooo.",
    ".ohhffffffo.",
    ".osssssssso.",
    "oooooooooooo",
    "ohhhffffffso",
    "osssssssssso",
    "ofhffffffffo",
    "osssssssssso",
    "oooooooooooo",
  ],
};
/** A stack of gold (the coin purse) */
export const CoinStackIcon = (p: IconProps) => <PixelIcon art={COINSTACK} {...p} />;

// PLACEHOLDER art for the potions (store): a simple flask, red liquid for
// the small potion and a taller, fuller one for the large. To be replaced in
// the PixelLab art pass (see CLAUDE.md).
const POTION_SMALL: PixelArt = {
  colors: { o: "#2b1d0e", c: "#8a5a2b", g: "#dee2e6", h: "#ffffff", f: "#e03131", s: "#a51d1d", l: "#ff8787" },
  rows: [
    "....ooo....",
    "....oco....",
    "....ogo....",
    "...oogoo...",
    "..oggghgo..",
    ".oggggghgo.",
    ".offlffffo.",
    ".offfffffo.",
    ".offfffsso.",
    "..offsssso.",
    "...oooooo..",
  ],
};
const POTION_LARGE: PixelArt = {
  colors: { o: "#2b1d0e", c: "#8a5a2b", g: "#dee2e6", h: "#ffffff", f: "#e03131", s: "#a51d1d", l: "#ff8787" },
  rows: [
    "....ooo....",
    "....oco....",
    "...ooooo...",
    "...ogggo...",
    "..oogghoo..",
    ".oggggghgo.",
    ".offlffhfo.",
    "offlffffffo",
    "offfffffffo",
    "offffffffso",
    "offfffffsso",
    ".offffsssso",
    "..ooooooooo",
  ],
};
/** Potions (placeholder art). */
export const PotionIcon = ({ size = "small", ...p }: IconProps & { size?: "small" | "large" }) => (
  <PixelIcon art={size === "large" ? POTION_LARGE : POTION_SMALL} {...p} />
);
