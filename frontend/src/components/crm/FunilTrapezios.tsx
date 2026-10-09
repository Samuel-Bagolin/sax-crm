import type { Relatorio } from "@/lib/relatorio";
import { cn } from "@/lib/utils";

/** Funil em trapézios: largura proporcional à quantidade (mín. 12%); texto em HTML ao lado. */
export default function FunilTrapezios({ etapas }: { etapas: Relatorio["funil"] }) {
  const max = Math.max(1, ...etapas.map((e) => e.alcancaram));
  const larg = (n: number) => Math.max(12, (n / max) * 100);
  const ALT = 46;
  return (
    <div className="space-y-0.5" role="table" aria-label="Funil por etapa">
      {etapas.map((e, i) => {
        const ganho = e.id === "__ganho";
        const topo = larg(e.alcancaram);
        const base = i < etapas.length - 1 ? larg(etapas[i + 1].alcancaram) : topo;
        const cor = ganho ? "var(--hoje)" : `var(--funil-${Math.min(7, i + 2)})`;
        return (
          <div key={e.id} role="row" className="group grid grid-cols-[minmax(0,1fr)_minmax(150px,220px)] items-center gap-4">
            <div className="relative" title={`${e.nome}: ${e.alcancaram}`}>
              <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="block w-full" style={{ height: ALT }} aria-hidden>
                <polygon
                  points={`${50 - topo / 2},0 ${50 + topo / 2},0 ${50 + base / 2},10 ${50 - base / 2},10`}
                  fill={cor}
                  className="transition-opacity group-hover:opacity-85"
                />
              </svg>
              <span
                className={cn(
                  "num pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-bold",
                  ganho || i >= 2 ? "text-white" : "text-[#1c1530] dark:text-white",
                )}
              >
                {e.alcancaram}
              </span>
            </div>
            <div role="cell" className="min-w-0">
              <p className={cn("truncate text-sm font-semibold", ganho && "text-hoje")}>{e.nome}</p>
              <p className="text-xs text-muted-foreground">
                {e.taxa_do_anterior != null ? `${e.taxa_do_anterior}% da etapa anterior` : "entrada do funil"}
                {e.taxa_do_total != null && i > 0 ? `, ${e.taxa_do_total}% do total` : ""}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

