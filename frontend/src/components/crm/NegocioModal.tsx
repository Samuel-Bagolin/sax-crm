import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost, detalheErro } from "@/lib/api";
import { parseNumber } from "@/lib/numbers";
import { useCrmConfig, useEquipe, useFunis } from "@/lib/crm";
import { useAuth } from "@/lib/useAuth";
import type { Lead, Pessoa } from "@/lib/types";
import { useItemSegmento } from "@/lib/itemSegmento";
import { useSegmento } from "@/lib/segmento";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Combo from "@/components/shared/Combo";
import { cn } from "@/lib/utils";

interface Form {
  nome: string;
  cliente_id: string | null;
  novoCliente: { nome: string; telefone: string; email: string } | null;
  imovel_id: string | null;
  valor: string;
  funil_id: string;
  etapa_id: string;
  corretor_id: string | null;
  origem: string;
  previsao: string;
  etiquetas: string[];
  observacoes: string;
}

export default function NegocioModal({
  open,
  onClose,
  negocio,
  funilInicial,
  etapaInicial,
  onCriado,
}: {
  open: boolean;
  onClose: () => void;
  negocio?: Lead | null;
  funilInicial?: string | null;
  etapaInicial?: string | null;
  onCriado?: (lead: Lead) => void;
}) {
  const qc = useQueryClient();
  const { isAdmin, principal } = useAuth();
  const { data: funis = [] } = useFunis();
  const { data: config } = useCrmConfig();
  const { data: equipe = [] } = useEquipe();
  const { data: pessoas = [] } = useQuery({ queryKey: ["pessoas"], queryFn: () => apiGet<Pessoa[]>("/pessoas"), enabled: open });
  const item = useItemSegmento(open);
  const seg = useSegmento();

  const vazio = (): Form => {
    const funil = funis.find((f) => f.id === funilInicial) ?? funis.find((f) => f.padrao) ?? funis[0];
    return {
      nome: "",
      cliente_id: null,
      novoCliente: null,
      imovel_id: null,
      valor: "",
      funil_id: funil?.id ?? "",
      etapa_id: etapaInicial ?? funil?.etapas[0]?.id ?? "",
      corretor_id: isAdmin ? null : principal?.pessoa_id ?? null,
      origem: config?.origens[0] ?? "Indicação / Carteira",
      previsao: "",
      etiquetas: [],
      observacoes: "",
    };
  };
  const [form, setForm] = useState<Form>(vazio);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    if (negocio) {
      setForm({
        nome: negocio.nome,
        cliente_id: negocio.cliente_id,
        novoCliente: null,
        imovel_id: (item.campo === "veiculo_id" ? negocio.veiculo_id : negocio.imovel_id) ?? null,
        valor: negocio.valor_estimado?.toString() ?? "",
        funil_id: negocio.funil_id ?? "",
        etapa_id: negocio.etapa_id ?? "",
        corretor_id: negocio.corretor_id,
        origem: negocio.origem,
        previsao: negocio.previsao_fechamento ?? "",
        etiquetas: negocio.etiquetas ?? [],
        observacoes: negocio.observacoes ?? "",
      });
    } else {
      setForm(vazio());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, negocio, funis.length, config?.origens.length]);

  const funil = funis.find((f) => f.id === form.funil_id);
  const imovel = item.opcoes.find((i) => i.id === form.imovel_id);
  const corretores = equipe.filter((m) => m.pessoa_id);

  const opcoesClientes = useMemo(
    () => pessoas.filter((p) => !p.papeis.includes("corretor")).map((p) => ({ valor: p.id, rotulo: p.nome, detalhe: p.telefone || p.email })),
    [pessoas],
  );
  const opcoesImoveis = useMemo(
    () => item.opcoes.map((i) => ({ valor: i.id, rotulo: i.titulo, detalhe: i.detalhe })),
    [item.opcoes],
  );

  const salvar = useMutation({
    mutationFn: async () => {
      let clienteId = form.cliente_id;
      if (form.novoCliente) {
        const p = await apiPost<Pessoa>("/pessoas", {
          nome: form.novoCliente.nome.trim(),
          papeis: ["cliente"],
          cpf_cnpj: null,
          telefone: form.novoCliente.telefone.trim() || null,
          email: form.novoCliente.email.trim().toLowerCase() || null,
        });
        clienteId = p.id;
      }
      const nomeCliente = form.novoCliente?.nome ?? pessoas.find((p) => p.id === clienteId)?.nome;
      const corpo = {
        nome: form.nome.trim() || `${nomeCliente ?? "Novo negócio"}${imovel ? `, ${imovel.titulo}` : ""}`,
        cliente_id: clienteId,
        ...(item.campo === "veiculo_id" ? { veiculo_id: form.imovel_id } : item.campo === "imovel_id" ? { imovel_id: form.imovel_id } : {}),
        valor_estimado: parseNumber(form.valor),
        funil_id: form.funil_id || null,
        etapa_id: form.etapa_id || null,
        corretor_id: isAdmin ? form.corretor_id : undefined,
        origem: form.origem,
        previsao_fechamento: form.previsao || null,
        etiquetas: form.etiquetas,
        observacoes: form.observacoes.trim() || null,
      };
      return negocio ? apiPatch<Lead>(`/leads/${negocio.id}`, corpo) : apiPost<Lead>("/leads", corpo);
    },
    onSuccess: (lead) => {
      toast.success(negocio ? "Negócio atualizado" : "Negócio criado");
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["negocio"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["pessoas"] });
      qc.invalidateQueries({ queryKey: ["equipe"] });
      onCriado?.(lead);
      onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar o negócio"),
  });

  const podeSalvar = (form.cliente_id || form.novoCliente?.nome.trim() || form.nome.trim()) && form.funil_id;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{negocio ? "Editar negócio" : "Novo negócio"}</DialogTitle>
          <DialogDescription>{item.campo ? `Quem é o ${seg.termos.cliente.toLowerCase()}, qual ${item.nome} e em que etapa a conversa está.` : `Quem é o ${seg.termos.cliente.toLowerCase()} e em que etapa a conversa está.`}</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (podeSalvar) salvar.mutate();
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{seg.termos.cliente}</Label>
            {form.novoCliente ? (
              <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 sm:grid-cols-3">
                <Input
                  value={form.novoCliente.nome}
                  onChange={(e) => set("novoCliente", { ...form.novoCliente!, nome: e.target.value })}
                  placeholder="Nome"
                  aria-label="Nome do cliente"
                />
                <Input
                  value={form.novoCliente.telefone}
                  onChange={(e) => set("novoCliente", { ...form.novoCliente!, telefone: e.target.value })}
                  placeholder="WhatsApp / telefone"
                  aria-label="Telefone do cliente"
                />
                <Input
                  value={form.novoCliente.email}
                  onChange={(e) => set("novoCliente", { ...form.novoCliente!, email: e.target.value })}
                  placeholder="E-mail"
                  aria-label="E-mail do cliente"
                />
                <button type="button" className="text-left text-xs text-primary sm:col-span-3" onClick={() => set("novoCliente", null)}>
                  Escolher um cliente já cadastrado
                </button>
              </div>
            ) : (
              <Combo
                opcoes={opcoesClientes}
                valor={form.cliente_id}
                onChange={(v) => set("cliente_id", v)}
                placeholder={`Buscar ${seg.termos.cliente.toLowerCase()} por nome ou telefone`}
                onCriar={(texto) => setForm((f) => ({ ...f, cliente_id: null, novoCliente: { nome: texto, telefone: "", email: "" } }))}
                rotuloCriar={`Novo ${seg.termos.cliente.toLowerCase()}`}
                testid="negocio-cliente"
              />
            )}
          </div>

          {item.campo && <div className="space-y-1.5 sm:col-span-2">
            <Label>{item.rotulo}</Label>
            <Combo
              opcoes={opcoesImoveis}
              valor={form.imovel_id}
              onChange={(v) => {
                const im = item.opcoes.find((i) => i.id === v);
                setForm((f) => ({
                  ...f,
                  imovel_id: v,
                  valor: f.valor || String(im?.valor ?? ""),
                }));
              }}
              placeholder={item.busca}
              testid="negocio-imovel"
            />
          </div>}

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="neg-nome">Título do negócio</Label>
            <Input
              id="neg-nome"
              value={form.nome}
              onChange={(e) => set("nome", e.target.value)}
              placeholder={item.campo ? `Deixe em branco para usar ${seg.termos.cliente.toLowerCase()} + ${item.nome}` : `Deixe em branco para usar o nome do ${seg.termos.cliente.toLowerCase()}`}
              data-testid="negocio-nome"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="neg-valor">Valor (R$)</Label>
            <Input id="neg-valor" inputMode="decimal" value={form.valor} onChange={(e) => set("valor", e.target.value)} placeholder="0,00" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="neg-prev">Previsão de fechamento</Label>
            <Input id="neg-prev" type="date" value={form.previsao} onChange={(e) => set("previsao", e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="neg-funil">Funil</Label>
            <select
              id="neg-funil"
              value={form.funil_id}
              onChange={(e) => {
                const f = funis.find((x) => x.id === e.target.value);
                setForm((s) => ({ ...s, funil_id: e.target.value, etapa_id: f?.etapas[0]?.id ?? "" }));
              }}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
            >
              {funis.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="neg-origem">Origem</Label>
            <select
              id="neg-origem"
              value={form.origem}
              onChange={(e) => set("origem", e.target.value)}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
            >
              {[...new Set([...(config?.origens ?? []), form.origem])].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>

          {funil && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Etapa</Label>
              <div className="flex overflow-x-auto pb-1">
                {funil.etapas.map((e, i) => {
                  const ativa = form.etapa_id === e.id;
                  const passou = funil.etapas.findIndex((x) => x.id === form.etapa_id) >= i;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => set("etapa_id", e.id)}
                      className={cn(
                        "etapa-seta -ml-1 h-8 min-w-[92px] flex-1 px-4 text-xs font-medium transition-colors first:ml-0",
                        passou ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent",
                        ativa && "ring-0",
                      )}
                      title={`${e.nome} (${e.probabilidade}%)`}
                    >
                      <span className="line-clamp-1">{e.nome}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {isAdmin && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Responsável</Label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => set("corretor_id", null)}
                  className={cn("rounded-full border px-3 py-1 text-xs", !form.corretor_id ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted")}
                >
                  Sem responsável
                </button>
                {corretores.map((m) => (
                  <button
                    key={m.usuario_id}
                    type="button"
                    onClick={() => set("corretor_id", m.pessoa_id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs",
                      form.corretor_id === m.pessoa_id ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted",
                    )}
                  >
                    {m.nome}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!!config?.etiquetas.length && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Etiquetas</Label>
              <div className="flex flex-wrap gap-1.5">
                {config.etiquetas.map((t) => {
                  const marcada = form.etiquetas.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => set("etiquetas", marcada ? form.etiquetas.filter((x) => x !== t) : [...form.etiquetas, t])}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs",
                        marcada ? "border-latao bg-latao/15 text-foreground" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="neg-obs">Observações</Label>
            <Textarea id="neg-obs" rows={3} value={form.observacoes} onChange={(e) => set("observacoes", e.target.value)} />
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!podeSalvar || salvar.isPending} data-testid="negocio-salvar">
              {salvar.isPending ? "Salvando…" : negocio ? "Salvar alterações" : "Criar negócio"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
