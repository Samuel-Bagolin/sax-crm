import { useConfig } from "@/lib/useConfig";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  Car,
  CalendarPlus,
  Check,
  FileSignature,
  FolderOpen,
  HandCoins,
  Sparkles,
  Zap,
  Home,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Pin,
  RotateCcw,
  StickyNote,
  ThumbsDown,
  Trash2,
  Trophy,
} from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, detalheErro } from "@/lib/api";
import { brl, dataBR, dataHoraBR } from "@/lib/format";
import { ATIVIDADE, dataCurta, diasDesde, isoLocal, linkWhatsapp, useEquipe } from "@/lib/crm";
import { useAuth } from "@/lib/useAuth";
import type { Atividade, EventoHistorico, ImovelDetalhe, Lead, NegocioDetalhe as Detalhe, Pessoa, Visita } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import Avatar from "@/components/shared/Avatar";
import NegocioModal from "@/components/crm/NegocioModal";
import AtividadeModal, { type PadraoAtividade } from "@/components/crm/AtividadeModal";
import PerderDialog from "@/components/crm/PerderDialog";
import { useSegmento } from "@/lib/segmento";
import VisitaModal from "@/components/agenda/VisitaModal";
import DocumentosPainel from "@/components/shared/DocumentosPainel";
import PropostasPainel from "@/components/crm/PropostasPainel";
import CompativeisPainel from "@/components/crm/CompativeisPainel";
import { usePlano } from "@/lib/diferenciais";
import { cn } from "@/lib/utils";

const ICONE_EVENTO: Record<EventoHistorico["tipo"], typeof StickyNote> = {
  nota: StickyNote,
  criado: Check,
  etapa: Check,
  status: Trophy,
  atividade: CalendarPlus,
  campo: Pencil,
  contrato: FileSignature,
  visita: Home,
  assinatura: FileSignature,
  proposta: HandCoins,
  vitrine: Sparkles,
  match: Sparkles,
  automacao: Zap,
  documento: FolderOpen,
};

function quando(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function Bloco({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold">{titulo}</h3>
        {acao}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="min-w-0 truncate text-right font-medium">{children}</span>
    </div>
  );
}

export default function NegocioDetalhe() {
  const { moduloAtivo } = useConfig();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { principal, isAdmin } = useAuth();
  const { data: equipe = [] } = useEquipe();
  const { tem } = usePlano();
  const [editar, setEditar] = useState(false);
  const [perder, setPerder] = useState(false);
  const [atividade, setAtividade] = useState<{ a: Atividade | null; padrao?: PadraoAtividade } | null>(null);
  const [visitaAberta, setVisitaAberta] = useState(false);
  const [aba, setAba] = useState<"nota" | "atividade">("nota");
  const [nota, setNota] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["negocio", id],
    queryFn: () => apiGet<Detalhe>(`/leads/${id}`),
  });
  const { data: historico = [] } = useQuery({
    queryKey: ["historico", id],
    queryFn: () => apiGet<EventoHistorico[]>(`/leads/${id}/historico`),
  });
  const { data: atividades = [] } = useQuery({
    queryKey: ["atividades", "negocio", id],
    queryFn: () => apiGet<Atividade[]>(`/atividades?negocio_id=${id}`),
  });
  const { data: visitas = [] } = useQuery({
    queryKey: ["visitas", "negocio", id],
    queryFn: () => apiGet<Visita[]>(`/visitas?lead_id=${id}`),
  });
  const imovelId = data?.negocio.imovel_id;
  const { data: imovel } = useQuery({
    queryKey: ["imovel", imovelId],
    queryFn: () => apiGet<ImovelDetalhe>(`/imoveis/${imovelId}`),
    enabled: !!imovelId,
  });
  const { data: pessoas = [] } = useQuery({ queryKey: ["pessoas"], queryFn: () => apiGet<Pessoa[]>("/pessoas"), enabled: visitaAberta });
  const { data: imoveis = [] } = useQuery({ queryKey: ["imoveis"], queryFn: () => apiGet<ImovelDetalhe[]>("/imoveis"), enabled: visitaAberta });
  const seg = useSegmento();
  const veiculoId = data?.negocio.veiculo_id;
  const { data: veiculo } = useQuery({
    queryKey: ["veiculo", veiculoId],
    queryFn: () => apiGet<{ id: string; titulo: string; codigo: string; km: number; cor: string | null; preco_venda: number | null; foto_url: string | null; status: string }>(`/veiculos/${veiculoId}`),
    enabled: !!veiculoId && seg.veiculos,
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["negocio", id] });
    qc.invalidateQueries({ queryKey: ["historico", id] });
    qc.invalidateQueries({ queryKey: ["kanban"] });
    qc.invalidateQueries({ queryKey: ["atividades"] });
  };

  const acao = useMutation({
    mutationFn: ({ rota, corpo }: { rota: string; corpo?: unknown }) => apiPost<Lead>(`/leads/${id}/${rota}`, corpo),
    onSuccess: (_d, v) => {
      if (v.rota === "ganhar") toast.success("Negócio ganho! Próximo passo: gerar o contrato.");
      invalidar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível concluir"),
  });

  const salvarNota = useMutation({
    mutationFn: () => apiPost(`/leads/${id}/notas`, { texto: nota.trim() }),
    onSuccess: () => {
      setNota("");
      qc.invalidateQueries({ queryKey: ["historico", id] });
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar a nota"),
  });

  const fixarNota = useMutation({
    mutationFn: (ev: EventoHistorico) => apiPatch(`/leads/${id}/notas/${ev.id}`, { texto: ev.texto, fixado: !ev.fixado }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["historico", id] }),
  });
  const excluirNota = useMutation({
    mutationFn: (ev: EventoHistorico) => apiDelete(`/leads/${id}/notas/${ev.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["historico", id] }),
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível excluir"),
  });

  const concluir = useMutation({
    mutationFn: (a: Atividade) => apiPatch(`/atividades/${a.id}`, { concluida: !a.concluida }),
    onSuccess: (_d, a) => {
      invalidar();
      if (!a.concluida && !atividades.some((x) => !x.concluida && x.id !== a.id)) {
        toast("Atividade concluída. Qual é o próximo passo?", {
          action: { label: "Agendar", onClick: () => setAtividade({ a: null, padrao: { negocio_id: id, corretor_id: data?.negocio.corretor_id } }) },
        });
      }
    },
  });

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  if (error || !data)
    return (
      <div className="py-24 text-center">
        <p className="text-muted-foreground">Negócio não encontrado ou sem permissão.</p>
        <Button variant="link" onClick={() => navigate("/crm")}>
          Voltar aos negócios
        </Button>
      </div>
    );

  const { negocio: n, resumo, cliente, etapas, funil_nome } = data;
  const idxEtapa = etapas.findIndex((e) => e.id === n.etapa_id);
  const etapa = etapas[idxEtapa];
  const responsavel = n.corretor_id ? equipe.find((m) => m.pessoa_id === n.corretor_id) : undefined;
  const pendentes = atividades.filter((a) => !a.concluida);
  const feitas = atividades.filter((a) => a.concluida);
  const fixadas = historico.filter((h) => h.fixado);
  const hoje = isoLocal(new Date());
  const whats = linkWhatsapp(cliente?.telefone, `Olá ${cliente?.nome?.split(" ")[0] ?? ""}, tudo bem?`);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      {/* Cabeçalho */}
      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-start gap-3 p-4 sm:p-5">
          <Link to="/crm" className="mt-1 text-muted-foreground hover:text-foreground" aria-label="Voltar aos negócios">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Funil {funil_nome}</p>
            <h2 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl" data-testid="negocio-titulo">
              {n.nome}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="num font-semibold">{brl(n.valor_estimado)}</span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {resumo.corretor_id ? (
                  <Avatar nome={resumo.corretor_nome} usuarioId={resumo.corretor_usuario_id} temFoto={resumo.corretor_tem_foto} cor={resumo.corretor_cor} tamanho="xs" />
                ) : (
                  <span className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/50" />
                )}
                {resumo.corretor_nome ?? "Sem responsável"}
              </span>
              {n.etiquetas.map((t) => (
                <span key={t} className="rounded-sm bg-latao/15 px-1.5 text-xs font-medium">
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditar(true)}>
              <Pencil className="h-3.5 w-3.5" /> Editar
            </Button>
            {n.status === "aberto" ? (
              <>
                <Button size="sm" className="bg-hoje text-white hover:bg-hoje/85" onClick={() => acao.mutate({ rota: "ganhar" })} data-testid="btn-ganhar">
                  <Trophy className="h-3.5 w-3.5" /> Ganho
                </Button>
                <Button size="sm" className="bg-atrasada text-white hover:bg-atrasada/85" onClick={() => setPerder(true)} data-testid="btn-perder">
                  <ThumbsDown className="h-3.5 w-3.5" /> Perdido
                </Button>
              </>
            ) : (
              <>
                <span
                  className={cn(
                    "rounded-md px-3 py-1 text-sm font-semibold",
                    n.status === "ganho" ? "bg-hoje/15 text-hoje" : "bg-atrasada/10 text-atrasada",
                  )}
                >
                  {n.status === "ganho" ? "Ganho" : "Perdido"} em {dataHoraBR(n.closed_at)}
                </span>
                {n.status === "ganho" && moduloAtivo("contratos") &&
                  (resumo.contrato_id ? (
                    <Button size="sm" onClick={() => navigate(`/contratos?id=${resumo.contrato_id}`)}>
                      <FileSignature className="h-3.5 w-3.5" /> Ver contrato
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => navigate(`/contratos?novo=1&lead=${n.id}`)} data-testid="btn-gerar-contrato">
                      <FileSignature className="h-3.5 w-3.5" /> Gerar contrato
                    </Button>
                  ))}
                {!resumo.contrato_id && (
                  <Button variant="ghost" size="sm" onClick={() => acao.mutate({ rota: "reabrir" })}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Linha do funil: clique para mover */}
        <div className="flex overflow-x-auto border-t px-4 py-3 sm:px-5">
          {etapas.map((e, i) => {
            const atual = i === idxEtapa && n.status === "aberto";
            const feito = i <= idxEtapa;
            return (
              <button
                key={e.id}
                type="button"
                disabled={n.status !== "aberto" || acao.isPending}
                onClick={() => i !== idxEtapa && acao.mutate({ rota: "mover", corpo: { etapa_id: e.id } })}
                title={`${e.nome}, ${e.probabilidade}% de probabilidade`}
                className={cn(
                  "etapa-seta -ml-1 flex h-9 min-w-[120px] flex-1 flex-col items-center justify-center px-5 text-xs transition-colors first:ml-0 disabled:cursor-default",
                  feito ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent",
                  n.status === "perdido" && feito && "bg-muted-foreground/40",
                )}
                data-testid={`etapa-${i}`}
              >
                <span className="line-clamp-1 font-medium">{e.nome}</span>
                {atual && <span className="text-[10px] opacity-85">{diasDesde(n.etapa_desde)} dias aqui</span>}
              </button>
            );
          })}
        </div>
        {n.status === "perdido" && n.motivo_perda && (
          <p className="border-t px-5 py-2 text-sm text-atrasada">Motivo da perda: {n.motivo_perda}</p>
        )}
        {resumo.parado && (
          <p className="border-t px-5 py-2 text-sm text-atrasada">
            Parado há {diasDesde(n.etapa_desde)} dias em {etapa?.nome}. O limite desta etapa é {etapa?.dias_parado} dias.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* Coluna lateral */}
        <div className="space-y-4">
          <Bloco titulo="Cliente">
            {cliente ? (
              <div className="space-y-3">
                <p className="font-semibold">{cliente.nome}</p>
                <div className="space-y-1 text-sm">
                  {cliente.telefone && (
                    <a href={`tel:${cliente.telefone}`} className="flex items-center gap-2 hover:text-primary">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" /> {cliente.telefone}
                    </a>
                  )}
                  {cliente.email && (
                    <a href={`mailto:${cliente.email}`} className="flex items-center gap-2 break-all hover:text-primary">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" /> {cliente.email}
                    </a>
                  )}
                </div>
                <div className="flex gap-2">
                  {whats && (
                    <a
                      href={whats}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-[#25d366] text-xs font-semibold text-[#073b1e] hover:brightness-95"
                    >
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </a>
                  )}
                  {cliente.telefone && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 flex-1"
                      onClick={() => setAtividade({ a: null, padrao: { tipo: "ligacao", negocio_id: id, corretor_id: n.corretor_id, data: hoje, assunto: `Ligar para ${cliente.nome.split(" ")[0]}` } })}
                    >
                      <Phone className="h-3.5 w-3.5" /> Registrar ligação
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum cliente vinculado. Edite o negócio para escolher.</p>
            )}
          </Bloco>

          {seg.veiculos && (
            <Bloco titulo="Veículo">
              {veiculo ? (
                <Link to={`/veiculos?id=${veiculo.id}`} className="block space-y-2">
                  {veiculo.foto_url ? (
                    <img src={veiculo.foto_url} alt="" className="aspect-[16/9] w-full rounded-md bg-muted object-cover" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                  ) : (
                    <div className="flex aspect-[16/9] items-center justify-center rounded-md bg-muted"><Car className="h-8 w-8 text-muted-foreground/60" /></div>
                  )}
                  <p className="font-semibold leading-snug hover:text-primary">{veiculo.titulo}</p>
                  <p className="text-xs text-muted-foreground">{[veiculo.codigo, veiculo.km ? `${veiculo.km.toLocaleString("pt-BR")} km` : null, veiculo.cor, veiculo.status === "vendido" ? "vendido" : null].filter(Boolean).join(", ")}</p>
                  {veiculo.preco_venda ? <p className="num text-sm">{brl(veiculo.preco_venda)}</p> : null}
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">Sem veículo vinculado. Edite o negócio para escolher.</p>
              )}
            </Bloco>
          )}

          {seg.imobiliaria && <Bloco titulo="Imóvel">
            {imovel ? (
              <Link to={`/imoveis?id=${imovel.id}`} className="block space-y-2">
                {imovel.foto_url ? (
                  <img
                    src={imovel.foto_url}
                    alt=""
                    className="aspect-[16/9] w-full rounded-md bg-muted object-cover"
                    onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                  />
                ) : (
                  <div className="flex aspect-[16/9] items-center justify-center rounded-md bg-muted">
                    <Building2 className="h-8 w-8 text-muted-foreground/60" />
                  </div>
                )}
                <p className="font-semibold leading-snug hover:text-primary">{imovel.titulo}</p>
                <p className="text-xs text-muted-foreground">
                  {[imovel.codigo, imovel.bairro, imovel.cidade].filter(Boolean).join(", ")}
                </p>
                <p className="num text-sm">
                  {imovel.valor_venda ? brl(imovel.valor_venda) : ""}
                  {imovel.valor_aluguel ? `${imovel.valor_venda ? " / " : ""}${brl(imovel.valor_aluguel)} mês` : ""}
                </p>
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">Sem imóvel vinculado.</p>
            )}
          </Bloco>}

          <Bloco titulo="Resumo">
            <Linha rotulo="Etapa">{etapa?.nome ?? "—"}</Linha>
            <Linha rotulo="Probabilidade">{etapa?.probabilidade ?? 0}%</Linha>
            <Linha rotulo="Valor ponderado">{brl((n.valor_estimado ?? 0) * ((etapa?.probabilidade ?? 0) / 100))}</Linha>
            <Linha rotulo="Previsão">{n.previsao_fechamento ? dataBR(n.previsao_fechamento) : "—"}</Linha>
            <Linha rotulo="Origem">{n.origem}</Linha>
            <Linha rotulo="Criado em">{dataHoraBR(n.created_at)}</Linha>
            {responsavel?.telefone && <Linha rotulo={`Telefone do ${seg.termos.profissional.toLowerCase()}`}>{responsavel.telefone}</Linha>}
            {n.observacoes && <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/60 p-2 text-sm">{n.observacoes}</p>}
          </Bloco>
        </div>

        {/* Coluna principal */}
        <div className="min-w-0 space-y-4">
          <section className="rounded-lg border bg-card">
            <div className="flex border-b" role="tablist">
              {(
                [
                  ["nota", StickyNote, "Anotação"],
                  ["atividade", CalendarPlus, "Atividade"],
                ] as const
              ).map(([v, Icone, rotulo]) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={aba === v}
                  onClick={() => (v === "atividade" ? setAtividade({ a: null, padrao: { negocio_id: id, corretor_id: n.corretor_id } }) : setAba(v))}
                  className={cn(
                    "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium",
                    aba === v ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icone className="h-4 w-4" /> {rotulo}
                </button>
              ))}
              {seg.imobiliaria && (
                <button
                  onClick={() => setVisitaAberta(true)}
                  className="flex items-center gap-1.5 border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  <Home className="h-4 w-4" /> Visita
                </button>
              )}
              {seg.veiculos && (
                <button
                  onClick={() => setAtividade({ a: null, padrao: { tipo: "visita", negocio_id: id, corretor_id: n.corretor_id, data: hoje, assunto: `Test drive ${veiculo?.titulo ?? ""}`.trim() } })}
                  className="flex items-center gap-1.5 border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  <Car className="h-4 w-4" /> Test drive
                </button>
              )}
            </div>
            <div className="p-3">
              <Textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={3}
                placeholder="Registre o que foi conversado, objeções, preferências do cliente…"
                className="resize-y border-0 bg-latao/5 shadow-none focus-visible:ring-0"
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && nota.trim()) salvarNota.mutate();
                }}
                data-testid="nota-texto"
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <span className="mr-auto text-xs text-muted-foreground">Ctrl + Enter para salvar</span>
                <Button size="sm" disabled={!nota.trim() || salvarNota.isPending} onClick={() => salvarNota.mutate()} data-testid="nota-salvar">
                  Salvar anotação
                </Button>
              </div>
            </div>
          </section>

          {/* Próximos passos */}
          <section className="rounded-lg border bg-card">
            <header className="flex items-center justify-between border-b px-4 py-2.5">
              <h3 className="text-sm font-semibold">Próximos passos</h3>
              <Button variant="ghost" size="sm" onClick={() => setAtividade({ a: null, padrao: { negocio_id: id, corretor_id: n.corretor_id } })}>
                <CalendarPlus className="h-3.5 w-3.5" /> Agendar
              </Button>
            </header>
            <ul className="divide-y">
              {pendentes.map((a) => {
                const meta = ATIVIDADE[a.tipo];
                const atrasada = a.data < hoje;
                return (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                    <button
                      type="button"
                      aria-label="Concluir atividade"
                      onClick={() => concluir.mutate(a)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 hover:border-hoje hover:bg-hoje/10"
                    />
                    <meta.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <button type="button" onClick={() => setAtividade({ a })} className="min-w-0 flex-1 text-left">
                      <p className="flex items-center gap-1 truncate text-sm font-medium">
                        {a.created_by === "automacao" && <Zap className="h-3 w-3 shrink-0 text-sax" aria-label="Criada por automação" />}
                        {a.assunto}
                      </p>
                      {a.notas && <p className="truncate text-xs text-muted-foreground">{a.notas}</p>}
                    </button>
                    <span className={cn("shrink-0 text-xs", atrasada ? "font-semibold text-atrasada" : a.data === hoje ? "font-semibold text-hoje" : "text-muted-foreground")}>
                      {dataCurta(a.data)}
                      {a.hora ? `, ${a.hora}` : ""}
                    </span>
                  </li>
                );
              })}
              {visitas
                .filter((v) => v.status === "agendada")
                .map((v) => (
                  <li key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Home className="ml-8 h-4 w-4 shrink-0 text-primary" />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{v.titulo}</p>
                    <span className="text-xs text-muted-foreground">
                      Visita {dataCurta(v.data)}, {v.hora}
                    </span>
                  </li>
                ))}
              {!pendentes.length && !visitas.some((v) => v.status === "agendada") && (
                <li className="flex items-center gap-3 px-4 py-4 text-sm">
                  <span className="h-2 w-2 rounded-full bg-sem-atividade" />
                  <span className="text-muted-foreground">Nenhum próximo passo agendado. Negócio sem atividade tende a esfriar.</span>
                </li>
              )}
            </ul>
          </section>

          {tem("propostas") && (
            <PropostasPainel
              negocioId={n.id}
              aberto={n.status === "aberto"}
              valorAnunciado={seg.veiculos ? veiculo?.preco_venda ?? null : imovel ? (imovel.finalidade === "locacao" ? imovel.valor_aluguel : imovel.valor_venda) : null}
            />
          )}

          {tem("match") && seg.imobiliaria && <CompativeisPainel negocioId={n.id} clienteNome={cliente?.nome} clienteTelefone={cliente?.telefone} corretorNome={resumo.corretor_nome} />}

          <DocumentosPainel negocioId={n.id} clienteEmail={cliente?.email} clienteTelefone={cliente?.telefone} clienteNome={cliente?.nome} />

          {/* Histórico */}
          <section className="rounded-lg border bg-card">
            <header className="border-b px-4 py-2.5">
              <h3 className="text-sm font-semibold">Histórico</h3>
            </header>
            <ol className="relative space-y-0 px-4 py-3">
              {[...fixadas, ...historico.filter((h) => !h.fixado)].map((ev) => {
                const Icone = ICONE_EVENTO[ev.tipo] ?? Check;
                const ehNota = ev.tipo === "nota";
                const podeEditar = ehNota && (isAdmin || ev.autor_id === principal?.usuario_id);
                return (
                  <li key={ev.id} className="relative flex gap-3 pb-4 last:pb-0">
                    <span className="absolute left-[13px] top-7 h-[calc(100%-24px)] w-px bg-border" aria-hidden />
                    <span
                      className={cn(
                        "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                        ehNota
                          ? "bg-latao/20 text-latao"
                          : ev.tipo === "status"
                            ? "bg-hoje/15 text-hoje"
                            : ev.tipo === "vitrine" || ev.tipo === "match"
                              ? "bg-sax/15 text-sax"
                              : ev.tipo === "proposta"
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icone className="h-3.5 w-3.5" />
                    </span>
                    <div className={cn("min-w-0 flex-1", ehNota && "rounded-md border border-latao/25 bg-latao/5 p-2.5")}>
                      <p className={cn("text-sm", ehNota ? "whitespace-pre-wrap" : "")}>{ev.texto}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {quando(ev.em)}, {ev.autor ?? "Sistema"}
                        {ev.fixado && <Pin className="h-3 w-3 text-latao" />}
                        {podeEditar && (
                          <>
                            <button className="hover:text-foreground" onClick={() => fixarNota.mutate(ev)}>
                              {ev.fixado ? "Desafixar" : "Fixar"}
                            </button>
                            <button className="hover:text-destructive" onClick={() => excluirNota.mutate(ev)} aria-label="Excluir anotação">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
              {feitas.length > 0 && (
                <li className="pt-2 text-xs text-muted-foreground">{feitas.length} atividade(s) concluída(s) neste negócio.</li>
              )}
            </ol>
          </section>
        </div>
      </div>

      <NegocioModal open={editar} onClose={() => setEditar(false)} negocio={n} />
      <PerderDialog negocioId={perder ? n.id : null} nome={n.nome} onClose={() => setPerder(false)} />
      <AtividadeModal open={!!atividade} onClose={() => setAtividade(null)} atividade={atividade?.a} padrao={atividade?.padrao} travarNegocio />
      <VisitaModal
        open={visitaAberta}
        onClose={() => {
          setVisitaAberta(false);
          qc.invalidateQueries({ queryKey: ["visitas", "negocio", id] });
          qc.invalidateQueries({ queryKey: ["historico", id] });
        }}
        visita={null}
        dataPadrao={hoje}
        leads={[n]}
        imoveis={imoveis}
        pessoas={pessoas}
        isAdmin={isAdmin}
        preset={{ titulo: `Visita ${imovel?.titulo ?? ""}`.trim(), lead_id: n.id, cliente_id: n.cliente_id, imovel_id: n.imovel_id, corretor_id: n.corretor_id, hora: "10:00" }}
      />
    </div>
  );
}
