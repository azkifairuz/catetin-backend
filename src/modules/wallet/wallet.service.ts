import { WalletRepository, type WalletWrite, walletRepository } from "./wallet.repository";
export class WalletService {
  constructor(private readonly repository: WalletRepository = walletRepository) {}
  list(accountId: string) { return this.repository.list(accountId); }
  find(accountId: string, walletId: number) { return this.repository.find(accountId, walletId); }
  private valid(value: string) { const number = Number(value); return Number.isFinite(number) && number >= 0; }
  async create(accountId: string, input: { name: string; balance?: string; isPrimary?: boolean }) { const balance = input.balance ?? "0"; if (!this.valid(balance)) return { kind: "invalid-balance" as const }; return { kind: "created" as const, wallet: await this.repository.create(accountId, { ...input, balance }) }; }
  async update(accountId: string, walletId: number, input: WalletWrite) { if (input.balance && !this.valid(input.balance)) return { kind: "invalid-balance" as const }; const result = await this.repository.update(accountId, walletId, input); return result ? { kind: "updated" as const, wallet: result } : { kind: "not-found" as const }; }
  async delete(accountId: string, walletId: number) { const result = await this.repository.delete(accountId, walletId); return result ? { kind: "deleted" as const, wallet: result } : { kind: "not-found" as const }; }
}
export const walletService = new WalletService();
