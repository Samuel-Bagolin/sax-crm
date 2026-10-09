import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, LogOut } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import type { Ambiente } from "@/lib/types";
import { Button } from "@/components/ui/button";

/** Faixa de ambiente (fora de produção) e aviso de acesso de suporte a uma empresa. */
export default function FaixaAmbiente() {
  const qc = useQueryClient();
  const { isSysadmin, suporte, empresaNome } = useAuth();
  const { data } = useQuery({
    queryKey: ["ambiente"],
    queryFn: () => apiGet<Ambiente>("/empresas/ambiente"),
    staleTime: 5 * 60 * 1000,
  });

  const sair = useMutation({
    mutationFn: () => apiPost("/empresas/sair"),
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast.success("Você saiu do modo suporte.");
      window.location.href = "/empresas";
    },
  });

  const foraDeProducao = data && !data.producao;
  if (!foraDeProducao && !suporte) return null;

  return (
    <div className="flex flex-col">
      {foraDeProducao && (
        <div
          className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-amber-950"
          data-testid="faixa-ambiente"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Ambiente de {data?.rotulo} — dados aqui não são de produção
        </div>
      )}
      {suporte && isSysadmin && (
        <div
          className="flex flex-wrap items-center justify-center gap-3 bg-sidebar px-4 py-1.5 text-xs font-semibold text-sidebar-foreground"
          data-testid="faixa-suporte"
        >
          Acesso de suporte à empresa {empresaNome}
          <Button
            variant="outline"
            size="sm"
            className="h-6 border-sidebar-foreground/40 bg-transparent px-2 text-[11px] text-sidebar-foreground hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground"
            onClick={() => sair.mutate()}
            disabled={sair.isPending}
            data-testid="faixa-suporte-sair"
          >
            <LogOut className="h-3 w-3" /> Sair do suporte
          </Button>
        </div>
      )}
    </div>
  );
}
