const MIN_E164_DIGITS = 8;
const MAX_E164_DIGITS = 15;

const getDigits = (value: string) =>
  value.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";

export const normalizeWhatsappNumber = (value: string) => {
  const trimmedValue = value.trim();
  const digits = getDigits(trimmedValue);

  if (!digits) return null;

  let internationalDigits: string;

  if (digits.startsWith("0")) {
    internationalDigits = `62${digits.slice(1)}`;
  } else if (digits.startsWith("8")) {
    internationalDigits = `62${digits}`;
  } else if (digits.startsWith("62")) {
    internationalDigits = digits;
  } else if (trimmedValue.startsWith("+")) {
    internationalDigits = digits;
  } else {
    return null;
  }

  if (
    internationalDigits.length < MIN_E164_DIGITS ||
    internationalDigits.length > MAX_E164_DIGITS
  ) {
    return null;
  }

  return `+${internationalDigits}`;
};

export const getWhatsappNumberCandidates = (value: string) => {
  const normalizedNumber = normalizeWhatsappNumber(value);

  if (!normalizedNumber) return [];

  const digits = normalizedNumber.slice(1);
  const candidates = [normalizedNumber, digits];

  if (digits.startsWith("62")) {
    candidates.push(`0${digits.slice(2)}`);
  }

  return [...new Set(candidates)];
};
