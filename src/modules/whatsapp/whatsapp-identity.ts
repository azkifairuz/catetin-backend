type WhatsappMessageKey = {
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  participant?: string | null;
  participantAlt?: string | null;
};

type GetPhoneNumberForLid = (lid: string) => Promise<string | null>;

const isPhoneNumberJid = (jid: string | null | undefined) =>
  Boolean(jid?.endsWith("@s.whatsapp.net"));

const isLidJid = (jid: string | null | undefined) =>
  Boolean(jid?.endsWith("@lid"));

export const resolveWhatsappIdentityJid = async (
  key: WhatsappMessageKey,
  getPhoneNumberForLid: GetPhoneNumberForLid,
) => {
  const directPhoneNumberJid = [
    key.participantAlt,
    key.remoteJidAlt,
    key.participant,
    key.remoteJid,
  ].find(isPhoneNumberJid);

  if (directPhoneNumberJid) return directPhoneNumberJid;

  const lidJid = [key.participant, key.remoteJid].find(isLidJid);

  if (!lidJid) return null;

  return getPhoneNumberForLid(lidJid);
};
