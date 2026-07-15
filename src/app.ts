import { Elysia } from "elysia";

import { authRoutes } from "./modules/auth/auth.routes";
import { transactionRoutes } from "./modules/transaction/transaction.routes";

export const app = new Elysia()
  .use(authRoutes)
  .use(transactionRoutes)
  .get("/uploads/receipts/:filename", ({ params: { filename }, status }) => {
    const file = Bun.file(`public/uploads/receipts/${filename}`);

    if (!file.exists()) {
      return status(404, "Not found");
    }

    return file;
  })
  .get("/", () => "Hello Elysia")
  .get("/health", () => ({ status: "ok" }));
