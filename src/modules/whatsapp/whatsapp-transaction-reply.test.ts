import { describe, expect, test } from "bun:test";

import { formatTransactionBatchReply } from "./whatsapp-transaction-reply";

const result = (
  name: string,
  type: "income" | "expense",
  amount: number,
  categoryName: string,
) => ({
  generated: { type, amount, name, categoryName },
  transaction: { name, type, amount: amount.toString() },
  category: { name: categoryName },
});

describe("WhatsApp transaction batch reply", () => {
  test("preserves the existing reply for one successful transaction", () => {
    expect(
      formatTransactionBatchReply(
        [result("Kopi", "expense", 25000, "Minuman")],
        [],
      ),
    ).toBe(
      [
        "Transaksi sudah dicatat.",
        "Nama: Kopi",
        "Tipe: expense",
        "Nominal: Rp25.000",
        "Kategori: Minuman",
      ].join("\n"),
    );
  });

  test("lists multiple successful transactions", () => {
    const reply = formatTransactionBatchReply(
      [
        result("Kopi", "expense", 25000, "Minuman"),
        result("Soto", "expense", 20000, "Makanan"),
      ],
      [],
    );

    expect(reply).toContain("2 transaksi berhasil dicatat.");
    expect(reply).toContain("1. Kopi — expense — Rp25.000 — Minuman");
    expect(reply).toContain("2. Soto — expense — Rp20.000 — Makanan");
  });

  test("reports partial failures without hiding successful items", () => {
    const reply = formatTransactionBatchReply(
      [result("Gaji", "income", 5000000, "Pemasukan")],
      [
        {
          index: 1,
          generated: { type: "expense", amount: 0 },
          code: "INVALID_AI_OUTPUT",
          message: "Nominal transaksi harus lebih dari 0.",
        },
      ],
    );

    expect(reply).toContain("1 transaksi berhasil dicatat, 1 gagal.");
    expect(reply).toContain("Item 2: Nominal transaksi harus lebih dari 0.");
  });
});
