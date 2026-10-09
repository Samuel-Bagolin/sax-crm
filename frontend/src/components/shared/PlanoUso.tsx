import { Check, Lock } from "lucide-react";
import { useCatalogoPlanos, usePlano, type Recurso } from "@/lib/diferenciais";
import { cn } from "@/lib/utils";

function Barra({ rotulo, uso, limite }: { rotulo: string; uso: number; limite: number | null }) {
  const pct = limite ? Math.min(100, Math.round((uso / limite) * 100)) : 0;
  const alerta = limite != null && uso >= limite;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span>{rotulo}</span>
        <span className={cn("num font-semibold", alerta && "text-atrasada")}>
          {uso}
          {limite != null ? ` de ${limite}` : " (sem limite)"}
        </span>
      </div>
      {limite != null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={uso} aria-valuemax={limite} aria-label={rotulo}>
          <div className={cn("h-full rounded-full", alerta ? "bg-atrasada" : pct > 80 ? "bg-sem-atividade" : "bg-primary")} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** Plano contratado, uso e recursos (compacto = só as barras). */
export default function PlanoUso({ compacto = false }: { compacto?: boolean }) {
  const { data: plano } = usePlano();
  const { data: catalogo } = useCatalogoPlanos(!compacto);
  if (!plano) return null;
  if (compacto)
    return (
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[auto_1fr_1fr] sm:items-center sm:gap-6" data-testid="plano-uso">
        <div>
          <p className="text-xs text-muted-foreground">Plano</p>
          <p className="font-semibold">{plano.nome}</p>
        </div>
        <Barra rotulo="Usuários ativos" uso={plano.uso_usuarios} limite={plano.usuarios} />
        <Barra rotulo="Imóveis em carteira" uso={plano.uso_imoveis} limite={plano.imoveis} />
      </div>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]" data-testid="plano-uso">
      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div>
          <p className="text-xs text-muted-foreground">Seu plano</p>
          <p className="text-xl font-semibold">{plano.nome}</p>
          <p className="text-sm text-muted-foreground">{plano.resumo}</p>
        </div>
        <Barra rotulo="Usuários ativos" uso={plano.uso_usuarios} limite={plano.usuarios} />
        <Barra rotulo="Imóveis em carteira" uso={plano.uso_imoveis} limite={plano.imoveis} />
        <p className="text-xs text-muted-foreground">Imóveis vendidos ou alugados não contam no limite. Para ampliar o plano, fale com o suporte.</p>
      </section>
      <section className="rounded-lg border bg-card p-4">
        <p className="mb-3 text-sm font-semibold">Recursos</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {catalogo &&
            (Object.entries(catalogo.recursos) as [Recurso, string][]).map(([chave, rotulo]) => {
              const tem = plano.recursos.includes(chave);
              const desde = catalogo.planos.find((p) => p.recursos.includes(chave))?.nome;
              return (
                <li key={chave} className={cn("flex items-start gap-2 text-sm", !tem && "text-muted-foreground")}>
                  {tem ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-hoje" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span>
                    {rotulo}
                    {!tem && desde && <span className="block text-xs">a partir do {desde}</span>}
                  </span>
                </li>
              );
            })}
        </ul>
      </section>
    </div>
  );
}
