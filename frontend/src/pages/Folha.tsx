import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, Lock, Settings2, Unlock } from "lucide-react";
import { apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { useSegmento } from "@/lib/segmento";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Modelo = "por_sessao" | "percentual" | "fixo_mais_sessao";
interface Regra { modelo: Modelo; valor_sessao: number; percentual: number; fixo_mensal: number; grupo_conta: "por_sessao" | "por_paciente" }
interface RegraLinha extends Partial<Omit<Regra, "modelo">> { usuario_id: string; nome: string; comissao_pct: number; modelo: Modelo | null }
interface Item { agendamento_id: string; data: string; inicio: string; servicos: string[]; grupo: boolean; pacientes: string[]; unidades: number; base: number; valor: number; fora_do_prazo: boolean }
interface Prof {
  usuario_id: string; nome: string; regra: Regra | null; itens?: Item[]; sessoes?: number; atendimentos?: number; aguardando_evolucao?: number; faltas?: number;
  variavel?: number; fixo?: number; total?: number; fechada: { em: string | null; por: string | null; transacao_id: string | null; paga: boolean } | null;
}

const MODELOS: Record<Modelo, string> = { por_sessao: "Valor por sessão", percentual: "% do valor da sessão", fixo_mais_sessao: "Fixo mensal + por sessão" };

function resumoRegra(r: Regra | null) {
  if (!r) return "Sem regra";
  if (r.modelo === "percentual") return `${r.percentual}% da sessão`;
  const s = `${brl(r.valor_sessao)} por ${r.grupo_conta === "por_paciente" ? "paciente" : "sessão"}`;
  return r.modelo === "fixo_mais_sessao" ? `${brl(r.fixo_mensal)} + ${s}` : s;
}

function mesAtual(delta = 0) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Folha por profissional: sessões com presença e evolução, regra de cada um e fechamento no Financeiro. */
export default function Folha() {
  const qc = useQueryClient();
  const seg = useSegmento();
  const { isAdmin } = useAuth();
  const [mes, setMes] = useState(mesAtual(new Date().getDate() <= 10 ? -1 : 0));
  const [aberto, setAberto] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [regras, setRegras] = useState(false);
  const q = useQuery({ queryKey: ["folha", mes], queryFn: () => apiGet<{ profissionais: Prof[]; total: number }>(`/folha?mes=${mes}`) });
  const fechar = useMutation({
    mutationFn: (ids: string[]) => apiPost<{ fechadas: { total: number }[]; puladas: { motivo: string }[] }>(`/folha/${mes}/fechar`, { usuario_ids: ids }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["folha"] }); setSel([]); toast.success(`${r.fechadas.length} folha(s) fechada(s) e lançada(s) em Contas a pagar.`); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível fechar."),
  });
  const reabrir = useMutation({
    mutationFn: (id: string) => apiPost(`/folha/${mes}/reabrir/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["folha"] }); toast.success("Folha reaberta. A conta a pagar foi retirada."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível reabrir."),
  });
  const lista = q.data?.profissionais ?? [];
  const fechaveis = lista.filter((p) => p.regra && !p.fechada).map((p) => p.usuario_id);
  return (
    <div className="space-y-4" data-testid="folha">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Entra na folha só a sessão com presença marcada e evolução no prontuário. Sessão sem evolução fica como "aguardando". Ao fechar, o valor vai para Contas a pagar (Salários e pró-labore) e o mês fica congelado.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1"><span className="text-xs text-muted-foreground">Mês</span><Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="w-44" data-testid="folha-mes" /></div>
        {isAdmin && <Button variant="outline" onClick={() => setRegras(true)} data-testid="folha-regras"><Settings2 className="h-4 w-4" /> Regras por {seg.termos.profissional.toLowerCase()}</Button>}
        {isAdmin && fechaveis.length > 0 && (
          <Button onClick={() => { const ids = sel.length ? sel : fechaveis; if (window.confirm(`Fechar ${ids.length} folha(s) de ${mes.split("-").reverse().join("/")}? O valor vai para Contas a pagar.`)) fechar.mutate(ids); }} disabled={fechar.isPending} data-testid="folha-fechar">
            <Lock className="h-4 w-4" /> {sel.length ? `Fechar ${sel.length} selecionada(s)` : "Fechar todas abertas"}
          </Button>
        )}
        {q.data && <p className="ml-auto text-sm">Total do mês: <b data-testid="folha-total">{brl(q.data.total)}</b></p>}
      </div>
      {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>{isAdmin && <th className="w-8 p-2 pl-3" />}<th className="p-2">{seg.termos.profissional}</th><th className="p-2">Regra</th><th className="p-2">Sessões</th><th className="p-2">Aguardando evolução</th><th className="p-2">Variável</th><th className="p-2">Fixo</th><th className="p-2">Total</th><th className="p-2">Situação</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <FolhaLinha key={p.usuario_id} p={p} isAdmin={isAdmin} aberto={aberto === p.usuario_id} onAbrir={() => setAberto(aberto === p.usuario_id ? null : p.usuario_id)}
                  selecionado={sel.includes(p.usuario_id)} onSel={(v) => setSel((s) => (v ? [...s, p.usuario_id] : s.filter((x) => x !== p.usuario_id)))}
                  onReabrir={() => { if (window.confirm("Reabrir a folha? A conta a pagar ainda não paga será retirada.")) reabrir.mutate(p.usuario_id); }} />
              ))}
              {lista.length === 0 && <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">Nenhum {seg.termos.profissional.toLowerCase()} com folha neste mês.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {regras && <Regras onFechar={() => setRegras(false)} />}
    </div>
  );
}

function FolhaLinha({ p, isAdmin, aberto, onAbrir, selecionado, onSel, onReabrir }: { p: Prof; isAdmin: boolean; aberto: boolean; onAbrir: () => void; selecionado: boolean; onSel: (v: boolean) => void; onReabrir: () => void }) {
  const situacao = !p.regra ? "Sem regra" : p.fechada ? (p.fechada.paga ? "Paga" : "Fechada") : "Aberta";
  return (
    <>
      <tr className="border-t" data-testid="folha-linha">
        {isAdmin && <td className="p-2 pl-3">{p.regra && !p.fechada && <input type="checkbox" checked={selecionado} onChange={(e) => onSel(e.target.checked)} aria-label={`Selecionar ${p.nome}`} />}</td>}
        <td className="p-2 font-medium"><button type="button" className="inline-flex items-center gap-1" onClick={onAbrir} disabled={!p.itens}>{p.itens && (aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}{p.nome}</button></td>
        <td className="p-2 text-muted-foreground">{resumoRegra(p.regra)}</td>
        <td className="p-2">{p.sessoes ?? "-"}</td>
        <td className={cn("p-2", (p.aguardando_evolucao ?? 0) > 0 && "font-medium text-amber-700 dark:text-amber-400")}>{p.aguardando_evolucao ?? "-"}</td>
        <td className="p-2">{p.variavel != null ? brl(p.variavel) : "-"}</td>
        <td className="p-2">{p.fixo != null ? brl(p.fixo) : "-"}</td>
        <td className="p-2 font-semibold">{p.total != null ? brl(p.total) : "-"}</td>
        <td className="p-2"><span className={cn("rounded-full px-2 py-0.5 text-xs", situacao === "Paga" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : situacao === "Fechada" ? "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300" : "bg-muted text-muted-foreground")}>{situacao}</span></td>
        <td className="p-2 text-right">{isAdmin && p.fechada && !p.fechada.paga && <Button size="sm" variant="ghost" onClick={onReabrir}><Unlock className="h-4 w-4" /> Reabrir</Button>}</td>
      </tr>
      {aberto && p.itens && (
        <tr className="bg-muted/30"><td colSpan={10} className="p-3">
          {p.itens.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma sessão válida no mês.</p> : (
            <ul className="grid gap-1 text-xs">
              {p.itens.map((i) => (
                <li key={i.agendamento_id} className="flex flex-wrap justify-between gap-2">
                  <span>{i.data.split("-").reverse().slice(0, 2).join("/")} {i.inicio} · {i.servicos.join(", ")} · {i.pacientes.join(", ")}{i.unidades > 1 ? ` (${i.unidades}x)` : ""}{i.fora_do_prazo && <span className="ml-1 text-amber-700 dark:text-amber-400">evolução fora do prazo</span>}</span>
                  <span className="font-medium">{brl(i.valor)}</span>
                </li>
              ))}
            </ul>
          )}
        </td></tr>
      )}
    </>
  );
}

function Regras({ onFechar }: { onFechar: () => void }) {
  const qc = useQueryClient();
  const seg = useSegmento();
  const q = useQuery({ queryKey: ["folha-regras"], queryFn: () => apiGet<RegraLinha[]>("/folha/regras") });
  const [edit, setEdit] = useState<Record<string, RegraLinha>>({});
  const salvar = useMutation({
    mutationFn: (r: RegraLinha) => apiPut<RegraLinha>(`/folha/regras/${r.usuario_id}`, { modelo: r.modelo, valor_sessao: Number(r.valor_sessao) || 0, percentual: Number(r.percentual) || 0, fixo_mensal: Number(r.fixo_mensal) || 0, grupo_conta: r.grupo_conta ?? "por_sessao" }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["folha-regras"] }); qc.invalidateQueries({ queryKey: ["folha"] }); setEdit((e) => { const n = { ...e }; delete n[r.usuario_id]; return n; }); toast.success(`Regra de ${r.nome} salva.`); },
    onError: (e) => toast.error(detalheErro(e) ?? "Confira os valores."),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Regras da folha</DialogTitle><DialogDescription>Uma regra por {seg.termos.profissional.toLowerCase()}. Mudança vale para os meses ainda abertos.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          {(q.data ?? []).map((orig) => {
            const r = edit[orig.usuario_id] ?? orig;
            const set = (m: Partial<RegraLinha>) => setEdit((e) => ({ ...e, [orig.usuario_id]: { ...r, ...m } }));
            return (
              <div key={orig.usuario_id} className="grid gap-2 rounded-lg border p-3" data-testid="folha-regra">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{orig.nome}</p>
                  <select className="h-9 rounded-md border bg-background px-2 text-sm" value={r.modelo ?? ""} onChange={(e) => set({ modelo: (e.target.value || null) as Modelo | null })}>
                    <option value="">Sem folha</option>{(Object.keys(MODELOS) as Modelo[]).map((m) => <option key={m} value={m}>{MODELOS[m]}</option>)}
                  </select>
                </div>
                {r.modelo && (
                  <div className="grid gap-2 sm:grid-cols-4">
                    {r.modelo === "fixo_mais_sessao" && <div className="grid gap-1"><Label>Fixo mensal (R$)</Label><Input inputMode="decimal" value={String(r.fixo_mensal ?? 0)} onChange={(e) => set({ fixo_mensal: Number(e.target.value.replace(",", ".")) || 0 })} /></div>}
                    {r.modelo !== "percentual" ? <div className="grid gap-1"><Label>Por sessão (R$)</Label><Input inputMode="decimal" value={String(r.valor_sessao ?? 0)} onChange={(e) => set({ valor_sessao: Number(e.target.value.replace(",", ".")) || 0 })} /></div>
                      : <div className="grid gap-1"><Label>Percentual (%)</Label><Input inputMode="decimal" value={String(r.percentual ?? 0)} onChange={(e) => set({ percentual: Number(e.target.value.replace(",", ".")) || 0 })} /></div>}
                    <div className="grid gap-1 sm:col-span-2"><Label>Sessão em grupo conta</Label>
                      <select className="h-9 rounded-md border bg-background px-2 text-sm" value={r.grupo_conta ?? "por_sessao"} onChange={(e) => set({ grupo_conta: e.target.value as Regra["grupo_conta"] })}>
                        <option value="por_sessao">Uma vez por sessão</option><option value="por_paciente">Uma vez por paciente presente</option>
                      </select>
                    </div>
                  </div>
                )}
                {r.modelo && orig.comissao_pct > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Tem comissão de {orig.comissao_pct}% no cadastro: com regra de folha, a comissão por atendimento deixa de ser lançada.</p>}
                {edit[orig.usuario_id] && <div className="flex justify-end"><Button size="sm" onClick={() => salvar.mutate(r)} disabled={salvar.isPending}>Salvar</Button></div>}
              </div>
            );
          })}
          {q.data?.length === 0 && <p className="text-sm text-muted-foreground">Ninguém da equipe está marcado como quem atende.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
