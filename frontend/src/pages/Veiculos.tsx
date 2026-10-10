import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Car, ImagePlus, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { apiGet, apiPost, apiPut, apiDelete, detalheErro } from "@/lib/api";
import { brl, brlCompacto } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SiteStatusPicker from "@/components/site/SiteStatusPicker";
import type { SiteStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type StatusV = "preparacao" | "disponivel" | "reservado" | "vendido";
interface Veiculo {
  id: string;
  codigo: string;
  titulo: string;
  marca: string;
  modelo: string;
  versao: string | null;
  ano_fabricacao: number;
  ano_modelo: number;
  km: number;
  cor: string | null;
  cambio: string;
  combustivel: string;
  categoria: string;
  portas: number | null;
  placa: string | null;
  opcionais: string[];
  descricao: string | null;
  preco_venda: number | null;
  preco_fipe: number | null;
  custo_aquisicao: number | null;
  despesas: { descricao: string; valor: number }[] | null;
  custo_total: number | null;
  margem: number | null;
  margem_pct: number | null;
  status: StatusV;
  dias_estoque: number;
  alerta_giro: boolean;
  foto_url: string | null;
  site_status: SiteStatus;
  site_destaque: boolean;
  aceita_troca: boolean;
  unico_dono: boolean;
  ipva_pago: boolean;
  garantia: string | null;
  valor_vendido?: number;
  vendido_em?: string;
  fotos?: { id: string; url: string }[];
}
interface Resumo {
  em_estoque: number;
  disponiveis: number;
  reservados: number;
  valor_estoque: number;
  dias_medio: number | null;
  parados: number;
  vendidos_mes: number;
  faturamento_mes: number;
  custo_estoque?: number;
  margem_mes?: number;
}

const STATUS: Record<StatusV, { rotulo: string; classe: string }> = {
  preparacao: { rotulo: "Em preparação", classe: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  disponivel: { rotulo: "Disponível", classe: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  reservado: { rotulo: "Reservado", classe: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  vendido: { rotulo: "Vendido", classe: "bg-muted text-muted-foreground" },
};
const OPCIONAIS = ["Ar-condicionado", "Direção elétrica", "Vidros elétricos", "Travas elétricas", "Central multimídia", "Câmera de ré", "Sensor de estacionamento", "Bancos de couro", "Teto solar", "Rodas de liga", "Piloto automático", "Airbags laterais", "Partida sem chave", "Carregador sem fio"];

export default function Veiculos() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ["veiculos"], queryFn: () => apiGet<Veiculo[]>("/veiculos") });
  const resumo = useQuery({ queryKey: ["veiculos-resumo"], queryFn: () => apiGet<Resumo>("/veiculos/resumo") });
  const [busca, setBusca] = useState("");
  const [edit, setEdit] = useState<Veiculo | "novo" | null>(null);
  const [vender, setVender] = useState<Veiculo | null>(null);
  const [aba, setAba] = useState("estoque");
  const filtrada = useMemo(() => {
    const t = busca.toLowerCase().trim();
    return (lista.data ?? []).filter((v) => (aba === "vendidos" ? v.status === "vendido" : v.status !== "vendido") && (!t || `${v.titulo} ${v.codigo} ${v.placa ?? ""} ${v.cor ?? ""}`.toLowerCase().includes(t)));
  }, [lista.data, busca, aba]);
  const r = resumo.data;
  const atualizar = () => { qc.invalidateQueries({ queryKey: ["veiculos"] }); qc.invalidateQueries({ queryKey: ["veiculos-resumo"] }); };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi rotulo="Em estoque" valor={String(r?.em_estoque ?? "-")} detalhe={r ? `${r.disponiveis} disponíveis, ${r.reservados} reservados` : undefined} />
        <Kpi rotulo="Valor do estoque" valor={r ? brlCompacto(r.valor_estoque) : "-"} detalhe={isAdmin && r?.custo_estoque != null ? `custo ${brlCompacto(r.custo_estoque)}` : undefined} />
        <Kpi rotulo="Dias em estoque (média)" valor={r?.dias_medio != null ? String(r.dias_medio) : "-"} detalhe={r?.parados ? `${r.parados} parado(s) há 60+ dias` : "nenhum parado"} alerta={!!r?.parados} />
        <Kpi rotulo="Vendidos no mês" valor={String(r?.vendidos_mes ?? "-")} detalhe={r ? `${brlCompacto(r.faturamento_mes)}${isAdmin && r.margem_mes != null ? `, margem ${brlCompacto(r.margem_mes)}` : ""}` : undefined} />
      </div>
      <Tabs value={aba} onValueChange={(v) => setAba(String(v))}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <TabsList><TabsTrigger value="estoque">Estoque</TabsTrigger><TabsTrigger value="vendidos">Vendidos</TabsTrigger></TabsList>
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar por modelo, código, placa ou cor" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
          <Button onClick={() => setEdit("novo")} data-testid="novo-veiculo"><Plus className="h-4 w-4" /> Novo veículo</Button>
        </div>
        <TabsContent value={aba} className="mt-4">
          {lista.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : !filtrada.length ? (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground"><Car className="mx-auto mb-2 h-8 w-8" />{aba === "vendidos" ? "Nenhuma venda registrada." : "Nenhum veículo no estoque. Cadastre o primeiro."}</div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="lista-veiculos">
              {filtrada.map((v) => (
                <li key={v.id} className="overflow-hidden rounded-xl border bg-card">
                  <button type="button" className="block w-full text-left" onClick={() => setEdit(v)}>
                    <div className="relative aspect-[16/10] bg-muted">
                      {v.foto_url ? <img src={v.foto_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Car className="absolute inset-0 m-auto h-10 w-10 text-muted-foreground" />}
                      <span className={cn("absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS[v.status].classe)}>{STATUS[v.status].rotulo}</span>
                      {v.alerta_giro && <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white"><AlertTriangle className="h-3 w-3" /> {v.dias_estoque} dias</span>}
                    </div>
                    <div className="grid gap-1 p-3">
                      <p className="truncate font-semibold">{v.marca} {v.modelo}</p>
                      <p className="truncate text-xs text-muted-foreground">{[v.versao, `${v.ano_fabricacao}/${v.ano_modelo}`, `${v.km.toLocaleString("pt-BR")} km`, v.cor].filter(Boolean).join(", ")}</p>
                      <div className="mt-1 flex items-end justify-between">
                        <p className="text-lg font-bold">{v.status === "vendido" ? brl(v.valor_vendido ?? 0) : v.preco_venda ? brl(v.preco_venda) : "Sem preço"}</p>
                        {isAdmin && v.margem != null && <p className={cn("text-xs font-semibold", v.margem >= 0 ? "text-emerald-600" : "text-red-600")}>margem {brlCompacto(v.margem)}{v.margem_pct != null ? ` (${v.margem_pct}%)` : ""}</p>}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{v.codigo}, {v.dias_estoque} dia(s) {v.status === "vendido" ? "até a venda" : "em estoque"}</p>
                    </div>
                  </button>
                  {v.status !== "vendido" && (
                    <div className="flex border-t">
                      <button type="button" onClick={() => setVender(v)} className="flex-1 py-2 text-sm font-semibold text-primary hover:bg-accent/50" data-testid={`vender-${v.codigo}`}>Registrar venda</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
      <VeiculoDialog veiculo={edit} onClose={() => setEdit(null)} onSalvo={atualizar} />
      <VendaDialog veiculo={vender} onClose={() => setVender(null)} onSalvo={atualizar} />
    </div>
  );
}

function Kpi({ rotulo, valor, detalhe, alerta }: { rotulo: string; valor: string; detalhe?: string; alerta?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card p-4", alerta && "border-red-300")}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="num mt-1 truncate text-xl font-bold sm:text-2xl">{valor}</p>
      {detalhe && <p className={cn("truncate text-[11px]", alerta ? "text-red-600" : "text-muted-foreground")}>{detalhe}</p>}
    </div>
  );
}

const VAZIO = { marca: "", modelo: "", versao: "", ano_fabricacao: String(new Date().getFullYear() - 3), ano_modelo: String(new Date().getFullYear() - 3), km: "", cor: "", cambio: "manual", combustivel: "flex", categoria: "hatch", portas: "4", placa: "", opcionais: [] as string[], descricao: "", preco_venda: "", preco_fipe: "", custo_aquisicao: "", despesas: [] as { descricao: string; valor: string }[], status: "disponivel" as StatusV, site_status: "inativo" as SiteStatus, site_destaque: false, aceita_troca: true, unico_dono: false, ipva_pago: false, garantia: "" };

function VeiculoDialog({ veiculo, onClose, onSalvo }: { veiculo: Veiculo | "novo" | null; onClose: () => void; onSalvo: () => void }) {
  const { isAdmin, podeSite } = useAuth();
  const [f, setF] = useState(VAZIO);
  const id = veiculo && veiculo !== "novo" ? veiculo.id : null;
  const det = useQuery({ queryKey: ["veiculo", id], queryFn: () => apiGet<Veiculo>(`/veiculos/${id}`), enabled: !!id });
  const arquivo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (veiculo === "novo") setF(VAZIO);
    else if (veiculo) {
      const v = veiculo;
      setF({ marca: v.marca, modelo: v.modelo, versao: v.versao ?? "", ano_fabricacao: String(v.ano_fabricacao), ano_modelo: String(v.ano_modelo), km: String(v.km), cor: v.cor ?? "", cambio: v.cambio, combustivel: v.combustivel, categoria: v.categoria, portas: String(v.portas ?? ""), placa: v.placa ?? "", opcionais: v.opcionais, descricao: v.descricao ?? "", preco_venda: v.preco_venda?.toString() ?? "", preco_fipe: v.preco_fipe?.toString() ?? "", custo_aquisicao: v.custo_aquisicao?.toString() ?? "", despesas: (v.despesas ?? []).map((d) => ({ descricao: d.descricao, valor: String(d.valor) })), status: v.status, site_status: v.site_status, site_destaque: v.site_destaque, aceita_troca: v.aceita_troca, unico_dono: v.unico_dono, ipva_pago: v.ipva_pago, garantia: v.garantia ?? "" });
    }
  }, [veiculo]);
  const n = (s: string) => (s ? Number(s.replace(/\./g, "").replace(",", ".")) : null);
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { ...f, versao: f.versao || null, cor: f.cor || null, placa: f.placa || null, descricao: f.descricao || null, garantia: f.garantia || null,
        ano_fabricacao: Number(f.ano_fabricacao), ano_modelo: Number(f.ano_modelo), km: Number(f.km.replace(/\D/g, "")) || 0, portas: f.portas ? Number(f.portas) : null,
        preco_venda: n(f.preco_venda), preco_fipe: n(f.preco_fipe), custo_aquisicao: n(f.custo_aquisicao),
        despesas: f.despesas.filter((d) => d.descricao.trim().length > 1).map((d) => ({ descricao: d.descricao, valor: n(d.valor) ?? 0 })) };
      return id ? apiPut(`/veiculos/${id}`, corpo) : apiPost("/veiculos", corpo);
    },
    onSuccess: () => { onSalvo(); toast.success("Veículo salvo"); onClose(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Confira os dados"),
  });
  const fotos = useMutation({
    mutationFn: async (lista: FileList) => {
      const fd = new FormData();
      Array.from(lista).forEach((a) => fd.append("arquivos", a));
      const r = await fetch(`/api/veiculos/${id}/fotos`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? "Falha no envio");
    },
    onSuccess: () => { det.refetch(); onSalvo(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha no envio"),
  });
  const removerFoto = useMutation({ mutationFn: (fid: string) => apiDelete(`/veiculos/${id}/fotos/${fid}`), onSuccess: () => { det.refetch(); onSalvo(); } });
  const sel = (k: keyof typeof f, opcoes: [string, string][], rotulo: string) => (
    <div className="grid gap-1.5"><Label htmlFor={`v-${k}`}>{rotulo}</Label>
      <select id={`v-${k}`} className="h-9 rounded-lg border bg-transparent px-2 text-sm" value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
        {opcoes.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
      </select></div>
  );
  const txt = (k: keyof typeof f, rotulo: string, extra?: object) => (
    <div className="grid gap-1.5"><Label htmlFor={`v-${k}`}>{rotulo}</Label><Input id={`v-${k}`} value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></div>
  );
  return (
    <Dialog open={!!veiculo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{id ? `${f.marca} ${f.modelo}` : "Novo veículo"}</DialogTitle><DialogDescription>A placa e o custo ficam só no sistema, nunca vão para o site.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          {txt("marca", "Marca")}{txt("modelo", "Modelo")}{txt("versao", "Versão")}
          {txt("ano_fabricacao", "Ano de fabricação", { inputMode: "numeric" })}{txt("ano_modelo", "Ano do modelo", { inputMode: "numeric" })}{txt("km", "Quilometragem", { inputMode: "numeric" })}
          {txt("cor", "Cor")}{txt("placa", "Placa")}{txt("portas", "Portas", { inputMode: "numeric" })}
          {sel("cambio", [["manual", "Manual"], ["automatico", "Automático"], ["cvt", "CVT"], ["automatizado", "Automatizado"]], "Câmbio")}
          {sel("combustivel", [["flex", "Flex"], ["gasolina", "Gasolina"], ["etanol", "Etanol"], ["diesel", "Diesel"], ["hibrido", "Híbrido"], ["eletrico", "Elétrico"], ["gnv", "GNV"]], "Combustível")}
          {sel("categoria", [["hatch", "Hatch"], ["sedan", "Sedã"], ["suv", "SUV"], ["picape", "Picape"], ["utilitario", "Utilitário"], ["moto", "Moto"], ["esportivo", "Esportivo"], ["outro", "Outro"]], "Categoria")}
          {txt("preco_venda", "Preço de venda (R$)", { inputMode: "decimal" })}{txt("preco_fipe", "FIPE de referência (R$)", { inputMode: "decimal" })}
          {sel("status", [["preparacao", "Em preparação"], ["disponivel", "Disponível"], ["reservado", "Reservado"]], "Situação")}
        </div>
        {isAdmin && (
          <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
            <p className="text-sm font-semibold">Custo (só gestão)</p>
            <div className="grid gap-3 sm:grid-cols-3">{txt("custo_aquisicao", "Custo de aquisição (R$)", { inputMode: "decimal" })}</div>
            {f.despesas.map((d, k) => (
              <div key={k} className="flex gap-2">
                <Input value={d.descricao} placeholder="Despesa (funilaria, pneus...)" onChange={(e) => setF({ ...f, despesas: f.despesas.map((x, i) => (i === k ? { ...x, descricao: e.target.value } : x)) })} />
                <Input className="w-32" inputMode="decimal" value={d.valor} placeholder="Valor" onChange={(e) => setF({ ...f, despesas: f.despesas.map((x, i) => (i === k ? { ...x, valor: e.target.value } : x)) })} />
                <Button variant="ghost" size="icon" onClick={() => setF({ ...f, despesas: f.despesas.filter((_, i) => i !== k) })} aria-label="Remover despesa"><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-fit" onClick={() => setF({ ...f, despesas: [...f.despesas, { descricao: "", valor: "" }] })}>+ Despesa de preparação</Button>
            {(() => {
              const custo = (n(f.custo_aquisicao) ?? 0) + f.despesas.reduce((a, d) => a + (n(d.valor) ?? 0), 0);
              const preco = n(f.preco_venda) ?? 0;
              return custo > 0 && preco > 0 ? <p className="text-sm">Custo total {brl(custo)}, margem prevista <b className={preco - custo >= 0 ? "text-emerald-600" : "text-red-600"}>{brl(preco - custo)} ({Math.round(((preco - custo) / preco) * 1000) / 10}%)</b></p> : null;
            })()}
          </div>
        )}
        <div className="grid gap-1.5">
          <Label>Opcionais</Label>
          <div className="flex flex-wrap gap-1.5">
            {OPCIONAIS.map((o) => {
              const on = f.opcionais.includes(o);
              return <button key={o} type="button" onClick={() => setF({ ...f, opcionais: on ? f.opcionais.filter((x) => x !== o) : [...f.opcionais, o] })} className={cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{o}</button>;
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          {([["aceita_troca", "Aceita troca"], ["unico_dono", "Único dono"], ["ipva_pago", "IPVA pago"]] as const).map(([k, r]) => (
            <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} className="accent-[var(--primary)]" /> {r}</label>
          ))}
        </div>
        <div className="grid gap-1.5"><Label htmlFor="v-desc">Descrição para o site</Label><Textarea id="v-desc" rows={3} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
        <div className="grid gap-1.5">
          <Label>No site da loja</Label>
          <SiteStatusPicker value={f.site_status} onChange={(v) => setF({ ...f, site_status: v })} disabled={!podeSite} />
        </div>
        {id && (
          <div className="grid gap-2">
            <Label>Fotos</Label>
            <div className="flex flex-wrap gap-2">
              {(det.data?.fotos ?? []).map((ft) => (
                <div key={ft.id} className="relative h-20 w-28 overflow-hidden rounded-md border">
                  <img src={ft.url} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => removerFoto.mutate(ft.id)} className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white" aria-label="Remover foto"><Trash2 className="h-3 w-3" /></button>
                </div>
              ))}
              <button type="button" onClick={() => arquivo.current?.click()} className="flex h-20 w-28 flex-col items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted">
                {fotos.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-5 w-5" />} Enviar fotos
              </button>
              <input ref={arquivo} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.length && fotos.mutate(e.target.files)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || f.marca.trim().length < 2 || !f.modelo.trim()} data-testid="veiculo-salvar">{id ? "Salvar" : "Cadastrar veículo"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VendaDialog({ veiculo, onClose, onSalvo }: { veiculo: Veiculo | null; onClose: () => void; onSalvo: () => void }) {
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState("financiamento");
  useEffect(() => { if (veiculo) setValor(String(veiculo.preco_venda ?? "")); }, [veiculo]);
  const vender = useMutation({
    mutationFn: () => apiPost(`/veiculos/${veiculo!.id}/vender`, { valor: Number(valor.replace(/\./g, "").replace(",", ".")), forma_pagamento: forma }),
    onSuccess: () => { onSalvo(); toast.success("Venda registrada e lançada no Financeiro"); onClose(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível registrar"),
  });
  return (
    <Dialog open={!!veiculo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Registrar venda</DialogTitle><DialogDescription>{veiculo?.titulo}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="vd-valor">Valor da venda (R$)</Label><Input id="vd-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} data-testid="venda-valor" /></div>
          <div className="grid gap-1.5"><Label htmlFor="vd-forma">Pagamento</Label>
            <select id="vd-forma" className="h-9 rounded-lg border bg-transparent px-2 text-sm" value={forma} onChange={(e) => setForma(e.target.value)}>
              <option value="financiamento">Financiamento</option><option value="a_vista">À vista</option><option value="troca_mais_volta">Troca com volta</option><option value="consorcio">Consórcio</option>
            </select></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={() => vender.mutate()} disabled={!Number(valor.replace(",", ".")) || vender.isPending} data-testid="venda-confirmar">Confirmar venda</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
