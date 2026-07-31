import { relations, sql } from "drizzle-orm";
import {
  boolean,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const transactionType = pgEnum("transaction_type", ["income", "expense"]);

export const account = pgTable("account", {
  accountId: uuid("account_id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: varchar("username"),
  password: varchar("password"),
  whatsappNumber: varchar("whatsapp_number").unique(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const wallet = pgTable("wallet", {
  walletId: serial("wallet_id").primaryKey(),
  accountId: uuid("account_id").references(() => account.accountId),
  name: varchar("name"),
  balance: numeric("balance").default("0"),
  isPrimary: boolean("is_primary").default(false),
});

export const category = pgTable("category", {
  categoryId: serial("category_id").primaryKey(),
  accountId: uuid("account_id").references(() => account.accountId),
  name: varchar("name"),
  icon: varchar("icon"),
});

export const budget = pgTable("budget", {
  budgetId: serial("budget_id").primaryKey(),
  accountId: uuid("account_id").references(() => account.accountId),
  categoryId: integer("category_id").references(() => category.categoryId),
  name: varchar("name"),
  amount: numeric("amount"),
  period: varchar("period"),
});

export const transaction = pgTable("transaction", {
  transactionId: serial("transaction_id").primaryKey(),
  accountId: uuid("account_id").references(() => account.accountId),
  walletId: integer("wallet_id").references(() => wallet.walletId),
  categoryId: integer("category_id").references(() => category.categoryId),
  budgetId: integer("budget_id").references(() => budget.budgetId),
  type: transactionType("type"),
  amount: numeric("amount"),
  name: varchar("name"),
  isAiGenerated: boolean("is_ai_generated").default(false),
  receiptImageUrl: varchar("receipt_image_url"),
  receiptId: uuid("receipt_id"),
  receiptMerchant: varchar("receipt_merchant"),
  receiptLineType: varchar("receipt_line_type"),
  quantity: numeric("quantity"),
  unitPrice: numeric("unit_price"),
  reportDate: timestamp("report_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const accountRelations = relations(account, ({ many }) => ({
  wallets: many(wallet),
  categories: many(category),
  budgets: many(budget),
  transactions: many(transaction),
}));

export const walletRelations = relations(wallet, ({ one, many }) => ({
  account: one(account, {
    fields: [wallet.accountId],
    references: [account.accountId],
  }),
  transactions: many(transaction),
}));

export const categoryRelations = relations(category, ({ one, many }) => ({
  account: one(account, {
    fields: [category.accountId],
    references: [account.accountId],
  }),
  budgets: many(budget),
  transactions: many(transaction),
}));

export const budgetRelations = relations(budget, ({ one, many }) => ({
  account: one(account, {
    fields: [budget.accountId],
    references: [account.accountId],
  }),
  category: one(category, {
    fields: [budget.categoryId],
    references: [category.categoryId],
  }),
  transactions: many(transaction),
}));

export const transactionRelations = relations(transaction, ({ one }) => ({
  account: one(account, {
    fields: [transaction.accountId],
    references: [account.accountId],
  }),
  wallet: one(wallet, {
    fields: [transaction.walletId],
    references: [wallet.walletId],
  }),
  category: one(category, {
    fields: [transaction.categoryId],
    references: [category.categoryId],
  }),
  budget: one(budget, {
    fields: [transaction.budgetId],
    references: [budget.budgetId],
  }),
}));

export const schema = {
  account,
  wallet,
  category,
  budget,
  transaction,
  transactionType,
};

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
export type Wallet = typeof wallet.$inferSelect;
export type NewWallet = typeof wallet.$inferInsert;
export type Category = typeof category.$inferSelect;
export type NewCategory = typeof category.$inferInsert;
export type Budget = typeof budget.$inferSelect;
export type NewBudget = typeof budget.$inferInsert;
export type Transaction = typeof transaction.$inferSelect;
export type NewTransaction = typeof transaction.$inferInsert;
