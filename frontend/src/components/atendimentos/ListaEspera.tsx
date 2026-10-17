import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, Loader2, MessageCircle, Plus, Shuffle, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, detalheErro } from "@/lib/api";
import { useProfissionais, useServicos } from "@/lib/atendimentos";
import { useSegmento } from "@/lib/segmento";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Combo from "@/components/shared/Combo";
import { cn } from "@/lib/utils";

interface Espera {
  id: string; cliente_id: string; cliente_nome: string; cliente_telefone: string | null; servico_nome: string | null; profissional_nome: string | null;
  dias: number[]; periodos: string[]; prioridade: "normal" | "alta"; status: "aguardando" | "oferecido"; observacoes: string | null; criado_em: string; pontos?: number;
}
interface Vaga { id: string; data: string; inicio: string; fim: string; profissional_nome: string; servicos: string[]; cancelado: string; candidatos: Espera[]; oferta: { nome: string; expira_em: string } | null }
interface Opcao { tipo: "outro_profissional" | "outro_dia"; profissional_id: string; profissional_nome: string; data: string; inicio: string }
interface Remanejo { agendamento_id: string; cliente_nome: string; cliente_telefone: string | null; inicio: string; fim: string; servicos: string[]; opcoes: Opcao[] }

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const PER: Record<string, string> = { manha: "Manhã", tarde: "Tarde", noite: "Noite" };
const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const br = (d: string) => d.split("-").reverse().slice(0, 2).join("/");

function prefs(e: Espera) {
  const p = [e.servico_nome ?? "Qualquer serviço", e.profissional_nome ? `com ${e.profissional_nome}` : null,
    e.dias.length ? e.dias.map((d) => DIAS[d]).join(", ") : null, e.periodos.length ? e.periodos.map((x) => PER[x]).join(", ") : null];
  return p.filter(Boolean).join(" · ");
}

/** Lista de espera, vagas abertas por cancelamento e remanejamento do dia de um profissional. */
export function ListaEspera({ aberto, onClose, dia }: { aberto: boolean; onClose: () => void; dia: string }) {
  const [aba, setAba] = useState<"vagas" | "lista" | "remanejar">("vagas");
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lista de espera e remanejamento</DialogTitle>
          <DialogDescription>Sugestões por regras (serviço, profissional, dia, período, prioridade e tempo de espera). Nada muda na agenda sem você ou o paciente confirmar.</DialogDescription>
        </DialogHeader>
        <div className="inline-flex w-fit rounded-lg border bg-card p-0.5 text-sm">
          {([["vagas", "Vagas abertas"], ["lista", "Lista de espera"], ["remanejar", "Remanejar um dia"]] as const).map(([k, t]) => (
            <button key={k} type="button" onClick={() => setAba(k)} className={cn("rounded-md px-3 py-1", aba === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")} data-testid={`espera-aba-${k}`}>{t}</button>
          ))}
        </div>
        {aba === "vagas" && <Vagas />}
        {aba === "lista" && <Lista />}
        {aba === "remanejar" && <Remanejar dia={dia} />}
      </DialogContent>
    </Dialog>
  );
}

function Vagas() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const q = useQuery({ queryKey: ["espera-vagas"], queryFn: () => apiGet<Vaga[]>("/espera/vagas") });
  const cfg = useQuery({ queryKey: ["espera-config"], queryFn: () => apiGet<{ auto: boolean; minutos: number }>("/espera/config") });
  const atualizar = () => { qc.invalidateQueries({ queryKey: ["espera-vagas"] }); qc.invalidateQueries({ queryKey: ["espera"] }); qc.invalidateQueries({ queryKey: ["agendamentos"] }); };
  const oferecer = useMutation({ mutationFn: (v: { e: string; vaga: string }) => apiPost(`/espera/${v.e}/oferecer`, { vaga_id: v.vaga }), onSuccess: () => { atualizar(); toast.success("Oferta enviada pelo WhatsApp."); }, onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível enviar.") });
  const agendar = useMutation({ mutationFn: (v: { e: string; vaga: string }) => apiPost(`/espera/${v.e}/agendar`, { vaga_id: v.vaga }), onSuccess: () => { atualizar(); toast.success("Agendado no horário vago."); }, onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível agendar.") });
  const salvarCfg = useMutation({ mutationFn: (v: { auto: boolean; minutos: number }) => apiPut("/espera/config", v), onSuccess: () => qc.invalidateQueries({ queryKey: ["espera-config"] }) });
  return (
    <div className="grid gap-3">
      {isAdmin && cfg.data && (
        <label className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
          <input type="checkbox" checked={cfg.data.auto} onChange={(e) => salvarCfg.mutate({ ...cfg.data!, auto: e.target.checked })} data-testid="espera-auto" />
          <span>Oferecer sozinho pelo WhatsApp quando alguém cancelar. Sem resposta em</span>
          <Input className="h-8 w-16" type="number" min={5} max={720} defaultValue={cfg.data.minutos} onBlur={(e) => salvarCfg.mutate({ ...cfg.data!, minutos: Number(e.target.value) || 30 })} />
          <span>min, passa para o próximo.</span>
        </label>
      )}
      {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (q.data ?? []).length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum horário vago por cancelamento nos próximos dias.</p>
      ) : (q.data ?? []).map((v) => (
        <div key={v.id} className="grid gap-2 rounded-lg border p-3" data-testid="espera-vaga">
          <p className="text-sm"><b>{br(v.data)} às {v.inicio}</b> com {v.profissional_nome} <span className="text-muted-foreground">· {v.servicos.join(", ")} · era de {v.cancelado}</span></p>
          {v.oferta && <p className="text-xs text-primary">Oferecido para {v.oferta.nome}, esperando resposta até {new Date(v.oferta.expira_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>}
          {v.candidatos.length === 0 ? <p className="text-xs text-muted-foreground">Ninguém da lista de espera combina com este horário.</p> : (
            <ul className="grid gap-1.5">
              {v.candidatos.map((c, i) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0"><span className="font-medium">{i + 1}. {c.cliente_nome}</span>{c.prioridade === "alta" && <span className="ml-1 rounded bg-red-100 px-1 text-[11px] text-red-700 dark:bg-red-950 dark:text-red-300">prioridade</span>} <span className="text-xs text-muted-foreground">{prefs(c)}</span></span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="outline" disabled={!!v.oferta || oferecer.isPending} onClick={() => oferecer.mutate({ e: c.id, vaga: v.id })}><MessageCircle className="h-3.5 w-3.5" /> Oferecer</Button>
                    <Button size="sm" onClick={() => agendar.mutate({ e: c.id, vaga: v.id })} disabled={agendar.isPending} data-testid="espera-agendar"><CalendarClock className="h-3.5 w-3.5" /> Agendar</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function Lista() {
  const qc = useQueryClient();
  const seg = useSegmento();
  const servicos = useServicos();
  const profs = useProfissionais();
  const clientes = useQuery({ queryKey: ["pacientes-lista"], queryFn: () => apiGet<{ id: string; nome: string; telefone: string | null }[]>("/pacientes") });
  const q = useQuery({ queryKey: ["espera"], queryFn: () => apiGet<Espera[]>("/espera") });
  const vazio = { cliente_id: null as string | null, cliente_nome: "", cliente_telefone: "", servico_id: "", profissional_id: "", dias: [] as number[], periodos: [] as string[], prioridade: "normal", observacoes: "" };
  const [f, setF] = useState<typeof vazio | null>(null);
  const salvar = useMutation({
    mutationFn: () => apiPost("/espera", { ...f!, cliente_nome: f!.cliente_id ? null : f!.cliente_nome, cliente_telefone: f!.cliente_id ? null : f!.cliente_telefone || null,
      servico_id: f!.servico_id || null, profissional_id: f!.profissional_id || null, observacoes: f!.observacoes || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["espera"] }); qc.invalidateQueries({ queryKey: ["espera-vagas"] }); setF(null); toast.success("Na lista de espera."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível incluir."),
  });
  const remover = useMutation({ mutationFn: (id: string) => apiDelete(`/espera/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["espera"] }) });
  const alternar = <T,>(lista: T[], v: T) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);
  return (
    <div className="grid gap-3">
      {!f ? <Button size="sm" className="w-fit" onClick={() => setF({ ...vazio })} data-testid="espera-incluir"><Plus className="h-4 w-4" /> Incluir na lista</Button> : (
        <div className="grid gap-3 rounded-lg border p-3">
          <div className="grid gap-1.5"><Label>{seg.termos.cliente}</Label>
            <Combo opcoes={(clientes.data ?? []).map((c) => ({ valor: c.id, rotulo: c.nome, detalhe: c.telefone }))} valor={f.cliente_id}
              onChange={(v) => setF({ ...f, cliente_id: v })} onCriar={(t) => setF({ ...f, cliente_id: null, cliente_nome: t })} rotuloCriar="Cadastrar" placeholder="Buscar" testid="espera-cliente" />
            {!f.cliente_id && f.cliente_nome && <Input placeholder="Celular com DDD" value={f.cliente_telefone} onChange={(e) => setF({ ...f, cliente_telefone: e.target.value })} />}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1"><Label>Serviço</Label><select className={sel} value={f.servico_id} onChange={(e) => setF({ ...f, servico_id: e.target.value })}><option value="">Qualquer</option>{(servicos.data ?? []).filter((s) => s.ativo).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></div>
            <div className="grid gap-1"><Label>{seg.termos.profissional}</Label><select className={sel} value={f.profissional_id} onChange={(e) => setF({ ...f, profissional_id: e.target.value })}><option value="">Qualquer</option>{(profs.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>
            <div className="grid gap-1"><Label>Prioridade</Label><select className={sel} value={f.prioridade} onChange={(e) => setF({ ...f, prioridade: e.target.value })}><option value="normal">Normal</option><option value="alta">Alta</option></select></div>
          </div>
          <div className="flex flex-wrap gap-1.5">{DIAS.map((d, i) => <button key={d} type="button" onClick={() => setF({ ...f, dias: alternar(f.dias, i) })} className={cn("rounded-full border px-2.5 py-0.5 text-xs", f.dias.includes(i) ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>{d}</button>)}
            <span className="mx-1 text-muted-foreground">|</span>
            {Object.entries(PER).map(([k, t]) => <button key={k} type="button" onClick={() => setF({ ...f, periodos: alternar(f.periodos, k) })} className={cn("rounded-full border px-2.5 py-0.5 text-xs", f.periodos.includes(k) ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>{t}</button>)}
          </div>
          <p className="text-xs text-muted-foreground">Sem dia ou período marcado, qualquer horário serve.</p>
          <div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setF(null)}>Cancelar</Button><Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending || (!f.cliente_id && f.cliente_nome.trim().length < 2)} data-testid="espera-salvar">Incluir</Button></div>
        </div>
      )}
      <ul className="divide-y text-sm">
        {(q.data ?? []).map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 py-2" data-testid="espera-item">
            <span className="min-w-0"><span className="font-medium">{e.cliente_nome}</span>{e.prioridade === "alta" && <span className="ml-1 rounded bg-red-100 px-1 text-[11px] text-red-700 dark:bg-red-950 dark:text-red-300">prioridade</span>}{e.status === "oferecido" && <span className="ml-1 text-xs text-primary">oferta enviada</span>}
              <span className="block text-xs text-muted-foreground">{prefs(e)} · desde {br(e.criado_em.slice(0, 10))}</span></span>
            <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Tirar da lista" onClick={() => remover.mutate(e.id)}><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
        {(q.data ?? []).length === 0 && <li className="py-4 text-center text-muted-foreground">Ninguém na lista de espera.</li>}
      </ul>
    </div>
  );
}

function Remanejar({ dia }: { dia: string }) {
  const qc = useQueryClient();
  const seg = useSegmento();
  const profs = useProfissionais();
  const [f, setF] = useState({ profissional_id: "", data: dia });
  const [feitos, setFeitos] = useState<string[]>([]);
  const r = useMutation({ mutationFn: () => apiPost<{ atendimentos: Remanejo[] }>("/espera/remanejar", f), onError: (e) => toast.error(detalheErro(e) ?? "Erro") });
  const aplicar = useMutation({
    mutationFn: (v: { a: Remanejo; o: Opcao }) => apiPatch(`/atendimentos/${v.a.agendamento_id}`, { profissional_id: v.o.profissional_id, data: v.o.data, inicio: v.o.inicio }),
    onSuccess: (_, v) => { setFeitos((x) => [...x, v.a.agendamento_id]); qc.invalidateQueries({ queryKey: ["agendamentos"] }); toast.success(`${v.a.cliente_nome} remanejado. Avise pelo WhatsApp.`); },
    onError: (e) => toast.error(detalheErro(e) ?? "Esse horário não está mais livre."),
  });
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">{seg.termos.profissional} vai faltar? Veja para onde levar cada atendimento do dia: outro {seg.termos.profissional.toLowerCase()} no mesmo horário ou o mesmo em outro dia.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1"><Label>{seg.termos.profissional}</Label><select className={cn(sel, "w-52")} value={f.profissional_id} onChange={(e) => setF({ ...f, profissional_id: e.target.value })} data-testid="remanejar-prof"><option value="">Escolha</option>{(profs.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>
        <div className="grid gap-1"><Label>Dia</Label><Input type="date" className="w-40" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></div>
        <Button onClick={() => { setFeitos([]); r.mutate(); }} disabled={!f.profissional_id || r.isPending} data-testid="remanejar-ver"><Shuffle className="h-4 w-4" /> Ver sugestões</Button>
      </div>
      {r.data && (r.data.atendimentos.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum atendimento marcado nesse dia.</p> : r.data.atendimentos.map((a) => (
        <div key={a.agendamento_id} className={cn("grid gap-1.5 rounded-lg border p-3 text-sm", feitos.includes(a.agendamento_id) && "opacity-50")} data-testid="remanejar-item">
          <p><b>{a.inicio}</b> {a.cliente_nome} <span className="text-muted-foreground">· {a.servicos.join(", ")}</span></p>
          {a.opcoes.length === 0 ? <p className="text-xs text-muted-foreground">Sem horário livre nos próximos 14 dias. Fale com o paciente.</p> : (
            <div className="flex flex-wrap gap-1.5">{a.opcoes.map((o, i) => (
              <Button key={i} size="sm" variant="outline" disabled={feitos.includes(a.agendamento_id) || aplicar.isPending} onClick={() => aplicar.mutate({ a, o })}>
                {o.tipo === "outro_profissional" ? `${o.profissional_nome}, mesmo horário` : `${br(o.data)} às ${o.inicio}`}
              </Button>
            ))}</div>
          )}
        </div>
      )))}
    </div>
  );
}
