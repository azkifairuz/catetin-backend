import { errorResponse } from "./api-response";
import { logApiEvent } from "./log-service";

type ErrorStatus = (code: number, response: unknown) => unknown;

const knownErrors: Record<
  string,
  {
    status: number;
    message: string;
    code: string;
    module?: string;
  }
> = {
  WALLET_NOT_FOUND: {
    status: 404,
    message: "Wallet not found",
    code: "WALLET_NOT_FOUND",
    module: "transaction",
  },
  PRIMARY_WALLET_NOT_FOUND: {
    status: 404,
    message: "Primary wallet not found",
    code: "PRIMARY_WALLET_NOT_FOUND",
    module: "transaction",
  },
  INVALID_AMOUNT: {
    status: 400,
    message: "Amount must be a positive number",
    code: "INVALID_AMOUNT",
    module: "transaction",
  },
  INVALID_DATE_RANGE: {
    status: 400,
    message: "Invalid summary date range",
    code: "INVALID_DATE_RANGE",
    module: "transaction",
  },
  SUMMARY_RANGE_TOO_LONG: {
    status: 400,
    message: "Summary date range cannot be more than 1 year",
    code: "SUMMARY_RANGE_TOO_LONG",
    module: "transaction",
  },
  GEMINI_API_KEY_NOT_FOUND: {
    status: 500,
    message: "Gemini API key is not configured",
    code: "GEMINI_API_KEY_NOT_FOUND",
  },
  GEMINI_GENERATE_FAILED: {
    status: 502,
    message: "Failed to generate response with Gemini",
    code: "GEMINI_GENERATE_FAILED",
  },
  GEMINI_EMPTY_OUTPUT: {
    status: 502,
    message: "Gemini returned invalid output",
    code: "GEMINI_INVALID_OUTPUT",
  },
};

const frameworkErrors: Record<
  string,
  {
    status: number;
    message: string;
    code: string;
  }
> = {
  NOT_FOUND: {
    status: 404,
    message: "Route not found",
    code: "NOT_FOUND",
  },
  PARSE: {
    status: 400,
    message: "Invalid request body",
    code: "INVALID_REQUEST_BODY",
  },
  VALIDATION: {
    status: 422,
    message: "Request validation failed",
    code: "VALIDATION_ERROR",
  },
  INVALID_COOKIE_SIGNATURE: {
    status: 400,
    message: "Invalid cookie signature",
    code: "INVALID_COOKIE_SIGNATURE",
  },
  INVALID_FILE_TYPE: {
    status: 422,
    message: "Invalid file type",
    code: "INVALID_FILE_TYPE",
  },
};

const getErrorMessage = (error: unknown): string => {
  if (error && typeof error === "object" && "message" in error) {
    try {
      const message = (error as { message?: unknown }).message;

      if (typeof message === "string") return message;
      if (message !== null && message !== undefined) return String(message);
    } catch {
      // Fall through when a custom error exposes an unsafe message getter.
    }
  }

  try {
    return String(error);
  } catch {
    return "Unknown error";
  }
};

const isDatabaseError = (error: unknown) => {
  const message = getErrorMessage(error);

  return (
    message.startsWith("Failed query:") ||
    message.includes("ECONNREFUSED") ||
    message.includes("database") ||
    message.includes("relation ") ||
    message.includes("column ")
  );
};

export const handleApiError = (
  error: unknown,
  status: ErrorStatus,
  module = "app",
  frameworkCode?: string | number,
) => {
  const message = getErrorMessage(error);

  const frameworkError =
    typeof frameworkCode === "string"
      ? frameworkErrors[frameworkCode]
      : undefined;

  if (frameworkError) {
    logApiEvent(frameworkError.status, frameworkError.message, {
      module,
      error: message,
    });

    return status(
      frameworkError.status,
      errorResponse(frameworkError.message, {
        code: frameworkError.code,
      }),
    );
  }

  if (error instanceof SyntaxError) {
    logApiEvent(502, "Invalid upstream response", {
      module,
      error: message,
    });

    return status(
      502,
      errorResponse("Invalid upstream response", {
        code: "INVALID_UPSTREAM_RESPONSE",
      }),
    );
  }

  const knownError = knownErrors[message];

  if (knownError) {
    logApiEvent(knownError.status, knownError.message, {
      module: knownError.module ?? module,
      error: message,
    });

    return status(
      knownError.status,
      errorResponse(knownError.message, {
        code: knownError.code,
      }),
    );
  }

  if (isDatabaseError(error)) {
    logApiEvent(500, "Database operation failed", {
      module,
      error: message,
    });

    return status(
      500,
      errorResponse("Database operation failed", {
        code: "DATABASE_ERROR",
      }),
    );
  }

  logApiEvent(500, "Internal server error", {
    module,
    error: message,
  });

  return status(
    500,
    errorResponse("Internal server error", {
      code: "INTERNAL_SERVER_ERROR",
    }),
  );
};
