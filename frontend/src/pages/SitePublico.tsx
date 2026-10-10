import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bath,
  BedDouble,
  CalendarDays,
  Car,
  ChevronLeft,
  Cog,
  Fuel,
  Gauge,
  ChevronRight,
  Clock3,
  Facebook,
  Images,
  Instagram,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Ruler,
  Search,
  Share2,
  Star,
  X,
} from "lucide-react";
import { apiGet, apiPost, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import { linkWhatsapp } from "@/lib/crm";
import type { ImovelSitePublico, MarcaSite } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Site público da imobiliária. Cores, fonte, logo e textos vêm do CRM (tela Meu site).
   Paleta neutra fixa para o resto, assim qualquer marca fica legível e o site não herda o tema
   escuro do CRM. */

interface Pagina {
  marca: MarcaSite;
  imoveis: ImovelSitePublico[];
}
interface Detalhe {
  marca: MarcaSite;
  imovel: ImovelSitePublico;
}

const TINTA = "#1d2330";
const CINZA = "#5b6474";
const NEVOA = "#f3f5f8";
const LINHA = "#e3e7ee";

const FONTES: Record<MarcaSite["fonte"], { titulo: string; corpo: string; css: string }> = {
  moderna: { titulo: "'Plus Jakarta Sans'", corpo: "'Plus Jakarta Sans'", css: "Plus+Jakarta+Sans:wght@400;500;600;700;800" },
  elegante: { titulo: "'Fraunces'", corpo: "'Figtree'", css: "Fraunces:opsz,wght@9..144,500;9..144,600&family=Figtree:wght@400;500;600;700" },
  classica: { titulo: "'Lora'", corpo: "'Source Sans 3'", css: "Lora:wght@500;600;700&family=Source+Sans+3:wght@400;500;600;700" },
};

const TIPO: Record<string, string> = {
  apartamento: "Apartamento", casa: "Casa", terreno: "Terreno", comercial: "Comercial",
  hatch: "Hatch", sedan: "Sedã", suv: "SUV", picape: "Picape", utilitario: "Utilitário", moto: "Moto", esportivo: "Esportivo", outro: "Outro",
};
const CAMBIO: Record<string, string> = { manual: "Manual", automatico: "Automático", cvt: "CVT", automatizado: "Automatizado" };
const COMBUSTIVEL: Record<string, string> = { flex: "Flex", gasolina: "Gasolina", etanol: "Etanol", diesel: "Diesel", eletrico: "Elétrico", hibrido: "Híbrido", gnv: "GNV" };

/** Palavras do site conforme o estoque: imóveis (imobiliária) ou veículos (loja). */
function vocab(marca: MarcaSite) {
  const v = marca.segmento === "veiculos";
  return {
    veiculo: v,
    um: v ? "veículo" : "imóvel",
    uns: v ? "veículos" : "imóveis",
    Uns: v ? "Veículos" : "Imóveis",
    tipo: v ? "Categoria" : "Tipo de imóvel",
    profissional: v ? "vendedor" : "corretor",
  };
}

function textoSobre(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? TINTA : "#ffffff";
}

function preco(i: ImovelSitePublico): { valor: string; sufixo: string; legenda: string } {
  if (i.finalidade === "locacao" || (i.finalidade === "ambos" && !i.valor_venda)) {
    return { valor: i.valor_aluguel ? brl(i.valor_aluguel) : "Consulte", sufixo: i.valor_aluguel ? "/mês" : "", legenda: "Aluguel" };
  }
  return { valor: i.valor_venda ? brl(i.valor_venda) : "Consulte", sufixo: "", legenda: i.finalidade === "ambos" ? "Venda ou aluguel" : "Venda" };
}

function msgWhats(marca: MarcaSite, i?: ImovelSitePublico): string {
  const V = vocab(marca);
  if (!i) return `Olá! Vim pelo site da ${marca.nome} e quero ajuda para encontrar um ${V.um}.`;
  return (marca.mensagem_whatsapp || `Olá! Vi o ${V.um} {codigo} no site e quero mais informações.`)
    .replaceAll("{codigo}", i.codigo)
    .replaceAll("{titulo}", i.titulo)
    .concat(`\n${window.location.origin}/s/${marca.slug}/imovel/${i.codigo}`);
}

function registrar(slug: string, tipo: "visualizacao" | "whatsapp", imovel_id?: string) {
  try {
    void fetch(`/api/publico/site/${slug}/evento`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, imovel_id: imovel_id ?? null }),
    });
  } catch {
    /* métrica não pode atrapalhar o visitante */
  }
}

function useTema(marca: MarcaSite | undefined, titulo: string) {
  useEffect(() => {
    if (!marca) return;
    const f = FONTES[marca.fonte] ?? FONTES.moderna;
    const id = "site-fontes";
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = `https://fonts.googleapis.com/css2?family=${f.css}&display=swap`;
    const raiz = document.documentElement;
    const tinhaEscuro = raiz.classList.contains("dark");
    raiz.classList.remove("dark");
    return () => {
      if (tinhaEscuro) raiz.classList.add("dark");
    };
  }, [marca]);
  useEffect(() => {
    if (titulo) document.title = titulo;
  }, [titulo]);
}

function estilo(marca: MarcaSite): CSSProperties {
  const f = FONTES[marca.fonte] ?? FONTES.moderna;
  return {
    "--p": marca.cor_primaria,
    "--p-txt": textoSobre(marca.cor_primaria),
    "--d": marca.cor_destaque,
    "--d-txt": textoSobre(marca.cor_destaque),
    "--f-titulo": `${f.titulo}, ui-sans-serif, system-ui, sans-serif`,
    "--f-corpo": `${f.corpo}, ui-sans-serif, system-ui, sans-serif`,
    fontFamily: "var(--f-corpo)",
    color: TINTA,
    background: "#ffffff",
  } as CSSProperties;
}

// ------------------------------------------------------------------ peças

function Logo({ marca, claro }: { marca: MarcaSite; claro?: boolean }) {
  const [erro, setErro] = useState(false);
  if (marca.logo_url && !erro) {
    return <img src={marca.logo_url} alt={marca.nome} onError={() => setErro(true)} className="h-10 w-auto max-w-[180px] object-contain sm:h-11" />;
  }
  const iniciais = marca.nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold" style={{ background: "var(--p)", color: "var(--p-txt)" }}>
        {iniciais}
      </span>
      <span className="text-[17px] font-bold leading-tight" style={{ fontFamily: "var(--f-titulo)", color: claro ? "#fff" : TINTA }}>
        {marca.nome}
      </span>
    </span>
  );
}

function IconeWhats({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.47 1.07 2.88 1.21 3.08.15.2 2.1 3.2 5.08 4.49.71.3 1.27.49 1.7.63.72.23 1.37.2 1.88.12.57-.09 1.75-.72 2-1.4.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.8h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.9-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.89 9.88m8.41-18.3A11.81 11.81 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.9c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.9 0-3.18-1.24-6.16-3.48-8.4" />
    </svg>
  );
}

function BotaoWhats({ marca, imovel, children, className, grande }: { marca: MarcaSite; imovel?: ImovelSitePublico; children?: ReactNode; className?: string; grande?: boolean }) {
  const href = linkWhatsapp(marca.whatsapp, msgWhats(marca, imovel));
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => registrar(marca.slug ?? "", "whatsapp", imovel?.id)}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full bg-[#1fa855] font-semibold text-white transition hover:bg-[#178a45] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1fa855]",
        grande ? "h-12 px-6 text-[15px]" : "h-10 px-4 text-sm",
        className,
      )}
    >
      <IconeWhats className={grande ? "h-5 w-5" : "h-4 w-4"} />
      {children ?? "Chamar no WhatsApp"}
    </a>
  );
}

function Specs({ i, compacto }: { i: ImovelSitePublico; compacto?: boolean }) {
  const area = i.area_util ?? i.area_total;
  const itens = (i.marca ? [
    { icone: CalendarDays, txt: `${i.ano_fabricacao}/${i.ano_modelo}`, titulo: "Ano" },
    { icone: Gauge, txt: `${(i.km ?? 0).toLocaleString("pt-BR")} km`, titulo: "Quilometragem" },
    i.cambio ? { icone: Cog, txt: CAMBIO[i.cambio] ?? i.cambio, titulo: "Câmbio" } : null,
    i.combustivel ? { icone: Fuel, txt: COMBUSTIVEL[i.combustivel] ?? i.combustivel, titulo: "Combustível" } : null,
  ] : [
    area ? { icone: Ruler, txt: `${area.toLocaleString("pt-BR")} m²`, titulo: "Área" } : null,
    i.quartos ? { icone: BedDouble, txt: `${i.quartos} ${i.quartos > 1 ? "quartos" : "quarto"}`, titulo: "Quartos" } : null,
    i.banheiros ? { icone: Bath, txt: `${i.banheiros} ${i.banheiros > 1 ? "banheiros" : "banheiro"}`, titulo: "Banheiros" } : null,
    i.vagas ? { icone: Car, txt: `${i.vagas} ${i.vagas > 1 ? "vagas" : "vaga"}`, titulo: "Vagas" } : null,
  ]).filter(Boolean) as { icone: typeof Ruler; txt: string; titulo: string }[];
  if (!itens.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1.5", compacto ? "text-[13px]" : "text-sm")} style={{ color: CINZA }}>
      {itens.map(({ icone: I, txt, titulo }) => (
        <li key={titulo} className="flex items-center gap-1.5" title={titulo}>
          <I className="h-4 w-4 shrink-0" style={{ color: "var(--p)" }} />
          {txt}
        </li>
      ))}
    </ul>
  );
}

function Foto({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  const [erro, setErro] = useState(false);
  if (!src || erro) {
    return (
      <div className={cn("flex items-center justify-center", className)} style={{ background: NEVOA, color: "#a3abb8" }}>
        <Images className="h-8 w-8" />
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setErro(true)} className={cn("object-cover", className)} />;
}

function Card({ i, marca }: { i: ImovelSitePublico; marca: MarcaSite }) {
  const p = preco(i);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl bg-white" style={{ boxShadow: `0 0 0 1px ${LINHA}` }}>
      <Link to={`/s/${marca.slug}/imovel/${i.codigo}`} className="absolute inset-0 z-10 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--p)]" aria-label={`Ver ${i.titulo}`} />
      <div className="relative aspect-[4/3] overflow-hidden">
        <Foto src={i.foto_url} alt={i.titulo} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
        <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold" style={{ color: TINTA }}>
          {TIPO[i.tipo] ?? i.tipo}, {p.legenda.toLowerCase()}
        </span>
        {i.reservado && (
          <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 px-3 py-2 text-sm font-semibold" style={{ background: "var(--d)", color: "var(--d-txt)" }}>
            <Clock3 className="h-4 w-4" /> Reservado
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <p className="text-[22px] font-bold leading-none tracking-tight" style={{ fontFamily: "var(--f-titulo)" }}>
          {p.valor}
          {p.sufixo && <span className="text-sm font-medium" style={{ color: CINZA }}> {p.sufixo}</span>}
        </p>
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug">{i.titulo}</h3>
        <p className="flex items-center gap-1 text-[13px]" style={{ color: CINZA }}>
          {i.marca ? <>{[i.cor, i.aceita_troca ? "aceita troca" : null].filter(Boolean).join(", ")}</> : <>
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {[i.bairro, i.cidade].filter(Boolean).join(", ")}</>}
        </p>
        <div className="mt-auto pt-1">
          <Specs i={i} compacto />
        </div>
      </div>
    </article>
  );
}

function Topo({ marca, sobre }: { marca: MarcaSite; sobre?: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur" style={{ borderColor: LINHA }}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:h-[72px] sm:px-6">
        <Link to={`/s/${marca.slug}`} className="flex items-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--p)]">
          <Logo marca={marca} />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <a href={`/s/${marca.slug}#imoveis`} className="hidden rounded-full px-3 py-2 text-sm font-medium hover:bg-[#f3f5f8] sm:block">{vocab(marca).Uns}</a>
          {sobre && <a href={`/s/${marca.slug}#sobre`} className="hidden rounded-full px-3 py-2 text-sm font-medium hover:bg-[#f3f5f8] sm:block">Quem somos</a>}
          <a href={`/s/${marca.slug}#contato`} className="hidden rounded-full px-3 py-2 text-sm font-medium hover:bg-[#f3f5f8] md:block">Contato</a>
          <BotaoWhats marca={marca} className="ml-1">
            <span className="hidden sm:inline">Chamar no WhatsApp</span>
            <span className="sm:hidden">WhatsApp</span>
          </BotaoWhats>
        </nav>
      </div>
    </header>
  );
}

function Rodape({ marca }: { marca: MarcaSite }) {
  return (
    <footer style={{ background: TINTA, color: "#c9cfda" }}>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.2fr_1fr_1fr]">
        <div className="space-y-3">
          <div className="inline-block rounded-xl bg-white p-2.5">
            <Logo marca={marca} />
          </div>
          {marca.creci && <p className="text-sm">CRECI {marca.creci}</p>}
        </div>
        <div className="space-y-2 text-sm">
          {(marca.telefone || marca.email || marca.horario) && <p className="font-semibold text-white">Atendimento</p>}
          {marca.telefone && (
            <a href={`tel:${marca.telefone.replace(/\D/g, "")}`} className="flex items-center gap-2 hover:text-white">
              <Phone className="h-4 w-4" /> {marca.telefone}
            </a>
          )}
          {marca.email && (
            <a href={`mailto:${marca.email}`} className="flex items-center gap-2 break-all hover:text-white">
              <Mail className="h-4 w-4 shrink-0" /> {marca.email}
            </a>
          )}
          {marca.horario && (
            <p className="flex items-center gap-2">
              <Clock3 className="h-4 w-4" /> {marca.horario}
            </p>
          )}
        </div>
        <div className="space-y-2 text-sm">
          {marca.endereco && (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {marca.endereco}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            {marca.instagram && (
              <a href={`https://instagram.com/${marca.instagram}`} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="rounded-full bg-white/10 p-2 hover:bg-white/20">
                <Instagram className="h-4 w-4" />
              </a>
            )}
            {marca.facebook && (
              <a href={marca.facebook.startsWith("http") ? marca.facebook : `https://facebook.com/${marca.facebook}`} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="rounded-full bg-white/10 p-2 hover:bg-white/20">
                <Facebook className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-[#8d96a6] sm:px-6">
          © {new Date().getFullYear()} {marca.nome}. Site feito com SAX CRM.
        </p>
      </div>
    </footer>
  );
}

function WhatsFlutuante({ marca, imovel }: { marca: MarcaSite; imovel?: ImovelSitePublico }) {
  const href = linkWhatsapp(marca.whatsapp, msgWhats(marca, imovel));
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Conversar no WhatsApp"
      onClick={() => registrar(marca.slug ?? "", "whatsapp", imovel?.id)}
      className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#1fa855] text-white shadow-[0_10px_30px_-8px_rgba(31,168,85,.7)] transition hover:scale-105 hover:bg-[#178a45]"
      data-testid="site-whats-flutuante"
    >
      <IconeWhats className="h-7 w-7" />
    </a>
  );
}

function FormContato({ marca, imovel, titulo, inicial }: { marca: MarcaSite; imovel?: ImovelSitePublico; titulo: string; inicial?: string }) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [mensagem, setMensagem] = useState(inicial ?? "");
  const [isca, setIsca] = useState("");
  const enviar = useMutation({
    mutationFn: () =>
      apiPost(`/publico/site/${marca.slug}/contato`, { nome, telefone, mensagem: mensagem || null, imovel_id: imovel?.id ?? null, site: isca || null }),
  });
  const submeter = (e: FormEvent) => {
    e.preventDefault();
    if (nome.trim().length < 2 || telefone.replace(/\D/g, "").length < 10) return;
    enviar.mutate();
  };
  if (enviar.isSuccess) {
    return (
      <div className="rounded-2xl p-6 text-center" style={{ background: NEVOA }} role="status">
        <p className="text-lg font-semibold" style={{ fontFamily: "var(--f-titulo)" }}>Recebemos seu contato, {nome.split(" ")[0]}.</p>
        <p className="mt-1 text-sm" style={{ color: CINZA }}>Um corretor vai falar com você em breve. Se preferir, chame agora:</p>
        <BotaoWhats marca={marca} imovel={imovel} className="mt-4" />
      </div>
    );
  }
  const campo = "h-11 w-full rounded-xl border bg-white px-3.5 text-[15px] outline-none transition focus:border-[var(--p)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--p)_25%,transparent)]";
  return (
    <form onSubmit={submeter} className="grid gap-3" noValidate>
      <p className="text-base font-semibold" style={{ fontFamily: "var(--f-titulo)" }}>{titulo}</p>
      <input aria-label="Seu nome" placeholder="Seu nome" value={nome} onChange={(e) => setNome(e.target.value)} className={campo} style={{ borderColor: LINHA }} autoComplete="name" required data-testid="site-form-nome" />
      <input aria-label="Seu WhatsApp ou telefone" placeholder="WhatsApp com DDD" value={telefone} onChange={(e) => setTelefone(e.target.value)} className={campo} style={{ borderColor: LINHA }} inputMode="tel" autoComplete="tel" required data-testid="site-form-telefone" />
      <textarea aria-label="Mensagem" placeholder="Conte o que você procura (opcional)" value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={3} className={cn(campo, "h-auto py-2.5")} style={{ borderColor: LINHA }} />
      <input tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" value={isca} onChange={(e) => setIsca(e.target.value)} name="site" />
      {enviar.isError && <p className="text-sm text-[#c0362c]">{detalheErro(enviar.error) ?? "Não foi possível enviar. Tente pelo WhatsApp."}</p>}
      <button
        type="submit"
        disabled={enviar.isPending || nome.trim().length < 2 || telefone.replace(/\D/g, "").length < 10}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold transition disabled:opacity-50"
        style={{ background: "var(--p)", color: "var(--p-txt)" }}
        data-testid="site-form-enviar"
      >
        {enviar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Enviar contato
      </button>
      <p className="text-xs" style={{ color: CINZA }}>Seus dados vão só para a equipe da {marca.nome}, para retornar o contato.</p>
    </form>
  );
}

function Estado({ carregando, erro }: { carregando: boolean; erro?: unknown }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-white p-6 text-center" style={{ color: TINTA }}>
      {carregando ? (
        <Loader2 className="h-7 w-7 animate-spin text-[#8d96a6]" />
      ) : (
        <>
          <p className="text-xl font-semibold">Site indisponível</p>
          <p className="max-w-sm text-sm" style={{ color: CINZA }}>{detalheErro(erro) ?? "Confira o endereço digitado."}</p>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ página inicial

type Finalidade = "todos" | "venda" | "locacao";

export default function SitePublico() {
  const { slug = "", codigo } = useParams();
  if (codigo) return <PaginaImovel slug={slug} codigo={codigo} />;
  return <PaginaInicial slug={slug} />;
}

function PaginaInicial({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: ["site-publico", slug], queryFn: () => apiGet<Pagina>(`/publico/site/${slug}`), retry: false, staleTime: 60_000 });
  const marca = q.data?.marca;
  useTema(marca, marca ? `${marca.nome}: ${marca.segmento === "veiculos" ? "veículos à venda" : "imóveis à venda e para alugar"}` : "");
  useEffect(() => {
    if (marca) registrar(slug, "visualizacao");
  }, [marca, slug]);

  const [finalidade, setFinalidade] = useState<Finalidade>("todos");
  const [tipo, setTipo] = useState("");
  const [local, setLocal] = useState("");
  const [quartos, setQuartos] = useState(0);
  const [ordem, setOrdem] = useState<"recentes" | "menor" | "maior">("recentes");
  const [capaFalhou, setCapaFalhou] = useState(false);

  const imoveis = q.data?.imoveis ?? [];
  const tipos = useMemo(() => [...new Set(imoveis.map((i) => i.tipo))], [imoveis]);
  const lista = useMemo(() => {
    const t = local.trim().toLowerCase();
    const valor = (i: ImovelSitePublico) => (finalidade === "locacao" ? i.valor_aluguel : i.valor_venda ?? i.valor_aluguel) ?? Infinity;
    const r = imoveis.filter(
      (i) =>
        (finalidade === "todos" || i.finalidade === finalidade || i.finalidade === "ambos") &&
        (!tipo || i.tipo === tipo) &&
        (!quartos || i.quartos >= quartos) &&
        (!t || `${i.bairro ?? ""} ${i.cidade} ${i.titulo} ${i.codigo}`.toLowerCase().includes(t)),
    );
    if (ordem === "menor") r.sort((a, b) => valor(a) - valor(b));
    if (ordem === "maior") r.sort((a, b) => (valor(b) === Infinity ? -1 : valor(b)) - (valor(a) === Infinity ? -1 : valor(a)));
    return r;
  }, [imoveis, finalidade, tipo, quartos, local, ordem]);
  const destaques = imoveis.filter((i) => i.destaque).slice(0, 3);

  if (!marca) return <Estado carregando={q.isLoading} erro={q.error} />;

  const capa = capaFalhou ? null : (marca.capa_url ?? destaques[0]?.foto_url ?? imoveis.find((i) => i.foto_url)?.foto_url ?? null);
  const filtrando = finalidade !== "todos" || !!tipo || !!quartos || !!local.trim();
  const limpar = () => {
    setFinalidade("todos");
    setTipo("");
    setQuartos(0);
    setLocal("");
  };
  const seletor = "h-12 w-full rounded-xl border bg-white px-3 text-[15px] outline-none focus:border-[var(--p)]";

  return (
    <div style={estilo(marca)} className="min-h-dvh antialiased">
      <Topo marca={marca} sobre={!!marca.sobre} />

      {/* Abertura: a foto da imobiliária (ou do imóvel em destaque) com a busca ancorada embaixo */}
      <section className="relative">
        <div className="relative h-[460px] overflow-hidden sm:h-[520px]" style={{ background: "var(--p)" }}>
          {capa && <img src={capa} alt="" onError={() => setCapaFalhou(true)} className="absolute inset-0 h-full w-full object-cover" />}
          <div
            className="absolute inset-0"
            style={{ background: capa ? "linear-gradient(180deg, rgba(15,18,28,.15) 0%, rgba(15,18,28,.35) 45%, rgba(15,18,28,.78) 100%)" : "transparent" }}
          />
          <div className="relative mx-auto flex h-full max-w-6xl flex-col justify-end px-4 pb-24 sm:px-6 sm:pb-28">
            <h1
              className="max-w-3xl text-[34px] font-bold leading-[1.08] tracking-tight sm:text-[52px]"
              style={{ fontFamily: "var(--f-titulo)", color: capa ? "#fff" : "var(--p-txt)" }}
            >
              {marca.titulo || `${vocab(marca).Uns} da ${marca.nome}`}
            </h1>
            {marca.subtitulo && (
              <p className="mt-3 max-w-xl text-base sm:text-lg" style={{ color: capa ? "rgba(255,255,255,.88)" : "var(--p-txt)", opacity: capa ? 1 : 0.85 }}>
                {marca.subtitulo}
              </p>
            )}
          </div>
        </div>

        <div className="relative z-10 mx-auto -mt-16 max-w-6xl px-4 sm:px-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              document.getElementById("imoveis")?.scrollIntoView({ behavior: "smooth" });
            }}
            className="rounded-2xl bg-white p-3 sm:p-4"
            style={{ boxShadow: "0 24px 48px -24px rgba(20,25,40,.35), 0 0 0 1px rgba(20,25,40,.06)" }}
            aria-label={`Buscar ${vocab(marca).uns}`}
          >
            <div className="mb-3 flex gap-1" role="tablist" aria-label="Finalidade">
              {([
                ["todos", "Todos"],
                ["venda", "Comprar"],
                ["locacao", "Alugar"],
              ] as const).map(([v, r]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={finalidade === v}
                  onClick={() => setFinalidade(v)}
                  className="rounded-full px-4 py-1.5 text-sm font-semibold transition"
                  style={finalidade === v ? { background: "var(--p)", color: "var(--p-txt)" } : { color: CINZA }}
                  data-testid={`site-fin-${v}`}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-[1.6fr_1fr_1fr_auto]">
              <label className="relative">
                <span className="sr-only">Bairro, cidade ou código</span>
                <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: CINZA }} />
                <input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Bairro, cidade ou código" className={cn(seletor, "pl-10")} style={{ borderColor: LINHA }} data-testid="site-busca" />
              </label>
              <select aria-label={vocab(marca).tipo} value={tipo} onChange={(e) => setTipo(e.target.value)} className={seletor} style={{ borderColor: LINHA }}>
                <option value="">Todos os tipos</option>
                {tipos.map((t) => (
                  <option key={t} value={t}>{TIPO[t] ?? t}</option>
                ))}
              </select>
              {vocab(marca).veiculo ? (
                <select aria-label="Ordenar" value={ordem} onChange={(e) => setOrdem(e.target.value as typeof ordem)} className={seletor} style={{ borderColor: LINHA }}>
                  <option value="recentes">Mais recentes</option>
                  <option value="menor">Menor preço</option>
                  <option value="maior">Maior preço</option>
                </select>
              ) : (
              <select aria-label="Quartos" value={quartos} onChange={(e) => setQuartos(Number(e.target.value))} className={seletor} style={{ borderColor: LINHA }}>
                <option value={0}>Quartos: qualquer</option>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>{n}+ quartos</option>
                ))}
              </select>
              )}
              <button type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold" style={{ background: "var(--d)", color: "var(--d-txt)" }}>
                <Search className="h-4 w-4" /> Buscar
              </button>
            </div>
          </form>
        </div>
      </section>

      {destaques.length > 1 && !filtrando && (
        <section className="mx-auto max-w-6xl px-4 pt-14 sm:px-6" aria-labelledby="t-destaques">
          <h2 id="t-destaques" className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-[28px]" style={{ fontFamily: "var(--f-titulo)" }}>
            <Star className="h-5 w-5" style={{ color: "var(--d)", fill: "var(--d)" }} /> Escolhidos pela equipe
          </h2>
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            {destaques.map((i) => (
              <Card key={i.id} i={i} marca={marca} />
            ))}
          </div>
        </section>
      )}

      <section id="imoveis" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-14 sm:px-6" aria-labelledby="t-imoveis">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="t-imoveis" className="text-2xl font-bold tracking-tight sm:text-[28px]" style={{ fontFamily: "var(--f-titulo)" }}>
              {filtrando ? "Resultado da busca" : `${vocab(marca).Uns} disponíveis`}
            </h2>
            <p className="mt-1 text-sm" style={{ color: CINZA }} data-testid="site-contagem">
              {lista.length} {lista.length === 1 ? `${vocab(marca).um} encontrado` : `${vocab(marca).uns} encontrados`}
              {filtrando && (
                <button type="button" onClick={limpar} className="ml-2 font-semibold underline underline-offset-2" style={{ color: "var(--p)" }}>
                  Limpar busca
                </button>
              )}
            </p>
          </div>
          <select aria-label="Ordenar" value={ordem} onChange={(e) => setOrdem(e.target.value as typeof ordem)} className="h-10 w-fit rounded-full border bg-white px-3 text-sm" style={{ borderColor: LINHA }}>
            <option value="recentes">Mais recentes</option>
            <option value="menor">Menor preço</option>
            <option value="maior">Maior preço</option>
          </select>
        </div>
        {lista.length ? (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="site-lista">
            {lista.map((i) => (
              <Card key={i.id} i={i} marca={marca} />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl px-6 py-12 text-center" style={{ background: NEVOA }}>
            <p className="text-lg font-semibold">Nenhum {vocab(marca).um} com esses filtros agora.</p>
            <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: CINZA }}>
              Conte o que você procura e a equipe avisa quando entrar algo do seu perfil.
            </p>
            <BotaoWhats marca={marca} className="mt-5">Contar o que procuro</BotaoWhats>
          </div>
        )}
      </section>

      {marca.sobre && (
        <section id="sobre" className="scroll-mt-20" style={{ background: NEVOA }}>
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-[1fr_1.4fr] md:items-center">
            <h2 className="text-[28px] font-bold leading-tight tracking-tight sm:text-4xl" style={{ fontFamily: "var(--f-titulo)" }}>
              Quem somos
            </h2>
            <p className="max-w-[68ch] whitespace-pre-line text-[16px] leading-relaxed" style={{ color: "#3b4352" }}>
              {marca.sobre}
            </p>
          </div>
        </section>
      )}

      <section id="contato" className="mx-auto grid max-w-6xl scroll-mt-20 gap-10 px-4 py-14 sm:px-6 md:grid-cols-2">
        <div>
          <h2 className="text-[28px] font-bold leading-tight tracking-tight sm:text-4xl" style={{ fontFamily: "var(--f-titulo)" }}>
            Não achou o que procura?
          </h2>
          <p className="mt-3 max-w-md text-base" style={{ color: CINZA }}>
            {vocab(marca).veiculo ? "Nem todo veículo do estoque está no site. Diga o modelo, o ano e quanto quer investir, e um vendedor busca para você." : "Nem todo imóvel da carteira está no site. Diga o bairro, o tipo e quanto quer investir, e um corretor busca para você."}
          </p>
          <BotaoWhats marca={marca} grande className="mt-6" />
        </div>
        <div className="rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: `0 0 0 1px ${LINHA}` }}>
          <FormContato marca={marca} titulo="Prefere que a gente ligue?" />
        </div>
      </section>

      <Rodape marca={marca} />
      <WhatsFlutuante marca={marca} />
    </div>
  );
}

// ------------------------------------------------------------------ página do imóvel

function PaginaImovel({ slug, codigo }: { slug: string; codigo: string }) {
  const q = useQuery({ queryKey: ["site-publico", slug, codigo], queryFn: () => apiGet<Detalhe>(`/publico/site/${slug}/imovel/${codigo}`), retry: false });
  const lista = useQuery({ queryKey: ["site-publico", slug], queryFn: () => apiGet<Pagina>(`/publico/site/${slug}`), retry: false, staleTime: 60_000 });
  const marca = q.data?.marca;
  const i = q.data?.imovel;
  useTema(marca, i && marca ? `${i.titulo} | ${marca.nome}` : "");
  const [aberta, setAberta] = useState<number | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (i) {
      registrar(slug, "visualizacao", i.id);
      window.scrollTo({ top: 0 });
    }
  }, [i, slug]);

  if (!marca || !i) return <Estado carregando={q.isLoading} erro={q.error} />;

  const fotos = i.fotos?.length ? i.fotos : i.foto_url ? [i.foto_url] : [];
  const p = preco(i);
  const parecidos = (lista.data?.imoveis ?? [])
    .filter((o) => o.id !== i.id && (o.tipo === i.tipo || o.cidade === i.cidade))
    .slice(0, 3);
  const compartilhar = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: i.titulo, url });
        return;
      } catch {
        /* cancelado */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sem permissão */
    }
  };
  const caracteristicas = (i.marca ? [
    ["Marca", i.marca],
    ["Modelo", [i.modelo, i.versao].filter(Boolean).join(" ")],
    ["Ano", `${i.ano_fabricacao}/${i.ano_modelo}`],
    ["Quilometragem", `${(i.km ?? 0).toLocaleString("pt-BR")} km`],
    ["Câmbio", CAMBIO[i.cambio ?? ""] ?? i.cambio],
    ["Combustível", COMBUSTIVEL[i.combustivel ?? ""] ?? i.combustivel],
    ["Cor", i.cor],
    ["Categoria", TIPO[i.tipo] ?? i.tipo],
    ["Aceita troca", i.aceita_troca ? "Sim" : null],
    ["Único dono", i.unico_dono ? "Sim" : null],
    ["IPVA pago", i.ipva_pago ? "Sim" : null],
    ["Garantia", i.garantia],
    ["Código", i.codigo],
  ] : [
    ["Tipo", TIPO[i.tipo] ?? i.tipo],
    ["Área útil", i.area_util ? `${i.area_util.toLocaleString("pt-BR")} m²` : null],
    ["Área total", i.area_total ? `${i.area_total.toLocaleString("pt-BR")} m²` : null],
    ["Quartos", i.quartos || null],
    ["Suítes", i.suites || null],
    ["Banheiros", i.banheiros || null],
    ["Vagas", i.vagas || null],
    ["Código", i.codigo],
  ]).filter(([, v]) => v != null && v !== "") as [string, string | number][];
  const local = [i.bairro, i.cidade, i.estado].filter(Boolean).join(", ");

  return (
    <div style={estilo(marca)} className="min-h-dvh antialiased">
      <Topo marca={marca} sobre={!!marca.sobre} />

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-5 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link to={`/s/${slug}`} className="inline-flex items-center gap-1.5 rounded-full py-1.5 pr-3 text-sm font-medium hover:underline" style={{ color: CINZA }}>
            <ArrowLeft className="h-4 w-4" /> Todos os {vocab(marca).uns}
          </Link>
          <button type="button" onClick={compartilhar} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium hover:bg-[#f3f5f8]" style={{ borderColor: LINHA }}>
            <Share2 className="h-4 w-4" /> {copiado ? "Link copiado" : "Compartilhar"}
          </button>
        </div>

        {/* Galeria: uma foto grande e as próximas em mosaico */}
        <div className="mt-4 grid gap-2 overflow-hidden rounded-2xl md:h-[460px] md:grid-cols-4 md:grid-rows-2">
          {(fotos.length ? fotos.slice(0, 5) : [null]).map((f, k) => (
            <button
              key={k}
              type="button"
              disabled={!f}
              onClick={() => setAberta(k)}
              className={cn(
                "relative overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--p)]",
                k === 0 ? "aspect-[4/3] md:col-span-2 md:row-span-2 md:aspect-auto" : "hidden md:block",
                fotos.length === 1 && "md:col-span-4",
              )}
              aria-label={f ? `Abrir foto ${k + 1} de ${fotos.length}` : undefined}
            >
              <Foto src={f} alt={`${i.titulo}, foto ${k + 1}`} className="h-full w-full" />
              {k === 0 && fotos.length > 1 && (
                <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold md:hidden" style={{ color: TINTA }}>
                  <Images className="h-3.5 w-3.5" /> {fotos.length} fotos
                </span>
              )}
              {k === 4 && fotos.length > 5 && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-lg font-semibold text-white">+{fotos.length - 5} fotos</span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: NEVOA }}>{TIPO[i.tipo] ?? i.tipo}, {p.legenda.toLowerCase()}</span>
              {i.reservado && (
                <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "var(--d)", color: "var(--d-txt)" }}>
                  <Clock3 className="h-3.5 w-3.5" /> Reservado
                </span>
              )}
            </div>
            <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-tight sm:text-[36px]" style={{ fontFamily: "var(--f-titulo)" }} data-testid="site-imovel-titulo">
              {i.titulo}
            </h1>
            <p className="mt-2 flex items-center gap-1.5 text-[15px]" style={{ color: CINZA }}>
              {i.marca ? <>{[i.versao, i.cor].filter(Boolean).join(", ")}</> : <><MapPin className="h-4 w-4" /> {local}</>}
            </p>
            <div className="mt-5 border-y py-4" style={{ borderColor: LINHA }}>
              <Specs i={i} />
            </div>

            {i.descricao && (
              <section className="mt-8">
                <h2 className="text-xl font-bold" style={{ fontFamily: "var(--f-titulo)" }}>Sobre o {vocab(marca).um}</h2>
                <p className="mt-3 max-w-[70ch] whitespace-pre-line text-[16px] leading-relaxed" style={{ color: "#3b4352" }}>{i.descricao}</p>
              </section>
            )}

            <section className="mt-8">
              <h2 className="text-xl font-bold" style={{ fontFamily: "var(--f-titulo)" }}>Características</h2>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
                {caracteristicas.map(([k, v]) => (
                  <div key={k} className="border-b py-3" style={{ borderColor: LINHA }}>
                    <dt className="text-xs" style={{ color: CINZA }}>{k}</dt>
                    <dd className="mt-0.5 font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {i.marca && !!i.opcionais?.length && (
              <section className="mt-8">
                <h2 className="text-xl font-bold" style={{ fontFamily: "var(--f-titulo)" }}>Opcionais</h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {i.opcionais.map((o) => <li key={o} className="rounded-full px-3 py-1 text-sm" style={{ background: NEVOA }}>{o}</li>)}
                </ul>
              </section>
            )}
            {!i.marca && (
            <section className="mt-8">
              <h2 className="text-xl font-bold" style={{ fontFamily: "var(--f-titulo)" }}>Região</h2>
              <p className="mt-1 text-sm" style={{ color: CINZA }}>O endereço exato é passado pelo corretor no agendamento da visita.</p>
              <div className="mt-3 overflow-hidden rounded-2xl" style={{ boxShadow: `0 0 0 1px ${LINHA}` }}>
                <iframe
                  title={`Mapa da região: ${local}`}
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(local)}&z=14&output=embed`}
                  className="h-64 w-full sm:h-72"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              </div>
            </section>
            )}
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: "0 24px 48px -28px rgba(20,25,40,.35), 0 0 0 1px rgba(20,25,40,.07)" }}>
              <p className="text-sm" style={{ color: CINZA }}>{p.legenda}</p>
              <p className="mt-1 text-[32px] font-bold leading-none tracking-tight" style={{ fontFamily: "var(--f-titulo)" }} data-testid="site-imovel-preco">
                {p.valor}
                {p.sufixo && <span className="text-base font-medium" style={{ color: CINZA }}> {p.sufixo}</span>}
              </p>
              {i.finalidade === "ambos" && i.valor_aluguel ? (
                <p className="mt-1.5 text-sm" style={{ color: CINZA }}>Aluguel: {brl(i.valor_aluguel)}/mês</p>
              ) : null}
              {(i.condominio || i.iptu) && (
                <dl className="mt-4 grid grid-cols-2 gap-2 rounded-xl p-3 text-sm" style={{ background: NEVOA }}>
                  {i.condominio ? (
                    <div>
                      <dt style={{ color: CINZA }}>Condomínio</dt>
                      <dd className="font-semibold">{brl(i.condominio)}</dd>
                    </div>
                  ) : null}
                  {i.iptu ? (
                    <div>
                      <dt style={{ color: CINZA }}>IPTU</dt>
                      <dd className="font-semibold">{brl(i.iptu)}</dd>
                    </div>
                  ) : null}
                </dl>
              )}
              <BotaoWhats marca={marca} imovel={i} grande className="mt-5 w-full">
                {i.reservado ? "Avise-me se liberar" : "Quero saber mais"}
              </BotaoWhats>
              <div className="my-5 h-px" style={{ background: LINHA }} />
              <FormContato marca={marca} imovel={i} titulo={i.marca ? "Agendar um test drive" : "Agendar uma visita"} inicial={i.marca ? `Quero agendar um test drive do ${i.codigo}.` : `Quero visitar o imóvel ${i.codigo}.`} />
            </div>
          </aside>
        </div>

        {parecidos.length > 0 && (
          <section className="mt-16">
            <h2 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "var(--f-titulo)" }}>Você também pode gostar</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {parecidos.map((o) => (
                <Card key={o.id} i={o} marca={marca} />
              ))}
            </div>
          </section>
        )}
      </main>

      <Rodape marca={marca} />
      <WhatsFlutuante marca={marca} imovel={i} />
      {aberta != null && fotos.length > 0 && <Galeria fotos={fotos} inicio={aberta} titulo={i.titulo} onClose={() => setAberta(null)} />}
    </div>
  );
}

function Galeria({ fotos, inicio, titulo, onClose }: { fotos: string[]; inicio: number; titulo: string; onClose: () => void }) {
  const [k, setK] = useState(inicio);
  const ir = (d: number) => setK((x) => (x + d + fotos.length) % fotos.length);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") ir(1);
      if (e.key === "ArrowLeft") ir(-1);
    };
    document.addEventListener("keydown", tecla);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", tecla);
      document.body.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [toque, setToque] = useState<number | null>(null);
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-[#0f121a]/95"
      role="dialog"
      aria-modal="true"
      aria-label={`Fotos de ${titulo}`}
      onTouchStart={(e) => setToque(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (toque == null) return;
        const d = e.changedTouches[0].clientX - toque;
        if (Math.abs(d) > 50) ir(d < 0 ? 1 : -1);
        setToque(null);
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm">{k + 1} de {fotos.length}</span>
        <button type="button" onClick={onClose} aria-label="Fechar fotos" className="rounded-full p-2 hover:bg-white/10" autoFocus>
          <X className="h-6 w-6" />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
        <img src={fotos[k]} alt={`${titulo}, foto ${k + 1}`} className="max-h-full max-w-full rounded-lg object-contain" />
        {fotos.length > 1 && (
          <>
            <button type="button" onClick={() => ir(-1)} aria-label="Foto anterior" className="absolute left-2 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 sm:left-4">
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button type="button" onClick={() => ir(1)} aria-label="Próxima foto" className="absolute right-2 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 sm:right-4">
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 py-3">
        {fotos.map((f, n) => (
          <button key={f + n} type="button" onClick={() => setK(n)} aria-label={`Foto ${n + 1}`} className={cn("h-14 w-20 shrink-0 overflow-hidden rounded-md ring-2", n === k ? "ring-white" : "ring-transparent opacity-60")}>
            <img src={f} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}
