import { jwt } from "@elysiajs/jwt";
import { Elysia, t } from "elysia";
import { authError, getAccountId, jwtSecret } from "../../lib/auth";
import { errorResponse, successResponse } from "../../lib/api-response";
import { categoryService } from "./category.service";

const iconFile = t.File({ type: "image", maxSize: "2m" });
const createBody = t.Object({ name: t.String({ minLength: 1 }), icon: t.Optional(iconFile) });
const updateBody = t.Object({ name: t.Optional(t.String({ minLength: 1 })), icon: t.Optional(iconFile) });
const paramsSchema = t.Object({ categoryId: t.Number({ minimum: 1 }) });
const notFound = () => errorResponse("Category not found", { code: "CATEGORY_NOT_FOUND" });
const duplicate = () => errorResponse("Category already exists", { code: "CATEGORY_ALREADY_EXISTS" });

export const categoryRoutes = new Elysia({ prefix: "/categories" })
  .use(jwt({ name: "jwt", secret: jwtSecret }))
  .get("/", async ({ headers, jwt, status }) => { const id = await getAccountId(headers.authorization, jwt.verify); if (!id) return status(401, authError); return successResponse("Categories fetched", await categoryService.list(id)); })
  .get("/:categoryId", async ({ headers, jwt, params, status }) => { const id = await getAccountId(headers.authorization, jwt.verify); if (!id) return status(401, authError); const result = await categoryService.find(id, params.categoryId); return result ? successResponse("Category fetched", result) : status(404, notFound()); }, { params: paramsSchema })
  .post("/", async ({ body, headers, jwt, status }) => { const id = await getAccountId(headers.authorization, jwt.verify); if (!id) return status(401, authError); const result = await categoryService.create(id, body); if (result.kind === "duplicate") return status(409, duplicate()); return status(201, successResponse("Category created", result.category)); }, { body: createBody })
  .patch("/:categoryId", async ({ body, headers, jwt, params, status }) => { const id = await getAccountId(headers.authorization, jwt.verify); if (!id) return status(401, authError); const result = await categoryService.update(id, params.categoryId, body); if (result.kind === "not-found") return status(404, notFound()); if (result.kind === "duplicate") return status(409, duplicate()); return successResponse("Category updated", result.category); }, { body: updateBody, params: paramsSchema })
  .delete("/:categoryId", async ({ headers, jwt, params, status }) => { const id = await getAccountId(headers.authorization, jwt.verify); if (!id) return status(401, authError); const result = await categoryService.delete(id, params.categoryId); return result.kind === "not-found" ? status(404, notFound()) : successResponse("Category deleted", result.category); }, { params: paramsSchema });
