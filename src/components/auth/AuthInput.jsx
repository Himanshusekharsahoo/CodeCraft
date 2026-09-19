"use client";

import React, { forwardRef } from "react";

/**
 * Developer-focused text / email input field with label, error text, and keyboard accessibility.
 */
const AuthInput = forwardRef(
  (
    {
      id,
      label,
      type = "text",
      value,
      onChange,
      onBlur,
      placeholder,
      error,
      required = false,
      disabled = false,
      autoComplete,
      hint,
      className = "",
      ...rest
    },
    ref
  ) => {
    return (
      <div className="flex flex-col space-y-1.5 w-full">
        {label && (
          <div className="flex items-center justify-between">
            <label
              htmlFor={id}
              className="text-xs font-mono font-medium text-[#CBD5E1] tracking-wide"
            >
              {label} {required && <span className="text-blue-400">*</span>}
            </label>
            {hint && <span className="text-[11px] font-mono text-[#64748B]">{hint}</span>}
          </div>
        )}

        <input
          ref={ref}
          id={id}
          name={id}
          type={type}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`w-full bg-[#080B12] text-white text-sm placeholder:text-[#64748B] border rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:ring-1 ${
            error
              ? "border-red-500/60 focus:border-red-500 focus:ring-red-500/30"
              : "border-[#202938] hover:border-[#2E3B4E] focus:border-blue-500 focus:ring-blue-500/40"
          } disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
          {...rest}
        />

        {error && (
          <p id={`${id}-error`} role="alert" className="text-xs text-red-400 font-mono mt-1">
            {error}
          </p>
        )}
      </div>
    );
  }
);

AuthInput.displayName = "AuthInput";

export default AuthInput;
