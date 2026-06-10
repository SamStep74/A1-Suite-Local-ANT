/**
 * Login response schema — mirrors server/app.js#app.post("/api/login", ...).
 * Source: server/app.js:291-329
 */
import { z } from "zod";

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  org_id: z.string().optional(),
  role: z.string().optional(),
  locale: z.string().optional(),
  apps: z.array(z.string()).optional(),
});
export type User = z.infer<typeof UserSchema>;

export const LoginResponseSchema = z.object({
  user: UserSchema,
  /**
   * Session token (sid) returned in the body. The new TanStack Start app
   * uses this for `Authorization: Bearer <sid>` because Chrome refuses to
   * store HttpOnly cookies on `credentials: "include"` CORS-mode responses
   * through the Vite dev proxy. See vite.config.ts for the bisection.
   * The legacy Vite app ignores the body field and uses the cookie.
   */
  sid: z.string().optional(),
  /** True if MFA is required; in that case the user must complete /api/login/mfa. */
  mfaRequired: z.boolean().optional(),
});

export const MfaChallengeSchema = z.object({
  challengeId: z.string(),
  method: z.enum(["totp", "email", "sms"]),
});
