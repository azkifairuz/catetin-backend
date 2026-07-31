import { jwt } from "@elysiajs/jwt";
import { inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { db } from "../../db";
import { account, wallet } from "../../db/schema";
import { errorResponse, successResponse } from "../../lib/api-response";
import { logApiEvent } from "../../lib/log-service";
import {
  getWhatsappNumberCandidates,
  normalizeWhatsappNumber,
} from "../../lib/whatsapp-number";

const jwtSecret = Bun.env.JWT_SECRET;

if (!jwtSecret) {
  throw new Error("JWT_SECRET is required");
}

const authBody = t.Object({
  whatsappNumber: t.String({ minLength: 8 }),
  username: t.String({ minLength: 3 }),
  password: t.String({ minLength: 6 }),
});

const publicAccountColumns = {
  accountId: account.accountId,
  username: account.username,
  whatsappNumber: account.whatsappNumber,
  createdAt: account.createdAt,
};

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(
    jwt({
      name: "jwt",
      secret: jwtSecret,
      exp: "7d",
    }),
  )
  .post(
    "/register",
    async ({ body, status }) => {
      const normalizedWhatsappNumber = normalizeWhatsappNumber(
        body.whatsappNumber,
      );

      if (!normalizedWhatsappNumber) {
        return status(
          400,
          errorResponse("Invalid WhatsApp number", {
            code: "INVALID_WHATSAPP_NUMBER",
          }),
        );
      }

      const existingAccounts = await db.query.account.findMany({
        where: inArray(
          account.whatsappNumber,
          getWhatsappNumberCandidates(normalizedWhatsappNumber),
        ),
        columns: { accountId: true, whatsappNumber: true },
      });
      const existingAccount =
        existingAccounts.find(
          (item) => item.whatsappNumber === normalizedWhatsappNumber,
        ) ?? existingAccounts[0];

      if (existingAccount) {
        logApiEvent(409, "WhatsApp number already registered", {
          whatsappNumber: normalizedWhatsappNumber,
        });

        return status(
          409,
          errorResponse("WhatsApp number already registered", {
            code: "WHATSAPP_NUMBER_ALREADY_REGISTERED",
          }),
        );
      }

      const passwordHash = await Bun.password.hash(body.password);

      const result = await db.transaction(async (tx) => {
        const [createdAccount] = await tx
          .insert(account)
          .values({
            username: body.username,
            whatsappNumber: normalizedWhatsappNumber,
            password: passwordHash,
          })
          .returning(publicAccountColumns);

        if (!createdAccount) {
          throw new Error("Failed to create account");
        }

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

        if (!createdWallet) {
          throw new Error("Failed to create primary wallet");
        }

        return {
          account: createdAccount,
          wallet: createdWallet,
        };
      });

      logApiEvent(201, "Account registered", {
        accountId: result.account.accountId,
        walletId: result.wallet.walletId,
      });

      return status(201, successResponse("Account registered", result));
    },
    {
      body: authBody,
    },
  )
  .post(
    "/login",
    async ({ body, jwt, status }) => {
      const normalizedWhatsappNumber = normalizeWhatsappNumber(
        body.whatsappNumber,
      );

      if (!normalizedWhatsappNumber) {
        return status(
          400,
          errorResponse("Invalid WhatsApp number", {
            code: "INVALID_WHATSAPP_NUMBER",
          }),
        );
      }

      const existingAccounts = await db.query.account.findMany({
        where: inArray(
          account.whatsappNumber,
          getWhatsappNumberCandidates(normalizedWhatsappNumber),
        ),
      });
      const existingAccount =
        existingAccounts.find(
          (item) => item.whatsappNumber === normalizedWhatsappNumber,
        ) ?? existingAccounts[0];

      if (!existingAccount?.password) {
        logApiEvent(401, "Invalid credentials", {
          whatsappNumber: normalizedWhatsappNumber,
        });

        return status(
          401,
          errorResponse("Invalid credentials", {
            code: "INVALID_CREDENTIALS",
          }),
        );
      }

      const isPasswordValid = await Bun.password.verify(
        body.password,
        existingAccount.password,
      );

      if (!isPasswordValid) {
        logApiEvent(401, "Invalid credentials", {
          accountId: existingAccount.accountId,
          whatsappNumber: existingAccount.whatsappNumber,
        });

        return status(
          401,
          errorResponse("Invalid credentials", {
            code: "INVALID_CREDENTIALS",
          }),
        );
      }

      const token = await jwt.sign({
        sub: existingAccount.accountId,
        whatsappNumber: existingAccount.whatsappNumber ?? undefined,
      });

      logApiEvent(200, "Login successful", {
        accountId: existingAccount.accountId,
        whatsappNumber: existingAccount.whatsappNumber,
      });

      return successResponse("Login successful", {
        token,
        account: {
          accountId: existingAccount.accountId,
          username: existingAccount.username,
          whatsappNumber: existingAccount.whatsappNumber,
          createdAt: existingAccount.createdAt,
        },
      });
    },
    {
      body: authBody,
    },
  );
