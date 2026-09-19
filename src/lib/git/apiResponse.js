import { NextResponse } from "next/server";
import { GitError, GitErrorCodes } from "./errors.js";

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
  if (error instanceof GitError) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details || null,
      },
      { status: error.statusCode }
    );
  }

  const message = error?.message || "An unexpected Git operation error occurred";
  return NextResponse.json(
    {
      success: false,
      error: message,
      code: GitErrorCodes.GIT_OPERATION_FAILED,
      details: process.env.NODE_ENV === "development" ? error?.stack : null,
    },
    { status: 500 }
  );
}
