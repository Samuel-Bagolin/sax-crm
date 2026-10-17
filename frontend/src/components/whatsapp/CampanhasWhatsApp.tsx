import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Megaphone, Pause, Play, Plus, ShieldAlert, Users, X } from "lucide-react";
import { apiDelete, apiGet, apiPost, detalheErro } from "@/lib/api";
import { useCrmConfig, useFunis } from "@/lib/crm";
import { useSegmento } from "@/lib/segmento";
import { useConfig } from "@/lib/useConfig";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Conexao } from "@/components/whatsapp/NumerosWhatsApp";

type Status = "rascunho" | "enviando" | "pausada" | "concluida" | "cancelada";
interface Publico {
  origem: "clientes" | "negocios"; aniversario: "hoje" | "semana" | "mes" | null; sem_atendimento_dias: number | null;
  funil_id: string | null; etapa_ids: string[]; status: "aberto" | "ganho" | "perdido" | null; temperaturas: string[]; etiquetas: string[];
  ja_conversou: boolean;
}
interface Campanha {
  id: string; nome: string; status: Status; conexao_id: string; conexao_nome: string | null; mensagem: string; publico: Publico;
  total: number; enviados: number; falhas: number; pulados: number; cursor: number; intervalo_min: number; intervalo_max: number;
  teto_diario: number; hora_inicio: string; hora_fim: string; domingo: boolean; motivo_pausa: string | null; proximo_em: string | null;
  criado_em: string | null; criado_por: string | null; enviados_hoje_no_numero: number;
}
interface Previa { total: number; sem_telefone: number; sairam: number; sem_conversa: number; amostra: string[] }
interface Envio { ordem: number; nome: string; telefone: string; status: string; erro: string | null; em: string | null }
interface Saida { id: string; nome: string | null; telefone: string | null; em: string | null }

const ROTULO: Record<Status, { t: string; cor: string }> = {
  rascunho: { t: "Pronta para enviar", cor: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  enviando: { t: "Enviando", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  pausada: { t: "Pausada", cor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  concluida: { t: "Concluída", cor: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300" },
  cancelada: { t: "Cancelada", cor: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};
const ENVIO: Record<string, string> = { pendente: "Na fila", enviado: "Enviada", falhou: "Falhou", pulado: "Pulado" };
const RODAPE = "Para não receber mais estas mensagens, responda SAIR.";
const PUBLICO_VAZIO: Publico = { origem: "clientes", aniversario: null, sem_atendimento_dias: null, funil_id: null, etapa_ids: [], status: null,
  temperaturas: [], etiquetas: [], ja_conversou: true };

function hora(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
}

function resumoPublico(p: Publico, clientes: string) {
  const partes = [p.origem === "negocios" ? "Negócios filtrados" : `Todos os ${clientes.toLowerCase()}`];
  if (p.aniversario) partes.push({ hoje: "aniversário hoje", semana: "aniversário nos próximos 7 dias", mes: "aniversário no mês" }[p.aniversario]);
  if (p.sem_atendimento_dias) partes.push(`sem movimento há ${p.sem_atendimento_dias} dias`);
  if (p.temperaturas.length) partes.push(p.temperaturas.join(", "));
  if (p.etiquetas.length) partes.push(`etiquetas: ${p.etiquetas.join(", ")}`);
  if (p.ja_conversou) partes.push("só quem já conversou");
  return partes.join(" · ");
}

/** Envio em massa com limite seguro. Só o gestor vê. A fila anda enquanto esta tela está aberta e pelo disparador da plataforma. */
export function CampanhasWhatsApp({ conexoes }: { conexoes: Conexao[] }) {
  const qc = useQueryClient();
  const { termos } = useSegmento();
  const [nova, setNova] = useState(false);
  const [verEnvios, setVerEnvios] = useState<Campanha | null>(null);
  const [verSaidas, setVerSaidas] = useState(false);
  const lista = useQuery({ queryKey: ["wa", "campanhas"], queryFn: () => apiGet<{ campanhas: Campanha[]; sairam: number }>("/whatsapp/campanhas") });
  const campanhas = lista.data?.campanhas ?? [];
  const enviando = campanhas.some((c) => c.status === "enviando");

  // Com campanha em envio e a aba visível: um toque a cada 15 s (o servidor respeita intervalo, teto e horário).
  useEffect(() => {
    if (!enviando) return;
    const tocar = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        await apiPost("/whatsapp/campanhas/processar");
      } finally {
        qc.invalidateQueries({ queryKey: ["wa", "campanhas"] });
      }
    };
    tocar();
    const t = window.setInterval(tocar, 15_000);
    return () => window.clearInterval(t);
  }, [enviando, qc]);

  const acao = useMutation({
    mutationFn: ({ id, o }: { id: string; o: "iniciar" | "pausar" | "cancelar" }) => apiPost<Campanha>(`/whatsapp/campanhas/${id}/${o}`),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["wa", "campanhas"] });
      toast.success({ iniciar: "Campanha em envio.", pausar: "Campanha pausada.", cancelar: "Campanha cancelada." }[v.o]);
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível mudar a campanha."),
  });

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto" data-testid="wa-campanhas">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="max-w-2xl space-y-1">
          <h2 className="flex items-center gap-2 font-semibold"><Megaphone className="h-4 w-4" /> Campanhas</h2>
          <p className="text-sm text-muted-foreground">
            Mensagem para uma lista de {termos.clientes.toLowerCase()} com intervalo aleatório entre envios, teto por dia e horário comercial.
            Toda mensagem leva a opção de responder SAIR. Os envios andam enquanto esta tela estiver aberta em algum computador.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setVerSaidas(true)} data-testid="wa-campanhas-saidas">
            <Users className="mr-1.5 h-4 w-4" /> Pediram para sair ({lista.data?.sairam ?? 0})
          </Button>
          <Button size="sm" onClick={() => setNova(true)} disabled={!conexoes.some((c) => c.status === "conectado")} data-testid="wa-campanha-nova">
            <Plus className="mr-1.5 h-4 w-4" /> Nova campanha
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>A conexão por QR code não é a API oficial do WhatsApp. Mensagem em massa para quem não espera é o motivo mais comum de bloqueio do número. Comece com poucos contatos, mantenha o teto baixo e prefira quem já conversou com vocês.</p>
      </div>

      {lista.isLoading ? (
        <p className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Carregando...</p>
      ) : campanhas.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma campanha ainda.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {campanhas.map((c) => {
            const pct = c.total ? Math.round((c.cursor / c.total) * 100) : 0;
            return (
              <div key={c.id} className="space-y-3 rounded-xl border bg-card p-4" data-testid={`wa-campanha-${c.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.nome}</p>
                    <p className="text-xs text-muted-foreground">{c.conexao_nome} · {resumoPublico(c.publico, termos.clientes)}</p>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", ROTULO[c.status].cor)}>{ROTULO[c.status].t}</span>
                </div>
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.enviados} enviadas de {c.total}{c.falhas ? ` · ${c.falhas} falharam` : ""}{c.pulados ? ` · ${c.pulados} saíram antes` : ""}
                    {c.status === "enviando" && ` · hoje no número: ${c.enviados_hoje_no_numero}/${c.teto_diario}`}
                    {c.status === "enviando" && c.proximo_em && ` · próxima a partir de ${hora(c.proximo_em)}`}
                  </p>
                  {c.motivo_pausa && c.status === "pausada" && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{c.motivo_pausa}</p>}
                </div>
                <p className="line-clamp-2 whitespace-pre-line text-sm text-muted-foreground">{c.mensagem}</p>
                <div className="flex flex-wrap gap-2">
                  {(c.status === "rascunho" || c.status === "pausada") && (
                    <Button size="sm" onClick={() => acao.mutate({ id: c.id, o: "iniciar" })} disabled={acao.isPending} data-testid="wa-campanha-iniciar">
                      <Play className="mr-1.5 h-4 w-4" /> {c.status === "pausada" ? "Retomar" : "Começar envio"}
                    </Button>
                  )}
                  {c.status === "enviando" && (
                    <Button size="sm" variant="outline" onClick={() => acao.mutate({ id: c.id, o: "pausar" })} disabled={acao.isPending}>
                      <Pause className="mr-1.5 h-4 w-4" /> Pausar
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setVerEnvios(c)}>Ver envios</Button>
                  {!["concluida", "cancelada"].includes(c.status) && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (window.confirm("Cancelar a campanha? Quem ainda não recebeu fica sem receber.")) acao.mutate({ id: c.id, o: "cancelar" }); }}>
                      Cancelar
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {nova && <NovaCampanha conexoes={conexoes} onFechar={() => setNova(false)} />}
      {verEnvios && <Envios campanha={verEnvios} onFechar={() => setVerEnvios(null)} />}
      {verSaidas && <Saidas onFechar={() => setVerSaidas(false)} />}
    </div>
  );
}

function Chips<T extends string>({ opcoes, valor, onChange }: { opcoes: [T, string][]; valor: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opcoes.map(([v, t]) => {
        const on = valor.includes(v);
        return (
          <button key={v} type="button" onClick={() => onChange(on ? valor.filter((x) => x !== v) : [...valor, v])}
            className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
            {t}
          </button>
        );
      })}
    </div>
  );
}

const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";

function NovaCampanha({ conexoes, onFechar }: { conexoes: Conexao[]; onFechar: () => void }) {
  const qc = useQueryClient();
  const { termos, chave: segmento } = useSegmento();
  const funis = useFunis();
  const crm = useCrmConfig();
  const { config } = useConfig();
  const conectadas = conexoes.filter((c) => c.status === "conectado");
  const [nome, setNome] = useState("");
  const [conexaoId, setConexaoId] = useState(conectadas[0]?.id ?? "");
  const [mensagem, setMensagem] = useState(segmento === "barbearia" ? "Fala, {nome}! Faz tempo que você não aparece aqui na {empresa}. Bora marcar?" : "Olá, {nome}! Tudo bem? Aqui é da {empresa}.");
  const [p, setP] = useState<Publico>(PUBLICO_VAZIO);
  const [ritmo, setRitmo] = useState({ intervalo_min: 40, intervalo_max: 90, teto_diario: 60, hora_inicio: "09:00", hora_fim: "19:00", domingo: false });
  const [previa, setPrevia] = useState<Previa | null>(null);
  const funil = (funis.data ?? []).find((f) => f.id === p.funil_id);
  const mudarP = (m: Partial<Publico>) => { setP((x) => ({ ...x, ...m })); setPrevia(null); };

  const contar = useMutation({
    mutationFn: () => apiPost<Previa>("/whatsapp/campanhas/previa", p as never),
    onSuccess: setPrevia,
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível contar o público."),
  });
  useEffect(() => { const t = window.setTimeout(() => contar.mutate(), 400); return () => window.clearTimeout(t); }, [p]); // eslint-disable-line react-hooks/exhaustive-deps

  const criar = useMutation({
    mutationFn: async (comecar: boolean) => {
      const c = await apiPost<Campanha>("/whatsapp/campanhas", { nome, conexao_id: conexaoId, mensagem, publico: p, ...ritmo } as never);
      if (comecar) await apiPost(`/whatsapp/campanhas/${c.id}/iniciar`);
      return comecar;
    },
    onSuccess: (comecar) => {
      qc.invalidateQueries({ queryKey: ["wa", "campanhas"] });
      toast.success(comecar ? "Campanha criada e em envio." : "Campanha salva. Comece o envio quando quiser.");
      onFechar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível criar a campanha."),
  });

  const exemplo = useMemo(() => `${mensagem.replaceAll("{nome}", previa?.amostra[0]?.split(" ")[0] ?? "Maria").replaceAll("{nome_completo}", previa?.amostra[0] ?? "Maria Souza").replaceAll("{empresa}", config.nome_software || "sua empresa").trim()}\n\n${RODAPE}`, [mensagem, previa, config.nome_software]);
  const diasEstimados = previa?.total ? Math.ceil(previa.total / ritmo.teto_diario) : 0;
  const podeSalvar = nome.trim().length >= 2 && conexaoId && mensagem.trim().length >= 5 && (previa?.total ?? 0) > 0 && ritmo.intervalo_max >= ritmo.intervalo_min;

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova campanha</DialogTitle>
          <DialogDescription>Escolha quem recebe, escreva a mensagem e o ritmo do envio.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Nome da campanha</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Aniversariantes de outubro" data-testid="wa-campanha-nome" /></div>
            <div className="space-y-1.5"><Label>Enviar pelo número</Label>
              <select className={sel} value={conexaoId} onChange={(e) => setConexaoId(e.target.value)}>
                {conectadas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.pessoal ? ` (celular de ${c.dono_nome})` : ""}</option>)}
              </select>
            </div>
          </div>

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Quem recebe</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>Base</Label>
                <select className={sel} value={p.origem} onChange={(e) => mudarP({ origem: e.target.value as Publico["origem"] })}>
                  <option value="clientes">{termos.clientes}</option><option value="negocios">Negócios do funil</option>
                </select>
              </div>
              <div className="space-y-1.5"><Label>Aniversário</Label>
                <select className={sel} value={p.aniversario ?? ""} onChange={(e) => mudarP({ aniversario: (e.target.value || null) as Publico["aniversario"] })}>
                  <option value="">Tanto faz</option><option value="hoje">Hoje</option><option value="semana">Próximos 7 dias</option><option value="mes">Este mês</option>
                </select>
              </div>
              <div className="space-y-1.5"><Label>Sem movimento há (dias)</Label>
                <Input type="number" min={7} max={1095} value={p.sem_atendimento_dias ?? ""} placeholder="Ex.: 60" onChange={(e) => mudarP({ sem_atendimento_dias: e.target.value ? Number(e.target.value) : null })} />
              </div>
            </div>
            {p.origem === "negocios" && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label>Funil</Label>
                    <select className={sel} value={p.funil_id ?? ""} onChange={(e) => mudarP({ funil_id: e.target.value || null, etapa_ids: [] })}>
                      <option value="">Todos</option>{(funis.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5"><Label>Situação</Label>
                    <select className={sel} value={p.status ?? ""} onChange={(e) => mudarP({ status: (e.target.value || null) as Publico["status"] })}>
                      <option value="">Todas</option><option value="aberto">Em aberto</option><option value="ganho">Ganhos</option><option value="perdido">Perdidos</option>
                    </select>
                  </div>
                </div>
                {funil && <div className="space-y-1.5"><Label>Etapas</Label><Chips opcoes={funil.etapas.map((e) => [e.id, e.nome] as [string, string])} valor={p.etapa_ids} onChange={(v) => mudarP({ etapa_ids: v })} /></div>}
                <div className="space-y-1.5"><Label>Temperatura</Label><Chips opcoes={[["quente", "Quente"], ["morno", "Morno"], ["frio", "Frio"]]} valor={p.temperaturas} onChange={(v) => mudarP({ temperaturas: v })} /></div>
                {(crm.data?.etiquetas ?? []).length > 0 && <div className="space-y-1.5"><Label>Etiquetas</Label><Chips opcoes={(crm.data?.etiquetas ?? []).map((e) => [e, e] as [string, string])} valor={p.etiquetas} onChange={(v) => mudarP({ etiquetas: v })} /></div>}
              </div>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={p.ja_conversou} onChange={(e) => mudarP({ ja_conversou: e.target.checked })} data-testid="wa-campanha-ja-conversou" />
              <span>Só quem já conversou com a empresa no WhatsApp <span className="text-muted-foreground">(recomendado: reduz o risco de bloqueio)</span></span>
            </label>
            <div className="rounded-md bg-muted/50 p-2 text-sm" data-testid="wa-campanha-previa">
              {contar.isPending && !previa ? <span className="text-muted-foreground"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />Contando...</span> : previa ? (
                <>
                  <p><strong>{previa.total}</strong> {previa.total === 1 ? "pessoa recebe" : "pessoas recebem"}.
                    {previa.sem_telefone > 0 && ` ${previa.sem_telefone} sem celular válido.`}
                    {previa.sem_conversa > 0 && ` ${previa.sem_conversa} ${previa.sem_conversa === 1 ? "nunca conversou" : "nunca conversaram"} no WhatsApp.`}
                    {previa.sairam > 0 && ` ${previa.sairam} ${previa.sairam === 1 ? "pediu" : "pediram"} para sair.`}
                  </p>
                  {previa.amostra.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{previa.amostra.join(", ")}{previa.total > previa.amostra.length ? "..." : ""}</p>}
                </>
              ) : null}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Mensagem</Label>
              <textarea className="min-h-32 w-full rounded-md border bg-background p-2 text-sm" maxLength={1000} value={mensagem} onChange={(e) => setMensagem(e.target.value)} data-testid="wa-campanha-mensagem" />
              <div className="flex flex-wrap gap-1.5 text-xs">
                {["{nome}", "{nome_completo}", "{empresa}"].map((v) => (
                  <button key={v} type="button" className="rounded border px-1.5 py-0.5 text-muted-foreground hover:bg-muted" onClick={() => setMensagem((m) => `${m}${m.endsWith(" ") ? "" : " "}${v}`)}>{v}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Como chega</Label>
              <div className="min-h-32 whitespace-pre-line rounded-lg bg-[#dcf8c6] p-3 text-sm text-slate-900 dark:bg-emerald-900 dark:text-emerald-50">{exemplo}</div>
            </div>
          </div>

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Ritmo do envio</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div className="space-y-1.5"><Label>Intervalo mín. (s)</Label><Input type="number" min={20} max={600} value={ritmo.intervalo_min} onChange={(e) => setRitmo({ ...ritmo, intervalo_min: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label>Intervalo máx. (s)</Label><Input type="number" min={20} max={900} value={ritmo.intervalo_max} onChange={(e) => setRitmo({ ...ritmo, intervalo_max: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label>Teto por dia</Label><Input type="number" min={1} max={300} value={ritmo.teto_diario} onChange={(e) => setRitmo({ ...ritmo, teto_diario: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label>Das</Label><Input type="time" value={ritmo.hora_inicio} onChange={(e) => setRitmo({ ...ritmo, hora_inicio: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Até</Label><Input type="time" value={ritmo.hora_fim} onChange={(e) => setRitmo({ ...ritmo, hora_fim: e.target.value })} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ritmo.domingo} onChange={(e) => setRitmo({ ...ritmo, domingo: e.target.checked })} /> Enviar também aos domingos</label>
            {diasEstimados > 0 && <p className="text-xs text-muted-foreground">O teto vale para o número inteiro (somando campanhas). Nesse ritmo, cerca de {diasEstimados} {diasEstimados === 1 ? "dia" : "dias"} para terminar.</p>}
          </fieldset>
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
          <Button variant="outline" disabled={!podeSalvar || criar.isPending} onClick={() => criar.mutate(false)}>Salvar sem enviar</Button>
          <Button disabled={!podeSalvar || criar.isPending} onClick={() => criar.mutate(true)} data-testid="wa-campanha-criar">
            {criar.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Criar e começar envio
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Envios({ campanha, onFechar }: { campanha: Campanha; onFechar: () => void }) {
  const q = useQuery({ queryKey: ["wa", "campanhas", campanha.id, "envios"], queryFn: () => apiGet<Envio[]>(`/whatsapp/campanhas/${campanha.id}/envios`) });
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{campanha.nome}</DialogTitle><DialogDescription>{campanha.total} na lista, na ordem de envio.</DialogDescription></DialogHeader>
        <ul className="divide-y text-sm">
          {(q.data ?? []).map((e) => (
            <li key={e.ordem} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 truncate">{e.nome} <span className="text-xs text-muted-foreground">{e.telefone}</span></span>
              <span className={cn("shrink-0 text-xs", e.status === "falhou" ? "text-destructive" : e.status === "enviado" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")} title={e.erro ?? undefined}>
                {ENVIO[e.status] ?? e.status}{e.em ? ` ${hora(e.em)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function Saidas({ onFechar }: { onFechar: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["wa", "campanhas", "saidas"], queryFn: () => apiGet<Saida[]>("/whatsapp/campanhas/saidas") });
  const voltar = useMutation({
    mutationFn: (id: string) => apiDelete(`/whatsapp/campanhas/saidas/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wa", "campanhas"] }); toast.success("Contato volta a receber campanhas."); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pediram para sair</DialogTitle>
          <DialogDescription>Responderam SAIR e não recebem campanhas. Só tire alguém daqui se a própria pessoa pedir.</DialogDescription>
        </DialogHeader>
        {(q.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Ninguém pediu para sair.</p> : (
          <ul className="divide-y text-sm">
            {(q.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate">{s.nome ?? "Contato"} <span className="text-xs text-muted-foreground">{s.telefone} · {hora(s.em)}</span></span>
                <Button size="sm" variant="ghost" onClick={() => { if (window.confirm("A pessoa pediu para voltar a receber?")) voltar.mutate(s.id); }}><X className="mr-1 h-3.5 w-3.5" /> Tirar da lista</Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
