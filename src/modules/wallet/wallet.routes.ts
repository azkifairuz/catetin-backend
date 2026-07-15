import { jwt } from "@elysiajs/jwt";
import { and, desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { db } from "../../db";
import { wallet } from "../../db/schema";
import { authError, getAccountId, jwtSecret } from "../../lib/auth";
import { errorResponse, successResponse } from "../../lib/api-response";
import { logApiEvent } from "../../lib/log-service";

const createWalletBody = t.Object({
  name: t.String({ minLength: 1 }),
  balance: t.Optional(t.String({ minLength: 1 })),
  isPrimary: t.Optional(t.Boolean()),
});

const updateWalletBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  balance: t.Optional(t.String({ minLength: 1 })),
  isPrimary: t.Optional(t.Boolean()),
});

const walletParams = t.Object({
  walletId: t.Number({ minimum: 1 }),
});

const walletColumns = {
  walletId: wallet.walletId,
  accountId: wallet.accountId,
  name: wallet.name,
  balance: wallet.balance,
  isPrimary: wallet.isPrimary,
};

const isPositiveOrZeroNumber = (value: string) => {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) && numberValue >= 0;
};

export const walletRoutes = new Elysia({ prefix: "/wallets" })
  .use(
    jwt({
      name: "jwt",
      secret: jwtSecret,
    }),
  )
  .get("/", async ({ headers, jwt, status }) => {
    const accountId = await getAccountId(headers.authorization, jwt.verify);

    if (!accountId) {
      logApiEvent(401, "Unauthorized", {
        module: "wallet",
        action: "list",
      });

      return status(401, authError);
    }

    const wallets = await db.query.wallet.findMany({
      where: eq(wallet.accountId, accountId),
      orderBy: desc(wallet.isPrimary),
    });

    logApiEvent(200, "Wallets fetched", {
      accountId,
      count: wallets.length,
    });

    return successResponse("Wallets fetched", wallets);
  })
  .get(
    "/:walletId",
    async ({ headers, jwt, params, status }) => {
      const accountId = await getAccountId(headers.authorization, jwt.verify);

      if (!accountId) {
        logApiEvent(401, "Unauthorized", {
          module: "wallet",
          action: "detail",
          walletId: params.walletId,
        });

        return status(401, authError);
      }

      const existingWallet = await db.query.wallet.findFirst({
        where: and(
          eq(wallet.walletId, params.walletId),
          eq(wallet.accountId, accountId),
        ),
      });

      if (!existingWallet) {
        logApiEvent(404, "Wallet not found", {
          accountId,
          walletId: params.walletId,
        });

        return status(
          404,
          errorResponse("Wallet not found", {
            code: "WALLET_NOT_FOUND",
          }),
        );
      }

      logApiEvent(200, "Wallet fetched", {
        accountId,
        walletId: existingWallet.walletId,
      });

      return successResponse("Wallet fetched", existingWallet);
    },
    {
      params: walletParams,
    },
  )
  .post(
    "/",
    async ({ body, headers, jwt, status }) => {
      const accountId = await getAccountId(headers.authorization, jwt.verify);

      if (!accountId) {
        logApiEvent(401, "Unauthorized", {
          module: "wallet",
          action: "create",
        });

        return status(401, authError);
      }

      const balance = body.balance ?? "0";

      if (!isPositiveOrZeroNumber(balance)) {
        logApiEvent(400, "Balance must be a positive number or zero", {
          accountId,
          balance,
        });

        return status(
          400,
          errorResponse("Balance must be a positive number or zero", {
            code: "INVALID_BALANCE",
          }),
        );
      }

      const createdWallet = await db.transaction(async (tx) => {
        const existingWallet = await tx.query.wallet.findFirst({
          where: eq(wallet.accountId, accountId),
          columns: {
            walletId: true,
          },
        });
        const shouldBePrimary = body.isPrimary ?? !existingWallet;

        if (shouldBePrimary) {
          await tx
            .update(wallet)
            .set({ isPrimary: false })
            .where(eq(wallet.accountId, accountId));
        }

        const [newWallet] = await tx
          .insert(wallet)
          .values({
            accountId,
            name: body.name,
            balance,
            isPrimary: shouldBePrimary,
          })
          .returning(walletColumns);

        return newWallet;
      });

      logApiEvent(201, "Wallet created", {
        accountId,
        walletId: createdWallet?.walletId,
      });

      return status(201, successResponse("Wallet created", createdWallet));
    },
    {
      body: createWalletBody,
    },
  )
  .patch(
    "/:walletId",
    async ({ body, headers, jwt, params, status }) => {
      const accountId = await getAccountId(headers.authorization, jwt.verify);

      if (!accountId) {
        logApiEvent(401, "Unauthorized", {
          module: "wallet",
          action: "update",
          walletId: params.walletId,
        });

        return status(401, authError);
      }

      if (body.balance && !isPositiveOrZeroNumber(body.balance)) {
        logApiEvent(400, "Balance must be a positive number or zero", {
          accountId,
          walletId: params.walletId,
          balance: body.balance,
        });

        return status(
          400,
          errorResponse("Balance must be a positive number or zero", {
            code: "INVALID_BALANCE",
          }),
        );
      }

      const updatedWallet = await db.transaction(async (tx) => {
        const existingWallet = await tx.query.wallet.findFirst({
          where: and(
            eq(wallet.walletId, params.walletId),
            eq(wallet.accountId, accountId),
          ),
        });

        if (!existingWallet) return null;

        if (body.isPrimary === true) {
          await tx
            .update(wallet)
            .set({ isPrimary: false })
            .where(eq(wallet.accountId, accountId));
        }

        const [currentWallet] = await tx
          .update(wallet)
          .set({
            name: body.name ?? existingWallet.name,
            balance: body.balance ?? existingWallet.balance,
            isPrimary: body.isPrimary ?? existingWallet.isPrimary,
          })
          .where(
            and(
              eq(wallet.walletId, params.walletId),
              eq(wallet.accountId, accountId),
            ),
          )
          .returning(walletColumns);

        return currentWallet;
      });

      if (!updatedWallet) {
        logApiEvent(404, "Wallet not found", {
          accountId,
          walletId: params.walletId,
        });

        return status(
          404,
          errorResponse("Wallet not found", {
            code: "WALLET_NOT_FOUND",
          }),
        );
      }

      logApiEvent(200, "Wallet updated", {
        accountId,
        walletId: updatedWallet.walletId,
      });

      return successResponse("Wallet updated", updatedWallet);
    },
    {
      body: updateWalletBody,
      params: walletParams,
    },
  )
  .delete(
    "/:walletId",
    async ({ headers, jwt, params, status }) => {
      const accountId = await getAccountId(headers.authorization, jwt.verify);

      if (!accountId) {
        logApiEvent(401, "Unauthorized", {
          module: "wallet",
          action: "delete",
          walletId: params.walletId,
        });

        return status(401, authError);
      }

      const [deletedWallet] = await db
        .delete(wallet)
        .where(
          and(
            eq(wallet.walletId, params.walletId),
            eq(wallet.accountId, accountId),
          ),
        )
        .returning(walletColumns);

      if (!deletedWallet) {
        logApiEvent(404, "Wallet not found", {
          accountId,
          walletId: params.walletId,
        });

        return status(
          404,
          errorResponse("Wallet not found", {
            code: "WALLET_NOT_FOUND",
          }),
        );
      }

      logApiEvent(200, "Wallet deleted", {
        accountId,
        walletId: deletedWallet.walletId,
      });

      return successResponse("Wallet deleted", deletedWallet);
    },
    {
      params: walletParams,
    },
  );
