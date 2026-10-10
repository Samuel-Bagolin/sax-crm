import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Car } from "lucide-react";
import { apiGet, apiPost, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { parseNumber as num } from "@/lib/numbers";
import { useItemSegmento } from "@/lib/itemSegmento";
import type { ContratoDetalhe, Lead, Pessoa } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/* Contrato de compra e venda da loja de veículos: escolhe o carro do estoque, o comprador e a forma de
   pagamento. Ao criar, o carro sai do estoque como vendido e a venda entra no Financeiro uma vez só. */

const SEM = "__sem__";
const FORMAS = ["À vista", "Pix", "Financiamento", "Entrada e financiamento", "Troca com diferença", "Consórcio", "Cartão de crédito"];

function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const VAZIO = { lead_id: SEM, veiculo_id: SEM, cliente_id: SEM, valor: "", inicio: hoje(), forma: "À vista", forma_detalhe: "", observacoes: "" };

export default function ContratoVeiculoModal({ open, onClose, leadInicial, onCriado }: {
  open: boolean;
  onClose: () => void;
  leadInicial?: string | null;
  onCriado?: (c: ContratoDetalhe) => void;
}) {
  const qc = useQueryClient();
  const requestId = useRef(crypto.randomUUID());
  const [f, setF] = useState(VAZIO);
  const set = (k: keyof typeof VAZIO, v: string) => setF((x) => ({ ...x, [k]: v }));
  const item = useItemSegmento(open);
  const { data: leads = [] } = useQuery({ queryKey: ["leads"], queryFn: () => apiGet<Lead[]>("/leads"), enabled: open });
  const { data: pessoas = [] } = useQuery({ queryKey: ["pessoas"], queryFn: () => apiGet<Pessoa[]>("/pessoas"), enabled: open });
  const negocios = leads.filter((l) => l.status !== "perdido" && l.estagio !== "perdido");

  useEffect(() => {
    if (open) { setF({ ...VAZIO, inicio: hoje() }); requestId.current = crypto.randomUUID(); }
  }, [open]);

  const escolherNegocio = (id: string) => {
    if (id === SEM) return set("lead_id", SEM);
    const l = negocios.find((x) => x.id === id);
    setF((x) => ({ ...x, lead_id: id, veiculo_id: l?.veiculo_id ?? x.veiculo_id, cliente_id: l?.cliente_id ?? x.cliente_id,
      valor: l?.valor_estimado != null ? String(l.valor_estimado) : x.valor }));
  };

  const aplicado = useRef<string | null>(null);
  useEffect(() => {
    if (!open) { aplicado.current = null; return; }
    if (leadInicial && aplicado.current !== leadInicial && negocios.some((l) => l.id === leadInicial)) {
      aplicado.current = leadInicial;
      escolherNegocio(leadInicial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadInicial, negocios.length]);

  const escolherVeiculo = (id: string) => {
    const v = item.opcoes.find((o) => o.id === id);
    setF((x) => ({ ...x, veiculo_id: id, valor: x.valor || (v?.valor != null ? String(v.valor) : "") }));
  };

  const forma = [f.forma, f.forma_detalhe.trim()].filter(Boolean).join(": ");
  const salvar = useMutation({
    mutationFn: () => apiPost<ContratoDetalhe>("/contratos", {
      request_id: requestId.current, tipo: "venda", veiculo_id: f.veiculo_id,
      lead_id: f.lead_id === SEM ? null : f.lead_id, cliente_id: f.cliente_id === SEM ? null : f.cliente_id,
      valor: num(f.valor), inicio: f.inicio, forma_pagamento: forma || null, observacoes: f.observacoes.trim() || null,
    }),
    onSuccess: (c) => {
      for (const k of ["contratos", "transacoes", "resumo", "veiculos", "kanban", "negocio", "leads"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(`Contrato ${c.numero} criado`, { description: `Veículo vendido e ${brl(c.total_gerado)} lançado no Financeiro.` });
      onClose();
      onCriado?.(c);
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível criar o contrato."),
  });

  const submeter = () => {
    if (f.veiculo_id === SEM) return toast.error("Selecione o veículo do contrato.");
    if (f.cliente_id === SEM) return toast.error("Selecione o comprador.");
    if (!num(f.valor)) return toast.error("Informe o valor da venda.");
    salvar.mutate();
  };

  const veiculo = item.opcoes.find((o) => o.id === f.veiculo_id);
  // O veículo do negócio pode já ter saído da lista de disponíveis; mostra o título que veio do negócio.
  const rotuloVeiculo = f.veiculo_id === SEM ? "Selecione o veículo" : veiculo?.titulo ?? "Veículo do negócio";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo contrato de venda</DialogTitle>
          <DialogDescription>O veículo sai do estoque como vendido e a venda entra no Financeiro. Depois é só enviar para assinar.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Negócio (opcional)</Label>
            <Select value={f.lead_id} onValueChange={escolherNegocio}>
              <SelectTrigger data-testid="contrato-lead-select">
                <SelectValue>{f.lead_id === SEM ? "Sem negócio vinculado" : negocios.find((l) => l.id === f.lead_id)?.nome ?? "Negócio"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Sem negócio vinculado</SelectItem>
                {negocios.map((l) => <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Veículo *</Label>
            <Select value={f.veiculo_id} onValueChange={escolherVeiculo}>
              <SelectTrigger data-testid="contrato-veiculo-select"><SelectValue>{rotuloVeiculo}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Selecione o veículo</SelectItem>
                {item.opcoes.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.titulo}{o.detalhe ? ` · ${o.detalhe}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {veiculo && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Car className="h-3.5 w-3.5" /> {veiculo.detalhe}{veiculo.valor != null ? `, anunciado por ${brl(veiculo.valor)}` : ""}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label>Comprador *</Label>
            <Select value={f.cliente_id} onValueChange={(v) => set("cliente_id", v)}>
              <SelectTrigger data-testid="contrato-cliente-select">
                <SelectValue>{f.cliente_id === SEM ? "Selecione o comprador" : pessoas.find((p) => p.id === f.cliente_id)?.nome ?? "Comprador"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Selecione o comprador</SelectItem>
                {pessoas.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="cv-valor">Valor da venda (R$) *</Label>
              <Input id="cv-valor" inputMode="decimal" value={f.valor} onChange={(e) => set("valor", e.target.value)} data-testid="contrato-valor-input" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cv-data">Data da venda *</Label>
              <Input id="cv-data" type="date" value={f.inicio} onChange={(e) => set("inicio", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Forma de pagamento</Label>
              <Select value={f.forma} onValueChange={(v) => set("forma", v)}>
                <SelectTrigger data-testid="contrato-forma-select"><SelectValue>{f.forma}</SelectValue></SelectTrigger>
                <SelectContent>{FORMAS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cv-forma">Detalhe do pagamento</Label>
              <Input id="cv-forma" maxLength={80} placeholder="Ex.: entrada de R$ 30 mil e 48x" value={f.forma_detalhe} onChange={(e) => set("forma_detalhe", e.target.value)} />
            </div>
          </div>

          <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
            {num(f.valor) ? `A venda de ${brl(num(f.valor) ?? 0)} entra no Financeiro como conta a receber.` : "Informe o valor para ver o lançamento."}
            {" "}Se o contrato for cancelado antes do recebimento, o veículo volta para o estoque.
          </p>

          <div className="grid gap-2">
            <Label htmlFor="cv-obs">Observações</Label>
            <Textarea id="cv-obs" rows={2} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>Cancelar</Button>
          <Button onClick={submeter} disabled={salvar.isPending} data-testid="contrato-submit-button">
            {salvar.isPending ? "Gerando..." : "Criar contrato de venda"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
