import { jwt } from "@elysiajs/jwt";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { db } from "../../db";
import { category, transaction, wallet } from "../../db/schema";
import { authError, getAccountId, jwtSecret } from "../../lib/auth";
import { errorResponse, successResponse } from "../../lib/api-response";
import { handleApiError } from "../../lib/error-handler";
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

const aiSummaryBody = t.Object({
  text: t.String({ minLength: 1 }),
});

const ocrReceiptBody = t.Object({
  receiptImage: t.File({
    type: "image",
    maxSize: "5m",
  }),
  walletId: t.Optional(t.Number({ minimum: 1 })),
  budgetId: t.Optional(t.Number({ minimum: 1 })),
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

type GeminiDateRangeOutput = {
  startDate: string;
  endDate: string;
};

type SummaryTransaction = {
  transactionId: number;
  type: "income" | "expense" | null;
  amount: string | null;
  name: string | null;
  reportDate: Date | null;
  category: {
    name: string | null;
  } | null;
  wallet: {
    name: string | null;
  } | null;
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

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

const startOfDay = (dateText: string) => {
  const date = new Date(`${dateText}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error("INVALID_DATE_RANGE");
  }

  return date;
};

const endOfDay = (dateText: string) => {
  const date = new Date(`${dateText}T23:59:59.999Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error("INVALID_DATE_RANGE");
  }

  return date;
};

const getDateRangeDays = (startDate: Date, endDate: Date) => {
  const oneDay = 24 * 60 * 60 * 1000;

  return Math.floor((endDate.getTime() - startDate.getTime()) / oneDay) + 1;
};

const getDefaultSummaryRange = () => {
  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  );

  return {
    startDate: toDateOnly(startDate),
    endDate: toDateOnly(endDate),
  };
};

const normalizeDateRange = (range: GeminiDateRangeOutput) => {
  const startDate = startOfDay(range.startDate);
  const endDate = endOfDay(range.endDate);

  if (startDate > endDate) {
    throw new Error("INVALID_DATE_RANGE");
  }

  if (getDateRangeDays(startDate, endDate) > 366) {
    throw new Error("SUMMARY_RANGE_TOO_LONG");
  }

  return {
    startDate,
    endDate,
    startDateText: range.startDate,
    endDateText: range.endDate,
  };
};

const calculateSummaryStats = (transactions: SummaryTransaction[]) => {
  const stats = transactions.reduce(
    (result, item) => {
      const amount = Number(item.amount ?? 0);

      if (item.type === "income") {
        result.totalIncome += amount;
        return result;
      }

      if (item.type === "expense") {
        result.totalExpense += amount;

        const categoryName = item.category?.name ?? "Tanpa Kategori";
        result.expenseByCategory[categoryName] =
          (result.expenseByCategory[categoryName] ?? 0) + amount;
      }

      return result;
    },
    {
      totalIncome: 0,
      totalExpense: 0,
      expenseByCategory: {} as Record<string, number>,
    },
  );

  return {
    ...stats,
    netCashflow: stats.totalIncome - stats.totalExpense,
    transactionCount: transactions.length,
  };
};

export const generateTransactionFromText = async (text: string) => {
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

export const generateDateRangeFromText = async (text: string) => {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_NOT_FOUND");
  }

  const model = Bun.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const today = toDateOnly(new Date());
  const defaultRange = getDefaultSummaryRange();
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
                  "Ekstrak rentang tanggal dari pertanyaan summary keuangan.",
                  "Output hanya JSON valid tanpa markdown.",
                  "Schema: {\"startDate\":\"YYYY-MM-DD\",\"endDate\":\"YYYY-MM-DD\"}.",
                  `Tanggal hari ini: ${today}.`,
                  `Jika pertanyaan tidak menyebut tanggal jelas, gunakan bulan berjalan: ${defaultRange.startDate} sampai ${defaultRange.endDate}.`,
                  "Jika user menyebut satu tanggal, startDate dan endDate harus sama.",
                  "Jika user menyebut bulan/tahun, gunakan awal sampai akhir bulan/tahun tersebut.",
                  "Jangan buat rentang lebih dari 1 tahun.",
                  `Pertanyaan: ${text}`,
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
              startDate: {
                type: "string",
              },
              endDate: {
                type: "string",
              },
            },
            required: ["startDate", "endDate"],
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

  return JSON.parse(extractJsonObject(generatedText)) as GeminiDateRangeOutput;
};

export const generateFinancialSummary = async (
  question: string,
  range: GeminiDateRangeOutput,
  transactions: SummaryTransaction[],
) => {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_NOT_FOUND");
  }

  const model = Bun.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const stats = calculateSummaryStats(transactions);
  const transactionData = transactions.map((item) => ({
    id: item.transactionId,
    type: item.type,
    amount: Number(item.amount ?? 0),
    name: item.name,
    category: item.category?.name,
    wallet: item.wallet?.name,
    reportDate: item.reportDate ? toDateOnly(item.reportDate) : null,
  }));
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
                  "Buat summary keuangan personal dalam bahasa Indonesia yang singkat dan jelas.",
                  "Jawab berdasarkan data transaksi saja, jangan mengarang.",
                  "Sebutkan periode, total pemasukan, total pengeluaran, cashflow bersih, kategori pengeluaran terbesar, dan insight praktis.",
                  "Jika tidak ada transaksi, bilang belum ada transaksi pada periode tersebut.",
                  `Pertanyaan user: ${question}`,
                  `Periode: ${range.startDate} sampai ${range.endDate}`,
                  `Statistik: ${JSON.stringify(stats)}`,
                  `Transaksi: ${JSON.stringify(transactionData)}`,
                ].join("\n"),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
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

  return {
    summary: generatedText.trim(),
    stats,
  };
};

export const generateTransactionFromReceipt = async (image: File) => {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_NOT_FOUND");
  }

  const model = Bun.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const imageBuffer = await image.arrayBuffer();
  const imageBase64 = Buffer.from(imageBuffer).toString("base64");
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
                  "Baca gambar struk/receipt ini lalu ubah ke JSON transaksi.",
                  "Output hanya JSON valid tanpa markdown.",
                  "Schema: {\"type\":\"expense\",\"amount\":number,\"name\":\"string\",\"categoryName\":\"string\",\"reportDate\":\"YYYY-MM-DD optional\"}.",
                  "Gunakan total akhir yang harus dibayar sebagai amount, bukan subtotal jika ada pajak/service.",
                  "name berisi nama merchant atau ringkasan pembelian singkat.",
                  "categoryName pilih kategori Indonesia singkat seperti Makanan, Minuman, Transportasi, Belanja, Kesehatan, Hiburan, atau Lainnya.",
                  "Jika tanggal struk terlihat, isi reportDate dalam format YYYY-MM-DD.",
                  "Jika nominal menggunakan format Indonesia seperti 20.000, ubah menjadi 20000.",
                ].join("\n"),
              },
              {
                inlineData: {
                  mimeType: image.type,
                  data: imageBase64,
                },
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
                enum: ["expense"],
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

export const createTransaction = async (input: CreateTransactionInput) => {
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

export const generateFinancialSummaryFromQuestion = async (
  accountId: string,
  question: string,
) => {
  const generatedRange = await generateDateRangeFromText(question);
  const normalizedRange = normalizeDateRange(generatedRange);
  const transactions = await db.query.transaction.findMany({
    where: and(
      eq(transaction.accountId, accountId),
      gte(transaction.reportDate, normalizedRange.startDate),
      lte(transaction.reportDate, normalizedRange.endDate),
    ),
    orderBy: desc(transaction.reportDate),
    with: {
      category: {
        columns: {
          name: true,
        },
      },
      wallet: {
        columns: {
          name: true,
        },
      },
    },
    columns: {
      transactionId: true,
      type: true,
      amount: true,
      name: true,
      reportDate: true,
    },
  });
  const generatedSummary = await generateFinancialSummary(
    question,
    {
      startDate: normalizedRange.startDateText,
      endDate: normalizedRange.endDateText,
    },
    transactions,
  );

  return {
    question,
    range: {
      startDate: normalizedRange.startDateText,
      endDate: normalizedRange.endDateText,
    },
    summary: generatedSummary.summary,
    stats: generatedSummary.stats,
    transactions,
  };
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
  .post(
    "/ai-summary",
    async ({ body, headers, jwt, status }) => {
      const accountId = await getAccountId(headers.authorization, jwt.verify);

      if (!accountId) {
        logApiEvent(401, "Unauthorized", {
          module: "transaction",
          action: "ai-summary",
        });

        return status(401, authError);
      }

      const generatedSummary = await generateFinancialSummaryFromQuestion(
        accountId,
        body.text,
      );

      logApiEvent(200, "Financial summary generated", {
        accountId,
        range: generatedSummary.range,
        transactionCount: generatedSummary.transactions.length,
      });

      return successResponse("Financial summary generated", generatedSummary);
    },
    {
      body: aiSummaryBody,
    },
  )
  .post(
    "/ocr-receipt",
    async ({ body, headers, jwt, status }) => {
      const accountId = await getAccountId(headers.authorization, jwt.verify);

      if (!accountId) {
        logApiEvent(401, "Unauthorized", {
          module: "transaction",
          action: "ocr-receipt",
        });

        return status(401, authError);
      }

      const receiptImageUrl = await saveUploadedImage(
        "receipts",
        "receipts",
        accountId,
        body.receiptImage,
      );
      const aiTransaction = await generateTransactionFromReceipt(
        body.receiptImage,
      );

      if (
        aiTransaction.type !== "expense" ||
        !Number.isFinite(Number(aiTransaction.amount)) ||
        Number(aiTransaction.amount) <= 0 ||
        !aiTransaction.name ||
        !aiTransaction.categoryName
      ) {
        logApiEvent(422, "OCR output is not a valid transaction", {
          accountId,
          output: aiTransaction,
        });

        return status(
          422,
          errorResponse("OCR output is not a valid transaction", {
            code: "INVALID_OCR_OUTPUT",
            output: aiTransaction,
          }),
        );
      }

      const result = await createTransaction({
        accountId,
        type: "expense",
        amount: aiTransaction.amount.toString(),
        name: aiTransaction.name,
        categoryName: aiTransaction.categoryName,
        walletId: body.walletId,
        budgetId: body.budgetId,
        isAiGenerated: true,
        receiptImageUrl,
        reportDate: body.reportDate ?? aiTransaction.reportDate,
      });

      logApiEvent(201, "Receipt OCR transaction created", {
        accountId,
        transactionId: result.transaction.transactionId,
        walletId: result.wallet?.walletId,
        categoryId: result.category.categoryId,
        generated: aiTransaction,
      });

      return status(
        201,
        successResponse("Receipt OCR transaction created", {
          generated: aiTransaction,
          ...result,
        }),
      );
    },
    {
      body: ocrReceiptBody,
    },
  )
  .onError(({ error, status }) => handleApiError(error, status, "transaction"));
