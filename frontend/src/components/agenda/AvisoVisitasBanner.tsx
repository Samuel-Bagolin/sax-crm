import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BellRing, CalendarCheck } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { AvisoVisitas } from "@/lib/types";

/** Aviso no topo do sistema: visitas de amanhã (o alerta do dia anterior) e de hoje. */
export default function AvisoVisitasBanner() {
  const { data } = useQuery({
    queryKey: ["aviso-visitas"],
    queryFn: () => apiGet<AvisoVisitas>("/visitas/aviso"),
    refetchInterval: 5 * 60 * 1000,
  });

  if (!data || (data.total_amanha === 0 && data.total_hoje === 0)) return null;

  return (
    <div
      className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 backdrop-blur"
      data-testid="aviso-visitas-banner"
    >
      <BellRing className="h-5 w-5 shrink-0 text-amber-600" />
      <div className="min-w-0 text-sm">
        {data.total_amanha > 0 && (
          <p className="font-semibold" data-testid="aviso-visitas-amanha">
            Você tem {data.total_amanha} visita(s) amanhã (
            {data.amanha.slice(8, 10)}/{data.amanha.slice(5, 7)}) — avisamos também por e-mail.
          </p>
        )}
        {data.total_hoje > 0 && (
          <p className="text-muted-foreground" data-testid="aviso-visitas-hoje">
            <CalendarCheck className="mr-1 inline h-3.5 w-3.5" />
            {data.total_hoje} visita(s) agendada(s) para hoje.
          </p>
        )}
      </div>
      <Link
        to="/agenda"
        className="ml-auto text-sm font-semibold text-amber-700 underline-offset-4 hover:underline dark:text-amber-400"
        data-testid="aviso-visitas-link"
      >
        Abrir agenda
      </Link>
    </div>
  );
}
