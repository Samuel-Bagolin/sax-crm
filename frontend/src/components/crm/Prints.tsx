import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, Loader2, Lock, Trash2, X } from "lucide-react";
import { apiDelete, apiGet, apiPost, detalheErro } from "@/lib/api";
import { prepararImagem } from "@/lib/imagem";
import { urlApi } from "@/lib/suporte";
import { dataHoraBR } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/* Prints anexados ao negócio: só quem anexou e a gestão (perfis de administração) veem. */

export interface AnexoPrint {
  id: string;
  negocio_id: string | null;
  atividade_id: string | null;
  atividade_assunto: string | null;
  nome: string;
  tamanho: number;
  autor_nome: string | null;
  autor_pessoa_id: string | null;
  url: string;
  created_at: string;
}

export const TIPOS_COM_PRINT = ["ligacao", "whatsapp", "email", "visita", "reuniao", "almoco"];
const LIMITE_B64 = 1_150_000; // ~860 KB de imagem: cabe no documento do banco

/** Reduz no navegador (lado maior 1600 px, JPEG) e baixa a qualidade até caber. */
export async function prepararPrint(arquivo: File): Promise<{ nome: string; base64: string }> {
  if (!arquivo.type.startsWith("image/")) throw new Error(`${arquivo.name}: envie uma imagem (JPG, PNG ou WEBP)`);
  for (const max of [1600, 1280, 1000]) {
    const { base64 } = await prepararImagem(arquivo, { max, logo: false });
    if (base64.length <= LIMITE_B64) return { nome: arquivo.name, base64 };
  }
  throw new Error(`${arquivo.name}: imagem grande demais`);
}

/** Campo de escolher prints (até 3), já reduzidos e prontos para mandar junto com a atividade. */
export function EscolherPrints({ valor, onChange, obrigatorio }: { valor: { nome: string; base64: string }[]; onChange: (v: { nome: string; base64: string }[]) => void; obrigatorio?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const escolher = async (files: FileList | null) => {
    if (!files?.length) return;
    setLendo(true);
    try {
      const novos = [];
      for (const f of Array.from(files).slice(0, 3 - valor.length)) novos.push(await prepararPrint(f));
      onChange([...valor, ...novos]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler a imagem");
    } finally {
      setLendo(false);
      if (ref.current) ref.current.value = "";
    }
  };
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => ref.current?.click()} disabled={lendo || valor.length >= 3} data-testid="print-escolher">
          {lendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Anexar print{obrigatorio ? " (obrigatório)" : ""}
        </Button>
        {valor.map((p, i) => (
          <span key={i} className="inline-flex max-w-[12rem] items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs">
            <span className="truncate">{p.nome}</span>
            <button type="button" aria-label="Tirar" onClick={() => onChange(valor.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
          </span>
        ))}
      </div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" /> Só você e a gestão veem o print.</p>
      <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => escolher(e.target.files)} data-testid="print-arquivo" />
    </div>
  );
}

export function PrintsPainel({ negocioId }: { negocioId: string }) {
  const qc = useQueryClient();
  const { principal, isAdmin } = useAuth();
  const ref = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState<AnexoPrint | null>(null);
  const { data: prints = [] } = useQuery({
    queryKey: ["anexos", negocioId],
    queryFn: () => apiGet<AnexoPrint[]>(`/leads/${negocioId}/anexos`),
  });
  const enviar = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) await apiPost(`/leads/${negocioId}/anexos`, await prepararPrint(f));
    },
    onSuccess: () => { toast.success("Print anexado"); qc.invalidateQueries({ queryKey: ["anexos", negocioId] }); },
    onError: (e) => toast.error(e instanceof Error && !("status" in e) ? e.message : detalheErro(e) ?? "Não foi possível anexar"),
  });
  const excluir = useMutation({
    mutationFn: (id: string) => apiDelete(`/anexos/${id}`),
    onSuccess: () => { setAberto(null); qc.invalidateQueries({ queryKey: ["anexos", negocioId] }); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível excluir"),
  });
  return (
    <section className="rounded-lg border bg-card" data-testid="prints-painel">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          Prints anexados {prints.length > 0 && <span className="text-muted-foreground">({prints.length})</span>}
        </h3>
        <Button variant="ghost" size="sm" onClick={() => ref.current?.click()} disabled={enviar.isPending}>
          {enviar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Anexar
        </Button>
        <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) enviar.mutate(f); }} />
      </header>
      {prints.length ? (
        <ul className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-4">
          {prints.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setAberto(p)} className="block w-full overflow-hidden rounded-md border bg-muted text-left" title={p.atividade_assunto ?? p.nome}>
                <img src={urlApi(p.url)} alt={p.nome} loading="lazy" className="aspect-square w-full object-cover object-top" />
                <span className="block truncate px-1.5 py-1 text-[11px] text-muted-foreground">{p.autor_nome ?? "Planilha"} · {dataHoraBR(p.created_at).slice(0, 5)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-1.5 px-4 py-4 text-sm text-muted-foreground"><Lock className="h-3.5 w-3.5" /> Nenhum print que você possa ver. Só quem anexou e a gestão veem.</p>
      )}
      {aberto && (
        <Dialog open onOpenChange={(o) => !o && setAberto(null)}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle className="truncate">{aberto.atividade_assunto ?? aberto.nome}</DialogTitle>
              <DialogDescription>Anexado por {aberto.autor_nome ?? "planilha"} em {dataHoraBR(aberto.created_at)}</DialogDescription>
            </DialogHeader>
            <a href={urlApi(aberto.url)} target="_blank" rel="noreferrer"><img src={urlApi(aberto.url)} alt={aberto.nome} className="mx-auto max-h-[70vh] w-auto rounded-md border" /></a>
            {(isAdmin || aberto.autor_pessoa_id === principal?.pessoa_id) && (
              <Button variant="ghost" className="mr-auto text-destructive" onClick={() => excluir.mutate(aberto.id)} disabled={excluir.isPending}>
                <Trash2 className="h-4 w-4" /> Excluir print
              </Button>
            )}
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
