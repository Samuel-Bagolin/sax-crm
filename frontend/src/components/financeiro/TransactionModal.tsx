import { parseNumber as num } from "@/lib/numbers";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost, apiPatch } from "@/lib/api";
import { hojeISO } from "@/lib/format";
import type { Imovel, PlanoConta, TransacaoFinanceira, TransacaoStatus, TransacaoTipo } from "@/lib/types";
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

const SEM_IMOVEL = "__sem__";

interface FormState {
  descricao: string;
  tipo: TransacaoTipo;
  valor: string;
  plano_conta_id: string;
  imovel_id: string;
  vencimento: string;
  status: TransacaoStatus;
  pagamento: string;
}



export default function TransactionModal({
  open,
  onClose,
  transacao,
  contas,
  imoveis,
}: {
  open: boolean;
  onClose: () => void;
  transacao: TransacaoFinanceira | null;
  contas: PlanoConta[];
  imoveis: Imovel[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>({
    descricao: "",
    tipo: "receber",
    valor: "",
    plano_conta_id: "",
    imovel_id: SEM_IMOVEL,
    vencimento: hojeISO(),
    status: "pendente",
    pagamento: "",
  });
  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    if (transacao) {
      setForm({
        descricao: transacao.descricao,
        tipo: transacao.tipo,
        valor: transacao.valor.toString(),
        plano_conta_id: transacao.plano_conta_id,
        imovel_id: transacao.imovel_id ?? SEM_IMOVEL,
        vencimento: transacao.vencimento,
        status: transacao.status,
        pagamento: transacao.pagamento ?? "",
      });
    } else {
      setForm((f) => ({
        ...f,
        descricao: "",
        valor: "",
        plano_conta_id: "",
        imovel_id: SEM_IMOVEL,
        vencimento: hojeISO(),
        status: "pendente",
        pagamento: "",
      }));
    }
  }, [open, transacao]);

  // Apenas contas analíticas (sem filhos) devem receber lançamentos.
  const folhas = contas.filter((c) => !contas.some((x) => x.conta_pai_id === c.id));

  const salvar = useMutation({
    mutationFn: async () => {
      const body = {
        descricao: form.descricao.trim(),
        tipo: form.tipo,
        valor: num(form.valor)!,
        plano_conta_id: form.plano_conta_id,
        imovel_id: form.imovel_id === SEM_IMOVEL ? null : form.imovel_id || null,
        vencimento: form.vencimento,
        status: form.status,
        pagamento: form.status === "pago" ? form.pagamento || hojeISO() : null,
      };
      return transacao
        ? apiPatch<TransacaoFinanceira>(`/transacoes/${transacao.id}`, body)
        : apiPost<TransacaoFinanceira>("/transacoes", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transacoes"] });
      qc.invalidateQueries({ queryKey: ["resumo"] });
      toast.success(transacao ? "Lançamento atualizado!" : "Lançamento registrado!");
      onClose();
    },
    onError: (erro) => {
      toast.error("Não foi possível salvar o lançamento.", {
        description: erro instanceof Error ? erro.message : undefined,
      });
    },
  });

  const submeter = () => {
    if (!form.descricao.trim() || !form.plano_conta_id || num(form.valor) == null || !form.vencimento) {
      toast.error("Preencha descrição, categoria, valor e vencimento.");
      return;
    }
    salvar.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{transacao ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
          <DialogDescription>
            Contas a pagar ou a receber, classificadas no plano de contas e, quando possível, vinculadas a um imóvel.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="t-descricao">Descrição *</Label>
            <Input
              id="t-descricao"
              value={form.descricao}
              onChange={(e) => set("descricao", e.target.value)}
              placeholder="Ex.: Comissão de venda — Apartamento Vila Mariana"
              data-testid="transacao-descricao-input"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => set("tipo", v)}>
                <SelectTrigger className="w-full min-w-0" data-testid="transacao-tipo-select">
                  <SelectValue>{form.tipo === "receber" ? "A Receber" : "A Pagar"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="receber">A Receber</SelectItem>
                  <SelectItem value="pagar">A Pagar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="t-valor">Valor (R$) *</Label>
              <Input
                id="t-valor"
                inputMode="decimal"
                value={form.valor}
                onChange={(e) => set("valor", e.target.value)}
                data-testid="transacao-valor-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="t-vencimento">Vencimento *</Label>
              <Input
                id="t-vencimento"
                type="date"
                value={form.vencimento}
                onChange={(e) => set("vencimento", e.target.value)}
                data-testid="transacao-vencimento-input"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Categoria (plano de contas) *</Label>
            <Select value={form.plano_conta_id || "__sem__"} onValueChange={(v) => set("plano_conta_id", v === "__sem__" ? "" : v)}>
              <SelectTrigger className="w-full min-w-0" data-testid="transacao-plano-select">
                <SelectValue>
                  {form.plano_conta_id
                    ? (() => {
                        const c = contas.find((x) => x.id === form.plano_conta_id);
                        return c ? `${c.codigo} · ${c.nome}` : "Categoria";
                      })()
                    : "Selecionar categoria"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__sem__" disabled>
                  Selecionar categoria
                </SelectItem>
                {folhas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.codigo} · {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Imóvel vinculado</Label>
            <Select value={form.imovel_id || SEM_IMOVEL} onValueChange={(v) => set("imovel_id", v)}>
              <SelectTrigger className="w-full min-w-0" data-testid="transacao-imovel-select">
                <SelectValue>
                  {form.imovel_id && form.imovel_id !== SEM_IMOVEL
                    ? (imoveis.find((i) => i.id === form.imovel_id)?.titulo ?? "Imóvel")
                    : "Sem vínculo com imóvel"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_IMOVEL}>Sem vínculo com imóvel</SelectItem>
                {imoveis.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.titulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger className="w-full min-w-0" data-testid="transacao-status-select">
                  <SelectValue>{form.status === "pago" ? "Pago / Recebido" : "Pendente"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="pago">Pago / Recebido</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.status === "pago" && (
              <div className="grid gap-2">
                <Label htmlFor="t-pagamento">Data do pagamento</Label>
                <Input
                  id="t-pagamento"
                  type="date"
                  value={form.pagamento || hojeISO()}
                  onChange={(e) => set("pagamento", e.target.value)}
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} type="button">
            Cancelar
          </Button>
          <Button onClick={submeter} disabled={salvar.isPending} data-testid="transacao-submit-button">
            {salvar.isPending ? "Salvando..." : transacao ? "Salvar alterações" : "Registrar lançamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
