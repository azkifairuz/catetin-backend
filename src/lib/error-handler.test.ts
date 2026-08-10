import { expect, test } from "bun:test";

import { handleApiError } from "./error-handler";

test("handleApiError handles an Error whose message is undefined", () => {
  const malformedError = new Error("temporary message");
  Object.defineProperty(malformedError, "message", {
    value: undefined,
  });

  let responseStatus: number | undefined;
  const response = handleApiError(malformedError, (status, body) => {
    responseStatus = status;
    return body;
  });

  expect(responseStatus).toBe(500);
  expect(response).toEqual({
    success: false,
    message: "Internal server error",
    data: null,
    error: {
      code: "INTERNAL_SERVER_ERROR",
    },
  });
});

test("handleApiError handles errors with an unsafe message getter", () => {
  const malformedError = Object.defineProperty({}, "message", {
    get() {
      throw new Error("message getter failed");
    },
  });

  let responseStatus: number | undefined;
  const response = handleApiError(malformedError, (status, body) => {
    responseStatus = status;
    return body;
  });

  expect(responseStatus).toBe(500);
  expect(response).toMatchObject({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
    },
  });
});

test("handleApiError preserves an Elysia not-found error", () => {
  let responseStatus: number | undefined;
  const response = handleApiError(
    new Error("NOT_FOUND"),
    (status, body) => {
      responseStatus = status;
      return body;
    },
    "app",
    "NOT_FOUND",
  );

  expect(responseStatus).toBe(404);
  expect(response).toEqual({
    success: false,
    message: "Route not found",
    data: null,
    error: {
      code: "NOT_FOUND",
    },
  });
});
