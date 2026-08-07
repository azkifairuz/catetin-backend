import { describe, expect, test } from "bun:test";

import {
  MAX_RECEIPT_ITEMS,
  prepareReceiptLines,
  type GeminiReceiptOutput,
} from "./transaction.service";

const receipt = (
  overrides: Partial<GeminiReceiptOutput> = {},
): GeminiReceiptOutput => ({
  merchant: "Indomaret",
  totalAmount: 45000,
  items: [
    {
      name: "Rokok",
      quantity: 1,
      unitPrice: 25000,
      amount: 25000,
      categoryName: "Rokok",
    },
    {
      name: "Roti",
      quantity: 2,
      unitPrice: 10000,
      amount: 20000,
      categoryName: "Makanan",
    },
  ],
  adjustments: [],
  ...overrides,
});

describe("receipt item preparation", () => {
  test("creates one line per receipt item with structured detail", () => {
    const result = prepareReceiptLines(receipt());

    expect(result.error).toBeNull();
    expect(result.lines).toHaveLength(2);
    expect(result.lines[1]).toMatchObject({
      name: "Roti",
      quantity: 2,
      unitPrice: 10000,
      amount: 20000,
      categoryName: "Makanan",
      lineType: "item",
    });
    expect(result.reconciliation).toEqual({
      receiptTotal: 45000,
      itemTotal: 45000,
      adjustmentTotal: 0,
      recordedTotal: 45000,
    });
  });

  test("records tax as positive expense and discount as negative expense", () => {
    const result = prepareReceiptLines(
      receipt({
        totalAmount: 47000,
        adjustments: [
          {
            name: "Pajak",
            amount: 5000,
            categoryName: "Pajak",
            lineType: "tax",
          },
          {
            name: "Diskon",
            amount: 3000,
            categoryName: "Diskon",
            lineType: "discount",
          },
        ],
      }),
    );

    expect(result.lines.map((line) => line.amount)).toEqual([
      25000, 20000, 5000, -3000,
    ]);
    expect(result.reconciliation?.recordedTotal).toBe(47000);
  });

  test("skips an invalid item and reconciles the missing amount", () => {
    const result = prepareReceiptLines(
      receipt({
        items: [
          receipt().items[0],
          {
            name: "Item rusak",
            quantity: 0,
            unitPrice: 20000,
            amount: 20000,
            categoryName: "Belanja",
          },
        ],
      }),
    );

    expect(result.failed).toHaveLength(1);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[1]).toMatchObject({
      name: "Penyesuaian struk",
      amount: 20000,
      lineType: "adjustment",
    });
    expect(result.reconciliation?.recordedTotal).toBe(45000);
  });

  test("rejects a receipt when every item is invalid", () => {
    const result = prepareReceiptLines(
      receipt({
        items: [{ name: "", quantity: 0, unitPrice: 0, amount: 0 }],
      }),
    );

    expect(result.lines).toHaveLength(0);
    expect(result.error).toBe("Tidak ada item struk yang valid.");
  });

  test("limits receipt items to fifty and reports overflow", () => {
    const items = Array.from({ length: MAX_RECEIPT_ITEMS + 2 }, (_, index) => ({
      name: `Item ${index + 1}`,
      quantity: 1,
      unitPrice: 1000,
      amount: 1000,
      categoryName: "Belanja",
    }));
    const result = prepareReceiptLines(
      receipt({ totalAmount: items.length * 1000, items }),
    );

    expect(result.failed).toHaveLength(2);
    expect(
      result.failed.every(
        (item) => item.code === "RECEIPT_ITEM_LIMIT_EXCEEDED",
      ),
    ).toBe(true);
    expect(result.reconciliation?.recordedTotal).toBe(items.length * 1000);
  });
});
