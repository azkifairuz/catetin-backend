import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { category } from "../../db/schema";

const columns = { categoryId: category.categoryId, accountId: category.accountId, name: category.name, icon: category.icon };

export class CategoryRepository {
  constructor(private readonly database: typeof db = db) {}
  list(accountId: string) { return this.database.query.category.findMany({ where: eq(category.accountId, accountId), orderBy: desc(category.categoryId) }); }
  find(accountId: string, categoryId: number) { return this.database.query.category.findFirst({ where: and(eq(category.categoryId, categoryId), eq(category.accountId, accountId)) }); }
  findByName(accountId: string, name: string) { return this.database.query.category.findFirst({ where: and(eq(category.accountId, accountId), eq(category.name, name)) }); }
  async create(input: { accountId: string; name: string; icon?: string }) { const [result] = await this.database.insert(category).values(input).returning(columns); return result; }
  async update(accountId: string, categoryId: number, input: { name: string | null; icon: string | null }) { const [result] = await this.database.update(category).set(input).where(and(eq(category.categoryId, categoryId), eq(category.accountId, accountId))).returning(columns); return result; }
  async delete(accountId: string, categoryId: number) { const [result] = await this.database.delete(category).where(and(eq(category.categoryId, categoryId), eq(category.accountId, accountId))).returning(columns); return result; }
}
export const categoryRepository = new CategoryRepository();
