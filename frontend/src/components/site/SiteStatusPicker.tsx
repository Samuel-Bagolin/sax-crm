import { CircleSlash, Clock3, Globe } from "lucide-react";
import type { SiteStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const SITE_STATUS: Record<SiteStatus, { rotulo: string; icone: typeof Globe; classe: string }> = {
  ativo: { rotulo: "No site", icone: Globe, classe: "bg-emerald-600 text-white" },
  reservado: { rotulo: "Reservado", icone: Clock3, classe: "bg-amber-500 text-white" },
  inativo: { rotulo: "Fora do site", icone: CircleSlash, classe: "bg-muted-foreground/80 text-white" },
};

/** Controle segmentado: no site, reservado (aparece com selo) ou fora do site. */
export default function SiteStatusPicker({
  value,
  onChange,
  disabled,
  compacto,
}: {
  value: SiteStatus;
  onChange: (v: SiteStatus) => void;
  disabled?: boolean;
  compacto?: boolean;
}) {
  return (
    <div className={cn("inline-flex w-fit rounded-lg border bg-background p-0.5", disabled && "opacity-60")} role="radiogroup" aria-label="Situação no site">
      {(["ativo", "reservado", "inativo"] as SiteStatus[]).map((s) => {
        const { rotulo, icone: Icone, classe } = SITE_STATUS[s];
        const marcado = value === s;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={marcado}
            disabled={disabled}
            onClick={() => onChange(s)}
            title={rotulo}
            data-testid={`site-status-${s}`}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed",
              compacto ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
              marcado ? classe : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Icone className={compacto ? "h-3.5 w-3.5" : "h-4 w-4"} />
            <span className={cn(compacto && "hidden sm:inline")}>{rotulo}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Selo pequeno para listas: só aparece quando o imóvel está no site. */
export function SiteBadge({ status }: { status?: SiteStatus | null }) {
  if (!status || status === "inativo") return null;
  const { rotulo, icone: Icone, classe } = SITE_STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", classe)} title={status === "ativo" ? "Aparece no site da imobiliária" : "Aparece no site como reservado"}>
      <Icone className="h-3 w-3" /> {status === "ativo" ? "No site" : rotulo}
    </span>
  );
}
