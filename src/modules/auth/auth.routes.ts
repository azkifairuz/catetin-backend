import { jwt } from "@elysiajs/jwt";
import { Elysia, t } from "elysia";

import { errorResponse, successResponse } from "../../lib/api-response";
import { logApiEvent } from "../../lib/log-service";
import { authService } from "./auth.service";

const jwtSecret = Bun.env.JWT_SECRET;
if (!jwtSecret) throw new Error("JWT_SECRET is required");

const authBody = t.Object({
  whatsappNumber: t.String({ minLength: 8 }),
  username: t.String({ minLength: 3 }),
  password: t.String({ minLength: 6 }),
});

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(jwt({ name: "jwt", secret: jwtSecret, exp: "7d" }))
  .post("/register", async ({ body, status }) => {
    const outcome = await authService.register(body);
    if (outcome.kind === "invalid-number") return status(400, errorResponse("Invalid WhatsApp number", { code: "INVALID_WHATSAPP_NUMBER" }));
    if (outcome.kind === "already-registered") {
      logApiEvent(409, "WhatsApp number already registered", { whatsappNumber: outcome.whatsappNumber });
      return status(409, errorResponse("WhatsApp number already registered", { code: "WHATSAPP_NUMBER_ALREADY_REGISTERED" }));
    }
    logApiEvent(201, "Account registered", { accountId: outcome.result.account.accountId, walletId: outcome.result.wallet.walletId });
    return status(201, successResponse("Account registered", outcome.result));
  }, { body: authBody })
  .post("/login", async ({ body, jwt, status }) => {
    const outcome = await authService.login(body);
    if (outcome.kind === "invalid-number") return status(400, errorResponse("Invalid WhatsApp number", { code: "INVALID_WHATSAPP_NUMBER" }));
    if (outcome.kind === "invalid-credentials") {
      logApiEvent(401, "Invalid credentials", { accountId: outcome.account?.accountId, whatsappNumber: outcome.whatsappNumber });
      return status(401, errorResponse("Invalid credentials", { code: "INVALID_CREDENTIALS" }));
    }
    const token = await jwt.sign({ sub: outcome.account.accountId, whatsappNumber: outcome.account.whatsappNumber ?? undefined });
    logApiEvent(200, "Login successful", { accountId: outcome.account.accountId, whatsappNumber: outcome.account.whatsappNumber });
    return successResponse("Login successful", { token, account: { accountId: outcome.account.accountId, username: outcome.account.username, whatsappNumber: outcome.account.whatsappNumber, createdAt: outcome.account.createdAt } });
  }, { body: authBody });
