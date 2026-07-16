import { jwt } from "@elysiajs/jwt";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { db } from "../../db";
import { transaction, wallet } from "../../db/schema";
import { successResponse } from "../../lib/api-response";
import { authError, getAccountId, jwtSecret } from "../../lib/auth";
import { handleApiError } from "../../lib/error-handler";
import { logApiEvent } from "../../lib/log-service";

const dashboardQuery = t.Object({
  startDate: t.Optional(t.String()),
  endDate: t.Optional(t.String()),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
});

const getMonthRange = () => {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  return { startDate, endDate };
};

const parseDateRange = (startDateText?: string, endDateText?: string) => {
  const defaultRange = getMonthRange();
  const startDate = startDateText ? new Date(startDateText) : defaultRange.startDate;
  const endDate = endDateText ? new Date(endDateText) : defaultRange.endDate;

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("INVALID_DATE_RANGE");
  }

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  if (startDate > endDate) {
    throw new Error("INVALID_DATE_RANGE");
  }

  return { startDate, endDate };
};

const toDateText = (date: Date) => date.toISOString().slice(0, 10);

const toNumber = (value: string | null | undefined) => Number(value ?? 0);

export const dashboardRoutes = new Elysia({ prefix: "/dashboard" })
  .use(
    jwt({
      name: "jwt",
      secret: jwtSecret,
    }),
  )
  .get(
    "/",
    async ({ headers, jwt, query, status }) => {
      const accountId = await getAccountId(headers.authorization, jwt.verify);

      if (!accountId) {
        logApiEvent(401, "Unauthorized", {
          module: "dashboard",
          action: "summary",
        });

        return status(401, authError);
      }

      const range = parseDateRange(query.startDate, query.endDate);
      const recentLimit = Number(query.limit ?? 5);

      const [wallets, transactions] = await Promise.all([
        db.query.wallet.findMany({
          where: eq(wallet.accountId, accountId),
          orderBy: desc(wallet.isPrimary),
        }),
        db.query.transaction.findMany({
          where: and(
            eq(transaction.accountId, accountId),
            gte(transaction.reportDate, range.startDate),
            lte(transaction.reportDate, range.endDate),
          ),
          orderBy: desc(transaction.reportDate),
          with: {
            category: true,
            wallet: true,
          },
        }),
      ]);

      const summary = transactions.reduce(
        (result, item) => {
          const amount = toNumber(item.amount);

          if (item.type === "income") {
            result.totalIncome += amount;
          }

          if (item.type === "expense") {
            result.totalExpense += amount;
          }

          return result;
        },
        {
          totalIncome: 0,
          totalExpense: 0,
        },
      );

      const totalBalance = wallets.reduce(
        (total, item) => total + toNumber(item.balance),
        0,
      );
      const netCashflow = summary.totalIncome - summary.totalExpense;

      const expenseCategoryMap = new Map<
        string,
        {
          categoryId: number | null;
          name: string;
          icon: string | null;
          total: number;
          transactionCount: number;
        }
      >();

      const walletActivityMap = new Map<
        number,
        {
          walletId: number;
          name: string | null;
          income: number;
          expense: number;
          transactionCount: number;
        }
      >();

      for (const item of transactions) {
        const amount = toNumber(item.amount);

        if (item.walletId && item.wallet) {
          const existingWallet = walletActivityMap.get(item.walletId) ?? {
            walletId: item.walletId,
            name: item.wallet.name,
            income: 0,
            expense: 0,
            transactionCount: 0,
          };

          if (item.type === "income") existingWallet.income += amount;
          if (item.type === "expense") existingWallet.expense += amount;
          existingWallet.transactionCount += 1;
          walletActivityMap.set(item.walletId, existingWallet);
        }

        if (item.type !== "expense") continue;

        const categoryKey = String(item.categoryId ?? "uncategorized");
        const existingCategory = expenseCategoryMap.get(categoryKey) ?? {
          categoryId: item.categoryId,
          name: item.category?.name ?? "Tanpa Kategori",
          icon: item.category?.icon ?? null,
          total: 0,
          transactionCount: 0,
        };

        existingCategory.total += amount;
        existingCategory.transactionCount += 1;
        expenseCategoryMap.set(categoryKey, existingCategory);
      }

      const topExpenseCategories = Array.from(expenseCategoryMap.values())
        .sort((left, right) => right.total - left.total)
        .slice(0, 5)
        .map((item) => ({
          ...item,
          percentage:
            summary.totalExpense > 0
              ? Number(((item.total / summary.totalExpense) * 100).toFixed(2))
              : 0,
        }));

      const walletActivities = Array.from(walletActivityMap.values()).sort(
        (left, right) => right.expense - left.expense,
      );

      const recentTransactions = transactions.slice(0, recentLimit).map((item) => ({
        transactionId: item.transactionId,
        type: item.type,
        amount: item.amount,
        name: item.name,
        reportDate: item.reportDate,
        category: item.category,
        wallet: item.wallet,
      }));

      const data = {
        range: {
          startDate: toDateText(range.startDate),
          endDate: toDateText(range.endDate),
        },
        summary: {
          totalBalance,
          totalIncome: summary.totalIncome,
          totalExpense: summary.totalExpense,
          netCashflow,
          transactionCount: transactions.length,
          walletCount: wallets.length,
        },
        wallets: wallets.map((item) => ({
          walletId: item.walletId,
          name: item.name,
          balance: item.balance,
          isPrimary: item.isPrimary,
        })),
        walletActivities,
        topExpenseCategories,
        recentTransactions,
      };

      logApiEvent(200, "Dashboard fetched", {
        accountId,
        startDate: data.range.startDate,
        endDate: data.range.endDate,
        transactionCount: transactions.length,
      });

      return successResponse("Dashboard fetched", data);
    },
    {
      query: dashboardQuery,
    },
  )
  .onError(({ error, status }) => handleApiError(error, status, "dashboard"));
