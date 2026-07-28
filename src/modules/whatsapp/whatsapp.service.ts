import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { desc, eq, inArray } from "drizzle-orm";
import pino from "pino";
import qrcode from "qrcode-terminal";

import { db } from "../../db";
import { account, wallet } from "../../db/schema";
import { logApiEvent } from "../../lib/log-service";
import { saveUploadedImage } from "../../lib/upload";
import {
  createTransaction,
  generateFinancialSummaryFromQuestion,
  generateTransactionFromReceipt,
  generateTransactionFromText,
} from "../transaction/transaction.routes";
import {
  formatBalanceReply,
  isBalanceQuestion,
} from "./whatsapp-balance";
import { renderFinancialSummaryImage } from "./summary-image";

const logger = pino({ level: Bun.env.WA_LOG_LEVEL ?? "silent" });
const authDirectory = Bun.env.WA_AUTH_DIR ?? "storage/baileys-auth";
const reconnectDelayMs = Number(Bun.env.WA_RECONNECT_DELAY_MS ?? 5000);

let isStartingWhatsappService = false;
let reconnectTimer: Timer | null = null;
let currentSocket: ReturnType<typeof makeWASocket> | null = null;
let currentQr: string | null = null;

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

const normalizeWhatsappNumber = (jid: string) => {
  return jid.split("@")[0]?.replace(/\D/g, "") ?? "";
};

const getPrimaryWhatsappNumber = (remoteJid: string) => {
  const whatsappNumber = normalizeWhatsappNumber(remoteJid);

  return whatsappNumber ? `+${whatsappNumber}` : "";
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

  const numberCandidates = [
    whatsappNumber,
    `+${whatsappNumber}`,
    whatsappNumber.startsWith("62") ? `0${whatsappNumber.slice(2)}` : "",
  ].filter(Boolean);

  return db.query.account.findFirst({
    where: inArray(account.whatsappNumber, numberCandidates),
    columns: {
      accountId: true,
      whatsappNumber: true,
      username: true,
    },
  });
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
  const result = await db.transaction(async (tx) => {
    const [createdAccount] = await tx
      .insert(account)
      .values({
        username: command.username,
        whatsappNumber,
        password: passwordHash,
      })
      .returning({
        accountId: account.accountId,
        username: account.username,
        whatsappNumber: account.whatsappNumber,
      });

    if (!createdAccount) {
      throw new Error("WA_REGISTER_ACCOUNT_FAILED");
    }

    const [createdWallet] = await tx
      .insert(wallet)
      .values({
        accountId: createdAccount.accountId,
        name: "Main Wallet",
        balance: "0",
        isPrimary: true,
      })
      .returning({
        walletId: wallet.walletId,
        name: wallet.name,
      });

    if (!createdWallet) {
      throw new Error("WA_REGISTER_WALLET_FAILED");
    }

    return {
      account: createdAccount,
      wallet: createdWallet,
    };
  });

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
  if (isBalanceQuestion(text)) {
    logProcess(102, "WhatsApp balance lookup started", {
      intent: "balance",
      text,
    });

    const wallets = await db.query.wallet.findMany({
      where: eq(wallet.accountId, accountId),
      orderBy: desc(wallet.isPrimary),
      columns: {
        name: true,
        balance: true,
        isPrimary: true,
      },
    });
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

  if (isSummaryQuestion(text)) {
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

  if (isTransactionText(text)) {
    logProcess(102, "WhatsApp AI transaction extraction started", {
      intent: "transaction",
      text,
    });

    const generated = await generateTransactionFromText(text);

    logProcess(200, "WhatsApp AI transaction extraction finished", {
      intent: "transaction",
      generated,
    });

    logProcess(102, "WhatsApp transaction insert started", {
      intent: "transaction",
    });

    const result = await createTransaction({
      accountId,
      type: generated.type,
      amount: generated.amount.toString(),
      name: generated.name,
      categoryName: generated.categoryName,
      isAiGenerated: true,
      reportDate: generated.reportDate,
    });

    logProcess(201, "WhatsApp transaction insert finished", {
      intent: "transaction",
      transactionId: result.transaction.transactionId,
      walletId: result.wallet?.walletId,
      categoryId: result.category.categoryId,
    });

    return {
      type: "text",
      text: [
        "Transaksi sudah dicatat.",
        `Nama: ${result.transaction.name}`,
        `Tipe: ${result.transaction.type}`,
        `Nominal: Rp${Number(result.transaction.amount ?? 0).toLocaleString("id-ID")}`,
        `Kategori: ${result.category.name}`,
      ].join("\n"),
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

  const generated = await generateTransactionFromReceipt(file);

  logProcess(200, "WhatsApp receipt OCR finished", {
    intent: "receipt",
    generated,
  });

  if (
    generated.type !== "expense" ||
    !Number.isFinite(Number(generated.amount)) ||
    Number(generated.amount) <= 0 ||
    !generated.name ||
    !generated.categoryName
  ) {
    return isDocument
      ? "Dokumen berhasil diterima, tapi belum bisa dibaca sebagai transaksi struk."
      : "Gambar berhasil diterima, tapi belum bisa dibaca sebagai struk transaksi.";
  }

  logProcess(102, "WhatsApp receipt transaction insert started", {
    intent: "receipt",
  });

  const result = await createTransaction({
    accountId,
    type: "expense",
    amount: generated.amount.toString(),
    name: generated.name,
    categoryName: generated.categoryName,
    isAiGenerated: true,
    receiptImageUrl,
    reportDate: generated.reportDate,
  });

  logProcess(201, "WhatsApp receipt transaction insert finished", {
    intent: "receipt",
    transactionId: result.transaction.transactionId,
    walletId: result.wallet?.walletId,
    categoryId: result.category.categoryId,
  });

  return [
    "Struk sudah dibaca dan transaksi dicatat.",
    `Nama: ${result.transaction.name}`,
    `Nominal: Rp${Number(result.transaction.amount ?? 0).toLocaleString("id-ID")}`,
    `Kategori: ${result.category.name}`,
  ].join("\n");
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
      const shouldReconnect = ![
        DisconnectReason.loggedOut,
        DisconnectReason.connectionReplaced,
      ].includes(statusCode);

      currentSocket = null;

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

      const userAccount = await getWhatsappAccount(remoteJid);

      if (!userAccount) {
        logProcess(102, "WhatsApp unregistered user detected");

        const registerResult = await registerWhatsappAccount(remoteJid, text);

        await socket.sendMessage(remoteJid, {
          text: registerResult?.message ?? getRegisterInstruction(),
        });

        logProcess(
          registerResult?.ok ? 201 : 401,
          "WhatsApp registration flow replied",
          {
            registered: registerResult?.ok ?? false,
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

        await socket.sendMessage(remoteJid, {
          text: "Pesanmu sudah diterima, lagi aku proses ya.",
        });

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
