import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Copy,
  ExternalLink,
  Eye,
  Globe,
  ImagePlus,
  Inbox,
  Loader2,
  Lock,
  MousePointerClick,
  Palette,
  Phone,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { apiDelete, apiGet, apiPut, detalheErro } from "@/lib/api";
import { brlCompacto } from "@/lib/format";
import { usePlano } from "@/lib/diferenciais";
import type { FonteSite, ImovelNoSite, PainelSite, SiteConfig, SiteStatus } from "@/lib/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SiteStatusPicker, { SITE_STATUS } from "@/components/site/SiteStatusPicker";
import { cn } from "@/lib/utils";

type Form = Omit<SiteConfig, "tem_logo" | "tem_capa" | "midia_v" | "atualizado_em" | "atualizado_por" | "slug"> & { slug: string };

const PALETAS: { nome: string; p: string; d: string }[] = [
  { nome: "Roxo e laranja", p: "#4a03a2", d: "#ff7a00" },
  { nome: "Azul marinho e dourado", p: "#12355b", d: "#d4a017" },
  { nome: "Verde e areia", p: "#1f5f4a", d: "#e0b15c" },
  { nome: "Grafite e coral", p: "#2b2f36", d: "#ef6f53" },
  { nome: "Vinho e rosé", p: "#6d1a36", d: "#e8a598" },
  { nome: "Azul e ciano", p: "#1d4ed8", d: "#06b6d4" },
];

const FONTES: { v: FonteSite; nome: string; amostra: string; familia: string }[] = [
  { v: "moderna", nome: "Moderna", amostra: "Casa com quintal", familia: "'Plus Jakarta Sans', system-ui" },
  { v: "elegante", nome: "Elegante", amostra: "Casa com quintal", familia: "'Fraunces', Georgia, serif" },
  { v: "classica", nome: "Clássica", amostra: "Casa com quintal", familia: "'Lora', Georgia, serif" },
];

function paraForm(p: PainelSite): Form {
  const { tem_logo: _l, tem_capa: _c, midia_v: _m, atualizado_em: _a, atualizado_por: _b, slug, ...resto } = p.config;
  return { ...resto, slug: slug ?? p.sugestao_slug };
}

async function lerImagem(arquivo: File, tipo: "logo" | "capa"): Promise<{ base64: string; mime: "image/png" | "image/jpeg" }> {
  const bitmap = await createImageBitmap(arquivo);
  const max = tipo === "logo" ? 640 : 1920;
  const escala = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const mime = tipo === "logo" ? "image/png" : "image/jpeg";
  const url = canvas.toDataURL(mime, 0.82);
  return { base64: url.split(",")[1], mime };
}

export default function MeuSite() {
  const qc = useQueryClient();
  const { tem } = usePlano();
  const painel = useQuery({ queryKey: ["site-painel"], queryFn: () => apiGet<PainelSite>("/site-imobiliaria") });
  const imoveis = useQuery({ queryKey: ["site-imoveis"], queryFn: () => apiGet<ImovelNoSite[]>("/site-imobiliaria/imoveis") });
  const [form, setForm] = useState<Form | null>(null);
  const [aba, setAba] = useState("imoveis");

  useEffect(() => {
    if (painel.data && !form) setForm(paraForm(painel.data));
  }, [painel.data, form]);

  // Mesmas fontes do site público, para a prévia e a escolha do estilo das letras.
  useEffect(() => {
    if (document.getElementById("site-fontes-previa")) return;
    const link = document.createElement("link");
    link.id = "site-fontes-previa";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700&family=Fraunces:opsz,wght@9..144,600&family=Lora:wght@600&display=swap";
    document.head.appendChild(link);
  }, []);

  const p = painel.data;
  const pode = !!p?.pode_editar && !!p?.liberado;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const salvar = useMutation({
    mutationFn: (dados: Form) => apiPut<PainelSite>("/site-imobiliaria", dados),
    onSuccess: (r) => {
      qc.setQueryData(["site-painel"], r);
      setForm(paraForm(r));
      toast.success(r.config.ativo ? "Site salvo e no ar." : "Site salvo. Ele ainda está fora do ar.");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar o site."),
  });

  if (painel.isLoading || !p || !form) return <div className="h-64 animate-pulse rounded-xl bg-muted" />;

  if (!p.liberado || !tem("site")) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border bg-card p-8 text-center">
        <Globe className="mx-auto h-10 w-10 text-primary" />
        <h2 className="mt-3 text-lg font-semibold">Site da imobiliária</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Um site com a sua marca, os imóveis da carteira e o WhatsApp da equipe, atualizado direto pelo CRM. Ele não faz parte do plano atual da
          imobiliária. Fale com o suporte para liberar.
        </p>
      </div>
    );
  }

  const urlCompleta = p.url && p.url.startsWith("http") ? p.url : p.url ? `${window.location.origin}${p.url}` : null;
  const lista = imoveis.data ?? [];
  const noSite = lista.filter((i) => i.site_status !== "inativo" && !["vendido", "alugado"].includes(i.status)).length;
  const publicar = (ativo: boolean) => salvar.mutate({ ...form, ativo });

  return (
    <div className="flex flex-col gap-5">
      {/* Situação do site */}
      <section className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                p.config.ativo ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-muted text-muted-foreground",
              )}
              data-testid="site-situacao"
            >
              <span className={cn("h-2 w-2 rounded-full", p.config.ativo ? "bg-emerald-500" : "bg-muted-foreground")} />
              {!p.configurado ? "Ainda não criado" : p.config.ativo ? "No ar" : "Fora do ar"}
            </span>
            {!p.pode_editar && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" /> Só leitura: peça ao gestor para liberar a edição do site
              </span>
            )}
          </div>
          {urlCompleta ? (
            <p className="mt-2 truncate font-medium" title={urlCompleta}>{urlCompleta}</p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Escolha o endereço, a marca e o WhatsApp e publique. Leva poucos minutos.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {urlCompleta && (
            <>
              <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(urlCompleta).then(() => toast.success("Link copiado."))}>
                <Copy className="h-4 w-4" /> Copiar link
              </Button>
              <a href={urlCompleta} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="site-abrir">
                <ExternalLink className="h-4 w-4" /> Abrir site
              </a>
            </>
          )}
          {pode && (
            <Button size="sm" variant={p.config.ativo ? "outline" : "default"} disabled={salvar.isPending} onClick={() => publicar(!p.config.ativo)} data-testid="site-publicar">
              {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {p.config.ativo ? "Tirar do ar" : "Publicar site"}
            </Button>
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icone={Globe} rotulo="Imóveis no site" valor={noSite} />
        <Kpi icone={Eye} rotulo="Visualizações" valor={p.visualizacoes} />
        <Kpi icone={MousePointerClick} rotulo="Cliques no WhatsApp" valor={p.cliques_whatsapp} />
        <Kpi icone={Inbox} rotulo="Contatos pelo site" valor={p.contatos} detalhe="Entram em Leads" />
      </div>

      <Tabs value={aba} onValueChange={(v) => setAba(String(v))}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="imoveis" data-testid="site-aba-imoveis">Imóveis</TabsTrigger>
          <TabsTrigger value="marca" data-testid="site-aba-marca">Marca e textos</TabsTrigger>
          <TabsTrigger value="contato" data-testid="site-aba-contato">Contato e WhatsApp</TabsTrigger>
          <TabsTrigger value="endereco" data-testid="site-aba-endereco">Endereço do site</TabsTrigger>
        </TabsList>

        <TabsContent value="imoveis" className="mt-4">
          <ImoveisDoSite lista={lista} carregando={imoveis.isLoading} pode={!!p.pode_editar} />
        </TabsContent>

        <TabsContent value="marca" className="mt-4">
          <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
            <div className="grid gap-5">
              <Bloco titulo="Logo e foto de capa" descricao="A capa aparece no topo do site. Sem capa, o site usa a foto do imóvel em destaque.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Midia tipo="logo" painel={p} pode={pode} />
                  <Midia tipo="capa" painel={p} pode={pode} />
                </div>
              </Bloco>
              <Bloco titulo="Cores" descricao="A cor principal vai nos botões e títulos. A de destaque marca o botão de busca e o selo de reservado.">
                <div className="flex flex-wrap gap-2">
                  {PALETAS.map((c) => (
                    <button
                      key={c.nome}
                      type="button"
                      disabled={!pode}
                      onClick={() => setForm((f) => (f ? { ...f, cor_primaria: c.p, cor_destaque: c.d } : f))}
                      className={cn(
                        "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-medium disabled:opacity-60",
                        form.cor_primaria === c.p && form.cor_destaque === c.d && "border-primary ring-2 ring-primary/30",
                      )}
                    >
                      <span className="flex">
                        <span className="h-6 w-6 rounded-full border-2 border-background" style={{ background: c.p }} />
                        <span className="-ml-2 h-6 w-6 rounded-full border-2 border-background" style={{ background: c.d }} />
                      </span>
                      {c.nome}
                    </button>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Cor rotulo="Cor principal" valor={form.cor_primaria} onChange={(v) => set("cor_primaria", v)} pode={pode} />
                  <Cor rotulo="Cor de destaque" valor={form.cor_destaque} onChange={(v) => set("cor_destaque", v)} pode={pode} />
                </div>
              </Bloco>
              <Bloco titulo="Estilo das letras">
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Estilo das letras">
                  {FONTES.map((f) => (
                    <button
                      key={f.v}
                      type="button"
                      role="radio"
                      aria-checked={form.fonte === f.v}
                      disabled={!pode}
                      onClick={() => set("fonte", f.v)}
                      className={cn("rounded-lg border p-3 text-left transition disabled:opacity-60", form.fonte === f.v ? "border-primary bg-accent/40 ring-2 ring-primary/25" : "hover:bg-muted")}
                    >
                      <span className="block text-lg font-semibold" style={{ fontFamily: f.familia }}>{f.amostra}</span>
                      <span className="text-xs text-muted-foreground">{f.nome}</span>
                    </button>
                  ))}
                </div>
              </Bloco>
              <Bloco titulo="Textos do site">
                <Campo rotulo="Nome da imobiliária" id="s-nome">
                  <Input id="s-nome" value={form.nome} onChange={(e) => set("nome", e.target.value)} disabled={!pode} maxLength={80} />
                </Campo>
                <Campo rotulo="Título da página inicial" id="s-titulo" ajuda="Frase curta, até 90 letras.">
                  <Input id="s-titulo" value={form.titulo} onChange={(e) => set("titulo", e.target.value)} disabled={!pode} maxLength={90} data-testid="site-titulo" />
                </Campo>
                <Campo rotulo="Subtítulo" id="s-sub">
                  <Input id="s-sub" value={form.subtitulo} onChange={(e) => set("subtitulo", e.target.value)} disabled={!pode} maxLength={200} />
                </Campo>
                <Campo rotulo="Quem somos" id="s-sobre" ajuda="Aparece numa seção própria. Deixe em branco para esconder.">
                  <Textarea id="s-sobre" rows={4} value={form.sobre} onChange={(e) => set("sobre", e.target.value)} disabled={!pode} maxLength={1500} />
                </Campo>
              </Bloco>
            </div>
            <Previa form={form} painel={p} />
          </div>
        </TabsContent>

        <TabsContent value="contato" className="mt-4">
          <div className="grid gap-5 lg:grid-cols-2">
            <Bloco titulo="WhatsApp" descricao="Todos os botões do site abrem conversa neste número, já com o código do imóvel na mensagem.">
              <Campo rotulo="Número com DDD" id="s-whats">
                <Input id="s-whats" value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} disabled={!pode} inputMode="tel" placeholder="(41) 99999-0000" data-testid="site-whatsapp" />
              </Campo>
              <Campo rotulo="Mensagem que o cliente envia" id="s-msg" ajuda="Use {codigo} e {titulo} para incluir o imóvel. O link do imóvel vai junto.">
                <Textarea id="s-msg" rows={3} value={form.mensagem_whatsapp} onChange={(e) => set("mensagem_whatsapp", e.target.value)} disabled={!pode} maxLength={300} />
              </Campo>
            </Bloco>
            <Bloco titulo="Outros contatos" descricao="Aparecem no rodapé do site.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Telefone" id="s-tel">
                  <Input id="s-tel" value={form.telefone} onChange={(e) => set("telefone", e.target.value)} disabled={!pode} inputMode="tel" />
                </Campo>
                <Campo rotulo="E-mail" id="s-email">
                  <Input id="s-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} disabled={!pode} />
                </Campo>
                <Campo rotulo="CRECI" id="s-creci">
                  <Input id="s-creci" value={form.creci} onChange={(e) => set("creci", e.target.value)} disabled={!pode} />
                </Campo>
                <Campo rotulo="Horário de atendimento" id="s-hora">
                  <Input id="s-hora" value={form.horario} onChange={(e) => set("horario", e.target.value)} disabled={!pode} placeholder="Seg. a sex., 9h às 18h" />
                </Campo>
                <Campo rotulo="Instagram" id="s-insta">
                  <Input id="s-insta" value={form.instagram} onChange={(e) => set("instagram", e.target.value)} disabled={!pode} placeholder="@suaimobiliaria" />
                </Campo>
                <Campo rotulo="Facebook" id="s-face">
                  <Input id="s-face" value={form.facebook} onChange={(e) => set("facebook", e.target.value)} disabled={!pode} placeholder="Endereço da página" />
                </Campo>
              </div>
              <Campo rotulo="Endereço da imobiliária" id="s-end">
                <Input id="s-end" value={form.endereco} onChange={(e) => set("endereco", e.target.value)} disabled={!pode} />
              </Campo>
            </Bloco>
          </div>
        </TabsContent>

        <TabsContent value="endereco" className="mt-4">
          <Bloco titulo="Endereço do site" descricao="É o link que você manda para os clientes e coloca no Instagram.">
            <Campo rotulo="Endereço" id="s-slug" ajuda="Letras minúsculas, números e hífen. Se mudar, o link antigo para de funcionar.">
              <div className="flex max-w-xl items-center overflow-hidden rounded-lg border focus-within:ring-3 focus-within:ring-ring/50">
                <span className="whitespace-nowrap bg-muted px-3 py-2 text-sm text-muted-foreground">{window.location.host}/s/</span>
                <input
                  id="s-slug"
                  value={form.slug}
                  onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                  disabled={!pode}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
                  data-testid="site-slug"
                />
              </div>
            </Campo>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--primary)]" checked={form.ativo} onChange={(e) => set("ativo", e.target.checked)} disabled={!pode} data-testid="site-ativo" />
              <span>
                <span className="font-medium">Site no ar</span>
                <span className="block text-xs text-muted-foreground">Fora do ar, quem abrir o link vê uma mensagem de site indisponível.</span>
              </span>
            </label>
          </Bloco>
        </TabsContent>
      </Tabs>

      {aba !== "imoveis" && pode && (
        <div className="sticky bottom-3 z-10 flex justify-end">
          <div className="flex items-center gap-3 rounded-xl border bg-card/95 p-2 pl-4 shadow-lg backdrop-blur">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {p.config.atualizado_por ? `Última alteração por ${p.config.atualizado_por}` : "Ainda não salvo"}
            </span>
            <Button onClick={() => salvar.mutate(form)} disabled={salvar.isPending} data-testid="site-salvar">
              {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar site
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ peças

function Kpi({ icone: Icone, rotulo, valor, detalhe }: { icone: typeof Globe; rotulo: string; valor: number; detalhe?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icone className="h-3.5 w-3.5" /> {rotulo}
      </p>
      <p className="num mt-1 text-2xl font-bold">{valor.toLocaleString("pt-BR")}</p>
      {detalhe && <p className="text-[11px] text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

function Bloco({ titulo, descricao, children }: { titulo: string; descricao?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4 sm:p-5">
      <div>
        <h3 className="font-semibold">{titulo}</h3>
        {descricao && <p className="mt-0.5 text-sm text-muted-foreground">{descricao}</p>}
      </div>
      {children}
    </section>
  );
}

function Campo({ rotulo, id, ajuda, children }: { rotulo: string; id: string; ajuda?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );
}

function Cor({ rotulo, valor, onChange, pode }: { rotulo: string; valor: string; onChange: (v: string) => void; pode: boolean }) {
  return (
    <div className="grid gap-1.5">
      <Label>{rotulo}</Label>
      <div className="flex items-center gap-2">
        <input type="color" value={valor} onChange={(e) => onChange(e.target.value)} disabled={!pode} aria-label={rotulo} className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1" />
        <Input value={valor} onChange={(e) => onChange(e.target.value)} disabled={!pode} maxLength={7} className="max-w-[120px] font-mono" />
      </div>
    </div>
  );
}

function Midia({ tipo, painel, pode }: { tipo: "logo" | "capa"; painel: PainelSite; pode: boolean }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const tem = tipo === "logo" ? painel.config.tem_logo : painel.config.tem_capa;
  const slug = painel.config.slug;
  const src = tem && slug ? `/api/publico/site/${slug}/midia/${tipo}?v=${painel.config.midia_v}` : null;
  const enviar = useMutation({
    mutationFn: async (f: File) => apiPut<PainelSite>(`/site-imobiliaria/midia/${tipo}`, await lerImagem(f, tipo)),
    onSuccess: (r) => {
      qc.setQueryData(["site-painel"], r);
      toast.success(tipo === "logo" ? "Logo atualizada." : "Capa atualizada.");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível enviar a imagem."),
  });
  const remover = useMutation({
    mutationFn: () => apiDelete<PainelSite>(`/site-imobiliaria/midia/${tipo}`),
    onSuccess: (r) => qc.setQueryData(["site-painel"], r),
  });
  return (
    <div className="grid gap-2">
      <Label>{tipo === "logo" ? "Logo" : "Foto de capa"}</Label>
      <div className={cn("relative flex items-center justify-center overflow-hidden rounded-lg border border-dashed bg-muted/40", tipo === "logo" ? "h-28" : "h-28")}>
        {src ? (
          <img src={src} alt="" className={cn("h-full w-full", tipo === "logo" ? "object-contain p-3" : "object-cover")} />
        ) : (
          <span className="px-4 text-center text-xs text-muted-foreground">
            {tipo === "logo" ? (slug ? "Usando a logo do sistema, se houver" : "Salve o endereço do site para ver a prévia") : "Sem capa"}
          </span>
        )}
      </div>
      {pode && (
        <div className="flex gap-2">
          <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && enviar.mutate(e.target.files[0])} data-testid={`site-upload-${tipo}`} />
          <Button size="sm" variant="outline" type="button" onClick={() => ref.current?.click()} disabled={enviar.isPending}>
            {enviar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {tem ? "Trocar" : "Enviar"}
          </Button>
          {tem && (
            <Button size="sm" variant="ghost" type="button" onClick={() => remover.mutate()} aria-label={`Remover ${tipo}`}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{tipo === "logo" ? "PNG com fundo transparente fica melhor." : "Foto horizontal, de preferência da fachada ou da equipe."}</p>
    </div>
  );
}

function Previa({ form, painel }: { form: Form; painel: PainelSite }) {
  const capa = painel.config.tem_capa && painel.config.slug ? `/api/publico/site/${painel.config.slug}/midia/capa?v=${painel.config.midia_v}` : null;
  const fonte = FONTES.find((f) => f.v === form.fonte)?.familia;
  return (
    <aside className="xl:sticky xl:top-20 xl:self-start">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><Palette className="h-4 w-4" /> Prévia</p>
      <div className="overflow-hidden rounded-xl border bg-white text-[#1d2330] shadow-sm" aria-hidden>
        <div className="flex items-center justify-between border-b border-[#e3e7ee] px-3 py-2">
          <span className="text-[13px] font-bold" style={{ fontFamily: fonte }}>{form.nome || "Sua imobiliária"}</span>
          <span className="rounded-full bg-[#1fa855] px-2 py-0.5 text-[10px] font-semibold text-white">WhatsApp</span>
        </div>
        <div className="relative flex h-36 items-end p-3" style={{ background: form.cor_primaria }}>
          {capa && <img src={capa} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          {capa && <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/70" />}
          <p className="relative text-lg font-bold leading-tight text-white" style={{ fontFamily: fonte }}>{form.titulo || "Título do site"}</p>
        </div>
        <div className="-mt-3 px-3">
          <div className="flex gap-1.5 rounded-lg bg-white p-1.5 shadow-md ring-1 ring-black/5">
            <span className="flex-1 rounded-md border border-[#e3e7ee] px-2 py-1.5 text-[10px] text-[#5b6474]">Bairro ou cidade</span>
            <span className="rounded-md px-2.5 py-1.5 text-[10px] font-semibold" style={{ background: form.cor_destaque, color: "#fff" }}>Buscar</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3">
          {[0, 1].map((k) => (
            <div key={k} className="overflow-hidden rounded-lg ring-1 ring-[#e3e7ee]">
              <div className="relative h-14 bg-[#f3f5f8]">
                {k === 1 && <span className="absolute inset-x-0 bottom-0 px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: form.cor_destaque, color: "#fff" }}>Reservado</span>}
              </div>
              <div className="p-1.5">
                <p className="text-[11px] font-bold" style={{ fontFamily: fonte }}>R$ 480.000</p>
                <p className="text-[9px] text-[#5b6474]">Apartamento, 2 quartos</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function ImoveisDoSite({ lista, carregando, pode }: { lista: ImovelNoSite[]; carregando: boolean; pode: boolean }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | SiteStatus>("todos");
  const [sel, setSel] = useState<Set<string>>(new Set());

  const alterar = useMutation({
    mutationFn: (corpo: { ids: string[]; site_status?: SiteStatus; site_destaque?: boolean }) => apiPut<void>("/site-imobiliaria/imoveis", corpo),
    onMutate: async (corpo) => {
      await qc.cancelQueries({ queryKey: ["site-imoveis"] });
      const antes = qc.getQueryData<ImovelNoSite[]>(["site-imoveis"]);
      qc.setQueryData<ImovelNoSite[]>(["site-imoveis"], (l) =>
        (l ?? []).map((i) => (corpo.ids.includes(i.id) ? { ...i, ...(corpo.site_status ? { site_status: corpo.site_status } : {}), ...(corpo.site_destaque != null ? { site_destaque: corpo.site_destaque } : {}) } : i)),
      );
      return { antes };
    },
    onError: (e, _c, ctx) => {
      if (ctx?.antes) qc.setQueryData(["site-imoveis"], ctx.antes);
      toast.error(detalheErro(e) ?? "Não foi possível alterar.");
    },
    onSuccess: (_r, corpo) => {
      if (corpo.ids.length > 1) {
        toast.success(`${corpo.ids.length} imóveis atualizados.`);
        setSel(new Set());
      }
      qc.invalidateQueries({ queryKey: ["imoveis"] });
    },
  });

  const filtrada = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return lista.filter(
      (i) =>
        (filtro === "todos" || i.site_status === filtro) &&
        (!t || `${i.codigo} ${i.titulo} ${i.bairro ?? ""} ${i.cidade}`.toLowerCase().includes(t)),
    );
  }, [lista, busca, filtro]);

  if (carregando) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  const todosSel = filtrada.length > 0 && filtrada.every((i) => sel.has(i.id));
  const contagem = (s: SiteStatus) => lista.filter((i) => i.site_status === s).length;

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por código, título ou bairro" value={busca} onChange={(e) => setBusca(e.target.value)} data-testid="site-busca-imovel" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["todos", "ativo", "reservado", "inativo"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFiltro(f)}
              aria-pressed={filtro === f}
              className={cn("rounded-full border px-3 py-1.5 text-sm", filtro === f ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {f === "todos" ? `Todos (${lista.length})` : `${SITE_STATUS[f].rotulo} (${contagem(f)})`}
            </button>
          ))}
        </div>
      </div>

      {pode && sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-accent/40 p-2 text-sm" data-testid="site-acoes-lote">
          <span className="px-1 font-medium">{sel.size} selecionado(s)</span>
          <Button size="sm" onClick={() => alterar.mutate({ ids: [...sel], site_status: "ativo" })}>Colocar no site</Button>
          <Button size="sm" variant="outline" onClick={() => alterar.mutate({ ids: [...sel], site_status: "reservado" })}>Marcar reservado</Button>
          <Button size="sm" variant="outline" onClick={() => alterar.mutate({ ids: [...sel], site_status: "inativo" })}>Tirar do site</Button>
          <button type="button" className="ml-auto px-2 text-muted-foreground hover:underline" onClick={() => setSel(new Set())}>Limpar seleção</button>
        </div>
      )}

      {!filtrada.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {lista.length ? "Nenhum imóvel com esse filtro." : "Cadastre imóveis na tela Imóveis para colocá-los no site."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {pode && (
            <label className="flex items-center gap-2.5 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--primary)]"
                checked={todosSel}
                onChange={() => setSel(todosSel ? new Set() : new Set(filtrada.map((i) => i.id)))}
                aria-label="Selecionar todos"
              />
              Selecionar todos da lista
            </label>
          )}
          <ul className="divide-y" data-testid="site-lista-imoveis">
            {filtrada.map((i) => {
              const fechado = ["vendido", "alugado"].includes(i.status);
              const valor = i.finalidade === "locacao" ? i.valor_aluguel : i.valor_venda ?? i.valor_aluguel;
              return (
                <li key={i.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {pode && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                        checked={sel.has(i.id)}
                        onChange={() => setSel((s) => {
                          const n = new Set(s);
                          if (n.has(i.id)) n.delete(i.id);
                          else n.add(i.id);
                          return n;
                        })}
                        aria-label={`Selecionar ${i.codigo}`}
                      />
                    )}
                    <div className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                      {i.foto_url && <img src={i.foto_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        <span className="text-muted-foreground">{i.codigo}</span> {i.titulo}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[i.bairro, i.cidade].filter(Boolean).join(", ")}
                        {valor ? `, ${brlCompacto(valor)}${i.finalidade === "locacao" ? "/mês" : ""}` : ""}
                        {fechado ? `, ${i.status}: não aparece no site` : ""}
                      </p>
                      {(i.visualizacoes > 0 || i.cliques_whatsapp > 0 || i.contatos > 0) && (
                        <p className="mt-0.5 flex gap-3 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{i.visualizacoes}</span>
                          <span className="inline-flex items-center gap-1"><MousePointerClick className="h-3 w-3" />{i.cliques_whatsapp}</span>
                          <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{i.contatos}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-7 sm:pl-0">
                    <button
                      type="button"
                      disabled={!pode || i.site_status === "inativo"}
                      onClick={() => alterar.mutate({ ids: [i.id], site_destaque: !i.site_destaque })}
                      title={i.site_destaque ? "Tirar dos destaques" : "Mostrar nos destaques"}
                      aria-label={i.site_destaque ? "Tirar dos destaques" : "Mostrar nos destaques"}
                      aria-pressed={i.site_destaque}
                      className="rounded-md p-1.5 hover:bg-muted disabled:opacity-40"
                      data-testid={`site-destaque-${i.codigo}`}
                    >
                      <Star className={cn("h-4 w-4", i.site_destaque ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} />
                    </button>
                    <SiteStatusPicker compacto value={i.site_status} disabled={!pode || fechado} onChange={(v) => alterar.mutate({ ids: [i.id], site_status: v })} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
