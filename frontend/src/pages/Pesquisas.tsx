import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, BarChart3, Copy, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { useSegmento } from "@/lib/segmento";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePessoasEquipe, type Conexao } from "@/components/whatsapp/NumerosWhatsApp";
import { CampoPergunta, type Pergunta, type TipoPergunta } from "@/pages/ResponderFormulario";
import { cn } from "@/lib/utils";

export interface Formulario {
  id: string; nome: string; descricao: string | null; perguntas: Pergunta[]; ativo: boolean; auto_apos_atendimento: boolean; intervalo_dias: number;
  conexao_id: string | null; mensagem_whatsapp: string; alerta_nota_ate: number; alerta_pessoa_id: string | null; link: string | null; respostas: number;
}
interface Nps { total: number; promotores: number; neutros: number; detratores: number; nps: number | null }
interface ResultadoPergunta {
  id: string; tipo: TipoPergunta; titulo: string; respondidas: number; nps?: Nps; distribuicao?: number[]; media?: number | null;
  contagem?: { opcao: string; qtd: number }[]; textos?: { texto: string; nome: string | null; em: string }[];
}
interface Resposta { id: string; nome: string | null; em: string; nota: number | null; baixa: boolean; tratada: boolean; origem: string; profissional_nome: string | null; respostas: Record<string, unknown> }
interface Resultado { formulario: Formulario; total: number; perguntas: ResultadoPergunta[]; profissionais: ({ nome: string; total: number } & Partial<Nps> & { media?: number })[]; respostas: Resposta[] }

const TIPOS: [TipoPergunta, string][] = [["nps", "NPS (0 a 10)"], ["nota", "Estrelas (1 a 5)"], ["escolha", "Uma opção"], ["multipla", "Várias opções"], ["sim_nao", "Sim ou não"], ["texto", "Texto livre"]];
const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export function useFormularios() {
  return useQuery({ queryKey: ["formularios"], queryFn: () => apiGet<Formulario[]>("/formularios") });
}

function copiar(t: string) {
  navigator.clipboard?.writeText(t);
  toast.success("Link copiado.");
}

/** Formulários, pesquisas e NPS (gestor). */
export default function Pesquisas() {
  const qc = useQueryClient();
  const lista = useFormularios();
  const [editar, setEditar] = useState<Formulario | null>(null);
  const [ver, setVer] = useState<Formulario | null>(null);
  const criar = useMutation({
    mutationFn: (modelo: string) => apiPost<Formulario>("/formularios", { modelo }),
    onSuccess: (f) => { qc.invalidateQueries({ queryKey: ["formularios"] }); setEditar(f); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível criar."),
  });
  const remover = useMutation({
    mutationFn: (id: string) => apiDelete(`/formularios/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["formularios"] }); toast.success("Formulário excluído."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível excluir."),
  });

  if (ver) return <Resultados formulario={ver} onVoltar={() => setVer(null)} />;
  return (
    <div className="space-y-4" data-testid="pesquisas">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Monte pesquisas e NPS, mande o link pelo WhatsApp (em uma campanha ou sozinho depois do atendimento) e acompanhe as notas. Nota baixa vira tarefa para quem você escolher.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => criar.mutate("satisfacao")} disabled={criar.isPending}><Plus className="mr-1.5 h-4 w-4" /> Pesquisa de satisfação</Button>
          <Button variant="outline" size="sm" onClick={() => criar.mutate("vazio")} disabled={criar.isPending}><Plus className="mr-1.5 h-4 w-4" /> Em branco</Button>
          <Button size="sm" onClick={() => criar.mutate("nps")} disabled={criar.isPending} data-testid="form-novo-nps"><Plus className="mr-1.5 h-4 w-4" /> Pesquisa NPS</Button>
        </div>
      </div>
      {lista.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (lista.data ?? []).length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma pesquisa ainda. Comece pela de NPS: é uma pergunta e mostra quem indica vocês.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(lista.data ?? []).map((f) => (
            <div key={f.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4" data-testid="form-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="truncate font-medium">{f.nome}</p><p className="text-xs text-muted-foreground">{f.perguntas.length} pergunta(s) · {f.respostas} resposta(s)</p></div>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs", f.ativo ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>{f.ativo ? "Ativa" : "Encerrada"}</span>
              </div>
              {f.auto_apos_atendimento && <p className="text-xs text-primary">Vai sozinha pelo WhatsApp depois do atendimento concluído</p>}
              <div className="mt-auto flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setVer(f)} data-testid="form-resultados"><BarChart3 className="mr-1.5 h-4 w-4" /> Resultados</Button>
                <Button size="sm" variant="outline" onClick={() => setEditar(f)}><Pencil className="mr-1.5 h-4 w-4" /> Editar</Button>
                {f.link && <Button size="sm" variant="outline" onClick={() => copiar(f.link!)}><Copy className="mr-1.5 h-4 w-4" /> Link</Button>}
                {f.respostas === 0 && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (window.confirm("Excluir este formulário?")) remover.mutate(f.id); }}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {editar && <Editor formulario={editar} onFechar={() => setEditar(null)} />}
    </div>
  );
}

function Editor({ formulario, onFechar }: { formulario: Formulario; onFechar: () => void }) {
  const qc = useQueryClient();
  const { servicos } = useSegmento();
  const pessoas = usePessoasEquipe();
  const wa = useQuery({ queryKey: ["wa", "situacao"], queryFn: () => apiGet<{ conexoes: Conexao[] }>("/whatsapp/situacao"), retry: false });
  const [f, setF] = useState<Formulario>(formulario);
  const [previa, setPrevia] = useState(false);
  const mudarP = (i: number, m: Partial<Pergunta>) => setF((x) => ({ ...x, perguntas: x.perguntas.map((p, j) => (j === i ? { ...p, ...m } : p)) }));
  const mover = (i: number, d: number) => setF((x) => { const ps = [...x.perguntas]; const [p] = ps.splice(i, 1); ps.splice(i + d, 0, p); return { ...x, perguntas: ps }; });
  const novoId = () => { let n = f.perguntas.length + 1; while (f.perguntas.some((p) => p.id === `p${n}`)) n++; return `p${n}`; };
  const salvar = useMutation({
    mutationFn: () => apiPut<Formulario>(`/formularios/${f.id}`, {
      nome: f.nome, descricao: f.descricao, perguntas: f.perguntas, ativo: f.ativo, auto_apos_atendimento: f.auto_apos_atendimento,
      intervalo_dias: f.intervalo_dias, conexao_id: f.conexao_id, mensagem_whatsapp: f.mensagem_whatsapp, alerta_nota_ate: f.alerta_nota_ate,
      alerta_pessoa_id: f.alerta_pessoa_id,
    } as never),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["formularios"] }); toast.success("Formulário salvo."); onFechar(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar."),
  });
  const trocarLink = useMutation({
    mutationFn: () => apiPost<Formulario>(`/formularios/${f.id}/novo-link`),
    onSuccess: (r) => { setF((x) => ({ ...x, link: r.link })); qc.invalidateQueries({ queryKey: ["formularios"] }); toast.success("Link novo gerado. O anterior parou de funcionar."); },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Editar formulário</DialogTitle><DialogDescription>Perguntas, envio automático e alerta de nota baixa.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1.5"><Label>Nome</Label><Input value={f.nome} maxLength={100} onChange={(e) => setF({ ...f, nome: e.target.value })} data-testid="form-nome" /></div>
            <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Recebendo respostas</label>
          </div>
          <div className="space-y-1.5"><Label>Texto de abertura</Label><Input value={f.descricao ?? ""} maxLength={600} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
          {f.link && (
            <div className="flex gap-2"><Input readOnly value={f.link} onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" onClick={() => copiar(f.link!)}><Copy className="h-4 w-4" /></Button>
              <Button type="button" variant="outline" title="Gerar link novo" onClick={() => { if (window.confirm("Gerar um link novo? O atual para de funcionar.")) trocarLink.mutate(); }}><RefreshCw className="h-4 w-4" /></Button>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label>Perguntas</Label>
              <button type="button" className="text-sm text-primary" onClick={() => setPrevia((v) => !v)}>{previa ? "Editar perguntas" : "Ver como o cliente vê"}</button>
            </div>
            {previa ? (
              <div className="space-y-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                {f.perguntas.map((p, i) => <div key={p.id} className="space-y-2 rounded-lg border bg-white p-3 text-slate-900"><p className="text-sm font-medium">{i + 1}. {p.titulo}</p><CampoPergunta p={p} valor={undefined} onChange={() => {}} cor="#4a03a2" /></div>)}
              </div>
            ) : f.perguntas.map((p, i) => (
              <div key={p.id} className="space-y-2 rounded-lg border p-3" data-testid="form-pergunta">
                <div className="grid gap-2 sm:grid-cols-[1fr_170px]">
                  <Input value={p.titulo} maxLength={300} onChange={(e) => mudarP(i, { titulo: e.target.value })} placeholder="Pergunta" />
                  <select className={sel} value={p.tipo} onChange={(e) => mudarP(i, { tipo: e.target.value as TipoPergunta })} disabled={formulario.respostas > 0 && formulario.perguntas.some((x) => x.id === p.id)}>
                    {TIPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </div>
                {(p.tipo === "escolha" || p.tipo === "multipla") && (
                  <textarea className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" placeholder="Uma opção por linha" value={p.opcoes.join("\n")}
                    onChange={(e) => mudarP(i, { opcoes: e.target.value.split("\n") })} />
                )}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.obrigatoria} onChange={(e) => mudarP(i, { obrigatoria: e.target.checked })} /> Obrigatória</label>
                  <div className="flex gap-1">
                    <Button type="button" size="icon" variant="ghost" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir"><ArrowUp className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" disabled={i === f.perguntas.length - 1} onClick={() => mover(i, 1)} aria-label="Descer"><ArrowDown className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" disabled={f.perguntas.length === 1} onClick={() => setF({ ...f, perguntas: f.perguntas.filter((_, j) => j !== i) })} aria-label="Remover"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </div>
            ))}
            {!previa && <Button type="button" variant="outline" size="sm" onClick={() => setF({ ...f, perguntas: [...f.perguntas, { id: novoId(), tipo: "texto", titulo: "", obrigatoria: false, opcoes: [] }] })}><Plus className="mr-1.5 h-4 w-4" /> Pergunta</Button>}
          </div>

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Alerta de nota baixa</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>NPS até (0 a 9)</Label><Input type="number" min={0} max={9} value={f.alerta_nota_ate} onChange={(e) => setF({ ...f, alerta_nota_ate: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label>Tarefa para</Label>
                <select className={sel} value={f.alerta_pessoa_id ?? ""} onChange={(e) => setF({ ...f, alerta_pessoa_id: e.target.value || null })}>
                  <option value="">Ninguém (sem alerta)</option>{pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Nas estrelas, 1 e 2 contam como nota baixa.</p>
          </fieldset>

          {servicos && (
            <fieldset className="space-y-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">Depois do atendimento</legend>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={f.auto_apos_atendimento} onChange={(e) => setF({ ...f, auto_apos_atendimento: e.target.checked })} data-testid="form-auto" />
                <span>Mandar esta pesquisa pelo WhatsApp quando o atendimento for concluído <span className="text-muted-foreground">(só uma pesquisa pode ficar automática)</span></span></label>
              {f.auto_apos_atendimento && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label>Número</Label>
                    <select className={sel} value={f.conexao_id ?? ""} onChange={(e) => setF({ ...f, conexao_id: e.target.value || null })}>
                      <option value="">Primeiro conectado</option>{(wa.data?.conexoes ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5"><Label>Não repetir para a mesma pessoa por (dias)</Label><Input type="number" min={1} max={365} value={f.intervalo_dias} onChange={(e) => setF({ ...f, intervalo_dias: Number(e.target.value) })} /></div>
                  <div className="space-y-1.5 sm:col-span-2"><Label>Mensagem ({"{nome}"} e {"{link}"})</Label>
                    <textarea className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" maxLength={600} value={f.mensagem_whatsapp} onChange={(e) => setF({ ...f, mensagem_whatsapp: e.target.value })} />
                  </div>
                </div>
              )}
            </fieldset>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || f.nome.trim().length < 2 || f.perguntas.some((p) => p.titulo.trim().length < 2)} data-testid="form-salvar">
            {salvar.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function corNps(n: number | null | undefined) {
  if (n == null) return "text-muted-foreground";
  return n >= 50 ? "text-emerald-600" : n >= 0 ? "text-amber-600" : "text-red-600";
}

function Resultados({ formulario, onVoltar }: { formulario: Formulario; onVoltar: () => void }) {
  const qc = useQueryClient();
  const { termos } = useSegmento();
  const [so, setSo] = useState<"todas" | "baixas">("todas");
  const q = useQuery({ queryKey: ["formularios", formulario.id, "resultado"], queryFn: () => apiGet<Resultado>(`/formularios/${formulario.id}/resultado`) });
  const tratar = useMutation({
    mutationFn: (id: string) => apiPost(`/formularios/respostas/${id}/tratar`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["formularios", formulario.id, "resultado"] }),
  });
  const r = q.data;
  const nps = r?.perguntas.find((p) => p.tipo === "nps")?.nps;
  const titulos = Object.fromEntries((r?.perguntas ?? []).map((p) => [p.id, p.titulo]));
  const respostas = (r?.respostas ?? []).filter((x) => so === "todas" || (x.baixa && !x.tratada));
  return (
    <div className="space-y-4" data-testid="form-resultado">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><button type="button" className="text-sm text-primary" onClick={onVoltar}>Voltar para pesquisas</button><h2 className="text-lg font-semibold">{formulario.nome}</h2></div>
        {formulario.link && <Button variant="outline" size="sm" onClick={() => copiar(formulario.link!)}><Copy className="mr-1.5 h-4 w-4" /> Copiar link</Button>}
      </div>
      {!r ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : r.total === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma resposta ainda. Mande o link numa campanha do WhatsApp ou ligue o envio depois do atendimento.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {nps && (
              <div className="rounded-xl border bg-card p-4 sm:col-span-1"><p className="text-xs text-muted-foreground">NPS</p><p className={cn("text-4xl font-bold", corNps(nps.nps))} data-testid="form-nps">{nps.nps ?? "-"}</p><p className="text-xs text-muted-foreground">de -100 a 100</p></div>
            )}
            {nps && [["Promotores (9 e 10)", nps.promotores, "text-emerald-600"], ["Neutros (7 e 8)", nps.neutros, "text-amber-600"], ["Detratores (0 a 6)", nps.detratores, "text-red-600"]].map(([t, v, c]) => (
              <div key={t as string} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{t}</p><p className={cn("text-2xl font-semibold", c as string)}>{v as number}</p>
                <p className="text-xs text-muted-foreground">{nps.total ? Math.round(((v as number) * 100) / nps.total) : 0}% de {nps.total}</p></div>
            ))}
            {!nps && <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Respostas</p><p className="text-3xl font-bold">{r.total}</p></div>}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {r.perguntas.map((p) => (
              <div key={p.id} className="space-y-2 rounded-xl border bg-card p-4">
                <p className="text-sm font-medium">{p.titulo}</p>
                <p className="text-xs text-muted-foreground">{p.respondidas} resposta(s){p.media != null && ` · média ${p.media.toFixed(1).replace(".", ",")} de 5`}</p>
                {p.distribuicao && (
                  <div className="flex h-24 items-end gap-1">
                    {p.distribuicao.map((v, i) => {
                      const max = Math.max(1, ...p.distribuicao!);
                      const n = p.tipo === "nps" ? i : i + 1;
                      const cor = p.tipo === "nps" ? (n >= 9 ? "bg-emerald-500" : n >= 7 ? "bg-amber-400" : "bg-red-500") : "bg-primary";
                      return <div key={i} className="flex flex-1 flex-col items-center gap-0.5"><span className="text-[10px] text-muted-foreground">{v || ""}</span><div className={cn("w-full rounded-t", cor)} style={{ height: `${(v / max) * 64}px` }} /><span className="text-[10px]">{n}</span></div>;
                    })}
                  </div>
                )}
                {p.contagem && p.contagem.map((c) => {
                  const pct = p.respondidas ? Math.round((c.qtd * 100) / p.respondidas) : 0;
                  return <div key={c.opcao} className="text-sm"><div className="flex justify-between"><span>{c.opcao}</span><span className="text-muted-foreground">{c.qtd} ({pct}%)</span></div><div className="h-1.5 rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: `${pct}%` }} /></div></div>;
                })}
                {p.textos && <ul className="max-h-48 space-y-1.5 overflow-y-auto text-sm">{p.textos.map((t, i) => <li key={i} className="rounded bg-muted/50 p-2">"{t.texto}"<span className="block text-xs text-muted-foreground">{t.nome ?? "Anônimo"}</span></li>)}</ul>}
              </div>
            ))}
          </div>

          {r.profissionais.length > 0 && (
            <div className="rounded-xl border bg-card p-4">
              <p className="mb-2 text-sm font-medium">Por {termos.profissional.toLowerCase()}</p>
              <ul className="divide-y text-sm">{r.profissionais.map((p) => <li key={p.nome} className="flex justify-between py-1.5"><span>{p.nome}</span><span className={corNps(p.nps)}>{p.nps != null ? `NPS ${p.nps}` : `média ${p.media}`} · {p.total} resp.</span></li>)}</ul>
            </div>
          )}

          <div className="rounded-xl border bg-card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Respostas</p>
              <div className="inline-flex rounded-lg border p-0.5 text-xs">
                {(["todas", "baixas"] as const).map((v) => <button key={v} type="button" onClick={() => setSo(v)} className={cn("rounded-md px-2.5 py-1", so === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{v === "todas" ? "Todas" : "Nota baixa sem retorno"}</button>)}
              </div>
            </div>
            <ul className="divide-y text-sm">
              {respostas.map((x) => (
                <li key={x.id} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{x.nome ?? "Anônimo"} {x.nota != null && <span className={cn("ml-1 rounded px-1.5 text-xs", x.baixa ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-muted")}>nota {x.nota}</span>}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{new Date(x.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{x.profissional_nome ? ` · ${x.profissional_nome}` : ""}</span></span>
                    {x.baixa && (x.tratada ? <span className="text-xs text-emerald-700">Retorno feito</span> : <Button size="sm" variant="outline" onClick={() => tratar.mutate(x.id)}>Marcar retorno feito</Button>)}
                  </div>
                  {Object.entries(x.respostas).filter(([, v]) => typeof v === "string" || Array.isArray(v)).map(([k, v]) => <p key={k} className="text-xs text-muted-foreground">{(titulos[k] ?? "").replace(/[?:.]$/, "")}: {Array.isArray(v) ? v.join(", ") : String(v)}</p>)}
                </li>
              ))}
              {respostas.length === 0 && <li className="py-3 text-sm text-muted-foreground">Nada aqui.</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
