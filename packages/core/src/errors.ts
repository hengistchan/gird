/**
 * Error utilities for the Gird MCP Server Manager
 */

export * from './types.js';

/**
 * Check if an error is a GirdError or GirdError-like
 */
export function isGirdError(error: unknown): error is Error & { code: string; statusCode: number } {
  return (
    error instanceof Error &&
    'code' in error &&
    'statusCode' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    typeof (error as { statusCode: unknown }).statusCode === 'number'
  );
}

/**
 * Get a safe error response for API responses
 */
export function getErrorResponse(error: unknown): {
  error: string;
  code: string;
  statusCode: number;
  details?: unknown;
} {
  if (isGirdError(error)) {
    return {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      details: (error as { details?: unknown }).details,
    };
  }

  if (error instanceof Error) {
    return {
      error: error.message,
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    };
  }

  return {
    error: 'An unknown error occurred',
    code: 'UNKNOWN_ERROR',
    statusCode: 500,
  };
}

/**
 * Wrap an error with additional context
 */
export function wrapError(error: unknown, message: string, code?: string): Error & { code?: string; statusCode?: number } {
  const baseError = error instanceof Error ? error : new Error(String(error));
  const wrapped = new Error(`${message}: ${baseError.message}`);
  wrapped.name = baseError.name;

  // Stack can be undefined, so only copy if present
  if (baseError.stack) {
    wrapped.stack = baseError.stack;
  }

  if (isGirdError(error)) {
    (wrapped as { code?: string }).code = code ?? error.code;
    (wrapped as { statusCode?: number }).statusCode = error.statusCode;
  } else if (code) {
    (wrapped as { code?: string }).code = code;
  }

  return wrapped as Error & { code?: string; statusCode?: number };
}
