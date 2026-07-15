import { errorResponse } from "./api-response";

const jwtSecretValue = Bun.env.JWT_SECRET;

if (!jwtSecretValue) {
  throw new Error("JWT_SECRET is required");
}

export const jwtSecret: string = jwtSecretValue;

export const authError = errorResponse("Unauthorized", {
  code: "UNAUTHORIZED",
});

export const getAccountId = async (
  authorization: string | undefined,
  jwtVerify: (token: string) => Promise<false | { sub?: string }>,
) => {
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : authorization;

  if (!token) return null;

  const payload = await jwtVerify(token);
  if (!payload) return null;

  return payload.sub ?? null;
};
