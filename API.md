# Catetin API Documentation

Base URL:

```text
http://localhost:3000
```

## Response Format

Success:

```json
{
  "success": true,
  "message": "Message",
  "data": {},
  "error": null
}
```

Error:

```json
{
  "success": false,
  "message": "Message",
  "data": null,
  "error": {
    "code": "ERROR_CODE"
  }
}
```

Protected endpoints require:

```http
Authorization: Bearer <token>
```

## Health

### GET `/`

Returns plain text.

Response `200`:

```text
Hello Elysia
```

### GET `/health`

Response `200`:

```json
{
  "status": "ok"
}
```

## Dashboard

### GET `/dashboard`

Returns dashboard summary for the authenticated account. Defaults to the current month.

Query params:

```text
startDate=2026-07-01
endDate=2026-07-31
limit=5
```

Response `200`:

```json
{
  "success": true,
  "message": "Dashboard fetched",
  "data": {
    "range": {
      "startDate": "2026-07-01",
      "endDate": "2026-07-31"
    },
    "summary": {
      "totalBalance": 1500000,
      "totalIncome": 3000000,
      "totalExpense": 1200000,
      "netCashflow": 1800000,
      "transactionCount": 12,
      "walletCount": 2
    },
    "wallets": [
      {
        "walletId": 1,
        "name": "Main Wallet",
        "balance": "1500000",
        "isPrimary": true
      }
    ],
    "walletActivities": [
      {
        "walletId": 1,
        "name": "Main Wallet",
        "income": 3000000,
        "expense": 1200000,
        "transactionCount": 12
      }
    ],
    "topExpenseCategories": [
      {
        "categoryId": 1,
        "name": "Makanan",
        "icon": null,
        "total": 500000,
        "transactionCount": 5,
        "percentage": 41.67
      }
    ],
    "recentTransactions": [
      {
        "transactionId": 1,
        "type": "expense",
        "amount": "25000",
        "name": "Kopi",
        "reportDate": "2026-07-16T00:00:00.000Z",
        "category": {},
        "wallet": {}
      }
    ]
  },
  "error": null
}
```

## Auth

WhatsApp numbers are normalized before lookup and storage. Indonesian inputs
such as `081234567890`, `81234567890`, and `6281234567890` are stored in the
canonical `+6281234567890` format. Login accepts the canonical and legacy
formats.

### POST `/auth/register`

Create account and primary wallet.

Request `application/json`:

```json
{
  "whatsappNumber": "+628123456789",
  "username": "azki",
  "password": "secret123"
}
```

Response `201`:

```json
{
  "success": true,
  "message": "Account registered",
  "data": {
    "account": {
      "accountId": "uuid",
      "username": "azki",
      "whatsappNumber": "+628123456789",
      "createdAt": "2026-07-16T00:00:00.000Z"
    },
    "wallet": {
      "walletId": 1,
      "name": "Main Wallet",
      "balance": "0",
      "isPrimary": true
    }
  },
  "error": null
}
```

Errors:

```json
{
  "success": false,
  "message": "WhatsApp number already registered",
  "data": null,
  "error": {
    "code": "WHATSAPP_NUMBER_ALREADY_REGISTERED"
  }
}
```

### POST `/auth/login`

Request `application/json`:

```json
{
  "whatsappNumber": "+628123456789",
  "username": "azki",
  "password": "secret123"
}
```

Response `200`:

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "jwt-token",
    "account": {
      "accountId": "uuid",
      "username": "azki",
      "whatsappNumber": "+628123456789",
      "createdAt": "2026-07-16T00:00:00.000Z"
    }
  },
  "error": null
}
```

Errors:

```json
{
  "success": false,
  "message": "Invalid credentials",
  "data": null,
  "error": {
    "code": "INVALID_CREDENTIALS"
  }
}
```

## Wallets

### GET `/wallets`

Response `200`:

```json
{
  "success": true,
  "message": "Wallets fetched",
  "data": [
    {
      "walletId": 1,
      "accountId": "uuid",
      "name": "Main Wallet",
      "balance": "100000",
      "isPrimary": true
    }
  ],
  "error": null
}
```

### GET `/wallets/:walletId`

Response `200`:

```json
{
  "success": true,
  "message": "Wallet fetched",
  "data": {
    "walletId": 1,
    "accountId": "uuid",
    "name": "Main Wallet",
    "balance": "100000",
    "isPrimary": true
  },
  "error": null
}
```

### POST `/wallets`

Request `application/json`:

```json
{
  "name": "Cash",
  "balance": "100000",
  "isPrimary": true
}
```

Notes:

- `balance` optional, default `"0"`.
- First wallet is primary by default.
- If `isPrimary` is `true`, other wallets become non-primary.

Response `201`:

```json
{
  "success": true,
  "message": "Wallet created",
  "data": {
    "walletId": 2,
    "accountId": "uuid",
    "name": "Cash",
    "balance": "100000",
    "isPrimary": true
  },
  "error": null
}
```

### PATCH `/wallets/:walletId`

Request `application/json`:

```json
{
  "name": "Bank BCA",
  "balance": "250000",
  "isPrimary": true
}
```

Response `200`:

```json
{
  "success": true,
  "message": "Wallet updated",
  "data": {
    "walletId": 2,
    "accountId": "uuid",
    "name": "Bank BCA",
    "balance": "250000",
    "isPrimary": true
  },
  "error": null
}
```

### DELETE `/wallets/:walletId`

Response `200`:

```json
{
  "success": true,
  "message": "Wallet deleted",
  "data": {
    "walletId": 2,
    "accountId": "uuid",
    "name": "Bank BCA",
    "balance": "250000",
    "isPrimary": true
  },
  "error": null
}
```

Wallet errors:

```json
{
  "success": false,
  "message": "Wallet not found",
  "data": null,
  "error": {
    "code": "WALLET_NOT_FOUND"
  }
}
```

```json
{
  "success": false,
  "message": "Balance must be a positive number or zero",
  "data": null,
  "error": {
    "code": "INVALID_BALANCE"
  }
}
```

## Categories

### GET `/categories`

Response `200`:

```json
{
  "success": true,
  "message": "Categories fetched",
  "data": [
    {
      "categoryId": 1,
      "accountId": "uuid",
      "name": "Makanan",
      "icon": "/uploads/categories/file.png"
    }
  ],
  "error": null
}
```

### GET `/categories/:categoryId`

Response `200`:

```json
{
  "success": true,
  "message": "Category fetched",
  "data": {
    "categoryId": 1,
    "accountId": "uuid",
    "name": "Makanan",
    "icon": "/uploads/categories/file.png"
  },
  "error": null
}
```

### POST `/categories`

Request `multipart/form-data`:

```text
name=Makanan
icon=@/path/to/icon.png
```

`icon` is optional image file, max 2 MB.

Response `201`:

```json
{
  "success": true,
  "message": "Category created",
  "data": {
    "categoryId": 1,
    "accountId": "uuid",
    "name": "Makanan",
    "icon": "/uploads/categories/file.png"
  },
  "error": null
}
```

### PATCH `/categories/:categoryId`

Request `multipart/form-data`:

```text
name=Minuman
icon=@/path/to/new-icon.png
```

Response `200`:

```json
{
  "success": true,
  "message": "Category updated",
  "data": {
    "categoryId": 1,
    "accountId": "uuid",
    "name": "Minuman",
    "icon": "/uploads/categories/new-file.png"
  },
  "error": null
}
```

### DELETE `/categories/:categoryId`

Response `200`:

```json
{
  "success": true,
  "message": "Category deleted",
  "data": {
    "categoryId": 1,
    "accountId": "uuid",
    "name": "Minuman",
    "icon": "/uploads/categories/new-file.png"
  },
  "error": null
}
```

Category errors:

```json
{
  "success": false,
  "message": "Category not found",
  "data": null,
  "error": {
    "code": "CATEGORY_NOT_FOUND"
  }
}
```

```json
{
  "success": false,
  "message": "Category already exists",
  "data": null,
  "error": {
    "code": "CATEGORY_ALREADY_EXISTS"
  }
}
```

## Transactions

### GET `/transactions`

Response `200`:

```json
{
  "success": true,
  "message": "Transactions fetched",
  "data": [
    {
      "transactionId": 1,
      "accountId": "uuid",
      "walletId": 1,
      "categoryId": 1,
      "budgetId": null,
      "type": "expense",
      "amount": "20000",
      "name": "Kopi",
      "isAiGenerated": false,
      "receiptImageUrl": "/uploads/receipts/file.jpg",
      "reportDate": "2026-07-16T00:00:00.000Z",
      "createdAt": "2026-07-16T00:00:00.000Z",
      "updatedAt": null,
      "wallet": {},
      "category": {},
      "budget": null
    }
  ],
  "error": null
}
```

### POST `/transactions`

Create transaction manually. Category is auto-created if `categoryName` does not exist. If `walletId` is not sent, primary wallet is used.

Request `multipart/form-data`:

```text
type=expense
amount=20000
name=Kopi
categoryName=Minuman
walletId=1
budgetId=1
isAiGenerated=false
reportDate=2026-07-16
receiptImage=@/path/to/receipt.jpg
```

Required:

- `type`: `income` or `expense`
- `amount`: positive number as string
- `name`
- `categoryName`

Optional:

- `walletId`
- `budgetId`
- `isAiGenerated`
- `reportDate`
- `receiptImage`, image file max 5 MB

Response `201`:

```json
{
  "success": true,
  "message": "Transaction created",
  "data": {
    "transaction": {
      "transactionId": 1,
      "accountId": "uuid",
      "walletId": 1,
      "categoryId": 1,
      "budgetId": null,
      "type": "expense",
      "amount": "20000",
      "name": "Kopi",
      "isAiGenerated": false,
      "receiptImageUrl": "/uploads/receipts/file.jpg",
      "reportDate": "2026-07-16T00:00:00.000Z",
      "createdAt": "2026-07-16T00:00:00.000Z",
      "updatedAt": null
    },
    "category": {
      "categoryId": 1,
      "accountId": "uuid",
      "name": "Minuman",
      "icon": null
    },
    "wallet": {
      "walletId": 1,
      "name": "Main Wallet",
      "balance": "80000",
      "isPrimary": true
    }
  },
  "error": null
}
```

### POST `/transactions/ai-generate`

Generate and create up to 10 transactions from natural text. Valid items are
stored even when another item is invalid.

Request `application/json`:

```json
{
  "text": "aku abis beli kopi 25.000 terus makan soto 20.000"
}
```

Response `201`:

```json
{
  "success": true,
  "message": "Transactions generated",
  "data": {
    "input": "aku abis beli kopi 25.000 terus makan soto 20.000",
    "results": [
      {
        "index": 0,
        "generated": {
          "type": "expense",
          "amount": 25000,
          "name": "Kopi",
          "categoryName": "Minuman"
        },
        "transaction": {},
        "category": {},
        "wallet": {}
      },
      {
        "index": 1,
        "generated": {
          "type": "expense",
          "amount": 20000,
          "name": "Soto",
          "categoryName": "Makanan"
        },
        "transaction": {},
        "category": {},
        "wallet": {}
      }
    ],
    "failed": [],
    "counts": {
      "detected": 2,
      "created": 2,
      "adjustments": 0,
      "failed": 0
    }
  },
  "error": null
}
```

For a single successful transaction, the legacy `generated`, `transaction`,
`category`, and `wallet` fields are also included. A partial result returns
`201`; if no item is valid, the endpoint returns `422`.

### POST `/transactions/ai-summary`

Generate financial summary from user question. Date range is extracted by AI and validated by backend. Maximum range is 366 days.

Request `application/json`:

```json
{
  "text": "summary transaksi gua tanggal 1 juli sampai 15 juli"
}
```

Response `200`:

```json
{
  "success": true,
  "message": "Financial summary generated",
  "data": {
    "question": "summary transaksi gua tanggal 1 juli sampai 15 juli",
    "range": {
      "startDate": "2026-07-01",
      "endDate": "2026-07-15"
    },
    "summary": "Pada periode ini...",
    "stats": {
      "totalIncome": 5000000,
      "totalExpense": 1200000,
      "expenseByCategory": {
        "Makanan": 300000
      },
      "netCashflow": 3800000,
      "transactionCount": 10
    },
    "transactions": []
  },
  "error": null
}
```

### POST `/transactions/ocr-receipt`

Read a receipt image/document and create one expense transaction per item.
All rows from the same receipt share a `receiptId`. Tax and fees are positive
expense rows; discounts are negative expense rows. At most 50 item rows are
processed from one receipt.

Request `multipart/form-data`:

```text
receiptImage=@/path/to/receipt.jpg
walletId=1
budgetId=1
reportDate=2026-07-16
```

Required:

- `receiptImage`, image file max 5 MB

Optional:

- `walletId`
- `budgetId`
- `reportDate`

Response `201`:

```json
{
  "success": true,
  "message": "Receipt OCR transactions created",
  "data": {
    "generated": {
      "merchant": "Indomaret",
      "totalAmount": 45000,
      "reportDate": "2026-07-16",
      "items": [
        {
          "name": "Rokok",
          "quantity": 1,
          "unitPrice": 25000,
          "amount": 25000,
          "categoryName": "Rokok"
        },
        {
          "name": "Roti",
          "quantity": 2,
          "unitPrice": 10000,
          "amount": 20000,
          "categoryName": "Makanan"
        }
      ],
      "adjustments": []
    },
    "receiptId": "0efead3b-27b3-4fe3-9d21-b6d60b722ba8",
    "merchant": "Indomaret",
    "results": [
      {
        "line": {
          "name": "Rokok",
          "amount": 25000,
          "categoryName": "Rokok",
          "lineType": "item",
          "quantity": 1,
          "unitPrice": 25000
        },
        "transaction": {},
        "category": {}
      }
    ],
    "failed": [],
    "counts": {
      "detected": 2,
      "created": 2,
      "failed": 0
    },
    "reconciliation": {
      "receiptTotal": 45000,
      "itemTotal": 45000,
      "adjustmentTotal": 0,
      "recordedTotal": 45000
    },
    "wallet": {}
  },
  "error": null
}
```

Each created transaction includes `receiptId`, `receiptMerchant`,
`receiptLineType`, `quantity`, and `unitPrice`. Invalid items are reported in
`failed`; valid items are still saved and the reconciliation row keeps the
recorded total equal to the receipt total. If no item is valid, the endpoint
returns `422` without changing the wallet.

Transaction errors:

```json
{
  "success": false,
  "message": "Amount must be a positive number",
  "data": null,
  "error": {
    "code": "INVALID_AMOUNT"
  }
}
```

```json
{
  "success": false,
  "message": "Primary wallet not found",
  "data": null,
  "error": {
    "code": "PRIMARY_WALLET_NOT_FOUND"
  }
}
```

```json
{
  "success": false,
  "message": "Wallet not found",
  "data": null,
  "error": {
    "code": "WALLET_NOT_FOUND"
  }
}
```

```json
{
  "success": false,
  "message": "AI output is not a valid transaction",
  "data": null,
  "error": {
    "code": "INVALID_AI_OUTPUT",
    "output": {}
  }
}
```

```json
{
  "success": false,
  "message": "OCR output is not a valid transaction",
  "data": null,
  "error": {
    "code": "INVALID_OCR_OUTPUT",
    "output": {}
  }
}
```

```json
{
  "success": false,
  "message": "Summary date range cannot be more than 1 year",
  "data": null,
  "error": {
    "code": "SUMMARY_RANGE_TOO_LONG"
  }
}
```

```json
{
  "success": false,
  "message": "Gemini API key is not configured",
  "data": null,
  "error": {
    "code": "GEMINI_API_KEY_NOT_FOUND"
  }
}
```

```json
{
  "success": false,
  "message": "Failed to generate transaction with Gemini",
  "data": null,
  "error": {
    "code": "GEMINI_GENERATE_FAILED"
  }
}
```

```json
{
  "success": false,
  "message": "Gemini returned invalid output",
  "data": null,
  "error": {
    "code": "GEMINI_INVALID_OUTPUT"
  }
}
```

## Uploads

### GET `/uploads/categories/:filename`

Returns category icon file.

Response `200`: file binary.

Response `404`:

```text
Not found
```

### GET `/uploads/receipts/:filename`

Returns receipt image file.

Response `200`: file binary.

Response `404`:

```text
Not found
```

## Logs

### GET `/logs`

Returns simple HTML log viewer with refresh button and search input.

Response `200`: HTML.

### GET `/logs/data`

Query params:

- `search`, optional string

Response `200`:

```json
{
  "success": true,
  "message": "Logs fetched",
  "data": [
    {
      "timestamp": "2026-07-16T08:31:00.000Z",
      "status": 200,
      "message": "WhatsApp message handled",
      "data": {
        "module": "whatsapp"
      }
    }
  ],
  "error": null
}
```

## WhatsApp Baileys Service

WhatsApp integration is not an HTTP endpoint. It starts with the app when enabled.

Environment:

```env
WA_ENABLED=true
WA_AUTH_DIR=storage/baileys-auth
WA_LOG_LEVEL=silent
```

Start:

```bash
bun run dev
```

Scan QR code shown in terminal.

Supported WhatsApp messages:

- Text transaction: `aku beli kopi 20.000`
- Multiple text transactions: `aku beli kopi 25k terus makan soto 20k`
- Receipt image: image message
- Receipt document: image/PDF document
- Text document
- Financial summary: `summary transaksi bulan ini`
- Register from WhatsApp:

```text
/register nama password
```

Unregistered users must register first. User identity is detected from sender WhatsApp number and matched with `account.whatsappNumber`.

## cURL Examples

Login:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"whatsappNumber":"+628123456789","username":"azki","password":"secret123"}'
```

Create category with icon:

```bash
curl -X POST http://localhost:3000/categories \
  -H "Authorization: Bearer <token>" \
  -F "name=Makanan" \
  -F "icon=@/path/to/icon.png"
```

Create transaction with receipt:

```bash
curl -X POST http://localhost:3000/transactions \
  -H "Authorization: Bearer <token>" \
  -F "type=expense" \
  -F "amount=20000" \
  -F "name=Kopi" \
  -F "categoryName=Minuman" \
  -F "receiptImage=@/path/to/receipt.jpg"
```

AI generate transaction:

```bash
curl -X POST http://localhost:3000/transactions/ai-generate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"aku abis beli kopi 20.000"}'
```

OCR receipt:

```bash
curl -X POST http://localhost:3000/transactions/ocr-receipt \
  -H "Authorization: Bearer <token>" \
  -F "receiptImage=@/path/to/receipt.jpg"
```

AI summary:

```bash
curl -X POST http://localhost:3000/transactions/ai-summary \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"summary transaksi bulan ini"}'
```
