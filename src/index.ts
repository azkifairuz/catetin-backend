import { app } from "./app";
import { startWhatsappService } from "./modules/whatsapp/whatsapp.service";

const port = Number(Bun.env.PORT ?? 3000);
const hostname = Bun.env.HOST ?? "0.0.0.0";

app.listen({
  port,
  hostname,
});

console.log(
  `Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);

if (Bun.env.WA_ENABLED === "true") {
  startWhatsappService().catch((error) => {
    console.error("Failed to start WhatsApp service", error);
  });
}
