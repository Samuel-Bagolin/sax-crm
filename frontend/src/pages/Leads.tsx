import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRightLeft, Inbox, Mail, MessageCircle, Phone, Plus, Search, Trash2, X } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { diasDesde, linkWhatsapp, useCrmConfig, useEquipe, useFunis } from "@/lib/crm";
import { parseNumber } from "@/lib/numbers";
import { useAuth } from "@/lib/useAuth";
import { useItemSegmento } from "@/lib/itemSegmento";
import { useSegmento } from "@/lib/segmento";
import type { Entrada, Imovel, InteresseEntrada, Lead, StatusEntrada } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Avatar from "@/components/shared/Avatar";
import Combo from "@/components/shared/Combo";
import { cn } from "@/lib/utils";

const INTERESSE: Record<InteresseEntrada, string> = { compra: "Comprar", locacao: "Alugar", venda: "Vender", outro: "Outro" };

/** O que o lead quer, conforme o segmento. Nos segmentos de atendimento não há essa escolha. */
function interessesDo(seg: string): InteresseEntrada[] {
  if (seg === "imobiliaria") return ["compra", "locacao", "venda"];
  if (seg === "veiculos") return ["compra", "venda", "outro"];
  return [];
}
function rotuloInteresse(seg: string, k: InteresseEntrada) {
  if (seg === "veiculos") return k === "venda" ? "Vender o carro" : k === "outro" ? "Troca" : "Comprar";
  return INTERESSE[k];
}
const ABAS: { v: StatusEntrada | "ativos" | "fila"; rotulo: string }[] = [
  { v: "ativos", rotulo: "Para atender" },
  { v: "fila", rotulo: "Fila livre" },
  { v: "convertido", rotulo: "Convertidos" },
  { v: "descartado", rotulo: "Descartados" },
];

function idade(iso: string): string {
  const d = diasDesde(iso);
  if (d === 0) {
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
    return h <= 0 ? "agora" : `${h}h`;
  }
  return `${d}d`;
}

function NovoLeadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const { data: config } = useCrmConfig();
  const { data: equipe = [] } = useEquipe();
  const item = useItemSegmento(open);
  const seg = useSegmento();
  const interesses = interessesDo(seg.chave);
  const [f, setF] = useState({ nome: "", telefone: "", email: "", origem: "", interesse: "compra" as InteresseEntrada, mensagem: "", imovel_id: null as string | null, valor: "", corretor_id: "" });
  const origemPadrao = config?.origens[0] ?? "Manual";
  // Limpa o formulário só quando o diálogo abre. Antes, cada atualização da configuração do CRM
  // (ao voltar para a aba, por exemplo) apagava o que já tinha sido digitado.
  useEffect(() => {
    if (open) setF({ nome: "", telefone: "", email: "", origem: origemPadrao, interesse: "compra", mensagem: "", imovel_id: null, valor: "", corretor_id: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const salvar = useMutation({
    mutationFn: () =>
      apiPost<Entrada>("/entradas", {
        nome: f.nome.trim(),
        telefone: f.telefone.trim() || null,
        email: f.email.trim() || null,
        origem: f.origem,
        interesse: f.interesse,
        mensagem: f.mensagem.trim() || null,
        ...(item.campo ? { [item.campo]: f.imovel_id } : {}),
        valor_estimado: parseNumber(f.valor),
        corretor_id: isAdmin ? f.corretor_id || null : undefined,
      }),
    onSuccess: () => {
      toast.success("Lead adicionado");
      qc.invalidateQueries({ queryKey: ["entradas"] });
      onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar o lead"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo lead</DialogTitle>
          <DialogDescription>Contato que ainda não foi qualificado. Depois do primeiro atendimento, converta em negócio.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (f.nome.trim()) salvar.mutate();
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ld-nome">Nome</Label>
            <Input id="ld-nome" autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} data-testid="lead-nome" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ld-tel">WhatsApp / telefone</Label>
            <Input id="ld-tel" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} placeholder="(41) 99999-9999" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ld-mail">E-mail</Label>
            <Input id="ld-mail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ld-origem">Origem</Label>
            <select id="ld-origem" value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value })} className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30">
              {(config?.origens ?? ["Manual"]).map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>
          {interesses.length > 0 && <div className="space-y-1.5">
            <Label>Quer</Label>
            <div className="flex gap-1">
              {interesses.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setF({ ...f, interesse: k })}
                  className={cn("h-8 flex-1 rounded-md border text-xs", f.interesse === k ? "border-primary bg-accent font-medium" : "hover:bg-muted")}
                >
                  {rotuloInteresse(seg.chave, k)}
                </button>
              ))}
            </div>
          </div>}
          {item.campo ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{item.rotulo}</Label>
              <Combo
                opcoes={item.opcoes.map((i) => ({ valor: i.id, rotulo: i.titulo, detalhe: i.detalhe }))}
                valor={f.imovel_id}
                onChange={(v) => setF({ ...f, imovel_id: v, valor: f.valor || String(item.opcoes.find((i) => i.id === v)?.valor ?? "") })}
                placeholder="Opcional"
              />
            </div>
          ) : (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ld-msg">O que procura</Label>
              <Input id="ld-msg" value={f.mensagem} onChange={(e) => setF({ ...f, mensagem: e.target.value })} placeholder={seg.odonto ? "Ex.: implante, clareamento, dor de dente" : "Ex.: toxina, preenchimento labial"} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ld-valor">Orçamento (R$)</Label>
            <Input id="ld-valor" inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} />
          </div>
          {isAdmin && (
            <div className="space-y-1.5">
              <Label htmlFor="ld-resp">Responsável</Label>
              <select id="ld-resp" value={f.corretor_id} onChange={(e) => setF({ ...f, corretor_id: e.target.value })} className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30">
                <option value="">{config?.distribuicao === "rodizio" ? "Rodízio automático" : "Triagem do gestor"}</option>
                {equipe.filter((m) => m.pessoa_id).map((m) => (
                  <option key={m.usuario_id} value={m.pessoa_id!}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ld-msg">Mensagem / observação</Label>
            <Textarea id="ld-msg" rows={2} value={f.mensagem} onChange={(e) => setF({ ...f, mensagem: e.target.value })} />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!f.nome.trim() || salvar.isPending} data-testid="lead-salvar">
              Adicionar lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConverterDialog({ entrada, onClose }: { entrada: Entrada | null; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { data: funis = [] } = useFunis();
  const { data: equipe = [] } = useEquipe();
  const [funilId, setFunilId] = useState("");
  const [etapaId, setEtapaId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [valor, setValor] = useState("");
  const [corretor, setCorretor] = useState("");

  useEffect(() => {
    if (!entrada) return;
    const preferido = funis.find((f) => (entrada.interesse === "locacao" ? f.nome.toLowerCase().includes("loca") : f.padrao)) ?? funis[0];
    setFunilId(preferido?.id ?? "");
    setEtapaId(preferido?.etapas[1]?.id ?? preferido?.etapas[0]?.id ?? "");
    setTitulo(`${entrada.nome} — ${entrada.interesse === "locacao" ? "Locação" : entrada.interesse === "venda" ? "Captação" : "Compra"}`);
    setValor(entrada.valor_estimado?.toString() ?? "");
    setCorretor(entrada.corretor_id ?? "");
  }, [entrada, funis]);

  const funil = funis.find((f) => f.id === funilId);
  const converter = useMutation({
    mutationFn: () =>
      apiPost<Lead>(`/entradas/${entrada!.id}/converter`, {
        funil_id: funilId,
        etapa_id: etapaId,
        titulo: titulo.trim(),
        valor_estimado: parseNumber(valor),
        corretor_id: isAdmin ? corretor || null : undefined,
      }),
    onSuccess: (lead) => {
      toast.success("Lead convertido em negócio");
      qc.invalidateQueries({ queryKey: ["entradas"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      onClose();
      navigate(`/negocios/${lead.id}`);
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível converter"),
  });

  return (
    <Dialog open={!!entrada} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Converter em negócio</DialogTitle>
          <DialogDescription>O contato vira cliente e entra no funil escolhido.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cv-titulo">Título do negócio</Label>
            <Input id="cv-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="cv-funil">Funil</Label>
              <select
                id="cv-funil"
                value={funilId}
                onChange={(e) => {
                  setFunilId(e.target.value);
                  setEtapaId(funis.find((f) => f.id === e.target.value)?.etapas[0]?.id ?? "");
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
              <Label htmlFor="cv-etapa">Etapa</Label>
              <select id="cv-etapa" value={etapaId} onChange={(e) => setEtapaId(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30">
                {funil?.etapas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="cv-valor">Valor (R$)</Label>
              <Input id="cv-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
            </div>
            {isAdmin && (
              <div className="space-y-1.5">
                <Label htmlFor="cv-resp">Responsável</Label>
                <select id="cv-resp" value={corretor} onChange={(e) => setCorretor(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30">
                  <option value="">Sem responsável</option>
                  {equipe.filter((m) => m.pessoa_id).map((m) => (
                    <option key={m.usuario_id} value={m.pessoa_id!}>
                      {m.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={converter.isPending || !funilId} onClick={() => converter.mutate()} data-testid="converter-confirmar">
            Converter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Contagem do SLA de primeiro atendimento (só para leads ainda não contatados). */
function SlaChip({ e, sla, agora }: { e: Entrada; sla: number | null | undefined; agora: number }) {
  if (!sla || e.status !== "novo" || e.primeiro_contato_em) return null;
  const passados = (agora - new Date(e.created_at).getTime()) / 60000;
  const restam = sla - passados;
  const fmt = (m: number) => (m < 60 ? `${Math.max(1, Math.round(m))} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`);
  const estourou = restam <= 0;
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold",
        estourou ? "bg-atrasada/10 text-atrasada" : restam < sla * 0.34 ? "bg-sem-atividade/15 text-[#8a5a00] dark:text-sem-atividade" : "bg-hoje/10 text-hoje",
      )}
      title={`SLA de primeiro atendimento: ${sla} min`}
      data-testid="sla-chip"
    >
      {estourou ? `SLA estourado há ${fmt(-restam)}` : `Responder em ${fmt(restam)}`}
    </span>
  );
}

export default function Leads() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { isAdmin } = useAuth();
  const { data: equipe = [] } = useEquipe();
  const { data: config } = useCrmConfig();
  const [aba, setAba] = useState<StatusEntrada | "ativos" | "fila">("ativos");
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<string | null>(params.get("id"));
  const [novo, setNovo] = useState(params.get("novo") === "1");
  const [converter, setConverter] = useState<Entrada | null>(null);
  const [descartar, setDescartar] = useState<Entrada | null>(null);
  const [motivo, setMotivo] = useState("");

  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const { data: entradas = [], isLoading } = useQuery({
    queryKey: ["entradas", aba],
    queryFn: () => apiGet<Entrada[]>(`/entradas?status=${aba}`),
  });
  const item = useItemSegmento();
  const seg = useSegmento();
  const { data: contagem } = useQuery({ queryKey: ["entradas", "contagem"], queryFn: () => apiGet<{ novos: number; fila: number }>("/entradas/contagem") });
  const pegar = useMutation({
    mutationFn: (id: string) => apiPost<Entrada>(`/entradas/${id}/pegar`),
    onSuccess: (e) => {
      toast.success(`O lead ${e.nome.split(" ")[0]} agora é seu. Faça o primeiro contato.`);
      qc.invalidateQueries({ queryKey: ["entradas"] });
      setAba("ativos");
      setSelecionado(e.id);
    },
    onError: (err) => {
      toast.error(detalheErro(err) ?? "Não foi possível pegar o lead");
      qc.invalidateQueries({ queryKey: ["entradas"] });
    },
  });
  const itemDe = (e: Entrada) => item.opcoes.find((i) => i.id === (item.campo === "veiculo_id" ? e.veiculo_id : e.imovel_id));

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return t ? entradas.filter((e) => [e.nome, e.telefone, e.email, e.origem, e.mensagem].filter(Boolean).some((x) => x!.toLowerCase().includes(t))) : entradas;
  }, [entradas, busca]);
  const atual = entradas.find((e) => e.id === selecionado) ?? null;
  const pessoaDe = (id: string | null) => (id ? equipe.find((m) => m.pessoa_id === id) : undefined);

  const atualizar = useMutation({
    mutationFn: ({ id, corpo }: { id: string; corpo: Record<string, unknown> }) => apiPatch<Entrada>(`/entradas/${id}`, corpo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["entradas"] }),
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível atualizar"),
  });
  const excluir = useMutation({
    mutationFn: (id: string) => apiDelete(`/entradas/${id}`),
    onSuccess: () => {
      setSelecionado(null);
      qc.invalidateQueries({ queryKey: ["entradas"] });
      toast.success("Lead excluído");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível excluir"),
  });

  const contatar = (e: Entrada, canal: "whatsapp" | "tel" | "mail") => {
    if (e.status === "novo") atualizar.mutate({ id: e.id, corpo: { status: "em_contato" } });
    if (canal === "whatsapp") {
      const url = linkWhatsapp(e.telefone, `Olá ${e.nome.split(" ")[0]}, recebi seu contato. Posso te ajudar?`);
      if (url) window.open(url, "_blank", "noopener");
    } else if (canal === "tel" && e.telefone) window.location.href = `tel:${e.telefone}`;
    else if (canal === "mail" && e.email) window.location.href = `mailto:${e.email}`;
  };

  const fecharNovo = () => {
    setNovo(false);
    if (params.get("novo")) {
      params.delete("novo");
      setParams(params, { replace: true });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border bg-card p-0.5">
          {ABAS.map((a) => (
            <button
              key={a.v}
              onClick={() => setAba(a.v)}
              className={cn("h-7 rounded px-3 text-xs font-medium", aba === a.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {a.rotulo}
              {a.v === "fila" && (contagem?.fila ?? 0) > 0 && <span className="ml-1.5 rounded-full bg-[#ff7a00] px-1.5 text-[10px] font-bold text-white">{contagem!.fila}</span>}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, telefone, origem" className="h-8 bg-card pl-8" />
        </div>
        <Button className="ml-auto" onClick={() => setNovo(true)} data-testid="btn-novo-lead">
          <Plus className="h-4 w-4" /> Lead
        </Button>
      </div>

      <div className={cn("grid gap-4", atual && "lg:grid-cols-[1fr_380px]")}>
        <div className="overflow-hidden rounded-lg border bg-card">
          {isLoading ? (
            <div className="h-40 animate-pulse bg-muted/40" />
          ) : !filtradas.length ? (
            <div className="px-6 py-16 text-center">
              <Inbox className="mx-auto mb-2 h-9 w-9 text-muted-foreground/50" />
              <p className="font-medium">{aba === "ativos" ? "Caixa de entrada vazia" : "Nada por aqui"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {aba === "ativos" ? "Leads do site, portais e WhatsApp aparecem aqui para o primeiro atendimento." : "Ajuste a busca ou troque de aba."}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {filtradas.map((e) => {
                const resp = pessoaDe(e.corretor_id);
                const imovel = itemDe(e);
                return (
                  <li
                    key={e.id}
                    className={cn("flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/40", selecionado === e.id && "bg-accent/60")}
                    onClick={() => setSelecionado(e.id)}
                    data-testid={`lead-${e.id}`}
                  >
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", e.status === "novo" ? "bg-primary" : "bg-transparent")} title={e.status === "novo" ? "Ainda não contatado" : undefined} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={cn("truncate text-sm", e.status === "novo" ? "font-semibold" : "font-medium")}>{e.nome}</p>
                        <span className="shrink-0 rounded-sm bg-muted px-1.5 text-[11px] text-muted-foreground">{e.origem}</span>
                        {seg.vendas && <span className="shrink-0 text-[11px] text-muted-foreground">{rotuloInteresse(seg.chave, e.interesse)}</span>}
                        <SlaChip e={e} sla={config?.sla_primeiro_contato_min} agora={agora} />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {e.mensagem || imovel?.titulo || e.telefone || e.email || "Sem mensagem"}
                      </p>
                    </div>
                    {e.valor_estimado ? <span className="num hidden text-xs font-medium sm:block">{brl(e.valor_estimado)}</span> : null}
                    {resp ? (
                      <Avatar nome={resp.nome} usuarioId={resp.usuario_id} temFoto={resp.tem_foto} versao={resp.foto_v} tamanho="xs" />
                    ) : (
                      e.na_fila ? <span className="rounded-full bg-[#ff7a00]/15 px-2 text-[10px] font-semibold text-[#c25800]">Fila livre</span>
                        : isAdmin && <span className="rounded-full border border-dashed px-2 text-[10px] text-muted-foreground">Triagem</span>
                    )}
                    <span className="w-8 shrink-0 text-right text-xs text-muted-foreground">{idade(e.created_at)}</span>
                    {e.na_fila ? (
                      <Button size="sm" onClick={(ev) => { ev.stopPropagation(); pegar.mutate(e.id); }} disabled={pegar.isPending} data-testid={`pegar-${e.id}`}>
                        Pegar lead
                      </Button>
                    ) : e.status !== "convertido" && e.status !== "descartado" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="hidden md:inline-flex"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setConverter(e);
                        }}
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" /> Converter
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {atual && (
          <aside className="h-fit rounded-lg border bg-card lg:sticky lg:top-20">
            <header className="flex items-start gap-3 border-b p-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold">{atual.nome}</h2>
                <p className="text-xs text-muted-foreground">
                  {atual.origem}, há {idade(atual.created_at)}
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setSelecionado(null)} aria-label="Fechar">
                <X className="h-4 w-4" />
              </Button>
            </header>
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" disabled={!atual.telefone} onClick={() => contatar(atual, "whatsapp")} className="h-9">
                  <MessageCircle className="h-4 w-4 text-[#1da851]" /> WhatsApp
                </Button>
                <Button variant="outline" size="sm" disabled={!atual.telefone} onClick={() => contatar(atual, "tel")} className="h-9">
                  <Phone className="h-4 w-4" /> Ligar
                </Button>
                <Button variant="outline" size="sm" disabled={!atual.email} onClick={() => contatar(atual, "mail")} className="h-9">
                  <Mail className="h-4 w-4" /> E-mail
                </Button>
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Telefone</dt>
                  <dd>{atual.telefone ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">E-mail</dt>
                  <dd className="truncate">{atual.email ?? "—"}</dd>
                </div>
                {seg.vendas && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Interesse</dt>
                    <dd>{rotuloInteresse(seg.chave, atual.interesse)}</dd>
                  </div>
                )}
                {item.campo && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{item.tipo === "veiculo" ? "Veículo" : "Imóvel"}</dt>
                    <dd className="truncate">{itemDe(atual)?.titulo ?? "Não informado"}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Orçamento</dt>
                  <dd className="num">{brl(atual.valor_estimado)}</dd>
                </div>
              </dl>
              {atual.mensagem && <p className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-sm">{atual.mensagem}</p>}
              {isAdmin && atual.status !== "convertido" && (
                <div className="space-y-1.5">
                  <Label htmlFor="ld-atrib">Responsável</Label>
                  <select
                    id="ld-atrib"
                    value={atual.corretor_id ?? ""}
                    onChange={(e) => atualizar.mutate({ id: atual.id, corpo: { corretor_id: e.target.value || null } })}
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
                  >
                    <option value="">Triagem do gestor</option>
                    {equipe.filter((m) => m.pessoa_id).map((m) => (
                      <option key={m.usuario_id} value={m.pessoa_id!}>
                        {m.nome}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {atual.na_fila && (
                <div className="space-y-2 rounded-lg border border-[#ff7a00]/40 bg-[#ff7a00]/5 p-3 text-sm">
                  <p>Este lead ficou {config?.repescagem_horas ?? 24}h sem atendimento{atual.devolvido_de ? ` com ${pessoaDe(atual.devolvido_de)?.nome.split(" ")[0] ?? "o vendedor anterior"}` : ""} e está na fila livre. Quem pegar primeiro fica com ele.</p>
                  <Button className="w-full" onClick={() => pegar.mutate(atual.id)} disabled={pegar.isPending}>Pegar lead</Button>
                </div>
              )}
              {atual.na_fila ? null : atual.status === "convertido" ? (
                <Button className="w-full" onClick={() => navigate(`/negocios/${atual.negocio_id}`)}>
                  Abrir negócio
                </Button>
              ) : atual.status === "descartado" ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Descartado: {atual.motivo_descarte ?? "sem motivo"}</p>
                  <Button variant="outline" className="w-full" onClick={() => atualizar.mutate({ id: atual.id, corpo: { status: "em_contato" } })}>
                    Voltar para atendimento
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => setConverter(atual)} data-testid="lead-converter">
                    <ArrowRightLeft className="h-4 w-4" /> Converter em negócio
                  </Button>
                  <Button variant="outline" onClick={() => setDescartar(atual)}>
                    Descartar
                  </Button>
                </div>
              )}
              {isAdmin && atual.status !== "convertido" && (
                <button onClick={() => excluir.mutate(atual.id)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3 w-3" /> Excluir lead
                </button>
              )}
            </div>
          </aside>
        )}
      </div>

      <NovoLeadDialog open={novo} onClose={fecharNovo} />
      <ConverterDialog entrada={converter} onClose={() => setConverter(null)} />
      <Dialog open={!!descartar} onOpenChange={(v) => !v && setDescartar(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Descartar lead</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5">
            {["Contato inválido", "Sem interesse", "Fora do perfil", "Duplicado", ...(config?.motivos_perda.slice(0, 2) ?? [])].map((m) => (
              <button key={m} onClick={() => setMotivo(m)} className={cn("rounded-full border px-3 py-1 text-xs", motivo === m ? "border-primary bg-accent" : "hover:bg-muted")}>
                {m}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDescartar(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                atualizar.mutate({ id: descartar!.id, corpo: { status: "descartado", motivo_descarte: motivo || null } });
                setDescartar(null);
                setMotivo("");
                setSelecionado(null);
              }}
            >
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
