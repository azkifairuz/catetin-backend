import { Elysia } from "elysia";

import { authRoutes } from "./modules/auth/auth.routes";
import { categoryRoutes } from "./modules/category/category.routes";
import { logRoutes } from "./modules/log/log.routes";
import { transactionRoutes } from "./modules/transaction/transaction.routes";
import { walletRoutes } from "./modules/wallet/wallet.routes";

export const app = new Elysia()
  .use(authRoutes)
  .use(categoryRoutes)
  .use(transactionRoutes)
  .use(walletRoutes)
  .use(logRoutes)
  .get("/uploads/categories/:filename", ({ params: { filename }, status }) => {
    const file = Bun.file(`public/uploads/categories/${filename}`);

    if (!file.exists()) {
      return status(404, "Not found");
    }

    return file;
  })
  .get("/uploads/receipts/:filename", ({ params: { filename }, status }) => {
    const file = Bun.file(`public/uploads/receipts/${filename}`);

    if (!file.exists()) {
      return status(404, "Not found");
    }

    return file;
  })
  .get("/", () => "Hello Elysia")
  .get("/health", () => ({ status: "ok" }));
