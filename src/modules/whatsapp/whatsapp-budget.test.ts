import { describe, expect, test } from "bun:test";

import { formatRemainingBudgets, getBudgetPeriodStart } from "./whatsapp-budget";

describe("WhatsApp budget", () => {
  test("starts weekly periods on Monday", () => {
    expect(
      getBudgetPeriodStart("mingguan", new Date("2026-08-07T12:00:00")).getDate(),
    ).toBe(3);
  });

  test("calculates expenses only inside the active period", () => {
    const reply = formatRemainingBudgets(
      [{ budgetId: 1, categoryId: 2, amount: "100000", period: "bulanan", category: { name: "Makanan" } }],
      [
        { categoryId: 2, amount: "25000", reportDate: new Date("2026-08-05T12:00:00") },
        { categoryId: 2, amount: "50000", reportDate: new Date("2026-07-31T12:00:00") },
      ],
      new Date("2026-08-07T12:00:00"),
    );

    expect(reply).toContain("Terpakai: Rp25.000");
    expect(reply).toContain("Sisa: Rp75.000");
  });
});
