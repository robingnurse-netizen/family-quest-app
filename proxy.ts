import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except API routes (cron authenticates itself), Next internals
    // and static assets.
    "/((?!api|_next/static|_next/image|favicon.ico|sprites/|sounds/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|wav|mp3)$).*)",
  ],
};
