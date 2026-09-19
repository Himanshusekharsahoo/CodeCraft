"use client";

import React, { useState, forwardRef } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * Developer-focused password input with accessible show/hide toggle.
 */
const PasswordInput = forwardRef(
  (
    {
      id = "password",
      label = "Password",
      value,
      onChange,
      onBlur,
      placeholder = "••••••••••••",
      error,
      required = false,
      disabled = false,
      autoComplete = "current-password",
      rightLabelAction,
      hint,
      className = "",
      ...rest
    },
    ref
  ) => {
    const [showPassword, setShowPassword] = useState(false);

    return (
      <div className="flex flex-col space-y-1.5 w-full">
        <div className="flex items-center justify-between">
          <label
            htmlFor={id}
            className="text-xs font-mono font-medium text-[#CBD5E1] tracking-wide"
          >
            {label} {required && <span className="text-blue-400">*</span>}
          </label>
          {rightLabelAction || (hint && <span className="text-[11px] font-mono text-[#64748B]">{hint}</span>)}
        </div>

        <div className="relative w-full">
          <input
            ref={ref}
            id={id}
            name={id}
            type={showPassword ? "text" : "password"}
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            placeholder={placeholder}
            required={required}
            disabled={disabled}
            autoComplete={autoComplete}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            className={`w-full bg-[#080B12] text-white text-sm placeholder:text-[#64748B] border rounded-lg pl-3.5 pr-10 py-2.5 transition-colors focus:outline-none focus:ring-1 ${
              error
                ? "border-red-500/60 focus:border-red-500 focus:ring-red-500/30"
                : "border-[#202938] hover:border-[#2E3B4E] focus:border-blue-500 focus:ring-blue-500/40"
            } disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
            {...rest}
          />

          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            disabled={disabled}
            tabIndex={0}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#64748B] hover:text-[#CBD5E1] focus:outline-none focus:text-blue-400 rounded transition-colors"
          >
            {showPassword ? (
              <EyeOff className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Eye className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>

        {error && (
          <p id={`${id}-error`} role="alert" className="text-xs text-red-400 font-mono mt-1">
            {error}
          </p>
        )}
      </div>
    );
  }
);

PasswordInput.displayName = "PasswordInput";

export default PasswordInput;
