export type Theme = "light" | "dark";

const STORAGE_KEY = "token-panel:theme:v1";

export function loadTheme(): Theme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f4f5f1" : "#07080a");
}

export function saveTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable in private contexts; the theme then lasts this session.
  }
}
