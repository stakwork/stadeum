import type { NextRequest } from "next/server";

import { handlers } from "@/auth";
import { unlabelState } from "@/lib/signin-bounce";

export const POST = handlers.POST;

/** A callback through the sign-in bounce carries this box's label on its state: off, before Auth.js reads it. */
export const GET = (req: NextRequest) => handlers.GET(unlabelState(req));
