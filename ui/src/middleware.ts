import { NextResponse, type NextRequest } from "next/server";

import { PATH_HEADER } from "@/lib/next-path";

/**
 * Hands each page the address it was asked for, so a sign-in it sends a
 * person to comes back there (`lib/next-path.ts`). It sets the header
 * itself, whatever a request carried, and decides nothing else.
 */
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set(PATH_HEADER, `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!api/|_next/|signin|icon\\.svg|favicon\\.ico).*)"] };
