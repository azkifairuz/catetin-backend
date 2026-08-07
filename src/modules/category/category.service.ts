import { saveUploadedImage } from "../../lib/upload";
import { CategoryRepository, categoryRepository } from "./category.repository";

export class CategoryService {
  constructor(private readonly repository: CategoryRepository = categoryRepository) {}
  list(accountId: string) { return this.repository.list(accountId); }
  find(accountId: string, categoryId: number) { return this.repository.find(accountId, categoryId); }
  async create(accountId: string, input: { name: string; icon?: File }) {
    if (await this.repository.findByName(accountId, input.name)) return { kind: "duplicate" as const };
    const icon = await saveUploadedImage("categories", "categories", accountId, input.icon);
    return { kind: "created" as const, category: await this.repository.create({ accountId, name: input.name, icon }) };
  }
  async update(accountId: string, categoryId: number, input: { name?: string; icon?: File }) {
    const current = await this.repository.find(accountId, categoryId);
    if (!current) return { kind: "not-found" as const };
    if (input.name && input.name !== current.name && await this.repository.findByName(accountId, input.name)) return { kind: "duplicate" as const };
    const icon = await saveUploadedImage("categories", "categories", accountId, input.icon);
    return { kind: "updated" as const, category: await this.repository.update(accountId, categoryId, { name: input.name ?? current.name, icon: icon ?? current.icon }) };
  }
  async delete(accountId: string, categoryId: number) { const result = await this.repository.delete(accountId, categoryId); return result ? { kind: "deleted" as const, category: result } : { kind: "not-found" as const }; }
}
export const categoryService = new CategoryService();
