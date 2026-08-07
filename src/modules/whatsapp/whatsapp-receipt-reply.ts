import type {
  ReceiptItemFailure,
  ReceiptLineType,
} from "../transaction/transaction.service";
import { formatRupiah } from "./whatsapp-balance";

type ReceiptReplyResult = {
  line: {
    name: string;
    amount: number;
    lineType: ReceiptLineType;
    quantity?: number;
  };
};

export const formatReceiptBatchReply = (input: {
  merchant: string;
  results: ReceiptReplyResult[];
  failed: ReceiptItemFailure[];
  receiptTotal: number;
}) => {
  const itemResults = input.results.filter(
    (item) => item.line.lineType === "item",
  );
  const adjustmentResults = input.results.filter(
    (item) => item.line.lineType !== "item",
  );
  const lines = itemResults.map((item, index) => {
    const quantity = item.line.quantity ?? 1;
    const quantityLabel = quantity !== 1 ? ` ×${quantity}` : "";

    return `${index + 1}. ${item.line.name}${quantityLabel} — ${formatRupiah(item.line.amount)}`;
  });
  const adjustments = adjustmentResults.map(
    (item) =>
      `• ${item.line.name} — ${formatRupiah(item.line.amount)}`,
  );
  const failures = input.failed.map(
    (item) => `• ${item.source} ${item.index + 1}: ${item.message}`,
  );

  return [
    "Struk sudah dibaca dan dicatat per item.",
    `Merchant: ${input.merchant}`,
    `Total: ${formatRupiah(input.receiptTotal)}`,
    `Berhasil: ${itemResults.length} item${input.failed.length ? `, gagal: ${input.failed.length}` : ""}`,
    "",
    ...lines,
    ...(adjustments.length ? ["", "Penyesuaian:", ...adjustments] : []),
    ...(failures.length ? ["", "Gagal dibaca:", ...failures] : []),
  ].join("\n");
};
