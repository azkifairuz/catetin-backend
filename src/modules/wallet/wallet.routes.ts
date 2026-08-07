import { jwt } from "@elysiajs/jwt";
import { Elysia, t } from "elysia";
import { authError, getAccountId, jwtSecret } from "../../lib/auth";
import { errorResponse, successResponse } from "../../lib/api-response";
import { logApiEvent } from "../../lib/log-service";
import { walletService } from "./wallet.service";

const createBody = t.Object({ name: t.String({ minLength: 1 }), balance: t.Optional(t.String({ minLength: 1 })), isPrimary: t.Optional(t.Boolean()) });
const updateBody = t.Object({ name: t.Optional(t.String({ minLength: 1 })), balance: t.Optional(t.String({ minLength: 1 })), isPrimary: t.Optional(t.Boolean()) });
const paramsSchema = t.Object({ walletId: t.Number({ minimum: 1 }) });
const missing = () => errorResponse("Wallet not found", { code: "WALLET_NOT_FOUND" });
const invalid = () => errorResponse("Balance must be a positive number or zero", { code: "INVALID_BALANCE" });

export const walletRoutes = new Elysia({ prefix: "/wallets" })
  .use(jwt({ name: "jwt", secret: jwtSecret }))
  .get("/", async ({ headers, jwt, status }) => { const id = await getAccountId(headers.authorization, jwt.verify); if (!id) return status(401, authError); const data = await walletService.list(id); logApiEvent(200, "Wallets fetched", { accountId: id, count: data.length }); return successResponse("Wallets fetched", data); })
  .get("/:walletId", async ({ headers, jwt, params, status }) => { const id = await getAccountId(headers.authorization, jwt.verify); if (!id) return status(401, authError); const data = await walletService.find(id, params.walletId); if (!data) return status(404, missing()); return successResponse("Wallet fetched", data); }, { params: paramsSchema })
  .post("/", async ({ body, headers, jwt, status }) => { const id = await getAccountId(headers.authorization, jwt.verify); if (!id) return status(401, authError); const result = await walletService.create(id, body); if (result.kind === "invalid-balance") return status(400, invalid()); logApiEvent(201, "Wallet created", { accountId: id, walletId: result.wallet?.walletId }); return status(201, successResponse("Wallet created", result.wallet)); }, { body: createBody })
  .patch("/:walletId", async ({ body, headers, jwt, params, status }) => { const id = await getAccountId(headers.authorization, jwt.verify); if (!id) return status(401, authError); const result = await walletService.update(id, params.walletId, body); if (result.kind === "invalid-balance") return status(400, invalid()); if (result.kind === "not-found") return status(404, missing()); return successResponse("Wallet updated", result.wallet); }, { body: updateBody, params: paramsSchema })
  .delete("/:walletId", async ({ headers, jwt, params, status }) => { const id = await getAccountId(headers.authorization, jwt.verify); if (!id) return status(401, authError); const result = await walletService.delete(id, params.walletId); if (result.kind === "not-found") return status(404, missing()); return successResponse("Wallet deleted", result.wallet); }, { params: paramsSchema });
