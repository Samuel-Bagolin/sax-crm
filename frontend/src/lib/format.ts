// Formatação pt-BR: moeda BRL e datas dd/MM/yyyy (convenções do design system).

const brlFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function brl(valor: number | null | undefined): string {
  if (valor == null) return "—";
  return brlFormatter.format(valor);
}

export function brlCompacto(valor: number | null | undefined): string {
  if (valor == null) return "—";
  if (Math.abs(valor) >= 1000000) return `R$ ${(valor / 1000000).toFixed(1).replace(".", ",")} mi`;
  // Até 100 mil mostra uma casa (R$ 9,5 mil); arredondar para inteiro fazia R$ 9.500 virar "R$ 10 mil".
  if (Math.abs(valor) >= 100000) return `R$ ${Math.round(valor / 1000)} mil`;
  if (Math.abs(valor) >= 1000) return `R$ ${(Math.round(valor / 100) / 10).toLocaleString("pt-BR")} mil`;
  return brl(valor);
}

// Converte "YYYY-MM-DD..." em Date local (evita o deslocamento de fuso do parseISO UTC).
export function parseDataLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function dataBR(iso: string | null | undefined): string {
  const d = parseDataLocal(iso);
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function dataHoraBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function diasAtras(iso: string | null | undefined): string {
  const d = parseDataLocal(iso);
  if (!d) return "—";
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "há 1 dia";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
}

export function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function mesLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  return `${MESES[(m || 1) - 1]}/${String(y).slice(2)}`;
}

/** Telefone brasileiro para exibir: (41) 99155-0001, (41) 3333-4444. Outros formatos ficam como vieram. */
export function telefoneBR(valor: string | null | undefined): string {
  const d = (valor ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return valor ?? "";
}

/** Máscara enquanto digita: (41) 99155-0001. */
export function mascaraTelefone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Primeiro nome para saudação: pula prefixos como "[DEMO]" e o que não tem letra. Vazio quando não há. */
export function primeiroNome(nome: string | null | undefined): string {
  for (const parte of (nome ?? "").trim().split(/\s+/)) {
    if (/^[[(]/.test(parte) || !/\p{L}/u.test(parte)) continue;
    return parte;
  }
  return "";
}
