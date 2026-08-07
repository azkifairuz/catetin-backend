import sharp from "sharp";

import type { FinancialSummaryResult } from "../transaction/transaction.service";

const width = 890;
const height = 590;

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const formatCurrency = (value: number) => {
  if (Math.abs(value) >= 1_000_000) {
    const millions = value / 1_000_000;
    const formatted = Number.isInteger(millions)
      ? millions.toLocaleString("id-ID", { maximumFractionDigits: 0 })
      : millions.toLocaleString("id-ID", { maximumFractionDigits: 1 });

    return `Rp${formatted} jt`;
  }

  return `Rp${value.toLocaleString("id-ID")}`;
};

const formatFullCurrency = (value: number) =>
  `Rp${value.toLocaleString("id-ID")}`;

const formatPeriodTitle = (summary: FinancialSummaryResult) => {
  const startDate = new Date(`${summary.range.startDate}T00:00:00.000Z`);
  const endDate = new Date(`${summary.range.endDate}T00:00:00.000Z`);
  const sameMonth =
    startDate.getUTCFullYear() === endDate.getUTCFullYear() &&
    startDate.getUTCMonth() === endDate.getUTCMonth();

  if (sameMonth) {
    return `Summary ${startDate.toLocaleDateString("id-ID", {
      month: "long",
      timeZone: "UTC",
    })}`;
  }

  return `Summary ${summary.range.startDate} - ${summary.range.endDate}`;
};

const getTopWalletRows = (summary: FinancialSummaryResult) => {
  const walletTotals = new Map<string, number>();

  for (const item of summary.transactions) {
    if (item.type !== "expense") continue;

    const walletName = item.wallet?.name ?? "Tanpa Wallet";
    walletTotals.set(walletName, (walletTotals.get(walletName) ?? 0) + Number(item.amount ?? 0));
  }

  const rows = Array.from(walletTotals.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);

  if (rows.length > 0) return rows;

  return Object.entries(summary.stats.expenseByCategory)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);
};

const getDotColor = (index: number) => ["#48bf84", "#08090d", "#3aa7ee"][index] ?? "#8d95a3";

export const renderFinancialSummaryImage = async (
  summary: FinancialSummaryResult,
) => {
  const rows = getTopWalletRows(summary);
  const rowSvg = rows
    .map(([name, total], index) => {
      const y = 286 + index * 92;

      return `
        <rect x="76" y="${y - 36}" width="710" height="74" rx="28" fill="#ffffff" stroke="#eeeeee" stroke-width="2"/>
        <circle cx="112" cy="${y}" r="10" fill="${getDotColor(index)}"/>
        <text x="138" y="${y + 10}" class="rowLabel">${escapeXml(name)}</text>
        <text x="762" y="${y + 10}" text-anchor="end" class="rowValue">${escapeXml(formatFullCurrency(total))}</text>
      `;
    })
    .join("");
  const emptyRows =
    rows.length === 0
      ? `<text x="96" y="310" class="empty">Belum ada transaksi di periode ini.</text>`
      : "";
  const title = formatPeriodTitle(summary);
  const safeTitle = title.length > 26 ? `${title.slice(0, 23)}...` : title;
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>
        .title { font: 800 31px Arial, sans-serif; fill: #06070b; }
        .metricLabel { font: 800 25px Arial, sans-serif; fill: #73737e; }
        .income { font: 900 38px Arial, sans-serif; fill: #2f855f; }
        .expense { font: 900 38px Arial, sans-serif; fill: #06070b; }
        .rowLabel { font: 900 30px Arial, sans-serif; fill: #06070b; }
        .rowValue { font: 900 31px Arial, sans-serif; fill: #06070b; }
        .empty { font: 800 27px Arial, sans-serif; fill: #73737e; }
      </style>
      <rect width="${width}" height="${height}" fill="#f3faef"/>
      <rect x="2" y="-18" width="860" height="600" rx="64" fill="#f6fbf2" stroke="#e5e9df" stroke-width="2"/>
      <g filter="url(#shadow)">
        <rect x="43" y="-2" width="777" height="545" rx="36" fill="#ffffff"/>
      </g>
      <text x="77" y="58" class="title">${escapeXml(safeTitle)}</text>
      <rect x="76" y="92" width="344" height="134" rx="32" fill="#fbfbfc"/>
      <rect x="444" y="92" width="344" height="134" rx="32" fill="#fbfbfc"/>
      <text x="100" y="140" class="metricLabel">Pemasukan</text>
      <text x="100" y="191" class="income">${escapeXml(formatCurrency(summary.stats.totalIncome))}</text>
      <text x="468" y="140" class="metricLabel">Pengeluaran</text>
      <text x="468" y="191" class="expense">${escapeXml(formatCurrency(summary.stats.totalExpense))}</text>
      ${rowSvg}
      ${emptyRows}
      <defs>
        <filter id="shadow" x="31" y="-10" width="801" height="569" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
          <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.16"/>
        </filter>
      </defs>
    </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
};
