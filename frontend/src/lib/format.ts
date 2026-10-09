// Formatação pt-BR: moeda BRL e datas dd/MM/yyyy (convenções do design system).

const brlFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function brl(valor: number | null | undefined): string {
  if (valor == null) return "—";
  return brlFormatter.format(valor);
}

export function brlCompacto(valor: number | null | undefined): string {
  if (valor == null) return "—";
  if (Math.abs(valor) >= 1000000) return `R$ ${(valor / 1000000).toFixed(1).replace(".", ",")} mi`;
  if (Math.abs(valor) >= 1000) return `R$ ${Math.round(valor / 1000)} mil`;
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
