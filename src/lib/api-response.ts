export type ApiSuccess<TData = null> = {
  success: true;
  message: string;
  data: TData;
  error: null;
};

export type ApiError<TError = unknown> = {
  success: false;
  message: string;
  data: null;
  error: TError;
};

export type ApiResponse<TData = null, TError = unknown> =
  | ApiSuccess<TData>
  | ApiError<TError>;

export const successResponse = <TData>(
  message: string,
  data: TData,
): ApiSuccess<TData> => ({
  success: true,
  message,
  data,
  error: null,
});

export const errorResponse = <TError = { code: string }>(
  message: string,
  error: TError,
): ApiError<TError> => ({
  success: false,
  message,
  data: null,
  error,
});
