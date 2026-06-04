"use client";
import { useEffect, useRef } from "react";

type Btn = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm" | "icon";
  loading?: boolean;
  block?: boolean;
};
export function Button({
  variant = "secondary", size = "md", loading, block, className = "", children, disabled, ...rest
}: Btn) {
  const cls = [
    "btn",
    `btn-${variant}`,
    size === "sm" ? "btn-sm" : size === "icon" ? "btn-icon" : "",
    block ? "btn-block" : "",
    className,
  ].filter(Boolean).join(" ");
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading && <span className="spinner" />}
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`input ${className}`} {...rest} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea className={`textarea ${className}`} {...rest} />;
}
export { Select } from "./Select";
export type { SelectOption } from "./Select";
export function Field({ label, hint, children }: { label?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Badge({
  tone = "default", children, className = "",
}: { tone?: "default" | "primary" | "success" | "warning" | "danger"; children: React.ReactNode; className?: string }) {
  return <span className={`badge ${tone !== "default" ? `badge-${tone}` : ""} ${className}`}><span className="dot" />{children}</span>;
}

export function RiskBadge({ risk }: { risk: string }) {
  const r = (risk || "").toUpperCase();
  const tone = r === "ALLOW" ? "success" : r === "FLAG" ? "warning" : r === "BLOCK" ? "danger" : "default";
  return <Badge tone={tone as any}>{r === "ALLOW" ? "Allowed" : r === "FLAG" ? "Flagged" : r === "BLOCK" ? "Blocked" : risk}</Badge>;
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={!!active} onClick={onClick}>
      {children}
    </button>
  );
}

export function Panel({ className = "", children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`panel ${className}`} {...rest}>{children}</div>;
}

export function Spinner() { return <span className="spinner" />; }

export function Skeleton({ h = 16, w = "100%", className = "" }: { h?: number; w?: number | string; className?: string }) {
  return <span className={`skeleton ${className}`} style={{ display: "block", height: h, width: w }} />;
}

export function EmptyState({ glyph = "✦", title, children }: { glyph?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="glyph">{glyph}</span>
      <strong style={{ color: "var(--ink)" }}>{title}</strong>
      {children && <div className="muted" style={{ fontSize: 13 }}>{children}</div>}
    </div>
  );
}

export function Dialog({
  open, onClose, title, children, footer,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" onCancel={(e) => { e.preventDefault(); onClose(); }} onClose={onClose}>
      <div className="modal-body stack">
        <div className="row-between">
          <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 17, fontWeight: 650 }}>{title}</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">✕</Button>
        </div>
        {children}
        {footer && <div className="row" style={{ justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </dialog>
  );
}
