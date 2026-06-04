"use client";
import { useEffect, useState } from "react";
import { Icon } from "./icons";

type Theme = "light" | "dark";

function current(): Theme {
  if (typeof document === "undefined") return "light";
  return (document.documentElement.getAttribute("data-theme") as Theme) || "light";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");
  useEffect(() => setThemeState(current()), []);

  function setTheme(t: Theme) {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("theme", t);
    } catch {}
    setThemeState(t);
  }
  return { theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="btn btn-ghost btn-icon"
      onClick={toggle}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      aria-label="Toggle theme"
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
    </button>
  );
}
