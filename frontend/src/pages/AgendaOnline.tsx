import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { DIAS_SEMANA, useProfissionais, useServicos, type AgendaConfig, type Profissional, type Servico } from "@/lib/atendimentos";
import { useSegmento } from "@/lib/segmento";
import { useAuth } from "@/lib/useAuth";
import { usePlano } from "@/lib/diferenciais";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Jornada = Record<string, [string, string][]>;

export default function AgendaOnline({ abaInicial = "servicos" }: { abaInicial?: string } = {}) {
  const seg = useSegmento();
  const [aba, setAba] = useState(abaInicial);
  return (
    <Tabs value={aba} onValueChange={(v) => setAba(String(v))}>
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="servicos">{seg.termos.itens}</TabsTrigger>
        <TabsTrigger value="equipe">{seg.termos.profissionais} e horários</TabsTrigger>
        <TabsTrigger value="link">Regras do link</TabsTrigger>
      </TabsList>
      <TabsContent value="servicos" className="mt-4"><Servicos /></TabsContent>
      <TabsContent value="equipe" className="mt-4"><Equipe /></TabsContent>
      <TabsContent value="link" className="mt-4"><LinkAgenda /></TabsContent>
    </Tabs>
  );
}

// ------------------------------------------------------------------ serviços

function Servicos() {
  const seg = useSegmento();
  const { isAdmin } = useAuth();
  const q = useServicos();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Servico | "novo" | null>(null);
  const excluir = useMutation({
    mutationFn: (id: string) => apiDelete(`/atendimentos/servicos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servicos"] }),
  });
  const lista = q.data ?? [];
  const exemplo = lista.some((s) => s.valor_exemplo);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">{lista.length} {seg.termos.itens.toLowerCase()}. O preço entra sozinho na agenda e no caixa.</p>
        {isAdmin && <Button className="ml-auto" onClick={() => setEdit("novo")}><Plus className="h-4 w-4" /> Novo {seg.termos.item.toLowerCase()}</Button>}
      </div>
      {exemplo && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Os valores que vieram prontos são exemplos. Ajuste para a sua tabela de preços.</p>}
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {lista.map((s) => (
          <li key={s.id} className={cn("flex items-center gap-3 px-4 py-3", !s.ativo && "opacity-50")}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.nome} {!s.online && <span className="ml-1 rounded bg-muted px-1.5 text-[11px] text-muted-foreground">só no balcão</span>}</p>
              <p className="text-xs text-muted-foreground">{[s.categoria, `${s.duracao_min} min`, s.retorno_dias ? `retorno em ${s.retorno_dias} dias` : null].filter(Boolean).join(", ")}</p>
            </div>
            <p className="num shrink-0 font-semibold">{brl(s.preco)}{s.unidade ? <span className="text-xs font-normal text-muted-foreground"> por {s.unidade}</span> : null}</p>
            {isAdmin && (
              <div className="flex shrink-0">
                <Button variant="ghost" size="icon-sm" onClick={() => setEdit(s)} aria-label={`Editar ${s.nome}`}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon-sm" onClick={() => excluir.mutate(s.id)} aria-label={`Excluir ${s.nome}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ServicoDialog servico={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function ServicoDialog({ servico, onClose }: { servico: Servico | "novo" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const seg = useSegmento();
  const profs = useProfissionais();
  const vazio = { nome: "", duracao_min: "30", preco: "", categoria: "", descricao: "", online: true, ativo: true, profissionais: [] as string[], retorno_dias: "", unidade: "" };
  const [f, setF] = useState(vazio);
  useEffect(() => {
    if (servico === "novo") setF(vazio);
    else if (servico) setF({ nome: servico.nome, duracao_min: String(servico.duracao_min), preco: String(servico.preco), categoria: servico.categoria ?? "", descricao: servico.descricao ?? "",
      online: servico.online, ativo: servico.ativo, profissionais: servico.profissionais, retorno_dias: servico.retorno_dias ? String(servico.retorno_dias) : "", unidade: servico.unidade ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servico]);
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { ...f, duracao_min: Number(f.duracao_min), preco: Number(f.preco.replace(",", ".")) || 0, categoria: f.categoria || null, descricao: f.descricao || null,
        retorno_dias: f.retorno_dias ? Number(f.retorno_dias) : null, unidade: f.unidade || null };
      return servico === "novo" ? apiPost("/atendimentos/servicos", corpo) : apiPut(`/atendimentos/servicos/${(servico as Servico).id}`, corpo);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["servicos"] }); toast.success("Salvo"); onClose(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Confira os campos"),
  });
  return (
    <Dialog open={!!servico} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{servico === "novo" ? `Novo ${seg.termos.item.toLowerCase()}` : `Editar ${seg.termos.item.toLowerCase()}`}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="s-nome">Nome</Label><Input id="s-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="s-dur">Duração (min)</Label><Input id="s-dur" inputMode="numeric" value={f.duracao_min} onChange={(e) => setF({ ...f, duracao_min: e.target.value.replace(/\D/g, "") })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="s-preco">Preço (R$)</Label><Input id="s-preco" inputMode="decimal" value={f.preco} onChange={(e) => setF({ ...f, preco: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="s-cat">Categoria</Label><Input id="s-cat" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="s-ret">Lembrar retorno em (dias)</Label><Input id="s-ret" inputMode="numeric" value={f.retorno_dias} onChange={(e) => setF({ ...f, retorno_dias: e.target.value.replace(/\D/g, "") })} placeholder="Ex.: 30" /></div>
          {(seg.chave === "estetica" || seg.chave === "odontologia") && (
            <div className="grid gap-1.5"><Label htmlFor="s-un">Preço por unidade aplicada</Label>
              <select id="s-un" className="h-9 rounded-lg border bg-transparent px-2 text-sm" value={f.unidade} onChange={(e) => setF({ ...f, unidade: e.target.value })}>
                <option value="">Não, preço por atendimento</option><option value="U">Por unidade (U)</option><option value="ml">Por ml</option><option value="frasco">Por frasco</option><option value="seringa">Por seringa</option>
              </select>
            </div>
          )}
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="s-desc">Descrição para o cliente</Label><Textarea id="s-desc" rows={2} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Quem faz</Label>
            <div className="flex flex-wrap gap-1.5">
              {(profs.data ?? []).map((p) => {
                const on = f.profissionais.includes(p.id);
                return <button key={p.id} type="button" onClick={() => setF({ ...f, profissionais: on ? f.profissionais.filter((x) => x !== p.id) : [...f.profissionais, p.id] })}
                  className={cn("rounded-full border px-3 py-1 text-sm", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{p.nome}</button>;
              })}
            </div>
            <p className="text-xs text-muted-foreground">Sem ninguém marcado, todos que atendem fazem este {seg.termos.item.toLowerCase()}.</p>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.online} onChange={(e) => setF({ ...f, online: e.target.checked })} className="accent-[var(--primary)]" /> Aparece no link online</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} className="accent-[var(--primary)]" /> Ativo</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={f.nome.trim().length < 2 || !Number(f.duracao_min) || salvar.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ equipe e horários

function Equipe() {
  const seg = useSegmento();
  const { isAdmin, principal } = useAuth();
  const profs = useProfissionais(true);
  const [edit, setEdit] = useState<Profissional | null>(null);
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">Marque quem atende e o horário de cada um. Para incluir alguém, cadastre em Equipe.</p>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {(profs.data ?? []).map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{p.nome} {!p.atende && <span className="ml-1 rounded bg-muted px-1.5 text-[11px] text-muted-foreground">não atende</span>}</p>
              <p className="text-xs text-muted-foreground">
                {p.atende ? (p.jornada ? resumoJornada(p.jornada) : "Horário padrão da empresa") : "Fora da agenda"}
                {p.comissao_pct ? `, comissão ${p.comissao_pct}%` : ""}
              </p>
            </div>
            {(isAdmin || p.id === principal?.usuario_id) && <Button variant="outline" size="sm" onClick={() => setEdit(p)}>Ajustar</Button>}
          </li>
        ))}
      </ul>
      <ProfissionalDialog prof={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function resumoJornada(j: Jornada) {
  const dias = Object.entries(j).filter(([, f]) => f.length).map(([d]) => DIAS_SEMANA[Number(d)].slice(0, 3));
  return dias.length ? `Atende ${dias.join(", ")}` : "Sem dias de atendimento";
}

const JORNADA_BASE: Jornada = { "0": [], "1": [["09:00", "18:00"]], "2": [["09:00", "18:00"]], "3": [["09:00", "18:00"]], "4": [["09:00", "18:00"]], "5": [["09:00", "18:00"]], "6": [["09:00", "13:00"]] };

function EditorJornada({ valor, onChange }: { valor: Jornada; onChange: (j: Jornada) => void }) {
  return (
    <div className="grid gap-2">
      {DIAS_SEMANA.map((nome, i) => {
        const faixas = valor[String(i)] ?? [];
        const set = (f: [string, string][]) => onChange({ ...valor, [String(i)]: f });
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
            <label className="flex w-28 items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={faixas.length > 0} onChange={(e) => set(e.target.checked ? [["09:00", "18:00"]] : [])} className="accent-[var(--primary)]" />
              {nome}
            </label>
            {faixas.map(([a, b], k) => (
              <span key={k} className="flex items-center gap-1">
                <Input type="time" className="h-8 w-[104px]" value={a} onChange={(e) => set(faixas.map((x, n) => (n === k ? [e.target.value, x[1]] : x)))} aria-label={`${nome} início`} />
                <span className="text-xs text-muted-foreground">às</span>
                <Input type="time" className="h-8 w-[104px]" value={b} onChange={(e) => set(faixas.map((x, n) => (n === k ? [x[0], e.target.value] : x)))} aria-label={`${nome} fim`} />
                {faixas.length > 1 && <Button variant="ghost" size="icon-sm" onClick={() => set(faixas.filter((_, n) => n !== k))} aria-label="Remover faixa"><Trash2 className="h-3.5 w-3.5" /></Button>}
              </span>
            ))}
            {faixas.length > 0 && faixas.length < 3 && (
              <Button variant="ghost" size="sm" onClick={() => set([...faixas, ["14:00", "18:00"]])}>+ intervalo</Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ProfissionalDialog({ prof, onClose }: { prof: Profissional | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [f, setF] = useState({ atende: true, jornada: JORNADA_BASE, comissao_pct: "0", online: true, especialidade: "", registro: "" });
  useEffect(() => {
    if (prof) setF({ atende: prof.atende || !prof.jornada, jornada: prof.jornada ?? JORNADA_BASE, comissao_pct: String(prof.comissao_pct ?? 0), online: prof.online, especialidade: prof.especialidade ?? "", registro: prof.registro ?? "" });
  }, [prof]);
  const salvar = useMutation({
    mutationFn: () => apiPut(`/atendimentos/profissionais/${prof!.id}`, { ...f, comissao_pct: Number(f.comissao_pct) || 0, especialidade: f.especialidade || null, registro: f.registro || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["profissionais"] }); toast.success("Agenda atualizada"); onClose(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Confira os horários"),
  });
  return (
    <Dialog open={!!prof} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{prof?.nome}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={f.atende} onChange={(e) => setF({ ...f, atende: e.target.checked })} className="accent-[var(--primary)]" data-testid="prof-atende" /> Atende clientes (aparece na agenda)</label>
          {f.atende && (
            <>
              <EditorJornada valor={f.jornada} onChange={(j) => setF({ ...f, jornada: j })} />
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5"><Label htmlFor="p-esp">Especialidade</Label><Input id="p-esp" value={f.especialidade} onChange={(e) => setF({ ...f, especialidade: e.target.value })} /></div>
                <div className="grid gap-1.5"><Label htmlFor="p-reg">Registro (CRO, CRP)</Label><Input id="p-reg" value={f.registro} onChange={(e) => setF({ ...f, registro: e.target.value })} /></div>
                {isAdmin && <div className="grid gap-1.5"><Label htmlFor="p-com">Comissão (%)</Label><Input id="p-com" inputMode="decimal" value={f.comissao_pct} onChange={(e) => setF({ ...f, comissao_pct: e.target.value })} /></div>}
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.online} onChange={(e) => setF({ ...f, online: e.target.checked })} className="accent-[var(--primary)]" /> Recebe agendamento pelo link online</label>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending} data-testid="prof-salvar">Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ link

export function LinkAgenda() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const { tem } = usePlano();
  const seg = useSegmento();
  const cfg = useQuery({ queryKey: ["agenda-config"], queryFn: () => apiGet<AgendaConfig>("/atendimentos/config") });
  const profs = useProfissionais();
  const [f, setF] = useState<AgendaConfig | null>(null);
  useEffect(() => {
    if (cfg.data && !f) setF({ ...cfg.data, slug: cfg.data.slug ?? cfg.data.sugestao_slug ?? "" });
  }, [cfg.data, f]);
  const salvar = useMutation({
    mutationFn: () => apiPut<AgendaConfig>("/atendimentos/config", f),
    onSuccess: (r) => { qc.setQueryData(["agenda-config"], r); setF({ ...r, slug: r.slug ?? "" }); toast.success(r.ativo ? "Link no ar" : "Configuração salva"); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  if (!f) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  if (!tem("agenda_online")) return <p className="rounded-xl border p-6 text-sm">O link de agendamento online não faz parte do plano atual. Veja os planos em Assinatura.</p>;
  const publicado = cfg.data?.ativo && cfg.data.slug;
  const base = `${window.location.origin}/agendar/${cfg.data?.slug ?? f.slug}`;
  const copiar = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success("Link copiado"));
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <section className="grid gap-4 rounded-xl border bg-card p-5">
        <div className="grid gap-1.5">
          <Label htmlFor="l-slug">Endereço do link</Label>
          <div className="flex max-w-lg items-center overflow-hidden rounded-lg border">
            <span className="whitespace-nowrap bg-muted px-3 py-2 text-sm text-muted-foreground">{window.location.host}/agendar/</span>
            <input id="l-slug" value={f.slug ?? ""} disabled={!isAdmin} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Numero rotulo="Intervalo entre horários (min)" valor={f.intervalo_min} onChange={(v) => setF({ ...f, intervalo_min: v })} pode={isAdmin} />
          <Numero rotulo="Antecedência mínima (min)" valor={f.antecedencia_min} onChange={(v) => setF({ ...f, antecedencia_min: v })} pode={isAdmin} />
          <Numero rotulo="Agenda aberta para os próximos (dias)" valor={f.janela_dias} onChange={(v) => setF({ ...f, janela_dias: v })} pode={isAdmin} />
          <Numero rotulo="Cliente cancela pelo link até (horas antes)" valor={f.cancelamento_horas} onChange={(v) => setF({ ...f, cancelamento_horas: v })} pode={isAdmin} />
          <Numero rotulo={`Chamar de volta quem não vem há (dias)`} valor={f.dias_retorno} onChange={(v) => setF({ ...f, dias_retorno: v })} pode={isAdmin} />
        </div>
        <div className="grid gap-1.5"><Label htmlFor="l-msg">Recado no topo da página</Label><Textarea id="l-msg" rows={2} disabled={!isAdmin} value={f.mensagem} onChange={(e) => setF({ ...f, mensagem: e.target.value })} placeholder="Ex.: chegue 5 minutos antes. Atrasos acima de 15 min precisam remarcar." /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!isAdmin} checked={f.pedir_email} onChange={(e) => setF({ ...f, pedir_email: e.target.checked })} className="accent-[var(--primary)]" /> Pedir e-mail do cliente</label>
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" disabled={!isAdmin} checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} className="accent-[var(--primary)]" data-testid="link-ativo" /> Link no ar</label>
        {isAdmin && <Button className="w-fit" onClick={() => salvar.mutate()} disabled={salvar.isPending} data-testid="link-salvar">{salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</Button>}
      </section>
      <aside className="grid h-fit gap-3 rounded-xl border bg-card p-5">
        <p className="font-semibold">Links para divulgar</p>
        {!publicado ? <p className="text-sm text-muted-foreground">Salve com "Link no ar" marcado para gerar os links.</p> : (
          <>
            <LinhaLink rotulo="Agenda completa" url={base} copiar={copiar} />
            {(profs.data ?? []).filter((p) => p.slug && p.online).map((p) => (
              <LinhaLink key={p.id} rotulo={`Só ${p.nome.split(" ")[0]}`} url={`${base}/${p.slug}`} copiar={copiar} />
            ))}
            <p className="text-xs text-muted-foreground">Coloque o link na bio do Instagram e no WhatsApp Business. Cada {seg.termos.profissional.toLowerCase()} pode divulgar o próprio.</p>
          </>
        )}
      </aside>
    </div>
  );
}

function Numero({ rotulo, valor, onChange, pode }: { rotulo: string; valor: number; onChange: (v: number) => void; pode: boolean }) {
  return (
    <div className="grid gap-1.5">
      <Label>{rotulo}</Label>
      <Input inputMode="numeric" disabled={!pode} value={String(valor)} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)} />
    </div>
  );
}

function LinhaLink({ rotulo, url, copiar }: { rotulo: string; url: string; copiar: (t: string) => void }) {
  return (
    <div className="rounded-lg border p-2.5">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="truncate text-sm font-medium" title={url}>{url}</p>
      <div className="mt-1.5 flex gap-1.5">
        <Button variant="outline" size="sm" onClick={() => copiar(url)}><Copy className="h-3.5 w-3.5" /> Copiar</Button>
        <a href={url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}><ExternalLink className="h-3.5 w-3.5" /> Abrir</a>
      </div>
    </div>
  );
}
