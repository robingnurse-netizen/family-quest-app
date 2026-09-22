import { NextResponse, type NextRequest } from "next/server";

/**
 * Daily reset job, triggered by Vercel Cron (see vercel.json).
 * Vercel sends `Authorization: Bearer $CRON_SECRET`.
 *
 * Phase 1: auth check only. The game logic (marking missed slots, applying
 * miss penalties, boss escape, streaks) lands in a later phase and will use
 * createAdminClient() from @/lib/supabase/admin.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString() });
}
