import { Elysia } from "elysia";
import qrcode from "qrcode";

import { errorResponse, successResponse } from "../../lib/api-response";
import { getWhatsappQr } from "./whatsapp.service";

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
  });
