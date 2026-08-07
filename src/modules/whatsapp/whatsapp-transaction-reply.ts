import type {
  AiTransactionFailure,
  GeminiTransactionOutput,
} from "../transaction/transaction.service";
import { formatRupiah } from "./whatsapp-balance";

type CreatedTransactionReplyItem = {
  generated: GeminiTransactionOutput;
  transaction: {
    name: string | null;
    type: "income" | "expense" | null;
    amount: string | null;
  };
  category: {
    name: string | null;
  };
};

export const formatTransactionBatchReply = (
  results: CreatedTransactionReplyItem[],
  failed: AiTransactionFailure[],
) => {
  if (results.length === 1 && failed.length === 0) {
    const item = results[0]!;

    return [
      "Transaksi sudah dicatat.",
      `Nama: ${item.transaction.name}`,
      `Tipe: ${item.transaction.type}`,
      `Nominal: ${formatRupiah(Number(item.transaction.amount ?? 0))}`,
      `Kategori: ${item.category.name}`,
    ].join("\n");
  }

  const header =
    results.length > 0
      ? `${results.length} transaksi berhasil dicatat${failed.length > 0 ? `, ${failed.length} gagal` : ""}.`
      : "Belum ada transaksi yang berhasil dicatat.";
  const successLines = results.map((item, index) =>
    [
      `${index + 1}. ${item.transaction.name ?? "Tanpa nama"}`,
      item.transaction.type ?? "unknown",
      formatRupiah(Number(item.transaction.amount ?? 0)),
      item.category.name ?? "Tanpa kategori",
    ].join(" — "),
  );
  const failureLines = failed.map(
    (item) => `• Item ${item.index + 1}: ${item.message}`,
  );

  return [
    header,
    ...(successLines.length > 0 ? ["", ...successLines] : []),
    ...(failureLines.length > 0
      ? ["", "Gagal dicatat:", ...failureLines]
      : []),
  ].join("\n");
};
