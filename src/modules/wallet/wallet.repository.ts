import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { wallet } from "../../db/schema";

const columns = { walletId: wallet.walletId, accountId: wallet.accountId, name: wallet.name, balance: wallet.balance, isPrimary: wallet.isPrimary };
export type WalletWrite = { name?: string; balance?: string; isPrimary?: boolean };

export class WalletRepository {
  constructor(private readonly database: typeof db = db) {}
  list(accountId: string) { return this.database.query.wallet.findMany({ where: eq(wallet.accountId, accountId), orderBy: desc(wallet.isPrimary) }); }
  find(accountId: string, walletId: number) { return this.database.query.wallet.findFirst({ where: and(eq(wallet.walletId, walletId), eq(wallet.accountId, accountId)) }); }
  create(accountId: string, input: Required<Pick<WalletWrite, "name" | "balance">> & Pick<WalletWrite, "isPrimary">) {
    return this.database.transaction(async (tx) => {
      const existing = await tx.query.wallet.findFirst({ where: eq(wallet.accountId, accountId), columns: { walletId: true } });
      const isPrimary = input.isPrimary ?? !existing;
      if (isPrimary) await tx.update(wallet).set({ isPrimary: false }).where(eq(wallet.accountId, accountId));
      const [result] = await tx.insert(wallet).values({ accountId, name: input.name, balance: input.balance, isPrimary }).returning(columns);
      return result;
    });
  }
  update(accountId: string, walletId: number, input: WalletWrite) {
    return this.database.transaction(async (tx) => {
      const current = await tx.query.wallet.findFirst({ where: and(eq(wallet.walletId, walletId), eq(wallet.accountId, accountId)) });
      if (!current) return null;
      if (input.isPrimary === true) await tx.update(wallet).set({ isPrimary: false }).where(eq(wallet.accountId, accountId));
      const [result] = await tx.update(wallet).set({ name: input.name ?? current.name, balance: input.balance ?? current.balance, isPrimary: input.isPrimary ?? current.isPrimary }).where(and(eq(wallet.walletId, walletId), eq(wallet.accountId, accountId))).returning(columns);
      return result;
    });
  }
  async delete(accountId: string, walletId: number) { const [result] = await this.database.delete(wallet).where(and(eq(wallet.walletId, walletId), eq(wallet.accountId, accountId))).returning(columns); return result; }
}
export const walletRepository = new WalletRepository();
