import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Eye, EyeOff, ImagePlus, Loader2, Package, Pencil, Plus, Search, Sparkles, Star, Trash2, Wrench } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { urlApi } from "@/lib/suporte";
import type { ItemSite, TipoItemSite } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const TIPOS_ITEM: Record<TipoItemSite, { rotulo: string; icone: typeof Wrench }> = {
  servico: { rotulo: "Serviço", icone: Wrench },
  tratamento: { rotulo: "Tratamento", icone: Sparkles },
  produto: { rotulo: "Produto", icone: Package },
};

type Form = Omit<ItemSite, "id" | "tem_foto" | "foto_v" | "servico_id">;

const VAZIO = (tipo: TipoItemSite): Form => ({
  tipo, nome: "", descricao: "", categoria: "", preco: null, preco_a_partir: false, duracao_min: null, ativo: true, destaque: false, ordem: 50,
});

async function lerFoto(arquivo: File): Promise<{ base64: string; mime: "image/jpeg" }> {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { base64: canvas.toDataURL("image/jpeg", 0.8).split(",")[1], mime: "image/jpeg" };
}

export function precoItem(i: Pick<ItemSite, "preco" | "preco_a_partir">) {
  if (i.preco == null) return "Sob consulta";
  if (i.preco === 0) return "Sem custo";
  return `${i.preco_a_partir ? "A partir de " : ""}${brl(i.preco)}`;
}

/** Serviços, tratamentos e produtos que aparecem no site. */
export function CatalogoSite({ pode, tipoPadrao, titulo, podeImportar }: { pode: boolean; tipoPadrao: TipoItemSite; titulo: string; podeImportar: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["site-itens"], queryFn: () => apiGet<ItemSite[]>("/site-imobiliaria/itens") });
  const [edit, setEdit] = useState<ItemSite | "novo" | null>(null);
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<TipoItemSite | "todos">("todos");
  const atualizar = () => { qc.invalidateQueries({ queryKey: ["site-itens"] }); };

  const alterar = useMutation({
    mutationFn: (i: ItemSite) => apiPut<ItemSite>(`/site-imobiliaria/itens/${i.id}`, {
      tipo: i.tipo, nome: i.nome, descricao: i.descricao, categoria: i.categoria, preco: i.preco, preco_a_partir: i.preco_a_partir,
      duracao_min: i.duracao_min, ativo: i.ativo, destaque: i.destaque, ordem: i.ordem,
    }),
    onSuccess: atualizar,
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível alterar."),
  });
  const importar = useMutation({
    mutationFn: () => apiPost<{ importados: number }>("/site-imobiliaria/itens/importar"),
    onSuccess: (r) => { atualizar(); toast.success(r.importados ? `${r.importados} serviço(s) da agenda entraram no site.` : "Todos os serviços da agenda já estão no site."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível importar."),
  });

  const lista = q.data ?? [];
  const filtrada = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return lista.filter((i) => (tipo === "todos" || i.tipo === tipo) && (!t || `${i.nome} ${i.categoria} ${i.descricao}`.toLowerCase().includes(t)));
  }, [lista, busca, tipo]);

  if (q.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;

  return (
    <div className="grid gap-3" data-testid="site-catalogo">
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{titulo}</h3>
          <p className="text-sm text-muted-foreground">Cadastre o que você oferece: serviços, tratamentos e produtos. Cada item tem botão de WhatsApp no site.</p>
        </div>
        {pode && (
          <div className="flex flex-wrap gap-2">
            {podeImportar && (
              <Button variant="outline" size="sm" onClick={() => importar.mutate()} disabled={importar.isPending} data-testid="site-importar">
                {importar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Trazer serviços da agenda
              </Button>
            )}
            <Button size="sm" onClick={() => setEdit("novo")} data-testid="site-item-novo"><Plus className="h-4 w-4" /> Novo item</Button>
          </div>
        )}
      </div>

      {lista.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Buscar no catálogo" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar no catálogo" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["todos", "servico", "tratamento", "produto"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTipo(t)} aria-pressed={tipo === t}
                className={cn("rounded-full border px-3 py-1.5 text-sm", tipo === t ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                {t === "todos" ? `Todos (${lista.length})` : `${TIPOS_ITEM[t].rotulo}s (${lista.filter((i) => i.tipo === t).length})`}
              </button>
            ))}
          </div>
        </div>
      )}

      {!filtrada.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {lista.length ? "Nada com esse filtro." : "O catálogo está vazio. Clique em Novo item para colocar o primeiro no site."}
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card" data-testid="site-lista-itens">
          {filtrada.map((i) => {
            const T = TIPOS_ITEM[i.tipo];
            return (
              <li key={i.id} className={cn("flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center", !i.ativo && "opacity-60")}>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {i.tem_foto ? <img src={urlApi(`/api/site-imobiliaria/itens/${i.id}/foto?v=${i.foto_v}`)} alt="" className="h-full w-full object-cover" loading="lazy" />
                      : <T.icone className="h-5 w-5 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{i.nome}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {T.rotulo}{i.categoria ? `, ${i.categoria}` : ""}, {precoItem(i)}{i.duracao_min ? `, ${i.duracao_min} min` : ""}{!i.ativo ? ", fora do site" : ""}
                    </p>
                  </div>
                </div>
                {pode && (
                  <div className="flex items-center gap-1 pl-[76px] sm:pl-0">
                    <button type="button" onClick={() => alterar.mutate({ ...i, destaque: !i.destaque })} aria-pressed={i.destaque}
                      aria-label={i.destaque ? "Tirar dos destaques" : "Mostrar nos destaques"} title={i.destaque ? "Tirar dos destaques" : "Mostrar nos destaques"} className="rounded-md p-1.5 hover:bg-muted">
                      <Star className={cn("h-4 w-4", i.destaque ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} />
                    </button>
                    <button type="button" onClick={() => alterar.mutate({ ...i, ativo: !i.ativo })} aria-label={i.ativo ? "Tirar do site" : "Mostrar no site"}
                      title={i.ativo ? "Tirar do site" : "Mostrar no site"} className="rounded-md p-1.5 hover:bg-muted" data-testid={`site-item-ativo-${i.id}`}>
                      {i.ativo ? <Eye className="h-4 w-4 text-emerald-600" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                    </button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setEdit(i)} aria-label={`Editar ${i.nome}`}><Pencil className="h-4 w-4" /></Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {edit && <ItemDialog item={edit === "novo" ? null : edit} tipoPadrao={tipoPadrao} onClose={() => setEdit(null)} onSalvo={atualizar} />}
    </div>
  );
}

function ItemDialog({ item, tipoPadrao, onClose, onSalvo }: { item: ItemSite | null; tipoPadrao: TipoItemSite; onClose: () => void; onSalvo: () => void }) {
  const [f, setF] = useState<Form>(item ? { ...item } : VAZIO(tipoPadrao));
  const [atual, setAtual] = useState<ItemSite | null>(item);
  const ref = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { ...f, nome: f.nome.trim(), preco: f.preco === null || Number.isNaN(f.preco) ? null : f.preco, duracao_min: f.tipo === "produto" ? null : f.duracao_min || null };
      return atual ? apiPut<ItemSite>(`/site-imobiliaria/itens/${atual.id}`, corpo) : apiPost<ItemSite>("/site-imobiliaria/itens", corpo);
    },
    onSuccess: (r) => { onSalvo(); if (!atual) { setAtual(r); toast.success("Item criado. Se quiser, envie uma foto."); } else { toast.success("Item salvo."); onClose(); } },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar."),
  });
  const foto = useMutation({
    mutationFn: async (arq: File) => apiPut<ItemSite>(`/site-imobiliaria/itens/${atual!.id}/foto`, await lerFoto(arq)),
    onSuccess: (r) => { setAtual(r); onSalvo(); toast.success("Foto enviada."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível enviar a foto."),
  });
  const excluir = useMutation({
    mutationFn: () => apiDelete(`/site-imobiliaria/itens/${atual!.id}`),
    onSuccess: () => { onSalvo(); toast.success("Item excluído."); onClose(); },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{atual ? "Editar item do site" : "Novo item do site"}</DialogTitle>
          <DialogDescription>Aparece no site com nome, preço e botão de WhatsApp.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo">
            {(Object.keys(TIPOS_ITEM) as TipoItemSite[]).map((t) => {
              const T = TIPOS_ITEM[t];
              return (
                <button key={t} type="button" role="radio" aria-checked={f.tipo === t} onClick={() => set("tipo", t)}
                  className={cn("flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm", f.tipo === t ? "border-primary bg-accent/50 ring-2 ring-primary/25" : "hover:bg-muted")} data-testid={`item-tipo-${t}`}>
                  <T.icone className="h-4 w-4" /> {T.rotulo}
                </button>
              );
            })}
          </div>
          <div className="grid gap-1.5"><Label htmlFor="it-nome">Nome</Label>
            <Input id="it-nome" value={f.nome} onChange={(e) => set("nome", e.target.value)} maxLength={80} data-testid="item-nome" /></div>
          <div className="grid gap-1.5"><Label htmlFor="it-cat">Categoria (opcional)</Label>
            <Input id="it-cat" value={f.categoria} onChange={(e) => set("categoria", e.target.value)} maxLength={40} placeholder="Ex.: Facial, Corte, Prevenção" /></div>
          <div className="grid gap-1.5"><Label htmlFor="it-desc">Descrição</Label>
            <Textarea id="it-desc" rows={3} value={f.descricao} onChange={(e) => set("descricao", e.target.value)} maxLength={600} placeholder="O que é, para quem é, o que está incluso." /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="it-preco">Preço (R$)</Label>
              <Input id="it-preco" type="number" min={0} step="0.01" value={f.preco ?? ""} placeholder="Vazio = sob consulta"
                onChange={(e) => set("preco", e.target.value === "" ? null : Math.max(0, Number(e.target.value)))} data-testid="item-preco" />
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="h-3.5 w-3.5 accent-[var(--primary)]" checked={f.preco_a_partir} onChange={(e) => set("preco_a_partir", e.target.checked)} /> Mostrar como "a partir de"</label>
            </div>
            {f.tipo !== "produto" && (
              <div className="grid content-start gap-1.5"><Label htmlFor="it-dur">Duração (minutos)</Label>
                <Input id="it-dur" type="number" min={5} step={5} value={f.duracao_min ?? ""} onChange={(e) => set("duracao_min", e.target.value === "" ? null : Number(e.target.value))} /></div>
            )}
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={f.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Mostrar no site</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={f.destaque} onChange={(e) => set("destaque", e.target.checked)} /> Destaque (aparece primeiro)</label>
          </div>
          {atual && (
            <div className="flex items-center gap-3 rounded-lg border p-2">
              <div className="flex h-16 w-20 items-center justify-center overflow-hidden rounded-md bg-muted">
                {atual.tem_foto ? <img src={urlApi(`/api/site-imobiliaria/itens/${atual.id}/foto?v=${atual.foto_v}`)} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
              </div>
              <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && foto.mutate(e.target.files[0])} data-testid="item-foto" />
              <Button type="button" size="sm" variant="outline" onClick={() => ref.current?.click()} disabled={foto.isPending}>
                {foto.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {atual.tem_foto ? "Trocar foto" : "Enviar foto"}
              </Button>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {atual ? <Button variant="ghost" className="text-destructive" onClick={() => window.confirm(`Excluir ${atual.nome} do site?`) && excluir.mutate()}><Trash2 className="h-4 w-4" /> Excluir</Button> : <span />}
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || f.nome.trim().length < 2} data-testid="item-salvar">
            {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {atual ? "Salvar item" : "Criar item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
