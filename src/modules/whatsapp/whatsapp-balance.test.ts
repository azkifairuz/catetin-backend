import { describe, expect, test } from "bun:test";

import {
  formatBalanceReply,
  formatRupiah,
  isBalanceQuestion,
} from "./whatsapp-balance";

describe("isBalanceQuestion", () => {
  test.each([
    "Berapa sisa saldo",
    "cek saldo",
    "saldo saya sekarang berapa?",
    "uangku tersisa berapa",
    "sisa uang aku",
    "saldo",
    "/saldo",
  ])("recognizes balance query: %s", (text) => {
    expect(isBalanceQuestion(text)).toBe(true);
  });

  test.each([
    "top up saldo 50rb",
    "isi saldo 50000",
    "bayar parkir 2rb",
    "aku dapat uang 100rb",
  ])("does not capture transaction text: %s", (text) => {
    expect(isBalanceQuestion(text)).toBe(false);
  });
});

describe("balance response formatting", () => {
  test("formats positive and negative rupiah values", () => {
    expect(formatRupiah(1250000)).toBe("Rp1.250.000");
    expect(formatRupiah(-6000)).toBe("-Rp6.000");
  });

  test("shows total, wallet details, and a negative balance note", () => {
    const reply = formatBalanceReply([
      { name: "Main Wallet", balance: "-6000", isPrimary: true },
      { name: "Tabungan", balance: "1000", isPrimary: false },
    ]);

    expect(reply).toContain("Total saldo kamu saat ini: -Rp5.000");
    expect(reply).toContain("• Main Wallet (utama): -Rp6.000");
    expect(reply).toContain("• Tabungan: Rp1.000");
    expect(reply).toContain("saldo awal atau pemasukan");
  });

  test("handles an account without wallets", () => {
    expect(formatBalanceReply([])).toContain("belum punya wallet");
  });
});
