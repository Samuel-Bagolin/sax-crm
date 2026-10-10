import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { apiDelete, apiPatch, apiPost, apiPut, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { parseNumber } from "@/lib/numbers";
import { useCatalogoCompleto, type Adicional, type CatalogoPlanos, type PlanoCatalogo, type Recurso, type TipoAdicional } from "@/lib/diferenciais";
import type { ComercialEmpresa, EmpresaResumo } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const numero = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));
const precoAnual = (item: { preco_mensal?: number | null; preco?: number | null; preco_anual?: number | null }) =>
  item.preco_anual ?? Math.round((item.preco_mensal ?? item.preco ?? 0) * 12 * 100) / 100;

function useInvalidar() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["planos"] });
    qc.invalidateQueries({ queryKey: ["empresas"] });
  };
}

function Caixas<T extends string>({ opcoes, valores, onChange }: { opcoes: Record<T, string>; valores: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {(Object.keys(opcoes) as T[]).map((k) => (
        <label key={k} className="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm hover:bg-muted/40">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
            checked={valores.includes(k)}
            onChange={(e) => onChange(e.target.checked ? [...valores, k] : valores.filter((x) => x !== k))}
          />
          <span>{opcoes[k]}</span>
        </label>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ plano

export function PlanoDialog({ plano, catalogo, open, onClose, segmento = "imobiliaria" }: { plano: PlanoCatalogo | null; catalogo: CatalogoPlanos; open: boolean; onClose: () => void; segmento?: string }) {
  const invalidar = useInvalidar();
  const modSeg = catalogo.segmentos?.find((s) => s.chave === segmento)?.modulos ?? ["dashboard", "imoveis", "crm", "agenda", "usuarios"];
  const vazio = { nome: "", resumo: "", preco_mensal: "", preco_anual: "", implantacao: "", usuarios: "", imoveis: "", unidades: "1", ordem: "50", ativo: true, modulos: modSeg, recursos: [] as Recurso[] };
  const [f, setF] = useState(vazio);
  useEffect(() => {
    if (!open) return;
    setF(
      plano
        ? {
            nome: plano.nome, resumo: plano.resumo, preco_mensal: numero(plano.preco_mensal ?? plano.preco), preco_anual: numero(plano.preco_anual),
            implantacao: numero(plano.implantacao), usuarios: numero(plano.usuarios), imoveis: numero(plano.imoveis), unidades: numero(plano.unidades ?? null), ordem: String(plano.ordem ?? 50),
            ativo: plano.ativo ?? true, modulos: plano.modulos, recursos: plano.recursos,
          }
        : vazio,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plano]);
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        nome: f.nome.trim(), resumo: f.resumo.trim(), preco_mensal: parseNumber(f.preco_mensal) ?? 0, preco_anual: parseNumber(f.preco_anual),
        implantacao: parseNumber(f.implantacao), usuarios: parseNumber(f.usuarios), imoveis: parseNumber(f.imoveis), ordem: parseNumber(f.ordem) ?? 50,
        unidades: parseNumber(f.unidades), segmento: plano?.segmento ?? segmento,
        ativo: f.ativo, modulos: f.modulos, recursos: f.recursos,
      };
      return plano ? apiPut(`/planos/${plano.chave}`, corpo) : apiPost("/planos", corpo);
    },
    onSuccess: () => {
      toast.success(plano ? "Plano atualizado" : "Plano criado");
      invalidar();
      onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar o plano"),
  });
  const mensal = parseNumber(f.preco_mensal) ?? 0;
  const anual = parseNumber(f.preco_anual);
  const economia = anual != null && mensal ? Math.round((1 - anual / (mensal * 12)) * 100) : null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{plano ? `Editar plano ${plano.nome}` : "Novo plano"}</DialogTitle>
          <DialogDescription>Mudanças valem para todas as empresas neste plano. O que foi negociado com cada empresa (desconto, adicionais, taxa) continua igual.</DialogDescription>
        </DialogHeader>
        <form id="form-plano" className="grid gap-5" onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="pl-nome">Nome *</Label>
              <Input id="pl-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required minLength={2} data-testid="plano-nome" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pl-ordem">Ordem na lista</Label>
              <Input id="pl-ordem" inputMode="numeric" value={f.ordem} onChange={(e) => setF({ ...f, ordem: e.target.value })} />
            </div>
            <div className="grid gap-1.5 sm:col-span-3">
              <Label htmlFor="pl-resumo">Resumo para o vendedor</Label>
              <Input id="pl-resumo" value={f.resumo} onChange={(e) => setF({ ...f, resumo: e.target.value })} />
            </div>
          </div>

          <fieldset className="grid gap-3 border-t pt-4">
            <legend className="text-sm font-semibold">Preço</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="pl-mensal">Mensal (R$) *</Label>
                <Input id="pl-mensal" inputMode="decimal" value={f.preco_mensal} onChange={(e) => setF({ ...f, preco_mensal: e.target.value })} required data-testid="plano-mensal" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pl-anual">Anual (R$)</Label>
                <Input id="pl-anual" inputMode="decimal" value={f.preco_anual} onChange={(e) => setF({ ...f, preco_anual: e.target.value })} placeholder={mensal ? `12 × mensal = ${brl(mensal * 12)}` : ""} data-testid="plano-anual" />
                {economia != null && <p className="text-xs text-muted-foreground">{economia > 0 ? `${economia}% mais barato que pagar mês a mês` : "Igual ou maior que 12 mensalidades"}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pl-impl">Taxa de instalação padrão (R$)</Label>
                <Input id="pl-impl" inputMode="decimal" value={f.implantacao} onChange={(e) => setF({ ...f, implantacao: e.target.value })} />
              </div>
            </div>
          </fieldset>

          <fieldset className="grid gap-3 border-t pt-4">
            <legend className="text-sm font-semibold">Limites</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="pl-usu">Usuários</Label>
                <Input id="pl-usu" inputMode="numeric" value={f.usuarios} onChange={(e) => setF({ ...f, usuarios: e.target.value })} placeholder="Vazio = sem limite" data-testid="plano-usuarios" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pl-imo">Estoque (imóveis ou veículos)</Label>
                <Input id="pl-imo" inputMode="numeric" value={f.imoveis} onChange={(e) => setF({ ...f, imoveis: e.target.value })} placeholder="Vazio = sem limite" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pl-uni">Unidades (lojas ou clínicas)</Label>
                <Input id="pl-uni" inputMode="numeric" value={f.unidades} onChange={(e) => setF({ ...f, unidades: e.target.value })} placeholder="Vazio = sem limite" />
              </div>
            </div>
          </fieldset>

          <fieldset className="grid gap-3 border-t pt-4">
            <legend className="text-sm font-semibold">Telas incluídas</legend>
            <Caixas opcoes={catalogo.modulos ?? {}} valores={f.modulos} onChange={(v) => setF({ ...f, modulos: v })} />
          </fieldset>

          <fieldset className="grid gap-3 border-t pt-4">
            <legend className="text-sm font-semibold">Funcionalidades incluídas</legend>
            <Caixas opcoes={catalogo.recursos} valores={f.recursos} onChange={(v) => setF({ ...f, recursos: v })} />
          </fieldset>

          <label className="flex items-center gap-2 border-t pt-4 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
            Plano à venda (desmarque para esconder de novas empresas sem afetar as atuais)
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="form-plano" disabled={salvar.isPending} data-testid="plano-salvar">{salvar.isPending ? "Salvando..." : "Salvar plano"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ adicional

export function AdicionalDialog({ adicional, catalogo, open, onClose }: { adicional: Adicional | null; catalogo: CatalogoPlanos; open: boolean; onClose: () => void }) {
  const invalidar = useInvalidar();
  const vazio = { nome: "", descricao: "", tipo: "recurso" as TipoAdicional, recurso: "" as string, quantidade_por_unidade: "1", preco_mensal: "", preco_anual: "", ativo: true };
  const [f, setF] = useState(vazio);
  useEffect(() => {
    if (!open) return;
    setF(
      adicional
        ? { nome: adicional.nome, descricao: adicional.descricao, tipo: adicional.tipo, recurso: adicional.recurso ?? "", quantidade_por_unidade: String(adicional.quantidade_por_unidade), preco_mensal: numero(adicional.preco_mensal), preco_anual: numero(adicional.preco_anual), ativo: adicional.ativo }
        : vazio,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, adicional]);
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        nome: f.nome.trim(), descricao: f.descricao.trim(), tipo: f.tipo, recurso: f.tipo === "recurso" ? f.recurso || null : null,
        quantidade_por_unidade: parseNumber(f.quantidade_por_unidade) ?? 1, preco_mensal: parseNumber(f.preco_mensal) ?? 0, preco_anual: parseNumber(f.preco_anual), ativo: f.ativo,
      };
      return adicional ? apiPut(`/adicionais/${adicional.chave}`, corpo) : apiPost("/adicionais", corpo);
    },
    onSuccess: () => {
      toast.success(adicional ? "Adicional atualizado" : "Adicional criado");
      invalidar();
      onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar o adicional"),
  });
  const tipos = catalogo.tipos_adicional ?? { recurso: "Funcionalidade", usuarios: "Usuários", imoveis: "Imóveis", servico: "Serviço" };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{adicional ? `Editar ${adicional.nome}` : "Novo adicional"}</DialogTitle>
          <DialogDescription>Adicional é algo que a empresa contrata além do plano: uma funcionalidade, mais usuários, mais imóveis ou um serviço.</DialogDescription>
        </DialogHeader>
        <form id="form-adicional" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}>
          <div className="grid gap-1.5">
            <Label htmlFor="ad-nome">Nome *</Label>
            <Input id="ad-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required minLength={2} data-testid="adicional-nome" />
          </div>
          <div className="grid gap-1.5">
            <Label>O que ele adiciona</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(tipos) as TipoAdicional[]).map((t) => (
                <button key={t} type="button" aria-pressed={f.tipo === t} onClick={() => setF({ ...f, tipo: t })} className={cn("rounded-md border px-2.5 py-2 text-left text-sm", f.tipo === t ? "border-primary bg-accent font-medium" : "hover:bg-muted/40")}>
                  {tipos[t]}
                </button>
              ))}
            </div>
          </div>
          {f.tipo === "recurso" && (
            <div className="grid gap-1.5">
              <Label htmlFor="ad-rec">Funcionalidade liberada *</Label>
              <select id="ad-rec" value={f.recurso} onChange={(e) => setF({ ...f, recurso: e.target.value })} className="h-9 rounded-md border bg-background px-2 text-sm" required>
                <option value="">Selecionar</option>
                {(Object.keys(catalogo.recursos) as Recurso[]).map((r) => (
                  <option key={r} value={r}>{catalogo.recursos[r]}</option>
                ))}
              </select>
            </div>
          )}
          {(f.tipo === "usuarios" || f.tipo === "imoveis") && (
            <div className="grid gap-1.5">
              <Label htmlFor="ad-qtd">Quantidade por unidade contratada</Label>
              <Input id="ad-qtd" inputMode="numeric" value={f.quantidade_por_unidade} onChange={(e) => setF({ ...f, quantidade_por_unidade: e.target.value })} />
              <p className="text-xs text-muted-foreground">Ex.: um pacote de 5 usuários. Se a empresa contratar 2 pacotes, ganha 10 usuários.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ad-m">Preço mensal (R$) *</Label>
              <Input id="ad-m" inputMode="decimal" value={f.preco_mensal} onChange={(e) => setF({ ...f, preco_mensal: e.target.value })} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ad-a">Preço anual (R$)</Label>
              <Input id="ad-a" inputMode="decimal" value={f.preco_anual} onChange={(e) => setF({ ...f, preco_anual: e.target.value })} placeholder="12 × mensal" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ad-desc">Descrição</Label>
            <Input id="ad-desc" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
            Disponível para venda
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="form-adicional" disabled={salvar.isPending} data-testid="adicional-salvar">{salvar.isPending ? "Salvando..." : "Salvar adicional"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ catálogo (aba)

export function CatalogoComercial() {
  const { data } = useCatalogoCompleto();
  const invalidar = useInvalidar();
  const [seg, setSeg] = useState("imobiliaria");
  const [plano, setPlano] = useState<PlanoCatalogo | null | "novo">(null);
  const [adicional, setAdicional] = useState<Adicional | null | "novo">(null);
  const excluirPlano = useMutation({
    mutationFn: (chave: string) => apiDelete(`/planos/${chave}`),
    onSuccess: () => { toast.success("Plano excluído"); invalidar(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível excluir"),
  });
  const excluirAdicional = useMutation({
    mutationFn: (chave: string) => apiDelete(`/adicionais/${chave}`),
    onSuccess: () => { toast.success("Adicional excluído"); invalidar(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível excluir"),
  });
  if (!data) return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  const tipos = data.tipos_adicional ?? { recurso: "Funcionalidade", usuarios: "Usuários", imoveis: "Imóveis", servico: "Serviço" };

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-heading text-lg font-bold">Planos</h3>
            <p className="text-sm text-muted-foreground">Preço mensal e anual, limites, telas e funcionalidades de cada plano.</p>
          </div>
          <Button size="sm" onClick={() => setPlano("novo")} data-testid="plano-novo"><Plus className="h-4 w-4" /> Novo plano</Button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Segmento">
          {(data.segmentos ?? []).map((sg) => (
            <button key={sg.chave} type="button" role="tab" aria-selected={seg === sg.chave} onClick={() => setSeg(sg.chave)}
              className={cn("rounded-full border px-3 py-1 text-sm", seg === sg.chave ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")} data-testid={`planos-seg-${sg.chave}`}>
              {sg.nome}
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {data.planos.filter((p) => (p.segmento ?? "imobiliaria") === seg).map((p) => (
            <article key={p.chave} className={cn("flex flex-col gap-3 rounded-lg border bg-card p-4", p.ativo === false && "opacity-60")} data-testid={`plano-${p.chave}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{p.nome}</p>
                  {p.ativo === false && <Badge variant="secondary" className="mt-1">Fora de venda</Badge>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Editar ${p.nome}`} onClick={() => setPlano(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${p.nome}`} onClick={() => window.confirm(`Excluir o plano ${p.nome}?`) && excluirPlano.mutate(p.chave)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <div>
                <p className="num text-xl font-bold">{brl(p.preco_mensal ?? p.preco)}<span className="text-xs font-normal text-muted-foreground">/mês</span></p>
                <p className="num text-xs text-muted-foreground">{brl(precoAnual(p))}/ano{p.preco_anual == null ? " (12 × mensal)" : ""}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {p.usuarios ? `${p.usuarios} usuário(s)` : "Usuários sem limite"}, {p.imoveis ? `${p.imoveis} imóveis` : "imóveis sem limite"}
              </p>
              <p className="text-xs text-muted-foreground">{p.recursos.length} de {Object.keys(data.recursos).length} funcionalidades. Instalação {brl(p.implantacao ?? 0)}.</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-heading text-lg font-bold">Adicionais</h3>
            <p className="text-sm text-muted-foreground">Contratados por empresa, além do plano. Uma empresa pode ter vários.</p>
          </div>
          <Button size="sm" onClick={() => setAdicional("novo")} data-testid="adicional-novo"><Plus className="h-4 w-4" /> Novo adicional</Button>
        </div>
        {!data.adicionais?.length ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum adicional cadastrado. Crie o primeiro, como "Portais", "Pacote de 5 usuários" ou "Treinamento da equipe".</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2 font-medium">Adicional</th><th className="px-3 py-2 font-medium">Tipo</th><th className="px-3 py-2 text-right font-medium">Mensal</th><th className="px-3 py-2 text-right font-medium">Anual</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody>
                {data.adicionais.map((a) => (
                  <tr key={a.chave} className={cn("border-t", !a.ativo && "opacity-60")}>
                    <td className="px-3 py-2"><p className="font-medium">{a.nome}</p>{a.descricao && <p className="text-xs text-muted-foreground">{a.descricao}</p>}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {a.tipo === "recurso" && a.recurso ? data.recursos[a.recurso] : a.tipo === "usuarios" || a.tipo === "imoveis" ? `${a.quantidade_por_unidade} ${a.tipo === "usuarios" ? "usuário(s)" : "imóvel(is)"} por unidade` : tipos[a.tipo]}
                    </td>
                    <td className="num px-3 py-2 text-right">{brl(a.preco_mensal)}</td>
                    <td className="num px-3 py-2 text-right">{brl(precoAnual(a))}</td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="icon-sm" aria-label={`Editar ${a.nome}`} onClick={() => setAdicional(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${a.nome}`} onClick={() => window.confirm(`Excluir o adicional ${a.nome}?`) && excluirAdicional.mutate(a.chave)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">As funcionalidades disponíveis são as que o sistema já tem. Uma funcionalidade nova precisa ser desenvolvida antes de entrar num plano.</p>
      </section>

      <PlanoDialog plano={plano === "novo" ? null : plano} catalogo={data} open={plano !== null} onClose={() => setPlano(null)} segmento={seg} />
      <AdicionalDialog adicional={adicional === "novo" ? null : adicional} catalogo={data} open={adicional !== null} onClose={() => setAdicional(null)} />
    </div>
  );
}

// ------------------------------------------------------------------ condições comerciais da empresa

export function ComercialDialog({ empresa, onClose }: { empresa: EmpresaResumo | null; onClose: () => void }) {
  const { data: catalogo } = useCatalogoCompleto();
  const invalidar = useInvalidar();
  const [plano, setPlano] = useState("");
  const [c, setC] = useState<ComercialEmpresa>({ periodicidade: "mensal", adicionais: [], desconto_tipo: null, desconto_valor: 0, desconto_motivo: null, taxa_instalacao: null, taxa_instalacao_parcelas: 1, observacoes: null });
  const [descontoTxt, setDescontoTxt] = useState("");
  const [taxaTxt, setTaxaTxt] = useState("");

  useEffect(() => {
    if (!empresa) return;
    const atual = empresa.comercial;
    setPlano(empresa.plano_aplicado ? empresa.plano : "");
    setC({
      periodicidade: atual?.periodicidade ?? "mensal", adicionais: atual?.adicionais ?? [], desconto_tipo: atual?.desconto_tipo ?? null, desconto_valor: atual?.desconto_valor ?? 0,
      desconto_motivo: atual?.desconto_motivo ?? null, taxa_instalacao: atual?.taxa_instalacao ?? null, taxa_instalacao_parcelas: atual?.taxa_instalacao_parcelas ?? 1, observacoes: atual?.observacoes ?? null,
    });
    setDescontoTxt(atual?.desconto_valor ? numero(atual.desconto_valor) : "");
    setTaxaTxt(atual?.taxa_instalacao != null ? numero(atual.taxa_instalacao) : "");
  }, [empresa]);

  const planoSel = catalogo?.planos.find((p) => p.chave === plano);
  const adicionaisDisp = (catalogo?.adicionais ?? []).filter((a) => a.ativo || c.adicionais.some((x) => x.chave === a.chave));

  const calculo = useMemo(() => {
    if (!planoSel) return null;
    const preco = (item: { preco_mensal?: number | null; preco?: number | null; preco_anual?: number | null }) => (c.periodicidade === "anual" ? precoAnual(item) : item.preco_mensal ?? item.preco ?? 0);
    const linhas = [{ descricao: `Plano ${planoSel.nome}`, total: preco(planoSel), qtd: 1 }];
    c.adicionais.forEach((x) => {
      const a = catalogo?.adicionais?.find((y) => y.chave === x.chave);
      if (a) linhas.push({ descricao: a.nome, total: preco(a) * x.quantidade, qtd: x.quantidade });
    });
    const subtotal = linhas.reduce((s, l) => s + l.total, 0);
    const dv = parseNumber(descontoTxt) ?? 0;
    const desconto = c.desconto_tipo === "percentual" ? (subtotal * Math.min(dv, 100)) / 100 : c.desconto_tipo === "valor" ? Math.min(dv, subtotal) : 0;
    const total = subtotal - desconto;
    return { linhas, subtotal, desconto, total, mensal: c.periodicidade === "anual" ? total / 12 : total };
  }, [planoSel, c, descontoTxt, catalogo]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!empresa) return;
      if (plano && (plano !== empresa.plano || !empresa.plano_aplicado)) await apiPatch(`/empresas/${empresa.id}`, { plano });
      await apiPut(`/empresas/${empresa.id}/comercial`, {
        ...c,
        desconto_valor: c.desconto_tipo ? parseNumber(descontoTxt) ?? 0 : 0,
        taxa_instalacao: taxaTxt.trim() ? parseNumber(taxaTxt) : null,
      });
    },
    onSuccess: () => {
      toast.success("Condições comerciais salvas");
      invalidar();
      onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });

  const qtd = (chave: string) => c.adicionais.find((a) => a.chave === chave)?.quantidade ?? 0;
  const definirQtd = (chave: string, n: number) =>
    setC((x) => ({ ...x, adicionais: n <= 0 ? x.adicionais.filter((a) => a.chave !== chave) : x.adicionais.some((a) => a.chave === chave) ? x.adicionais.map((a) => (a.chave === chave ? { ...a, quantidade: n } : a)) : [...x.adicionais, { chave, quantidade: n }] }));

  return (
    <Dialog open={!!empresa} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Condições comerciais de {empresa?.nome}</DialogTitle>
          <DialogDescription>Plano, periodicidade, adicionais, desconto e taxa de instalação negociados pelo vendedor.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-[1fr_280px]">
          <div className="grid content-start gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="co-plano">Plano</Label>
                <select id="co-plano" value={plano} onChange={(e) => setPlano(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" data-testid="comercial-plano">
                  {!empresa?.plano_aplicado && <option value="">Legado (sem limites)</option>}
                  {catalogo?.planos.filter((p) => p.ativo !== false || p.chave === empresa?.plano).map((p) => (
                    <option key={p.chave} value={p.chave}>{p.nome}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label>Cobrança</Label>
                <div className="grid grid-cols-2 rounded-md border p-0.5">
                  {(["mensal", "anual"] as const).map((p) => (
                    <button key={p} type="button" aria-pressed={c.periodicidade === p} onClick={() => setC({ ...c, periodicidade: p })} className={cn("rounded py-1.5 text-sm", c.periodicidade === p ? "bg-primary text-primary-foreground" : "text-muted-foreground")} data-testid={`comercial-${p}`}>
                      {p === "mensal" ? "Mensal" : "Anual"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-semibold">Adicionais</legend>
              {!adicionaisDisp.length ? (
                <p className="text-sm text-muted-foreground">Nenhum adicional cadastrado. Crie na aba Planos e adicionais.</p>
              ) : (
                adicionaisDisp.map((a) => (
                  <div key={a.chave} className="flex items-center gap-3 rounded-md border px-3 py-2">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" aria-label={a.nome} checked={qtd(a.chave) > 0} onChange={(e) => definirQtd(a.chave, e.target.checked ? 1 : 0)} data-testid={`comercial-adicional-${a.chave}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{a.nome}</p>
                      <p className="text-xs text-muted-foreground">{brl(c.periodicidade === "anual" ? precoAnual(a) : a.preco_mensal)}{c.periodicidade === "anual" ? "/ano" : "/mês"} por unidade</p>
                    </div>
                    {qtd(a.chave) > 0 && (
                      <Input type="number" min={1} className="h-8 w-20" aria-label={`Quantidade de ${a.nome}`} value={qtd(a.chave)} onChange={(e) => definirQtd(a.chave, Math.max(1, Number(e.target.value) || 1))} />
                    )}
                  </div>
                ))
              )}
            </fieldset>

            <fieldset className="grid gap-3">
              <legend className="mb-1 text-sm font-semibold">Desconto de negociação</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <select aria-label="Tipo de desconto" value={c.desconto_tipo ?? ""} onChange={(e) => setC({ ...c, desconto_tipo: (e.target.value || null) as ComercialEmpresa["desconto_tipo"] })} className="h-9 rounded-md border bg-background px-2 text-sm" data-testid="comercial-desconto-tipo">
                  <option value="">Sem desconto</option>
                  <option value="percentual">Percentual (%)</option>
                  <option value="valor">Valor fixo (R$)</option>
                </select>
                {c.desconto_tipo && (
                  <>
                    <Input aria-label="Valor do desconto" inputMode="decimal" value={descontoTxt} onChange={(e) => setDescontoTxt(e.target.value)} placeholder={c.desconto_tipo === "percentual" ? "Ex.: 10" : "Ex.: 50,00"} data-testid="comercial-desconto-valor" />
                    <Input aria-label="Motivo do desconto" value={c.desconto_motivo ?? ""} onChange={(e) => setC({ ...c, desconto_motivo: e.target.value })} placeholder="Motivo" />
                  </>
                )}
              </div>
            </fieldset>

            <fieldset className="grid gap-3">
              <legend className="mb-1 text-sm font-semibold">Taxa de instalação</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="co-taxa">Valor (R$)</Label>
                  <Input id="co-taxa" inputMode="decimal" value={taxaTxt} onChange={(e) => setTaxaTxt(e.target.value)} placeholder={planoSel ? `Padrão do plano: ${brl(planoSel.implantacao ?? 0)}` : ""} data-testid="comercial-taxa" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="co-parc">Parcelas</Label>
                  <Input id="co-parc" type="number" min={1} max={24} value={c.taxa_instalacao_parcelas} onChange={(e) => setC({ ...c, taxa_instalacao_parcelas: Math.min(24, Math.max(1, Number(e.target.value) || 1)) })} />
                </div>
              </div>
            </fieldset>

            <div className="grid gap-1.5">
              <Label htmlFor="co-obs">Observações da negociação</Label>
              <Textarea id="co-obs" rows={2} value={c.observacoes ?? ""} onChange={(e) => setC({ ...c, observacoes: e.target.value })} />
            </div>
          </div>

          <aside className="h-fit rounded-lg border bg-muted/40 p-4 text-sm" aria-live="polite" data-testid="comercial-resumo">
            <p className="font-semibold">Resumo</p>
            {calculo ? (
              <>
                <ul className="mt-3 grid gap-1.5">
                  {calculo.linhas.map((l) => (
                    <li key={l.descricao} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">{l.descricao}{l.qtd > 1 ? ` × ${l.qtd}` : ""}</span>
                      <span className="num shrink-0">{brl(l.total)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 grid gap-1 border-t pt-3">
                  <p className="flex justify-between"><span>Subtotal</span><span className="num">{brl(calculo.subtotal)}</span></p>
                  {calculo.desconto > 0 && <p className="flex justify-between text-emerald-700"><span>Desconto</span><span className="num">− {brl(calculo.desconto)}</span></p>}
                  <p className="flex justify-between text-base font-bold"><span>Total {c.periodicidade === "anual" ? "por ano" : "por mês"}</span><span className="num" data-testid="comercial-total">{brl(calculo.total)}</span></p>
                  {c.periodicidade === "anual" && <p className="flex justify-between text-xs text-muted-foreground"><span>Equivale a</span><span className="num">{brl(calculo.mensal)}/mês</span></p>}
                </div>
                <p className="mt-3 border-t pt-3">
                  Instalação {brl(taxaTxt.trim() ? parseNumber(taxaTxt) ?? 0 : planoSel?.implantacao ?? 0)}
                  {c.taxa_instalacao_parcelas > 1 ? ` em ${c.taxa_instalacao_parcelas}x` : ""}
                </p>
              </>
            ) : (
              <p className="mt-2 text-muted-foreground">Escolha um plano para ver os valores.</p>
            )}
          </aside>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !plano} data-testid="comercial-salvar">{salvar.isPending ? "Salvando..." : "Salvar condições"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
