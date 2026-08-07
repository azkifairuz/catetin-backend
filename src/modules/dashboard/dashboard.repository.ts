import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "../../db";
import { transaction, wallet } from "../../db/schema";
export class DashboardRepository {
  constructor(private readonly database: typeof db = db) {}
  load(accountId: string, startDate: Date, endDate: Date) { return Promise.all([
    this.database.query.wallet.findMany({ where: eq(wallet.accountId, accountId), orderBy: desc(wallet.isPrimary) }),
    this.database.query.transaction.findMany({ where: and(eq(transaction.accountId, accountId), gte(transaction.reportDate, startDate), lte(transaction.reportDate, endDate)), orderBy: desc(transaction.reportDate), with: { category: true, wallet: true } }),
  ]); }
}
export const dashboardRepository = new DashboardRepository();
