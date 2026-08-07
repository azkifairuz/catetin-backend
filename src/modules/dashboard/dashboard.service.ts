import { DashboardRepository, dashboardRepository } from "./dashboard.repository";
const number = (value: string | null | undefined) => Number(value ?? 0);
const dateText = (date: Date) => date.toISOString().slice(0, 10);
export class DashboardService {
  constructor(private readonly repository: DashboardRepository = dashboardRepository) {}
  private range(start?: string, end?: string) {
    const now = new Date(); const first = new Date(now.getFullYear(), now.getMonth(), 1); const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const startDate = start ? new Date(start) : first; const endDate = end ? new Date(end) : last;
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) throw new Error("INVALID_DATE_RANGE");
    startDate.setHours(0, 0, 0, 0); endDate.setHours(23, 59, 59, 999);
    if (startDate > endDate) throw new Error("INVALID_DATE_RANGE"); return { startDate, endDate };
  }
  async get(accountId: string, input: { startDate?: string; endDate?: string; limit?: number }) {
    const range = this.range(input.startDate, input.endDate); const [wallets, transactions] = await this.repository.load(accountId, range.startDate, range.endDate);
    const summary = transactions.reduce((r, x) => { const amount = number(x.amount); if (x.type === "income") r.totalIncome += amount; if (x.type === "expense") r.totalExpense += amount; return r; }, { totalIncome: 0, totalExpense: 0 });
    const categories = new Map<string, { categoryId: number | null; name: string; icon: string | null; total: number; transactionCount: number }>();
    const activities = new Map<number, { walletId: number; name: string | null; income: number; expense: number; transactionCount: number }>();
    for (const item of transactions) { const amount = number(item.amount); if (item.walletId && item.wallet) { const row = activities.get(item.walletId) ?? { walletId: item.walletId, name: item.wallet.name, income: 0, expense: 0, transactionCount: 0 }; if (item.type === "income") row.income += amount; if (item.type === "expense") row.expense += amount; row.transactionCount++; activities.set(item.walletId, row); } if (item.type === "expense") { const key = String(item.categoryId ?? "uncategorized"); const row = categories.get(key) ?? { categoryId: item.categoryId, name: item.category?.name ?? "Tanpa Kategori", icon: item.category?.icon ?? null, total: 0, transactionCount: 0 }; row.total += amount; row.transactionCount++; categories.set(key, row); } }
    return { range: { startDate: dateText(range.startDate), endDate: dateText(range.endDate) }, summary: { totalBalance: wallets.reduce((sum, x) => sum + number(x.balance), 0), totalIncome: summary.totalIncome, totalExpense: summary.totalExpense, netCashflow: summary.totalIncome - summary.totalExpense, transactionCount: transactions.length, walletCount: wallets.length }, wallets: wallets.map(({ walletId, name, balance, isPrimary }) => ({ walletId, name, balance, isPrimary })), walletActivities: [...activities.values()].sort((a, b) => b.expense - a.expense), topExpenseCategories: [...categories.values()].sort((a, b) => b.total - a.total).slice(0, 5).map((x) => ({ ...x, percentage: summary.totalExpense > 0 ? Number(((x.total / summary.totalExpense) * 100).toFixed(2)) : 0 })), recentTransactions: transactions.slice(0, Number(input.limit ?? 5)).map(({ transactionId, type, amount, name, reportDate, category, wallet }) => ({ transactionId, type, amount, name, reportDate, category, wallet })) };
  }
}
export const dashboardService = new DashboardService();
