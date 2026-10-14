import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Gift, Loader2, Plus, Receipt, Search, Settings2, Undo2, Users } from "lucide-react";
import { apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { dataCurta, linkWhatsapp } from "@/lib/crm";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/* Programa de indicação com cashback: vale em todas as lojas da empresa. */

interface Config {
  ativo: boolean; pct_indicacao: number; compras_indicacao: number; pct_compra: number;
  validade_dias: number; max_pct_uso: number; autocadastro_site: boolean;
}
interface Ficha {
  id: string; nome: string; telefone: string | null; codigo: string | null; saldo: number; a_vencer_30d: number;
  proximo_vencimento: string | null; indicado_por: { id: string; nome: string | null; codigo: string | null } | null;
}
interface Afiliado extends Ficha { indicados: number; vendas: number; desde: string | null }
interface Resumo {
  config: Config; saldo_em_aberto: number; gerado_30d: number; usado_30d: number; compras_30d: number; vendas_30d: number;
  vendas_indicadas_30d: number; afiliados: number; top: { pessoa_id: string; nome: string; codigo: string; vendas: number; ganho: number }[];
}
interface Compra {
  id: string; cliente_id: string; cliente_nome: string; unidade_nome: string | null; valor: number; cashback_usado: number; valor_pago: number;
  afiliado_id: string | null; afiliado_nome?: string | null; creditos: { pessoa_id: string; valor: number; origem: string }[];
  estornada: boolean; data: string; por: string; descricao: string | null; avisos?: string[];
}
interface Movimento { id: string; tipo: string; origem: string; valor: number; restante?: number; validade?: string; descricao: string; created_at: string; estornado?: boolean }
interface Extrato extends Ficha { link: string | null; movimentos: Movimento[]; indicados: { id: string; nome: string }[]; compras: Compra[] }
interface Loja { id: string; nome: string; ativa: boolean; principal: boolean }

type Aba = "compra" | "afiliados" | "compras" | "config";

export default function Cashback() {
  const { isAdmin } = useAuth();
  const [aba, setAba] = useState<Aba>("compra");
  const [ficha, setFicha] = useState<string | null>(null);
  const resumo = useQuery({ queryKey: ["cashback", "resumo"], queryFn: () => apiGet<Resumo>("/cashback/resumo") });
  const r = resumo.data;
  const ativo = !!r?.config.ativo;

  useEffect(() => { if (r && !r.config.ativo && isAdmin) setAba("config"); }, [r?.config.ativo, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const abas: [Aba, string][] = [["compra", "Registrar compra"], ["afiliados", "Afiliados"], ["compras", "Compras"], ...(isAdmin ? [["config", "Configurar"] as [Aba, string]] : [])];
  return (
    <div className="space-y-6" data-testid="cashback-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">Afiliados e cashback</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {r ? (ativo
              ? `Quem indica ganha ${r.config.pct_indicacao}%${r.config.compras_indicacao ? ` nas ${r.config.compras_indicacao} primeiras compras do indicado` : " em todas as compras do indicado"}${r.config.pct_compra ? `, e todo cliente acumula ${r.config.pct_compra}%` : ""}. Vale em todas as lojas.`
              : "Programa desligado.") : "Carregando..."}
          </p>
        </div>
      </div>

      {r && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Cashback em aberto", brl(r.saldo_em_aberto), "saldo dos clientes para usar"],
            ["Vendas indicadas (30 dias)", brl(r.vendas_indicadas_30d), `de ${brl(r.vendas_30d)} em ${r.compras_30d} compra(s)`],
            ["Gerado / usado (30 dias)", `${brl(r.gerado_30d)} / ${brl(r.usado_30d)}`, "crédito dado e crédito resgatado"],
            ["Afiliados", String(r.afiliados), r.top[0]?.vendas ? `destaque: ${r.top[0].nome}` : "clientes com código"],
          ].map(([t, v, d]) => (
            <div key={t} className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">{t}</p>
              <p className="mt-1 text-lg font-bold">{v}</p>
              <p className="text-xs text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex w-fit max-w-full overflow-x-auto rounded-lg bg-muted p-1" role="tablist" aria-label="Seções">
        {abas.map(([v, rot]) => (
          <button key={v} role="tab" aria-selected={aba === v} onClick={() => setAba(v)} data-testid={`cb-aba-${v}`}
            className={cn("whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium", aba === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {rot}
          </button>
        ))}
      </div>

      {aba === "compra" && (ativo ? <RegistrarCompra config={r!.config} onFicha={setFicha} /> : <Desligado admin={isAdmin} onConfig={() => setAba("config")} />)}
      {aba === "afiliados" && <Afiliados onFicha={setFicha} />}
      {aba === "compras" && <Compras admin={isAdmin} onFicha={setFicha} />}
      {aba === "config" && isAdmin && r && <Configurar inicial={r.config} />}
      {ficha && <FichaCliente id={ficha} onClose={() => setFicha(null)} />}
    </div>
  );
}

function Desligado({ admin, onConfig }: { admin: boolean; onConfig: () => void }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      <Gift className="mx-auto mb-2 h-6 w-6" />
      O programa de cashback está desligado.{" "}
      {admin ? <button className="font-medium text-primary underline" onClick={onConfig}>Configurar e ligar</button> : "Peça ao gestor para ligar."}
    </div>
  );
}

function useBusca(q: string) {
  const [termo, setTermo] = useState(q);
  useEffect(() => { const t = setTimeout(() => setTermo(q), 250); return () => clearTimeout(t); }, [q]);
  return useQuery({ queryKey: ["cashback", "busca", termo], queryFn: () => apiGet<Ficha[]>(`/cashback/clientes?q=${encodeURIComponent(termo)}`), enabled: termo.trim().length >= 2 });
}

function RegistrarCompra({ config, onFicha }: { config: Config; onFicha: (id: string) => void }) {
  const qc = useQueryClient();
  const lojas = useQuery({ queryKey: ["unidades"], queryFn: () => apiGet<Loja[]>("/unidades") });
  const [q, setQ] = useState("");
  const busca = useBusca(q);
  const [cliente, setCliente] = useState<Ficha | null>(null);
  const [novo, setNovo] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [loja, setLoja] = useState("");
  const [valor, setValor] = useState("");
  const [usar, setUsar] = useState("");
  const [codigo, setCodigo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [ultima, setUltima] = useState<Compra | null>(null);
  const ativas = (lojas.data ?? []).filter((l) => l.ativa !== false);
  useEffect(() => { if (!loja && ativas.length === 1) setLoja(ativas[0].id); }, [ativas.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = Number(valor.replace(/\./g, "").replace(",", ".")) || 0;
  const u = Number(usar.replace(/\./g, "").replace(",", ".")) || 0;
  const teto = cliente ? Math.min(cliente.saldo, Math.round(v * config.max_pct_uso) / 100) : 0;
  const pago = Math.max(0, v - u);
  const vaiIndicar = !!codigo.trim() && !cliente?.indicado_por;

  const salvar = useMutation({
    mutationFn: () => apiPost<Compra & { cliente: Ficha }>("/cashback/compras", {
      cliente_id: cliente?.id ?? null, nome: cliente ? null : nome, telefone: cliente ? null : telefone, unidade_id: loja || null,
      valor: v, usar_cashback: u, codigo_indicacao: codigo.trim() || null, descricao: descricao.trim() || null,
    }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["cashback"] });
      setUltima(c);
      (c.avisos ?? []).forEach((a) => toast.warning(a));
      toast.success("Compra registrada.");
      setCliente(null); setNovo(false); setNome(""); setTelefone(""); setValor(""); setUsar(""); setCodigo(""); setDescricao(""); setQ("");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível registrar."),
  });
  const podeSalvar = v > 0 && (cliente || (nome.trim().length >= 2 && telefone.replace(/\D/g, "").length >= 10)) && u <= teto + 0.001 && !salvar.isPending;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <form className="grid gap-4 rounded-xl border bg-card p-5" onSubmit={(e) => { e.preventDefault(); if (podeSalvar) salvar.mutate(); }} data-testid="cb-form-compra">
        <div className="grid gap-1.5">
          <Label>Cliente</Label>
          {cliente ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{cliente.nome}</p>
                <p className="text-xs text-muted-foreground">
                  Saldo {brl(cliente.saldo)}{cliente.codigo ? ` · código ${cliente.codigo}` : ""}{cliente.indicado_por ? ` · indicado por ${cliente.indicado_por.nome}` : ""}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCliente(null)}>Trocar</Button>
            </div>
          ) : novo ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Nome do cliente" />
              <Input placeholder="WhatsApp com DDD" value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" aria-label="WhatsApp do cliente" />
              <button type="button" className="text-left text-xs text-primary underline sm:col-span-2" onClick={() => setNovo(false)}>Buscar cliente cadastrado</button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Nome, WhatsApp ou código (ANA-7K2)" value={q} onChange={(e) => setQ(e.target.value)} data-testid="cb-busca" aria-label="Buscar cliente" />
              {q.trim().length >= 2 && (
                <div className="mt-1 overflow-hidden rounded-lg border bg-popover shadow-sm">
                  {(busca.data ?? []).map((f) => (
                    <button key={f.id} type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setCliente(f); setQ(""); }}>
                      <span className="truncate">{f.nome}<span className="ml-2 text-xs text-muted-foreground">{f.telefone}</span></span>
                      <span className="shrink-0 text-xs font-medium">{brl(f.saldo)}</span>
                    </button>
                  ))}
                  {busca.data && !busca.data.length && <p className="px-3 py-2 text-sm text-muted-foreground">Ninguém encontrado.</p>}
                  <button type="button" className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm text-primary hover:bg-muted" onClick={() => setNovo(true)}>
                    <Plus className="h-4 w-4" /> Cliente novo
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cb-loja">Loja</Label>
            <select id="cb-loja" value={loja} onChange={(e) => setLoja(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">Sem loja</option>
              {ativas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cb-valor">Valor da compra (R$)</Label>
            <Input id="cb-valor" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" data-testid="cb-valor" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cb-usar">Usar cashback (R$)</Label>
            <Input id="cb-usar" value={usar} onChange={(e) => setUsar(e.target.value)} inputMode="decimal" placeholder="0,00" disabled={!cliente || cliente.saldo <= 0} data-testid="cb-usar" />
            {cliente && cliente.saldo > 0 && (
              <button type="button" className="text-left text-xs text-primary underline" onClick={() => setUsar(teto.toFixed(2).replace(".", ","))}>
                Usar o máximo: {brl(teto)} (até {config.max_pct_uso}% da compra)
              </button>
            )}
            {u > teto + 0.001 && <p className="text-xs text-destructive">Máximo nesta compra: {brl(teto)}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cb-codigo">Código de indicação</Label>
            <Input id="cb-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="Ex.: ANA-7K2" disabled={!!cliente?.indicado_por} data-testid="cb-codigo" />
            <p className="text-xs text-muted-foreground">{cliente?.indicado_por ? "Este cliente já tem quem indicou." : "Só na primeira compra do cliente. Vem na mensagem do WhatsApp quando ele chega pelo link."}</p>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cb-desc">Observação (opcional)</Label>
          <Input id="cb-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={200} placeholder="Ex.: pedido 1234, 2 pudins inteiros" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3 text-sm">
          <span>Cliente paga <b>{brl(pago)}</b>{config.pct_compra > 0 && <> e acumula <b>{brl(pago * config.pct_compra / 100)}</b></>}
            {(cliente?.indicado_por || vaiIndicar) && config.pct_indicacao > 0 && <>; quem indicou pode ganhar <b>{brl(pago * config.pct_indicacao / 100)}</b></>}</span>
          <Button type="submit" disabled={!podeSalvar} data-testid="cb-salvar">{salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Registrar compra</Button>
        </div>
      </form>

      <div className="grid content-start gap-4">
        {ultima && (
          <div className="rounded-xl border bg-card p-5 text-sm" data-testid="cb-ultima">
            <p className="flex items-center gap-2 font-semibold"><Receipt className="h-4 w-4" /> Última compra</p>
            <p className="mt-2">{ultima.cliente_nome}: {brl(ultima.valor)}{ultima.cashback_usado > 0 && <>, usou {brl(ultima.cashback_usado)}</>}</p>
            {ultima.creditos.map((c, i) => (
              <p key={i} className="text-muted-foreground">+ {brl(c.valor)} de cashback {c.origem === "indicacao" ? "para quem indicou" : "para o cliente"}</p>
            ))}
            <Button variant="outline" size="sm" className="mt-3" onClick={() => onFicha(ultima.cliente_id)}>Ver extrato do cliente</Button>
          </div>
        )}
        <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Como funciona no balcão</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Busque o cliente pelo nome, WhatsApp ou código.</li>
            <li>Na primeira compra, digite o código de quem indicou.</li>
            <li>Se ele tem saldo, use o cashback como desconto.</li>
            <li>O crédito novo já fica disponível para a próxima compra, em qualquer loja.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function Afiliados({ onFicha }: { onFicha: (id: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cashback", "afiliados"], queryFn: () => apiGet<Afiliado[]>("/cashback/afiliados") });
  const [abrir, setAbrir] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const criar = useMutation({
    mutationFn: () => apiPost<Ficha & { link: string | null }>("/cashback/afiliados", { nome, telefone }),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ["cashback"] }); toast.success(`Código ${a.codigo} criado.`); setAbrir(false); setNome(""); setTelefone(""); onFicha(a.id); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível criar."),
  });
  const [filtro, setFiltro] = useState("");
  const lista = useMemo(() => (q.data ?? []).filter((a) => `${a.nome} ${a.codigo} ${a.telefone}`.toLowerCase().includes(filtro.toLowerCase())), [q.data, filtro]);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar afiliado" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Buscar afiliado" /></div>
        <Button onClick={() => setAbrir(true)} data-testid="cb-novo-afiliado"><Plus className="h-4 w-4" /> Novo afiliado</Button>
      </div>
      {q.isLoading ? <div className="h-32 animate-pulse rounded-xl bg-muted" /> : !lista.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground"><Users className="mx-auto mb-2 h-6 w-6" />Nenhum afiliado ainda. Crie um ou deixe o cliente gerar o código no site (Indique e ganhe).</div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {lista.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onFicha(a.id)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted/50 sm:flex-row sm:items-center">
                <span className="min-w-0 flex-1"><span className="font-medium">{a.nome}</span> <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary">{a.codigo}</span>
                  <span className="block text-xs text-muted-foreground">{a.indicados} indicado(s) · {brl(a.vendas)} em vendas indicadas</span></span>
                <span className="text-sm font-semibold">{brl(a.saldo)}<span className="ml-1 text-xs font-normal text-muted-foreground">de saldo</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={abrir} onOpenChange={setAbrir}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Novo afiliado</DialogTitle><DialogDescription>Se o WhatsApp já é de um cliente, ele vira afiliado e mantém o histórico.</DialogDescription></DialogHeader>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); criar.mutate(); }}>
            <Input placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Nome" />
            <Input placeholder="WhatsApp com DDD" value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" aria-label="WhatsApp" />
            <Button type="submit" disabled={criar.isPending || nome.trim().length < 2 || telefone.replace(/\D/g, "").length < 10}>Gerar código</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Compras({ admin, onFicha }: { admin: boolean; onFicha: (id: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cashback", "compras"], queryFn: () => apiGet<Compra[]>("/cashback/compras") });
  const estornar = useMutation({
    mutationFn: (id: string) => apiPost<{ aviso: string | null }>(`/cashback/compras/${id}/estornar`),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["cashback"] }); toast.success("Compra estornada."); if (r.aviso) toast.warning(r.aviso); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível estornar."),
  });
  if (q.isLoading) return <div className="h-32 animate-pulse rounded-xl bg-muted" />;
  if (!q.data?.length) return <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhuma compra registrada ainda.</div>;
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {q.data.map((c) => (
        <li key={c.id} className={cn("flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center", c.estornada && "opacity-50")}>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onFicha(c.cliente_id)}>
            <span className="font-medium">{c.cliente_nome}</span>
            <span className="block text-xs text-muted-foreground">
              {dataCurta(c.data)}{c.unidade_nome ? ` · ${c.unidade_nome}` : ""} · por {c.por}{c.afiliado_nome ? ` · indicação de ${c.afiliado_nome}` : ""}{c.estornada ? " · estornada" : ""}
            </span>
          </button>
          <span className="text-right">
            <b>{brl(c.valor)}</b>
            <span className="block text-xs text-muted-foreground">
              {c.cashback_usado > 0 ? `usou ${brl(c.cashback_usado)} · ` : ""}gerou {brl(c.creditos.reduce((s, x) => s + x.valor, 0))}
            </span>
          </span>
          {admin && !c.estornada && (
            <Button variant="ghost" size="sm" title="Estornar" onClick={() => window.confirm(`Estornar a compra de ${c.cliente_nome}? O cashback usado volta para o cliente.`) && estornar.mutate(c.id)}>
              <Undo2 className="h-4 w-4" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Configurar({ inicial }: { inicial: Config }) {
  const qc = useQueryClient();
  const [c, setC] = useState<Config>(inicial);
  const salvar = useMutation({
    mutationFn: () => apiPut<Config>("/cashback/config", c),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cashback"] }); toast.success("Programa salvo."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar."),
  });
  const num = (k: keyof Config) => (
    <Input type="number" step="0.5" value={String(c[k])} onChange={(e) => setC({ ...c, [k]: Number(e.target.value) })} className="w-28" />
  );
  return (
    <form className="grid max-w-2xl gap-5 rounded-xl border bg-card p-5" onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }} data-testid="cb-config">
      <label className="flex items-center gap-3 text-sm font-medium">
        <input type="checkbox" checked={c.ativo} onChange={(e) => setC({ ...c, ativo: e.target.checked })} data-testid="cb-ativo" />
        Programa de indicação e cashback ligado
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label>Quem indica ganha (% da compra)</Label>{num("pct_indicacao")}</div>
        <div className="grid gap-1.5"><Label>Nas primeiras compras do indicado</Label>{num("compras_indicacao")}<p className="text-xs text-muted-foreground">0 = em todas as compras.</p></div>
        <div className="grid gap-1.5"><Label>Todo cliente acumula (% da compra)</Label>{num("pct_compra")}<p className="text-xs text-muted-foreground">0 = só quem indica ganha.</p></div>
        <div className="grid gap-1.5"><Label>Crédito vale por (dias)</Label>{num("validade_dias")}</div>
        <div className="grid gap-1.5"><Label>Uso máximo por compra (% do valor)</Label>{num("max_pct_uso")}</div>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={c.autocadastro_site} onChange={(e) => setC({ ...c, autocadastro_site: e.target.checked })} />
        Mostrar "Indique e ganhe" no site, para o cliente gerar o próprio link
      </label>
      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        O crédito é usado só em compras seguintes, em qualquer loja. Indicação vale só para quem ainda não tinha comprado, e a primeira indicação vale para sempre.
      </p>
      <Button type="submit" className="w-fit" disabled={salvar.isPending}><Settings2 className="h-4 w-4" /> Salvar</Button>
    </form>
  );
}

function FichaCliente({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cashback", "ficha", id], queryFn: () => apiGet<Extrato>(`/cashback/clientes/${id}`) });
  const virar = useMutation({
    mutationFn: () => apiPost("/cashback/afiliados", { pessoa_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cashback"] }),
  });
  const f = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{f?.nome ?? "Cliente"}</DialogTitle>
          <DialogDescription>{f?.telefone ?? ""}{f?.indicado_por ? ` · indicado por ${f.indicado_por.nome}` : ""}</DialogDescription>
        </DialogHeader>
        {!f ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : (
          <div className="grid gap-4 text-sm" data-testid="cb-ficha">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Saldo</p><p className="text-xl font-bold">{brl(f.saldo)}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Vence em 30 dias</p><p className="text-xl font-bold">{brl(f.a_vencer_30d)}</p></div>
            </div>
            {f.codigo ? (
              <div className="rounded-lg bg-muted p-3">
                <p className="text-xs text-muted-foreground">Código de indicação</p>
                <p className="font-mono text-lg font-semibold">{f.codigo}</p>
                {f.link && <p className="break-all text-xs text-muted-foreground">{f.link}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(f.link ?? f.codigo ?? ""); toast.success("Copiado."); }}><Copy className="h-4 w-4" /> Copiar</Button>
                  {f.telefone && <a className="inline-flex h-8 items-center rounded-md bg-[#1fa855] px-3 text-xs font-semibold text-white" target="_blank" rel="noopener noreferrer"
                    href={linkWhatsapp(f.telefone, `Oi, ${f.nome.split(" ")[0]}! Seu código de indicação é ${f.codigo}. ${f.link ? `Mande este link para os amigos: ${f.link}` : ""}`) ?? "#"}>Mandar no WhatsApp</a>}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{f.indicados.length} indicado(s){f.indicados.length ? `: ${f.indicados.map((i) => i.nome).join(", ")}` : ""}</p>
              </div>
            ) : (
              <Button variant="outline" onClick={() => virar.mutate()} disabled={virar.isPending}><Gift className="h-4 w-4" /> Gerar código de indicação</Button>
            )}
            <div>
              <p className="mb-2 font-medium">Extrato</p>
              {!f.movimentos.length ? <p className="text-muted-foreground">Sem movimentos.</p> : (
                <ul className="divide-y rounded-lg border">
                  {f.movimentos.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate">{m.descricao}</span>
                        <span className="text-xs text-muted-foreground">{dataCurta(m.created_at)}{m.tipo === "credito" && m.validade ? ` · vence ${dataCurta(m.validade)}` : ""}{m.estornado ? " · estornado" : ""}</span>
                      </span>
                      <span className={cn("shrink-0 font-semibold", m.tipo === "credito" ? "text-emerald-600" : "text-destructive")}>{m.tipo === "credito" ? "+" : "-"} {brl(m.valor)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
