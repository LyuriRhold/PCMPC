import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

// Better Auth's HTTP endpoints (sign-in, sign-out, get-session). Sign-up and self-service
// profile endpoints are disabled in src/lib/auth.ts.
export const { GET, POST } = toNextJsHandler((request: Request) => getAuth().handler(request));
