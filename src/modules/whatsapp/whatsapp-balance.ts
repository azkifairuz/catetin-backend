export type BalanceWallet = {
  name: string | null;
  balance: string | null;
  isPrimary: boolean | null;
};

const normalizeText = (text: string) =>
  text.trim().toLowerCase().replace(/\s+/g, " ");

export const isBalanceQuestion = (text: string) => {
  const normalizedText = normalizeText(text);

  if (/^\/saldo\b/.test(normalizedText)) return true;
  if (/^(saldo|balance)$/.test(normalizedText)) return true;

  return [
    /\b(berapa|cek|lihat|tampilkan|info)\b.*\b(saldo|balance)\b/,
    /\b(saldo|balance)\b.*\b(berapa|tersisa|sekarang|saat ini)\b/,
    /\b(sisa saldo|saldo tersisa|uang tersisa|sisa uang)\b/,
    /\b(uang|duit)(ku| saya| aku)?\s+(tinggal|tersisa)\s+berapa\b/,
  ].some((pattern) => pattern.test(normalizedText));
};

export const formatRupiah = (value: number) => {
  const normalizedValue = Number.isFinite(value) ? value : 0;
  const sign = normalizedValue < 0 ? "-" : "";

  return `${sign}Rp${Math.abs(normalizedValue).toLocaleString("id-ID")}`;
};

export const formatBalanceReply = (wallets: BalanceWallet[]) => {
  if (wallets.length === 0) {
    return "Kamu belum punya wallet. Buat wallet dulu agar saldo bisa dihitung.";
  }

  const walletBalances = wallets.map((item) => ({
    ...item,
    numericBalance: Number(item.balance ?? 0),
  }));
  const totalBalance = walletBalances.reduce(
    (total, item) => total + item.numericBalance,
    0,
  );
  const details = walletBalances.map((item) => {
    const walletName = item.name ?? "Wallet tanpa nama";
    const primaryLabel = item.isPrimary ? " (utama)" : "";

    return `• ${walletName}${primaryLabel}: ${formatRupiah(item.numericBalance)}`;
  });
  const negativeBalanceNote =
    totalBalance < 0
      ? [
          "",
          "Saldo kamu masih negatif. Pastikan saldo awal atau pemasukan sudah dicatat.",
        ]
      : [];

  return [
    `Total saldo kamu saat ini: ${formatRupiah(totalBalance)}`,
    "",
    "Rincian wallet:",
    ...details,
    ...negativeBalanceNote,
  ].join("\n");
};
