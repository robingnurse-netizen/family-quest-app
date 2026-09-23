import {
  BookIcon,
  CashIcon,
  ControllerIcon,
  GiftIcon,
  MovieIcon,
  PizzaIcon,
  StarIcon,
  TicketIcon,
  ToyIcon,
  TreatIcon,
} from "@/components/ui/icons";
import { isPixelRewardIcon, rewardIcon, type PixelRewardIcon } from "@/lib/rewards/icons";

const PIXEL: Record<PixelRewardIcon, (p: React.SVGProps<SVGSVGElement>) => React.ReactElement> = {
  "px:gift": GiftIcon,
  "px:cash": CashIcon,
  "px:controller": ControllerIcon,
  "px:treat": TreatIcon,
  "px:ticket": TicketIcon,
  "px:toy": ToyIcon,
  "px:book": BookIcon,
  "px:pizza": PizzaIcon,
  "px:movie": MovieIcon,
  "px:star": StarIcon,
};

/**
 * A reward's icon: a pixel icon ("px:…") or a legacy emoji. `slot` sits it
 * in an inset pixel item slot (the player's shop), so emoji blend with the
 * pixel style; `plain` is just the glyph (Parent HQ). `size` is the glyph's
 * box in px.
 */
export function RewardIcon({
  value,
  size = 32,
  variant = "plain",
  className = "",
}: {
  value: string | null | undefined;
  size?: number;
  variant?: "plain" | "slot";
  className?: string;
}) {
  const icon = rewardIcon(value);
  const glyph = isPixelRewardIcon(icon) ? (
    (() => {
      const Pixel = PIXEL[icon];
      return <Pixel style={{ width: size, height: size }} className="shrink-0" />;
    })()
  ) : (
    <span aria-hidden className="leading-none" style={{ fontSize: size * 0.85 }}>
      {icon}
    </span>
  );
  if (variant === "plain") return <span className={`inline-flex items-center justify-center ${className}`}>{glyph}</span>;
  return (
    <span
      aria-hidden
      className={`item-slot inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size + 20, height: size + 20 }}
    >
      {glyph}
    </span>
  );
}
