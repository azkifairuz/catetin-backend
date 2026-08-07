import { describe, expect, test } from "bun:test";

import {
  parseBudgetCommandInput,
  parseWhatsappCommand,
} from "./whatsapp-command";

describe("WhatsApp commands", () => {
  test("parses commands case-insensitively", () => {
    expect(parseWhatsappCommand(" /CATAT makan 25 ribu ")).toEqual({
      name: "catat",
      argument: "makan 25 ribu",
    });
    expect(parseWhatsappCommand("/sisa")).toEqual({ name: "sisa" });
    expect(parseWhatsappCommand("/saldo")).toEqual({ name: "saldo" });
  });

  test("does not treat normal chat as a command", () => {
    expect(parseWhatsappCommand("catat makan 25000")).toBeNull();
  });

  test("parses budget with a multi-word category", () => {
    expect(parseBudgetCommandInput("Makan di luar 1.500.000 bulanan")).toEqual({
      categoryName: "Makan di luar",
      amount: 1_500_000,
      period: "bulanan",
    });
  });

  test("uses monthly period by default", () => {
    expect(parseBudgetCommandInput("Transportasi 500000")).toEqual({
      categoryName: "Transportasi",
      amount: 500_000,
      period: "bulanan",
    });
  });
});
