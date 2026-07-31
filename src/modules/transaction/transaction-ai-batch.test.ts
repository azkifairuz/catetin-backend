import { describe, expect, test } from "bun:test";

import {
  createGeneratedTransactions,
  getGeneratedTransactionValidationError,
  MAX_AI_TRANSACTIONS,
  parseTransactionsFromTextOutput,
} from "./transaction.routes";

describe("AI transaction batch parsing", () => {
  test("parses multiple transactions in their original order", () => {
    const result = parseTransactionsFromTextOutput(
      JSON.stringify([
        {
          type: "expense",
          amount: 25000,
          name: "Kopi",
          categoryName: "Minuman",
        },
        {
          type: "expense",
          amount: 20000,
          name: "Soto",
          categoryName: "Makanan",
        },
      ]),
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: "Kopi", amount: 25000 });
    expect(result[1]).toMatchObject({ name: "Soto", amount: 20000 });
  });

  test("keeps accepting the legacy single-object response", () => {
    const result = parseTransactionsFromTextOutput(
      '```json\n{"type":"income","amount":5000000,"name":"Gaji","categoryName":"Pemasukan"}\n```',
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "income", name: "Gaji" });
  });

  test("preserves mixed expense and income types", () => {
    const result = parseTransactionsFromTextOutput(
      JSON.stringify([
        {
          type: "expense",
          amount: 25000,
          name: "Kopi",
          categoryName: "Minuman",
        },
        {
          type: "income",
          amount: 5000000,
          name: "Gaji",
          categoryName: "Pemasukan",
        },
      ]),
    );

    expect(result.map((item: any) => item.type)).toEqual([
      "expense",
      "income",
    ]);
  });
});

describe("AI transaction validation", () => {
  test("accepts a complete transaction", () => {
    expect(
      getGeneratedTransactionValidationError({
        type: "expense",
        amount: 20000,
        name: "Soto",
        categoryName: "Makanan",
        reportDate: "2026-08-01",
      }),
    ).toBeNull();
  });

  test.each([
    [{ type: "expense", amount: 0, name: "Kopi", categoryName: "Minuman" }],
    [{ type: "other", amount: 1000, name: "Kopi", categoryName: "Minuman" }],
    [{ type: "expense", amount: 1000, name: "", categoryName: "Minuman" }],
    [{ type: "expense", amount: 1000, name: "Kopi", categoryName: "" }],
    [null],
  ])("rejects an invalid transaction: %p", (candidate) => {
    expect(getGeneratedTransactionValidationError(candidate)).not.toBeNull();
  });
});

describe("AI transaction batch processing", () => {
  const generatedTransaction = (index: number) => ({
    type: "expense" as const,
    amount: 1000 + index,
    name: `Item ${index}`,
    categoryName: "Belanja",
  });
  const createStub = async (input: any) => ({
    transaction: {
      transactionId: Number(input.amount),
      name: input.name,
      type: input.type,
      amount: input.amount,
    },
    category: { categoryId: 1, name: input.categoryName },
    wallet: { walletId: 1, name: "Main Wallet", balance: "0", isPrimary: true },
  });

  test("saves valid items while reporting invalid ones", async () => {
    const batch = await createGeneratedTransactions(
      "account-id",
      [generatedTransaction(1), { ...generatedTransaction(2), amount: 0 }],
      createStub as any,
    );

    expect(batch.counts).toEqual({ detected: 2, created: 1, failed: 1 });
    expect(batch.results[0]?.generated.name).toBe("Item 1");
    expect(batch.failed[0]?.code).toBe("INVALID_AI_OUTPUT");
  });

  test("processes at most ten items and reports the overflow", async () => {
    const items = Array.from(
      { length: MAX_AI_TRANSACTIONS + 2 },
      (_, index) => generatedTransaction(index),
    );
    const batch = await createGeneratedTransactions(
      "account-id",
      items,
      createStub as any,
    );

    expect(batch.counts).toEqual({
      detected: MAX_AI_TRANSACTIONS + 2,
      created: MAX_AI_TRANSACTIONS,
      failed: 2,
    });
    expect(batch.failed.every((item) => item.code === "BATCH_LIMIT_EXCEEDED")).toBe(
      true,
    );
  });
});
