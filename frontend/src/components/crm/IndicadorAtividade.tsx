import { AlertTriangle, ChevronRight } from "lucide-react";
import { ATIVIDADE, dataCurta } from "@/lib/crm";
import type { NegocioResumo } from "@/lib/types";
import { cn } from "@/lib/utils";

const ESTILO = {
  atrasada: "bg-atrasada text-white",
  hoje: "bg-hoje text-white",
  futura: "bg-muted text-muted-foreground",
  nenhuma: "bg-sem-atividade/15 text-sem-atividade",
};

/** Convenção do Pipedrive: vermelho = atrasada, verde = hoje, cinza = futura, amarelo = sem próximo passo. */
export default function IndicadorAtividade({
  negocio,
  onAgendar,
  tamanho = "sm",
}: {
  negocio: NegocioResumo;
  onAgendar?: () => void;
  tamanho?: "sm" | "md";
}) {
  const s = negocio.situacao_atividade;
  const meta = negocio.proxima_atividade_tipo ? ATIVIDADE[negocio.proxima_atividade_tipo] : null;
  const Icone = s === "nenhuma" ? AlertTriangle : meta?.icon ?? ChevronRight;
  const titulo =
    s === "nenhuma"
      ? "Sem próxima atividade — agendar"
      : `${meta?.label ?? "Atividade"} ${s === "atrasada" ? "atrasada" : dataCurta(negocio.proxima_atividade).toLowerCase()}: ${negocio.proxima_atividade_assunto ?? ""}`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAgendar?.();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
      title={titulo}
      aria-label={titulo}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110",
        tamanho === "sm" ? "h-6 w-6" : "h-8 w-8",
        ESTILO[s],
      )}
    >
      <Icone className={tamanho === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
    </button>
  );
}
