import { NextResponse, type NextRequest } from "next/server";
import { runDailyResetForAllFamilies } from "@/lib/game-logic/daily-reset";

/**
 * Daily reset job, triggered by Vercel Cron (see vercel.json).
 * Vercel sends `Authorization: Bearer $CRON_SECRET`.
 *
 * Runs run_daily_reset() for every family with the service role key: marks
 * past open slots missed and damages party health, then handles escapes (and
 * any boss left at 0 HP). Boss damage itself is instant on completion.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runDailyResetForAllFamilies();
    const failed = results.filter((r) => "error" in r);
    return NextResponse.json(
      { ok: failed.length === 0, ranAt: new Date().toISOString(), results },
      { status: failed.length ? 500 : 200 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Reset failed" },
      { status: 500 },
    );
  }
}
