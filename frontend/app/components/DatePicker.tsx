"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "./icons";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseISO(s?: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y) return null;
  return new Date(y, (m || 1) - 1, d || 1);
}
function fmt(s?: string): string {
  const d = parseISO(s);
  return d ? `${pad(d.getDate())} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}` : "";
}
const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const same = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

type Coords = { left: number; top?: number; bottom?: number };

export function DatePicker({
  value, onChange, placeholder = "Select date", min, max, style, ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [view, setView] = useState<Date>(() => parseISO(value) ?? new Date());
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const sel = parseISO(value);
  const minD = parseISO(min);
  const maxD = parseISO(max);

  function place() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const up = spaceBelow < 360 && r.top > spaceBelow;
    setCoords({ left: r.left, ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
  }

  useEffect(() => {
    if (!open) return;
    setView(parseISO(value) ?? new Date());
    place();
    const rep = () => place();
    window.addEventListener("resize", rep);
    window.addEventListener("scroll", rep, true);
    const down = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("resize", rep);
      window.removeEventListener("scroll", rep, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const y = view.getFullYear();
  const m = view.getMonth();
  const gridStart = new Date(y, m, 1);
  gridStart.setDate(1 - gridStart.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
  const today = new Date();

  function disabled(d: Date) {
    const dd = day0(d);
    if (minD && dd < day0(minD)) return true;
    if (maxD && dd > day0(maxD)) return true;
    return false;
  }
  function pick(d: Date) { onChange(toISO(d)); setOpen(false); }

  return (
    <div className="select-wrap" ref={wrapRef} style={style}>
      <button ref={triggerRef} type="button" className="select-trigger" aria-haspopup="dialog"
        aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen((v) => !v)}>
        <span className="select-value">
          <span className="faint" style={{ display: "inline-flex" }}><Icon name="calendar" size={15} /></span>
          <span className={sel ? "" : "faint"}>{sel ? fmt(value) : placeholder}</span>
        </span>
        <span className="chev"><Icon name="chevron-down" size={15} /></span>
      </button>

      <AnimatePresence>
        {open && coords && (
          <motion.div className="cal-pop" role="dialog" aria-label="Choose date"
            style={{ left: coords.left, top: coords.top, bottom: coords.bottom }}
            initial={{ opacity: 0, y: coords.bottom ? 6 : -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: coords.bottom ? 6 : -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}>
            <div className="cal-head">
              <span className="cal-title">{MONTHS[m]} {y}</span>
              <div className="row" style={{ gap: 2 }}>
                <button type="button" className="btn btn-ghost btn-icon" aria-label="Previous month"
                  onClick={() => setView(new Date(y, m - 1, 1))}><Icon name="chevron-left" size={16} /></button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label="Next month"
                  onClick={() => setView(new Date(y, m + 1, 1))}><Icon name="chevron-right" size={16} /></button>
              </div>
            </div>
            <div className="cal-grid">
              {DOW.map((d) => <span key={d} className="cal-dow">{d}</span>)}
              {cells.map((d, i) => (
                <button key={i} type="button" className="cal-day"
                  data-out={d.getMonth() !== m} data-today={same(d, today)}
                  aria-selected={!!sel && same(d, sel)} disabled={disabled(d)}
                  onClick={() => pick(d)}>{d.getDate()}</button>
              ))}
            </div>
            <div className="cal-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setView(new Date())}>Today</button>
              {value && (
                <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => { onChange(""); setOpen(false); }}>Clear</button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
