import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCheck, Settings2, Wallet } from "lucide-react";
import { apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { dataCurta } from "@/lib/crm";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/* Comissões da rede de lojas (backend/routers/pedidos.py): mesma regra de data da tela de Relatórios, pela data do pedido. */

interface Config { ativo: boolean; pct: number; pedidos_com_comissao: number; dia_pagamento: number; forma_pagamento: string }
interface Pedido {
  id: string; negocio_id: string; negocio_nome: string; numero: string; data: string; valor: number; ordem: number | null; pct: number; comissao: number;
  status: string; beneficiario_nome: string | null; pagamento_previsto: string | null; aprovado_por?: string | null; pago_por?: string | null;
  pode_aprovar: boolean; pode_pagar: boolean; minha: boolean;
}
interface Resposta {
  config: Config; pedidos: Pedido[];
  resumo: { vendido: number; comissao: number; pendente: number; aprovada: number; paga: number };
  por_pessoa: { pessoa_id: string; nome: string; vendido: number; comissao: number; pedidos: number }[];
}

const ST: Record<string, [string, string]> = {
  pendente: ["Pendente", "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"],
  aprovada: ["Aprovada", "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200"],
  paga: ["Paga", "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"],
  sem_comissao: ["Sem comissão", "bg-muted text-muted-foreground"],
  cancelado: ["Cancelado", "bg-muted text-muted-foreground line-through"],
};

function meses(): { v: string; r: string }[] {
  const d = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const v = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
    return { v, r: x.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) };
  });
}

export default function Comissoes() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const opcoes = useMemo(meses, []);
  const [mes, setMes] = useState(opcoes[0].v);
  const [sel, setSel] = useState<string[]>([]);
  const [config, setConfig] = useState(false);
  const q = useQuery({ queryKey: ["pedidos", "mes", mes], queryFn: () => apiGet<Resposta>(`/pedidos?mes=${mes}`) });
  const acao = useMutation({
    mutationFn: ({ rota, ids }: { rota: "aprovar" | "pagar"; ids: string[] }) => apiPost<{ ok: number; falhas?: { motivo: string }[] }>(`/pedidos/${rota}`, { ids }),
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: ["pedidos"] });
      setSel([]);
      toast.success(`${r.ok} comissão(ões) ${v.rota === "aprovar" ? "aprovada(s)" : "marcada(s) como paga(s)"}.`);
      (r.falhas ?? []).slice(0, 3).forEach((f) => toast.warning(f.motivo));
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível concluir"),
  });
  const d = q.data;
  const aprovaveis = (d?.pedidos ?? []).filter((p) => p.pode_aprovar).map((p) => p.id);
  const pagaveis = (d?.pedidos ?? []).filter((p) => p.pode_pagar).map((p) => p.id);
  const selAprovar = sel.filter((id) => aprovaveis.includes(id));
  const selPagar = sel.filter((id) => pagaveis.includes(id));
  return (
    <div className="space-y-6" data-testid="comissoes-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">Comissões</h2>
          {d && (
            <p className="mt-1 text-sm text-muted-foreground">
              {d.config.pct}% nos {d.config.pedidos_com_comissao} primeiros pedidos de cada cliente, para o responsável do negócio. Aprovada pelo supervisor,
              gerente ou diretoria (ninguém aprova a própria) e paga no dia {d.config.dia_pagamento} do mês seguinte{d.config.forma_pagamento ? ` via ${d.config.forma_pagamento}` : ""}.
              Conta pela data do pedido.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <select value={mes} onChange={(e) => { setMes(e.target.value); setSel([]); }} className="h-9 rounded-md border bg-card px-2 text-sm capitalize" aria-label="Mês">
            {opcoes.map((o) => <option key={o.v} value={o.v}>{o.r}</option>)}
          </select>
          {isAdmin && <Button variant="outline" size="sm" onClick={() => setConfig(true)}><Settings2 className="h-4 w-4" /> Regra</Button>}
        </div>
      </div>

      {d && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {([["Total vendido", d.resumo.vendido], ["Comissão", d.resumo.comissao], ["Pendente", d.resumo.pendente], ["Aprovada", d.resumo.aprovada], ["Paga", d.resumo.paga]] as const).map(([t, v]) => (
            <div key={t} className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">{t}</p>
              <p className="mt-1 whitespace-nowrap text-[clamp(1rem,2.2vw,1.25rem)] font-bold">{brl(v)}</p>
            </div>
          ))}
        </div>
      )}

      {d && d.por_pessoa.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Pessoa</th><th className="px-4 py-2 text-right font-medium">Pedidos</th><th className="px-4 py-2 text-right font-medium">Vendido</th><th className="px-4 py-2 text-right font-medium">Comissão</th></tr></thead>
            <tbody className="divide-y">
              {d.por_pessoa.map((p) => (
                <tr key={p.pessoa_id}><td className="px-4 py-2">{p.nome}</td><td className="px-4 py-2 text-right">{p.pedidos}</td><td className="px-4 py-2 text-right">{brl(p.vendido)}</td><td className="px-4 py-2 text-right font-semibold">{brl(p.comissao)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto font-semibold">Pedidos do mês</p>
          {selAprovar.length > 0 && (
            <Button size="sm" disabled={acao.isPending} onClick={() => window.confirm(`Aprovar ${selAprovar.length} comissão(ões)?`) && acao.mutate({ rota: "aprovar", ids: selAprovar })} data-testid="aprovar">
              <CheckCheck className="h-4 w-4" /> Aprovar ({selAprovar.length})
            </Button>
          )}
          {selPagar.length > 0 && (
            <Button size="sm" variant="outline" disabled={acao.isPending} onClick={() => window.confirm(`Marcar ${selPagar.length} comissão(ões) como paga(s)?`) && acao.mutate({ rota: "pagar", ids: selPagar })}>
              <Wallet className="h-4 w-4" /> Marcar paga ({selPagar.length})
            </Button>
          )}
        </div>
        {q.isLoading ? <div className="h-32 animate-pulse rounded-xl bg-muted" /> : !d?.pedidos.length ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhum pedido neste mês. O pedido é registrado no negócio, ao marcar ganho.</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {d.pedidos.map((p) => {
              const marcavel = p.pode_aprovar || p.pode_pagar;
              const [rot, cor] = ST[p.status] ?? [p.status, "bg-muted"];
              return (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  {marcavel ? (
                    <input type="checkbox" aria-label={`Selecionar pedido ${p.numero}`} checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />
                  ) : <span className="w-[13px]" />}
                  <span className="min-w-0 flex-1">
                    <Link to={`/negocios/${p.negocio_id}`} className="font-medium hover:text-primary">{p.negocio_nome}</Link>
                    <span className="block text-xs text-muted-foreground">
                      Nº {p.numero} · {dataCurta(p.data)}{p.ordem ? ` · ${p.ordem}º pedido` : ""} · {p.beneficiario_nome ?? "sem responsável"}{p.minha ? " (você)" : ""}
                      {p.status === "aprovada" && p.pagamento_previsto ? ` · paga em ${dataCurta(p.pagamento_previsto)}` : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold">{brl(p.valor)}</span>
                    <span className="block text-xs text-muted-foreground">{p.comissao > 0 ? `${brl(p.comissao)} (${p.pct}%)` : "—"}</span>
                  </span>
                  <span className={cn("hidden rounded-full px-2 py-0.5 text-xs font-medium sm:inline", cor)}>{rot}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {config && d && <RegraDialog inicial={d.config} onClose={() => setConfig(false)} />}
    </div>
  );
}

function RegraDialog({ inicial, onClose }: { inicial: Config; onClose: () => void }) {
  const qc = useQueryClient();
  const [c, setC] = useState(inicial);
  const salvar = useMutation({
    mutationFn: () => apiPut("/pedidos/config", c),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pedidos"] }); toast.success("Regra salva. Vale para os próximos pedidos."); onClose(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Regra da comissão</DialogTitle><DialogDescription>Comissão aprovada ou paga não muda.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.ativo} onChange={(e) => setC({ ...c, ativo: e.target.checked })} /> Pagar comissão por pedido</label>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Percentual (%)</Label><Input type="number" step="0.5" value={c.pct} onChange={(e) => setC({ ...c, pct: Number(e.target.value) })} /></div>
            <div className="grid gap-1.5"><Label>Primeiros pedidos</Label><Input type="number" value={c.pedidos_com_comissao} onChange={(e) => setC({ ...c, pedidos_com_comissao: Number(e.target.value) })} /></div>
            <div className="grid gap-1.5"><Label>Dia do pagamento</Label><Input type="number" min={1} max={28} value={c.dia_pagamento} onChange={(e) => setC({ ...c, dia_pagamento: Number(e.target.value) })} /></div>
            <div className="grid gap-1.5"><Label>Forma</Label><Input value={c.forma_pagamento} onChange={(e) => setC({ ...c, forma_pagamento: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
