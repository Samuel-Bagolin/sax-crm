/* Situações do dente e quadrantes FDI (sem three.js, para carregar leve). */
export type EstadoDente = "higido" | "carie" | "restaurado" | "ausente" | "implante" | "canal" | "coroa" | "extracao" | "fratura" | "selante" | "protese";

export const ESTADOS_DENTE: Record<EstadoDente, { rotulo: string; cor: string }> = {
  higido: { rotulo: "Hígido", cor: "#f3eee2" },
  carie: { rotulo: "Cárie", cor: "#d1453b" },
  restaurado: { rotulo: "Restaurado", cor: "#3b82f6" },
  canal: { rotulo: "Canal", cor: "#8b5cf6" },
  coroa: { rotulo: "Coroa", cor: "#d4a017" },
  implante: { rotulo: "Implante", cor: "#94a3b8" },
  protese: { rotulo: "Prótese", cor: "#14b8a6" },
  selante: { rotulo: "Selante", cor: "#22c55e" },
  fratura: { rotulo: "Fratura", cor: "#f97316" },
  extracao: { rotulo: "Extração indicada", cor: "#7f1d1d" },
  ausente: { rotulo: "Ausente", cor: "#cbd5e1" },
};

export const QUADRANTES = {
  sup: [[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28]],
  inf: [[48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]],
};

