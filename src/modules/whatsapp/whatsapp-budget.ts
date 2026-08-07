import { formatRupiah } from "./whatsapp-balance";

export type WhatsappBudget = {
  budgetId: number;
  amount: string | null;
  period: string | null;
  categoryId: number | null;
  category: { name: string | null } | null;
};

export type WhatsappExpense = {
  categoryId: number | null;
  amount: string | null;
  reportDate: Date | null;
};

export const getBudgetPeriodStart = (period: string | null, now = new Date()) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === "harian") return start;
  if (period === "mingguan") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    return start;
  }
  if (period === "tahunan") {
    start.setMonth(0, 1);
    return start;
  }

  start.setDate(1);
  return start;
};

export const formatBudgetList = (budgets: WhatsappBudget[]) => {
  if (budgets.length === 0) {
    return "Kamu belum punya budget.\n\nBuat dengan: /budget <kategori> <nominal> [periode]";
  }

  return [
    "*Daftar Budget*",
    "",
    ...budgets.map(
      (item) =>
        `• ${item.category?.name ?? "Tanpa kategori"}: ${formatRupiah(Number(item.amount ?? 0))}/${item.period ?? "bulanan"}`,
    ),
  ].join("\n");
};

export const formatRemainingBudgets = (
  budgets: WhatsappBudget[],
  expenses: WhatsappExpense[],
  now = new Date(),
) => {
  if (budgets.length === 0) {
    return "Kamu belum punya budget.\n\nBuat dengan: /budget <kategori> <nominal> [periode]";
  }

  const details = budgets.map((item) => {
    const start = getBudgetPeriodStart(item.period, now);
    const spent = expenses
      .filter(
        (expense) =>
          expense.categoryId === item.categoryId &&
          expense.reportDate &&
          expense.reportDate >= start &&
          expense.reportDate <= now,
      )
      .reduce((total, expense) => total + Number(expense.amount ?? 0), 0);
    const limit = Number(item.amount ?? 0);
    const remaining = limit - spent;

    return [
      `• *${item.category?.name ?? "Tanpa kategori"}* (${item.period ?? "bulanan"})`,
      `  Terpakai: ${formatRupiah(spent)}`,
      `  Sisa: ${formatRupiah(remaining)} dari ${formatRupiah(limit)}`,
    ].join("\n");
  });

  return ["*Sisa Budget*", "", ...details].join("\n");
};
