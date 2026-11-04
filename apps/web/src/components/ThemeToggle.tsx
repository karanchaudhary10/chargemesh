import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme.js";

/**
 * Light/dark switch used in every top bar. The icon shows what tapping does:
 * a sun in dark mode (switch to light), a moon in light mode.
 */
export function ThemeToggle({
  className = "",
  showLabel = false
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={isDark}
      title={label}
      className={`inline-flex items-center justify-center gap-1.5 h-9 ${
        showLabel ? "px-3" : "w-9"
      } rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors ${className}`}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      {showLabel && <span className="text-xs font-semibold">{isDark ? "Light mode" : "Dark mode"}</span>}
    </button>
  );
}
