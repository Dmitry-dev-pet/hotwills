// ─── Config ─────────────────────────────────────────────────────────────
const THEME_KEY = 'mbx_theme';

// ─── Storage ────────────────────────────────────────────────────────────
function getTheme() {
  try {
    let saved = localStorage.getItem(THEME_KEY);
    if (!saved) saved = localStorage.getItem('theme'); // migrate
    return saved === 'dark' ? 'dark' : 'light';
  } catch (e) {
    return 'light';
  }
}

function setTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme();
  } catch (e) {}
}

// ─── Apply ─────────────────────────────────────────────────────────────
function applyTheme() {
  document.documentElement.dataset.theme = getTheme();
}

applyTheme();
