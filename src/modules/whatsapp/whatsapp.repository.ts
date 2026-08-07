import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../../db";
import { account, budget, category, transaction, wallet } from "../../db/schema";
export class WhatsappRepository {
  constructor(private readonly database: typeof db = db) {}
  findAccounts(numbers: string[]) { return this.database.query.account.findMany({ where: inArray(account.whatsappNumber, numbers), columns: { accountId: true, whatsappNumber: true, username: true } }); }
  register(input: { username: string; whatsappNumber: string; password: string }) { return this.database.transaction(async (tx) => { const [createdAccount] = await tx.insert(account).values(input).returning({ accountId: account.accountId, username: account.username, whatsappNumber: account.whatsappNumber }); if (!createdAccount) throw new Error("WA_REGISTER_ACCOUNT_FAILED"); const [createdWallet] = await tx.insert(wallet).values({ accountId: createdAccount.accountId, name: "Main Wallet", balance: "0", isPrimary: true }).returning({ walletId: wallet.walletId, name: wallet.name }); if (!createdWallet) throw new Error("WA_REGISTER_WALLET_FAILED"); return { account: createdAccount, wallet: createdWallet }; }); }
  listBalances(accountId: string) { return this.database.query.wallet.findMany({ where: eq(wallet.accountId, accountId), orderBy: desc(wallet.isPrimary), columns: { name: true, balance: true, isPrimary: true } }); }

  listBudgets(accountId: string) {
    return this.database.query.budget.findMany({
      where: eq(budget.accountId, accountId),
      orderBy: desc(budget.budgetId),
      with: { category: true },
    });
  }

  async saveBudget(input: {
    accountId: string;
    categoryName: string;
    amount: number;
    period: string;
  }) {
    return this.database.transaction(async (tx) => {
      let selectedCategory = await tx.query.category.findFirst({
        where: and(
          eq(category.accountId, input.accountId),
          eq(category.name, input.categoryName),
        ),
      });

      if (!selectedCategory) {
        [selectedCategory] = await tx
          .insert(category)
          .values({ accountId: input.accountId, name: input.categoryName })
          .returning();
      }
      if (!selectedCategory) throw new Error("CATEGORY_CREATE_FAILED");

      const existing = await tx.query.budget.findFirst({
        where: and(
          eq(budget.accountId, input.accountId),
          eq(budget.categoryId, selectedCategory.categoryId),
          eq(budget.period, input.period),
        ),
      });

      const values = {
        accountId: input.accountId,
        categoryId: selectedCategory.categoryId,
        name: `Budget ${selectedCategory.name}`,
        amount: input.amount.toString(),
        period: input.period,
      };
      const [savedBudget] = existing
        ? await tx
            .update(budget)
            .set(values)
            .where(eq(budget.budgetId, existing.budgetId))
            .returning()
        : await tx.insert(budget).values(values).returning();

      return { budget: savedBudget, category: selectedCategory, updated: Boolean(existing) };
    });
  }

  listExpensesSince(accountId: string, startDate: Date) {
    return this.database.query.transaction.findMany({
      where: and(
        eq(transaction.accountId, accountId),
        eq(transaction.type, "expense"),
        gte(transaction.reportDate, startDate),
      ),
      columns: { categoryId: true, amount: true, reportDate: true },
    });
  }
}
export const whatsappRepository = new WhatsappRepository();
