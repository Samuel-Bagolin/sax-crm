/** Cores do menu lateral: a partir de 2 cores escolhidas, calcula texto, hover e borda com contraste. */

export const CORES_MENU_PADRAO = { fundo: "#4a03a2", destaque: "#ff7a00" };

export const PALETAS_MENU = [
  { nome: "Roxo SAX", fundo: "#4a03a2", destaque: "#ff7a00" },
  { nome: "Azul-marinho", fundo: "#0f2a4a", destaque: "#f5b301" },
  { nome: "Verde", fundo: "#0b5d4b", destaque: "#ffb547" },
  { nome: "Grafite", fundo: "#1f2328", destaque: "#ff7a00" },
  { nome: "Vinho", fundo: "#5c1030", destaque: "#f2c14e" },
  { nome: "Claro", fundo: "#ffffff", destaque: "#4a03a2" },
];

const HEX = /^#[0-9a-f]{6}$/i;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paraHex([r, g, b]: number[]): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

function misturar(a: string, b: string, peso: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return paraHex(x.map((v, i) => v * (1 - peso) + y[i] * peso));
}

/** Luminância relativa (WCAG). */
function luminancia(hex: string): number {
  const c = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export const ehEscura = (hex: string) => luminancia(hex) < 0.4;

/** Variáveis CSS do menu lateral (as mesmas do tema: --sidebar, --sidebar-foreground…). */
export function variaveisMenu(fundo: string, destaque: string): Record<string, string> | null {
  if (!HEX.test(fundo) || !HEX.test(destaque)) return null;
  const escuro = ehEscura(fundo);
  const texto = escuro ? misturar("#ffffff", fundo, 0.08) : misturar("#1c1c1c", fundo, 0.05);
  return {
    "--sidebar": fundo,
    "--sidebar-foreground": texto,
    "--sidebar-accent": escuro ? misturar(fundo, "#000000", 0.22) : misturar(fundo, "#000000", 0.07),
    "--sidebar-accent-foreground": escuro ? "#ffffff" : "#111111",
    "--sidebar-border": escuro ? misturar(fundo, "#ffffff", 0.15) : misturar(fundo, "#000000", 0.12),
    "--sidebar-primary": destaque,
    "--sidebar-primary-foreground": ehEscura(destaque) ? "#ffffff" : misturar(fundo, "#000000", escuro ? 0.35 : 0.85),
    "--sidebar-ring": destaque,
  };
}

export function ehPadrao(fundo?: string, destaque?: string): boolean {
  return (fundo ?? "").toLowerCase() === CORES_MENU_PADRAO.fundo && (destaque ?? "").toLowerCase() === CORES_MENU_PADRAO.destaque;
}
