import { expect, test } from "bun:test";

import { formatReceiptBatchReply } from "./whatsapp-receipt-reply";

test("formats receipt items, adjustments, and failures", () => {
  const reply = formatReceiptBatchReply({
    merchant: "Indomaret",
    receiptTotal: 45000,
    results: [
      {
        line: {
          name: "Rokok",
          amount: 25000,
          lineType: "item",
          quantity: 1,
        },
      },
      {
        line: {
          name: "Roti",
          amount: 20000,
          lineType: "item",
          quantity: 2,
        },
      },
      {
        line: {
          name: "Diskon",
          amount: -5000,
          lineType: "discount",
        },
      },
      {
        line: {
          name: "Penyesuaian struk",
          amount: 5000,
          lineType: "adjustment",
        },
      },
    ],
    failed: [
      {
        source: "item",
        index: 2,
        generated: {},
        code: "INVALID_RECEIPT_ITEM",
        message: "Item tidak valid.",
      },
    ],
  });

  expect(reply).toContain("Merchant: Indomaret");
  expect(reply).toContain("Total: Rp45.000");
  expect(reply).toContain("2. Roti ×2 — Rp20.000");
  expect(reply).toContain("Diskon — -Rp5.000");
  expect(reply).toContain("item 3: Item tidak valid.");
});
