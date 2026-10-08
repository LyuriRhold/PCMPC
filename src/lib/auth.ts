import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { getDb } from "@/db/client";
import { authAccounts, sessions, users, verifications } from "@/modules/auth/schema";
import { afterSignInAttempt, beforeSignIn, SignInBlockedError } from "@/modules/auth/service";

const HOUR = 60 * 60;

/** Session idle timeout: 8 hours (PHASE-01, CONFIRM). Sliding: a session used within the window is extended. */
export const SESSION_IDLE_SECONDS = 8 * HOUR;

function createAuth() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return betterAuth({
    appName: "PCMPC MIS",
    secret,
    baseURL: process.env.APP_URL ?? "http://localhost:3000",
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: { user: users, session: sessions, account: authAccounts, verification: verifications },
    }),
    advanced: { database: { generateId: "uuid" } },
    // Our own columns on `users`. input:false = never accepted from a client request; users are
    // created by the Users admin (src/modules/auth/service.ts), not by Better Auth sign-up.
    user: {
      additionalFields: {
        roleCode: { type: "string", required: true, input: false },
        isActive: { type: "boolean", required: false, defaultValue: true, input: false },
        failedAttempts: { type: "number", required: false, defaultValue: 0, input: false },
      },
    },
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10, maxPasswordLength: 128 },
    session: { expiresIn: SESSION_IDLE_SECONDS, updateAge: 5 * 60 },
    // Staff accounts are created and changed only through the Users admin (audited, permission-checked).
    disabledPaths: [
      "/sign-up/email",
      "/sign-in/email",
      "/update-user",
      "/change-email",
      "/change-password",
      "/set-password",
      "/delete-user",
      "/request-password-reset",
      "/reset-password",
      "/forget-password",
      "/is-username-available",
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/username") return;
        try {
          await beforeSignIn(String(ctx.body?.username ?? ""));
        } catch (e) {
          if (e instanceof SignInBlockedError) throw new APIError("FORBIDDEN", { message: e.message });
          throw e;
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/username") return;
        const returned = ctx.context.returned;
        const failed = isAPIError(returned) || returned instanceof Error;
        await afterSignInAttempt(String(ctx.body?.username ?? ""), !failed);
      }),
    },
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 30, displayUsername: false }), nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const g = globalThis as { __pcmpcAuth?: Auth };

/** The Better Auth instance (created on first use so scripts that never sign in don't need AUTH_SECRET). */
export function getAuth(): Auth {
  g.__pcmpcAuth ??= createAuth();
  return g.__pcmpcAuth;
}
