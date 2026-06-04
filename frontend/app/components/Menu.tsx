"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export function Menu({
  button, children, align = "right", width,
}: { button: React.ReactNode; children: React.ReactNode; align?: "left" | "right"; width?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <div onClick={() => setOpen((v) => !v)}>{button}</div>
      <AnimatePresence>
        {open && (
          <>
            <div className="backdrop" onClick={() => setOpen(false)} />
            <motion.div
              className="menu"
              style={{ [align]: 0, minWidth: width } as React.CSSProperties}
              role="menu"
              onClick={() => setOpen(false)}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MenuItem({
  icon, danger, onClick, children,
}: { icon?: React.ReactNode; danger?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button className={`item ${danger ? "danger" : ""}`} role="menuitem" onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}
