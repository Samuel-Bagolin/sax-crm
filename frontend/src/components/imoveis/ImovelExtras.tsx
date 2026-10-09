import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Copy, ExternalLink, ImagePlus, Loader2, MessageCircle, RefreshCw, Sparkles, Star, Trash2, Unlink } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { brl, dataHoraBR } from "@/lib/format";
import { linkWhatsapp } from "@/lib/crm";
import { STATUS_PROPOSTA, reduzirFoto, urlCompleta, usePlano, type FotoImovel, type Interessado, type Proposta } from "@/lib/diferenciais";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Caixa({ titulo, acao, children, testid }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode; testid?: string }) {
  return (
    <section className="rounded-lg border" data-testid={testid}>
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <p className="flex-1 text-xs font-semibold text-muted-foreground">{titulo}</p>
        {acao}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Galeria do imóvel: enviar (o navegador reduz a foto), reordenar, escolher a capa e excluir. */
export function FotosGaleria({ imovelId }: { imovelId: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(0);
  const [arrastando, setArrastando] = useState(false);
  const chave = ["fotos-imovel", imovelId];
  const { data: fotos = [] } = useQuery({ queryKey: chave, queryFn: () => apiGet<FotoImovel[]>(`/imoveis/${imovelId}/fotos`) });
  const atualizar = (lista?: FotoImovel[]) => {
    if (lista) qc.setQueryData(chave, lista);
    else qc.invalidateQueries({ queryKey: chave });
    qc.invalidateQueries({ queryKey: ["imovel", imovelId] });
    qc.invalidateQueries({ queryKey: ["imoveis"] });
  };

  const subir = async (arquivos: FileList | File[]) => {
    const lista = Array.from(arquivos).filter((f) => f.type.startsWith("image/"));
    if (!lista.length) return;
    setEnviando(lista.length);
    try {
      const fd = new FormData();
      for (const f of lista) fd.append("arquivos", await reduzirFoto(f));
      const r = await fetch(`/api/imoveis/${imovelId}/fotos`, { method: "POST", body: fd });
      const corpo = await r.json().catch(() => null);
      if (!r.ok) throw new Error((corpo && typeof corpo.detail === "string" && corpo.detail) || "Falha no envio");
      atualizar(corpo as FotoImovel[]);
      toast.success(`${lista.length} foto(s) adicionada(s)`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(0);
    }
  };
  const ordenar = useMutation({
    mutationFn: (ids: string[]) => apiPut<FotoImovel[]>(`/imoveis/${imovelId}/fotos/ordem`, { ids }),
    onSuccess: (l) => atualizar(l),
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível reordenar"),
  });
  const remover = useMutation({ mutationFn: (id: string) => apiDelete(`/imoveis/${imovelId}/fotos/${id}`), onSuccess: () => atualizar() });
  const mover = (i: number, d: number) => {
    const ids = fotos.map((f) => f.id);
    const [x] = ids.splice(i, 1);
    ids.splice(Math.max(0, Math.min(ids.length, i + d)), 0, x);
    ordenar.mutate(ids);
  };

  return (
    <Caixa
      titulo={`Fotos (${fotos.length})`}
      testid="fotos-imovel"
      acao={
        <Button variant="ghost" size="sm" className="h-7" onClick={() => input.current?.click()} disabled={enviando > 0}>
          {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Adicionar
        </Button>
      }
    >
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && void subir(e.target.files)} data-testid="fotos-input" />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          void subir(e.dataTransfer.files);
        }}
        className={cn("rounded-md", arrastando && "ring-2 ring-primary")}
      >
        {!fotos.length ? (
          <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-1 rounded-md border border-dashed py-6 text-sm text-muted-foreground hover:bg-muted/40">
            <ImagePlus className="h-6 w-6" />
            Arraste as fotos aqui ou clique para escolher
            <span className="text-xs">A primeira vira a capa. Portais pedem 5 ou mais.</span>
          </button>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {fotos.map((f, i) => (
              <li key={f.id} className="group relative aspect-[4/3] overflow-hidden rounded-md bg-muted">
                <img src={f.url} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                {i === 0 && <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-semibold text-white">Capa</span>}
                <div className="absolute inset-x-0 bottom-0 flex justify-between bg-gradient-to-t from-black/70 to-transparent p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                  <span className="flex gap-0.5">
                    <button type="button" aria-label="Mover para a esquerda" disabled={i === 0} onClick={() => mover(i, -1)} className="rounded bg-white/90 p-0.5 disabled:opacity-40">
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" aria-label="Mover para a direita" disabled={i === fotos.length - 1} onClick={() => mover(i, 1)} className="rounded bg-white/90 p-0.5 disabled:opacity-40">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    {i > 0 && (
                      <button type="button" aria-label="Usar como capa" title="Usar como capa" onClick={() => mover(i, -i)} className="rounded bg-white/90 p-0.5">
                        <Star className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                  <button type="button" aria-label="Excluir foto" onClick={() => remover.mutate(f.id)} className="rounded bg-white/90 p-0.5 text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => input.current?.click()} className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-dashed text-muted-foreground hover:bg-muted/40" aria-label="Adicionar fotos">
                <ImagePlus className="h-5 w-5" />
              </button>
            </li>
          </ul>
        )}
      </div>
    </Caixa>
  );
}

/** Negócios abertos cujo perfil de busca combina com este imóvel. */
export function InteressadosImovel({ imovelId }: { imovelId: string }) {
  const { data = [], isLoading } = useQuery({ queryKey: ["interessados", imovelId], queryFn: () => apiGet<Interessado[]>(`/imoveis/${imovelId}/interessados`) });
  return (
    <Caixa titulo={`Clientes com perfil compatível${data.length ? ` (${data.length})` : ""}`} testid="interessados">
      {isLoading ? (
        <div className="h-10 animate-pulse rounded bg-muted" />
      ) : !data.length ? (
        <p className="text-sm text-muted-foreground">Nenhum negócio aberto com perfil compatível. Preencha o perfil de busca nos negócios para cruzar com a carteira.</p>
      ) : (
        <ul className="space-y-2">
          {data.map((i) => (
            <li key={i.negocio_id} className="flex items-center gap-3">
              <span className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-current text-xs font-bold text-primary">{i.score}</span>
              <div className="min-w-0 flex-1">
                <Link to={`/negocios/${i.negocio_id}`} className="block truncate text-sm font-medium hover:text-primary">
                  {i.cliente_nome ?? i.nome}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {i.corretor_nome ?? "Sem responsável"}
                  {i.alertas.length ? ` · ${i.alertas.join(", ")}` : ""}
                </p>
              </div>
              <Sparkles className="h-4 w-4 text-sax" />
            </li>
          ))}
        </ul>
      )}
    </Caixa>
  );
}

/** Propostas recebidas neste imóvel (de todos os negócios). */
export function PropostasImovel({ imovelId }: { imovelId: string }) {
  const { data = [] } = useQuery({ queryKey: ["propostas-imovel", imovelId], queryFn: () => apiGet<Proposta[]>(`/imoveis/${imovelId}/propostas`) });
  if (!data.length) return null;
  return (
    <Caixa titulo={`Propostas (${data.length})`}>
      <ul className="space-y-2">
        {data.map((p) => (
          <li key={p.id} className="flex items-center gap-3 text-sm">
            <Link to={`/negocios/${p.negocio_id}`} className="num min-w-0 flex-1 font-semibold hover:text-primary">
              {brl(p.valor)} <span className="font-normal text-muted-foreground">· {p.autor === "cliente" ? "cliente" : "proprietário"} · {dataHoraBR(p.created_at)}</span>
            </Link>
            <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", STATUS_PROPOSTA[p.status].classe)}>{STATUS_PROPOSTA[p.status].rotulo}</span>
          </li>
        ))}
      </ul>
    </Caixa>
  );
}

/** Link do relatório para o proprietário acompanhar o imóvel sem login. */
export function RelatorioProprietarioCard({ imovelId, codigo }: { imovelId: string; codigo: string }) {
  const qc = useQueryClient();
  const chave = ["relatorio-link", imovelId];
  const { data } = useQuery({ queryKey: chave, queryFn: () => apiGet<{ url: string | null; proprietario_nome: string | null; proprietario_telefone: string | null }>(`/imoveis/${imovelId}/relatorio-proprietario`) });
  const gerar = useMutation({
    mutationFn: (novo: boolean) => apiPost<typeof data>(`/imoveis/${imovelId}/relatorio-proprietario${novo ? "?novo=true" : ""}`),
    onSuccess: (d) => qc.setQueryData(chave, d),
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível gerar o link"),
  });
  const revogar = useMutation({ mutationFn: () => apiDelete(`/imoveis/${imovelId}/relatorio-proprietario`), onSuccess: () => qc.invalidateQueries({ queryKey: chave }) });
  const url = urlCompleta(data?.url);
  const primeiro = data?.proprietario_nome?.split(" ")[0] ?? "";
  const whats = url
    ? linkWhatsapp(data?.proprietario_telefone, `Olá${primeiro ? ` ${primeiro}` : ""}! Aqui você acompanha visitas, interessados e propostas do seu imóvel ${codigo}, sempre atualizado: ${url}`)
    : null;
  return (
    <Caixa titulo="Relatório do proprietário" testid="relatorio-proprietario">
      {!data?.url ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">Um link para o proprietário ver visitas, retorno dos clientes e propostas, sem precisar ligar para perguntar.</p>
          <Button size="sm" onClick={() => gerar.mutate(false)} disabled={gerar.isPending}>
            Gerar link
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-xs">{url}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copiar link"
              onClick={() => {
                void navigator.clipboard?.writeText(url);
                toast.success("Link copiado");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <a href={url} target="_blank" rel="noreferrer" className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted" aria-label="Abrir relatório">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="flex flex-wrap gap-2">
            {whats && (
              <a href={whats} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#25d366] px-3 text-xs font-semibold text-[#073b1e]">
                <MessageCircle className="h-3.5 w-3.5" /> Enviar para {primeiro || "o proprietário"}
              </a>
            )}
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => gerar.mutate(true)}>
              <RefreshCw className="h-3 w-3" /> Trocar link
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => revogar.mutate()}>
              <Unlink className="h-3 w-3" /> Desativar
            </Button>
          </div>
        </div>
      )}
    </Caixa>
  );
}

/** Blocos extras da ficha do imóvel, conforme o plano. */
export default function ImovelExtras({ imovelId, codigo }: { imovelId: string; codigo: string }) {
  const { tem } = usePlano();
  return (
    <>
      {tem("match") && <InteressadosImovel imovelId={imovelId} />}
      {tem("propostas") && <PropostasImovel imovelId={imovelId} />}
      {tem("proprietario") && <RelatorioProprietarioCard imovelId={imovelId} codigo={codigo} />}
    </>
  );
}
