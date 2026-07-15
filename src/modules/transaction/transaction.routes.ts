import { jwt } from "@elysiajs/jwt";
import { and, desc, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { mkdir } from "node:fs/promises";
import { extname, join } from "node:path";

import { db } from "../../db";
import { category, transaction, wallet } from "../../db/schema";
import { errorResponse, successResponse } from "../../lib/api-response";

const jwtSecret = Bun.env.JWT_SECRET;

if (!jwtSecret) {
  throw new Error("JWT_SECRET is required");
}

const authError = errorResponse("Unauthorized", {
  code: "UNAUTHORIZED",
});

const receiptUploadDir = join(process.cwd(), "public", "uploads", "receipts");
const receiptPublicPath = "/uploads/receipts";

const saveReceiptImage = async (accountId: string, image?: File) => {
  if (!image) return undefined;

  await mkdir(receiptUploadDir, { recursive: true });

  const extension = extname(image.name) || `.${image.type.split("/")[1]}`;
  const filename = `${accountId}-${crypto.randomUUID()}${extension}`;
  const filepath = join(receiptUploadDir, filename);

  await Bun.write(filepath, image);

  return `${receiptPublicPath}/${filename}`;
};

const getAccountId = async (
  authorization: string | undefined,
  jwtVerify: (token: string) => Promise<false | { sub?: string }>,
) => {
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : authorization;

  if (!token) return null;

  const payload = await jwtVerify(token);
  if (!payload) return null;

  return payload?.sub ?? null;
};

const transactionBody = t.Object({
  type: t.Union([t.Literal("income"), t.Literal("expense")]),
  amount: t.String({ minLength: 1 }),
  name: t.String({ minLength: 1 }),
  categoryName: t.String({ minLength: 1 }),
  walletId: t.Optional(t.Number({ minimum: 1 })),
  budgetId: t.Optional(t.Number({ minimum: 1 })),
  isAiGenerated: t.Optional(t.Boolean()),
  receiptImage: t.Optional(
    t.File({
      type: "image",
      maxSize: "5m",
    }),
  ),
  reportDate: t.Optional(t.String()),
});

const transactionColumns = {
  transactionId: transaction.transactionId,
  accountId: transaction.accountId,
  walletId: transaction.walletId,
  categoryId: transaction.categoryId,
  budgetId: transaction.budgetId,
  type: transaction.type,
  amount: transaction.amount,
  name: transaction.name,
  isAiGenerated: transaction.isAiGenerated,
  receiptImageUrl: transaction.receiptImageUrl,
  reportDate: transaction.reportDate,
  createdAt: transaction.createdAt,
  updatedAt: transaction.updatedAt,
};

export const transactionRoutes = new Elysia({ prefix: "/transactions" })
  .use(
    jwt({
      name: "jwt",
      secret: jwtSecret,
    }),
  )
  .get("/", async ({ headers, jwt, status }) => {
    const accountId = await getAccountId(headers.authorization, jwt.verify);

    if (!accountId) {
      return status(401, authError);
    }

    const transactions = await db.query.transaction.findMany({
      where: eq(transaction.accountId, accountId),
      orderBy: desc(transaction.createdAt),
      with: {
        wallet: true,
        category: true,
        budget: true,
      },
    });

    return successResponse("Transactions fetched", transactions);
  })
  .post(
    "/",
    async ({ body, headers, jwt, status }) => {
      const accountId = await getAccountId(headers.authorization, jwt.verify);

      if (!accountId) {
        return status(401, authError);
      }

      const amount = Number(body.amount);

      if (!Number.isFinite(amount) || amount <= 0) {
        return status(
          400,
          errorResponse("Amount must be a positive number", {
            code: "INVALID_AMOUNT",
          }),
        );
      }

      const receiptImageUrl = await saveReceiptImage(
        accountId,
        body.receiptImage,
      );

      const result = await db.transaction(async (tx) => {
        const selectedWallet = body.walletId
          ? await tx.query.wallet.findFirst({
              where: and(
                eq(wallet.walletId, body.walletId),
                eq(wallet.accountId, accountId),
              ),
            })
          : await tx.query.wallet.findFirst({
              where: and(
                eq(wallet.accountId, accountId),
                eq(wallet.isPrimary, true),
              ),
            });

        if (!selectedWallet) {
          throw new Error(
            body.walletId ? "WALLET_NOT_FOUND" : "PRIMARY_WALLET_NOT_FOUND",
          );
        }

        const existingCategory = await tx.query.category.findFirst({
          where: and(
            eq(category.accountId, accountId),
            eq(category.name, body.categoryName),
          ),
        });

        const selectedCategory =
          existingCategory ??
          (
            await tx
              .insert(category)
              .values({
                accountId,
                name: body.categoryName,
              })
              .returning()
          )[0];

        if (!selectedCategory) {
          throw new Error("CATEGORY_CREATE_FAILED");
        }

        const [createdTransaction] = await tx
          .insert(transaction)
          .values({
            accountId,
            walletId: selectedWallet.walletId,
            categoryId: selectedCategory.categoryId,
            budgetId: body.budgetId,
            type: body.type,
            amount: amount.toString(),
            name: body.name,
            isAiGenerated: body.isAiGenerated ?? false,
            receiptImageUrl,
            reportDate: body.reportDate ? new Date(body.reportDate) : new Date(),
          })
          .returning(transactionColumns);

        if (!createdTransaction) {
          throw new Error("TRANSACTION_CREATE_FAILED");
        }

        const balanceDelta = body.type === "income" ? amount : -amount;

        const [updatedWallet] = await tx
          .update(wallet)
          .set({
            balance: sql`${wallet.balance} + ${balanceDelta}`,
          })
          .where(eq(wallet.walletId, selectedWallet.walletId))
          .returning({
            walletId: wallet.walletId,
            name: wallet.name,
            balance: wallet.balance,
            isPrimary: wallet.isPrimary,
          });

        return {
          transaction: createdTransaction,
          category: selectedCategory,
          wallet: updatedWallet,
        };
      });

      return status(201, successResponse("Transaction created", result));
    },
    {
      body: transactionBody,
    },
  )
  .onError(({ error, status }) => {
    if (!(error instanceof Error)) {
      throw error;
    }

    if (error.message === "WALLET_NOT_FOUND") {
      return status(
        404,
        errorResponse("Wallet not found", {
          code: "WALLET_NOT_FOUND",
        }),
      );
    }

    if (error.message === "PRIMARY_WALLET_NOT_FOUND") {
      return status(
        404,
        errorResponse("Primary wallet not found", {
          code: "PRIMARY_WALLET_NOT_FOUND",
        }),
      );
    }

    throw error;
  });
