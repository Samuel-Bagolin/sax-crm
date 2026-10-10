import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Copy, Eye, EyeOff, KeyRound, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface SegPainel {
  segmento: string;
  nome: string;
  categoria: string;
  ativas: number;
  pagantes: number;
  demonstracao: number;
  atrasadas: number;
  bloqueadas: number;
  inativas: number;
  mrr: number;
  novas_30d: number;
}
interface Painel {
  categorias: { categoria: string; nome: string; segmentos: SegPainel[]; ativas: number; mrr: number }[];
  total_ativas: number;
  mrr_total: number;
  cadastros_com_problema: { protocolo: string; email: string; status: string; segmento: string; em: string }[];
}

/** Quantas empresas ativas por categoria e segmento, quantas pagando, em demonstração e em atraso. */
export function PainelSegmentos({ onFiltrar }: { onFiltrar?: (segmento: string) => void }) {
  const q = useQuery({ queryKey: ["plataforma-painel"], queryFn: () => apiGet<Painel>("/plataforma/painel") });
  if (!q.data) return <div className="h-48 animate-pulse rounded-xl bg-muted" />;
  const d = q.data;
  return (
    <div className="grid gap-5" data-testid="painel-segmentos">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Bloco rotulo="Empresas ativas" valor={String(d.total_ativas)} />
        <Bloco rotulo="Receita mensal recorrente" valor={brl(d.mrr_total)} detalhe="sem contas de demonstração" />
        {d.categorias.slice(0, 2).map((c) => <Bloco key={c.categoria} rotulo={c.nome} valor={`${c.ativas} ativas`} detalhe={brl(c.mrr) + " por mês"} />)}
      </div>
      {d.cadastros_com_problema.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Cadastros que cobraram e não terminaram</p>
          <ul className="mt-1 list-inside list-disc">
            {d.cadastros_com_problema.map((c) => <li key={c.protocolo}>Protocolo {c.protocolo}, {c.email}, {c.segmento}: {c.status === "pago_sem_conta" ? "confira no Asaas e estorne ou crie a conta" : "assinatura cancelada automaticamente"}</li>)}
          </ul>
        </div>
      )}
      {d.categorias.map((c) => (
        <section key={c.categoria} className="grid gap-2">
          <div className="flex items-baseline gap-3">
            <h3 className="font-heading text-lg font-bold">{c.nome}</h3>
            <span className="text-sm text-muted-foreground">{c.ativas} ativas, {brl(c.mrr)}/mês</span>
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Segmento</th>
                  <th className="px-3 py-2 text-right font-medium">Ativas</th>
                  <th className="px-3 py-2 text-right font-medium">Pagando</th>
                  <th className="px-3 py-2 text-right font-medium">Demonstração</th>
                  <th className="px-3 py-2 text-right font-medium">Em atraso</th>
                  <th className="px-3 py-2 text-right font-medium">Bloqueadas</th>
                  <th className="px-3 py-2 text-right font-medium">Novas 30 dias</th>
                  <th className="px-4 py-2 text-right font-medium">Receita/mês</th>
                </tr>
              </thead>
              <tbody>
                {c.segmentos.map((s) => (
                  <tr key={s.segmento} className="border-b last:border-0 hover:bg-accent/30">
                    <td className="px-4 py-2.5">
                      {onFiltrar ? <button type="button" className="font-medium hover:underline" onClick={() => onFiltrar(s.segmento)}>{s.nome}</button> : s.nome}
                    </td>
                    <td className="num px-3 text-right font-semibold">{s.ativas}</td>
                    <td className="num px-3 text-right">{s.pagantes}</td>
                    <td className="num px-3 text-right">{s.demonstracao}</td>
                    <td className={cn("num px-3 text-right", s.atrasadas && "font-semibold text-amber-600")}>{s.atrasadas}</td>
                    <td className={cn("num px-3 text-right", s.bloqueadas && "font-semibold text-red-600")}>{s.bloqueadas}</td>
                    <td className="num px-3 text-right">{s.novas_30d}</td>
                    <td className="num px-4 text-right font-semibold">{brl(s.mrr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function Bloco({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="num mt-1 text-xl font-bold sm:text-2xl">{valor}</p>
      {detalhe && <p className="text-[11px] text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

interface Pagamentos {
  configurado: boolean;
  chave_mascarada: string | null;
  chave_por_env: boolean;
  ambiente: "sandbox" | "producao";
  webhook_url: string;
  webhook_token: string;
  cartao_demo: string | null;
  cartao_demo_ativo: boolean;
}

/** Chave do Asaas, webhook e cartão de demonstração (só o Administrador de Sistema vê). */
export function ConfigPagamentos() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["plataforma-pagamentos"], queryFn: () => apiGet<Pagamentos>("/plataforma/pagamentos") });
  const [chave, setChave] = useState("");
  const [ambiente, setAmbiente] = useState<string | null>(null);
  const [ver, setVer] = useState(false);
  const atualizar = (r: Pagamentos) => qc.setQueryData(["plataforma-pagamentos"], r);
  const salvar = useMutation({
    mutationFn: () => apiPut<Pagamentos>("/plataforma/pagamentos", { asaas_api_key: chave || null, ambiente: ambiente ?? q.data?.ambiente }),
    onSuccess: (r) => { atualizar(r); setChave(""); toast.success("Pagamentos salvos"); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  const testar = useMutation({
    mutationFn: () => apiPost<{ saldo: number }>("/plataforma/pagamentos/testar"),
    onSuccess: (r) => toast.success(`Conexão com o Asaas ok. Saldo: ${brl(r.saldo ?? 0)}`),
    onError: (e) => toast.error(detalheErro(e) ?? "Falha ao conectar"),
  });
  const gerar = useMutation({ mutationFn: () => apiPost<Pagamentos>("/plataforma/cartao-demo"), onSuccess: (r) => { atualizar(r); setVer(true); toast.success("Novo cartão de demonstração gerado. O anterior parou de funcionar."); } });
  const ativar = useMutation({ mutationFn: (a: boolean) => apiPut<Pagamentos>(`/plataforma/cartao-demo?ativo=${a}`), onSuccess: atualizar });
  if (!q.data) return <div className="h-48 animate-pulse rounded-xl bg-muted" />;
  const d = q.data;
  const copiar = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success("Copiado"));
  const numeroFmt = d.cartao_demo?.replace(/(\d{4})(?=\d)/g, "$1 ");
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="grid h-fit gap-4 rounded-xl border bg-card p-5">
        <div>
          <h3 className="font-semibold">Asaas</h3>
          <p className="text-sm text-muted-foreground">Cobra a assinatura no cartão quando o cliente se cadastra pelo site. A chave fica guardada só no servidor.</p>
        </div>
        <p className={cn("inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", d.configurado ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200")}>
          <ShieldCheck className="h-3.5 w-3.5" /> {d.configurado ? `Conectado (${d.ambiente === "producao" ? "produção" : "sandbox"}), chave ${d.chave_mascarada}` : "Sem chave: o cadastro só aceita o cartão de demonstração"}
        </p>
        {d.chave_por_env ? <p className="text-sm text-muted-foreground">A chave vem da variável ASAAS_API_KEY do Vercel.</p> : (
          <div className="grid gap-1.5">
            <Label htmlFor="as-chave">Chave de API do Asaas</Label>
            <Input id="as-chave" type="password" autoComplete="off" value={chave} onChange={(e) => setChave(e.target.value)} placeholder={d.configurado ? "Deixe em branco para manter a atual" : "$aact_..."} />
            <p className="text-xs text-muted-foreground">No Asaas: Integrações, Chaves de API. Cole aqui, nunca em chat ou e-mail.</p>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="as-amb">Ambiente</Label>
          <select id="as-amb" className="h-9 w-48 rounded-lg border bg-transparent px-2 text-sm" value={ambiente ?? d.ambiente} onChange={(e) => setAmbiente(e.target.value)}>
            <option value="sandbox">Sandbox (testes)</option>
            <option value="producao">Produção</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>Salvar</Button>
          <Button variant="outline" onClick={() => testar.mutate()} disabled={!d.configurado || testar.isPending}>{testar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Testar conexão</Button>
        </div>
        <div className="grid gap-2 rounded-lg bg-muted/40 p-3 text-sm">
          <p className="font-medium">Webhook (configure no Asaas, em Integrações, Webhooks)</p>
          <Linha rotulo="URL" valor={d.webhook_url} copiar={copiar} />
          <Linha rotulo="Token de autenticação" valor={d.webhook_token} copiar={copiar} secreto />
          <p className="text-xs text-muted-foreground">Marque os eventos de cobrança e de assinatura. Sem o webhook, atrasos e pagamentos não atualizam sozinhos.</p>
        </div>
      </section>

      <section className="grid h-fit gap-4 rounded-xl border bg-card p-5" data-testid="cartao-demo">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" /> Cartão de demonstração</h3>
          <p className="text-sm text-muted-foreground">Use no cadastro público para criar uma conta paga de qualquer segmento sem cobrança. A conta fica marcada como demonstração e não entra na receita. Só você vê este número.</p>
        </div>
        {d.cartao_demo ? (
          <>
            <div className="rounded-xl bg-gradient-to-br from-[#140634] to-[#4a03a2] p-5 text-white shadow-lg">
              <p className="text-xs uppercase tracking-wider text-white/60">SAX demonstração</p>
              <p className="mt-6 font-mono text-xl tracking-widest">{ver ? numeroFmt : "•••• •••• •••• " + d.cartao_demo.slice(-4)}</p>
              <p className="mt-4 text-xs text-white/70">Validade: qualquer data futura. CVV: qualquer número de 3 dígitos.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setVer(!ver)}>{ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {ver ? "Ocultar" : "Mostrar"}</Button>
              <Button variant="outline" size="sm" onClick={() => copiar(d.cartao_demo!)}><Copy className="h-4 w-4" /> Copiar</Button>
              <Button variant="outline" size="sm" onClick={() => window.confirm("Gerar um novo número? O atual para de funcionar na hora.") && gerar.mutate()}><RefreshCw className="h-4 w-4" /> Trocar número</Button>
              <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={d.cartao_demo_ativo} onChange={(e) => ativar.mutate(e.target.checked)} className="accent-[var(--primary)]" /> Ativo</label>
            </div>
            <p className="text-xs text-muted-foreground">Se o número vazar, troque aqui. Contas já criadas continuam marcadas como demonstração no painel.</p>
          </>
        ) : <Button className="w-fit" onClick={() => gerar.mutate()} disabled={gerar.isPending} data-testid="gerar-cartao-demo">Gerar cartão de demonstração</Button>}
      </section>
    </div>
  );
}

function Linha({ rotulo, valor, copiar, secreto }: { rotulo: string; valor: string; copiar: (t: string) => void; secreto?: boolean }) {
  const [ver, setVer] = useState(!secreto);
  return (
    <div className="flex items-center gap-2">
      <span className="w-40 shrink-0 text-xs text-muted-foreground">{rotulo}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs">{ver ? valor : "•".repeat(24)}</code>
      {secreto && <button type="button" onClick={() => setVer(!ver)} aria-label={ver ? "Ocultar" : "Mostrar"}>{ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>}
      <button type="button" onClick={() => copiar(valor)} aria-label={`Copiar ${rotulo}`}><Copy className="h-4 w-4" /></button>
    </div>
  );
}
