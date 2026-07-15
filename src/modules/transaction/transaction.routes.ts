import { jwt } from "@elysiajs/jwt";
import { and, desc, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { db } from "../../db";
import { category, transaction, wallet } from "../../db/schema";
import { authError, getAccountId, jwtSecret } from "../../lib/auth";
import { errorResponse, successResponse } from "../../lib/api-response";
import { logApiEvent } from "../../lib/log-service";
import { saveUploadedImage } from "../../lib/upload";

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

const aiGenerateBody = t.Object({
  text: t.String({ minLength: 1 }),
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

type CreateTransactionInput = {
  accountId: string;
  type: "income" | "expense";
  amount: string;
  name: string;
  categoryName: string;
  walletId?: number;
  budgetId?: number;
  isAiGenerated?: boolean;
  receiptImageUrl?: string;
  reportDate?: string;
};

type GeminiTransactionOutput = {
  type: "income" | "expense";
  amount: number;
  name: string;
  categoryName: string;
  reportDate?: string;
};

const getGeminiApiKey = () => Bun.env.GEMINI_API_KEY ?? Bun.env.GOOGLE_API_KEY;

const extractJsonObject = (text: string) => {
  const trimmedText = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  const startIndex = trimmedText.indexOf("{");

  if (startIndex === -1) {
    throw new SyntaxError("JSON object not found");
  }

  let depth = 0;
  let isInsideString = false;
  let isEscaped = false;

  for (let index = startIndex; index < trimmedText.length; index += 1) {
    const character = trimmedText[index];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (character === "\\") {
      isEscaped = true;
      continue;
    }

    if (character === '"') {
      isInsideString = !isInsideString;
      continue;
    }

    if (isInsideString) continue;

    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;

    if (depth === 0) {
      return trimmedText.slice(startIndex, index + 1);
    }
  }

  throw new SyntaxError("JSON object is incomplete");
};

const parseJsonFromText = (text: string) => {
  return JSON.parse(extractJsonObject(text)) as GeminiTransactionOutput;
};

const generateTransactionFromText = async (text: string) => {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_NOT_FOUND");
  }

  const model = Bun.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: [
                  "Ubah teks catatan ke JSON transaksi.",
                  "Output hanya JSON valid tanpa markdown.",
                  "Schema: {\"type\":\"income|expense\",\"amount\":number,\"name\":\"string\",\"categoryName\":\"string\",\"reportDate\":\"YYYY-MM-DD optional\"}.",
                  "Gunakan bahasa Indonesia singkat untuk name dan categoryName.",
                  "Jika teks berisi pengeluaran seperti beli, bayar, jajan, makan, transport, gunakan type expense.",
                  "Jika teks berisi pemasukan seperti gaji, bonus, terima uang, gunakan type income.",
                  "Nominal Indonesia seperti 20.000 berarti 20000.",
                  `Teks: ${text}`,
                ].join("\n"),
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["income", "expense"],
              },
              amount: {
                type: "number",
              },
              name: {
                type: "string",
              },
              categoryName: {
                type: "string",
              },
              reportDate: {
                type: "string",
              },
            },
            required: ["type", "amount", "name", "categoryName"],
          },
          temperature: 0.1,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error("GEMINI_GENERATE_FAILED");
  }

  const data = await response.json();
  const generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (typeof generatedText !== "string") {
    throw new Error("GEMINI_EMPTY_OUTPUT");
  }

  return parseJsonFromText(generatedText);
};

const createTransaction = async (input: CreateTransactionInput) => {
  const amount = Number(input.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("INVALID_AMOUNT");
  }

  return db.transaction(async (tx) => {
    const selectedWallet = input.walletId
      ? await tx.query.wallet.findFirst({
          where: and(
            eq(wallet.walletId, input.walletId),
            eq(wallet.accountId, input.accountId),
          ),
        })
      : await tx.query.wallet.findFirst({
          where: and(
            eq(wallet.accountId, input.accountId),
            eq(wallet.isPrimary, true),
          ),
        });

    if (!selectedWallet) {
      throw new Error(
        input.walletId ? "WALLET_NOT_FOUND" : "PRIMARY_WALLET_NOT_FOUND",
      );
    }

    const existingCategory = await tx.query.category.findFirst({
      where: and(
        eq(category.accountId, input.accountId),
        eq(category.name, input.categoryName),
      ),
    });

    const selectedCategory =
      existingCategory ??
      (
        await tx
          .insert(category)
          .values({
            accountId: input.accountId,
            name: input.categoryName,
          })
          .returning()
      )[0];

    if (!selectedCategory) {
      throw new Error("CATEGORY_CREATE_FAILED");
    }

    const [createdTransaction] = await tx
      .insert(transaction)
      .values({
        accountId: input.accountId,
        walletId: selectedWallet.walletId,
        categoryId: selectedCategory.categoryId,
        budgetId: input.budgetId,
        type: input.type,
        amount: amount.toString(),
        name: input.name,
        isAiGenerated: input.isAiGenerated ?? false,
        receiptImageUrl: input.receiptImageUrl,
        reportDate: input.reportDate ? new Date(input.reportDate) : new Date(),
      })
      .returning(transactionColumns);

    if (!createdTransaction) {
      throw new Error("TRANSACTION_CREATE_FAILED");
    }

    const balanceDelta = input.type === "income" ? amount : -amount;

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
      logApiEvent(401, "Unauthorized", {
        module: "transaction",
        action: "list",
      });

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

    logApiEvent(200, "Transactions fetched", {
      accountId,
      count: transactions.length,
    });

    return successResponse("Transactions fetched", transactions);
  })
  .post(
    "/",
    async ({ body, headers, jwt, status }) => {
      const accountId = await getAccountId(headers.authorization, jwt.verify);

      if (!accountId) {
        logApiEvent(401, "Unauthorized", {
          module: "transaction",
          action: "create",
        });

        return status(401, authError);
      }

      const receiptImageUrl = await saveUploadedImage(
        "receipts",
        "receipts",
        accountId,
        body.receiptImage,
      );

      const result = await createTransaction({
        accountId,
        type: body.type,
        amount: body.amount,
        name: body.name,
        categoryName: body.categoryName,
        walletId: body.walletId,
        budgetId: body.budgetId,
        isAiGenerated: body.isAiGenerated ?? false,
        receiptImageUrl,
        reportDate: body.reportDate,
      });

      logApiEvent(201, "Transaction created", {
        accountId,
        transactionId: result.transaction.transactionId,
        walletId: result.wallet?.walletId,
        categoryId: result.category.categoryId,
      });

      return status(201, successResponse("Transaction created", result));
    },
    {
      body: transactionBody,
    },
  )
  .post(
    "/ai-generate",
    async ({ body, headers, jwt, status }) => {
      const accountId = await getAccountId(headers.authorization, jwt.verify);

      if (!accountId) {
        logApiEvent(401, "Unauthorized", {
          module: "transaction",
          action: "ai-generate",
        });

        return status(401, authError);
      }

      const aiTransaction = await generateTransactionFromText(body.text);

      if (
        !["income", "expense"].includes(aiTransaction.type) ||
        !Number.isFinite(Number(aiTransaction.amount)) ||
        Number(aiTransaction.amount) <= 0 ||
        !aiTransaction.name ||
        !aiTransaction.categoryName
      ) {
        logApiEvent(422, "AI output is not a valid transaction", {
          accountId,
          output: aiTransaction,
        });

        return status(
          422,
          errorResponse("AI output is not a valid transaction", {
            code: "INVALID_AI_OUTPUT",
            output: aiTransaction,
          }),
        );
      }

      const result = await createTransaction({
        accountId,
        type: aiTransaction.type,
        amount: aiTransaction.amount.toString(),
        name: aiTransaction.name,
        categoryName: aiTransaction.categoryName,
        isAiGenerated: true,
        reportDate: aiTransaction.reportDate,
      });

      logApiEvent(201, "Transaction generated", {
        accountId,
        transactionId: result.transaction.transactionId,
        walletId: result.wallet?.walletId,
        categoryId: result.category.categoryId,
        generated: aiTransaction,
      });

      return status(
        201,
        successResponse("Transaction generated", {
          input: body.text,
          generated: aiTransaction,
          ...result,
        }),
      );
    },
    {
      body: aiGenerateBody,
    },
  )
  .onError(({ error, status }) => {
    if (!(error instanceof Error)) {
      throw error;
    }

    if (error.message === "WALLET_NOT_FOUND") {
      logApiEvent(404, "Wallet not found", {
        module: "transaction",
        error: error.message,
      });

      return status(
        404,
        errorResponse("Wallet not found", {
          code: "WALLET_NOT_FOUND",
        }),
      );
    }

    if (error.message === "PRIMARY_WALLET_NOT_FOUND") {
      logApiEvent(404, "Primary wallet not found", {
        module: "transaction",
        error: error.message,
      });

      return status(
        404,
        errorResponse("Primary wallet not found", {
          code: "PRIMARY_WALLET_NOT_FOUND",
        }),
      );
    }

    if (error.message === "INVALID_AMOUNT") {
      logApiEvent(400, "Amount must be a positive number", {
        module: "transaction",
        error: error.message,
      });

      return status(
        400,
        errorResponse("Amount must be a positive number", {
          code: "INVALID_AMOUNT",
        }),
      );
    }

    if (error.message === "GEMINI_API_KEY_NOT_FOUND") {
      logApiEvent(500, "Gemini API key is not configured", {
        module: "transaction",
        error: error.message,
      });

      return status(
        500,
        errorResponse("Gemini API key is not configured", {
          code: "GEMINI_API_KEY_NOT_FOUND",
        }),
      );
    }

    if (error.message === "GEMINI_GENERATE_FAILED") {
      logApiEvent(502, "Failed to generate transaction with Gemini", {
        module: "transaction",
        error: error.message,
      });

      return status(
        502,
        errorResponse("Failed to generate transaction with Gemini", {
          code: "GEMINI_GENERATE_FAILED",
        }),
      );
    }

    if (
      error.message === "GEMINI_EMPTY_OUTPUT" ||
      error instanceof SyntaxError
    ) {
      logApiEvent(502, "Gemini returned invalid output", {
        module: "transaction",
        error: error.message,
      });

      return status(
        502,
        errorResponse("Gemini returned invalid output", {
          code: "GEMINI_INVALID_OUTPUT",
        }),
      );
    }

    throw error;
  });
