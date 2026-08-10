import { Elysia } from "elysia";
import qrcode from "qrcode";
import { timingSafeEqual } from "node:crypto";

import { errorResponse, successResponse } from "../../lib/api-response";
import {
  getWhatsappQr,
  resetWhatsappSession,
} from "./whatsapp.service";

const isAdminAuthorized = (authorization: string | undefined) => {
  const adminApiKey = Bun.env.WA_ADMIN_API_KEY;
  const providedApiKey = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (!adminApiKey || !providedApiKey) return false;

  const expected = Buffer.from(adminApiKey);
  const provided = Buffer.from(providedApiKey);

  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
};

export const whatsappRoutes = new Elysia({ prefix: "/whatsapp" })
  .get("/qr", ({ status }) => {
    const qr = getWhatsappQr();

    if (!qr) {
      return status(
        404,
        errorResponse("WhatsApp QR is not available", {
          code: "WHATSAPP_QR_NOT_AVAILABLE",
        }),
      );
    }

    return successResponse("WhatsApp QR fetched", {
      qr,
    });
  })
  .get("/qr.svg", async ({ set, status }) => {
    const qr = getWhatsappQr();

    if (!qr) {
      return status(
        404,
        errorResponse("WhatsApp QR is not available", {
          code: "WHATSAPP_QR_NOT_AVAILABLE",
        }),
      );
    }

    set.headers["content-type"] = "image/svg+xml; charset=utf-8";

    return qrcode.toString(qr, {
      type: "svg",
      margin: 2,
      width: 512,
      errorCorrectionLevel: "M",
    });
  })
  .post("/session/reset", async ({ headers, status }) => {
    if (!Bun.env.WA_ADMIN_API_KEY) {
      return status(
        503,
        errorResponse("WhatsApp admin API key is not configured", {
          code: "WA_ADMIN_API_KEY_NOT_CONFIGURED",
        }),
      );
    }

    if (!isAdminAuthorized(headers.authorization)) {
      return status(
        401,
        errorResponse("Unauthorized", {
          code: "UNAUTHORIZED",
        }),
      );
    }

    if (Bun.env.WA_ENABLED !== "true") {
      return status(
        409,
        errorResponse("WhatsApp service is disabled", {
          code: "WHATSAPP_SERVICE_DISABLED",
        }),
      );
    }

    const result = await resetWhatsappSession();

    return successResponse("WhatsApp session reset; scan the new QR code", {
      ...result,
      qrUrl: "/whatsapp/qr.svg",
    });
  });
