"use client";

import { useState } from "react";

// Minimal clipboard control. Receives only plain strings — never imports the Supabase
// client — so the artifact detail page stays server-rendered and server-only.
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  className,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard unavailable (e.g. insecure context) — no-op.
        }
      }}
      aria-label={label}
      className={
        className ??
        "inline-flex min-h-10 items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
      }
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
