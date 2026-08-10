import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { mkdir, rm } from "node:fs/promises";
import { parse, resolve, sep } from "node:path";

import { logApiEvent } from "../../lib/log-service";
import { saveUploadedImage } from "../../lib/upload";
import {
  getWhatsappNumberCandidates,
  normalizeWhatsappNumber,
} from "../../lib/whatsapp-number";
import {
  createReceiptTransactions,
  createTransactionsFromText,
  generateFinancialSummaryFromQuestion,
  generateTransactionsFromReceipt,
} from "../transaction/transaction.service";
import {
  formatBalanceReply,
  formatRupiah,
  isBalanceQuestion,
} from "./whatsapp-balance";
import {
  formatBudgetList,
  formatRemainingBudgets,
  getBudgetPeriodStart,
} from "./whatsapp-budget";
import {
  getWhatsappHelp,
  parseBudgetCommandInput,
  parseWhatsappCommand,
} from "./whatsapp-command";
import { renderFinancialSummaryImage } from "./summary-image";
import { UnregisteredReplyLimiter } from "./unregistered-reply-limiter";
import { resolveWhatsappIdentityJid } from "./whatsapp-identity";
import { whatsappRepository } from "./whatsapp.repository";
import { formatReceiptBatchReply } from "./whatsapp-receipt-reply";
import { formatTransactionBatchReply } from "./whatsapp-transaction-reply";

const logger = pino({ level: Bun.env.WA_LOG_LEVEL ?? "silent" });
const authDirectory = Bun.env.WA_AUTH_DIR ?? "storage/baileys-auth";
const reconnectDelayMs = Number(Bun.env.WA_RECONNECT_DELAY_MS ?? 5000);
const logoutTimeoutMs = 5000;
const configuredUnregisteredReplyLimit = Number(
  Bun.env.WA_UNREGISTERED_REPLY_LIMIT ?? 3,
);
const unregisteredReplyLimit =
  Number.isInteger(configuredUnregisteredReplyLimit) &&
  configuredUnregisteredReplyLimit > 0
    ? configuredUnregisteredReplyLimit
    : 3;
const unregisteredReplyLimiter = new UnregisteredReplyLimiter(
  unregisteredReplyLimit,
);

let isStartingWhatsappService = false;
let isResettingWhatsappSession = false;
let reconnectTimer: Timer | null = null;
let currentSocket: ReturnType<typeof makeWASocket> | null = null;
let currentQr: string | null = null;
let resetSessionPromise: Promise<WhatsappSessionResetResult> | null = null;

export type WhatsappSessionResetResult = {
  disconnected: boolean;
  logoutSucceeded: boolean;
  restarted: boolean;
};

type WhatsappTextReply = {
  type: "text";
  text: string;
};

type WhatsappImageReply = {
  type: "image";
  image: Buffer;
  caption?: string;
};

type WhatsappReply = WhatsappTextReply | WhatsappImageReply;

export const getWhatsappQr = () => currentQr;

const resetWhatsappAuthDirectory = async () => {
  const resolvedAuthDirectory = resolve(authDirectory);
  const filesystemRoot = parse(resolvedAuthDirectory).root;
  const workingDirectory = resolve(process.cwd());
  const isWorkingDirectoryInsideAuthDirectory = workingDirectory.startsWith(
    `${resolvedAuthDirectory}${sep}`,
  );

  if (
    resolvedAuthDirectory === filesystemRoot ||
    resolvedAuthDirectory === workingDirectory ||
    isWorkingDirectoryInsideAuthDirectory
  ) {
    throw new Error("WA_AUTH_DIRECTORY_UNSAFE");
  }

  await rm(resolvedAuthDirectory, { recursive: true, force: true });
  await mkdir(resolvedAuthDirectory, { recursive: true });
};

export const resetWhatsappSession = async () => {
  if (resetSessionPromise) return resetSessionPromise;

  resetSessionPromise = (async (): Promise<WhatsappSessionResetResult> => {
    isResettingWhatsappSession = true;
    currentQr = null;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const socket = currentSocket;
    currentSocket = null;
    let logoutSucceeded = false;

    if (socket) {
      const logoutAttempt = socket
        .logout("WhatsApp session reset from API")
        .then(() => ({ kind: "success" as const }))
        .catch((error: unknown) => ({ kind: "error" as const, error }));
      const logoutResult = await Promise.race([
        logoutAttempt,
        Bun.sleep(logoutTimeoutMs).then(() => ({ kind: "timeout" as const })),
      ]);

      logoutSucceeded = logoutResult.kind === "success";

      if (!logoutSucceeded) {
        logApiEvent(503, "WhatsApp remote logout did not complete", {
          module: "whatsapp",
          reason: logoutResult.kind,
          error:
            logoutResult.kind === "error"
              ? logoutResult.error instanceof Error
                ? logoutResult.error.message
                : String(logoutResult.error)
              : undefined,
        });

        await socket.end(undefined);
      }
    }

    await resetWhatsappAuthDirectory();

    logApiEvent(200, "WhatsApp auth session reset", {
      module: "whatsapp",
      disconnected: Boolean(socket),
      logoutSucceeded,
    });

    isResettingWhatsappSession = false;
    await startWhatsappService();

    return {
      disconnected: Boolean(socket),
      logoutSucceeded,
      restarted: true,
    };
  })().finally(() => {
    isResettingWhatsappSession = false;
    resetSessionPromise = null;
  });

  return resetSessionPromise;
};

const createProcessLogger = (
  remoteJid: string,
  data: Record<string, unknown> = {},
) => {
  const startedAt = Date.now();

  return (status: number | string, message: string, extra = {}) => {
    logApiEvent(status, message, {
      module: "whatsapp",
      remoteJid,
      elapsedMs: Date.now() - startedAt,
      ...data,
      ...extra,
    });
  };
};

const getPrimaryWhatsappNumber = (remoteJid: string) => {
  return normalizeWhatsappNumber(remoteJid) ?? "";
};

const getTextFromMessage = (message: any) => {
  return (
    message?.conversation ??
    message?.extendedTextMessage?.text ??
    message?.imageMessage?.caption ??
    message?.documentMessage?.caption ??
    ""
  ).trim();
};

const unwrapMessage = (message: any) => {
  return (
    message?.ephemeralMessage?.message ??
    message?.viewOnceMessage?.message ??
    message?.viewOnceMessageV2?.message ??
    message
  );
};

const getWhatsappAccount = async (remoteJid: string) => {
  const whatsappNumber = normalizeWhatsappNumber(remoteJid);

  if (!whatsappNumber) return null;

  const accounts = await whatsappRepository.findAccounts(
    getWhatsappNumberCandidates(whatsappNumber),
  );

  return (
    accounts.find((item) => item.whatsappNumber === whatsappNumber) ??
    accounts[0] ??
    null
  );
};

const parseRegisterCommand = (text: string) => {
  const trimmedText = text.trim();

  if (!trimmedText.toLowerCase().startsWith("/register")) return null;

  const [, username, password] = trimmedText.split(/\s+/);

  return {
    username,
    password,
  };
};

const getRegisterInstruction = () => {
  return [
    "Nomor WhatsApp ini belum terdaftar di Catetin.",
    "Daftar dulu dengan format:",
    "/register nama password",
    "",
    "Contoh:",
    "/register azki rahasia123",
  ].join("\n");
};

const registerWhatsappAccount = async (remoteJid: string, text: string) => {
  const command = parseRegisterCommand(text);

  if (!command) return null;

  if (!command.username || !command.password) {
    return {
      ok: false,
      message: getRegisterInstruction(),
    };
  }

  if (command.username.length < 3) {
    return {
      ok: false,
      message: "Username minimal 3 karakter.",
    };
  }

  if (command.password.length < 6) {
    return {
      ok: false,
      message: "Password minimal 6 karakter.",
    };
  }

  const whatsappNumber = getPrimaryWhatsappNumber(remoteJid);
  const existingAccount = await getWhatsappAccount(remoteJid);

  if (existingAccount) {
    return {
      ok: true,
      message: "Nomor WhatsApp ini sudah terdaftar. Kamu bisa langsung pakai Catetin.",
    };
  }

  const passwordHash = await Bun.password.hash(command.password);
  const result = await whatsappRepository.register({ username: command.username, whatsappNumber, password: passwordHash });

  logApiEvent(201, "WhatsApp account registered", {
    module: "whatsapp",
    accountId: result.account.accountId,
    walletId: result.wallet.walletId,
  });

  return {
    ok: true,
    message: [
      "Registrasi berhasil.",
      `Halo ${result.account.username}, akun Catetin kamu sudah aktif.`,
      `Wallet utama dibuat: ${result.wallet.name}.`,
      "",
      "Sekarang kamu bisa chat transaksi, kirim struk, atau minta summary keuangan.",
    ].join("\n"),
  };
};

const isSummaryQuestion = (text: string) => {
  return /\b(summary|summarize|ringkas|laporan|rekap|analisa|analisis)\b/i.test(
    text,
  );
};

const isTransactionText = (text: string) => {
  return /\b(abis|habis|keluar|duit|uang|beli|bayar|jajan|makan|minum|kopi|transfer|top up|gaji|bonus|terima uang|dapat uang|pengeluaran|pemasukan)\b/i.test(
    text,
  );
};

const generateFinancialChatReply = async (text: string) => {
  const apiKey = Bun.env.GEMINI_API_KEY ?? Bun.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_NOT_FOUND");
  }

  const model = Bun.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: [
                  "Kamu adalah asisten keuangan personal Catetin di WhatsApp.",
                  "Jawab natural, singkat, dan ramah dalam bahasa Indonesia.",
                  "Hanya jawab topik finansial, transaksi, budgeting, pengeluaran, pemasukan, tabungan, laporan, atau struk.",
                  "Jika pesan di luar topik finansial, tolak singkat dan arahkan user ke bantuan keuangan.",
                  `Pesan user: ${text}`,
                ].join("\n"),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error("GEMINI_GENERATE_FAILED");
  }

  const data = await response.json();
  const generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (typeof generatedText !== "string") {
    throw new Error("GEMINI_EMPTY_OUTPUT");
  }

  return generatedText.trim();
};

const handleTextMessage = async (
  accountId: string,
  text: string,
  logProcess = createProcessLogger("unknown"),
): Promise<WhatsappReply> => {
  const command = parseWhatsappCommand(text);
  let forceTransaction = false;
  let forceSummary = false;

  if (command?.name === "help") {
    return { type: "text", text: getWhatsappHelp() };
  }

  if (command?.name === "unknown") {
    return {
      type: "text",
      text: `Command /${command.command} tidak dikenal. Ketik /help untuk melihat command yang tersedia.`,
    };
  }

  if (command?.name === "budget") {
    if (!command.argument) {
      const budgets = await whatsappRepository.listBudgets(accountId);
      return { type: "text", text: formatBudgetList(budgets) };
    }

    const input = parseBudgetCommandInput(command.argument);
    if (!input) {
      return {
        type: "text",
        text: "Format budget belum sesuai.\n\nGunakan: /budget <kategori> <nominal> [periode]\nContoh: /budget Makanan 1000000 bulanan",
      };
    }

    const result = await whatsappRepository.saveBudget({ accountId, ...input });
    return {
      type: "text",
      text: `${result.updated ? "Budget diperbarui" : "Budget berhasil dibuat"}.\n${result.category.name}: ${formatRupiah(Number(result.budget?.amount ?? 0))}/${input.period}`,
    };
  }

  if (command?.name === "sisa") {
    const budgets = await whatsappRepository.listBudgets(accountId);
    if (budgets.length === 0) {
      return { type: "text", text: formatRemainingBudgets([], []) };
    }
    const starts = budgets.map((item) => getBudgetPeriodStart(item.period));
    const earliestStart = new Date(Math.min(...starts.map((item) => item.getTime())));
    const expenses = await whatsappRepository.listExpensesSince(accountId, earliestStart);
    return { type: "text", text: formatRemainingBudgets(budgets, expenses) };
  }

  if (command?.name === "catat") {
    if (!command.argument) {
      return { type: "text", text: "Tulis transaksi setelah /catat.\nContoh: /catat makan siang 25000" };
    }
    text = command.argument;
    forceTransaction = true;
  }

  if (command?.name === "laporan") {
    text = command.argument || "laporan keuangan bulan ini";
    forceSummary = true;
  }

  if (isBalanceQuestion(text)) {
    logProcess(102, "WhatsApp balance lookup started", {
      intent: "balance",
      text,
    });

    const wallets = await whatsappRepository.listBalances(accountId);
    const totalBalance = wallets.reduce(
      (total, item) => total + Number(item.balance ?? 0),
      0,
    );

    logProcess(200, "WhatsApp balance lookup finished", {
      intent: "balance",
      walletCount: wallets.length,
      totalBalance,
    });

    return {
      type: "text",
      text: formatBalanceReply(wallets),
    };
  }

  if (forceSummary || isSummaryQuestion(text)) {
    logProcess(102, "WhatsApp AI summary started", {
      intent: "summary",
      text,
    });

    const summary = await generateFinancialSummaryFromQuestion(accountId, text);

    logProcess(200, "WhatsApp AI summary finished", {
      intent: "summary",
    });

    logProcess(102, "WhatsApp summary image render started", {
      intent: "summary",
      range: summary.range,
      transactionCount: summary.transactions.length,
    });

    const image = await renderFinancialSummaryImage(summary);

    logProcess(200, "WhatsApp summary image render finished", {
      intent: "summary",
      imageSize: image.length,
    });

    return {
      type: "image",
      image,
      caption: summary.summary,
    };
  }

  if (forceTransaction || isTransactionText(text)) {
    logProcess(102, "WhatsApp AI transaction extraction started", {
      intent: "transaction",
      text,
    });

    const batch = await createTransactionsFromText(accountId, text);

    logProcess(200, "WhatsApp AI transaction extraction finished", {
      intent: "transaction",
      generated: batch.generated,
      counts: batch.counts,
    });

    if (batch.results.length === 0 && batch.firstCreateError) {
      throw batch.firstCreateError;
    }

    logProcess(
      batch.results.length > 0 ? 201 : 422,
      "WhatsApp transaction batch finished",
      {
        intent: "transaction",
        counts: batch.counts,
        transactionIds: batch.results.map(
          (item) => item.transaction.transactionId,
        ),
        failed: batch.failed,
      },
    );

    return {
      type: "text",
      text: formatTransactionBatchReply(batch.results, batch.failed),
    };
  }

  logProcess(102, "WhatsApp financial chat AI started", {
    intent: "financial-chat",
    text,
  });

  const reply = await generateFinancialChatReply(text);

  logProcess(200, "WhatsApp financial chat AI finished", {
    intent: "financial-chat",
  });

  return {
    type: "text",
    text: reply,
  };
};

const handleReceiptFile = async (
  accountId: string,
  file: File,
  isDocument = false,
  logProcess = createProcessLogger("unknown"),
) => {
  logProcess(102, "WhatsApp receipt save started", {
    intent: "receipt",
    fileType: file.type,
    fileSize: file.size,
  });

  const receiptImageUrl = await saveUploadedImage(
    "receipts",
    "receipts",
    accountId,
    file,
  );

  logProcess(200, "WhatsApp receipt save finished", {
    intent: "receipt",
    receiptImageUrl,
  });

  logProcess(102, "WhatsApp receipt OCR started", {
    intent: "receipt",
  });

  const generated = await generateTransactionsFromReceipt(file);

  logProcess(200, "WhatsApp receipt OCR finished", {
    intent: "receipt",
    generated,
  });

  logProcess(102, "WhatsApp receipt transaction insert started", {
    intent: "receipt",
  });

  const result = await createReceiptTransactions({
    accountId,
    receipt: generated,
    receiptImageUrl,
  });

  if (result.error || !result.reconciliation || result.results.length === 0) {
    logProcess(422, "WhatsApp receipt has no valid items", {
      intent: "receipt",
      error: result.error,
      failed: result.failed,
    });

    return isDocument
      ? "Dokumen berhasil diterima, tapi tidak ada item struk valid yang bisa dicatat."
      : "Gambar berhasil diterima, tapi tidak ada item struk valid yang bisa dicatat.";
  }

  logProcess(201, "WhatsApp receipt transactions inserted", {
    intent: "receipt",
    receiptId: result.receiptId,
    transactionIds: result.results.map(
      (item) => item.transaction.transactionId,
    ),
    walletId: result.wallet?.walletId,
    counts: result.counts,
    reconciliation: result.reconciliation,
    failed: result.failed,
  });

  return formatReceiptBatchReply({
    merchant: result.merchant,
    results: result.results,
    failed: result.failed,
    receiptTotal: result.reconciliation.receiptTotal,
  });
};

const createFileFromMessage = (
  buffer: Buffer,
  mimeType: string,
  filename: string,
) => {
  return new File([new Uint8Array(buffer)], filename, {
    type: mimeType,
  });
};

export const startWhatsappService = async () => {
  if (isStartingWhatsappService || currentSocket) {
    logApiEvent(200, "WhatsApp service already started", {
      module: "whatsapp",
    });
    return;
  }

  isStartingWhatsappService = true;
  let socket: ReturnType<typeof makeWASocket>;
  let saveCreds: () => Promise<void>;

  try {
    const authState = await useMultiFileAuthState(authDirectory);
    saveCreds = authState.saveCreds;
    socket = makeWASocket({
      auth: authState.state,
      logger,
      printQRInTerminal: false,
    });
    currentSocket = socket;
  } finally {
    isStartingWhatsappService = false;
  }

  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("connection.update", async (update) => {
    if (update.qr) {
      currentQr = update.qr;
      if (Bun.env.WA_PRINT_TERMINAL_QR === "true") {
        qrcode.generate(update.qr, { small: true });
      }
      logApiEvent(200, "WhatsApp QR generated", {
        module: "whatsapp",
        qrUrl: "/whatsapp/qr.svg",
      });
    }

    if (update.connection === "open") {
      currentQr = null;
      logApiEvent(200, "WhatsApp connected", {
        module: "whatsapp",
      });
    }

    if (update.connection === "close") {
      const statusCode = (update.lastDisconnect?.error as any)?.output
        ?.statusCode;
      const shouldReconnect =
        !isResettingWhatsappSession &&
        ![
          DisconnectReason.loggedOut,
          DisconnectReason.connectionReplaced,
        ].includes(statusCode);

      if (currentSocket === socket) {
        currentSocket = null;
      }

      logApiEvent(shouldReconnect ? 503 : 401, "WhatsApp disconnected", {
        module: "whatsapp",
        shouldReconnect,
        statusCode,
      });

      if (shouldReconnect && !reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          startWhatsappService().catch((error) => {
            isStartingWhatsappService = false;
            logApiEvent(500, "WhatsApp reconnect failed", {
              module: "whatsapp",
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }, reconnectDelayMs);
      }
    }
  });

  socket.ev.on("messages.upsert", async ({ messages }: { messages?: any[] }) => {
    for (const item of messages ?? []) {
      if (!item.message || item.key.fromMe || !item.key.remoteJid) continue;

      const remoteJid = item.key.remoteJid;
      const message = unwrapMessage(item.message);
      const text = getTextFromMessage(message);
      const messageType = message.imageMessage
        ? "image"
        : message.documentMessage
          ? "document"
          : text
            ? "text"
            : "unknown";
      const logProcess = createProcessLogger(remoteJid, {
        messageId: item.key.id,
        messageType,
        text: text || undefined,
      });

      logProcess(102, "WhatsApp message received");

      let identityJid: string | null = null;

      try {
        identityJid = await resolveWhatsappIdentityJid(
          item.key,
          socket.signalRepository.lidMapping.getPNForLID.bind(
            socket.signalRepository.lidMapping,
          ),
        );
      } catch (error) {
        logProcess(500, "WhatsApp identity resolution failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (!identityJid || !normalizeWhatsappNumber(identityJid)) {
        logProcess(422, "WhatsApp sender phone number is unavailable", {
          remoteJidAlt: item.key.remoteJidAlt,
          participant: item.key.participant,
          participantAlt: item.key.participantAlt,
        });

        await socket.sendMessage(remoteJid, {
          text: "Nomor WhatsApp kamu belum dapat dikenali. Silakan kirim ulang pesan beberapa saat lagi.",
        });
        continue;
      }

      const userAccount = await getWhatsappAccount(identityJid);

      if (!userAccount) {
        logProcess(102, "WhatsApp unregistered user detected");

        const isRegisterCommand = parseRegisterCommand(text) !== null;
        const replyLimit = isRegisterCommand
          ? null
          : unregisteredReplyLimiter.claim(identityJid);

        if (replyLimit && !replyLimit.allowed) {
          logProcess(429, "WhatsApp unregistered reply suppressed", {
            replyCount: replyLimit.replyCount,
            maxReplies: replyLimit.maxReplies,
          });

          continue;
        }

        const registerResult = await registerWhatsappAccount(identityJid, text);

        if (registerResult?.ok) {
          unregisteredReplyLimiter.clear(identityJid);
        }

        await socket.sendMessage(remoteJid, {
          text: registerResult?.message ?? getRegisterInstruction(),
        });

        logProcess(
          registerResult?.ok ? 201 : 401,
          "WhatsApp registration flow replied",
          {
            registered: registerResult?.ok ?? false,
            replyCount: replyLimit?.replyCount,
            maxReplies: replyLimit?.maxReplies,
          },
        );

        continue;
      }

      try {
        logProcess(200, "WhatsApp account matched", {
          accountId: userAccount.accountId,
        });

        if (parseRegisterCommand(text)) {
          await socket.sendMessage(remoteJid, {
            text: "Nomor WhatsApp ini sudah terdaftar. Kamu bisa langsung pakai Catetin.",
          });

          logProcess(200, "WhatsApp duplicate register command replied", {
            accountId: userAccount.accountId,
          });

          continue;
        }

        let reply: WhatsappReply;

        // await socket.sendMessage(remoteJid, {
        //   text: "Pesanmu sudah diterima, lagi aku proses ya.",
        // });

        logProcess(102, "WhatsApp processing acknowledgement sent", {
          accountId: userAccount.accountId,
        });

        if (message.imageMessage) {
          logProcess(102, "WhatsApp image download started", {
            accountId: userAccount.accountId,
            mimeType: message.imageMessage.mimetype,
          });

          const buffer = (await downloadMediaMessage(
            item,
            "buffer",
            {},
            {
              logger,
              reuploadRequest: socket.updateMediaMessage,
            },
          )) as Buffer;

          logProcess(200, "WhatsApp image download finished", {
            accountId: userAccount.accountId,
            size: buffer.length,
          });

          const file = createFileFromMessage(
            buffer,
            message.imageMessage.mimetype ?? "image/jpeg",
            "receipt.jpg",
          );

          reply = {
            type: "text",
            text: await handleReceiptFile(
              userAccount.accountId,
              file,
              false,
              logProcess,
            ),
          };
        } else if (message.documentMessage) {
          logProcess(102, "WhatsApp document download started", {
            accountId: userAccount.accountId,
            mimeType: message.documentMessage.mimetype,
            filename: message.documentMessage.fileName,
          });

          const buffer = (await downloadMediaMessage(
            item,
            "buffer",
            {},
            {
              logger,
              reuploadRequest: socket.updateMediaMessage,
            },
          )) as Buffer;

          logProcess(200, "WhatsApp document download finished", {
            accountId: userAccount.accountId,
            size: buffer.length,
          });

          const mimeType =
            message.documentMessage.mimetype ?? "application/octet-stream";
          const filename = message.documentMessage.fileName ?? "document";
          const file = createFileFromMessage(buffer, mimeType, filename);

          if (mimeType.startsWith("image/") || mimeType === "application/pdf") {
            reply = {
              type: "text",
              text: await handleReceiptFile(
                userAccount.accountId,
                file,
                true,
                logProcess,
              ),
            };
          } else if (mimeType.startsWith("text/")) {
            reply = await handleTextMessage(
              userAccount.accountId,
              new TextDecoder().decode(buffer),
              logProcess,
            );
          } else {
            logProcess(422, "WhatsApp unsupported document received", {
              accountId: userAccount.accountId,
              mimeType,
            });

            reply = {
              type: "text",
              text: "Dokumen diterima, tapi saat ini hanya struk gambar, PDF, atau dokumen teks yang bisa diproses.",
            };
          }
        } else if (text) {
          logProcess(102, "WhatsApp text intent routing started", {
            accountId: userAccount.accountId,
            isBalance: isBalanceQuestion(text),
            isSummary: isSummaryQuestion(text),
            isTransaction: isTransactionText(text),
          });

          reply = await handleTextMessage(
            userAccount.accountId,
            text,
            logProcess,
          );
        } else {
          logProcess(422, "WhatsApp empty unsupported message", {
            accountId: userAccount.accountId,
          });

          reply = {
            type: "text",
            text: "Aku bisa bantu catat transaksi dari chat, baca struk dari gambar/dokumen, atau bikin laporan keuangan.",
          };
        }

        logProcess(102, "WhatsApp final response sending", {
          accountId: userAccount.accountId,
        });

        if (reply.type === "image") {
          await socket.sendMessage(remoteJid, {
            image: reply.image,
            caption: reply.caption,
          });
        } else {
          await socket.sendMessage(remoteJid, {
            text: reply.text,
          });
        }

        logProcess(200, "WhatsApp final response sent", {
          accountId: userAccount.accountId,
        });
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : "UNKNOWN_ERROR";

        logProcess(500, "WhatsApp message failed", {
          accountId: userAccount.accountId,
          error: messageText,
        });

        await socket.sendMessage(remoteJid, {
          text: "Maaf, pesanmu belum berhasil diproses. Coba lagi sebentar ya.",
        });
      }
    }
  });

  return socket;
};
