import { parseNumber as num } from "@/lib/numbers";
import { useEffect, useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import type { ContratoDetalhe, ContratoTipo, Imovel, Lead, Pessoa } from "@/lib/types";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SEM = "__sem__";

interface FormState {
  tipo: ContratoTipo;
  lead_id: string;
  imovel_id: string;
  cliente_id: string;
  valor: string;
  comissao_pct: string;
  taxa_admin_pct: string;
  inicio: string;
  fim: string;
  parcelas: string;
  dia_vencimento: string;
  observacoes: string;
}

function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function maisMeses(iso: string, meses: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1 + meses, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

const VAZIO: FormState = {
  tipo: "venda",
  lead_id: SEM,
  imovel_id: SEM,
  cliente_id: SEM,
  valor: "",
  comissao_pct: "5",
  taxa_admin_pct: "10",
  inicio: hoje(),
  fim: "",
  parcelas: "",
  dia_vencimento: "10",
  observacoes: "",
};



export default function ContratoModal({
  open,
  onClose,
  leadInicial,
  onCriado,
}: {
  open: boolean;
  onClose: () => void;
  leadInicial?: string | null;
  onCriado?: (c: ContratoDetalhe) => void;
}) {
  const qc = useQueryClient();
  const requestId = useRef(crypto.randomUUID());
  const [form, setForm] = useState<FormState>(VAZIO);
  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: leads = [] } = useQuery({ queryKey: ["leads"], queryFn: () => apiGet<Lead[]>("/leads") });
  const { data: imoveis = [] } = useQuery({
    queryKey: ["imoveis"],
    queryFn: () => apiGet<Imovel[]>("/imoveis"),
  });
  const { data: pessoas = [] } = useQuery({
    queryKey: ["pessoas"],
    queryFn: () => apiGet<Pessoa[]>("/pessoas"),
  });

  const ganhos = leads.filter((l) => l.status === "ganho" || l.estagio === "ganho");

  useEffect(() => {
    if (open) { setForm({ ...VAZIO, inicio: hoje() }); requestId.current = crypto.randomUUID(); }
  }, [open]);

  // Ao escolher o lead ganho, herda imóvel, cliente e valor do negócio.
  const escolherLead = (id: string) => {
    if (id === SEM) return set("lead_id", SEM);
    const lead = ganhos.find((l) => l.id === id);
    setForm((f) => ({
      ...f,
      lead_id: id,
      imovel_id: lead?.imovel_id ?? f.imovel_id,
      cliente_id: lead?.cliente_id ?? f.cliente_id,
      valor: lead?.valor_estimado != null ? String(lead.valor_estimado) : f.valor,
    }));
  };

  // Vindo do negócio ganho: já abre com o negócio escolhido.
  const aplicado = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      aplicado.current = null;
      return;
    }
    if (leadInicial && aplicado.current !== leadInicial && ganhos.some((l) => l.id === leadInicial)) {
      aplicado.current = leadInicial;
      escolherLead(leadInicial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadInicial, ganhos.length]);

  const trocarTipo = (tipo: ContratoTipo) => {
    setForm((f) => ({
      ...f,
      tipo,
      fim: tipo === "locacao" && !f.fim ? maisMeses(f.inicio, 30) : f.fim,
    }));
  };

  const salvar = useMutation({
    mutationFn: () =>
      apiPost<ContratoDetalhe>("/contratos", {
        request_id: requestId.current,
        tipo: form.tipo,
        lead_id: form.lead_id === SEM ? null : form.lead_id,
        imovel_id: form.imovel_id,
        cliente_id: form.cliente_id === SEM ? null : form.cliente_id,
        valor: num(form.valor),
        comissao_pct: num(form.comissao_pct) ?? 0,
        taxa_admin_pct: num(form.taxa_admin_pct) ?? 0,
        inicio: form.inicio,
        fim: form.tipo === "locacao" ? form.fim : form.fim || null,
        parcelas: form.parcelas ? Number(form.parcelas) : null,
        dia_vencimento: Number(form.dia_vencimento) || 10,
        observacoes: form.observacoes.trim() || null,
      }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["contratos"] });
      qc.invalidateQueries({ queryKey: ["transacoes"] });
      qc.invalidateQueries({ queryKey: ["resumo"] });
      toast.success(`Contrato ${c.numero} criado`, {
        description: `${c.transacoes.length} parcela(s) gerada(s), ${brl(c.total_gerado)} a receber`,
      });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["negocio"] });
      onClose();
      onCriado?.(c);
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível criar o contrato."),
  });

  const submeter = () => {
    if (form.imovel_id === SEM) return toast.error("Selecione o imóvel do contrato.");
    if (!num(form.valor)) return toast.error("Informe o valor do contrato.");
    if (form.tipo === "locacao" && !form.fim) return toast.error("Informe o fim da vigência.");
    salvar.mutate();
  };

  const valor = num(form.valor) ?? 0;
  const previsao =
    form.tipo === "venda"
      ? (valor * (num(form.comissao_pct) ?? 0)) / 100
      : (valor * (num(form.taxa_admin_pct) ?? 0)) / 100;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo contrato</DialogTitle>
          <DialogDescription>
            O contrato transforma o lead ganho em operação financeira: as parcelas a receber são
            geradas automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Tipo *</Label>
              <Select value={form.tipo} onValueChange={(v) => trocarTipo(v as ContratoTipo)}>
                <SelectTrigger data-testid="contrato-tipo-select">
                  <SelectValue>{form.tipo === "venda" ? "Venda" : "Locação"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="venda">Venda</SelectItem>
                  <SelectItem value="locacao">Locação</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Lead ganho (opcional)</Label>
              <Select value={form.lead_id} onValueChange={escolherLead}>
                <SelectTrigger data-testid="contrato-lead-select">
                  <SelectValue>
                    {form.lead_id === SEM
                      ? "Sem lead vinculado"
                      : (ganhos.find((l) => l.id === form.lead_id)?.nome ?? "Lead")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM}>Sem lead vinculado</SelectItem>
                  {ganhos.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Imóvel *</Label>
            <Select value={form.imovel_id} onValueChange={(v) => set("imovel_id", v)}>
              <SelectTrigger data-testid="contrato-imovel-select">
                <SelectValue>
                  {form.imovel_id === SEM
                    ? "Selecione o imóvel"
                    : (imoveis.find((i) => i.id === form.imovel_id)?.titulo ?? "Imóvel")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Selecione o imóvel</SelectItem>
                {imoveis.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.titulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Cliente (comprador/inquilino)</Label>
            <Select value={form.cliente_id} onValueChange={(v) => set("cliente_id", v)}>
              <SelectTrigger data-testid="contrato-cliente-select">
                <SelectValue>
                  {form.cliente_id === SEM
                    ? "Sem cliente vinculado"
                    : (pessoas.find((p) => p.id === form.cliente_id)?.nome ?? "Cliente")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Sem cliente vinculado</SelectItem>
                {pessoas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="contrato-valor">
                {form.tipo === "venda" ? "Valor da venda (R$) *" : "Aluguel mensal (R$) *"}
              </Label>
              <Input
                id="contrato-valor"
                inputMode="decimal"
                value={form.valor}
                onChange={(e) => set("valor", e.target.value)}
                data-testid="contrato-valor-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contrato-comissao">Comissão (%)</Label>
              <Input
                id="contrato-comissao"
                inputMode="decimal"
                value={form.comissao_pct}
                onChange={(e) => set("comissao_pct", e.target.value)}
                data-testid="contrato-comissao-input"
              />
            </div>
            {form.tipo === "locacao" && (
              <div className="grid gap-2">
                <Label htmlFor="contrato-taxa">Taxa de adm. (%)</Label>
                <Input
                  id="contrato-taxa"
                  inputMode="decimal"
                  value={form.taxa_admin_pct}
                  onChange={(e) => set("taxa_admin_pct", e.target.value)}
                  data-testid="contrato-taxa-input"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="contrato-inicio">Início *</Label>
              <Input
                id="contrato-inicio"
                type="date"
                value={form.inicio}
                onChange={(e) => set("inicio", e.target.value)}
                data-testid="contrato-inicio-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contrato-fim">
                Fim da vigência{form.tipo === "locacao" ? " *" : ""}
              </Label>
              <Input
                id="contrato-fim"
                type="date"
                value={form.fim}
                onChange={(e) => set("fim", e.target.value)}
                data-testid="contrato-fim-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contrato-parcelas">Parcelas</Label>
              <Input
                id="contrato-parcelas"
                inputMode="numeric"
                placeholder="auto"
                value={form.parcelas}
                onChange={(e) => set("parcelas", e.target.value)}
                data-testid="contrato-parcelas-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contrato-dia">Dia de venc.</Label>
              <Input
                id="contrato-dia"
                inputMode="numeric"
                value={form.dia_vencimento}
                onChange={(e) => set("dia_vencimento", e.target.value)}
                data-testid="contrato-dia-input"
              />
            </div>
          </div>

          <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground" data-testid="contrato-previsao">
            {form.tipo === "venda"
              ? `Serão geradas ${form.parcelas || 1} parcela(s) de comissão totalizando ${brl(previsao)}.`
              : `Serão geradas as taxas de administração mensais de ${brl(previsao)} durante a vigência${
                  form.parcelas ? ` (${form.parcelas} parcelas)` : ""
                }, mais a comissão de intermediação.`}
          </p>

          <div className="grid gap-2">
            <Label htmlFor="contrato-obs">Observações</Label>
            <Textarea
              id="contrato-obs"
              rows={2}
              value={form.observacoes}
              onChange={(e) => set("observacoes", e.target.value)}
              data-testid="contrato-obs-input"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose} data-testid="contrato-cancel-button">
            Cancelar
          </Button>
          <Button onClick={submeter} disabled={salvar.isPending} data-testid="contrato-submit-button">
            {salvar.isPending ? "Gerando..." : "Criar contrato e gerar parcelas"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
