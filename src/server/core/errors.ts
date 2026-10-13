/**
 * Application errors with stable codes. Adapters (route handlers, server
 * actions) map these to HTTP statuses / form errors. Never leak raw database
 * errors to clients.
 */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INVALID_STATE"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INVALID_STATE: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { details?: unknown; fieldErrors?: Record<string, string[]> } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = opts.details;
    this.fieldErrors = opts.fieldErrors;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export const unauthenticated = (msg = "Please sign in to continue.") => new AppError("UNAUTHENTICATED", msg);
export const forbidden = (msg = "You do not have permission to do this.") => new AppError("PERMISSION_DENIED", msg);
export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const conflict = (msg: string) => new AppError("CONFLICT", msg);
export const invalidState = (msg: string) => new AppError("INVALID_STATE", msg);

export function validationFailed(fieldErrors: Record<string, string[]>, msg = "Please correct the highlighted fields.") {
  return new AppError("VALIDATION_FAILED", msg, { fieldErrors });
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
