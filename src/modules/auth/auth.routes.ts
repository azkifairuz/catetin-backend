import { jwt } from "@elysiajs/jwt";
import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { db } from "../../db";
import { account, wallet } from "../../db/schema";
import { errorResponse, successResponse } from "../../lib/api-response";

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
      const existingAccount = await db.query.account.findFirst({
        where: eq(account.whatsappNumber, body.whatsappNumber),
        columns: { accountId: true },
      });

      if (existingAccount) {
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
            whatsappNumber: body.whatsappNumber,
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

      return status(201, successResponse("Account registered", result));
    },
    {
      body: authBody,
    },
  )
  .post(
    "/login",
    async ({ body, jwt, status }) => {
      const existingAccount = await db.query.account.findFirst({
        where: eq(account.whatsappNumber, body.whatsappNumber),
      });

      if (!existingAccount?.password) {
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
