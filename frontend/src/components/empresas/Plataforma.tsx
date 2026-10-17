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
    <div className="grid gap-5">
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
    <LinksPagamento configurado={d.configurado} />
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

// ------------------------------------------------------------------ links de pagamento dos planos

interface LinkPlano {
  chave: string; plano: string; plano_nome: string; segmento: string; segmento_nome: string;
  periodo: "mensal" | "anual"; forma: "cartao" | "pix"; valor: number; valor_tabela: number; url: string | null; erro: string | null;
}
interface LinksResp { links: LinkPlano[]; pendentes: number; total: number; prontos: number; parar?: boolean }

export function LinksPagamento({ configurado }: { configurado: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["plataforma-links"], queryFn: () => apiGet<LinksResp>("/plataforma/links-pagamento") });
  const [seg, setSeg] = useState("");
  const [gerando, setGerando] = useState(false);
  const copiar = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success("Link copiado"));

  // Gera em lotes: cada chamada cria até 12 links, para caber no tempo da função no Vercel.
  const gerar = async () => {
    setGerando(true);
    try {
      for (let i = 0; i < 20; i++) {
        const r = await apiPost<LinksResp>("/plataforma/links-pagamento/gerar");
        qc.setQueryData(["plataforma-links"], r);
        if (!r.pendentes || r.parar) {
          if (r.parar) toast.error("Alguns links foram recusados pelo Asaas. Veja o motivo na lista.");
          else toast.success(`${r.prontos} links prontos no Asaas`);
          break;
        }
      }
    } catch (e) {
      toast.error(detalheErro(e) ?? "Não foi possível gerar os links");
    } finally {
      setGerando(false);
      qc.invalidateQueries({ queryKey: ["plataforma-links"] });
    }
  };

  const d = q.data;
  const segmentos = [...new Map((d?.links ?? []).map((l) => [l.segmento, l.segmento_nome])).entries()];
  const linhas = (d?.links ?? []).filter((l) => !seg || l.segmento === seg);
  // Uma linha por plano e período, com cartão e Pix lado a lado.
  const grupos = [...linhas.reduce((m, l) => {
    const k = `${l.plano}:${l.periodo}`;
    m.set(k, { ...(m.get(k) ?? { base: l }), [l.forma]: l });
    return m;
  }, new Map<string, { base: LinkPlano; cartao?: LinkPlano; pix?: LinkPlano }>()).values()];

  const baixar = () => {
    const cab = "Segmento;Plano;Período;Forma;Valor;Link";
    const corpo = (d?.links ?? []).filter((l) => l.url).map((l) => [l.segmento_nome, l.plano_nome, l.periodo === "mensal" ? "Mensal" : "Anual",
      l.forma === "pix" ? "Pix 10% off" : "Cartão", l.valor.toFixed(2).replace(".", ","), l.url].join(";"));
    const blob = new Blob(["﻿" + [cab, ...corpo].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "links-pagamento-sax.csv"; a.click(); URL.revokeObjectURL(a.href);
  };

  const Celula = ({ l }: { l?: LinkPlano }) => !l ? <td /> : (
    <td className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="num w-24 text-right font-medium">{brl(l.valor)}</span>
        {l.url ? (
          <>
            <button type="button" onClick={() => copiar(l.url!)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted" aria-label={`Copiar link ${l.forma}`}><Copy className="h-3.5 w-3.5" /> Copiar</button>
            <a href={l.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Abrir</a>
          </>
        ) : l.erro ? <span className="text-xs text-destructive" title={l.erro}><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{l.erro}</span>
          : <span className="text-xs text-muted-foreground">não gerado</span>}
      </div>
    </td>
  );

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-5" data-testid="links-pagamento">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="font-semibold">Links de pagamento dos planos</h3>
          <p className="text-sm text-muted-foreground">Um link por plano, mensal e anual: cartão de crédito no preço da tabela, cobrado sozinho a cada ciclo, e Pix com 10% de desconto, com uma nova cobrança Pix a cada ciclo. Use para vender pelo WhatsApp.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={gerar} disabled={!configurado || gerando} data-testid="gerar-links">
            {gerando && <Loader2 className="h-4 w-4 animate-spin" />} {d?.prontos ? "Atualizar links no Asaas" : "Gerar links no Asaas"}
          </Button>
          <Button variant="outline" onClick={baixar} disabled={!d?.prontos}>Baixar planilha</Button>
        </div>
      </div>
      <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        Quem paga pelo link não ganha conta no CRM sozinho. Ao receber o pagamento no Asaas, crie a empresa em Empresas. Mudou o preço de um plano? Clique em atualizar: o link antigo sai do Asaas e um novo é criado.
      </p>
      {!configurado && <p className="text-sm text-muted-foreground">Salve a chave do Asaas acima para gerar os links.</p>}
      {d && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span><b className="num">{d.prontos}</b> de <b className="num">{d.total}</b> links prontos{d.pendentes ? `, ${d.pendentes} para criar ou atualizar` : ""}</span>
            <select aria-label="Segmento" value={seg} onChange={(e) => setSeg(e.target.value)} className="ml-auto h-8 rounded-lg border bg-transparent px-2 text-sm">
              <option value="">Todos os segmentos</option>
              {segmentos.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2">Plano</th><th className="px-3 py-2">Período</th><th className="px-3 py-2">Cartão de crédito</th><th className="px-3 py-2">Pix (10% off)</th></tr>
              </thead>
              <tbody className="divide-y">
                {grupos.map(({ base, cartao, pix }) => (
                  <tr key={`${base.plano}:${base.periodo}`}>
                    <td className="px-3 py-2"><p className="font-medium">{base.plano_nome}</p><p className="text-xs text-muted-foreground">{base.segmento_nome}</p></td>
                    <td className="px-3 py-2">{base.periodo === "mensal" ? "Mensal" : "Anual"}</td>
                    <Celula l={cartao} />
                    <Celula l={pix} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

interface Contratada { razao_social: string; cnpj: string; endereco: string; cidade_uf: string; email: string; configurada: boolean; versao: string; aceites: number }

/** Dados da SAX que entram no termo de adesão. Sem eles o termo não é exigido no primeiro acesso. */
export function DadosContratada() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["contratada"], queryFn: () => apiGet<Contratada>("/plataforma/contratada") });
  const [f, setF] = useState<Partial<Contratada> | null>(null);
  const v = f ?? q.data ?? {};
  const salvar = useMutation({
    mutationFn: () => apiPut("/plataforma/contratada", { razao_social: v.razao_social, cnpj: v.cnpj, endereco: v.endereco, cidade_uf: v.cidade_uf, email: v.email }),
    onSuccess: () => { toast.success("Dados salvos. O termo passa a ser pedido no primeiro acesso de cada gestor."); setF(null); qc.invalidateQueries({ queryKey: ["contratada"] }); qc.invalidateQueries({ queryKey: ["empresas"] }); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  const campo = (k: keyof Contratada, rotulo: string, dica?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`ct-${k}`}>{rotulo}</Label>
      <Input id={`ct-${k}`} value={String(v[k] ?? "")} placeholder={dica} onChange={(e) => setF({ ...v, [k]: e.target.value })} data-testid={`contratada-${k}`} />
    </div>
  );
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4 sm:p-5" data-testid="dados-contratada">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Termo de adesão</h2>
          <p className="text-sm text-muted-foreground">
            Dados da SAX que aparecem no contrato. Com eles preenchidos, o gestor de cada empresa aceita o termo no primeiro acesso.
            Em cada empresa você vê a data do aceite e baixa o comprovante em PDF.
          </p>
        </div>
        <a href="/termos" target="_blank" rel="noreferrer" className="text-sm font-medium text-primary underline">Ver o termo (versão {q.data?.versao ?? ""})</a>
      </div>
      {q.data && (q.data.configurada
        ? <p className="flex items-center gap-1.5 text-sm text-emerald-700"><ShieldCheck className="h-4 w-4" /> Ativo. {q.data.aceites} empresa(s) já aceitaram a versão {q.data.versao}.</p>
        : <p className="flex items-center gap-1.5 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" /> Desligado até você preencher todos os campos.</p>)}
      <div className="grid gap-3 sm:grid-cols-2">
        {campo("razao_social", "Razão social", "Nome da empresa no CNPJ")}
        {campo("cnpj", "CNPJ")}
        {campo("endereco", "Endereço da sede", "Rua, número, bairro, cidade/UF, CEP")}
        {campo("cidade_uf", "Comarca do foro", "Ex.: Curitiba/PR")}
        {campo("email", "E-mail para cancelamento e suporte")}
      </div>
      <div><Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !f} data-testid="contratada-salvar">{salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</Button></div>
    </section>
  );
}

interface PainelDominios {
  configurado: boolean; por_env: boolean; projeto: string; time: string; token_mascarado: string | null;
  dominios: { dominio: string; empresa: string; status: string }[];
}
const STATUS_DOM: Record<string, string> = { ativo: "Funcionando", aguardando_dns: "Esperando DNS do cliente", aguardando_ativacao: "Falta ativar no Vercel", nao_cadastrado: "Falta ativar no Vercel", erro: "Erro ao verificar", aguardando: "Aguardando" };

/** Token do Vercel para ativar sozinho o domínio próprio dos clientes, e a lista de domínios. */
export function DominiosClientes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["dominios-plataforma"], queryFn: () => apiGet<PainelDominios>("/plataforma/dominios") });
  const [f, setF] = useState<{ token: string; projeto: string; time: string } | null>(null);
  const v = f ?? { token: "", projeto: q.data?.projeto || "sax-crm", time: q.data?.time ?? "" };
  const salvar = useMutation({
    mutationFn: () => apiPut<PainelDominios>("/plataforma/dominios", { token: v.token || null, projeto: v.projeto, time: v.time }),
    onSuccess: (r) => { qc.setQueryData(["dominios-plataforma"], r); setF(null); toast.success("Vercel conectado. Os próximos domínios entram sozinhos."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  const d = q.data;
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4 sm:p-5" data-testid="dominios-clientes">
      <div>
        <h2 className="font-semibold">Domínios dos clientes</h2>
        <p className="text-sm text-muted-foreground">
          Com o token do Vercel, o domínio que o cliente liga em Meu site é cadastrado sozinho no projeto e ganha HTTPS. Sem o token, ele aparece aqui para você cadastrar à mão no Vercel (Settings, Domains).
        </p>
      </div>
      {d && (d.configurado
        ? <p className="flex items-center gap-1.5 text-sm text-emerald-700"><ShieldCheck className="h-4 w-4" /> Vercel conectado{d.token_mascarado ? ` (token ${d.token_mascarado})` : ""}, projeto {d.projeto}.</p>
        : <p className="flex items-center gap-1.5 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" /> Ativação automática desligada.</p>)}
      {!d?.por_env && (
        <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}>
          <div className="grid gap-1.5"><Label htmlFor="vc-token">Token do Vercel</Label>
            <Input id="vc-token" type="password" autoComplete="off" value={v.token} placeholder={d?.token_mascarado ? "Manter o atual" : "Cole o token"} onChange={(e) => setF({ ...v, token: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="vc-proj">Projeto do CRM no Vercel</Label>
            <Input id="vc-proj" value={v.projeto} onChange={(e) => setF({ ...v, projeto: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="vc-time">ID do time (se houver)</Label>
            <Input id="vc-time" value={v.time} placeholder="team_..." onChange={(e) => setF({ ...v, time: e.target.value })} /></div>
          <div className="sm:col-span-3"><Button type="submit" disabled={salvar.isPending || !f}>{salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar e testar</Button></div>
        </form>
      )}
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Domínio</th><th className="px-3 py-2 font-medium">Empresa</th><th className="px-3 py-2 font-medium">Situação</th></tr></thead>
          <tbody className="divide-y">
            {(d?.dominios ?? []).length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">Nenhum cliente ligou domínio ainda.</td></tr>}
            {(d?.dominios ?? []).map((x) => (
              <tr key={x.dominio}><td className="px-3 py-2 font-mono text-xs">{x.dominio}</td><td className="px-3 py-2">{x.empresa}</td>
                <td className={cn("px-3 py-2 text-xs font-medium", x.status === "ativo" ? "text-emerald-700" : "text-amber-700")}>{STATUS_DOM[x.status] ?? x.status}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface ServidorWa { configurado: boolean; por_env: boolean; url: string; chave_mascarada: string | null; numeros: number }

/** Servidor da Evolution API que segura as conexões de WhatsApp de todos os clientes. */
export function ServidorWhatsApp() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["wa-servidor"], queryFn: () => apiGet<ServidorWa>("/plataforma/whatsapp") });
  const [f, setF] = useState<{ url: string; apikey: string } | null>(null);
  const v = f ?? { url: q.data?.url ?? "", apikey: "" };
  const salvar = useMutation({
    mutationFn: () => apiPut<ServidorWa>("/plataforma/whatsapp", { url: v.url.trim(), apikey: v.apikey.trim() || null }),
    onSuccess: (r) => { qc.setQueryData(["wa-servidor"], r); setF(null); toast.success("Servidor do WhatsApp conectado."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  const d = q.data;
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4 sm:p-5" data-testid="servidor-whatsapp">
      <div>
        <h2 className="font-semibold">Servidor do WhatsApp</h2>
        <p className="text-sm text-muted-foreground">
          Endereço e chave da Evolution API, que mantém conectados os números de WhatsApp dos clientes. O CRM testa a conexão ao salvar.
        </p>
      </div>
      {d && (d.configurado
        ? <p className="flex items-center gap-1.5 text-sm text-emerald-700"><ShieldCheck className="h-4 w-4" /> Conectado em {d.url}{d.chave_mascarada ? ` (chave ${d.chave_mascarada})` : ""}. {d.numeros} número(s) de clientes.</p>
        : <p className="flex items-center gap-1.5 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" /> Sem servidor: os clientes veem o WhatsApp como em preparação.</p>)}
      {!d?.por_env && (
        <form className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}>
          <div className="grid gap-1.5"><Label htmlFor="evo-url">Endereço do servidor</Label>
            <Input id="evo-url" value={v.url} placeholder="https://whatsapp.seudominio.com.br" onChange={(e) => setF({ ...v, url: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="evo-key">Chave (apikey)</Label>
            <Input id="evo-key" type="password" autoComplete="off" value={v.apikey} placeholder={d?.chave_mascarada ? "Manter a atual" : "AUTHENTICATION_API_KEY"} onChange={(e) => setF({ ...v, apikey: e.target.value })} /></div>
          <Button type="submit" disabled={salvar.isPending || !f || v.url.length < 8}>{salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar e testar</Button>
        </form>
      )}
    </section>
  );
}

interface AppOlx { configurado: boolean; por_env: boolean; client_id: string | null; segredo_mascarado: string | null; redirect_uri: string; lojas_conectadas: number }

/** Aplicativo da SAX na OLX (client_id e client_secret enviados pelo suporte de integração da OLX). */
export function AplicativoOlx() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["olx-app"], queryFn: () => apiGet<AppOlx>("/plataforma/olx") });
  const [f, setF] = useState<{ client_id: string; client_secret: string } | null>(null);
  const v = f ?? { client_id: q.data?.client_id ?? "", client_secret: "" };
  const salvar = useMutation({
    mutationFn: () => apiPut<AppOlx>("/plataforma/olx", { client_id: v.client_id.trim(), client_secret: v.client_secret.trim() || null }),
    onSuccess: (r) => { qc.setQueryData(["olx-app"], r); setF(null); toast.success("Aplicativo da OLX salvo."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  const d = q.data;
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4 sm:p-5" data-testid="aplicativo-olx">
      <div>
        <h2 className="font-semibold">OLX (lojas de veículos)</h2>
        <p className="text-sm text-muted-foreground">
          Peça o cadastro do aplicativo ao suporte de integração da OLX (suporteintegrador@olxbr.com) informando a URL de retorno abaixo.
          Com o client_id e a chave secreta salvos aqui, cada loja conecta a própria conta profissional da OLX.
        </p>
      </div>
      {d && (
        <div className="grid gap-1 text-sm">
          <p>URL de retorno para a OLX: <code className="break-all rounded bg-muted px-1">{d.redirect_uri}</code></p>
          {d.configurado
            ? <p className="flex items-center gap-1.5 text-emerald-700"><ShieldCheck className="h-4 w-4" /> Aplicativo {d.client_id}{d.segredo_mascarado ? ` (chave ${d.segredo_mascarado})` : ""}. {d.lojas_conectadas} loja(s) conectada(s).</p>
            : <p className="flex items-center gap-1.5 text-amber-700"><AlertTriangle className="h-4 w-4" /> Sem aplicativo: as lojas veem a OLX como em liberação.</p>}
        </div>
      )}
      {!d?.por_env && (
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}>
          <div className="grid gap-1.5"><Label htmlFor="olx-cid">client_id</Label>
            <Input id="olx-cid" value={v.client_id} onChange={(e) => setF({ ...v, client_id: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="olx-sec">Chave secreta (client_secret)</Label>
            <Input id="olx-sec" type="password" autoComplete="off" value={v.client_secret} placeholder={d?.segredo_mascarado ? "Manter a atual" : ""} onChange={(e) => setF({ ...v, client_secret: e.target.value })} /></div>
          <Button type="submit" disabled={salvar.isPending || !f || v.client_id.trim().length < 3}>{salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</Button>
        </form>
      )}
    </section>
  );
}
