"use client";

import { useState } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  showLabel: string;
  hideLabel: string;
  autoComplete?: string;
  required?: boolean;
};

const inputCls =
  "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 pe-12 text-sm text-text placeholder:text-muted focus:border-accent";

export function PasswordField({
  value,
  onChange,
  placeholder,
  showLabel,
  hideLabel,
  autoComplete = "current-password",
  required = true,
}: Props) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        className={inputCls}
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? hideLabel : showLabel}
        title={show ? hideLabel : showLabel}
        className="absolute inset-y-0 end-0 grid w-11 place-items-center text-muted transition-colors hover:text-text"
      >
        {show ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
            <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
            <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
            <line x1="2" y1="2" x2="22" y2="22" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
