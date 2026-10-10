import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import type { AssinaturaResumo, SegmentoInfo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Plano {
  chave: string;
  nome: string;
  resumo: string;
  preco_mensal: number;
  preco_anual: number | null;
  usuarios: number | null;
  imoveis: number | null;
  unidades: number | null;
  recursos: string[];
}
interface Dados {
  segmento: SegmentoInfo;
  plano: { chave: string; nome: string; usuarios: number | null; imoveis: number | null; unidades: number | null };
  uso: { usuarios: number; imoveis: number; unidades: number };
  valores: { periodicidade: string; total: number; equivalente_mensal: number } | null;
  assinatura: AssinaturaResumo | null;
  autoatendimento: boolean;
  planos: Plano[];
  faturas: { id: string; valor: number; status: string; vencimento: string; pago_em: string | null; link: string | null }[];
}

const STATUS_FAT: Record<string, string> = { CONFIRMED: "Pago", RECEIVED: "Pago", PENDING: "Em aberto", OVERDUE: "Vencida", REFUNDED: "Estornada" };
function dataBR(iso: string | null | undefined) {
  return iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "-";
}
function lim(v: number | null, usado: number, r: string) {
  return `${usado} de ${v == null ? "ilimitado" : v} ${r}`;
}

export default function Assinatura() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["assinatura"], queryFn: () => apiGet<Dados>("/assinatura") });
  const [cartao, setCartao] = useState(false);
  const [anual, setAnual] = useState<boolean | null>(null);
  const trocar = useMutation({
    mutationFn: ({ plano, per }: { plano: string; per: string }) => apiPost("/assinatura/plano", { plano, periodicidade: per }),
    onSuccess: () => { qc.invalidateQueries(); toast.success("Plano alterado"); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível trocar"),
  });
  const cancelar = useMutation({
    mutationFn: () => apiPost("/assinatura/cancelar"),
    onSuccess: () => { qc.invalidateQueries(); toast.success("Assinatura cancelada. O acesso segue até o fim do período pago."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível cancelar"),
  });
  if (!q.data) return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  const d = q.data;
  const a = d.assinatura;
  const per = anual === null ? (a?.periodicidade ?? d.valores?.periodicidade ?? "mensal") === "anual" : anual;
  return (
    <div className="grid gap-5">
      {a?.bloqueio && (
        <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-red-900 dark:bg-red-950/50 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div><p className="font-semibold">{a.bloqueio}</p><p className="text-sm">Assim que o pagamento for confirmado, o acesso volta na hora.</p></div>
        </div>
      )}
      {a?.status === "atrasada" && !a.bloqueio && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Cobrança em atraso desde {dataBR(a.atraso_desde)}. Atualize o cartão para evitar o bloqueio em {a.carencia_dias} dias.
        </p>
      )}
      <section className="grid gap-4 rounded-xl border bg-card p-5 lg:grid-cols-3">
        <div>
          <p className="text-sm text-muted-foreground">Plano atual, {d.segmento.nome}</p>
          <p className="text-2xl font-bold">{d.plano.nome}</p>
          {d.valores && <p className="text-sm">{brl(d.valores.total)} {d.valores.periodicidade === "anual" ? "por ano" : "por mês"}</p>}
          {a?.demo && <span className="mt-1 inline-block rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-900 dark:bg-violet-950 dark:text-violet-200">Conta de demonstração</span>}
        </div>
        <div className="text-sm">
          <p className="text-muted-foreground">Uso do plano</p>
          <p>{lim(d.plano.usuarios, d.uso.usuarios, "usuários")}</p>
          {(d.segmento.chave === "imobiliaria" || d.segmento.chave === "veiculos") && <p>{lim(d.plano.imoveis, d.uso.imoveis, d.segmento.termos.itens.toLowerCase())}</p>}
          <p>{lim(d.plano.unidades, d.uso.unidades, d.segmento.termos.unidades.toLowerCase())}</p>
        </div>
        <div className="text-sm">
          {d.autoatendimento ? (
            <>
              <p className="text-muted-foreground">Pagamento</p>
              <p className="flex items-center gap-2 font-medium"><CreditCard className="h-4 w-4" /> {a?.cartao_bandeira ?? "Cartão"} final {a?.cartao_final ?? "----"}</p>
              <p>Próxima cobrança: {dataBR(a?.proximo_vencimento)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setCartao(true)} data-testid="trocar-cartao">Trocar cartão</Button>
                {a?.status !== "cancelada" && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => window.confirm("Cancelar a assinatura? O acesso continua até o fim do período já pago.") && cancelar.mutate()}>Cancelar assinatura</Button>}
              </div>
            </>
          ) : <p className="text-muted-foreground">O contrato desta empresa é feito pelo comercial do SAX. Para mudar de plano ou forma de pagamento, fale com o suporte.</p>}
        </div>
      </section>

      {d.autoatendimento && a?.status !== "cancelada" && (
        <section className="grid gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Trocar de plano</h2>
            <div className="ml-auto inline-flex rounded-full border p-0.5">
              {[false, true].map((x) => <button key={String(x)} type="button" onClick={() => setAnual(x)} className={cn("rounded-full px-3 py-1 text-sm", per === x && "bg-primary text-primary-foreground")}>{x ? "Anual" : "Mensal"}</button>)}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {d.planos.map((p) => {
              const atual = p.chave === d.plano.chave && (a?.periodicidade === "anual") === per;
              const preco = per ? (p.preco_anual ?? p.preco_mensal * 12) / 12 : p.preco_mensal;
              return (
                <div key={p.chave} className={cn("flex flex-col rounded-xl border bg-card p-4", atual && "border-primary ring-2 ring-primary/20")}>
                  <p className="font-semibold">{p.nome}</p>
                  <p className="text-xs text-muted-foreground">{p.resumo}</p>
                  <p className="mt-2 text-xl font-bold">{brl(preco)}<span className="text-xs font-normal text-muted-foreground">/mês</span></p>
                  <ul className="mt-2 flex-1 space-y-1 text-xs">
                    {p.recursos.slice(0, 5).map((r) => <li key={r} className="flex gap-1"><Check className="h-3.5 w-3.5 shrink-0 text-primary" />{r}</li>)}
                  </ul>
                  <Button className="mt-3" size="sm" variant={atual ? "outline" : "default"} disabled={atual || trocar.isPending}
                    onClick={() => window.confirm(`Mudar para ${p.nome} ${per ? "anual" : "mensal"}? O novo valor vale a partir da próxima cobrança.`) && trocar.mutate({ plano: p.chave, per: per ? "anual" : "mensal" })}>
                    {atual ? "Plano atual" : "Escolher"}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {d.faturas.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-lg font-semibold">Faturas</h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card text-sm">
            {d.faturas.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-24">{dataBR(f.vencimento)}</span>
                <span className="flex-1">{STATUS_FAT[f.status] ?? f.status}{f.pago_em ? `, pago em ${dataBR(f.pago_em)}` : ""}</span>
                <span className="num">{brl(f.valor)}</span>
                {f.link && <a href={f.link} target="_blank" rel="noopener noreferrer" className="text-primary" aria-label="Abrir fatura"><ExternalLink className="h-4 w-4" /></a>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <TrocarCartao aberto={cartao} onClose={() => setCartao(false)} />
    </div>
  );
}

function TrocarCartao({ aberto, onClose }: { aberto: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [c, setC] = useState({ numero: "", nome: "", validade: "", cvv: "" });
  const salvar = useMutation({
    mutationFn: () => apiPut("/assinatura/cartao", { ...c, numero: c.numero.replace(/\D/g, "") }),
    onSuccess: () => { qc.invalidateQueries(); toast.success("Cartão atualizado"); setC({ numero: "", nome: "", validade: "", cvv: "" }); onClose(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível trocar o cartão"),
  });
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Trocar cartão</DialogTitle><DialogDescription>O número vai direto para o Asaas e não fica guardado no SAX.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="tc-num">Número</Label><Input id="tc-num" inputMode="numeric" autoComplete="cc-number" value={c.numero} onChange={(e) => setC({ ...c, numero: e.target.value.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ") })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="tc-nome">Nome impresso</Label><Input id="tc-nome" autoComplete="cc-name" value={c.nome} onChange={(e) => setC({ ...c, nome: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="tc-val">Validade</Label><Input id="tc-val" placeholder="MM/AA" inputMode="numeric" autoComplete="cc-exp" value={c.validade} onChange={(e) => { const d = e.target.value.replace(/\D/g, "").slice(0, 4); setC({ ...c, validade: d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d }); }} /></div>
            <div className="grid gap-1.5"><Label htmlFor="tc-cvv">CVV</Label><Input id="tc-cvv" inputMode="numeric" autoComplete="cc-csc" value={c.cvv} onChange={(e) => setC({ ...c, cvv: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={() => salvar.mutate()} disabled={salvar.isPending || c.numero.length < 15}>{salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar cartão</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
