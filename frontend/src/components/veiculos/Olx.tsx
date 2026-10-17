import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Unplug } from "lucide-react";
import { apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { dataHoraBR } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/* OLX na loja de veículos: conectar a conta profissional da loja, mandar o estoque e receber os leads. */

export interface OlxVeiculo {
  publicar: boolean;
  marca: string | null;
  modelo: string | null;
  versao: string | null;
  marca_nome?: string | null;
  modelo_nome?: string | null;
  versao_nome?: string | null;
  situacao?: "enviado" | "publicado" | "erro" | "removido" | null;
  erros?: string[];
  enviado_em?: string | null;
}

interface Situacao {
  app_pronto: boolean;
  conectado: boolean;
  conta: { nome: string | null; email: string | null } | null;
  leads_ligados: boolean;
  cep: string | null;
  telefone: string | null;
  marcados: number;
  prontos: number;
  publicados: number;
  pendencias: { id: string; codigo: string; titulo: string; faltando: string[]; erros: string[] }[];
  ultimo_envio: { em: string; ok: boolean; mensagem: string; enviados?: number; removidos?: number } | null;
}

interface Item { id: string; nome: string }

export const OLX_VAZIO: OlxVeiculo = { publicar: false, marca: null, modelo: null, versao: null };

export function useOlx(ativo = true) {
  return useQuery({ queryKey: ["olx"], queryFn: () => apiGet<Situacao>("/olx"), enabled: ativo, staleTime: 30_000 });
}

/** Selo no card do veículo. */
export function SeloOlx({ olx }: { olx?: OlxVeiculo | null }) {
  if (!olx?.publicar) return null;
  const s = olx.situacao;
  const [rotulo, classe] = s === "erro" ? ["OLX: corrigir", "bg-red-600 text-white"]
    : s === "enviado" || s === "publicado" ? ["Na OLX", "bg-[#6e0ad6] text-white"] : ["OLX: a enviar", "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", classe)} title={olx.erros?.join(", ")}>{rotulo}</span>;
}

/** Bloco da ficha do veículo: anunciar na OLX e escolher marca, modelo e versão do catálogo deles. */
export function CamposOlx({ valor, onChange, conectado }: { valor: OlxVeiculo; onChange: (v: OlxVeiculo) => void; conectado: boolean }) {
  const marcas = useQuery({ queryKey: ["olx-cat"], queryFn: () => apiGet<Item[]>("/olx/catalogo"), enabled: conectado && valor.publicar, staleTime: 3_600_000 });
  const modelos = useQuery({ queryKey: ["olx-cat", valor.marca], queryFn: () => apiGet<Item[]>(`/olx/catalogo?marca=${valor.marca}`),
    enabled: conectado && valor.publicar && !!valor.marca, staleTime: 3_600_000 });
  const versoes = useQuery({ queryKey: ["olx-cat", valor.marca, valor.modelo], queryFn: () => apiGet<Item[]>(`/olx/catalogo?marca=${valor.marca}&modelo=${valor.modelo}`),
    enabled: conectado && valor.publicar && !!valor.marca && !!valor.modelo, staleTime: 3_600_000 });
  const sel = "h-9 w-full min-w-0 rounded-lg border bg-transparent px-2 text-sm";
  const nome = (lista: Item[] | undefined, id: string) => lista?.find((x) => x.id === id)?.nome ?? null;
  return (
    <div className="grid gap-2 rounded-lg border p-3" data-testid="v-olx">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={valor.publicar} onChange={(e) => onChange({ ...valor, publicar: e.target.checked })} className="accent-[var(--primary)]" data-testid="v-olx-publicar" />
        <span className="rounded bg-[#6e0ad6] px-1.5 text-xs font-bold text-white">OLX</span> Anunciar este carro na OLX
        {valor.situacao && <span className="ml-auto text-xs text-muted-foreground">{valor.situacao === "erro" ? "Voltou com problema" : valor.situacao === "removido" ? "Retirado da OLX" : "Enviado"}{valor.enviado_em ? ` em ${dataHoraBR(valor.enviado_em)}` : ""}</span>}
      </label>
      {valor.publicar && !conectado && <p className="text-xs text-amber-700 dark:text-amber-300">Conecte a conta da OLX da loja (botão OLX no topo do estoque) para escolher o modelo no catálogo deles.</p>}
      {valor.publicar && conectado && (
        <div className="grid gap-2 sm:grid-cols-3">
          <select className={sel} value={valor.marca ?? ""} aria-label="Marca na OLX" data-testid="v-olx-marca"
            onChange={(e) => onChange({ ...valor, marca: e.target.value || null, marca_nome: nome(marcas.data, e.target.value), modelo: null, versao: null, modelo_nome: null, versao_nome: null })}>
            <option value="">{marcas.isLoading ? "Carregando…" : "Marca na OLX"}</option>
            {(marcas.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
          <select className={sel} value={valor.modelo ?? ""} disabled={!valor.marca} aria-label="Modelo na OLX" data-testid="v-olx-modelo"
            onChange={(e) => onChange({ ...valor, modelo: e.target.value || null, modelo_nome: nome(modelos.data, e.target.value), versao: null, versao_nome: null })}>
            <option value="">{modelos.isLoading ? "Carregando…" : "Modelo"}</option>
            {(modelos.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
          <select className={sel} value={valor.versao ?? ""} disabled={!valor.modelo} aria-label="Versão na OLX" data-testid="v-olx-versao"
            onChange={(e) => onChange({ ...valor, versao: e.target.value || null, versao_nome: nome(versoes.data, e.target.value) })}>
            <option value="">{versoes.isLoading ? "Carregando…" : "Versão"}</option>
            {(versoes.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </div>
      )}
      {valor.publicar && !!valor.erros?.length && (
        <p className="flex items-start gap-1 text-xs text-red-600"><AlertTriangle className="mt-px h-3 w-3 shrink-0" /> {valor.erros.join(", ")}</p>
      )}
      {valor.publicar && <p className="text-xs text-muted-foreground">A OLX pede preço, pelo menos uma foto e a placa (usado). A placa não aparece no anúncio. Depois de salvar, use "Enviar para a OLX".</p>}
    </div>
  );
}

/** Painel do gestor: conta, dados da loja, o que falta e o envio. */
export function PainelOlx({ aberto, onClose }: { aberto: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useOlx(aberto);
  const s = q.data;
  const [cep, setCep] = useState("");
  const [tel, setTel] = useState("");
  useEffect(() => { if (s) { setCep(s.cep ?? ""); setTel(s.telefone ?? ""); } }, [s]);
  const atualizar = (r?: Situacao) => { if (r) qc.setQueryData(["olx"], r); else qc.invalidateQueries({ queryKey: ["olx"] }); qc.invalidateQueries({ queryKey: ["veiculos"] }); };
  const conectar = useMutation({
    mutationFn: () => apiPost<{ url: string }>("/olx/conectar"),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível abrir a OLX"),
  });
  const salvar = useMutation({
    mutationFn: () => apiPut<Situacao>("/olx/config", { cep, telefone: tel }),
    onSuccess: (r) => { atualizar(r); toast.success("Dados da loja salvos"); },
    onError: (e) => toast.error(detalheErro(e) ?? "Confira o CEP e o telefone"),
  });
  const enviar = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; mensagem: string; enviados: number; removidos: number }>("/olx/sincronizar"),
    onSuccess: (r) => { atualizar(); (r.ok ? toast.success : toast.warning)(`${r.mensagem} ${r.enviados} enviado(s), ${r.removidos} retirado(s).`); },
    onError: (e) => { atualizar(); toast.error(detalheErro(e) ?? "A OLX não respondeu"); },
  });
  const religar = useMutation({ mutationFn: () => apiPost<Situacao>("/olx/religar-leads"), onSuccess: (r) => { atualizar(r); toast.success("Leads da OLX ligados"); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível ligar os leads") });
  const desconectar = useMutation({ mutationFn: () => apiPost<Situacao>("/olx/desconectar"), onSuccess: (r) => { atualizar(r); toast.success("Conta da OLX desconectada") } });
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" data-testid="painel-olx">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><span className="rounded bg-[#6e0ad6] px-1.5 text-sm font-bold text-white">OLX</span> Anúncios e leads da OLX</DialogTitle>
          <DialogDescription>O estoque marcado vai para a conta profissional da loja na OLX, e os contatos de lá caem em Leads.</DialogDescription>
        </DialogHeader>
        {!s ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : !s.app_pronto ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            A integração com a OLX ainda está sendo liberada pela SAX. Assim que estiver pronta, o botão de conectar aparece aqui.
          </p>
        ) : (
          <div className="grid gap-4 text-sm">
            <section className="grid gap-2 rounded-lg border p-3">
              <p className="font-semibold">1. Conta da loja na OLX</p>
              {s.conectado ? (
                <div className="flex flex-wrap items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Conectada: <b>{s.conta?.nome ?? "conta da OLX"}</b>{s.conta?.email ? ` (${s.conta.email})` : ""}</span>
                  <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => window.confirm("Desconectar a conta da OLX? Os anúncios continuam lá até a próxima conexão.") && desconectar.mutate()}>
                    <Unplug className="h-4 w-4" /> Desconectar
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-muted-foreground">Precisa de um plano profissional para empresas na OLX. Você vai entrar na OLX, autorizar e voltar para cá.</p>
                  <Button className="w-fit" onClick={() => conectar.mutate()} disabled={conectar.isPending} data-testid="olx-conectar">
                    {conectar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Conectar a conta da OLX
                  </Button>
                </>
              )}
              {s.conectado && (
                <p className={cn("text-xs", s.leads_ligados ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300")}>
                  {s.leads_ligados ? "Leads da OLX entrando em Leads, com origem OLX." : "Os leads da OLX ainda não estão ligados. "}
                  {!s.leads_ligados && <button type="button" className="underline" onClick={() => religar.mutate()}>Tentar de novo</button>}
                </p>
              )}
            </section>
            <section className="grid gap-2 rounded-lg border p-3">
              <p className="font-semibold">2. Dados que vão em todos os anúncios</p>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div className="grid gap-1"><Label htmlFor="olx-cep">CEP da loja</Label><Input id="olx-cep" inputMode="numeric" value={cep} onChange={(e) => setCep(e.target.value)} placeholder="80000-000" /></div>
                <div className="grid gap-1"><Label htmlFor="olx-tel">Telefone com DDD</Label><Input id="olx-tel" inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="(41) 99999-0000" /></div>
                <Button variant="outline" onClick={() => salvar.mutate()} disabled={salvar.isPending}>Salvar</Button>
              </div>
            </section>
            <section className="grid gap-2 rounded-lg border p-3">
              <p className="font-semibold">3. Estoque na OLX</p>
              <p>{s.marcados} carro(s) marcados para a OLX, {s.prontos} pronto(s) para enviar.</p>
              {s.pendencias.length > 0 && (
                <ul className="grid max-h-48 gap-1 overflow-y-auto">
                  {s.pendencias.map((p) => (
                    <li key={p.id} className="rounded-md bg-muted/60 px-2 py-1.5 text-xs">
                      <b>{p.codigo} {p.titulo}</b>: {[...p.faltando, ...p.erros].join(", ")}
                    </li>
                  ))}
                </ul>
              )}
              <Button className="w-fit" onClick={() => enviar.mutate()} disabled={!s.conectado || enviar.isPending} data-testid="olx-enviar">
                {enviar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Enviar para a OLX
              </Button>
              <p className="text-xs text-muted-foreground">Envia preço, fotos e dados dos marcados e tira da OLX os vendidos ou desmarcados. Isso também roda sozinho uma vez por dia; carro vendido sai na hora.</p>
              {s.ultimo_envio && <p className={cn("text-xs", s.ultimo_envio.ok ? "text-muted-foreground" : "text-red-600")}>Último envio {dataHoraBR(s.ultimo_envio.em)}: {s.ultimo_envio.mensagem}</p>}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
