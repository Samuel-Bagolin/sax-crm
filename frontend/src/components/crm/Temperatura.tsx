import { Flame, Snowflake, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/* Temperatura do lead e do negócio. Cores fixas e legíveis no claro e no escuro. */

export type Temperatura = "quente" | "morno" | "frio";

export const TEMPERATURAS: { valor: Temperatura; rotulo: string; icone: typeof Flame; classe: string }[] = [
  { valor: "quente", rotulo: "Quente", icone: Flame, classe: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
  { valor: "morno", rotulo: "Morno", icone: Sun, classe: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  { valor: "frio", rotulo: "Frio", icone: Snowflake, classe: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
];

export function ChipTemperatura({ valor, compacto, className }: { valor: string | null | undefined; compacto?: boolean; className?: string }) {
  const t = TEMPERATURAS.find((x) => x.valor === valor);
  if (!t) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1.5 text-[10px] font-semibold", t.classe, className)} title={`Lead ${t.rotulo.toLowerCase()}`} data-testid="chip-temperatura">
      <t.icone className="h-3 w-3" />{!compacto && t.rotulo}
    </span>
  );
}

/** Select de temperatura. `vazio` é o rótulo da opção sem temperatura. */
export function SelectTemperatura({ valor, onChange, vazio = "Sem temperatura", className, ...rest }: {
  valor: string | null | undefined; onChange: (v: Temperatura | null) => void; vazio?: string; className?: string; "aria-label"?: string; "data-testid"?: string;
}) {
  return (
    <select value={valor ?? ""} onChange={(e) => onChange((e.target.value || null) as Temperatura | null)}
      className={cn("h-9 rounded-md border bg-background px-2 text-sm", className)} aria-label={rest["aria-label"] ?? "Temperatura"} data-testid={rest["data-testid"]}>
      <option value="">{vazio}</option>
      {TEMPERATURAS.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
    </select>
  );
}
