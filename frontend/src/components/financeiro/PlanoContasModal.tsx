import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost, apiPut } from "@/lib/api";
import { PLANO_TIPO } from "@/lib/constants";
import type { PlanoConta, PlanoTipo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const RAIZ = "__raiz__";

export default function PlanoContasModal({
  open,
  onClose,
  conta,
  contas,
  paiInicial,
}: {
  open: boolean;
  onClose: () => void;
  conta: PlanoConta | null;
  contas: PlanoConta[];
  paiInicial: string | null;
}) {
  const qc = useQueryClient();
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<PlanoTipo>("receita");
  const [paiId, setPaiId] = useState(RAIZ);

  useEffect(() => {
    if (!open) return;
    if (conta) {
      setCodigo(conta.codigo);
      setNome(conta.nome);
      setTipo(conta.tipo);
      setPaiId(conta.conta_pai_id ?? RAIZ);
    } else {
      setCodigo("");
      setNome("");
      setTipo("receita");
      setPaiId(paiInicial ?? RAIZ);
    }
  }, [open, conta, paiInicial]);

  const salvar = useMutation({
    mutationFn: async () => {
      const body = {
        codigo: codigo.trim(),
        nome: nome.trim(),
        tipo,
        conta_pai_id: paiId === RAIZ ? null : paiId,
      };
      return conta
        ? apiPut<PlanoConta>(`/plano-contas/${conta.id}`, body)
        : apiPost<PlanoConta>("/plano-contas", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plano-contas"] });
      toast.success(conta ? "Conta atualizada!" : "Conta adicionada ao plano de contas!");
      onClose();
    },
    onError: (erro) => {
      toast.error("Não foi possível salvar a conta.", {
        description: erro instanceof Error ? erro.message : undefined,
      });
    },
  });

  const submeter = () => {
    if (!codigo.trim() || !nome.trim()) {
      toast.error("Informe o código e o nome da conta.");
      return;
    }
    salvar.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{conta ? "Editar conta" : "Nova conta do plano"}</DialogTitle>
          <DialogDescription>
            Estrutura hierárquica: contas sintéticas agrupam, contas analíticas recebem os lançamentos.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="plano-codigo">Código *</Label>
              <Input
                id="plano-codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Ex.: 1.1.3"
                data-testid="plano-codigo-input"
              />
            </div>
            <div className="grid gap-2">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as PlanoTipo)}>
                <SelectTrigger data-testid="plano-tipo-select">
                  <SelectValue>{PLANO_TIPO[tipo]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="receita">Receita</SelectItem>
                  <SelectItem value="despesa">Despesa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="plano-nome">Nome *</Label>
            <Input
              id="plano-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Comissão de Intermediação"
              data-testid="plano-nome-input"
            />
          </div>

          <div className="grid gap-2">
            <Label>Conta pai</Label>
            <Select value={paiId} onValueChange={(v) => setPaiId(v)}>
              <SelectTrigger data-testid="plano-pai-select">
                <SelectValue>
                  {paiId === RAIZ
                    ? "— Conta raiz (nível 1) —"
                    : (() => {
                        const p = contas.find((c) => c.id === paiId);
                        return p ? `${p.codigo} · ${p.nome}` : "Conta pai";
                      })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={RAIZ}>— Conta raiz (nível 1) —</SelectItem>
                {contas
                  .filter((c) => !conta || c.id !== conta.id)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.codigo} · {c.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} type="button">
            Cancelar
          </Button>
          <Button onClick={submeter} disabled={salvar.isPending} data-testid="plano-submit-button">
            {salvar.isPending ? "Salvando..." : conta ? "Salvar alterações" : "Adicionar conta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
