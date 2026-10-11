import { useQuery } from "@tanstack/react-query";
import { Download, FileCheck2, FileWarning } from "lucide-react";
import { apiGet } from "@/lib/api";
import { urlApi } from "@/lib/suporte";
import { Button } from "@/components/ui/button";

export interface AceiteResumo { versao: string; em: string; nome: string; email?: string; cargo?: string; hash?: string }

export function dataHoraBR(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} às ${d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`;
}

/** Linha "aceito em ... por ..." com o botão do comprovante em PDF. */
export function LinhaAceite({ aceite, urlPdf, versaoAtual }: { aceite?: AceiteResumo | null; urlPdf: string; versaoAtual?: string }) {
  if (!aceite) {
    return <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400" data-testid="termo-pendente"><FileWarning className="h-3.5 w-3.5" /> Termo de adesão ainda não aceito</p>;
  }
  const antiga = versaoAtual && aceite.versao !== versaoAtual;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="termo-aceito">
      <span className="flex items-start gap-1.5">
        <FileCheck2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
        <span>Termo v{aceite.versao} aceito em <b>{dataHoraBR(aceite.em)}</b> por {aceite.nome}{aceite.cargo ? ` (${aceite.cargo})` : ""}
          {antiga && <span className="text-amber-700">. Falta aceitar a v{versaoAtual}</span>}</span>
      </span>
      <Button variant="outline" size="sm" className="h-7" onClick={() => window.open(urlApi(`${urlPdf}?versao=${encodeURIComponent(aceite.versao)}`), "_blank")} data-testid="termo-comprovante">
        <Download className="h-3.5 w-3.5" /> Comprovante (PDF)
      </Button>
    </div>
  );
}

/** Cartão na tela Assinatura do cliente. */
export function ComprovanteTermo() {
  const q = useQuery({ queryKey: ["termo"], queryFn: () => apiGet<{ aceite?: AceiteResumo | null; versao?: string }>("/termo") });
  if (!q.data?.aceite) return null;
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold">Termo de adesão</h2>
      <LinhaAceite aceite={q.data.aceite} urlPdf="/api/termo/comprovante.pdf" />
    </section>
  );
}
