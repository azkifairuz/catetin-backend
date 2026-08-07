import { jwt } from "@elysiajs/jwt";
import { Elysia, t } from "elysia";
import { authError, getAccountId, jwtSecret } from "../../lib/auth";
import { errorResponse, successResponse } from "../../lib/api-response";
import { handleApiError } from "../../lib/error-handler";
import { logApiEvent } from "../../lib/log-service";
import { saveUploadedImage } from "../../lib/upload";
import {
  createReceiptTransactions,
  createTransaction,
  createTransactionsFromText,
  generateFinancialSummaryFromQuestion,
  generateTransactionsFromReceipt,
  listTransactions,
} from "./transaction.service";

const transactionBody = t.Object({
  type: t.Union([t.Literal("income"), t.Literal("expense")]),
  amount: t.String({ minLength: 1 }), name: t.String({ minLength: 1 }), categoryName: t.String({ minLength: 1 }),
  walletId: t.Optional(t.Number({ minimum: 1 })), budgetId: t.Optional(t.Number({ minimum: 1 })), isAiGenerated: t.Optional(t.Boolean()),
  receiptImage: t.Optional(t.File({ type: "image", maxSize: "5m" })), reportDate: t.Optional(t.String()),
});
const aiGenerateBody = t.Object({ text: t.String({ minLength: 1 }) });
const aiSummaryBody = t.Object({ text: t.String({ minLength: 1 }) });
const ocrReceiptBody = t.Object({ receiptImage: t.File({ type: "image", maxSize: "5m" }), walletId: t.Optional(t.Number({ minimum: 1 })), budgetId: t.Optional(t.Number({ minimum: 1 })), reportDate: t.Optional(t.String()) });

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

    const transactions = await listTransactions(accountId);

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
