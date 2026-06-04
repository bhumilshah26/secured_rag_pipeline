"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "./icons";

export type SelectOption = { value: string; label: string; icon?: React.ReactNode };

type Coords = { left: number; width: number; top?: number; bottom?: number };

export function Select({
  value, onChange, options, placeholder = "Select…", className = "", style, ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [coords, setCoords] = useState<Coords | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selected = options.find((o) => o.value === value);

  // Position the popover with fixed coords from the trigger rect, flipping up when there's
  // more room above. Fixed positioning keeps it out of any scroll container (e.g. a dialog).
  function place() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < 300 && r.top > spaceBelow;
    setCoords({
      left: r.left,
      width: r.width,
      ...(openUp ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
    });
  }

  useEffect(() => {
    if (!open) return;
    place();
    const i = Math.max(0, options.findIndex((o) => o.value === value));
    setActive(i);
    const reposition = () => place();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    const onDocDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocDown, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", onDocDown, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) optRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(i: number) {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault(); setOpen(true); return;
    }
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div className="select-wrap" ref={wrapRef} style={style}>
      <button
        ref={triggerRef}
        type="button"
        className={`select-trigger ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">
          {selected?.icon}
          <span className={selected ? "" : "faint"}>{selected ? selected.label : placeholder}</span>
        </span>
        <span className="chev"><Icon name="chevron-down" size={15} /></span>
      </button>

      <AnimatePresence>
        {open && coords && (
          <motion.div
            className="select-pop"
            role="listbox"
            tabIndex={-1}
            style={{ left: coords.left, top: coords.top, bottom: coords.bottom, minWidth: coords.width }}
            initial={{ opacity: 0, y: coords.bottom ? 6 : -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: coords.bottom ? 6 : -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
          >
            {options.map((o, i) => (
              <button
                key={o.value || `opt-${i}`}
                ref={(el) => { optRefs.current[i] = el; }}
                type="button"
                role="option"
                aria-selected={o.value === value}
                data-active={i === active}
                className="select-opt"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
              >
                {o.icon}
                <span className="grow" style={{ textAlign: "left" }}>{o.label}</span>
                <span className="tick"><Icon name="check" size={15} /></span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
