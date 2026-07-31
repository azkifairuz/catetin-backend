import { describe, expect, test } from "bun:test";

import { resolveWhatsappIdentityJid } from "./whatsapp-identity";

describe("resolveWhatsappIdentityJid", () => {
  test("prefers the alternate phone-number JID over a LID", async () => {
    const result = await resolveWhatsappIdentityJid(
      {
        remoteJid: "218038444011643@lid",
        remoteJidAlt: "6285155119213@s.whatsapp.net",
      },
      async () => null,
    );

    expect(result).toBe("6285155119213@s.whatsapp.net");
  });

  test("resolves a LID through the Baileys mapping store", async () => {
    const result = await resolveWhatsappIdentityJid(
      { remoteJid: "218038444011643@lid" },
      async (lid) =>
        lid === "218038444011643@lid"
          ? "6285155119213@s.whatsapp.net"
          : null,
    );

    expect(result).toBe("6285155119213@s.whatsapp.net");
  });

  test("uses participantAlt for group messages", async () => {
    const result = await resolveWhatsappIdentityJid(
      {
        remoteJid: "120363000000@g.us",
        participant: "218038444011643@lid",
        participantAlt: "6285155119213@s.whatsapp.net",
      },
      async () => null,
    );

    expect(result).toBe("6285155119213@s.whatsapp.net");
  });

  test("does not use an unresolved LID as a phone number", async () => {
    expect(
      await resolveWhatsappIdentityJid(
        { remoteJid: "218038444011643@lid" },
        async () => null,
      ),
    ).toBeNull();
  });
});
