import { jwt } from "@elysiajs/jwt";
import { and, desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { db } from "../../db";
import { category } from "../../db/schema";
import { authError, getAccountId, jwtSecret } from "../../lib/auth";
import { errorResponse, successResponse } from "../../lib/api-response";
import { saveUploadedImage } from "../../lib/upload";

const iconFile = t.File({
  type: "image",
  maxSize: "2m",
});

const createCategoryBody = t.Object({
  name: t.String({ minLength: 1 }),
  icon: t.Optional(iconFile),
});

const updateCategoryBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  icon: t.Optional(iconFile),
});

const categoryParams = t.Object({
  categoryId: t.Number({ minimum: 1 }),
});

const categoryColumns = {
  categoryId: category.categoryId,
  accountId: category.accountId,
  name: category.name,
  icon: category.icon,
};

export const categoryRoutes = new Elysia({ prefix: "/categories" })
  .use(
    jwt({
      name: "jwt",
      secret: jwtSecret,
    }),
  )
  .get("/", async ({ headers, jwt, status }) => {
    const accountId = await getAccountId(headers.authorization, jwt.verify);

    if (!accountId) {
      return status(401, authError);
    }

    const categories = await db.query.category.findMany({
      where: eq(category.accountId, accountId),
      orderBy: desc(category.categoryId),
    });

    return successResponse("Categories fetched", categories);
  })
  .get(
    "/:categoryId",
    async ({ headers, jwt, params, status }) => {
      const accountId = await getAccountId(headers.authorization, jwt.verify);

      if (!accountId) {
        return status(401, authError);
      }

      const existingCategory = await db.query.category.findFirst({
        where: and(
          eq(category.categoryId, params.categoryId),
          eq(category.accountId, accountId),
        ),
      });

      if (!existingCategory) {
        return status(
          404,
          errorResponse("Category not found", {
            code: "CATEGORY_NOT_FOUND",
          }),
        );
      }

      return successResponse("Category fetched", existingCategory);
    },
    {
      params: categoryParams,
    },
  )
  .post(
    "/",
    async ({ body, headers, jwt, status }) => {
      const accountId = await getAccountId(headers.authorization, jwt.verify);

      if (!accountId) {
        return status(401, authError);
      }

      const existingCategory = await db.query.category.findFirst({
        where: and(
          eq(category.accountId, accountId),
          eq(category.name, body.name),
        ),
      });

      if (existingCategory) {
        return status(
          409,
          errorResponse("Category already exists", {
            code: "CATEGORY_ALREADY_EXISTS",
          }),
        );
      }

      const icon = await saveUploadedImage(
        "categories",
        "categories",
        accountId,
        body.icon,
      );

      const [createdCategory] = await db
        .insert(category)
        .values({
          accountId,
          name: body.name,
          icon,
        })
        .returning(categoryColumns);

      return status(
        201,
        successResponse("Category created", createdCategory),
      );
    },
    {
      body: createCategoryBody,
    },
  )
  .patch(
    "/:categoryId",
    async ({ body, headers, jwt, params, status }) => {
      const accountId = await getAccountId(headers.authorization, jwt.verify);

      if (!accountId) {
        return status(401, authError);
      }

      const existingCategory = await db.query.category.findFirst({
        where: and(
          eq(category.categoryId, params.categoryId),
          eq(category.accountId, accountId),
        ),
      });

      if (!existingCategory) {
        return status(
          404,
          errorResponse("Category not found", {
            code: "CATEGORY_NOT_FOUND",
          }),
        );
      }

      if (body.name && body.name !== existingCategory.name) {
        const sameNameCategory = await db.query.category.findFirst({
          where: and(
            eq(category.accountId, accountId),
            eq(category.name, body.name),
          ),
        });

        if (sameNameCategory) {
          return status(
            409,
            errorResponse("Category already exists", {
              code: "CATEGORY_ALREADY_EXISTS",
            }),
          );
        }
      }

      const icon = await saveUploadedImage(
        "categories",
        "categories",
        accountId,
        body.icon,
      );

      const [updatedCategory] = await db
        .update(category)
        .set({
          name: body.name ?? existingCategory.name,
          icon: icon ?? existingCategory.icon,
        })
        .where(
          and(
            eq(category.categoryId, params.categoryId),
            eq(category.accountId, accountId),
          ),
        )
        .returning(categoryColumns);

      return successResponse("Category updated", updatedCategory);
    },
    {
      body: updateCategoryBody,
      params: categoryParams,
    },
  )
  .delete(
    "/:categoryId",
    async ({ headers, jwt, params, status }) => {
      const accountId = await getAccountId(headers.authorization, jwt.verify);

      if (!accountId) {
        return status(401, authError);
      }

      const [deletedCategory] = await db
        .delete(category)
        .where(
          and(
            eq(category.categoryId, params.categoryId),
            eq(category.accountId, accountId),
          ),
        )
        .returning(categoryColumns);

      if (!deletedCategory) {
        return status(
          404,
          errorResponse("Category not found", {
            code: "CATEGORY_NOT_FOUND",
          }),
        );
      }

      return successResponse("Category deleted", deletedCategory);
    },
    {
      params: categoryParams,
    },
  );
