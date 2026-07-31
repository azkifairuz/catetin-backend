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
  receiptId: transaction.receiptId,
  receiptMerchant: transaction.receiptMerchant,
  receiptLineType: transaction.receiptLineType,
  quantity: transaction.quantity,
  unitPrice: transaction.unitPrice,
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
  receiptId?: string;
  receiptMerchant?: string;
  receiptLineType?: string;
  quantity?: string;
  unitPrice?: string;
  reportDate?: string;
};

export type GeminiTransactionOutput = {
  type: "income" | "expense";
  amount: number;
  name: string;
  categoryName: string;
  reportDate?: string;
};

export const MAX_RECEIPT_ITEMS = 50;

export type ReceiptLineType =
  | "item"
  | "tax"
  | "fee"
  | "discount"
  | "adjustment";

export type GeminiReceiptItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  categoryName: string;
};

export type GeminiReceiptAdjustment = {
  name: string;
  amount: number;
  categoryName: string;
  lineType: Exclude<ReceiptLineType, "item">;
};

export type GeminiReceiptOutput = {
  merchant: string;
  totalAmount: number;
  reportDate?: string;
  items: unknown[];
  adjustments?: unknown[];
};

export const MAX_AI_TRANSACTIONS = 10;

export type AiTransactionFailure = {
  index: number;
  generated: unknown;
  code: "INVALID_AI_OUTPUT" | "BATCH_LIMIT_EXCEEDED" | "CREATE_FAILED";
  message: string;
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

export type FinancialSummaryResult = {
  question: string;
  range: {
    startDate: string;
    endDate: string;
  };
  summary: string;
  stats: ReturnType<typeof calculateSummaryStats>;
  transactions: SummaryTransaction[];
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

export const parseTransactionsFromTextOutput = (text: string): unknown[] => {
  const trimmedText = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed = JSON.parse(trimmedText) as unknown;

  // Keep accepting the old single-object shape during deployment transitions.
  return Array.isArray(parsed) ? parsed : [parsed];
};

export const getGeneratedTransactionValidationError = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return "Format transaksi harus berupa object.";
  }

  const candidate = value as Partial<GeminiTransactionOutput>;

  if (!candidate.type || !["income", "expense"].includes(candidate.type)) {
    return "Tipe transaksi harus income atau expense.";
  }

  if (
    !Number.isFinite(Number(candidate.amount)) ||
    Number(candidate.amount) <= 0
  ) {
    return "Nominal transaksi harus lebih dari 0.";
  }

  if (typeof candidate.name !== "string" || !candidate.name.trim()) {
    return "Nama transaksi wajib diisi.";
  }

  if (
    typeof candidate.categoryName !== "string" ||
    !candidate.categoryName.trim()
  ) {
    return "Kategori transaksi wajib diisi.";
  }

  if (
    candidate.reportDate !== undefined &&
    (typeof candidate.reportDate !== "string" ||
      Number.isNaN(new Date(candidate.reportDate).getTime()))
  ) {
    return "Tanggal transaksi tidak valid.";
  }

  return null;
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

export const generateTransactionsFromText = async (text: string) => {
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
                  "Ubah teks catatan menjadi array JSON transaksi.",
                  "Output hanya JSON valid tanpa markdown.",
                  "Pisahkan setiap pembelian, pembayaran, pemasukan, atau nominal berbeda menjadi transaksi tersendiri sesuai urutan teks.",
                  "Schema: [{\"type\":\"income|expense\",\"amount\":number,\"name\":\"string\",\"categoryName\":\"string\",\"reportDate\":\"YYYY-MM-DD optional\"}].",
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
            type: "array",
            items: {
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

  return parseTransactionsFromTextOutput(generatedText);
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

export const generateTransactionsFromReceipt = async (image: File) => {
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
                  "Baca seluruh detail gambar struk/receipt ini ke JSON terstruktur.",
                  "Output hanya JSON valid tanpa markdown.",
                  "Pisahkan setiap baris barang menjadi item tersendiri sesuai urutan struk, maksimal 50 item.",
                  "Untuk item, amount adalah total baris setelah diskon khusus item; quantity dan unitPrice harus berupa angka.",
                  "Pisahkan pajak, biaya layanan, diskon keseluruhan, dan pembulatan ke adjustments.",
                  "Adjustment pajak/biaya bernilai positif dan diskon bernilai negatif.",
                  "lineType adjustment harus tax, fee, discount, atau adjustment.",
                  "totalAmount adalah total akhir yang benar-benar dibayar.",
                  "categoryName pilih kategori Indonesia singkat seperti Makanan, Minuman, Rokok, Transportasi, Belanja, Kesehatan, Hiburan, atau Lainnya.",
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
              merchant: {
                type: "string",
              },
              totalAmount: {
                type: "number",
              },
              reportDate: {
                type: "string",
              },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    quantity: { type: "number" },
                    unitPrice: { type: "number" },
                    amount: { type: "number" },
                    categoryName: { type: "string" },
                  },
                  required: [
                    "name",
                    "quantity",
                    "unitPrice",
                    "amount",
                    "categoryName",
                  ],
                },
              },
              adjustments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    amount: { type: "number" },
                    categoryName: { type: "string" },
                    lineType: {
                      type: "string",
                      enum: ["tax", "fee", "discount", "adjustment"],
                    },
                  },
                  required: ["name", "amount", "categoryName", "lineType"],
                },
              },
            },
            required: ["merchant", "totalAmount", "items", "adjustments"],
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

  return JSON.parse(extractJsonObject(generatedText)) as GeminiReceiptOutput;
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
        receiptId: input.receiptId,
        receiptMerchant: input.receiptMerchant,
        receiptLineType: input.receiptLineType,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
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

export type ReceiptItemFailure = {
  source: "item" | "adjustment";
  index: number;
  generated: unknown;
  code: "INVALID_RECEIPT_ITEM" | "RECEIPT_ITEM_LIMIT_EXCEEDED";
  message: string;
};

type PreparedReceiptLine = {
  name: string;
  amount: number;
  categoryName: string;
  lineType: ReceiptLineType;
  quantity?: number;
  unitPrice?: number;
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export const prepareReceiptLines = (receipt: GeminiReceiptOutput) => {
  const totalAmount = Number(receipt.totalAmount);
  const merchant =
    typeof receipt.merchant === "string" ? receipt.merchant.trim() : "";

  if (!merchant || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    return {
      lines: [] as PreparedReceiptLine[],
      failed: [] as ReceiptItemFailure[],
      error: "Merchant dan total akhir struk harus valid.",
      reconciliation: null,
    };
  }

  const lines: PreparedReceiptLine[] = [];
  const failed: ReceiptItemFailure[] = [];

  for (const [index, rawItem] of (receipt.items ?? []).entries()) {
    if (index >= MAX_RECEIPT_ITEMS) {
      failed.push({
        source: "item",
        index,
        generated: rawItem,
        code: "RECEIPT_ITEM_LIMIT_EXCEEDED",
        message: `Maksimal ${MAX_RECEIPT_ITEMS} item per struk.`,
      });
      continue;
    }

    const item = rawItem as Partial<GeminiReceiptItem>;
    const quantity = Number(item?.quantity);
    const unitPrice = Number(item?.unitPrice);
    const amount = Number(item?.amount);

    if (
      !item ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      typeof item.categoryName !== "string" ||
      !item.categoryName.trim() ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(unitPrice) ||
      unitPrice < 0 ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      failed.push({
        source: "item",
        index,
        generated: rawItem,
        code: "INVALID_RECEIPT_ITEM",
        message: "Nama, kategori, quantity, unit price, atau total item tidak valid.",
      });
      continue;
    }

    lines.push({
      name: item.name.trim(),
      amount: roundMoney(amount),
      categoryName: item.categoryName.trim(),
      lineType: "item",
      quantity,
      unitPrice: roundMoney(unitPrice),
    });
  }

  const validItemCount = lines.length;

  for (const [index, rawAdjustment] of (
    receipt.adjustments ?? []
  ).entries()) {
    const adjustment = rawAdjustment as Partial<GeminiReceiptAdjustment>;
    const rawAmount = Number(adjustment?.amount);
    const validLineTypes: ReceiptLineType[] = [
      "tax",
      "fee",
      "discount",
      "adjustment",
    ];

    if (
      !adjustment ||
      typeof adjustment.name !== "string" ||
      !adjustment.name.trim() ||
      typeof adjustment.categoryName !== "string" ||
      !adjustment.categoryName.trim() ||
      !adjustment.lineType ||
      !validLineTypes.includes(adjustment.lineType) ||
      !Number.isFinite(rawAmount) ||
      rawAmount === 0
    ) {
      failed.push({
        source: "adjustment",
        index,
        generated: rawAdjustment,
        code: "INVALID_RECEIPT_ITEM",
        message: "Penyesuaian struk tidak valid.",
      });
      continue;
    }

    const amount =
      adjustment.lineType === "discount"
        ? -Math.abs(rawAmount)
        : Math.abs(rawAmount);

    lines.push({
      name: adjustment.name.trim(),
      amount: roundMoney(amount),
      categoryName: adjustment.categoryName.trim(),
      lineType: adjustment.lineType,
    });
  }

  if (validItemCount === 0) {
    return {
      lines: [] as PreparedReceiptLine[],
      failed,
      error: "Tidak ada item struk yang valid.",
      reconciliation: null,
    };
  }

  const extractedTotal = roundMoney(
    lines.reduce((sum, line) => sum + line.amount, 0),
  );
  const difference = roundMoney(totalAmount - extractedTotal);

  if (difference !== 0) {
    lines.push({
      name:
        difference < 0
          ? "Diskon/Penyesuaian struk"
          : "Penyesuaian struk",
      amount: difference,
      categoryName: difference < 0 ? "Diskon" : "Lainnya",
      lineType: difference < 0 ? "discount" : "adjustment",
    });
  }

  const itemTotal = roundMoney(
    lines
      .filter((line) => line.lineType === "item")
      .reduce((sum, line) => sum + line.amount, 0),
  );
  const adjustmentTotal = roundMoney(
    lines
      .filter((line) => line.lineType !== "item")
      .reduce((sum, line) => sum + line.amount, 0),
  );

  return {
    lines,
    failed,
    error: null,
    reconciliation: {
      receiptTotal: roundMoney(totalAmount),
      itemTotal,
      adjustmentTotal,
      recordedTotal: roundMoney(itemTotal + adjustmentTotal),
    },
  };
};

type CreateReceiptTransactionsInput = {
  accountId: string;
  receipt: GeminiReceiptOutput;
  receiptImageUrl?: string;
  walletId?: number;
  budgetId?: number;
  reportDate?: string;
};

export const createReceiptTransactions = async (
  input: CreateReceiptTransactionsInput,
) => {
  const prepared = prepareReceiptLines(input.receipt);

  if (prepared.error || !prepared.reconciliation) {
    return {
      receiptId: null,
      merchant: input.receipt.merchant,
      results: [],
      failed: prepared.failed,
      counts: {
        detected: input.receipt.items?.length ?? 0,
        created: 0,
        adjustments: 0,
        failed: prepared.failed.length,
      },
      reconciliation: null,
      error: prepared.error,
      wallet: null,
    };
  }

  const receiptId = crypto.randomUUID();
  const reportDate = input.reportDate ?? input.receipt.reportDate;

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

    const categoryCache = new Map<string, typeof category.$inferSelect>();
    const results: Array<{
      line: PreparedReceiptLine;
      transaction: typeof transaction.$inferSelect;
      category: typeof category.$inferSelect;
    }> = [];

    for (const line of prepared.lines) {
      let selectedCategory = categoryCache.get(line.categoryName);

      if (!selectedCategory) {
        selectedCategory = await tx.query.category.findFirst({
          where: and(
            eq(category.accountId, input.accountId),
            eq(category.name, line.categoryName),
          ),
        });
      }

      if (!selectedCategory) {
        [selectedCategory] = await tx
          .insert(category)
          .values({
            accountId: input.accountId,
            name: line.categoryName,
          })
          .returning();
      }

      if (!selectedCategory) {
        throw new Error("CATEGORY_CREATE_FAILED");
      }

      categoryCache.set(line.categoryName, selectedCategory);

      const [createdTransaction] = await tx
        .insert(transaction)
        .values({
          accountId: input.accountId,
          walletId: selectedWallet.walletId,
          categoryId: selectedCategory.categoryId,
          budgetId: input.budgetId,
          type: "expense",
          amount: line.amount.toString(),
          name: line.name,
          isAiGenerated: true,
          receiptImageUrl: input.receiptImageUrl,
          receiptId,
          receiptMerchant: input.receipt.merchant.trim(),
          receiptLineType: line.lineType,
          quantity: line.quantity?.toString(),
          unitPrice: line.unitPrice?.toString(),
          reportDate: reportDate ? new Date(reportDate) : new Date(),
        })
        .returning();

      if (!createdTransaction) {
        throw new Error("TRANSACTION_CREATE_FAILED");
      }

      results.push({
        line,
        transaction: createdTransaction,
        category: selectedCategory,
      });
    }

    const [updatedWallet] = await tx
      .update(wallet)
      .set({
        balance: sql`${wallet.balance} - ${prepared.reconciliation.recordedTotal}`,
      })
      .where(eq(wallet.walletId, selectedWallet.walletId))
      .returning({
        walletId: wallet.walletId,
        name: wallet.name,
        balance: wallet.balance,
        isPrimary: wallet.isPrimary,
      });

    return {
      receiptId,
      merchant: input.receipt.merchant.trim(),
      results,
      failed: prepared.failed,
      counts: {
        detected: input.receipt.items.length,
        created: results.filter((item) => item.line.lineType === "item").length,
        adjustments: results.filter(
          (item) => item.line.lineType !== "item",
        ).length,
        failed: prepared.failed.length,
      },
      reconciliation: prepared.reconciliation,
      error: null,
      wallet: updatedWallet ?? null,
    };
  });
};

export const createGeneratedTransactions = async (
  accountId: string,
  generatedItems: unknown[],
  create: typeof createTransaction = createTransaction,
) => {
  const results: Array<{
    index: number;
    generated: GeminiTransactionOutput;
    transaction: Awaited<ReturnType<typeof createTransaction>>["transaction"];
    category: Awaited<ReturnType<typeof createTransaction>>["category"];
    wallet: Awaited<ReturnType<typeof createTransaction>>["wallet"];
  }> = [];
  const failed: AiTransactionFailure[] = [];
  let firstCreateError: unknown;

  for (const [index, generated] of generatedItems.entries()) {
    if (index >= MAX_AI_TRANSACTIONS) {
      failed.push({
        index,
        generated,
        code: "BATCH_LIMIT_EXCEEDED",
        message: `Maksimal ${MAX_AI_TRANSACTIONS} transaksi per pesan.`,
      });
      continue;
    }

    const validationError = getGeneratedTransactionValidationError(generated);

    if (validationError) {
      failed.push({
        index,
        generated,
        code: "INVALID_AI_OUTPUT",
        message: validationError,
      });
      continue;
    }

    const transactionData = generated as GeminiTransactionOutput;

    try {
      const created = await create({
        accountId,
        type: transactionData.type,
        amount: transactionData.amount.toString(),
        name: transactionData.name.trim(),
        categoryName: transactionData.categoryName.trim(),
        isAiGenerated: true,
        reportDate: transactionData.reportDate,
      });

      results.push({
        index,
        generated: transactionData,
        ...created,
      });
    } catch (error) {
      firstCreateError ??= error;
      failed.push({
        index,
        generated,
        code: "CREATE_FAILED",
        message: "Transaksi gagal disimpan.",
      });
    }
  }

  return {
    results,
    failed,
    counts: {
      detected: generatedItems.length,
      created: results.length,
      failed: failed.length,
    },
    firstCreateError,
  };
};

export const createTransactionsFromText = async (
  accountId: string,
  text: string,
) => {
  const generated = await generateTransactionsFromText(text);
  const batch = await createGeneratedTransactions(accountId, generated);

  return {
    generated,
    ...batch,
  };
};

export const generateFinancialSummaryFromQuestion = async (
  accountId: string,
  question: string,
): Promise<FinancialSummaryResult> => {
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

      const batch = await createTransactionsFromText(accountId, body.text);

      if (batch.results.length === 0) {
        if (batch.firstCreateError) {
          throw batch.firstCreateError;
        }

        logApiEvent(422, "AI output is not a valid transaction", {
          accountId,
          output: batch.generated,
          failed: batch.failed,
        });

        return status(
          422,
          errorResponse("AI output is not a valid transaction", {
            code: "INVALID_AI_OUTPUT",
            output: batch.generated,
            failed: batch.failed,
            counts: batch.counts,
          }),
        );
      }

      logApiEvent(201, "Transactions generated", {
        accountId,
        counts: batch.counts,
        transactionIds: batch.results.map(
          (item) => item.transaction.transactionId,
        ),
        failed: batch.failed,
      });

      const firstResult = batch.results[0];
      const legacyFields =
        batch.generated.length === 1 &&
        batch.failed.length === 0 &&
        firstResult
          ? {
              generated: firstResult.generated,
              transaction: firstResult.transaction,
              category: firstResult.category,
              wallet: firstResult.wallet,
            }
          : {};

      return status(
        201,
        successResponse(
          batch.generated.length === 1 && batch.failed.length === 0
            ? "Transaction generated"
            : "Transactions generated",
          {
            input: body.text,
            results: batch.results,
            failed: batch.failed,
            counts: batch.counts,
            ...legacyFields,
          },
        ),
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
      const generatedReceipt = await generateTransactionsFromReceipt(
        body.receiptImage,
      );
      const result = await createReceiptTransactions({
        accountId,
        receipt: generatedReceipt,
        receiptImageUrl,
        walletId: body.walletId,
        budgetId: body.budgetId,
        reportDate: body.reportDate,
      });

      if (result.error || result.results.length === 0) {
        logApiEvent(422, "OCR output has no valid receipt items", {
          accountId,
          output: generatedReceipt,
          failed: result.failed,
          error: result.error,
        });

        return status(
          422,
          errorResponse("OCR output has no valid receipt items", {
            code: "INVALID_OCR_OUTPUT",
            output: generatedReceipt,
            failed: result.failed,
            counts: result.counts,
          }),
        );
      }

      logApiEvent(201, "Receipt OCR transactions created", {
        accountId,
        receiptId: result.receiptId,
        transactionIds: result.results.map(
          (item) => item.transaction.transactionId,
        ),
        walletId: result.wallet?.walletId,
        counts: result.counts,
        reconciliation: result.reconciliation,
        failed: result.failed,
      });

      const onlyResult = result.results[0];
      const legacyFields =
        result.results.length === 1 &&
        onlyResult?.line.lineType === "item" &&
        result.failed.length === 0
          ? {
              transaction: onlyResult.transaction,
              category: onlyResult.category,
              wallet: result.wallet,
            }
          : {};

      return status(
        201,
        successResponse("Receipt OCR transactions created", {
          generated: generatedReceipt,
          receiptId: result.receiptId,
          merchant: result.merchant,
          results: result.results,
          failed: result.failed,
          counts: result.counts,
          reconciliation: result.reconciliation,
          wallet: result.wallet,
          ...legacyFields,
        }),
      );
    },
    {
      body: ocrReceiptBody,
    },
  )
  .onError(({ error, status }) => handleApiError(error, status, "transaction"));
