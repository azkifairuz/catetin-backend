import {
  getWhatsappNumberCandidates,
  normalizeWhatsappNumber,
} from "../../lib/whatsapp-number";
import { AuthRepository, authRepository } from "./auth.repository";

type AuthInput = { whatsappNumber: string; username: string; password: string };

export class AuthService {
  constructor(private readonly repository: AuthRepository = authRepository) {}

  private async resolveAccount(whatsappNumber: string) {
    const normalized = normalizeWhatsappNumber(whatsappNumber);
    if (!normalized) return { normalized: null, account: null };
    const accounts = await this.repository.findByWhatsappNumbers(
      getWhatsappNumberCandidates(normalized),
    );
    const account: (typeof accounts)[number] | null =
      accounts.find((item) => item.whatsappNumber === normalized) ??
      (accounts.length > 0 ? accounts[0] : null) ??
      null;
    return { normalized, account };
  }

  async register(input: AuthInput) {
    const existing = await this.resolveAccount(input.whatsappNumber);
    if (!existing.normalized) return { kind: "invalid-number" as const };
    if (existing.account) return { kind: "already-registered" as const, whatsappNumber: existing.normalized };

    const result = await this.repository.register({
      username: input.username,
      whatsappNumber: existing.normalized,
      password: await Bun.password.hash(input.password),
    });
    return { kind: "registered" as const, result };
  }

  async login(input: AuthInput) {
    const existing = await this.resolveAccount(input.whatsappNumber);
    if (!existing.normalized) return { kind: "invalid-number" as const };
    if (!existing.account?.password) return { kind: "invalid-credentials" as const, account: existing.account, whatsappNumber: existing.normalized };
    const valid = await Bun.password.verify(input.password, existing.account.password);
    if (!valid) return { kind: "invalid-credentials" as const, account: existing.account, whatsappNumber: existing.normalized };
    return { kind: "authenticated" as const, account: existing.account };
  }
}

export const authService = new AuthService();
