import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  FileText,
  Handshake,
  Hash,
  Loader2,
  Paperclip,
  Plus,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { apiDelete, apiGet, apiPost, detalheErro } from "@/lib/api";
import { corDoMembro } from "@/lib/crm";
import { enviarArquivo } from "@/lib/google";
import { useAuth } from "@/lib/useAuth";
import type { NegocioResumo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import Avatar from "@/components/shared/Avatar";
import Combo from "@/components/shared/Combo";
import { cn } from "@/lib/utils";

interface Participante {
  usuario_id: string;
  nome: string;
  tem_foto: boolean;
  foto_v: number;
  cor: string | null;
  pessoa_id: string | null;
}
interface Conversa {
  id: string;
  tipo: "canal" | "direta";
  nome: string;
  todos: boolean;
  membros: Participante[];
  nao_lidas: number;
  ultima_msg_texto: string | null;
  ultima_msg_autor: string | null;
  ultima_msg_em: string | null;
}
interface Mensagem {
  id: string;
  conversa_id: string;
  autor_id: string;
  autor_nome: string;
  texto: string;
  negocio_id: string | null;
  negocio_nome: string | null;
  anexo_nome: string | null;
  anexo_mime: string | null;
  excluida: boolean;
  em: string;
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function diaRotulo(iso: string) {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
function quandoCurto(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? hora(iso)
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Destaca @nome e quebra linhas; sem HTML vindo do usuário. */
/** Realça @menções: estende a menção palavra a palavra enquanto ela continuar batendo com o nome de alguém da equipe. */
function TextoMensagem({ texto, nomes }: { texto: string; nomes: string[] }) {
  const baixos = nomes.map((n) => n.toLowerCase());
  const partes: { t: string; mencao: boolean }[] = [];
  const re = /@([\p{L}]+)/gu;
  let pos = 0;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    let fimMencao = m.index + m[0].length;
    let alvo = m[1].toLowerCase();
    if (
      !baixos.some((n) => n.split(" ").some((parte) => parte.startsWith(alvo)))
    )
      continue;
    // tenta incluir as próximas palavras ("@Gestor da Imobiliária")
    const resto = /^\s([\p{L}]+)/u;
    for (
      let r = resto.exec(texto.slice(fimMencao));
      r;
      r = resto.exec(texto.slice(fimMencao))
    ) {
      const tentativa = `${alvo} ${r[1].toLowerCase()}`;
      if (
        !baixos.some(
          (n) =>
            n.startsWith(tentativa) &&
            (n.length === tentativa.length || n[tentativa.length] === " "),
        )
      )
        break;
      alvo = tentativa;
      fimMencao += r[0].length;
    }
    if (m.index > pos)
      partes.push({ t: texto.slice(pos, m.index), mencao: false });
    partes.push({ t: texto.slice(m.index, fimMencao), mencao: true });
    pos = fimMencao;
    re.lastIndex = fimMencao;
  }
  if (pos < texto.length) partes.push({ t: texto.slice(pos), mencao: false });
  return (
    <>
      {partes.map((p, i) =>
        p.mencao ? (
          <span key={i} className="rounded bg-sax/25 px-0.5 font-semibold">
            {p.t}
          </span>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </>
  );
}

export default function Chat() {
  const qc = useQueryClient();
  const { principal, isAdmin } = useAuth();
  const { data: equipe = [] } = useQuery({
    queryKey: ["chat", "pessoas"],
    queryFn: () => apiGet<Participante[]>("/chat/pessoas"),
    staleTime: 300_000,
  });
  const [params, setParams] = useSearchParams();
  const [ativaId, setAtivaId] = useState<string>(params.get("c") ?? "geral");
  const [busca, setBusca] = useState("");
  const [texto, setTexto] = useState("");
  const [negocioCitado, setNegocioCitado] = useState<string | null>(null);
  const [citando, setCitando] = useState(false);
  const [novoGrupo, setNovoGrupo] = useState(false);
  const [nomeGrupo, setNomeGrupo] = useState("");
  const [membrosGrupo, setMembrosGrupo] = useState<string[]>([]);
  const [mobileLista, setMobileLista] = useState(!params.get("c"));
  const [anexando, setAnexando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);

  const { data: conversas = [] } = useQuery({
    queryKey: ["chat", "conversas"],
    queryFn: () => apiGet<Conversa[]>("/chat/conversas"),
    refetchInterval: 8000,
  });
  const ativa = conversas.find((c) => c.id === ativaId);

  // Mensagens: carga inicial + busca incremental a cada 3 s (só as novas).
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const ultima = mensagens.at(-1)?.em;
  const { isLoading: carregando } = useQuery({
    queryKey: ["chat", "inicial", ativaId],
    queryFn: async () => {
      const lista = await apiGet<Mensagem[]>(
        `/chat/conversas/${ativaId}/mensagens`,
      );
      setMensagens(lista);
      qc.invalidateQueries({ queryKey: ["chat", "nao-lidas"] });
      qc.invalidateQueries({ queryKey: ["chat", "conversas"] });
      return lista.length;
    },
  });
  useQuery({
    queryKey: ["chat", "novas", ativaId, ultima],
    queryFn: async () => {
      if (!ultima) return 0;
      const novas = await apiGet<Mensagem[]>(
        `/chat/conversas/${ativaId}/mensagens?depois=${encodeURIComponent(ultima)}`,
      );
      if (novas.length) {
        setMensagens((m) => [
          ...m,
          ...novas.filter((n) => !m.some((x) => x.id === n.id)),
        ]);
        qc.invalidateQueries({ queryKey: ["chat", "conversas"] });
      }
      return novas.length;
    },
    refetchInterval: 3000,
    enabled: !!ultima,
  });

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [mensagens.length, ativaId]);

  const { data: negocios = [] } = useQuery({
    queryKey: ["kanban", "chat"],
    queryFn: () => apiGet<NegocioResumo[]>("/leads/kanban?status=todos"),
    enabled: citando,
  });

  const abrir = (id: string) => {
    setAtivaId(id);
    setMensagens([]);
    setMobileLista(false);
    params.set("c", id);
    setParams(params, { replace: true });
  };

  const enviar = useMutation({
    mutationFn: () =>
      apiPost<Mensagem>(`/chat/conversas/${ativaId}/mensagens`, {
        texto,
        negocio_id: negocioCitado,
      }),
    onSuccess: (m) => {
      setMensagens((l) => [...l, m]);
      setTexto("");
      setNegocioCitado(null);
      setCitando(false);
      qc.invalidateQueries({ queryKey: ["chat", "conversas"] });
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Mensagem não enviada"),
  });
  const apagar = useMutation({
    mutationFn: (id: string) => apiDelete(`/chat/mensagens/${id}`),
    onSuccess: (_d, id) =>
      setMensagens((l) =>
        l.map((m) =>
          m.id === id
            ? { ...m, excluida: true, texto: "", anexo_nome: null }
            : m,
        ),
      ),
  });
  const direta = useMutation({
    mutationFn: (usuarioId: string) =>
      apiPost<Conversa>("/chat/diretas", { usuario_id: usuarioId }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["chat", "conversas"] });
      abrir(c.id);
    },
    onError: (e) =>
      toast.error(detalheErro(e) ?? "Não foi possível abrir a conversa"),
  });
  const criarGrupo = useMutation({
    mutationFn: () =>
      apiPost<Conversa>("/chat/canais", {
        nome: nomeGrupo,
        membros: membrosGrupo,
      }),
    onSuccess: (c) => {
      setNovoGrupo(false);
      setNomeGrupo("");
      setMembrosGrupo([]);
      qc.invalidateQueries({ queryKey: ["chat", "conversas"] });
      abrir(c.id);
    },
    onError: (e) =>
      toast.error(detalheErro(e) ?? "Não foi possível criar o grupo"),
  });

  const anexar = async (f: File | undefined) => {
    if (!f) return;
    setAnexando(true);
    try {
      const m = await enviarArquivo<Mensagem>(
        `/chat/conversas/${ativaId}/anexo`,
        { arquivo: f, texto },
      );
      setMensagens((l) => [...l, m]);
      setTexto("");
      qc.invalidateQueries({ queryKey: ["chat", "conversas"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAnexando(false);
      if (arquivo.current) arquivo.current.value = "";
    }
  };

  const outrosMembros = equipe.filter(
    (m) => m.usuario_id !== principal?.usuario_id,
  );
  const diretasExistentes = new Set(
    conversas
      .filter((c) => c.tipo === "direta")
      .flatMap((c) => c.membros.map((m) => m.usuario_id)),
  );
  const semConversa = outrosMembros.filter(
    (m) => !diretasExistentes.has(m.usuario_id),
  );
  const t = busca.trim().toLowerCase();
  const listaFiltrada = conversas.filter(
    (c) => !t || c.nome.toLowerCase().includes(t),
  );
  const nomesEquipe = equipe.map((m) => m.nome);
  const membroPorUsuario = useMemo(
    () =>
      new Map(
        equipe.map((m, i) => [m.usuario_id, { m, cor: corDoMembro(m, i) }]),
      ),
    [equipe],
  );

  const avatarConversa = (c: Conversa, tamanho: "sm" | "md" = "md") => {
    if (c.tipo === "direta") {
      const outro = c.membros.find(
        (m) => m.usuario_id !== principal?.usuario_id,
      );
      const info = outro ? membroPorUsuario.get(outro.usuario_id) : undefined;
      return (
        <Avatar
          nome={outro?.nome}
          usuarioId={outro?.usuario_id}
          temFoto={outro?.tem_foto}
          versao={outro?.foto_v}
          cor={info?.cor}
          tamanho={tamanho}
        />
      );
    }
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary",
          tamanho === "md" ? "h-9 w-9" : "h-7 w-7",
        )}
      >
        {c.todos ? <Hash className="h-4 w-4" /> : <Users className="h-4 w-4" />}
      </span>
    );
  };

  return (
    <div className="flex h-[calc(100svh-56px-2.5rem)] min-h-[520px] overflow-hidden rounded-lg border bg-card">
      {/* Lista */}
      <aside
        className={cn(
          "w-full shrink-0 flex-col border-r md:flex md:w-72",
          mobileLista ? "flex" : "hidden",
        )}
      >
        <div className="flex items-center gap-2 border-b p-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar conversa"
              className="h-8 pl-8"
            />
          </div>
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => setNovoGrupo(true)}
            title="Novo grupo"
            aria-label="Novo grupo"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-fino">
          {listaFiltrada.map((c) => {
            const naoLidas = c.id === ativaId ? 0 : c.nao_lidas;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => abrir(c.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/60",
                  c.id === ativaId && "bg-accent",
                )}
                data-testid={`conversa-${c.id}`}
              >
                {avatarConversa(c)}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "flex-1 truncate text-sm",
                        naoLidas ? "font-bold" : "font-medium",
                      )}
                    >
                      {c.nome}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {quandoCurto(c.ultima_msg_em)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex-1 truncate text-xs",
                        naoLidas ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {c.ultima_msg_texto
                        ? `${c.tipo === "canal" && c.ultima_msg_autor ? c.ultima_msg_autor.split(" ")[0] + ": " : ""}${c.ultima_msg_texto}`
                        : c.todos
                          ? "Canal de toda a equipe"
                          : "Sem mensagens"}
                    </span>
                    {naoLidas > 0 && (
                      <span className="num rounded-full bg-sax px-1.5 text-[11px] font-bold leading-[18px] text-white">
                        {naoLidas}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
          {semConversa.length > 0 && !t && (
            <>
              <p className="px-3 pb-1 pt-4 text-xs font-medium text-muted-foreground">
                Começar conversa
              </p>
              {semConversa.map((m) => (
                <button
                  key={m.usuario_id}
                  type="button"
                  onClick={() => direta.mutate(m.usuario_id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60"
                >
                  <Avatar
                    nome={m.nome}
                    usuarioId={m.usuario_id}
                    temFoto={m.tem_foto}
                    versao={m.foto_v}
                    cor={membroPorUsuario.get(m.usuario_id)?.cor}
                    tamanho="sm"
                  />
                  <span className="truncate text-sm">{m.nome}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </aside>

      {/* Conversa */}
      <section
        className={cn(
          "min-w-0 flex-1 flex-col",
          mobileLista ? "hidden md:flex" : "flex",
        )}
      >
        <header className="flex items-center gap-3 border-b px-4 py-2.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={() => setMobileLista(true)}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          {ativa && avatarConversa(ativa, "sm")}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">
              {ativa?.nome ?? "Conversa"}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {ativa?.todos
                ? "Canal de toda a equipe"
                : ativa?.tipo === "canal"
                  ? ativa.membros.map((m) => m.nome.split(" ")[0]).join(", ")
                  : "Conversa privada"}
            </p>
          </div>
        </header>

        <div
          className="flex-1 space-y-1 overflow-y-auto bg-background/60 px-3 py-4 scroll-fino sm:px-6"
          data-testid="mensagens"
        >
          {carregando && (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          )}
          {!carregando && !mensagens.length && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {ativa?.todos
                ? "Avisos, conquistas e dúvidas do time aparecem aqui."
                : "Nenhuma mensagem ainda. Diga oi."}
            </p>
          )}
          {mensagens.map((m, i) => {
            const minha = m.autor_id === principal?.usuario_id;
            const anterior = mensagens[i - 1];
            const novoDia =
              !anterior ||
              new Date(anterior.em).toDateString() !==
                new Date(m.em).toDateString();
            const agrupada =
              !novoDia &&
              anterior?.autor_id === m.autor_id &&
              new Date(m.em).getTime() - new Date(anterior.em).getTime() <
                5 * 60_000;
            const info = membroPorUsuario.get(m.autor_id);
            return (
              <div key={m.id}>
                {novoDia && (
                  <div className="my-3 flex items-center gap-3 text-[11px] font-medium text-muted-foreground first-letter:uppercase">
                    <span className="h-px flex-1 bg-border" />
                    <span className="first-letter:uppercase">
                      {diaRotulo(m.em)}
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                <div
                  className={cn(
                    "group flex items-end gap-2",
                    minha && "flex-row-reverse",
                    !agrupada && "mt-2.5",
                  )}
                >
                  {!minha && (
                    <span className="w-7 shrink-0">
                      {!agrupada && (
                        <Avatar
                          nome={m.autor_nome}
                          usuarioId={m.autor_id}
                          temFoto={info?.m.tem_foto}
                          versao={info?.m.foto_v}
                          cor={info?.cor}
                          tamanho="sm"
                        />
                      )}
                    </span>
                  )}
                  <div
                    className={cn(
                      "max-w-[78%] sm:max-w-[65%]",
                      minha && "items-end",
                    )}
                  >
                    {!agrupada && !minha && ativa?.tipo === "canal" && (
                      <p
                        className="mb-0.5 ml-1 text-xs font-semibold"
                        style={{ color: info?.cor ?? undefined }}
                      >
                        {m.autor_nome}
                      </p>
                    )}
                    <div
                      className={cn(
                        "rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-[0_1px_0_rgba(0,0,0,0.04)]",
                        minha
                          ? "rounded-br-md bg-primary text-primary-foreground"
                          : "rounded-bl-md border bg-card",
                        m.excluida && "bg-muted italic text-muted-foreground",
                      )}
                    >
                      {m.excluida ? (
                        "Mensagem apagada"
                      ) : (
                        <>
                          {m.anexo_nome &&
                            (m.anexo_mime?.startsWith("image/") ? (
                              <a
                                href={`/api/chat/mensagens/${m.id}/anexo`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <img
                                  src={`/api/chat/mensagens/${m.id}/anexo`}
                                  alt={m.anexo_nome}
                                  className="mb-1 max-h-56 rounded-lg object-cover"
                                />
                              </a>
                            ) : (
                              <a
                                href={`/api/chat/mensagens/${m.id}/anexo`}
                                target="_blank"
                                rel="noreferrer"
                                className={cn(
                                  "mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5",
                                  minha ? "bg-white/15" : "bg-muted",
                                )}
                              >
                                <FileText className="h-4 w-4 shrink-0" />
                                <span className="truncate underline-offset-2 hover:underline">
                                  {m.anexo_nome}
                                </span>
                              </a>
                            ))}
                          {m.negocio_id && (
                            <Link
                              to={`/negocios/${m.negocio_id}`}
                              className={cn(
                                "mb-1 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold",
                                minha
                                  ? "bg-white/15 hover:bg-white/25"
                                  : "bg-accent text-accent-foreground hover:brightness-95",
                              )}
                            >
                              <Handshake className="h-3.5 w-3.5" />{" "}
                              {m.negocio_nome}
                            </Link>
                          )}
                          {m.texto && (
                            <p className="whitespace-pre-wrap break-words">
                              <TextoMensagem
                                texto={m.texto}
                                nomes={nomesEquipe}
                              />
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    <p
                      className={cn(
                        "mt-0.5 flex items-center gap-2 px-1 text-[10px] text-muted-foreground",
                        minha && "justify-end",
                      )}
                    >
                      {hora(m.em)}
                      {(minha || isAdmin) && !m.excluida && (
                        <button
                          className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                          onClick={() => apagar.mutate(m.id)}
                          aria-label="Apagar mensagem"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={fim} />
        </div>

        {/* Composer */}
        <div className="border-t p-3">
          {citando && (
            <div className="mb-2 flex items-center gap-2">
              <div className="flex-1">
                <Combo
                  opcoes={negocios.map((n) => ({
                    valor: n.id,
                    rotulo: n.nome,
                    detalhe: n.cliente_nome,
                  }))}
                  valor={negocioCitado}
                  onChange={setNegocioCitado}
                  placeholder="Escolha o negócio para citar"
                />
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setCitando(false);
                  setNegocioCitado(null);
                }}
                aria-label="Cancelar citação"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (texto.trim() || negocioCitado) enviar.mutate();
            }}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Anexar imagem ou PDF"
              onClick={() => arquivo.current?.click()}
              disabled={anexando}
            >
              {anexando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </Button>
            <input
              ref={arquivo}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => anexar(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant={citando ? "secondary" : "ghost"}
              size="icon"
              title="Citar um negócio"
              onClick={() => setCitando((v) => !v)}
            >
              <Handshake className="h-4 w-4" />
            </Button>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (texto.trim() || negocioCitado) enviar.mutate();
                }
              }}
              rows={1}
              placeholder={`Mensagem para ${ativa?.nome ?? "a conversa"} (Enter envia, Shift+Enter quebra linha)`}
              className="max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              data-testid="chat-texto"
            />
            <Button
              type="submit"
              size="icon"
              disabled={enviar.isPending || (!texto.trim() && !negocioCitado)}
              aria-label="Enviar"
              data-testid="chat-enviar"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </section>

      <Dialog open={novoGrupo} onOpenChange={setNovoGrupo}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo grupo</DialogTitle>
            <DialogDescription>
              Para combinar um plantão, uma praça ou um lançamento com parte da
              equipe.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={nomeGrupo}
            onChange={(e) => setNomeGrupo(e.target.value)}
            placeholder="Nome do grupo"
            aria-label="Nome do grupo"
          />
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {outrosMembros.map((m) => {
              const marcado = membrosGrupo.includes(m.usuario_id);
              return (
                <label
                  key={m.usuario_id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={() =>
                      setMembrosGrupo((l) =>
                        marcado
                          ? l.filter((x) => x !== m.usuario_id)
                          : [...l, m.usuario_id],
                      )
                    }
                    className="accent-[var(--primary)]"
                  />
                  <Avatar
                    nome={m.nome}
                    usuarioId={m.usuario_id}
                    temFoto={m.tem_foto}
                    versao={m.foto_v}
                    tamanho="xs"
                    cor={membroPorUsuario.get(m.usuario_id)?.cor}
                  />
                  <span className="text-sm">{m.nome}</span>
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovoGrupo(false)}>
              Cancelar
            </Button>
            <Button
              disabled={
                nomeGrupo.trim().length < 2 ||
                !membrosGrupo.length ||
                criarGrupo.isPending
              }
              onClick={() => criarGrupo.mutate()}
            >
              Criar grupo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
