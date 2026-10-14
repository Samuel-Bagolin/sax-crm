import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, CheckCheck, FileText, Inbox, Loader2, MessageSquareText, Phone, Search, Send, Smartphone, UserPlus, WifiOff } from "lucide-react";
import { apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { urlApi } from "@/lib/suporte";
import { useEquipe, iniciais } from "@/lib/crm";
import { useSegmento } from "@/lib/segmento";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumerosWhatsApp, type Conexao, type Setor } from "@/components/whatsapp/NumerosWhatsApp";
import { cn } from "@/lib/utils";

interface Situacao { servidor_ok: boolean; liberado: boolean; pode_gerir: boolean; versao: number; conexoes: Conexao[]; setores?: Setor[] }
interface Conversa {
  id: string; nome: string; telefone: string | null; conexao_id: string; responsavel_id: string | null; entrada_id: string | null;
  ultima_msg: string | null; ultima_de_mim: boolean; ultima_em: string | null; nao_lidas: number;
}
interface Midia { tipo: "imagem" | "audio" | "video" | "documento"; mime: string | null; nome: string | null; segundos: number | null }
interface Mensagem { id: string; texto: string; tipo: string; de_mim: boolean; em: string | null; autor: string | null; status: string | null; midia?: Midia | null }

type Filtro = "todas" | "nao_lidas" | "minhas" | "sem_responsavel";
const FILTROS: [Filtro, string][] = [["todas", "Todas"], ["nao_lidas", "Não lidas"], ["minhas", "Minhas"], ["sem_responsavel", "Sem responsável"]];

/** "[Foto] planta da casa" vira "planta da casa"; "[Áudio]" vira vazio. */
function legenda(texto: string) {
  return (texto || "").replace(/^\[[^\]]+\]\s*/, "").trim();
}

function hora(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === hoje.toDateString()) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function dia(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}

/** Foto do contato no WhatsApp; sem foto (ou privada), as iniciais. */
function FotoContato({ c, tamanho }: { c: Conversa; tamanho: "sm" | "md" }) {
  const [erro, setErro] = useState(false);
  const cls = tamanho === "md" ? "h-10 w-10" : "h-9 w-9";
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300", cls)}>
      {iniciais(c.nome) || "?"}
      {!erro && (
        <img src={urlApi(`/api/whatsapp/conversas/${encodeURIComponent(c.id)}/foto`)} alt="" loading="lazy" onError={() => setErro(true)}
          className="absolute inset-0 h-full w-full object-cover" data-testid="wa-foto" />
      )}
    </span>
  );
}

function Anexo({ m }: { m: Mensagem }) {
  const [erro, setErro] = useState(false);
  const md = m.midia!;
  const src = urlApi(`/api/whatsapp/mensagens/${encodeURIComponent(m.id)}/midia`);
  if (erro) return <p className="text-xs italic text-zinc-500">Não foi possível abrir este arquivo aqui. Veja no celular.</p>;
  if (md.tipo === "audio") return <audio controls preload="none" src={src} onError={() => setErro(true)} className="h-10 w-64 max-w-full" data-testid="wa-audio" />;
  if (md.tipo === "imagem") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block">
        <img src={src} alt="Foto recebida" loading="lazy" onError={() => setErro(true)} className="max-h-72 w-auto max-w-full rounded-md" data-testid="wa-imagem" />
      </a>
    );
  }
  if (md.tipo === "video") return <video controls preload="none" src={src} onError={() => setErro(true)} className="max-h-72 max-w-full rounded-md" />;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md bg-black/5 px-2.5 py-2 text-sm hover:bg-black/10 dark:bg-white/10" data-testid="wa-documento">
      <FileText className="h-5 w-5 shrink-0 text-zinc-500" /><span className="truncate">{md.nome || "Abrir documento"}</span>
    </a>
  );
}

function telefoneBonito(t: string | null) {
  if (!t) return "";
  const d = t.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith("55")) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return `+${d}`;
}

export default function WhatsApp() {
  const qc = useQueryClient();
  const { principal, isAdmin } = useAuth();
  const seg = useSegmento();
  const sit = useQuery({ queryKey: ["wa", "situacao"], queryFn: () => apiGet<Situacao>("/whatsapp/situacao"), refetchInterval: 30_000 });
  const ok = !!sit.data?.liberado && !!sit.data?.servidor_ok;
  // Uma leitura leve a cada 4 s; a lista só recarrega quando algo mudou.
  const ver = useQuery({ queryKey: ["wa", "versao"], queryFn: () => apiGet<{ versao: number }>("/whatsapp/versao"), enabled: ok, refetchInterval: 4000 });
  const versao = ver.data?.versao ?? 0;
  const [aba, setAba] = useState<"conversas" | "numeros">("conversas");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busca, setBusca] = useState("");
  const [ativa, setAtiva] = useState<string | null>(null);
  // "" = todos; "n:<id>" = um número; "s:<id>" = um setor.
  const [origem, setOrigem] = useState("");
  const params = `filtro=${filtro}${origem.startsWith("n:") ? `&conexao_id=${origem.slice(2)}` : ""}${origem.startsWith("s:") ? `&setor_id=${origem.slice(2)}` : ""}`;
  const conversas = useQuery({ queryKey: ["wa", "conversas", params, versao], queryFn: () => apiGet<Conversa[]>(`/whatsapp/conversas?${params}`), enabled: ok, placeholderData: (a) => a });
  const { data: equipe = [] } = useEquipe();
  const nomePessoa = useMemo(() => Object.fromEntries(equipe.filter((m) => m.pessoa_id).map((m) => [m.pessoa_id!, m.nome])), [equipe]);
  const conexoes = sit.data?.conexoes ?? [];
  const setores = sit.data?.setores ?? [];
  const setoresComNumero = setores.filter((x) => conexoes.some((c) => c.setor_id === x.id));
  const nomeSetor = Object.fromEntries(setores.map((x) => [x.id, x.nome]));
  const rotuloNumero = (id: string) => {
    const c = conexoes.find((x) => x.id === id);
    if (!c) return "";
    const setor = c.setor_id ? nomeSetor[c.setor_id] : null;
    return setor && setor.toLowerCase() !== c.nome.toLowerCase() ? `${setor} · ${c.nome}` : c.nome;
  };

  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["wa", "situacao"] });
  }, [versao, qc]);

  if (sit.isLoading) return <div className="h-[60vh] animate-pulse rounded-xl bg-muted" />;
  if (!sit.data?.liberado) {
    return (
      <Aviso icone={MessageSquareText} titulo="WhatsApp no CRM"
        texto="Conecte os números da empresa e atenda os clientes pelo CRM, com a equipe toda na mesma caixa de conversas. Este recurso não faz parte do plano atual. Fale com o suporte para liberar." />
    );
  }
  if (!sit.data.servidor_ok) {
    return <Aviso icone={WifiOff} titulo="Servidor do WhatsApp em preparação" texto="A conexão de números ainda não foi ativada nesta instalação. Fale com o suporte do SAX." />;
  }

  const lista = (conversas.data ?? []).filter((c) => {
    const t = busca.trim().toLowerCase();
    return !t || `${c.nome} ${c.telefone ?? ""} ${c.ultima_msg ?? ""}`.toLowerCase().includes(t);
  });
  const conversa = (conversas.data ?? []).find((c) => c.id === ativa) ?? null;
  const semNumero = conexoes.length === 0;

  return (
    <div className="flex h-[calc(100svh-56px-2.5rem)] min-h-[520px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="tablist">
          <button type="button" role="tab" aria-selected={aba === "conversas"} onClick={() => setAba("conversas")} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", aba === "conversas" ? "bg-primary text-primary-foreground" : "text-muted-foreground")} data-testid="wa-aba-conversas">Conversas</button>
          <button type="button" role="tab" aria-selected={aba === "numeros"} onClick={() => setAba("numeros")} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", aba === "numeros" ? "bg-primary text-primary-foreground" : "text-muted-foreground")} data-testid="wa-aba-numeros">
            Números <span className="ml-1 text-xs opacity-80">({conexoes.filter((c) => c.status === "conectado").length}/{conexoes.length})</span>
          </button>
        </div>
        {conexoes.some((c) => c.status !== "conectado") && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <WifiOff className="h-3.5 w-3.5" /> Há número desconectado
          </span>
        )}
      </div>

      {aba === "numeros" ? (
        <NumerosWhatsApp conexoes={conexoes} setores={setores} podeGerir={!!sit.data.pode_gerir} />
      ) : semNumero ? (
        <Aviso icone={Smartphone} titulo="Nenhum número conectado" texto={isAdmin ? "Conecte o WhatsApp da empresa lendo um QR code com o celular. As conversas aparecem aqui na hora." : "Peça ao gestor para conectar o WhatsApp da empresa em Números."}
          acao={isAdmin ? <Button onClick={() => setAba("numeros")} data-testid="wa-ir-numeros">Conectar número</Button> : undefined} />
      ) : (
        <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border bg-card md:grid-cols-[340px_1fr]">
          {/* lista */}
          <aside className={cn("flex min-h-0 flex-col border-r", conversa && "hidden md:flex")}>
            <div className="grid gap-2 border-b p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Buscar conversa" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar conversa" />
              </div>
              {(conexoes.length > 1 || setoresComNumero.length > 0) && (
                <select value={origem} onChange={(e) => setOrigem(e.target.value)} aria-label="Número ou setor" className="h-9 rounded-md border bg-background px-2 text-sm" data-testid="wa-origem">
                  <option value="">Todos os números</option>
                  {setoresComNumero.length > 0 && (
                    <optgroup label="Setores">{setoresComNumero.map((x) => <option key={x.id} value={`s:${x.id}`}>{x.nome}</option>)}</optgroup>
                  )}
                  <optgroup label="Números">{conexoes.map((c) => <option key={c.id} value={`n:${c.id}`}>{c.nome}</option>)}</optgroup>
                </select>
              )}
              <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtro">
                {FILTROS.map(([f, r]) => (
                  <button key={f} type="button" role="tab" aria-selected={filtro === f} onClick={() => setFiltro(f)}
                    className={cn("shrink-0 rounded-full border px-2.5 py-1 text-xs", filtro === f ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{r}</button>
                ))}
              </div>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="wa-lista">
              {!lista.length && <li className="p-6 text-center text-sm text-muted-foreground">{conversas.isLoading ? "Carregando..." : "Nenhuma conversa aqui ainda. Quando um cliente mandar mensagem, ela aparece nesta lista."}</li>}
              {lista.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setAtiva(c.id)} className={cn("flex w-full items-center gap-3 border-b px-3 py-2.5 text-left hover:bg-muted/60", ativa === c.id && "bg-accent/60")} data-testid="wa-conversa">
                    <FotoContato c={c} tamanho="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-sm", c.nao_lidas ? "font-semibold" : "font-medium")}>{c.nome}</span>
                        <span className={cn("shrink-0 text-[11px]", c.nao_lidas ? "font-semibold text-emerald-600" : "text-muted-foreground")}>{hora(c.ultima_em)}</span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">{c.ultima_de_mim && "Você: "}{c.ultima_msg}</span>
                        {c.nao_lidas > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-white">{c.nao_lidas}</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {conexoes.length > 1 || setores.length > 0 ? <span className="font-medium text-foreground/70">{rotuloNumero(c.conexao_id)} · </span> : null}
                        {c.responsavel_id ? nomePessoa[c.responsavel_id] ?? "Responsável" : "Sem responsável"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          {/* conversa */}
          <section className={cn("min-h-0 flex-col", conversa ? "flex" : "hidden md:flex")}>
            {conversa ? (
              <Conversa key={conversa.id} c={conversa} versao={versao} voltar={() => setAtiva(null)} equipe={equipe.filter((m) => m.pessoa_id && m.ativo !== false).map((m) => ({ id: m.pessoa_id!, nome: m.nome }))}
                isAdmin={isAdmin} minhaPessoa={principal?.pessoa_id ?? null} temLeads={seg.vendas || seg.chave === "odontologia" || seg.chave === "estetica"}
                conexao={conexoes.find((x) => x.id === conversa.conexao_id)} />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
                <MessageSquareText className="h-10 w-10 opacity-40" />
                <p className="text-sm">Escolha uma conversa para ler e responder.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Conversa({ c, versao, voltar, equipe, isAdmin, minhaPessoa, temLeads, conexao }: {
  c: Conversa; versao: number; voltar: () => void; equipe: { id: string; nome: string }[]; isAdmin: boolean; minhaPessoa: string | null; temLeads: boolean; conexao?: Conexao;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["wa", "msgs", c.id, versao], queryFn: () => apiGet<{ mensagens: Mensagem[] }>(`/whatsapp/conversas/${encodeURIComponent(c.id)}/mensagens`), placeholderData: (a) => a });
  const [texto, setTexto] = useState("");
  const fim = useRef<HTMLDivElement>(null);
  const msgs = q.data?.mensagens ?? [];

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  const enviar = useMutation({
    mutationFn: (t: string) => apiPost<Mensagem>(`/whatsapp/conversas/${encodeURIComponent(c.id)}/mensagens`, { texto: t }),
    onMutate: () => setTexto(""),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa"] }),
    onError: (e, t) => { setTexto(t); toast.error(detalheErro(e) ?? "Não foi possível enviar."); },
  });
  const responsavel = useMutation({
    mutationFn: (pessoa_id: string | null) => apiPut(`/whatsapp/conversas/${encodeURIComponent(c.id)}/responsavel`, { pessoa_id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wa"] }); toast.success("Responsável atualizado."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível mudar o responsável."),
  });
  const lead = useMutation({
    mutationFn: () => apiPost<{ entrada_id: string; criado: boolean }>(`/whatsapp/conversas/${encodeURIComponent(c.id)}/lead`),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["wa"] }); toast.success(r.criado ? "Contato levado para Leads." : "Este contato já está em Leads."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível criar o lead."),
  });

  const desconectado = conexao?.status !== "conectado";
  const mandar = () => { const t = texto.trim(); if (t && !enviar.isPending) enviar.mutate(t); };
  const tecla = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); mandar(); } };
  let ultimoDia = "";

  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={voltar} aria-label="Voltar para a lista"><ArrowLeft className="h-4 w-4" /></Button>
        <FotoContato c={c} tamanho="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" data-testid="wa-contato-nome">{c.nome}</p>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground"><Phone className="h-3 w-3" />{telefoneBonito(c.telefone)}{conexao ? ` · pelo número ${conexao.nome}` : ""}</p>
        </div>
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
        {isAdmin ? (
          <select aria-label="Responsável pela conversa" value={c.responsavel_id ?? ""} onChange={(e) => responsavel.mutate(e.target.value || null)} className="h-8 min-w-0 max-w-[180px] flex-1 rounded-md border bg-background px-2 text-xs sm:flex-none" data-testid="wa-responsavel">
            <option value="">Sem responsável</option>
            {equipe.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        ) : !c.responsavel_id && minhaPessoa ? (
          <Button size="sm" variant="outline" onClick={() => responsavel.mutate(minhaPessoa)}>Assumir conversa</Button>
        ) : null}
        {temLeads && (c.entrada_id ? (
          <Link to={`/leads?id=${c.entrada_id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium hover:bg-muted" data-testid="wa-ver-lead"><Inbox className="h-3.5 w-3.5" /> Ver lead</Link>
        ) : (
          <Button size="sm" variant="outline" onClick={() => lead.mutate()} disabled={lead.isPending} data-testid="wa-criar-lead"><UserPlus className="h-3.5 w-3.5" /> Levar para Leads</Button>
        ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#efeae2] px-3 py-4 dark:bg-zinc-900 sm:px-6" data-testid="wa-mensagens"
        style={{ backgroundImage: "radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
        {q.isLoading && <p className="text-center text-sm text-muted-foreground">Carregando...</p>}
        <div className="flex flex-col gap-1.5">
          {msgs.map((m) => {
            const d = dia(m.em);
            const separador = d !== ultimoDia;
            ultimoDia = d;
            return (
              <div key={m.id} className="flex flex-col">
                {separador && <p className="my-2 self-center rounded-md bg-white/90 px-2.5 py-1 text-[11px] font-medium text-zinc-600 shadow-sm dark:bg-zinc-800 dark:text-zinc-300">{d}</p>}
                <div className={cn("flex w-full", m.de_mim ? "justify-end" : "justify-start")}>
                <div data-testid="wa-balao" className={cn("max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm sm:max-w-[65%] lg:max-w-[55%]", m.de_mim ? "rounded-tr-sm bg-[#d9fdd3] text-zinc-900 dark:bg-emerald-900 dark:text-emerald-50" : "rounded-tl-sm bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100")}>
                  {m.de_mim && m.autor && <p className="mb-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">{m.autor}</p>}
                  {m.midia ? (
                    <div className="grid gap-1">
                      <Anexo m={m} />
                      {legenda(m.texto) && <p className="whitespace-pre-wrap break-words">{legenda(m.texto)}</p>}
                    </div>
                  ) : (
                    <p className={cn("whitespace-pre-wrap break-words", m.tipo !== "texto" && "italic text-zinc-600 dark:text-zinc-300")}>{m.texto}</p>
                  )}
                  <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-zinc-500">{hora(m.em)}{m.de_mim && (m.status === "READ" ? <CheckCheck className="h-3 w-3 text-sky-500" /> : m.status === "DELIVERY_ACK" ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />)}</p>
                </div>
                </div>
              </div>
            );
          })}
          <div ref={fim} />
        </div>
      </div>

      <footer className="border-t p-2">
        {desconectado ? (
          <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300"><WifiOff className="h-4 w-4" /> O número desta conversa está desconectado. {isAdmin ? "Leia o QR code de novo em Números." : "Avise o gestor."}</p>
        ) : (
          <div className="flex items-end gap-2">
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={tecla} rows={1} maxLength={4096} placeholder="Escreva uma mensagem. Enter envia, Shift+Enter pula linha."
              className="max-h-40 min-h-10 flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" aria-label="Mensagem" data-testid="wa-texto" />
            <Button onClick={mandar} disabled={!texto.trim() || enviar.isPending} aria-label="Enviar" className="h-10 w-10 shrink-0 p-0" data-testid="wa-enviar">
              {enviar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </footer>
    </>
  );
}

function Aviso({ icone: Icone, titulo, texto, acao }: { icone: typeof Inbox; titulo: string; texto: string; acao?: ReactNode }) {
  return (
    <div className="mx-auto mt-6 max-w-xl rounded-2xl border bg-card p-8 text-center">
      <Icone className="mx-auto h-10 w-10 text-primary" />
      <h2 className="mt-3 text-lg font-semibold">{titulo}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{texto}</p>
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}
