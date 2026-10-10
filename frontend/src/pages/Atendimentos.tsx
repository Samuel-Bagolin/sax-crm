import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  MessageCircle,
  Plus,
  Settings2,
  UserRound,
  UserX,
  X,
} from "lucide-react";
import { apiGet, apiPatch, apiPost, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { isoLocal } from "@/lib/crm";
import {
  STATUS_AG,
  hhmm,
  linkWhatsConfirmacao,
  minutos,
  useProfissionais,
  useServicos,
  type AgendaConfig,
  type Agendamento,
  type Profissional,
} from "@/lib/atendimentos";
import AgendaOnline, { ProfissionalDialog } from "@/pages/AgendaOnline";
import { useSegmento } from "@/lib/segmento";
import { useAuth } from "@/lib/useAuth";
import { useConfig } from "@/lib/useConfig";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Combo from "@/components/shared/Combo";
import { cn } from "@/lib/utils";

const PX_POR_MIN = 1.4;
const INICIO_DIA = 7 * 60;
const FIM_DIA = 22 * 60;

function somarDias(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoLocal(new Date(y, m - 1, d + n));
}
function rotuloDia(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
}

interface Resumo {
  hoje: Agendamento[];
  proximos_7_dias: number;
  mes: { agendados: number; concluidos: number; faltas: number; taxa_falta: number; faturado: number; ticket_medio: number | null; online: number };
}

interface UnidadeLite { id: string; nome: string; ativa: boolean; principal: boolean }

export default function Atendimentos() {
  const hoje = isoLocal(new Date());
  const [dia, setDia] = useState(hoje);
  const [novo, setNovo] = useState<{ profissional_id?: string; inicio?: string } | null>(null);
  const [aberto, setAberto] = useState<Agendamento | null>(null);
  const [profSel, setProfSel] = useState<string | null>(null);
  const [unidadeSel, setUnidadeSel] = useState<string | null>(null);
  const [configurar, setConfigurar] = useState<string | null>(null);
  const [editarProf, setEditarProf] = useState<Profissional | null>(null);
  const seg = useSegmento();
  const { isAdmin, principal } = useAuth();
  const profs = useProfissionais();
  const equipe = useProfissionais(true);
  const unidades = useQuery({ queryKey: ["unidades"], queryFn: () => apiGet<UnidadeLite[]>("/unidades") });
  const cfgLink = useQuery({ queryKey: ["agenda-config"], queryFn: () => apiGet<AgendaConfig>("/atendimentos/config") });
  const lista = useQuery({
    queryKey: ["agendamentos", dia],
    queryFn: () => apiGet<Agendamento[]>(`/atendimentos?inicio=${dia}&fim=${dia}`),
    refetchInterval: 60_000,
  });
  const resumo = useQuery({ queryKey: ["atendimentos-resumo"], queryFn: () => apiGet<Resumo>("/atendimentos/resumo") });

  const ativasU = (unidades.data ?? []).filter((u) => u.ativa);
  const principalU = ativasU.find((u) => u.principal)?.id;
  const daUnidade = (p: Profissional) => !unidadeSel || p.unidade_ids.includes(unidadeSel) || (!p.unidade_ids.length && unidadeSel === principalU);
  const todos = (profs.data ?? []).filter(daUnidade);
  const colunas = profSel ? todos.filter((p) => p.id === profSel) : todos;
  const doDia = (lista.data ?? []).filter((a) => a.status !== "cancelado" && (!unidadeSel || (a.unidade_id ?? principalU) === unidadeSel));
  const agoraMin = new Date().getHours() * 60 + new Date().getMinutes();
  const semProfissionais = !profs.isLoading && !(profs.data ?? []).length;
  const selecionado = (profs.data ?? []).find((p) => p.id === profSel) ?? null;
  const linkNoAr = !!(cfgLink.data?.ativo && cfgLink.data.slug);
  const urlBase = cfgLink.data?.slug ? `${window.location.origin}/agendar/${cfgLink.data.slug}` : "";
  const podeEditar = (p: Profissional) => isAdmin || p.id === principal?.usuario_id;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo={`${seg.termos.atendimentos} hoje`} valor={String(resumo.data?.hoje.length ?? "-")} />
        <Indicador rotulo="Faturado no mês" valor={resumo.data ? brl(resumo.data.mes.faturado) : "-"} detalhe={resumo.data?.mes.ticket_medio ? `ticket médio ${brl(resumo.data.mes.ticket_medio)}` : undefined} />
        <Indicador rotulo="Faltas no mês" valor={resumo.data ? `${resumo.data.mes.taxa_falta}%` : "-"} detalhe={resumo.data ? `${resumo.data.mes.faltas} falta(s)` : undefined} />
        <Indicador rotulo="Pelo link online" valor={String(resumo.data?.mes.online ?? "-")} detalhe="no mês" />
      </div>

      {semProfissionais ? (
        <PrimeiraAgenda equipe={equipe.data ?? []} carregando={equipe.isLoading} onAbrir={setEditarProf} podeEditar={podeEditar} />
      ) : (
        <>
          {/* Quem atende: escolha um profissional para ver só a agenda dele, ajustar o horário e copiar o link. */}
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              {ativasU.length > 1 && (
                <select aria-label={seg.termos.unidade} value={unidadeSel ?? ""} onChange={(e) => { setUnidadeSel(e.target.value || null); setProfSel(null); }}
                  className="h-8 rounded-full border bg-background px-3 text-sm" data-testid="filtro-unidade">
                  <option value="">Todas as {seg.termos.unidades.toLowerCase()}</option>
                  {ativasU.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              )}
              <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label={seg.termos.profissionais}>
                <Chip ativo={!profSel} onClick={() => setProfSel(null)}>Todos</Chip>
                {todos.map((p) => (
                  <Chip key={p.id} ativo={profSel === p.id} onClick={() => setProfSel(profSel === p.id ? null : p.id)} testid={`chip-prof-${p.id}`}>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{p.nome.charAt(0)}</span>
                    {p.nome.split(" ")[0]}
                  </Chip>
                ))}
              </div>
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={() => setConfigurar("servicos")} data-testid="configurar-agenda">
                  <Settings2 className="h-4 w-4" /> {seg.termos.itens} e regras
                </Button>
              )}
            </div>
            {selecionado && (
              <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3 sm:flex-row sm:items-center" data-testid="faixa-link">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Link de agendamento de {selecionado.nome.split(" ")[0]}</p>
                  {linkNoAr && selecionado.slug && selecionado.online ? (
                    <p className="truncate text-sm text-muted-foreground" title={`${urlBase}/${selecionado.slug}`}>{`${urlBase}/${selecionado.slug}`}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {!linkNoAr ? "O link de agendamento da empresa ainda não está no ar." : `${selecionado.nome.split(" ")[0]} não recebe agendamento online. Ative em Horários.`}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {linkNoAr && selecionado.slug && selecionado.online ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(`${urlBase}/${selecionado.slug}`).then(() => toast.success("Link copiado"))} data-testid="copiar-link-prof"><Copy className="h-3.5 w-3.5" /> Copiar</Button>
                      <a className={buttonVariants({ size: "sm", variant: "outline" })} target="_blank" rel="noopener noreferrer"
                        href={`https://wa.me/?text=${encodeURIComponent(`Agende seu horário com ${selecionado.nome.split(" ")[0]}: ${urlBase}/${selecionado.slug}`)}`}><MessageCircle className="h-3.5 w-3.5" /> Enviar</a>
                      <a className={buttonVariants({ size: "sm", variant: "outline" })} href={`${urlBase}/${selecionado.slug}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Abrir</a>
                    </>
                  ) : !linkNoAr && isAdmin ? (
                    <Button size="sm" onClick={() => setConfigurar("link")} data-testid="ativar-link">Colocar link no ar</Button>
                  ) : null}
                  {podeEditar(selecionado) && <Button size="sm" variant="outline" onClick={() => setEditarProf(selecionado)} data-testid="horarios-prof"><Clock className="h-3.5 w-3.5" /> Horários</Button>}
                </div>
              </div>
            )}
            {!selecionado && linkNoAr && (
              <p className="flex flex-wrap items-center gap-1.5 px-1 text-xs text-muted-foreground">
                Link da agenda completa: <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => navigator.clipboard.writeText(urlBase).then(() => toast.success("Link copiado"))}>{urlBase}</button>. Escolha um {seg.termos.profissional.toLowerCase()} para o link individual.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={() => setDia(somarDias(dia, -1))} aria-label="Dia anterior"><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" onClick={() => setDia(hoje)} disabled={dia === hoje}>Hoje</Button>
              <Button variant="outline" size="icon" onClick={() => setDia(somarDias(dia, 1))} aria-label="Próximo dia"><ChevronRight className="h-4 w-4" /></Button>
              <Input type="date" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} className="ml-1 w-40" aria-label="Escolher data" />
            </div>
            <p className="font-semibold capitalize sm:ml-2">{rotuloDia(dia)}</p>
            <Button className="sm:ml-auto" onClick={() => setNovo(profSel ? { profissional_id: profSel } : {})} data-testid="novo-agendamento">
              <Plus className="h-4 w-4" /> Agendar
            </Button>
          </div>

          {!colunas.length ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Ninguém atende nesta {seg.termos.unidade.toLowerCase()}. Vincule {seg.termos.profissionais.toLowerCase()} em Horários.</p>
          ) : (
        <div className="overflow-x-auto rounded-xl border bg-card" data-testid="grade-agenda">
          <div className="grid min-w-max" style={{ gridTemplateColumns: `56px repeat(${colunas.length}, minmax(180px, 1fr))` }}>            <div className="sticky left-0 z-20 border-b bg-card" />
            {colunas.map((p) => (
              <div key={p.id} className="border-b border-l px-3 py-2">
                <p className="truncate text-sm font-semibold">{p.nome}</p>
                <p className="text-xs text-muted-foreground">{doDia.filter((a) => a.profissional_id === p.id).length} {seg.termos.atendimentos.toLowerCase()}</p>
              </div>
            ))}
            <div className="sticky left-0 z-10 bg-card">
              {Array.from({ length: (FIM_DIA - INICIO_DIA) / 60 }, (_, i) => (
                <div key={i} className="relative border-t text-[11px] text-muted-foreground" style={{ height: 60 * PX_POR_MIN }}>
                  <span className="absolute -top-2 right-2 bg-card px-0.5">{hhmm(INICIO_DIA + i * 60)}</span>
                </div>
              ))}
            </div>
            {colunas.map((p) => (
              <div key={p.id} className="relative border-l" style={{ height: (FIM_DIA - INICIO_DIA) * PX_POR_MIN }}>
                {Array.from({ length: ((FIM_DIA - INICIO_DIA) / 30) }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Agendar às ${hhmm(INICIO_DIA + i * 30)} com ${p.nome}`}
                    onClick={() => setNovo({ profissional_id: p.id, inicio: hhmm(INICIO_DIA + i * 30) })}
                    className={cn("block w-full hover:bg-accent/40", i % 2 ? "border-t border-dashed border-border/50" : "border-t")}
                    style={{ height: 30 * PX_POR_MIN }}
                  />
                ))}
                {dia === hoje && agoraMin > INICIO_DIA && agoraMin < FIM_DIA && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-red-500" style={{ top: (agoraMin - INICIO_DIA) * PX_POR_MIN }} />
                )}
                {doDia.filter((a) => a.profissional_id === p.id).map((a) => {
                  const ini = Math.max(minutos(a.inicio), INICIO_DIA);
                  const alt = Math.max(24, (minutos(a.fim) - ini) * PX_POR_MIN - 2);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAberto(a)}
                      className={cn("absolute inset-x-1 z-10 overflow-hidden rounded-md border-l-4 px-2 text-left text-xs shadow-sm", STATUS_AG[a.status].classe)}
                      style={{ top: (ini - INICIO_DIA) * PX_POR_MIN + 1, height: alt, paddingTop: alt < 48 ? 2 : 4, paddingBottom: alt < 48 ? 2 : 4 }}
                      data-testid={`ag-${a.id}`}
                    >
                      {alt < 48 ? (
                        <p className="flex items-center gap-1 truncate leading-tight">
                          <span className="font-semibold">{a.inicio}</span>
                          {a.origem === "online" && <Globe className="h-3 w-3 shrink-0" aria-label="Agendado pelo link" />}
                          <span className="truncate font-medium">{a.cliente_nome}</span>
                        </p>
                      ) : (
                        <>
                          <p className="flex items-center gap-1 font-semibold">
                            {a.inicio} {a.origem === "online" && <Globe className="h-3 w-3" aria-label="Agendado pelo link" />}
                          </p>
                          <p className="truncate font-medium">{a.cliente_nome}</p>
                        </>
                      )}
                      {alt > 50 && <p className="truncate opacity-75">{a.servicos.map((s) => s.nome).join(", ")}</p>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
          )}
        </>
      )}

      <Dialog open={!!configurar} onOpenChange={(o) => !o && setConfigurar(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader><DialogTitle>Configurar agenda</DialogTitle><DialogDescription>{seg.termos.itens}, horários de cada {seg.termos.profissional.toLowerCase()} e regras do link de agendamento.</DialogDescription></DialogHeader>
          {configurar && <AgendaOnline abaInicial={configurar} />}
        </DialogContent>
      </Dialog>
      <ProfissionalDialog prof={editarProf} onClose={() => setEditarProf(null)} />

      <NovoAgendamento
        aberto={!!novo}
        inicial={novo ?? {}}
        dia={dia}
        onClose={() => setNovo(null)}
        repetir={seg.chave === "terapia"}
        podeEncaixe={isAdmin}
        proprio={principal?.usuario_id}
      />
      <DetalheAgendamento agendamento={aberto} onClose={() => setAberto(null)} />
    </div>
  );
}

function Chip({ ativo, onClick, children, testid }: { ativo: boolean; onClick: () => void; children: React.ReactNode; testid?: string }) {
  return (
    <button type="button" role="tab" aria-selected={ativo} onClick={onClick} data-testid={testid}
      className={cn("flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm", ativo ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
      {children}
    </button>
  );
}

/** Primeira vez: ninguém atende ainda. Mostra a equipe e abre a agenda de quem for escolhido. */
function PrimeiraAgenda({ equipe, carregando, onAbrir, podeEditar }: { equipe: Profissional[]; carregando: boolean; onAbrir: (p: Profissional) => void; podeEditar: (p: Profissional) => boolean }) {
  const seg = useSegmento();
  return (
    <div className="rounded-xl border border-dashed p-6 sm:p-8">
      <CalendarClock className="h-8 w-8 text-muted-foreground" />
      <p className="mt-2 text-lg font-semibold">Abra a agenda de quem atende</p>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">Escolha o {seg.termos.profissional.toLowerCase()}, marque os dias e horários de trabalho e pronto: a agenda dele aparece aqui e o link de agendamento dele fica disponível para enviar aos {seg.termos.clientes.toLowerCase()}.</p>
      {carregando ? <div className="mt-4 h-24 animate-pulse rounded-lg bg-muted" /> : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {equipe.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 font-bold text-primary">{p.nome.charAt(0)}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{p.nome}</span>
              {podeEditar(p) && <Button size="sm" onClick={() => onAbrir(p)} data-testid={`abrir-agenda-${p.id}`}>Abrir agenda</Button>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Para incluir alguém na lista, cadastre em Equipe.</p>
    </div>
  );
}

function Indicador({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="num mt-1 text-xl font-bold sm:text-2xl">{valor}</p>
      {detalhe && <p className="text-[11px] text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

function NovoAgendamento({
  aberto,
  inicial,
  dia,
  onClose,
  repetir,
  podeEncaixe,
  proprio,
}: {
  aberto: boolean;
  inicial: { profissional_id?: string; inicio?: string };
  dia: string;
  onClose: () => void;
  repetir: boolean;
  podeEncaixe: boolean;
  proprio?: string;
}) {
  const qc = useQueryClient();
  const seg = useSegmento();
  const profs = useProfissionais();
  const servicos = useServicos();
  const clientes = useQuery({
    queryKey: ["pacientes-lista"],
    queryFn: () => apiGet<{ id: string; nome: string; telefone: string | null }[]>("/pacientes"),
    enabled: aberto,
  });
  const [f, setF] = useState({ profissional_id: "", servico_ids: [] as string[], data: dia, inicio: "", cliente_id: null as string | null, cliente_nome: "", cliente_telefone: "", observacoes: "", repetir_semanas: 0, encaixe: false });

  useEffect(() => {
    if (aberto) {
      setF({ profissional_id: inicial.profissional_id ?? (profs.data?.find((p) => p.id === proprio)?.id ?? profs.data?.[0]?.id ?? ""), servico_ids: [], data: dia,
        inicio: inicial.inicio ?? "", cliente_id: null, cliente_nome: "", cliente_telefone: "", observacoes: "", repetir_semanas: 0, encaixe: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const livres = useQuery({
    queryKey: ["horarios", f.profissional_id, f.data, f.servico_ids.join(",")],
    queryFn: () => apiGet<{ duracao_min: number; horarios: string[] }>(`/atendimentos/horarios?profissional_id=${f.profissional_id}&data=${f.data}&servico_ids=${f.servico_ids.join(",")}`),
    enabled: aberto && !!f.profissional_id && f.servico_ids.length > 0 && !!f.data,
  });
  const ativos = (servicos.data ?? []).filter((s) => s.ativo);
  const total = ativos.filter((s) => f.servico_ids.includes(s.id)).reduce((a, s) => a + s.preco, 0);

  const salvar = useMutation({
    mutationFn: () => apiPost<{ criados: Agendamento[]; conflitos: { data: string; motivo: string }[] }>("/atendimentos", {
      ...f, cliente_id: f.cliente_id, cliente_nome: f.cliente_id ? null : f.cliente_nome, cliente_telefone: f.cliente_id ? null : f.cliente_telefone,
      observacoes: f.observacoes || null,
    }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["agendamentos"] });
      qc.invalidateQueries({ queryKey: ["atendimentos-resumo"] });
      qc.invalidateQueries({ queryKey: ["pacientes-lista"] });
      toast.success(r.criados.length > 1 ? `${r.criados.length} ${seg.termos.atendimentos.toLowerCase()} agendados` : "Agendado");
      if (r.conflitos.length) toast.warning(`${r.conflitos.length} data(s) com conflito ficaram de fora: ${r.conflitos.map((c) => c.data.split("-").reverse().join("/")).join(", ")}`);
      onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível agendar"),
  });

  const horaValida = f.encaixe ? /^\d{2}:\d{2}$/.test(f.inicio) : !!livres.data?.horarios.includes(f.inicio);
  const ok = f.profissional_id && f.servico_ids.length && horaValida && (f.cliente_id || f.cliente_nome.trim().length > 1);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agendar</DialogTitle>
          <DialogDescription>Os horários livres já consideram a jornada, os bloqueios e o que está marcado.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>{seg.termos.cliente}</Label>
            <Combo
              opcoes={(clientes.data ?? []).map((c) => ({ valor: c.id, rotulo: c.nome, detalhe: c.telefone }))}
              valor={f.cliente_id}
              onChange={(v) => setF({ ...f, cliente_id: v })}
              placeholder={`Buscar ${seg.termos.cliente.toLowerCase()}`}
              onCriar={(t) => setF({ ...f, cliente_id: null, cliente_nome: t })}
              rotuloCriar={`Novo ${seg.termos.cliente.toLowerCase()}`}
              testid="ag-cliente"
            />
            {!f.cliente_id && f.cliente_nome && (
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-2">
                <Input value={f.cliente_nome} onChange={(e) => setF({ ...f, cliente_nome: e.target.value })} placeholder="Nome" aria-label="Nome" />
                <Input value={f.cliente_telefone} onChange={(e) => setF({ ...f, cliente_telefone: e.target.value })} placeholder="WhatsApp" inputMode="tel" aria-label="WhatsApp" />
              </div>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Serviços</Label>
            <div className="flex flex-wrap gap-1.5">
              {ativos.map((s) => {
                const on = f.servico_ids.includes(s.id);
                return (
                  <button key={s.id} type="button" onClick={() => setF({ ...f, servico_ids: on ? f.servico_ids.filter((x) => x !== s.id) : [...f.servico_ids, s.id], inicio: f.encaixe ? f.inicio : "" })}
                    className={cn("rounded-full border px-3 py-1 text-sm", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                    {s.nome} <span className="opacity-70">{s.duracao_min} min</span>
                  </button>
                );
              })}
            </div>
            {total > 0 && <p className="text-xs text-muted-foreground">Total previsto: {brl(total)}{livres.data ? `, ${livres.data.duracao_min} min` : ""}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ag-prof">{seg.termos.profissional}</Label>
              <select id="ag-prof" className="h-9 rounded-lg border bg-transparent px-2 text-sm" value={f.profissional_id} onChange={(e) => setF({ ...f, profissional_id: e.target.value, inicio: "" })}>
                {(profs.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ag-data">Data</Label>
              <Input id="ag-data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value, inicio: "" })} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Horário</Label>
            {!f.servico_ids.length ? <p className="text-sm text-muted-foreground">Escolha o serviço para ver os horários livres.</p> : f.encaixe ? (
              <Input type="time" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} className="w-32" />
            ) : livres.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : livres.data?.horarios.length ? (
              <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                {livres.data.horarios.filter((h) => minutos(h) % 15 === 0).map((h) => (
                  <button key={h} type="button" onClick={() => setF({ ...f, inicio: h })} className={cn("rounded-md border px-2.5 py-1 text-sm", f.inicio === h ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{h}</button>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">Sem horário livre neste dia.</p>}
            {podeEncaixe && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={f.encaixe} onChange={(e) => setF({ ...f, encaixe: e.target.checked })} className="accent-[var(--primary)]" /> Encaixe fora da jornada
              </label>
            )}
          </div>
          {repetir && (
            <div className="grid gap-1.5">
              <Label htmlFor="ag-rep">Repetir toda semana</Label>
              <select id="ag-rep" className="h-9 w-48 rounded-lg border bg-transparent px-2 text-sm" value={f.repetir_semanas} onChange={(e) => setF({ ...f, repetir_semanas: Number(e.target.value) })}>
                <option value={0}>Não repetir</option>
                {[3, 7, 11, 23].map((n) => <option key={n} value={n}>Mais {n} semanas</option>)}
              </select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="ag-obs">Observações</Label>
            <Textarea id="ag-obs" rows={2} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={!ok || salvar.isPending} data-testid="ag-salvar">
            {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetalheAgendamento({ agendamento: a, onClose }: { agendamento: Agendamento | null; onClose: () => void }) {
  const qc = useQueryClient();
  const seg = useSegmento();
  const { config } = useConfig();
  const [cobrar, setCobrar] = useState(false);
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState("pix");
  useEffect(() => {
    if (a) {
      setCobrar(false);
      setValor(String(a.valor));
      setForma("pix");
    }
  }, [a]);
  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ["agendamentos"] });
    qc.invalidateQueries({ queryKey: ["atendimentos-resumo"] });
  };
  const status = useMutation({
    mutationFn: (s: string) => apiPatch(`/atendimentos/${a!.id}`, { status: s }),
    onSuccess: () => { atualizar(); onClose(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível alterar"),
  });
  const concluir = useMutation({
    mutationFn: () => apiPost(`/atendimentos/${a!.id}/concluir`, { valor: Number(valor.replace(",", ".")) || 0, forma_pagamento: forma }),
    onSuccess: () => { atualizar(); toast.success("Concluído e lançado no Financeiro"); onClose(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível concluir"),
  });
  if (!a) return null;
  const whats = linkWhatsConfirmacao(a, config.nome_software);
  const ativo = ["agendado", "confirmado", "em_atendimento"].includes(a.status);
  return (
    <Dialog open={!!a} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{a.cliente_nome}</DialogTitle>
          <DialogDescription>
            {a.data.split("-").reverse().join("/")}, {a.inicio} às {a.fim} com {a.profissional_nome}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", STATUS_AG[a.status].classe)}>{STATUS_AG[a.status].rotulo}</span>
            {a.origem === "online" && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"><Globe className="h-3 w-3" /> Agendado pelo link</span>}
          </div>
          <p>{a.servicos.map((s) => s.nome).join(", ")}, <b>{brl(a.valor_cobrado ?? a.valor)}</b></p>
          {a.observacoes && <p className="rounded-lg bg-muted/50 p-2 text-muted-foreground">{a.observacoes}</p>}
          <div className="flex flex-wrap gap-2">
            <Link to={`/pacientes/${a.cliente_id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted"><UserRound className="h-4 w-4" /> Ficha do {seg.termos.cliente.toLowerCase()}</Link>
            {whats && ativo && <a href={whats} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted"><MessageCircle className="h-4 w-4" /> Confirmar no WhatsApp</a>}
          </div>
          {cobrar && (
            <div className="grid gap-2 rounded-lg border p-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1"><Label htmlFor="c-valor">Valor cobrado</Label><Input id="c-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></div>
                <div className="grid gap-1"><Label htmlFor="c-forma">Pagamento</Label>
                  <select id="c-forma" className="h-9 rounded-lg border bg-transparent px-2 text-sm" value={forma} onChange={(e) => setForma(e.target.value)}>
                    <option value="pix">PIX</option><option value="dinheiro">Dinheiro</option><option value="debito">Débito</option><option value="credito">Crédito</option><option value="pendente">Fica a receber</option><option value="outro">Outro</option>
                  </select>
                </div>
              </div>
              <Button onClick={() => concluir.mutate()} disabled={concluir.isPending} data-testid="ag-concluir-confirmar">
                {concluir.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Concluir e lançar no caixa
              </Button>
            </div>
          )}
        </div>
        {ativo && !cobrar && (
          <DialogFooter className="flex-wrap gap-2 sm:justify-start">
            {a.status === "agendado" && <Button variant="outline" size="sm" onClick={() => status.mutate("confirmado")}><Check className="h-4 w-4" /> Confirmado</Button>}
            <Button size="sm" onClick={() => setCobrar(true)} data-testid="ag-concluir"><CircleDollarSign className="h-4 w-4" /> Concluir</Button>
            <Button variant="outline" size="sm" onClick={() => status.mutate("faltou")}><UserX className="h-4 w-4" /> Faltou</Button>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => status.mutate("cancelado")}><X className="h-4 w-4" /> Cancelar</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
