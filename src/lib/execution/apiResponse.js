import { NextResponse } from "next/server";
import { ExecutionError, ExecutionErrorCodes } from "./errors.js";

/**
 * Standardized JSON success response.
 *
 * @param {any} data
 * @param {number} [status=200]
 * @returns {NextResponse}
 */
export function jsonSuccess(data, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}

/**
 * Standardized JSON error response.
 *
 * @param {any} error
 * @returns {NextResponse}
 */
export function jsonError(error) {
  if (error instanceof ExecutionError) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details || null,
      },
      { status: error.status || error.statusCode || 400 }
    );
  }

  const message = error?.message || "An unexpected execution error occurred";
  return NextResponse.json(
    {
      success: false,
      error: message,
      code: ExecutionErrorCodes.SANDBOX_ERROR,
      details: process.env.NODE_ENV === "development" ? error?.stack : null,
    },
    { status: 500 }
  );
}
