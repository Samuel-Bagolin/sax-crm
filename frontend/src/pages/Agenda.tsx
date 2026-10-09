import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BellRing, CalendarDays, Check, ChevronLeft, ChevronRight, Home, Plus, Users } from "lucide-react";
import { apiGet, apiPatch, apiPost, detalheErro } from "@/lib/api";
import { ATIVIDADE, corDoMembro, isoLocal, useEquipe } from "@/lib/crm";
import { useAuth } from "@/lib/useAuth";
import type { Atividade, Imovel, Lead, LembreteResultado, MembroEquipe, Pessoa, Visita } from "@/lib/types";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/shared/Avatar";
import AtividadeModal, { type PadraoAtividade } from "@/components/crm/AtividadeModal";
import VisitaModal from "@/components/agenda/VisitaModal";
import { cn } from "@/lib/utils";
import type { EventoGoogle } from "@/lib/google";

type Visao = "dia" | "semana" | "mes" | "lista";

interface Evento {
  id: string;
  origem: "atividade" | "visita" | "google";
  titulo: string;
  data: string;
  hora: string | null;
  duracao: number;
  corretor_id: string | null;
  concluida: boolean;
  negocio_id: string | null;
  icone: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  bruto: Atividade | Visita | EventoGoogle;
}

/** "G" do Google para os compromissos que vêm do Google Agenda. */
function IconeGoogle({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-label="Google Agenda">
      <path fill="currentColor" d="M21.35 11.1H12v3.2h5.35c-.5 2.4-2.6 3.9-5.35 3.9a6.2 6.2 0 1 1 3.95-11l2.3-2.3A9.4 9.4 0 1 0 21.5 12c0-.3 0-.6-.15-.9z" />
    </svg>
  );
}

const HORA_INICIO = 7;
const HORA_FIM = 21;
const PX_HORA = 52;
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function minutos(h: string) {
  return Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
}
function addDias(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function inicioSemana(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // semana começa na segunda
  return x;
}

/** Distribui eventos sobrepostos em faixas lado a lado. */
function faixas(eventos: Evento[]) {
  const comHora = eventos.filter((e) => e.hora).sort((a, b) => minutos(a.hora!) - minutos(b.hora!));
  const fim: number[] = [];
  const pos = new Map<string, { faixa: number; total: number }>();
  const grupo: Evento[] = [];
  let fimGrupo = -1;
  const fechar = () => {
    const total = Math.max(1, ...grupo.map((g) => pos.get(g.id)!.faixa + 1));
    grupo.forEach((g) => pos.set(g.id, { ...pos.get(g.id)!, total }));
    grupo.length = 0;
    fim.length = 0;
  };
  for (const e of comHora) {
    const ini = minutos(e.hora!);
    if (ini >= fimGrupo && grupo.length) fechar();
    let f = fim.findIndex((x) => x <= ini);
    if (f === -1) f = fim.length;
    fim[f] = ini + e.duracao;
    pos.set(e.id, { faixa: f, total: 1 });
    grupo.push(e);
    fimGrupo = Math.max(fimGrupo, ini + e.duracao);
  }
  if (grupo.length) fechar();
  return pos;
}

function BlocoEvento({ e, cor, onClick, compacto }: { e: Evento; cor: string; onClick: () => void; compacto?: boolean }) {
  const Icone = e.icone;
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex w-full min-w-0 items-start gap-1 overflow-hidden rounded-[5px] border-l-[3px] px-1.5 py-0.5 text-left text-[11px] leading-tight transition-[filter] hover:brightness-95",
        e.concluida && "opacity-55",
      )}
      style={{ borderLeftColor: cor, backgroundColor: `color-mix(in oklab, ${cor} 14%, var(--card))` }}
      title={`${e.hora ?? "Dia todo"} ${e.titulo}`}
    >
      <Icone className="mt-px h-3 w-3 shrink-0" style={{ color: cor }} />
      <span className={cn("min-w-0 flex-1", compacto ? "truncate" : "line-clamp-3")}>
        {e.hora && <span className="num mr-1 font-semibold">{e.hora}</span>}
        <span className={cn(e.concluida && "line-through")}>{e.titulo}</span>
      </span>
    </button>
  );
}

function GradeHoras({
  colunas,
  eventosPor,
  corDe,
  onAbrir,
  onNovo,
  hoje,
}: {
  colunas: { chave: string; titulo: React.ReactNode; data: string; corretor?: string | null; destaque?: boolean }[];
  eventosPor: (chave: string) => Evento[];
  corDe: (e: Evento) => string;
  onAbrir: (e: Evento) => void;
  onNovo: (data: string, hora: string | null, corretor?: string | null) => void;
  hoje: string;
}) {
  const horas = Array.from({ length: HORA_FIM - HORA_INICIO }, (_, i) => HORA_INICIO + i);
  const agora = new Date();
  const minAgora = agora.getHours() * 60 + agora.getMinutes();
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card scroll-fino">
      <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `52px repeat(${colunas.length}, minmax(120px, 1fr))` }}>
        {/* cabeçalho */}
        <div className="sticky top-0 z-20 border-b bg-card" />
        {colunas.map((c) => (
          <div key={c.chave} className={cn("sticky top-0 z-20 border-b border-l bg-card px-2 py-2", c.destaque && "bg-accent")}>
            {c.titulo}
          </div>
        ))}
        {/* dia todo */}
        <div className="border-b px-1 py-1 text-right text-[10px] text-muted-foreground">dia todo</div>
        {colunas.map((c) => {
          const semHora = eventosPor(c.chave).filter((e) => !e.hora);
          return (
            <div key={c.chave} className="min-h-8 space-y-0.5 border-b border-l p-0.5" onClick={() => onNovo(c.data, null, c.corretor)}>
              {semHora.map((e) => (
                <BlocoEvento key={e.id} e={e} cor={corDe(e)} onClick={() => onAbrir(e)} compacto />
              ))}
            </div>
          );
        })}
        {/* horas */}
        <div className="relative">
          {horas.map((h) => (
            <div key={h} className="relative border-b border-transparent text-right" style={{ height: PX_HORA }}>
              <span className="num absolute -top-2 right-1.5 text-[10px] text-muted-foreground">{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>
        {colunas.map((c) => {
          const lista = eventosPor(c.chave).filter((e) => e.hora);
          const pos = faixas(lista);
          return (
            <div key={c.chave} className="relative border-l" data-testid={`coluna-agenda-${c.chave}`}>
              {horas.map((h) => (
                <div
                  key={h}
                  className="border-b border-border/60 hover:bg-accent/40"
                  style={{ height: PX_HORA }}
                  onClick={() => onNovo(c.data, `${String(h).padStart(2, "0")}:00`, c.corretor)}
                />
              ))}
              {c.data === hoje && minAgora >= HORA_INICIO * 60 && minAgora <= HORA_FIM * 60 && (
                <div className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-atrasada" style={{ top: ((minAgora - HORA_INICIO * 60) / 60) * PX_HORA }}>
                  <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-atrasada" />
                </div>
              )}
              {lista.map((e) => {
                const ini = Math.max(minutos(e.hora!), HORA_INICIO * 60);
                const top = ((ini - HORA_INICIO * 60) / 60) * PX_HORA;
                const altura = Math.max((e.duracao / 60) * PX_HORA - 2, 20);
                const p = pos.get(e.id) ?? { faixa: 0, total: 1 };
                return (
                  <div
                    key={e.id}
                    className="absolute z-[5] px-0.5"
                    style={{ top, height: altura, left: `${(p.faixa / p.total) * 100}%`, width: `${100 / p.total}%` }}
                  >
                    <div className="h-full [&>button]:h-full">
                      <BlocoEvento e={e} cor={corDe(e)} onClick={() => onAbrir(e)} compacto={altura < 34} />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Agenda() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { isAdmin, principal } = useAuth();
  const { data: equipe = [] } = useEquipe();
  const membros = equipe.filter((m) => m.pessoa_id);

  const [visao, setVisao] = useState<Visao>(isAdmin ? "dia" : "semana");
  const [base, setBase] = useState(() => new Date());
  const [corretor, setCorretor] = useState<string | null>(params.get("corretor"));
  const [atividade, setAtividade] = useState<{ a: Atividade | null; padrao?: PadraoAtividade } | null>(
    params.get("nova") === "atividade" ? { a: null } : null,
  );
  const [visita, setVisita] = useState<{ v: Visita | null; data: string; corretor?: string | null; hora?: string } | null>(null);

  const hoje = isoLocal(new Date());
  const { inicio, fim, dias } = useMemo(() => {
    if (visao === "dia") return { inicio: isoLocal(base), fim: isoLocal(base), dias: [new Date(base)] };
    if (visao === "semana") {
      const s = inicioSemana(base);
      const ds = Array.from({ length: 7 }, (_, i) => addDias(s, i));
      return { inicio: isoLocal(ds[0]), fim: isoLocal(ds[6]), dias: ds };
    }
    if (visao === "mes") {
      const primeiro = new Date(base.getFullYear(), base.getMonth(), 1);
      const s = inicioSemana(primeiro);
      const ds = Array.from({ length: 42 }, (_, i) => addDias(s, i));
      return { inicio: isoLocal(ds[0]), fim: isoLocal(ds[41]), dias: ds };
    }
    const ds = Array.from({ length: 21 }, (_, i) => addDias(base, i));
    return { inicio: isoLocal(addDias(base, -30)), fim: isoLocal(ds[20]), dias: ds };
  }, [visao, base]);

  const filtroCorretor = isAdmin && corretor ? `&corretor_id=${corretor}` : "";
  const { data: atividades = [] } = useQuery({
    queryKey: ["atividades", "agenda", inicio, fim, corretor],
    queryFn: () => apiGet<Atividade[]>(`/atividades?inicio=${inicio}&fim=${fim}${filtroCorretor}`),
  });
  // Compromissos do Google: os próprios com título; de um corretor (visão do gestor) só "ocupado".
  const { data: doGoogle = [] } = useQuery({
    queryKey: ["google", "eventos", inicio, fim, corretor, isAdmin, membros.length],
    queryFn: async () => {
      if (isAdmin && !corretor) {
        const listas = await Promise.all(
          membros.map((m) => apiGet<EventoGoogle[]>(`/google/eventos?inicio=${inicio}&fim=${fim}&corretor_id=${m.pessoa_id}`).catch(() => [])),
        );
        return listas.flat();
      }
      const alvo = corretor && corretor !== principal?.pessoa_id ? `&corretor_id=${corretor}` : "";
      return apiGet<EventoGoogle[]>(`/google/eventos?inicio=${inicio}&fim=${fim}${alvo}`).catch(() => []);
    },
    staleTime: 60_000,
  });
  const { data: visitas = [] } = useQuery({
    queryKey: ["visitas", "agenda", inicio, fim, corretor],
    queryFn: () => apiGet<Visita[]>(`/visitas?inicio=${inicio}&fim=${fim}${filtroCorretor}`),
  });
  const { data: leads = [] } = useQuery({ queryKey: ["leads"], queryFn: () => apiGet<Lead[]>("/leads"), enabled: !!visita });
  const { data: imoveis = [] } = useQuery({ queryKey: ["imoveis"], queryFn: () => apiGet<Imovel[]>("/imoveis"), enabled: !!visita });
  const { data: pessoas = [] } = useQuery({ queryKey: ["pessoas"], queryFn: () => apiGet<Pessoa[]>("/pessoas"), enabled: !!visita });

  const eventos: Evento[] = useMemo(() => {
    const a: Evento[] = atividades.map((x) => ({
      id: `a-${x.id}`,
      origem: "atividade",
      titulo: x.assunto,
      data: x.data,
      hora: x.hora,
      duracao: x.duracao_min,
      corretor_id: x.corretor_id,
      concluida: x.concluida,
      negocio_id: x.negocio_id,
      icone: ATIVIDADE[x.tipo]?.icon ?? CalendarDays,
      bruto: x,
    }));
    const v: Evento[] = visitas
      .filter((x) => x.status !== "cancelada")
      .map((x) => ({
        id: `v-${x.id}`,
        origem: "visita",
        titulo: x.titulo,
        data: x.data,
        hora: x.hora,
        duracao: x.duracao_min,
        corretor_id: x.corretor_id,
        concluida: x.status === "realizada",
        negocio_id: x.lead_id,
        icone: Home,
        bruto: x,
      }));
    const g: Evento[] = doGoogle.map((x) => {
      const ini = new Date(x.inicio);
      const fimG = new Date(x.fim);
      const data = x.dia_todo ? x.inicio.slice(0, 10) : isoLocal(ini);
      return {
        id: `g-${x.corretor_id}-${x.id}`,
        origem: "google" as const,
        titulo: x.titulo,
        data,
        hora: x.dia_todo ? null : `${String(ini.getHours()).padStart(2, "0")}:${String(ini.getMinutes()).padStart(2, "0")}`,
        duracao: x.dia_todo ? 30 : Math.max(15, Math.round((fimG.getTime() - ini.getTime()) / 60000)),
        corretor_id: x.corretor_id,
        concluida: false,
        negocio_id: null,
        icone: IconeGoogle,
        bruto: x,
      };
    });
    return [...a, ...v, ...g];
  }, [atividades, visitas, doGoogle]);

  const membroDe = (pid: string | null) => (pid ? membros.find((m) => m.pessoa_id === pid) : undefined);
  const corDe = (e: Evento) => {
    if (e.origem === "google") return "#8a8499";
    const m = membroDe(e.corretor_id);
    return m ? corDoMembro(m, membros.indexOf(m)) : "#7b8a85";
  };

  const abrir = (e: Evento) => {
    if (e.origem === "google") {
      const g = e.bruto as EventoGoogle;
      if (g.link) window.open(g.link, "_blank", "noopener");
      else toast("Horário ocupado no Google Agenda do corretor (detalhes são privados).");
      return;
    }
    if (e.origem === "atividade") setAtividade({ a: e.bruto as Atividade });
    else setVisita({ v: e.bruto as Visita, data: e.data });
  };
  const novo = (data: string, hora: string | null, corr?: string | null) =>
    setAtividade({ a: null, padrao: { data, hora, corretor_id: corr ?? corretor ?? principal?.pessoa_id ?? null } });

  const concluir = useMutation({
    mutationFn: (a: Atividade) => apiPatch(`/atividades/${a.id}`, { concluida: !a.concluida }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["atividades"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["equipe"] });
    },
  });
  const lembretes = useMutation({
    mutationFn: () => apiPost<LembreteResultado>("/visitas/lembretes"),
    onSuccess: (r) => toast.success(`Lembretes de amanhã: ${r.emails_enviados} e-mail(s) na fila`),
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível enviar os lembretes"),
  });

  const navegar = (dir: number) => {
    if (dir === 0) return setBase(new Date());
    const n = new Date(base);
    if (visao === "dia") n.setDate(n.getDate() + dir);
    else if (visao === "semana") n.setDate(n.getDate() + 7 * dir);
    else if (visao === "mes") n.setMonth(n.getMonth() + dir);
    else n.setDate(n.getDate() + 14 * dir);
    setBase(n);
  };

  const rotulo =
    visao === "dia"
      ? base.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })
      : visao === "mes"
        ? base.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
        : `${dias[0].toLocaleDateString("pt-BR", { day: "numeric", month: "short" })} a ${dias[dias.length - 1].toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}`;

  const selecionado = corretor ? membroDe(corretor) : null;
  const modoEquipe = isAdmin && !corretor && visao === "dia";

  const escolherCorretor = (pid: string | null) => {
    setCorretor(pid);
    if (pid) {
      params.set("corretor", pid);
      if (visao === "dia") setVisao("semana");
    } else params.delete("corretor");
    setParams(params, { replace: true });
  };

  const fecharAtividade = () => {
    setAtividade(null);
    if (params.get("nova")) {
      params.delete("nova");
      setParams(params, { replace: true });
    }
  };

  // ------------------------------------------------------------- colunas da grade
  const colunasDias = dias.map((d) => {
    const iso = isoLocal(d);
    return {
      chave: iso,
      data: iso,
      corretor: corretor,
      destaque: iso === hoje,
      titulo: (
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs text-muted-foreground">{DIAS[d.getDay()]}</span>
          <span className={cn("num text-base font-semibold", iso === hoje && "flex h-6 w-6 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground")}>{d.getDate()}</span>
        </div>
      ),
    };
  });
  const colunasEquipe = membros.map((m, i) => ({
    chave: m.pessoa_id!,
    data: inicio,
    corretor: m.pessoa_id,
    titulo: (
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => escolherCorretor(m.pessoa_id)} title={`Abrir a agenda de ${m.nome}`}>
        <Avatar nome={m.nome} usuarioId={m.usuario_id} temFoto={m.tem_foto} versao={m.foto_v} cor={corDoMembro(m, i)} tamanho="sm" />
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold hover:underline">{m.nome}</span>
          <span className="block text-[10px] text-muted-foreground">
            {eventos.filter((e) => e.corretor_id === m.pessoa_id).length} compromisso(s)
          </span>
        </span>
      </button>
    ),
  }));

  const eventosPorDia = (chave: string) => eventos.filter((e) => e.data === chave);
  const eventosPorCorretor = (chave: string) => eventos.filter((e) => e.corretor_id === chave && e.data === inicio);

  return (
    <div className="flex h-[calc(100svh-56px-2.5rem)] min-h-[560px] gap-4">
      {/* Equipe */}
      {isAdmin && (
        <aside className="hidden w-60 shrink-0 flex-col overflow-hidden rounded-lg border bg-card md:flex">
          <h2 className="border-b px-3 py-2.5 text-sm font-semibold">Equipe</h2>
          <div className="flex-1 space-y-0.5 overflow-y-auto p-1.5 scroll-fino">
            <button
              type="button"
              onClick={() => escolherCorretor(null)}
              className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm", !corretor ? "bg-accent font-medium" : "hover:bg-muted")}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
                <Users className="h-3.5 w-3.5" />
              </span>
              Toda a equipe
            </button>
            {membros.map((m, i) => (
              <EquipeItem key={m.usuario_id} m={m} cor={corDoMembro(m, i)} ativo={corretor === m.pessoa_id} onClick={() => escolherCorretor(m.pessoa_id)} />
            ))}
            {!membros.length && <p className="px-2 py-4 text-xs text-muted-foreground">Cadastre corretores em Consultores para ver a agenda de cada um.</p>}
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Barra */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" onClick={() => navegar(-1)} aria-label="Anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => navegar(0)}>
              Hoje
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => navegar(1)} aria-label="Próximo">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <h2 className="text-base font-semibold first-letter:uppercase">{rotulo}</h2>
          {selecionado && (
            <span className="flex items-center gap-1.5 rounded-full border bg-card py-0.5 pl-0.5 pr-2 text-xs">
              <Avatar nome={selecionado.nome} usuarioId={selecionado.usuario_id} temFoto={selecionado.tem_foto} versao={selecionado.foto_v} tamanho="xs" cor={corDoMembro(selecionado)} />
              Agenda de {selecionado.nome.split(" ")[0]}
              <button onClick={() => escolherCorretor(null)} className="ml-1 text-muted-foreground hover:text-foreground" aria-label="Ver toda a equipe">
                ×
              </button>
            </span>
          )}
          {isAdmin && (
            <select
              className="h-8 rounded-md border bg-card px-2 text-sm md:hidden"
              value={corretor ?? ""}
              onChange={(e) => escolherCorretor(e.target.value || null)}
              aria-label="Corretor"
            >
              <option value="">Toda a equipe</option>
              {membros.map((m) => (
                <option key={m.usuario_id} value={m.pessoa_id!}>
                  {m.nome}
                </option>
              ))}
            </select>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border bg-card p-0.5" role="tablist">
              {(
                [
                  ["dia", isAdmin && !corretor ? "Equipe" : "Dia"],
                  ["semana", "Semana"],
                  ["mes", "Mês"],
                  ["lista", "Lista"],
                ] as const
              ).map(([v, r]) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={visao === v}
                  onClick={() => setVisao(v)}
                  className={cn("h-7 rounded px-2.5 text-xs font-medium", visao === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                  data-testid={`visao-${v}`}
                >
                  {r}
                </button>
              ))}
            </div>
            {isAdmin && (
              <Button variant="ghost" size="sm" onClick={() => lembretes.mutate()} disabled={lembretes.isPending} title="Envia por e-mail as visitas de amanhã para corretores e clientes">
                <BellRing className="h-3.5 w-3.5" /> Lembretes
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setVisita({ v: null, data: visao === "dia" ? inicio : hoje, corretor })}>
              <Home className="h-3.5 w-3.5" /> Visita
            </Button>
            <Button size="sm" onClick={() => novo(visao === "dia" ? inicio : hoje, null)} data-testid="btn-nova-atividade">
              <Plus className="h-3.5 w-3.5" /> Atividade
            </Button>
          </div>
        </div>

        {/* Visões */}
        {visao === "dia" || visao === "semana" ? (
          modoEquipe ? (
            membros.length ? (
              <GradeHoras colunas={colunasEquipe} eventosPor={eventosPorCorretor} corDe={corDe} onAbrir={abrir} onNovo={novo} hoje={hoje} />
            ) : (
              <GradeHoras colunas={colunasDias} eventosPor={eventosPorDia} corDe={corDe} onAbrir={abrir} onNovo={novo} hoje={hoje} />
            )
          ) : (
            <GradeHoras colunas={colunasDias} eventosPor={eventosPorDia} corDe={corDe} onAbrir={abrir} onNovo={novo} hoje={hoje} />
          )
        ) : visao === "mes" ? (
          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[auto_repeat(6,minmax(0,1fr))] overflow-hidden rounded-lg border bg-card">
            {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => (
              <div key={d} className="border-b px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            {dias.map((d) => {
              const iso = isoLocal(d);
              const lista = eventosPorDia(iso).sort((a, b) => (a.hora ?? "").localeCompare(b.hora ?? ""));
              const foraDoMes = d.getMonth() !== base.getMonth();
              return (
                <div key={iso} className={cn("min-h-0 overflow-hidden border-b border-l p-1 first:border-l-0 [&:nth-child(7n+1)]:border-l-0", foraDoMes && "bg-muted/40")} onClick={() => novo(iso, null)}>
                  <p className={cn("num mb-0.5 text-xs", iso === hoje ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground" : foraDoMes ? "text-muted-foreground" : "font-medium")}>{d.getDate()}</p>
                  <div className="space-y-0.5">
                    {lista.slice(0, 3).map((e) => (
                      <BlocoEvento key={e.id} e={e} cor={corDe(e)} onClick={() => abrir(e)} compacto />
                    ))}
                    {lista.length > 3 && (
                      <button
                        className="px-1 text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setBase(d);
                          setVisao(corretor || !isAdmin ? "semana" : "dia");
                        }}
                      >
                        +{lista.length - 3} mais
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card scroll-fino">
            {(() => {
              const atrasadas = eventos.filter((e) => e.data < hoje && !e.concluida && e.origem === "atividade");
              const grupos = dias.map((d) => isoLocal(d)).map((iso) => ({ iso, lista: eventosPorDia(iso).sort((a, b) => (a.hora ?? "00").localeCompare(b.hora ?? "00")) }));
              const Linha = ({ e }: { e: Evento }) => {
                const m = membroDe(e.corretor_id);
                return (
                  <li className="flex items-center gap-3 px-4 py-2">
                    {e.origem === "atividade" ? (
                      <button
                        aria-label={e.concluida ? "Reabrir atividade" : "Concluir atividade"}
                        onClick={() => concluir.mutate(e.bruto as Atividade)}
                        className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", e.concluida ? "border-hoje bg-hoje text-white" : "border-muted-foreground/40 hover:border-hoje")}
                      >
                        {e.concluida && <Check className="h-3 w-3" />}
                      </button>
                    ) : (
                      <span className="w-5" />
                    )}
                    <e.icone className="h-4 w-4 shrink-0" style={{ color: corDe(e) }} />
                    <span className="num w-12 shrink-0 text-xs text-muted-foreground">{e.hora ?? "—"}</span>
                    <button className={cn("min-w-0 flex-1 truncate text-left text-sm", e.concluida && "text-muted-foreground line-through")} onClick={() => abrir(e)}>
                      {e.titulo}
                    </button>
                    {e.negocio_id && (
                      <button className="hidden text-xs text-primary hover:underline sm:block" onClick={() => navigate(`/negocios/${e.negocio_id}`)}>
                        Ver negócio
                      </button>
                    )}
                    {m && <Avatar nome={m.nome} usuarioId={m.usuario_id} temFoto={m.tem_foto} versao={m.foto_v} tamanho="xs" cor={corDoMembro(m)} />}
                  </li>
                );
              };
              return (
                <>
                  {atrasadas.length > 0 && (
                    <div>
                      <h3 className="sticky top-0 z-10 border-b bg-atrasada/10 px-4 py-1.5 text-xs font-semibold text-atrasada">Atrasadas ({atrasadas.length})</h3>
                      <ul className="divide-y">{atrasadas.map((e) => <Linha key={e.id} e={e} />)}</ul>
                    </div>
                  )}
                  {grupos
                    .filter((g) => g.lista.length)
                    .map((g) => (
                      <div key={g.iso}>
                        <h3 className="sticky top-0 z-10 border-b bg-muted px-4 py-1.5 text-xs font-semibold first-letter:uppercase">
                          {g.iso === hoje ? "Hoje, " : ""}
                          {new Date(g.iso + "T12:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
                        </h3>
                        <ul className="divide-y">{g.lista.map((e) => <Linha key={e.id} e={e} />)}</ul>
                      </div>
                    ))}
                  {!atrasadas.length && !grupos.some((g) => g.lista.length) && (
                    <p className="px-4 py-16 text-center text-sm text-muted-foreground">Nenhum compromisso nas próximas três semanas.</p>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>

      <AtividadeModal open={!!atividade} onClose={fecharAtividade} atividade={atividade?.a} padrao={atividade?.padrao} />
      <VisitaModal
        open={!!visita}
        onClose={() => {
          setVisita(null);
          qc.invalidateQueries({ queryKey: ["visitas"] });
        }}
        visita={visita?.v ?? null}
        dataPadrao={visita?.data ?? hoje}
        leads={leads}
        imoveis={imoveis}
        pessoas={pessoas}
        isAdmin={isAdmin}
        preset={visita && !visita.v ? { corretor_id: visita.corretor ?? null } : undefined}
      />
    </div>
  );
}

function EquipeItem({ m, cor, ativo, onClick }: { m: MembroEquipe; cor: string; ativo: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left", ativo ? "bg-accent" : "hover:bg-muted")}
      data-testid={`equipe-${m.pessoa_id}`}
    >
      <Avatar nome={m.nome} usuarioId={m.usuario_id} temFoto={m.tem_foto} versao={m.foto_v} cor={cor} tamanho="sm" anel={ativo ? cor : undefined} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", ativo && "font-semibold")}>{m.nome}</span>
        <span className="block text-[11px] text-muted-foreground">
          {m.atividades_hoje} hoje, {m.visitas_semana} visita(s) na semana
        </span>
      </span>
      {m.atividades_atrasadas > 0 && (
        <span className="num rounded-full bg-atrasada px-1.5 text-[10px] font-semibold leading-4 text-white" title="Atividades atrasadas">
          {m.atividades_atrasadas}
        </span>
      )}
    </button>
  );
}
