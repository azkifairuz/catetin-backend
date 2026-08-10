import { jwt } from "@elysiajs/jwt";
import { Elysia, t } from "elysia";
import { authError, getAccountId, jwtSecret } from "../../lib/auth";
import { successResponse } from "../../lib/api-response";
import { handleApiError } from "../../lib/error-handler";
import { logApiEvent } from "../../lib/log-service";
import { dashboardService } from "./dashboard.service";
const querySchema = t.Object({ startDate: t.Optional(t.String()), endDate: t.Optional(t.String()), limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })) });
export const dashboardRoutes = new Elysia({ prefix: "/dashboard" }).use(jwt({ name: "jwt", secret: jwtSecret })).get("/", async ({ headers, jwt, query, status }) => { const id = await getAccountId(headers.authorization, jwt.verify); if (!id) return status(401, authError); const data = await dashboardService.get(id, query); logApiEvent(200, "Dashboard fetched", { accountId: id, startDate: data.range.startDate, endDate: data.range.endDate, transactionCount: data.summary.transactionCount }); return successResponse("Dashboard fetched", data); }, { query: querySchema }).onError(({ code, error, status }) => handleApiError(error, status, "dashboard", code));
