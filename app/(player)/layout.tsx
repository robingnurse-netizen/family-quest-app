import { Nunito, Pixelify_Sans } from "next/font/google";

// Player-only fonts (self-hosted by next/font, so the PWA works offline).
// Exposed as --font-display / --font-body in globals.css.
//
// Pixelify Sans only at 600: at 700 the counters of 2, 3 and 5 fill in and
// "22" reads as "88". Its small digits stay ambiguous (5 ≈ S) below ~24px,
// so numbers smaller than that use the body font (Nunito) instead.
const pixelify = Pixelify_Sans({
  variable: "--font-pixelify",
  subsets: ["latin"],
  weight: "600",
});

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "700", "800", "900"],
});

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${pixelify.variable} ${nunito.variable} bg-world flex flex-1 flex-col font-body text-base text-parchment`}>
      {children}
    </div>
  );
}
