/**
 * Theme choice: System (no attribute, follow the OS), Light or Dark
 * (`data-theme` on <html>). Stored in localStorage; read before paint by
 * THEME_SCRIPT so a reload never flashes the wrong theme.
 */
export type Theme = "system" | "light" | "dark";

export const THEME_KEY = "stadeum.theme";

/** Inlined in <head>. Kept tiny and dependency-free. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export function readTheme(): Theme {
  const t = typeof document === "undefined" ? null : document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : "system";
}

/** Apply and remember a choice. Colours change at once: transitions are held off for a frame. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme-switching", "");
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not remembered; it still applies for this visit.
  }
  requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute("data-theme-switching")));
}
