import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ArrowRightLeft, Clock, Columns3, Handshake, List, Plus, Search, ThumbsDown, Timer, Trash2, Trophy } from "lucide-react";
import { apiDelete, apiGet, apiPost, detalheErro } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isoLocal } from "@/lib/crm";
import { brl, brlCompacto } from "@/lib/format";
import { dataCurta, diasDesde, useEquipe, useFunis } from "@/lib/crm";
import { useAuth } from "@/lib/useAuth";
import type { NegocioResumo } from "@/lib/types";
import type { Relatorio } from "@/lib/relatorio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Avatar from "@/components/shared/Avatar";
import NegocioModal from "@/components/crm/NegocioModal";
import AtividadeModal, { type PadraoAtividade } from "@/components/crm/AtividadeModal";
import PerderDialog from "@/components/crm/PerderDialog";
import IndicadorAtividade from "@/components/crm/IndicadorAtividade";
import { cn } from "@/lib/utils";

type Visao = "quadro" | "lista";
type StatusFiltro = "aberto" | "ganho" | "perdido" | "todos";

function lerPreferencia<T extends string>(chave: string, padrao: T): T {
  try {
    return (localStorage.getItem(chave) as T) || padrao;
  } catch {
    return padrao;
  }
}
function gravarPreferencia(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* sem armazenamento: só nesta sessão */
  }
}

function CardNegocio({
  n,
  onAbrir,
  onAgendar,
  onDragStart,
  onDragEnd,
  arrastando,
}: {
  n: NegocioResumo;
  onAbrir: () => void;
  onAgendar: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  arrastando: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onAbrir}
      onKeyDown={(e) => e.key === "Enter" && onAbrir()}
      data-testid={`negocio-card-${n.id}`}
      className={cn(
        "group cursor-grab rounded-md border bg-card p-2.5 text-left shadow-[0_1px_0_rgba(26,36,33,0.06)] transition-[box-shadow,opacity] hover:border-ring/40 hover:shadow-md active:cursor-grabbing",
        n.parado && "border-atrasada/35 bg-[color-mix(in_oklab,var(--atrasada)_7%,var(--card))]",
        arrastando && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        <p className="line-clamp-2 flex-1 text-[13px] font-semibold leading-snug">{n.nome}</p>
        <IndicadorAtividade negocio={n} onAgendar={onAgendar} />
      </div>
      {(() => {
        const nomeTem = (t: string | null) => !!t && n.nome.toLowerCase().includes(t.toLowerCase().slice(0, 18));
        const partes = [nomeTem(n.cliente_nome) ? null : n.cliente_nome, nomeTem(n.imovel_titulo) ? n.imovel_codigo : n.imovel_codigo || n.imovel_titulo].filter(Boolean);
        return partes.length ? <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{partes.join(", ")}</p> : null;
      })()}
      <div className="mt-2 flex items-center gap-2">
        {n.corretor_id ? (
          <Avatar nome={n.corretor_nome} usuarioId={n.corretor_usuario_id} temFoto={n.corretor_tem_foto} cor={n.corretor_cor} tamanho="xs" />
        ) : (
          <span className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/50" title="Sem responsável" />
        )}
        <span className="num text-xs font-semibold">{n.valor_estimado ? brlCompacto(n.valor_estimado) : "—"}</span>
        {n.etiquetas.slice(0, 1).map((t) => (
          <span key={t} className="truncate rounded-sm bg-latao/15 px-1.5 text-[10px] font-medium text-foreground">
            {t}
          </span>
        ))}
        {n.parado && (
          <span className="ml-auto flex items-center gap-0.5 text-[10px] font-medium text-atrasada" title="Tempo na etapa acima do limite configurado">
            <Clock className="h-3 w-3" />
            {diasDesde(n.etapa_desde)}d
          </span>
        )}
      </div>
    </div>
  );
}

export default function Negocios() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { isAdmin } = useAuth();
  const { data: funis = [] } = useFunis();
  const { data: equipe = [] } = useEquipe();

  const [funilId, setFunilId] = useState<string>(() => lerPreferencia("cedro.funil", ""));
  const [visao, setVisao] = useState<Visao>(() => lerPreferencia<Visao>("cedro.visao", "quadro"));
  const [status, setStatus] = useState<StatusFiltro>((params.get("status") as StatusFiltro) || "aberto");
  const [responsavel, setResponsavel] = useState<string>("");
  const [busca, setBusca] = useState(params.get("busca") ?? "");
  const [novoAberto, setNovoAberto] = useState(params.get("novo") === "1");
  const [novoEtapa, setNovoEtapa] = useState<string | null>(null);
  const [agendar, setAgendar] = useState<PadraoAtividade | null>(null);
  const [perder, setPerder] = useState<NegocioResumo | null>(null);
  const [arrastado, setArrastado] = useState<NegocioResumo | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [alerta, setAlerta] = useState<"" | "sem_passo" | "parados" | "atrasadas">("");
  const [moverFunil, setMoverFunil] = useState<NegocioResumo | null>(null);
  const [destinoFunil, setDestinoFunil] = useState("");
  const [excluir, setExcluir] = useState<NegocioResumo | null>(null);

  const funil = funis.find((f) => f.id === funilId) ?? funis.find((f) => f.padrao) ?? funis[0];
  useEffect(() => {
    if (funil && funil.id !== funilId) setFunilId(funil.id);
  }, [funil, funilId]);
  useEffect(() => gravarPreferencia("cedro.funil", funilId), [funilId]);
  useEffect(() => gravarPreferencia("cedro.visao", visao), [visao]);

  const statusConsulta = visao === "quadro" ? "aberto" : status;
  const chave = ["kanban", funil?.id, statusConsulta, responsavel];
  const { data: negocios = [], isLoading } = useQuery({
    queryKey: chave,
    queryFn: () =>
      apiGet<NegocioResumo[]>(
        `/leads/kanban?funil_id=${funil!.id}&status=${statusConsulta}${responsavel ? `&corretor_id=${responsavel}` : ""}`,
      ),
    enabled: !!funil,
  });
  const inicioMes = isoLocal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const { data: mes } = useQuery({
    queryKey: ["metricas", "mes", funil?.id, responsavel, inicioMes],
    queryFn: () => apiGet<Relatorio>(`/relatorios/funil?funil_id=${funil!.id}&inicio=${inicioMes}${responsavel ? `&corretor_id=${responsavel}` : ""}`),
    enabled: !!funil,
  });

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const base = negocios.filter((n) =>
      alerta === "sem_passo" ? n.situacao_atividade === "nenhuma" : alerta === "parados" ? n.parado : alerta === "atrasadas" ? n.situacao_atividade === "atrasada" : true,
    );
    if (!t) return base;
    return base.filter((n) =>
      [n.nome, n.cliente_nome, n.imovel_titulo, n.imovel_codigo, n.cliente_telefone, n.corretor_nome]
        .filter(Boolean)
        .some((x) => x!.toLowerCase().includes(t)),
    );
  }, [negocios, busca, alerta]);

  const porEtapa = useMemo(() => {
    const mapa: Record<string, NegocioResumo[]> = {};
    for (const e of funil?.etapas ?? []) mapa[e.id] = [];
    for (const n of filtrados) (mapa[n.etapa_id ?? ""] ??= []).push(n);
    return mapa;
  }, [filtrados, funil]);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["kanban"] });
    qc.invalidateQueries({ queryKey: ["metricas"] });
    qc.invalidateQueries({ queryKey: ["equipe"] });
  };

  const mover = useMutation({
    mutationFn: ({ id, etapa }: { id: string; etapa: string }) => apiPost(`/leads/${id}/mover`, { etapa_id: etapa }),
    onMutate: async ({ id, etapa }) => {
      await qc.cancelQueries({ queryKey: chave });
      const antes = qc.getQueryData<NegocioResumo[]>(chave);
      qc.setQueryData<NegocioResumo[]>(chave, (lista) =>
        (lista ?? []).map((n) => (n.id === id ? { ...n, etapa_id: etapa, etapa_desde: new Date().toISOString(), parado: false } : n)),
      );
      return { antes };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.antes) qc.setQueryData(chave, ctx.antes);
      toast.error(detalheErro(e) ?? "Não foi possível mover o negócio");
    },
    onSettled: invalidar,
  });

  const ganhar = useMutation({
    mutationFn: (id: string) => apiPost(`/leads/${id}/ganhar`),
    onSuccess: (_d, id) => {
      const n = negocios.find((x) => x.id === id);
      toast.success(`Negócio ganho${n?.valor_estimado ? `: ${brl(n.valor_estimado)}` : ""}`, {
        action: { label: "Abrir", onClick: () => navigate(`/negocios/${id}`) },
      });
      invalidar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível marcar como ganho"),
  });

  const trocarFunil = useMutation({
    mutationFn: ({ id, funilId }: { id: string; funilId: string }) => {
      const f = funis.find((x) => x.id === funilId);
      return apiPost(`/leads/${id}/mover`, { funil_id: funilId, etapa_id: f?.etapas[0]?.id });
    },
    onSuccess: () => {
      toast.success("Negócio movido de funil");
      setMoverFunil(null);
      invalidar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível mover"),
  });
  const apagar = useMutation({
    mutationFn: (id: string) => apiDelete(`/leads/${id}`),
    onSuccess: () => {
      toast.success("Negócio excluído");
      setExcluir(null);
      invalidar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível excluir"),
  });

  const soltar = (destino: string) => {
    const n = arrastado;
    setArrastado(null);
    setAlvo(null);
    if (!n) return;
    if (destino === "__ganho") ganhar.mutate(n.id);
    else if (destino === "__perdido") setPerder(n);
    else if (destino === "__funil") {
      setDestinoFunil(funis.find((f) => f.id !== n.funil_id)?.id ?? "");
      setMoverFunil(n);
    } else if (destino === "__excluir") setExcluir(n);
    else if (destino !== n.etapa_id) mover.mutate({ id: n.id, etapa: destino });
  };

  const fecharNovo = () => {
    setNovoAberto(false);
    setNovoEtapa(null);
    if (params.get("novo")) {
      params.delete("novo");
      setParams(params, { replace: true });
    }
  };

  const valorTotal = filtrados.reduce((s, n) => s + (n.valor_estimado ?? 0), 0);
  const corretores = equipe.filter((m) => m.pessoa_id);

  return (
    <div className="flex h-[calc(100svh-56px-2.5rem)] min-h-[520px] flex-col gap-3">
      {/* Barra de ferramentas (ordem do Pipedrive: criar e visão à esquerda, filtros à direita) */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setNovoAberto(true)} data-testid="btn-novo-negocio">
          <Plus className="h-4 w-4" /> Negócio
        </Button>
        <div className="flex rounded-md border bg-card p-0.5" role="tablist" aria-label="Visualização">
          {(
            [
              ["quadro", Columns3, "Quadro"],
              ["lista", List, "Lista"],
            ] as const
          ).map(([v, Icone, rotulo]) => (
            <button
              key={v}
              role="tab"
              aria-selected={visao === v}
              title={rotulo}
              onClick={() => setVisao(v)}
              className={cn("flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium", visao === v ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Icone className="h-4 w-4" />
              <span className="hidden sm:inline">{rotulo}</span>
            </button>
          ))}
        </div>
        <p className="num ml-1 hidden text-sm text-muted-foreground lg:block">
          <span className="font-semibold text-foreground">{brl(valorTotal)}</span>, {filtrados.length} {filtrados.length === 1 ? "negócio" : "negócios"}
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-52">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar negócios" className="h-8 bg-card pl-8" />
          </div>
          {visao === "lista" && (
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFiltro)} className="h-8 rounded-md border bg-card px-2 text-sm" aria-label="Status">
              <option value="aberto">Em andamento</option>
              <option value="ganho">Ganhos</option>
              <option value="perdido">Perdidos</option>
              <option value="todos">Todos</option>
            </select>
          )}
          {isAdmin && (
            <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-sm" aria-label="Responsável" data-testid="filtro-responsavel">
              <option value="">Toda a equipe</option>
              {corretores.map((m) => (
                <option key={m.usuario_id} value={m.pessoa_id!}>
                  {m.nome}
                </option>
              ))}
            </select>
          )}
          <select value={funil?.id ?? ""} onChange={(e) => setFunilId(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-sm font-semibold" aria-label="Funil" data-testid="filtro-funil">
            {funis.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Indicadores do funil (mesma leitura do CRM Revendas) */}
      <div className="flex gap-2 overflow-x-auto pb-0.5 scroll-fino" data-testid="indicadores-funil">
        {[
          { r: "Em andamento", v: brlCompacto(negocios.reduce((t, n) => t + (n.valor_estimado ?? 0), 0)), d: `${negocios.length} negócios` },
          { r: "Ponderado", v: brlCompacto(mes?.valor_ponderado ?? 0), d: "valor x probabilidade da etapa" },
          { r: "Ganhos no mês", v: brlCompacto(mes?.valor_ganho ?? 0), d: `${mes?.ganhos ?? 0} negócio(s)` },
          { r: "Conversão do mês", v: mes?.conversao != null ? `${mes.conversao}%` : "—", d: `${mes?.ganhos_coorte ?? 0} de ${mes?.criados ?? 0} criados` },
          { r: "Perdidos no mês", v: String(mes?.perdidos ?? 0), d: mes?.motivos_perda[0] ? `mais comum: ${mes.motivos_perda[0].rotulo}` : "sem perdas" },
        ].map((k) => (
          <div key={k.r} className="min-w-[150px] shrink-0 rounded-lg border bg-card px-3 py-2">
            <p className="text-[11px] text-muted-foreground">{k.r}</p>
            <p className="num whitespace-nowrap text-[clamp(15px,1.4vw,18px)] font-bold leading-tight">{k.v}</p>
            <p className="truncate text-[11px] text-muted-foreground">{k.d}</p>
          </div>
        ))}
        {(
          [
            ["atrasadas", "com atividade atrasada", negocios.filter((n) => n.situacao_atividade === "atrasada").length, AlertTriangle, "text-atrasada"],
            ["sem_passo", "sem próximo passo", negocios.filter((n) => n.situacao_atividade === "nenhuma").length, AlertTriangle, "text-sem-atividade"],
            ["parados", "parados na etapa", negocios.filter((n) => n.parado).length, Timer, "text-atrasada"],
          ] as const
        ).map(([id, rotulo, qtd, Icone, cor]) => (
          <button
            key={id}
            type="button"
            onClick={() => setAlerta(alerta === id ? "" : id)}
            aria-pressed={alerta === id}
            className={cn(
              "flex min-w-[150px] shrink-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
              alerta === id ? "border-primary bg-accent" : "bg-card hover:border-ring/50",
            )}
            title={alerta === id ? "Clique para mostrar todos" : "Clique para filtrar o quadro"}
          >
            <Icone className={cn("h-5 w-5 shrink-0", cor)} />
            <span>
              <span className={cn("num block text-lg font-bold leading-tight", qtd > 0 && cor)}>{qtd}</span>
              <span className="block text-[11px] leading-tight text-muted-foreground">{rotulo}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Quadro */}
      {visao === "quadro" ? (
        <div className="relative min-h-0 flex-1">
          <div className="flex h-full gap-2 overflow-x-auto pb-2 scroll-fino">
            {funil?.etapas.map((etapa, i) => {
              const cards = porEtapa[etapa.id] ?? [];
              const soma = cards.reduce((s, n) => s + (n.valor_estimado ?? 0), 0);
              const sobre = alvo === etapa.id && arrastado?.etapa_id !== etapa.id;
              return (
                <section
                  key={etapa.id}
                  aria-label={etapa.nome}
                  className="flex w-[272px] shrink-0 flex-col"
                  onDragOver={(e) => {
                    if (!arrastado) return;
                    e.preventDefault();
                    setAlvo(etapa.id);
                  }}
                  onDragLeave={() => setAlvo((a) => (a === etapa.id ? null : a))}
                  onDrop={(e) => {
                    e.preventDefault();
                    soltar(etapa.id);
                  }}
                  data-testid={`coluna-${i}`}
                >
                  <header
                    className={cn(
                      "etapa-seta mb-2 flex h-12 flex-col justify-center bg-card px-4 pr-5",
                      i === 0 ? "pl-3" : "pl-5",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <h2 className="flex-1 truncate text-[13px] font-semibold">{etapa.nome}</h2>
                      <span className="text-[11px] text-muted-foreground" title="Probabilidade de fechamento">
                        {etapa.probabilidade}%
                      </span>
                    </div>
                    <p className="num text-xs text-muted-foreground">
                      {brlCompacto(soma)}, {cards.length} {cards.length === 1 ? "negócio" : "negócios"}
                    </p>
                  </header>
                  <div
                    className={cn(
                      "flex min-h-24 flex-1 flex-col gap-1.5 overflow-y-auto rounded-md p-1 transition-colors scroll-fino",
                      sobre ? "bg-accent outline-2 outline-dashed outline-primary/40" : "bg-muted/50",
                    )}
                  >
                    {isLoading && <div className="h-20 animate-pulse rounded-md bg-card" />}
                    {cards.map((n) => (
                      <CardNegocio
                        key={n.id}
                        n={n}
                        arrastando={arrastado?.id === n.id}
                        onAbrir={() => navigate(`/negocios/${n.id}`)}
                        onAgendar={() =>
                          setAgendar({ negocio_id: n.id, corretor_id: n.corretor_id, assunto: "" })
                        }
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", n.id);
                          setArrastado(n);
                        }}
                        onDragEnd={() => {
                          setArrastado(null);
                          setAlvo(null);
                        }}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setNovoEtapa(etapa.id);
                        setNovoAberto(true);
                      }}
                      className="flex h-8 shrink-0 items-center justify-center gap-1 rounded-md text-xs text-muted-foreground opacity-70 hover:bg-card hover:text-foreground hover:opacity-100"
                    >
                      <Plus className="h-3.5 w-3.5" /> Adicionar
                    </button>
                  </div>
                </section>
              );
            })}
            {!funil && !isLoading && (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Nenhum funil configurado.</div>
            )}
          </div>

          {/* Zonas de soltura: aparecem só durante o arraste */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-3 transition-all duration-150",
              arrastado ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
            )}
          >
            {(
              [
                ...(isAdmin ? ([["__excluir", "Excluir", Trash2, "bg-foreground/80"]] as const) : []),
                ["__perdido", "Perdido", ThumbsDown, "bg-atrasada"],
                ["__ganho", "Ganho", Trophy, "bg-hoje"],
                ...(funis.length > 1 ? ([["__funil", "Outro funil", ArrowRightLeft, "bg-primary"]] as const) : []),
              ] as const
            ).map(([id, rotulo, Icone, cor]) => (
              <div
                key={id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setAlvo(id);
                }}
                onDragLeave={() => setAlvo(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  soltar(id);
                }}
                className={cn(
                  "pointer-events-auto flex h-16 w-40 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white shadow-lg transition-transform sm:w-48",
                  cor,
                  alvo === id && "scale-105 ring-4 ring-white/60",
                  !arrastado && "pointer-events-none",
                )}
                data-testid={`zona${id}`}
              >
                <Icone className="h-5 w-5" /> {rotulo}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card scroll-fino">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="sticky top-0 z-10 bg-card text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-3 py-2 font-medium">Negócio</th>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 text-right font-medium">Valor</th>
                <th className="px-3 py-2 font-medium">Etapa</th>
                <th className="px-3 py-2 font-medium">Responsável</th>
                <th className="px-3 py-2 font-medium">Próxima atividade</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((n) => {
                const etapa = funil?.etapas.find((e) => e.id === n.etapa_id);
                return (
                  <tr key={n.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <Link to={`/negocios/${n.id}`} className="font-medium hover:text-primary hover:underline">
                        {n.nome}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{n.cliente_nome ?? "—"}</td>
                    <td className="num px-3 py-2 text-right">{brl(n.valor_estimado)}</td>
                    <td className="px-3 py-2">{etapa?.nome ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        {n.corretor_id && <Avatar nome={n.corretor_nome} usuarioId={n.corretor_usuario_id} temFoto={n.corretor_tem_foto} cor={n.corretor_cor} tamanho="xs" />}
                        <span className="truncate">{n.corretor_nome ?? "Sem responsável"}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {n.status === "aberto" ? (
                        <span className="flex items-center gap-2">
                          <IndicadorAtividade negocio={n} onAgendar={() => setAgendar({ negocio_id: n.id, corretor_id: n.corretor_id })} />
                          <span className={cn("truncate text-xs", n.situacao_atividade === "atrasada" && "text-atrasada")}>
                            {n.proxima_atividade ? `${dataCurta(n.proxima_atividade)}, ${n.proxima_atividade_assunto}` : "Sem próximo passo"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          n.status === "ganho" && "bg-hoje/15 text-hoje",
                          n.status === "perdido" && "bg-atrasada/10 text-atrasada",
                          n.status === "aberto" && "bg-muted text-muted-foreground",
                        )}
                      >
                        {n.status === "aberto" ? "Em andamento" : n.status === "ganho" ? "Ganho" : "Perdido"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!filtrados.length && !isLoading && (
                <tr>
                  <td colSpan={7} className="px-3 py-16 text-center">
                    <Handshake className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
                    <p className="text-sm text-muted-foreground">Nenhum negócio com esses filtros.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <NegocioModal
        open={novoAberto}
        onClose={fecharNovo}
        funilInicial={funil?.id}
        etapaInicial={novoEtapa}
        onCriado={(lead) => !novoEtapa && navigate(`/negocios/${lead.id}`)}
      />
      <AtividadeModal open={!!agendar} onClose={() => setAgendar(null)} padrao={agendar ?? undefined} />
      <PerderDialog negocioId={perder?.id ?? null} nome={perder?.nome} onClose={() => setPerder(null)} />
      <Dialog open={!!moverFunil} onOpenChange={(v) => !v && setMoverFunil(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mover para outro funil</DialogTitle>
            <DialogDescription>“{moverFunil?.nome}” entra na primeira etapa do funil escolhido.</DialogDescription>
          </DialogHeader>
          <select value={destinoFunil} onChange={(e) => setDestinoFunil(e.target.value)} className="h-9 rounded-lg border bg-card px-2 text-sm" aria-label="Funil de destino">
            {funis
              .filter((f) => f.id !== moverFunil?.funil_id)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
          </select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoverFunil(null)}>
              Cancelar
            </Button>
            <Button disabled={!destinoFunil || trocarFunil.isPending} onClick={() => moverFunil && trocarFunil.mutate({ id: moverFunil.id, funilId: destinoFunil })}>
              Mover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!excluir} onOpenChange={(v) => !v && setExcluir(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir negócio</DialogTitle>
            <DialogDescription>
              “{excluir?.nome}” sai do funil e dos relatórios. Para manter a taxa de conversão real, prefira marcar como perdido.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcluir(null)}>
              Cancelar
            </Button>
            <Button variant="outline" onClick={() => { const n = excluir; setExcluir(null); if (n) setPerder(n); }}>
              Marcar como perdido
            </Button>
            <Button variant="destructive" disabled={apagar.isPending} onClick={() => excluir && apagar.mutate(excluir.id)}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
