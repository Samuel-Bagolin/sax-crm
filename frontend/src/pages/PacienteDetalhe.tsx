import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Check, FileText, Lock, MessageCircle, Printer, X } from "lucide-react";
import { apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { ANAMNESE, STATUS_TRAT, type Evolucao, type FichaPaciente, type ItemTratamento, type Tratamento } from "@/lib/pacientes";
import { STATUS_AG } from "@/lib/atendimentos";
import { useSegmento } from "@/lib/segmento";
import { useAuth } from "@/lib/useAuth";
import { useConfig } from "@/lib/useConfig";
import { usePlano } from "@/lib/diferenciais";
import PainelOdonto from "@/components/odonto/PainelOdonto";
import PainelFacial from "@/components/estetica/PainelFacial";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

function dataBR(iso: string | null | undefined) {
  return iso ? iso.slice(0, 10).split("-").reverse().join("/") : "-";
}
function idade(nasc: string | null) {
  if (!nasc) return null;
  const d = new Date(nasc);
  const hoje = new Date();
  let a = hoje.getFullYear() - d.getFullYear();
  if (hoje < new Date(hoje.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}

export default function PacienteDetalhe() {
  const { id = "" } = useParams();
  const seg = useSegmento();
  const { isAdmin } = useAuth();
  const { tem } = usePlano();
  const q = useQuery({ queryKey: ["ficha", id], queryFn: () => apiGet<FichaPaciente>(`/pacientes/${id}`) });
  const [rascunho, setRascunho] = useState<ItemTratamento[]>([]);
  const [criando, setCriando] = useState<"odonto" | "facial" | null>(null);
  const [aba, setAba] = useState("resumo");

  if (q.isLoading) return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  if (!q.data) return <p className="rounded-xl border p-6">Cadastro não encontrado.</p>;
  const f = q.data;
  const p = f.paciente;
  const anos = idade(p.data_nascimento);
  const tel = (p.telefone ?? "").replace(/\D/g, "");
  const odonto = seg.chave === "odontologia" && tem("odontograma");
  const facial = seg.chave === "estetica" && tem("mapa_facial");
  const comOrcamento = seg.chave === "odontologia" || seg.chave === "estetica";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
        <Link to="/pacientes" className="text-muted-foreground hover:text-foreground" aria-label="Voltar"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold">{p.nome}</h2>
          <p className="text-sm text-muted-foreground">{[anos != null ? `${anos} anos` : null, p.telefone, p.email].filter(Boolean).join(", ") || "Sem contato"}</p>
          {f.alertas.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-red-600 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" /> {f.alertas.join(", ")}
            </p>
          )}
        </div>
        {tel && <a href={`https://wa.me/${tel.length <= 11 ? "55" + tel : tel}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted"><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
      </div>

      {f.dados_clinicos === false && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          Dados clínicos ocultos. Eles aparecem para o profissional que atende este paciente e para o gestor.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi rotulo={seg.termos.atendimentos} valor={String(f.resumo.atendimentos)} detalhe={f.resumo.faltas ? `${f.resumo.faltas} falta(s)` : undefined} />
        <Kpi rotulo="Já investiu" valor={brl(f.resumo.gasto_total)} />
        <Kpi rotulo="Último" valor={dataBR(f.resumo.ultimo)} detalhe={f.resumo.primeiro ? `desde ${dataBR(f.resumo.primeiro)}` : undefined} />
        <Kpi rotulo="Próximo" valor={f.proximo ? `${dataBR(f.proximo.data)} ${f.proximo.inicio}` : "Sem horário"} detalhe={f.proximo?.profissional_nome} />
      </div>

      <Tabs value={aba} onValueChange={(v) => setAba(String(v))}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="resumo">Histórico</TabsTrigger>
          {odonto && <TabsTrigger value="odonto" data-testid="aba-odonto">Odontograma 3D</TabsTrigger>}
          {facial && <TabsTrigger value="facial" data-testid="aba-facial">Mapa facial 3D</TabsTrigger>}
          {comOrcamento && <TabsTrigger value="orcamentos">Orçamentos ({f.tratamentos.length})</TabsTrigger>}
          <TabsTrigger value="anamnese">{seg.chave === "barbearia" ? "Preferências" : "Anamnese"}</TabsTrigger>
          {seg.prontuario && <TabsTrigger value="prontuario" data-testid="aba-prontuario">Prontuário</TabsTrigger>}
          <TabsTrigger value="dados">Cadastro</TabsTrigger>
          {isAdmin && f.financeiro && <TabsTrigger value="financeiro">Financeiro</TabsTrigger>}
        </TabsList>

        <TabsContent value="resumo" className="mt-4">
          {!f.agendamentos.length ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nada registrado ainda.</p> : (
            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              {f.agendamentos.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-24 shrink-0 font-medium">{dataBR(a.data)} {a.inicio}</span>
                  <span className="min-w-0 flex-1 truncate">{a.servicos.map((s) => s.nome).join(", ")} <span className="text-muted-foreground">com {a.profissional_nome}</span></span>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", STATUS_AG[a.status as keyof typeof STATUS_AG]?.classe)}>{STATUS_AG[a.status as keyof typeof STATUS_AG]?.rotulo ?? a.status}</span>
                  <span className="num hidden w-20 text-right sm:block">{brl(a.valor_cobrado ?? a.valor)}</span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {odonto && (
          <TabsContent value="odonto" className="mt-4">
            <PainelOdonto pacienteId={id} odontograma={f.odontograma} rascunho={rascunho} setRascunho={setRascunho} onSalvarOrcamento={() => setCriando("odonto")} />
          </TabsContent>
        )}
        {facial && (
          <TabsContent value="facial" className="mt-4">
            <PainelFacial rascunho={rascunho} setRascunho={setRascunho} onSalvarOrcamento={() => setCriando("facial")} />
          </TabsContent>
        )}
        {comOrcamento && (
          <TabsContent value="orcamentos" className="mt-4">
            <Tratamentos pacienteId={id} nome={p.nome} lista={f.tratamentos} />
          </TabsContent>
        )}
        <TabsContent value="anamnese" className="mt-4">
          <Anamnese pacienteId={id} respostas={f.anamnese} alertas={f.alertas} pode={f.pode_prontuario} />
        </TabsContent>
        {seg.prontuario && (
          <TabsContent value="prontuario" className="mt-4">
            {f.pode_prontuario ? <Prontuario pacienteId={id} /> : (
              <p className="flex items-center gap-2 rounded-xl border p-6 text-sm text-muted-foreground"><Lock className="h-4 w-4" /> Prontuário restrito ao profissional que atende este {seg.termos.cliente.toLowerCase()} e ao gestor.</p>
            )}
          </TabsContent>
        )}
        <TabsContent value="dados" className="mt-4"><Cadastro ficha={f} /></TabsContent>
        {isAdmin && f.financeiro && (
          <TabsContent value="financeiro" className="mt-4">
            <div className="mb-3 grid grid-cols-2 gap-3 sm:w-fit">
              <Kpi rotulo="Recebido" valor={brl(f.financeiro.pago)} />
              <Kpi rotulo="A receber" valor={brl(f.financeiro.a_receber)} />
            </div>
            <ul className="divide-y overflow-hidden rounded-xl border bg-card text-sm">
              {f.financeiro.parcelas.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-24 shrink-0">{dataBR(t.vencimento)}</span>
                  <span className="min-w-0 flex-1 truncate">{t.descricao}</span>
                  <span className={cn("text-xs font-semibold", t.status === "pago" ? "text-emerald-600" : "text-amber-600")}>{t.status === "pago" ? "Pago" : "Pendente"}</span>
                  <span className="num w-24 text-right">{brl(t.valor)}</span>
                </li>
              ))}
            </ul>
          </TabsContent>
        )}
      </Tabs>

      <NovoOrcamento
        tipo={criando}
        pacienteId={id}
        itens={rascunho}
        onClose={() => setCriando(null)}
        onCriado={() => { setRascunho([]); setCriando(null); setAba("orcamentos"); }}
      />
    </div>
  );
}

function Kpi({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="num mt-1 truncate text-lg font-bold">{valor}</p>
      {detalhe && <p className="truncate text-[11px] text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

function NovoOrcamento({ tipo, pacienteId, itens, onClose, onCriado }: { tipo: "odonto" | "facial" | null; pacienteId: string; itens: ItemTratamento[]; onClose: () => void; onCriado: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ titulo: "", desconto: "", parcelas: "1", primeira_parcela: "", observacoes: "" });
  useEffect(() => {
    if (tipo) setF({ titulo: tipo === "odonto" ? "Plano de tratamento" : "Harmonização facial", desconto: "", parcelas: "1", primeira_parcela: "", observacoes: "" });
  }, [tipo]);
  const subtotal = itens.reduce((a, i) => a + i.quantidade * i.valor_unitario, 0);
  const desc = Number(f.desconto.replace(",", ".")) || 0;
  const criar = useMutation({
    mutationFn: () => apiPost(`/pacientes/${pacienteId}/tratamentos`, {
      tipo, titulo: f.titulo, itens, desconto: desc, parcelas: Number(f.parcelas) || 1,
      primeira_parcela: f.primeira_parcela || null, observacoes: f.observacoes || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ficha", pacienteId] }); toast.success("Orçamento criado"); onCriado(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível criar"),
  });
  return (
    <Dialog open={!!tipo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo orçamento</DialogTitle>
          <DialogDescription>{itens.length} item(ns), subtotal {brl(subtotal)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="o-tit">Título</Label><Input id="o-tit" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="o-desc">Desconto (R$)</Label><Input id="o-desc" inputMode="decimal" value={f.desconto} onChange={(e) => setF({ ...f, desconto: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="o-parc">Parcelas</Label><Input id="o-parc" inputMode="numeric" value={f.parcelas} onChange={(e) => setF({ ...f, parcelas: e.target.value.replace(/\D/g, "") })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="o-pri">1ª parcela</Label><Input id="o-pri" type="date" value={f.primeira_parcela} onChange={(e) => setF({ ...f, primeira_parcela: e.target.value })} /></div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="o-obs">Observações</Label><Textarea id="o-obs" rows={2} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} /></div>
          <p className="text-right text-lg font-bold">Total {brl(Math.max(0, subtotal - desc))}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => criar.mutate()} disabled={f.titulo.trim().length < 2 || criar.isPending} data-testid="orcamento-salvar">Criar orçamento</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function imprimir(t: Tratamento, paciente: string, empresa: string) {
  const w = window.open("", "_blank", "width=820,height=900");
  if (!w) return;
  const linhas = t.itens.map((i) => `<tr><td>${i.dente ? `Dente ${i.dente} ` : ""}${i.descricao}${i.faces?.length ? ` (${i.faces.join("")})` : ""}</td><td style="text-align:right">${i.quantidade} ${i.unidade}</td><td style="text-align:right">${brl(i.valor ?? i.quantidade * i.valor_unitario)}</td></tr>`).join("");
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${t.titulo}</title><style>
    body{font-family:system-ui,sans-serif;color:#1d1530;max-width:720px;margin:40px auto;padding:0 20px}h1{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:20px}td,th{border-bottom:1px solid #e5e2ec;padding:8px 4px;text-align:left}.tot{font-size:20px;font-weight:700;text-align:right;margin-top:16px}.mut{color:#6b5f86}</style></head><body>
    <p class="mut">${empresa}</p><h1>${t.titulo}</h1><p>${paciente}<br><span class="mut">Emitido em ${new Date().toLocaleDateString("pt-BR")}, válido por ${t.validade_dias} dias. Profissional: ${t.profissional_nome}</span></p>
    <table><thead><tr><th>Procedimento</th><th style="text-align:right">Qtde.</th><th style="text-align:right">Valor</th></tr></thead><tbody>${linhas}</tbody></table>
    ${t.desconto ? `<p style="text-align:right">Subtotal ${brl(t.subtotal)}<br>Desconto ${brl(t.desconto)}</p>` : ""}
    <p class="tot">Total ${brl(t.total)}${t.parcelas > 1 ? ` em ${t.parcelas}x de ${brl(t.total / t.parcelas)}` : ""}</p>
    ${t.observacoes ? `<p class="mut">${t.observacoes}</p>` : ""}
    <p style="margin-top:60px">______________________________<br>${paciente}</p><script>window.print()</script></body></html>`);
  w.document.close();
}

function Tratamentos({ pacienteId, nome, lista }: { pacienteId: string; nome: string; lista: Tratamento[] }) {
  const qc = useQueryClient();
  const { config } = useConfig();
  const acao = useMutation({
    mutationFn: ({ t, acao, motivo }: { t: Tratamento; acao: string; motivo?: string }) => apiPost(`/pacientes/${pacienteId}/tratamentos/${t.id}/acao`, { acao, motivo }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["ficha", pacienteId] });
      toast.success(v.acao === "aprovar" ? "Aprovado. As parcelas foram lançadas no Financeiro." : v.acao === "apresentar" ? "Apresentado. O orçamento entrou no funil para acompanhamento." : "Marcado como recusado");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível"),
  });
  const realizar = useMutation({
    mutationFn: ({ t, item }: { t: Tratamento; item: string }) => apiPost(`/pacientes/${pacienteId}/tratamentos/${t.id}/itens/${item}/realizar`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ficha", pacienteId] }),
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível"),
  });
  if (!lista.length) return <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum orçamento. Monte pelo odontograma ou pelo mapa facial.</p>;
  return (
    <div className="grid gap-3">
      {lista.map((t) => (
        <article key={t.id} className="rounded-xl border bg-card p-4" data-testid={`tratamento-${t.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{t.titulo}</p>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TRAT[t.status].classe)}>{STATUS_TRAT[t.status].rotulo}</span>
            <span className="ml-auto text-lg font-bold">{brl(t.total)}</span>
          </div>
          <p className="text-xs text-muted-foreground">{dataBR(t.created_at)}, {t.profissional_nome}{t.parcelas > 1 ? `, ${t.parcelas}x` : ""}{t.motivo_recusa ? `, motivo: ${t.motivo_recusa}` : ""}</p>
          <ul className="mt-2 grid gap-1 text-sm">
            {t.itens.map((i) => (
              <li key={i.id} className="flex items-center gap-2">
                {i.status === "realizado" ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : <span className="h-4 w-4 shrink-0 rounded-full border" />}
                <span className={cn("min-w-0 flex-1 truncate", i.status === "realizado" && "text-muted-foreground line-through")}>{i.dente && <b>{i.dente} </b>}{i.descricao}{i.faces?.length ? ` (${i.faces.join("")})` : ""}{i.unidade !== "un" ? `, ${i.quantidade} ${i.unidade}` : ""}</span>
                <span className="num shrink-0">{brl(i.valor ?? 0)}</span>
                {t.status === "aprovado" && i.status !== "realizado" && <Button variant="ghost" size="sm" onClick={() => realizar.mutate({ t, item: i.id! })}>Realizado</Button>}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => imprimir(t, nome, config.nome_software)}><Printer className="h-4 w-4" /> Imprimir</Button>
            {t.status === "rascunho" && <Button size="sm" variant="outline" onClick={() => acao.mutate({ t, acao: "apresentar" })} data-testid="trat-apresentar"><FileText className="h-4 w-4" /> Apresentado ao paciente</Button>}
            {(t.status === "rascunho" || t.status === "apresentado") && (
              <>
                <Button size="sm" onClick={() => acao.mutate({ t, acao: "aprovar" })} data-testid="trat-aprovar"><Check className="h-4 w-4" /> Aprovar</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { const m = window.prompt("Motivo da recusa (opcional)") ?? undefined; acao.mutate({ t, acao: "recusar", motivo: m }); }}><X className="h-4 w-4" /> Recusado</Button>
              </>
            )}
            {t.negocio_id && <Link to={`/negocios/${t.negocio_id}`} className="ml-auto self-center text-sm text-primary hover:underline">Ver no funil</Link>}
          </div>
        </article>
      ))}
    </div>
  );
}

function Anamnese({ pacienteId, respostas, alertas, pode }: { pacienteId: string; respostas: Record<string, string | boolean | null>; alertas: string[]; pode: boolean }) {
  const seg = useSegmento();
  const qc = useQueryClient();
  const perguntas = ANAMNESE[seg.chave] ?? ANAMNESE.terapia;
  const [r, setR] = useState(respostas);
  const [al, setAl] = useState(alertas.join(", "));
  const salvar = useMutation({
    mutationFn: () => apiPut(`/pacientes/${pacienteId}/anamnese`, { respostas: r, alertas: al.split(",").map((x) => x.trim()).filter(Boolean) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ficha", pacienteId] }); toast.success("Salvo"); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  return (
    <div className="grid gap-4 rounded-xl border bg-card p-4 sm:p-5">
      {perguntas.map((q) => (
        <div key={q.chave} className="grid gap-1.5">
          <Label htmlFor={`an-${q.chave}`}>{q.pergunta}</Label>
          {q.tipo === "sim_nao" ? (
            <div className="flex gap-2" role="radiogroup" aria-label={q.pergunta}>
              {[["sim", true], ["não", false]].map(([t, v]) => (
                <button key={String(v)} type="button" disabled={!pode} onClick={() => setR({ ...r, [q.chave]: v as boolean })}
                  className={cn("rounded-full border px-4 py-1 text-sm capitalize", r[q.chave] === v && (v ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-950" : "border-primary bg-accent"))}>{t as string}</button>
              ))}
            </div>
          ) : (
            <Textarea id={`an-${q.chave}`} rows={2} disabled={!pode} value={String(r[q.chave] ?? "")} onChange={(e) => setR({ ...r, [q.chave]: e.target.value })} />
          )}
        </div>
      ))}
      <div className="grid gap-1.5">
        <Label htmlFor="an-alertas">Alertas que aparecem no topo da ficha (separe por vírgula)</Label>
        <Input id="an-alertas" disabled={!pode} value={al} onChange={(e) => setAl(e.target.value)} placeholder="Ex.: Alergia a dipirona, hipertenso" />
      </div>
      {pode ? <Button className="w-fit" onClick={() => salvar.mutate()} disabled={salvar.isPending}>Salvar</Button> : <p className="text-sm text-muted-foreground">Só o profissional que atende ou o gestor altera.</p>}
    </div>
  );
}

function Prontuario({ pacienteId }: { pacienteId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["prontuario", pacienteId], queryFn: () => apiGet<Evolucao[]>(`/pacientes/${pacienteId}/prontuario`) });
  const [texto, setTexto] = useState("");
  const [tipo, setTipo] = useState("evolucao");
  const [adendo, setAdendo] = useState<{ id: string; texto: string } | null>(null);
  const nova = useMutation({
    mutationFn: () => apiPost(`/pacientes/${pacienteId}/prontuario`, { texto, tipo }),
    onSuccess: () => { setTexto(""); qc.invalidateQueries({ queryKey: ["prontuario", pacienteId] }); toast.success("Registrado"); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível registrar"),
  });
  const add = useMutation({
    mutationFn: () => apiPost(`/pacientes/${pacienteId}/prontuario/${adendo!.id}/adendo`, { texto: adendo!.texto }),
    onSuccess: () => { setAdendo(null); qc.invalidateQueries({ queryKey: ["prontuario", pacienteId] }); },
  });
  const TIPOS: Record<string, string> = { evolucao: "Evolução", avaliacao: "Avaliação", anotacao: "Anotação", plano_terapeutico: "Plano terapêutico" };
  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(TIPOS).map(([k, v]) => <button key={k} type="button" onClick={() => setTipo(k)} className={cn("rounded-full border px-3 py-1 text-sm", tipo === k && "border-primary bg-primary text-primary-foreground")}>{v}</button>)}
        </div>
        <Textarea rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="O que foi feito, como o paciente respondeu, próximos passos." data-testid="prontuario-texto" />
        <div className="flex items-center gap-3">
          <Button onClick={() => nova.mutate()} disabled={texto.trim().length < 2 || nova.isPending} data-testid="prontuario-salvar">Registrar</Button>
          <p className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" /> Fica registrado quem escreveu e quem leu. Depois de 24 h, só adendo.</p>
        </div>
      </div>
      {(q.data ?? []).map((e) => (
        <article key={e.id} className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">{dataBR(e.data)}, {TIPOS[e.tipo]}, {e.autor_nome}</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{e.texto}</p>
          {e.adendos.map((a, k) => (
            <p key={k} className="mt-2 border-l-2 border-primary/40 pl-3 text-sm"><span className="text-xs text-muted-foreground">Adendo de {a.autor_nome}, {dataBR(a.em)}: </span>{a.texto}</p>
          ))}
          {adendo?.id === e.id ? (
            <div className="mt-2 grid gap-2">
              <Textarea rows={2} value={adendo.texto} onChange={(ev) => setAdendo({ id: e.id, texto: ev.target.value })} />
              <div className="flex gap-2"><Button size="sm" onClick={() => add.mutate()} disabled={adendo.texto.trim().length < 2}>Salvar adendo</Button><Button size="sm" variant="ghost" onClick={() => setAdendo(null)}>Cancelar</Button></div>
            </div>
          ) : <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAdendo({ id: e.id, texto: "" })}>Adendo</Button>}
        </article>
      ))}
    </div>
  );
}

function Cadastro({ ficha }: { ficha: FichaPaciente }) {
  const qc = useQueryClient();
  const p = ficha.paciente;
  const [f, setF] = useState({ nome: p.nome ?? "", telefone: p.telefone ?? "", email: p.email ?? "", cpf_cnpj: p.cpf_cnpj ?? "", data_nascimento: p.data_nascimento ?? "",
    profissao: p.profissao ?? "", cep: p.cep ?? "", logradouro: p.logradouro ?? "", numero: p.numero ?? "", bairro: p.bairro ?? "", cidade: p.cidade ?? "", estado: p.estado ?? "", observacoes: p.observacoes ?? "" });
  const salvar = useMutation({
    mutationFn: () => apiPut(`/pacientes/${p.id}`, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || (k === "nome" ? v : null)]))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ficha", p.id] }); toast.success("Cadastro salvo"); },
    onError: (e) => toast.error(detalheErro(e) ?? "Confira os dados"),
  });
  const campo = (k: keyof typeof f, rotulo: string, extra?: object) => (
    <div className="grid gap-1.5"><Label htmlFor={`c-${k}`}>{rotulo}</Label><Input id={`c-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></div>
  );
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
      {campo("nome", "Nome completo")}
      {campo("telefone", "WhatsApp", { inputMode: "tel" })}
      {campo("email", "E-mail", { type: "email" })}
      {campo("cpf_cnpj", "CPF")}
      {campo("data_nascimento", "Nascimento", { type: "date" })}
      {campo("profissao", "Profissão")}
      {campo("cep", "CEP")}
      {campo("logradouro", "Endereço")}
      {campo("numero", "Número")}
      {campo("bairro", "Bairro")}
      {campo("cidade", "Cidade")}
      {campo("estado", "UF", { maxLength: 2 })}
      <div className="grid gap-1.5 sm:col-span-2 lg:col-span-3"><Label htmlFor="c-obs">Observações</Label><Textarea id="c-obs" rows={2} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} /></div>
      <Button className="w-fit" onClick={() => salvar.mutate()} disabled={f.nome.trim().length < 2 || salvar.isPending}>Salvar cadastro</Button>
    </div>
  );
}
