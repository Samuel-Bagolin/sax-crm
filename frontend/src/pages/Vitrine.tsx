import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Bath, BedDouble, Building2, CalendarCheck, Car, Heart, Loader2, MessageCircle, Ruler, X, XCircle } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { brl } from "@/lib/format";
import { linkWhatsapp } from "@/lib/crm";
import type { Reacao } from "@/lib/diferenciais";
import { cn } from "@/lib/utils";

interface ImovelVitrine {
  id: string;
  codigo: string;
  titulo: string;
  tipo: string;
  finalidade: string;
  bairro: string | null;
  cidade: string;
  quartos: number;
  suites: number;
  banheiros: number;
  vagas: number;
  area_util: number | null;
  valor: number | null;
  condominio: number | null;
  iptu: number | null;
  descricao: string | null;
  fotos: string[];
  disponivel: boolean;
  reacao: Reacao | null;
}

interface VitrinePublica {
  empresa_nome: string;
  cor_primaria: string;
  tem_logo: boolean;
  cliente_nome: string | null;
  corretor_nome: string | null;
  corretor_telefone: string | null;
  mensagem: string | null;
  finalidade: string;
  imoveis: ImovelVitrine[];
}

function Galeria({ fotos, titulo }: { fotos: string[]; titulo: string }) {
  const [atual, setAtual] = useState(0);
  if (!fotos.length)
    return (
      <div className="flex aspect-[4/3] items-center justify-center bg-slate-100 sm:aspect-[16/9]">
        <Building2 className="h-10 w-10 text-slate-300" />
      </div>
    );
  return (
    <div className="relative">
      <div
        className="flex aspect-[4/3] snap-x snap-mandatory overflow-x-auto scroll-smooth sm:aspect-[16/9] [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtual(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {fotos.map((f, i) => (
          <img key={f} src={f} alt={`${titulo}, foto ${i + 1}`} loading={i ? "lazy" : "eager"} className="h-full w-full shrink-0 snap-center object-cover" />
        ))}
      </div>
      {fotos.length > 1 && (
        <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white">
          {atual + 1}/{fotos.length}
        </span>
      )}
    </div>
  );
}

function Cartao({ im, cor, finalidade, onReagir, enviando }: { im: ImovelVitrine; cor: string; finalidade: string; onReagir: (r: Reacao, comentario?: string) => void; enviando: boolean }) {
  const [pedindo, setPedindo] = useState(false);
  const [comentario, setComentario] = useState("");
  const [aberto, setAberto] = useState(false);
  const descricao = im.descricao ?? "";
  const atributos = [
    im.quartos ? { icone: BedDouble, texto: `${im.quartos} quarto${im.quartos > 1 ? "s" : ""}${im.suites ? ` (${im.suites} suíte${im.suites > 1 ? "s" : ""})` : ""}` } : null,
    im.banheiros ? { icone: Bath, texto: `${im.banheiros} banheiro${im.banheiros > 1 ? "s" : ""}` } : null,
    im.vagas ? { icone: Car, texto: `${im.vagas} vaga${im.vagas > 1 ? "s" : ""}` } : null,
    im.area_util ? { icone: Ruler, texto: `${Math.round(im.area_util)} m²` } : null,
  ].filter(Boolean) as { icone: typeof Ruler; texto: string }[];

  return (
    <article className={cn("overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200", im.reacao === "nao_gostei" && "opacity-60")} data-testid={`vitrine-imovel-${im.codigo}`}>
      <Galeria fotos={im.fotos} titulo={im.titulo} />
      <div className="space-y-3 p-4 sm:p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {[im.bairro, im.cidade].filter(Boolean).join(", ")} · Cód. {im.codigo}
          </p>
          <h2 className="mt-0.5 text-lg font-semibold leading-snug">{im.titulo}</h2>
          <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: cor }}>
            {im.valor ? brl(im.valor) : "Valor sob consulta"}
            {finalidade === "locacao" && im.valor ? <span className="text-sm font-medium text-slate-500"> /mês</span> : null}
          </p>
          {(im.condominio || im.iptu) && (
            <p className="text-xs text-slate-500">
              {im.condominio ? `Condomínio ${brl(im.condominio)}` : ""}
              {im.condominio && im.iptu ? " · " : ""}
              {im.iptu ? `IPTU ${brl(im.iptu)}` : ""}
            </p>
          )}
        </div>
        {atributos.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate-700">
            {atributos.map((a) => (
              <li key={a.texto} className="flex items-center gap-1.5">
                <a.icone className="h-4 w-4 text-slate-400" /> {a.texto}
              </li>
            ))}
          </ul>
        )}
        {descricao && (
          <div>
            <p className={cn("whitespace-pre-line text-sm leading-relaxed text-slate-700", !aberto && "line-clamp-3")}>{descricao}</p>
            {descricao.length > 180 && (
              <button type="button" onClick={() => setAberto(!aberto)} className="mt-1 text-sm font-medium" style={{ color: cor }}>
                {aberto ? "Ver menos" : "Ler mais"}
              </button>
            )}
          </div>
        )}

        {!im.disponivel ? (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">Este imóvel não está mais disponível.</p>
        ) : pedindo ? (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <label htmlFor={`com-${im.id}`} className="text-sm font-medium">
              Qual o melhor dia e horário para visitar?
            </label>
            <textarea
              id={`com-${im.id}`}
              rows={2}
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Ex.: sábado de manhã"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setPedindo(false)} className="h-11 flex-1 rounded-xl border border-slate-300 text-sm font-medium">
                Voltar
              </button>
              <button
                type="button"
                disabled={enviando}
                onClick={() => {
                  onReagir("quero_visitar", comentario);
                  setPedindo(false);
                }}
                className="h-11 flex-[2] rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: cor }}
              >
                Pedir visita
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={enviando}
              onClick={() => onReagir("nao_gostei")}
              aria-pressed={im.reacao === "nao_gostei"}
              className={cn("flex h-12 flex-col items-center justify-center rounded-xl border text-xs font-medium", im.reacao === "nao_gostei" ? "border-slate-500 bg-slate-100" : "border-slate-200")}
            >
              <X className="h-4 w-4" /> Não é pra mim
            </button>
            <button
              type="button"
              disabled={enviando}
              onClick={() => onReagir("gostei")}
              aria-pressed={im.reacao === "gostei"}
              className={cn("flex h-12 flex-col items-center justify-center rounded-xl border text-xs font-medium", im.reacao === "gostei" ? "border-rose-400 bg-rose-50 text-rose-700" : "border-slate-200")}
            >
              <Heart className={cn("h-4 w-4", im.reacao === "gostei" && "fill-current")} /> Gostei
            </button>
            <button
              type="button"
              disabled={enviando}
              onClick={() => setPedindo(true)}
              aria-pressed={im.reacao === "quero_visitar"}
              className="flex h-12 flex-col items-center justify-center rounded-xl text-xs font-semibold text-white"
              style={{ backgroundColor: cor, opacity: im.reacao && im.reacao !== "quero_visitar" ? 0.85 : 1 }}
            >
              <CalendarCheck className="h-4 w-4" /> {im.reacao === "quero_visitar" ? "Visita pedida" : "Quero visitar"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export default function Vitrine() {
  const { token = "" } = useParams();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["vitrine", token], queryFn: () => apiGet<VitrinePublica>(`/publico/vitrine/${token}`), retry: false });
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (data) document.title = `Imóveis selecionados, ${data.empresa_nome}`;
  }, [data]);

  const reagir = useMutation({
    mutationFn: ({ id, r, comentario }: { id: string; r: Reacao; comentario?: string }) =>
      apiPost(`/publico/vitrine/${token}/reacao`, { imovel_id: id, reacao: r, comentario: comentario?.trim() || null }),
    onSuccess: (_d, v) => {
      qc.setQueryData<VitrinePublica>(["vitrine", token], (d) => (d ? { ...d, imoveis: d.imoveis.map((i) => (i.id === v.id ? { ...i, reacao: v.r } : i)) } : d));
      setAviso(
        v.r === "quero_visitar"
          ? `Pedido enviado. ${data?.corretor_nome?.split(" ")[0] ?? "O corretor"} vai combinar o horário com você.`
          : v.r === "gostei"
            ? "Anotado! Isso ajuda a encontrar opções parecidas."
            : "Tudo bem, vamos tirar esse da lista.",
      );
      window.setTimeout(() => setAviso(null), 3500);
    },
  });

  if (isLoading)
    return (
      <div className="flex min-h-svh items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  if (error || !data)
    return (
      <div className="flex min-h-svh items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm">
          <XCircle className="mx-auto mb-3 h-10 w-10 text-slate-400" />
          <h1 className="text-lg font-semibold text-slate-900">Link indisponível</h1>
          <p className="mt-2 text-sm text-slate-600">Esta seleção expirou ou foi substituída. Peça um novo link ao seu corretor.</p>
        </div>
      </div>
    );

  const cor = data.cor_primaria;
  const whats = linkWhatsapp(data.corretor_telefone, `Olá${data.corretor_nome ? ` ${data.corretor_nome.split(" ")[0]}` : ""}, vi a seleção de imóveis que você me mandou.`);
  const respondidos = data.imoveis.filter((i) => i.reacao).length;

  return (
    <div className="min-h-svh bg-slate-50 pb-24 text-slate-900">
      <header className="sticky top-0 z-20 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          {data.tem_logo ? (
            <img src={`/api/publico/vitrine/${token}/logo`} alt="" className="h-9 w-9 rounded object-contain" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-md text-sm font-bold text-white" style={{ backgroundColor: cor }}>
              {data.empresa_nome.slice(0, 1)}
            </span>
          )}
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{data.empresa_nome}</p>
          <span className="text-xs tabular-nums text-slate-500">
            {respondidos}/{data.imoveis.length} avaliados
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-3 py-5 sm:px-4">
        <section className="px-1">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">
            {data.cliente_nome ? `${data.cliente_nome}, ` : ""}
            {data.imoveis.length === 1 ? "separamos um imóvel para você" : `separamos ${data.imoveis.length} imóveis para você`}
          </h1>
          {data.mensagem && (
            <blockquote className="mt-3 rounded-xl border-l-4 bg-white p-3 text-sm leading-relaxed text-slate-700 shadow-sm" style={{ borderColor: cor }}>
              {data.mensagem}
              {data.corretor_nome && <footer className="mt-1 text-xs font-medium text-slate-500">{data.corretor_nome}</footer>}
            </blockquote>
          )}
          <p className="mt-3 text-sm text-slate-600">Marque o que achou de cada um. Sua resposta vai direto para o corretor.</p>
        </section>
        {data.imoveis.map((im) => (
          <Cartao key={im.id} im={im} cor={cor} finalidade={data.finalidade} enviando={reagir.isPending} onReagir={(r, c) => reagir.mutate({ id: im.id, r, comentario: c })} />
        ))}
        <p className="px-1 pt-2 text-center text-xs text-slate-500">Endereço completo informado na visita. Valores sujeitos a alteração.</p>
      </main>
      {aviso && (
        <div role="status" className="fixed inset-x-3 bottom-20 z-30 mx-auto max-w-md rounded-xl bg-slate-900 px-4 py-3 text-center text-sm text-white shadow-lg">
          {aviso}
        </div>
      )}
      {whats && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 p-3 backdrop-blur">
          <a href={whats} target="_blank" rel="noreferrer" className="mx-auto flex h-12 max-w-2xl items-center justify-center gap-2 rounded-xl bg-[#25d366] text-sm font-semibold text-[#073b1e]">
            <MessageCircle className="h-5 w-5" /> Falar com {data.corretor_nome?.split(" ")[0] ?? "o corretor"}
          </a>
        </div>
      )}
    </div>
  );
}
