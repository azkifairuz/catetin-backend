import { expect, test } from "bun:test";

import { CategoryService } from "./category.service";

test("CategoryService rejects a duplicate name before storing an icon", async () => {
  const repository = {
    findByName: async () => ({ categoryId: 1, name: "Makanan" }),
  };
  const service = new CategoryService(repository as any);

  expect(
    await service.create("account-id", { name: "Makanan" }),
  ).toEqual({ kind: "duplicate" });
});
