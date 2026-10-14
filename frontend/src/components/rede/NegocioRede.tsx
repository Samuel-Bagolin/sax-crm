import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Loader2, Plus, ShoppingBag } from "lucide-react";
import { apiGet, apiPatch, apiPost, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { dataCurta } from "@/lib/crm";
import { useAuth } from "@/lib/useAuth";
import { useRede } from "@/lib/rede";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Atividade } from "@/lib/types";

/* Peças da rede de lojas no negócio: praça, supervisão e loja; pedidos com comissão; resultado da atividade. */

interface NegocioBase { id: string; nome: string; status: string; praca?: string | null; supervisao_id?: string | null; unidade_id?: string | null; corretor_id: string | null }

export interface Pedido {
  id: string; numero: string; data: string; valor: number; ordem: number | null; pct: number; comissao: number; status: string;
  beneficiario_nome?: string | null; pagamento_previsto?: string | null; observacao?: string | null;
}

const ST: Record<string, string> = { pendente: "Comissão pendente", aprovada: "Comissão aprovada", paga: "Comissão paga", cancelado: "Cancelado", sem_comissao: "Sem comissão" };

export function BlocoRede({ negocio, onSalvo }: { negocio: NegocioBase; onSalvo: () => void }) {
  const { isAdmin } = useAuth();
  const { rede, nomeSup, nomeLoja } = useRede();
  const pode = isAdmin || !!(rede && (rede.eu.supervisoes.length || rede.eu.pracas.length));
  const salvar = useMutation({
    mutationFn: (dados: Record<string, string | null>) => apiPatch(`/leads/${negocio.id}`, dados),
    onSuccess: () => { onSalvo(); toast.success("Salvo"); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  if (!rede) return null;
  const sel = "h-8 w-full rounded-md border bg-background px-2 text-sm";
  const pracas = isAdmin ? rede.pracas : rede.eu.pracas;
  const sups = rede.supervisoes.filter((s) => (!negocio.praca || s.praca === negocio.praca) && (isAdmin || rede.eu.supervisoes.includes(s.id) || !rede.eu.supervisoes.length));
  const lideres = rede.equipe.filter((m) => isAdmin ? true : m.pessoa_id === negocio.corretor_id || rede.eu.equipe.includes(m.pessoa_id));
  return (
    <section className="rounded-lg border bg-card p-4 text-sm" data-testid="bloco-rede">
      <h3 className="mb-3 font-semibold">Praça e supervisão</h3>
      {pode ? (
        <div className="grid gap-2.5">
          <label className="grid gap-1"><span className="text-xs text-muted-foreground">Praça</span>
            <select className={sel} value={negocio.praca ?? ""} onChange={(e) => salvar.mutate({ praca: e.target.value || null, supervisao_id: null })} data-testid="neg-praca">
              <option value="">Sem praça</option>
              {pracas.map((p) => <option key={p} value={p}>{p}</option>)}
            </select></label>
          {sups.length > 0 && (
            <label className="grid gap-1"><span className="text-xs text-muted-foreground">Supervisão</span>
              <select className={sel} value={negocio.supervisao_id ?? ""} onChange={(e) => salvar.mutate({ supervisao_id: e.target.value || null })} data-testid="neg-supervisao">
                <option value="">Sem supervisão (todos da praça veem)</option>
                {sups.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select></label>
          )}
          <label className="grid gap-1"><span className="text-xs text-muted-foreground">Loja</span>
            <select className={sel} value={negocio.unidade_id ?? ""} onChange={(e) => salvar.mutate({ unidade_id: e.target.value || null })}>
              <option value="">Sem loja</option>
              {rede.lojas.filter((l) => !negocio.praca || l.praca === negocio.praca).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select></label>
          <label className="grid gap-1"><span className="text-xs text-muted-foreground">Responsável</span>
            <select className={sel} value={negocio.corretor_id ?? ""} onChange={(e) => e.target.value && salvar.mutate({ corretor_id: e.target.value })} data-testid="neg-responsavel">
              {!negocio.corretor_id && <option value="">Sem responsável</option>}
              {lideres.map((m) => <option key={m.pessoa_id} value={m.pessoa_id}>{m.nome}{m.atua_em ? ` · ${m.atua_em}` : ""}</option>)}
            </select></label>
        </div>
      ) : (
        <div className="grid gap-1 text-muted-foreground">
          <p>Praça: <span className="text-foreground">{negocio.praca ?? "—"}</span></p>
          <p>Supervisão: <span className="text-foreground">{nomeSup(negocio.supervisao_id) ?? "—"}</span></p>
          <p>Loja: <span className="text-foreground">{nomeLoja(negocio.unidade_id) ?? "—"}</span></p>
        </div>
      )}
    </section>
  );
}

export function PedidoDialog({ negocio, aberto, onClose, onSalvo }: { negocio: NegocioBase; aberto: boolean; onClose: () => void; onSalvo: () => void }) {
  const hoje = new Date();
  const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  const [numero, setNumero] = useState("");
  const [data, setData] = useState(iso);
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");
  const v = Number(valor.replace(/\./g, "").replace(",", ".")) || 0;
  const salvar = useMutation({
    mutationFn: () => apiPost<Pedido>("/pedidos", { negocio_id: negocio.id, numero: numero.trim(), data, valor: v, observacao: obs.trim() || null }),
    onSuccess: (p) => {
      toast.success(p.comissao > 0 ? `Pedido registrado. Comissão de ${brl(p.comissao)} (${p.ordem}º pedido do cliente).` : "Pedido registrado.");
      setNumero(""); setValor(""); setObs("");
      onSalvo(); onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível registrar"),
  });
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{negocio.status === "ganho" ? "Registrar pedido" : "Ganho: registre o pedido"}</DialogTitle>
          <DialogDescription>{negocio.status === "ganho" ? negocio.nome : "Negócio ganho precisa do pedido com o valor total vendido."}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (numero.trim() && v > 0 && data <= iso) salvar.mutate(); }} data-testid="pedido-form">
          <div className="grid gap-1.5"><Label htmlFor="pd-num">Nº do pedido</Label><Input id="pd-num" value={numero} onChange={(e) => setNumero(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="pd-data">Data</Label><Input id="pd-data" type="date" max={iso} value={data} onChange={(e) => setData(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pd-valor">Valor total (R$)</Label><Input id="pd-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" /></div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="pd-obs">Observação (opcional)</Label><Input id="pd-obs" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={!numero.trim() || v <= 0 || data > iso || salvar.isPending} data-testid="pedido-salvar">
              {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {negocio.status === "ganho" ? "Registrar" : "Registrar e marcar ganho"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BlocoPedidos({ negocio, onMudou }: { negocio: NegocioBase; onMudou: () => void }) {
  const qc = useQueryClient();
  const [novo, setNovo] = useState(false);
  const q = useQuery({ queryKey: ["pedidos", "negocio", negocio.id], queryFn: () => apiGet<{ pedidos: Pedido[] }>(`/pedidos?negocio_id=${negocio.id}`) });
  const cancelar = useMutation({
    mutationFn: (id: string) => apiPost(`/pedidos/${id}/cancelar`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pedidos"] }); onMudou(); toast.success("Pedido cancelado"); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível cancelar"),
  });
  const pedidos = q.data?.pedidos ?? [];
  const atualizar = () => { qc.invalidateQueries({ queryKey: ["pedidos"] }); onMudou(); };
  return (
    <section className="rounded-lg border bg-card p-4 text-sm" data-testid="bloco-pedidos">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-semibold"><ShoppingBag className="h-4 w-4" /> Pedidos</h3>
        {negocio.status === "ganho" && <Button size="sm" variant="ghost" onClick={() => setNovo(true)}><Plus className="h-3.5 w-3.5" /> Pedido</Button>}
      </div>
      {!pedidos.length ? (
        <p className="text-muted-foreground">{negocio.status === "ganho" ? "Nenhum pedido ainda." : "O pedido entra quando o negócio é ganho."}</p>
      ) : (
        <ul className="divide-y">
          {pedidos.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium">Nº {p.numero}</span> <span className="text-muted-foreground">· {dataCurta(p.data)}{p.ordem ? ` · ${p.ordem}º do cliente` : ""}</span>
                <span className="block text-xs text-muted-foreground">{ST[p.status] ?? p.status}{p.comissao > 0 ? `: ${brl(p.comissao)} (${p.pct}%)` : ""}</span>
              </span>
              <span className="num font-semibold">{brl(p.valor)}</span>
              {(p.status === "pendente" || p.status === "aprovada" || p.status === "sem_comissao") && (
                <Button variant="ghost" size="icon-sm" title="Cancelar pedido" onClick={() => window.confirm(`Cancelar o pedido ${p.numero}? A comissão é recalculada.`) && cancelar.mutate(p.id)}>
                  <Ban className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <PedidoDialog negocio={negocio} aberto={novo} onClose={() => setNovo(false)} onSalvo={atualizar} />
    </section>
  );
}

const CONTATO = ["ligacao", "whatsapp", "email"];
const REUNIAO = ["reuniao", "visita", "almoco"];

/** Ao concluir contato ou reunião na rede de lojas, pergunta o resultado: só o positivo destrava a etapa com cadeado. */
export function ResultadoDialog({ atividade, onClose, onFeito }: { atividade: Atividade | null; onClose: () => void; onFeito: () => void }) {
  const salvar = useMutation({
    mutationFn: (resultado: "positivo" | "negativo") => apiPatch(`/atividades/${atividade!.id}`, { concluida: true, resultado }),
    onSuccess: () => { onFeito(); onClose(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível concluir"),
  });
  if (!atividade) return null;
  const reuniao = REUNIAO.includes(atividade.tipo);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{reuniao ? "A reunião aconteceu?" : "O contato teve sucesso?"}</DialogTitle>
          <DialogDescription>{atividade.assunto}. Com resultado positivo, o card avança para a etapa que exige esta evidência.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => salvar.mutate("positivo")} disabled={salvar.isPending} data-testid="resultado-positivo">{reuniao ? "Realizada" : "Com sucesso"}</Button>
          <Button variant="outline" onClick={() => salvar.mutate("negativo")} disabled={salvar.isPending}>{reuniao ? "Não realizada" : "Sem sucesso"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function pedeResultado(a: Atividade): boolean {
  return !a.concluida && (CONTATO.includes(a.tipo) || REUNIAO.includes(a.tipo));
}
