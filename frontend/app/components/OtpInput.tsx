"use client";
import { useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (code: string) => void;   // fires when all boxes are filled (typed or pasted)
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
};

export function OtpInput({ value, onChange, onComplete, length = 6, disabled, autoFocus = true }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = Array.from({ length }, (_, i) => value[i] ?? "");

  useEffect(() => { if (autoFocus) refs.current[0]?.focus(); }, [autoFocus]);

  function commit(next: string, focusIndex?: number) {
    next = next.replace(/\D/g, "").slice(0, length);
    onChange(next);
    const idx = focusIndex ?? Math.min(next.length, length - 1);
    refs.current[idx]?.focus();
    if (next.length === length) onComplete?.(next);
  }

  function handleChange(i: number, raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return;
    if (digits.length > 1) {
      // Mobile autofill / paste routed into one box: distribute from this position.
      commit(value.slice(0, i) + digits);
    } else {
      commit(value.slice(0, i) + digits + value.slice(i + 1));
    }
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (chars[i]) commit(value.slice(0, i) + value.slice(i + 1), i);
      else if (i > 0) commit(value.slice(0, i - 1), i - 1);
    } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < length - 1) refs.current[i + 1]?.focus();
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    commit(e.clipboardData.getData("text"));
  }

  return (
    <div className="row" style={{ gap: 8, justifyContent: "space-between" }} onPaste={handlePaste}>
      {chars.map((ch, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          className="mono"
          value={ch}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1} of ${length}`}
          style={{
            width: 44, height: 52, textAlign: "center", fontSize: 20,
            border: "1px solid var(--border)", borderRadius: 10,
            background: "transparent", color: "var(--ink)", outline: "none",
          }}
        />
      ))}
    </div>
  );
}