import { Elysia } from "elysia";

import { errorResponse } from "./lib/api-response";
import { handleApiError } from "./lib/error-handler";
import { authRoutes } from "./modules/auth/auth.routes";
import { categoryRoutes } from "./modules/category/category.routes";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { logRoutes } from "./modules/log/log.routes";
import { transactionRoutes } from "./modules/transaction/transaction.routes";
import { walletRoutes } from "./modules/wallet/wallet.routes";
import { whatsappRoutes } from "./modules/whatsapp/whatsapp.routes";

export const app = new Elysia()
  .use(authRoutes)
  .use(categoryRoutes)
  .use(dashboardRoutes)
  .use(transactionRoutes)
  .use(walletRoutes)
  .use(whatsappRoutes)
  .use(logRoutes)
  .get("/uploads/categories/:filename", ({ params: { filename }, status }) => {
    const file = Bun.file(`public/uploads/categories/${filename}`);

    if (!file.exists()) {
      return status(
        404,
        errorResponse("File not found", {
          code: "FILE_NOT_FOUND",
        }),
      );
    }

    return file;
  })
  .get("/uploads/receipts/:filename", ({ params: { filename }, status }) => {
    const file = Bun.file(`public/uploads/receipts/${filename}`);

    if (!file.exists()) {
      return status(
        404,
        errorResponse("File not found", {
          code: "FILE_NOT_FOUND",
        }),
      );
    }

    return file;
  })
  .get("/", () => "Hello Elysia")
  .get("/health", () => ({ status: "ok" }))
  .onError(({ code, error, status }) =>
    handleApiError(error, status, "app", code),
  );
