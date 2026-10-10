import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Crown, MessageCircle, Plus, Receipt, Settings2 } from "lucide-react";
import { apiGet, apiPatch, apiPost, apiPut, detalheErro } from "@/lib/api";
import { brl, dataBR } from "@/lib/format";
import { useServicos } from "@/lib/atendimentos";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Combo from "@/components/shared/Combo";
import { cn } from "@/lib/utils";

interface PlanoClube { id: string; nome: string; valor_mensal: number; servico_ids: string[]; limite_mes: number | null; descricao: string | null; ativo: boolean }
interface Linha {
  id: string; cliente_id: string; cliente_nome: string; telefone: string | null; plano_nome: string; valor: number;
  status: "ativo" | "pausado" | "cancelado"; inicio: string | null; visitas_mes: number; media_3_meses: number; ultima_visita: string | null;
  dias_sem_vir: number | null; consumido_tabela: number; custo_por_visita: number | null; saldo: number; limite_mes: number | null; risco: boolean;
}
interface Painel {
  mes: string;
  assinantes: Linha[];
  resumo: { ativos: number; pausados: number; receita_mensal: number; visitas: number; media_visitas: number; receita_por_visita: number | null;
    consumido_tabela: number; resultado: number; em_risco: number; faixas: Record<string, number> };
}

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function Clube() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [mes, setMes] = useState(mesAtual());
  const [novo, setNovo] = useState(false);
  const [planosAberto, setPlanosAberto] = useState(false);
  const planos = useQuery({ queryKey: ["clube-planos"], queryFn: () => apiGet<PlanoClube[]>("/clube/planos") });
  const q = useQuery({ queryKey: ["clube-painel", mes], queryFn: () => apiGet<Painel>(`/clube/painel?mes=${mes}`) });
  const mudar = useMutation({
    mutationFn: ({ id, corpo }: { id: string; corpo: Record<string, unknown> }) => apiPatch(`/clube/assinantes/${id}`, corpo),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["clube-painel"] }); toast.success("Assinante atualizado"); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível atualizar"),
  });
  const mensalidades = useMutation({
    mutationFn: () => apiPost<{ lancadas: number; ja_existiam: number }>("/clube/mensalidades", { mes }),
    onSuccess: (r) => toast.success(r.lancadas ? `${r.lancadas} mensalidade(s) lançadas no Financeiro` : "As mensalidades deste mês já estavam lançadas"),
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível lançar"),
  });
  const r = q.data?.resumo;
  const semPlano = planos.data && !planos.data.length;
  const maxFaixa = Math.max(1, ...Object.values(r?.faixas ?? { a: 1 }));

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="w-44" aria-label="Mês" />
        <div className="ml-auto flex flex-wrap gap-2">
          {isAdmin && <Button variant="outline" onClick={() => setPlanosAberto(true)} data-testid="clube-planos"><Settings2 className="h-4 w-4" /> Planos do clube</Button>}
          {isAdmin && <Button variant="outline" onClick={() => mensalidades.mutate()} disabled={mensalidades.isPending || !r?.ativos}><Receipt className="h-4 w-4" /> Lançar mensalidades</Button>}
          <Button onClick={() => setNovo(true)} disabled={!!semPlano} data-testid="clube-novo"><Plus className="h-4 w-4" /> Novo assinante</Button>
        </div>
      </div>

      {semPlano && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Crown className="mx-auto h-8 w-8 text-[#ff7a00]" />
          <p className="mt-2 text-lg font-semibold">Monte o clube de assinatura</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">O cliente paga um valor fixo por mês e corta quantas vezes quiser. Aqui você vê quantas vezes cada assinante vem e se o plano está dando lucro.</p>
          {isAdmin && <Button className="mt-4" onClick={() => setPlanosAberto(true)}>Criar o primeiro plano</Button>}
        </div>
      )}

      {r && r.ativos + r.pausados > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi rotulo="Assinantes ativos" valor={String(r.ativos)} detalhe={r.pausados ? `${r.pausados} pausado(s)` : undefined} />
            <Kpi rotulo="Receita do clube" valor={brl(r.receita_mensal)} detalhe="por mês" />
            <Kpi rotulo="Visitas no mês" valor={String(r.visitas)} detalhe={`média de ${r.media_visitas} por assinante`} />
            <Kpi rotulo="Receita por visita" valor={r.receita_por_visita ? brl(r.receita_por_visita) : "-"} detalhe={`tabela consumida ${brl(r.consumido_tabela)}`} alerta={r.resultado < 0} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
            <section className="rounded-xl border bg-card p-4">
              <p className="font-semibold">Quantas vezes cada assinante veio no mês</p>
              <div className="mt-3 grid grid-cols-4 items-end gap-3" aria-label="Distribuição de visitas">
                {(["0", "1", "2-3", "4+"] as const).map((k) => (
                  <div key={k} className="flex flex-col items-center gap-1">
                    <span className="num text-sm font-semibold">{r.faixas[k]}</span>
                    <div className="flex h-24 w-full items-end rounded-md bg-muted">
                      <div className={cn("w-full rounded-md", k === "0" ? "bg-red-400" : "bg-[#ff7a00]")} style={{ height: `${(r.faixas[k] / maxFaixa) * 100}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">{k === "0" ? "não veio" : `${k} ${k === "1" ? "vez" : "vezes"}`}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className={cn("grid content-start gap-2 rounded-xl border p-4", r.resultado >= 0 ? "bg-card" : "border-red-300 bg-red-50 dark:bg-red-950/30")}>
              <p className="text-sm text-muted-foreground">Resultado do clube no mês</p>
              <p className={cn("num text-3xl font-bold", r.resultado < 0 && "text-red-600")}>{brl(r.resultado)}</p>
              <p className="text-xs text-muted-foreground">Receita das assinaturas menos o que os assinantes consumiriam pela tabela de preços. Negativo: o plano está barato para o uso.</p>
              {r.em_risco > 0 && <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300"><AlertTriangle className="h-4 w-4" /> {r.em_risco} assinante(s) sem vir há mais de 3 semanas</p>}
            </section>
          </div>
        </>
      )}

      {q.data && q.data.assinantes.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-2.5">Assinante</th><th className="px-2">Plano</th><th className="px-2">Visitas no mês</th><th className="px-2">Média 3 meses</th><th className="px-2">Última visita</th><th className="px-2 text-right">Custo por visita</th><th className="px-2 text-right">Saldo</th><th className="px-4" /></tr>
            </thead>
            <tbody className="divide-y">
              {q.data.assinantes.map((x) => (
                <tr key={x.id} className={cn(x.status !== "ativo" && "opacity-60")}>
                  <td className="px-4 py-2.5">
                    <Link to={`/pacientes/${x.cliente_id}`} className="font-medium hover:underline">{x.cliente_nome}</Link>
                    {x.status !== "ativo" && <span className="ml-2 rounded bg-muted px-1.5 text-[11px]">{x.status}</span>}
                    {x.risco && <span className="ml-2 rounded bg-amber-100 px-1.5 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">sumiu</span>}
                  </td>
                  <td className="px-2">{x.plano_nome}<span className="block text-xs text-muted-foreground">{brl(x.valor)}/mês</span></td>
                  <td className="px-2">
                    <div className="flex items-center gap-2">
                      <span className="num w-5 font-semibold">{x.visitas_mes}</span>
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-[#ff7a00]" style={{ width: `${Math.min(100, (x.visitas_mes / Math.max(4, x.limite_mes ?? 4)) * 100)}%` }} />
                      </div>
                      {x.limite_mes && <span className="text-xs text-muted-foreground">de {x.limite_mes}</span>}
                    </div>
                  </td>
                  <td className="num px-2">{x.media_3_meses}</td>
                  <td className="px-2">{x.ultima_visita ? `${dataBR(x.ultima_visita)}` : "Nunca"}<span className="block text-xs text-muted-foreground">{x.dias_sem_vir != null ? `há ${x.dias_sem_vir} dias` : ""}</span></td>
                  <td className="num px-2 text-right">{x.custo_por_visita ? brl(x.custo_por_visita) : "-"}</td>
                  <td className={cn("num px-2 text-right font-semibold", x.saldo < 0 ? "text-red-600" : "text-emerald-700 dark:text-emerald-400")}>{brl(x.saldo)}</td>
                  <td className="px-4">
                    <div className="flex justify-end gap-1">
                      {x.telefone && x.risco && (
                        <a className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted" target="_blank" rel="noopener noreferrer"
                          href={`https://wa.me/55${x.telefone.replace(/\D/g, "")}?text=${encodeURIComponent(`Oi ${x.cliente_nome.split(" ")[0]}, sentimos sua falta! Seu plano ${x.plano_nome} está ativo, bora marcar o próximo corte?`)}`}>
                          <MessageCircle className="h-3.5 w-3.5" /> Chamar
                        </a>
                      )}
                      {x.status === "ativo" && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => mudar.mutate({ id: x.id, corpo: { status: "pausado" } })}>Pausar</Button>}
                      {x.status === "pausado" && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => mudar.mutate({ id: x.id, corpo: { status: "ativo" } })}>Reativar</Button>}
                      {x.status !== "cancelado" && <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => window.confirm(`Cancelar a assinatura de ${x.cliente_nome}?`) && mudar.mutate({ id: x.id, corpo: { status: "cancelado" } })}>Cancelar</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NovoAssinante aberto={novo} planos={(planos.data ?? []).filter((p) => p.ativo)} onClose={() => setNovo(false)} />
      <PlanosClube aberto={planosAberto} planos={planos.data ?? []} onClose={() => setPlanosAberto(false)} />
    </div>
  );
}

function Kpi({ rotulo, valor, detalhe, alerta }: { rotulo: string; valor: string; detalhe?: string; alerta?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card p-4", alerta && "border-red-300")}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="num mt-1 text-xl font-bold sm:text-2xl">{valor}</p>
      {detalhe && <p className="truncate text-[11px] text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

function NovoAssinante({ aberto, planos, onClose }: { aberto: boolean; planos: PlanoClube[]; onClose: () => void }) {
  const qc = useQueryClient();
  const clientes = useQuery({ queryKey: ["pacientes-lista"], queryFn: () => apiGet<{ id: string; nome: string; telefone: string | null }[]>("/pacientes"), enabled: aberto });
  const [f, setF] = useState({ cliente_id: null as string | null, plano_id: "", dia: "10" });
  useEffect(() => { if (aberto) setF({ cliente_id: null, plano_id: planos[0]?.id ?? "", dia: "10" }); }, [aberto, planos]);
  const salvar = useMutation({
    mutationFn: () => apiPost("/clube/assinantes", { cliente_id: f.cliente_id, plano_id: f.plano_id, dia_vencimento: Number(f.dia) || 10 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["clube-painel"] }); toast.success("Assinante incluído no clube"); onClose(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível incluir"),
  });
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Novo assinante</DialogTitle><DialogDescription>O cliente precisa estar cadastrado em Clientes.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>Cliente</Label>
            <Combo opcoes={(clientes.data ?? []).map((c) => ({ valor: c.id, rotulo: c.nome, detalhe: c.telefone }))} valor={f.cliente_id} onChange={(v) => setF({ ...f, cliente_id: v })} placeholder="Buscar cliente" testid="clube-cliente" />
          </div>
          <div className="grid gap-1.5"><Label>Plano</Label>
            <div className="grid gap-1.5">
              {planos.map((p) => (
                <button key={p.id} type="button" onClick={() => setF({ ...f, plano_id: p.id })}
                  className={cn("flex items-center justify-between rounded-lg border p-2.5 text-left text-sm", f.plano_id === p.id ? "border-primary ring-2 ring-primary/20" : "hover:bg-muted")}>
                  <span><b>{p.nome}</b><span className="block text-xs text-muted-foreground">{p.limite_mes ? `até ${p.limite_mes} por mês` : "ilimitado"}</span></span>
                  <span className="num font-semibold">{brl(p.valor_mensal)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="cl-dia">Dia do vencimento</Label><Input id="cl-dia" inputMode="numeric" className="w-24" value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value.replace(/\D/g, "").slice(0, 2) })} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={() => salvar.mutate()} disabled={!f.cliente_id || !f.plano_id || salvar.isPending} data-testid="clube-salvar">Incluir no clube</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanosClube({ aberto, planos, onClose }: { aberto: boolean; planos: PlanoClube[]; onClose: () => void }) {
  const qc = useQueryClient();
  const servicos = useServicos();
  const [edit, setEdit] = useState<PlanoClube | "novo" | null>(null);
  const [f, setF] = useState({ nome: "", valor: "", limite: "", servico_ids: [] as string[] });
  useEffect(() => {
    if (edit === "novo") setF({ nome: "Corte ilimitado", valor: "", limite: "", servico_ids: [] });
    else if (edit) setF({ nome: edit.nome, valor: String(edit.valor_mensal), limite: edit.limite_mes ? String(edit.limite_mes) : "", servico_ids: edit.servico_ids });
  }, [edit]);
  useEffect(() => { if (aberto && !planos.length) setEdit("novo"); }, [aberto, planos.length]);
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { nome: f.nome.trim(), valor_mensal: Number(f.valor.replace(",", ".")) || 0, limite_mes: f.limite ? Number(f.limite) : null, servico_ids: f.servico_ids, ativo: true };
      return edit === "novo" ? apiPost("/clube/planos", corpo) : apiPut(`/clube/planos/${(edit as PlanoClube).id}`, corpo);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["clube-planos"] }); qc.invalidateQueries({ queryKey: ["clube-painel"] }); toast.success("Plano salvo"); setEdit(null); },
    onError: (e) => toast.error(detalheErro(e) ?? "Confira os campos"),
  });
  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) { setEdit(null); onClose(); } }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Planos do clube</DialogTitle><DialogDescription>Valor fixo por mês. Deixe o limite vazio para ilimitado.</DialogDescription></DialogHeader>
        {edit ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="pc-nome">Nome</Label><Input id="pc-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="pc-valor">Valor por mês (R$)</Label><Input id="pc-valor" inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} data-testid="pc-valor" /></div>
              <div className="grid gap-1.5"><Label htmlFor="pc-lim">Limite no mês</Label><Input id="pc-lim" inputMode="numeric" value={f.limite} onChange={(e) => setF({ ...f, limite: e.target.value.replace(/\D/g, "") })} placeholder="Ilimitado" /></div>
            </div>
            <div className="grid gap-1.5"><Label>Serviços incluídos</Label>
              <div className="flex flex-wrap gap-1.5">
                {(servicos.data ?? []).filter((s) => s.ativo).map((s) => {
                  const on = f.servico_ids.includes(s.id);
                  return <button key={s.id} type="button" onClick={() => setF({ ...f, servico_ids: on ? f.servico_ids.filter((x) => x !== s.id) : [...f.servico_ids, s.id] })}
                    className={cn("rounded-full border px-3 py-1 text-sm", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{s.nome}</button>;
                })}
              </div>
              <p className="text-xs text-muted-foreground">Sem nenhum marcado, o plano cobre todos os serviços.</p>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setEdit(null)}>Voltar</Button><Button onClick={() => salvar.mutate()} disabled={f.nome.trim().length < 2 || !Number(f.valor.replace(",", ".")) || salvar.isPending} data-testid="pc-salvar">Salvar plano</Button></DialogFooter>
          </div>
        ) : (
          <div className="grid gap-2">
            {planos.map((p) => (
              <button key={p.id} type="button" onClick={() => setEdit(p)} className="flex items-center justify-between rounded-lg border p-3 text-left hover:bg-muted">
                <span><b>{p.nome}</b><span className="block text-xs text-muted-foreground">{p.limite_mes ? `até ${p.limite_mes} por mês` : "ilimitado"}{p.servico_ids.length ? `, ${p.servico_ids.length} serviço(s)` : ", todos os serviços"}</span></span>
                <span className="num font-semibold">{brl(p.valor_mensal)}</span>
              </button>
            ))}
            <Button variant="outline" onClick={() => setEdit("novo")}><Plus className="h-4 w-4" /> Novo plano</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
