import { inArray } from "drizzle-orm";

import { db } from "../../db";
import { account, wallet } from "../../db/schema";

const publicAccountColumns = {
  accountId: account.accountId,
  username: account.username,
  whatsappNumber: account.whatsappNumber,
  createdAt: account.createdAt,
};

export class AuthRepository {
  constructor(private readonly database: typeof db = db) {}

  findByWhatsappNumbers(numbers: string[]) {
    return this.database.query.account.findMany({
      where: inArray(account.whatsappNumber, numbers),
    });
  }

  register(input: { username: string; whatsappNumber: string; password: string }) {
    return this.database.transaction(async (tx) => {
      const [createdAccount] = await tx
        .insert(account)
        .values(input)
        .returning(publicAccountColumns);
      if (!createdAccount) throw new Error("Failed to create account");

      const [createdWallet] = await tx
        .insert(wallet)
        .values({
          accountId: createdAccount.accountId,
          name: "Main Wallet",
          balance: "0",
          isPrimary: true,
        })
        .returning({
          walletId: wallet.walletId,
          name: wallet.name,
          balance: wallet.balance,
          isPrimary: wallet.isPrimary,
        });
      if (!createdWallet) throw new Error("Failed to create primary wallet");

      return { account: createdAccount, wallet: createdWallet };
    });
  }
}

export const authRepository = new AuthRepository();
