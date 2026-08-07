import { describe, expect, test } from "bun:test";

import { WalletService } from "./wallet.service";

describe("WalletService", () => {
  test("rejects a negative opening balance before calling the repository", async () => {
    let createCalled = false;
    const repository = {
      create: async () => {
        createCalled = true;
      },
    };
    const service = new WalletService(repository as any);

    expect(
      await service.create("account-id", { name: "Cash", balance: "-1" }),
    ).toEqual({ kind: "invalid-balance" });
    expect(createCalled).toBeFalse();
  });

  test("uses zero as the default opening balance", async () => {
    let receivedBalance: string | undefined;
    const repository = {
      create: async (_accountId: string, input: { balance: string }) => {
        receivedBalance = input.balance;
        return { walletId: 1, name: "Cash", balance: input.balance };
      },
    };
    const service = new WalletService(repository as any);

    const result = await service.create("account-id", { name: "Cash" });

    expect(result.kind).toBe("created");
    expect(receivedBalance).toBe("0");
  });
});
