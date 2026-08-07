export type WhatsappCommand =
  | { name: "catat"; argument: string }
  | { name: "laporan"; argument: string }
  | { name: "budget"; argument: string }
  | { name: "sisa" }
  | { name: "saldo" }
  | { name: "help" }
  | { name: "unknown"; command: string };

export const parseWhatsappCommand = (text: string): WhatsappCommand | null => {
  const match = text.trim().match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;

  const command = match[1]?.toLowerCase() ?? "";
  const argument = match[2]?.trim() ?? "";

  if (command === "catat") return { name: "catat", argument };
  if (command === "laporan") return { name: "laporan", argument };
  if (command === "budget") return { name: "budget", argument };
  if (command === "sisa") return { name: "sisa" };
  if (command === "saldo") return { name: "saldo" };
  if (command === "help") return { name: "help" };

  return { name: "unknown", command };
};

export type BudgetCommandInput = {
  categoryName: string;
  amount: number;
  period: "harian" | "mingguan" | "bulanan" | "tahunan";
};

const periods = new Set<BudgetCommandInput["period"]>([
  "harian",
  "mingguan",
  "bulanan",
  "tahunan",
]);

export const parseBudgetCommandInput = (
  argument: string,
): BudgetCommandInput | null => {
  const tokens = argument.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  const lastToken = tokens[tokens.length - 1]?.toLowerCase() ?? "";
  const period = periods.has(lastToken as BudgetCommandInput["period"])
    ? (tokens.pop() as BudgetCommandInput["period"])
    : "bulanan";
  const amountToken = tokens.pop()?.replace(/\./g, "").replace(/,/g, ".");
  const amount = Number(amountToken);
  const categoryName = tokens.join(" ").trim();

  if (!categoryName || !Number.isFinite(amount) || amount <= 0) return null;

  return { categoryName, amount, period };
};

export const getWhatsappHelp = () =>
  [
    "*Command Catetin*",
    "",
    "• /catat <transaksi>",
    "  Contoh: /catat makan siang 25000",
    "• /laporan [periode]",
    "  Contoh: /laporan bulan ini",
    "• /budget",
    "  Melihat daftar budget.",
    "• /budget <kategori> <nominal> [periode]",
    "  Contoh: /budget Makanan 1000000 bulanan",
    "• /sisa",
    "  Melihat sisa seluruh budget aktif.",
    "• /help",
    "  Menampilkan panduan ini.",
    "",
    "Periode budget: harian, mingguan, bulanan, atau tahunan.",
    "Kamu juga tetap bisa mengirim kalimat biasa atau foto struk.",
  ].join("\n");
