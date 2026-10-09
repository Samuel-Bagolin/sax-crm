import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost, detalheErro } from "@/lib/api";
import { useCrmConfig } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export default function PerderDialog({
  negocioId,
  nome,
  onClose,
}: {
  negocioId: string | null;
  nome?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: config } = useCrmConfig();
  const [motivo, setMotivo] = useState("");
  const [detalhe, setDetalhe] = useState("");

  useEffect(() => {
    if (negocioId) {
      setMotivo("");
      setDetalhe("");
    }
  }, [negocioId]);

  const perder = useMutation({
    mutationFn: () =>
      apiPost(`/leads/${negocioId}/perder`, { motivo: [motivo, detalhe.trim()].filter(Boolean).join(" — ") || null }),
    onSuccess: () => {
      toast.success("Negócio marcado como perdido");
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["negocio"] });
      qc.invalidateQueries({ queryKey: ["historico"] });
      qc.invalidateQueries({ queryKey: ["metricas"] });
      onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível marcar como perdido"),
  });

  const exige = config?.exige_motivo_perda ?? true;

  return (
    <Dialog open={!!negocioId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Marcar como perdido</DialogTitle>
          <DialogDescription>{nome ? `Por que “${nome}” não avançou?` : "Por que o negócio não avançou?"} O motivo alimenta o relatório de perdas.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {(config?.motivos_perda ?? []).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMotivo(m === motivo ? "" : m)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                motivo === m ? "border-atrasada bg-atrasada/10 text-atrasada" : "hover:bg-muted",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <Textarea rows={3} value={detalhe} onChange={(e) => setDetalhe(e.target.value)} placeholder="Detalhes (opcional)" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={perder.isPending || (exige && !motivo && !detalhe.trim())}
            onClick={() => perder.mutate()}
            data-testid="perder-confirmar"
          >
            Marcar como perdido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
