import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  CircleDashed,
  Copy,
  Download,
  Eye,
  FileText,
  HardDrive,
  Mail,
  MessageCircle,
  Pencil,
  RefreshCw,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { PAPEL_SIGNATARIO, linkWhatsapp } from "@/lib/crm";
import { useGoogle } from "@/lib/google";
import { useAuth } from "@/lib/useAuth";
import type { ModeloContrato, PainelAssinatura, PapelSignatario, Signatario } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import DocumentoTexto from "@/components/contratos/DocumentoTexto";
import { cn } from "@/lib/utils";

const STATUS: Record<PainelAssinatura["status"], { rotulo: string; cls: string }> = {
  rascunho: { rotulo: "Rascunho", cls: "bg-muted text-muted-foreground" },
  aguardando: { rotulo: "Aguardando assinaturas", cls: "bg-sem-atividade/15 text-sem-atividade" },
  assinado: { rotulo: "Assinado por todos", cls: "bg-hoje/15 text-hoje" },
  recusado: { rotulo: "Recusado", cls: "bg-atrasada/10 text-atrasada" },
};

const STATUS_SIG: Record<Signatario["status"], { rotulo: string; icone: typeof Check; cls: string }> = {
  pendente: { rotulo: "Não abriu", icone: CircleDashed, cls: "text-muted-foreground" },
  visualizado: { rotulo: "Abriu o documento", icone: Eye, cls: "text-sem-atividade" },
  assinado: { rotulo: "Assinou", icone: Check, cls: "text-hoje" },
  recusado: { rotulo: "Recusou", icone: X, cls: "text-atrasada" },
};

function quando(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function linkAssinatura(token: string | null) {
  return token ? `${window.location.origin}/assinar/${token}` : "";
}

export default function AssinaturaPanel({ contratoId, onClose }: { contratoId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { principal } = useAuth();
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [novoSig, setNovoSig] = useState(false);
  const [sig, setSig] = useState({ nome: "", email: "", telefone: "", cpf: "", papel: "comprador" as PapelSignatario });

  const chave = ["assinatura", contratoId];
  const { data: painel, isLoading } = useQuery({
    queryKey: chave,
    queryFn: () => apiGet<PainelAssinatura>(`/contratos/${contratoId}/assinatura`),
    enabled: !!contratoId,
    refetchInterval: 20_000, // acompanha quem abriu/assinou sem recarregar
  });
  const { data: modelos = [] } = useQuery({
    queryKey: ["modelos-contrato"],
    queryFn: () => apiGet<ModeloContrato[]>("/modelos-contrato"),
    enabled: !!contratoId,
  });

  useEffect(() => {
    if (!contratoId) {
      setEditando(false);
      setNovoSig(false);
    }
  }, [contratoId]);

  const aplicar = (p: PainelAssinatura) => {
    qc.setQueryData(chave, p);
    qc.invalidateQueries({ queryKey: ["contratos"] });
  };
  const erro = (e: unknown) => toast.error(detalheErro(e) ?? "Não foi possível concluir");

  const gerar = useMutation({
    mutationFn: (modeloId: string) => apiPost<PainelAssinatura>(`/contratos/${contratoId}/documento/gerar`, { modelo_id: modeloId }),
    onSuccess: (p) => {
      aplicar(p);
      toast.success("Documento gerado com os dados do contrato");
    },
    onError: erro,
  });
  const salvarTexto = useMutation({
    mutationFn: () => apiPut<PainelAssinatura>(`/contratos/${contratoId}/documento`, { titulo, texto }),
    onSuccess: (p) => {
      aplicar(p);
      setEditando(false);
      toast.success("Texto salvo");
    },
    onError: erro,
  });
  const partes = useMutation({
    mutationFn: () => apiPost<PainelAssinatura>(`/contratos/${contratoId}/signatarios/partes`),
    onSuccess: aplicar,
    onError: erro,
  });
  const adicionar = useMutation({
    mutationFn: () =>
      apiPost<PainelAssinatura>(`/contratos/${contratoId}/signatarios`, {
        nome: sig.nome.trim(),
        email: sig.email.trim() || null,
        telefone: sig.telefone.trim() || null,
        cpf: sig.cpf.trim() || null,
        papel: sig.papel,
      }),
    onSuccess: (p) => {
      aplicar(p);
      setNovoSig(false);
      setSig({ nome: "", email: "", telefone: "", cpf: "", papel: "comprador" });
    },
    onError: erro,
  });
  const remover = useMutation({
    mutationFn: (id: string) => apiDelete<PainelAssinatura>(`/contratos/${contratoId}/signatarios/${id}`),
    onSuccess: aplicar,
    onError: erro,
  });
  const novoLink = useMutation({
    mutationFn: (id: string) => apiPost<PainelAssinatura>(`/contratos/${contratoId}/signatarios/${id}/novo-link`),
    onSuccess: (p) => {
      aplicar(p);
      toast.success("Novo link gerado. O anterior deixou de funcionar.");
    },
    onError: erro,
  });
  const marcar = useMutation({
    mutationFn: ({ id, canal }: { id: string; canal: string }) => apiPost<PainelAssinatura>(`/contratos/${contratoId}/signatarios/${id}/enviado?canal=${canal}`),
    onSuccess: aplicar,
  });
  const email = useMutation({
    mutationFn: (id: string) => apiPost<PainelAssinatura>(`/contratos/${contratoId}/signatarios/${id}/email`),
    onSuccess: (p) => {
      aplicar(p);
      toast.success("E-mail com o link entrou na fila de envio");
    },
    onError: erro,
  });

  const { data: google } = useGoogle();
  const salvarDrive = useMutation({
    mutationFn: () => apiPost(`/contratos/${contratoId}/drive`),
    onSuccess: () => {
      toast.success("PDF salvo na pasta SAX CRM do seu Google Drive");
      qc.invalidateQueries({ queryKey: ["documentos"] });
    },
    onError: erro,
  });

  const copiar = async (s: Signatario) => {
    const url = linkAssinatura(s.token);
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`Link de ${s.nome.split(" ")[0]} copiado`);
    } catch {
      window.prompt("Copie o link:", url);
    }
    marcar.mutate({ id: s.id, canal: "link" });
  };
  const whatsapp = (s: Signatario) => {
    const msg = `Olá ${s.nome.split(" ")[0]}, tudo bem? Segue o link para ler e assinar o contrato ${painel?.numero}${principal?.empresa_nome ? ` da ${principal.empresa_nome}` : ""}: ${linkAssinatura(s.token)}`;
    const url = linkWhatsapp(s.telefone, msg) ?? `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener");
    marcar.mutate({ id: s.id, canal: "whatsapp" });
  };

  const doc = painel?.documento;
  const temDoc = !!doc?.texto;
  const assinados = painel?.signatarios.filter((s) => s.status === "assinado").length ?? 0;
  const total = painel?.signatarios.length ?? 0;

  return (
    <Dialog open={!!contratoId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[94vh] max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="flex-row items-center gap-3 border-b py-3 pl-5 pr-12">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base">Assinatura eletrônica, contrato {painel?.numero}</DialogTitle>
            <DialogDescription className="text-xs">Gere o documento, inclua quem assina e envie o link. Cada pessoa assina pelo celular, sem cadastro.</DialogDescription>
          </div>
          {painel && <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", STATUS[painel.status].cls)}>{STATUS[painel.status].rotulo}</span>}
          {temDoc && google?.conectado && (
            <Button variant="outline" size="sm" onClick={() => salvarDrive.mutate()} disabled={salvarDrive.isPending} title="Salva o PDF com a página de assinaturas no seu Google Drive">
              <HardDrive className="h-3.5 w-3.5" /> Salvar no Drive
            </Button>
          )}
          {temDoc && (
            <Button variant="outline" size="sm" onClick={() => window.open(`/api/contratos/${contratoId}/documento.pdf`, "_blank")} data-testid="assinatura-pdf">
              <Download className="h-3.5 w-3.5" /> PDF
            </Button>
          )}
        </DialogHeader>

        {isLoading || !painel ? (
          <div className="flex-1 animate-pulse bg-muted/40" />
        ) : (
          <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_400px]">
            {/* Documento */}
            <div className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
              <div className="flex items-center gap-2 border-b px-5 py-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate text-sm font-medium">{temDoc ? doc!.titulo : "Documento"}</span>
                {temDoc && !painel.bloqueado && !editando && (
                  <>
                    <select
                      className="h-7 rounded-md border bg-card px-2 text-xs"
                      value=""
                      onChange={(e) => e.target.value && gerar.mutate(e.target.value)}
                      aria-label="Gerar de outro modelo"
                    >
                      <option value="">Trocar modelo…</option>
                      {modelos.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nome}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setTitulo(doc!.titulo);
                        setTexto(doc!.texto);
                        setEditando(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Editar texto
                    </Button>
                  </>
                )}
                {painel.bloqueado && <span className="text-xs text-muted-foreground">Texto travado: já há assinatura</span>}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-4 scroll-fino sm:p-8">
                {!temDoc ? (
                  <div className="mx-auto max-w-lg space-y-3 py-6">
                    <h3 className="text-lg font-semibold">Escolha o modelo do documento</h3>
                    <p className="text-sm text-muted-foreground">Os dados do contrato (partes, imóvel, valores e datas) entram automaticamente. Você revisa antes de enviar.</p>
                    {modelos.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        disabled={gerar.isPending}
                        onClick={() => gerar.mutate(m.id)}
                        className="flex w-full items-center gap-3 rounded-lg border bg-card p-4 text-left hover:border-primary"
                        data-testid={`modelo-${m.tipo}`}
                      >
                        <FileText className="h-5 w-5 text-primary" />
                        <span className="flex-1">
                          <span className="block font-medium">{m.nome}</span>
                          <span className="text-xs text-muted-foreground">{m.tipo === "venda" ? "Venda" : m.tipo === "locacao" ? "Locação" : "Geral"}</span>
                        </span>
                      </button>
                    ))}
                    <p className="text-xs text-muted-foreground">Modelos são editáveis em Configurar CRM. Revise o texto com o jurídico da imobiliária.</p>
                  </div>
                ) : editando ? (
                  <div className="mx-auto max-w-3xl space-y-3">
                    <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} aria-label="Título do documento" />
                    <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={26} className="font-mono text-xs leading-relaxed" aria-label="Texto do documento" />
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setEditando(false)}>
                        Cancelar
                      </Button>
                      <Button onClick={() => salvarTexto.mutate()} disabled={salvarTexto.isPending}>
                        Salvar texto
                      </Button>
                    </div>
                  </div>
                ) : (
                  <article className="mx-auto max-w-3xl rounded-sm bg-card px-6 py-10 shadow-sm sm:px-14">
                    <DocumentoTexto texto={doc!.texto} />
                    <p className="mt-8 break-all border-t pt-3 text-[10px] text-muted-foreground">Código de integridade (SHA-256): {doc!.hash}</p>
                  </article>
                )}
              </div>
            </div>

            {/* Signatários + trilha */}
            <div className="flex min-h-0 flex-col overflow-y-auto scroll-fino">
              <div className="border-b p-4">
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="flex-1 text-sm font-semibold">
                    Quem assina {total > 0 && <span className="font-normal text-muted-foreground">({assinados} de {total})</span>}
                  </h3>
                  <Button variant="ghost" size="sm" onClick={() => partes.mutate()} disabled={partes.isPending} title="Inclui cliente e proprietário do contrato">
                    <Users className="h-3.5 w-3.5" /> Partes
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setNovoSig((v) => !v)} data-testid="add-signatario">
                    <UserPlus className="h-3.5 w-3.5" /> Adicionar
                  </Button>
                </div>
                {total > 0 && (
                  <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-hoje transition-all" style={{ width: `${(assinados / total) * 100}%` }} />
                  </div>
                )}

                {novoSig && (
                  <form
                    className="mb-3 grid gap-2 rounded-lg border bg-muted/40 p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (sig.nome.trim().length >= 2) adicionar.mutate();
                    }}
                  >
                    <Input value={sig.nome} onChange={(e) => setSig({ ...sig, nome: e.target.value })} placeholder="Nome completo" aria-label="Nome" autoFocus />
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={sig.telefone} onChange={(e) => setSig({ ...sig, telefone: e.target.value })} placeholder="WhatsApp" aria-label="WhatsApp" />
                      <Input value={sig.cpf} onChange={(e) => setSig({ ...sig, cpf: e.target.value })} placeholder="CPF" aria-label="CPF" />
                    </div>
                    <Input value={sig.email} onChange={(e) => setSig({ ...sig, email: e.target.value })} placeholder="E-mail" aria-label="E-mail" />
                    <div className="flex gap-2">
                      <select value={sig.papel} onChange={(e) => setSig({ ...sig, papel: e.target.value as PapelSignatario })} className="h-8 flex-1 rounded-lg border bg-card px-2 text-sm" aria-label="Papel">
                        {Object.entries(PAPEL_SIGNATARIO).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" size="sm" className="h-8" disabled={adicionar.isPending}>
                        Incluir
                      </Button>
                    </div>
                  </form>
                )}

                <ul className="space-y-2">
                  {painel.signatarios.map((s) => {
                    const st = STATUS_SIG[s.status];
                    return (
                      <li key={s.id} className="rounded-lg border bg-card p-3" data-testid={`signatario-${s.id}`}>
                        <div className="flex items-start gap-2">
                          <st.icone className={cn("mt-0.5 h-4 w-4 shrink-0", st.cls)} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{s.nome}</p>
                            <p className="text-xs text-muted-foreground">
                              {PAPEL_SIGNATARIO[s.papel]}, <span className={st.cls}>{st.rotulo.toLowerCase()}</span>
                              {s.assinado_em ? ` em ${quando(s.assinado_em)}` : s.enviado_em ? `, link enviado ${quando(s.enviado_em)}` : ""}
                            </p>
                            {s.status === "recusado" && s.motivo_recusa && <p className="mt-1 text-xs text-atrasada">“{s.motivo_recusa}”</p>}
                          </div>
                          {s.status !== "assinado" && (
                            <button onClick={() => remover.mutate(s.id)} className="text-muted-foreground hover:text-destructive" aria-label={`Remover ${s.nome}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        {s.status !== "assinado" && (
                          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                            <Button variant="outline" size="sm" disabled={!temDoc} onClick={() => whatsapp(s)} className="h-8">
                              <MessageCircle className="h-3.5 w-3.5 text-[#1da851]" /> WhatsApp
                            </Button>
                            <Button variant="outline" size="sm" disabled={!temDoc} onClick={() => copiar(s)} className="h-8" data-testid={`copiar-${s.id}`}>
                              <Copy className="h-3.5 w-3.5" /> Link
                            </Button>
                            <Button variant="outline" size="sm" disabled={!temDoc || !s.email || email.isPending} onClick={() => email.mutate(s.id)} className="h-8" title={s.email ? s.email : "Sem e-mail"}>
                              <Mail className="h-3.5 w-3.5" /> E-mail
                            </Button>
                          </div>
                        )}
                        {s.status === "recusado" && (
                          <Button variant="ghost" size="sm" className="mt-1 h-7 text-xs" onClick={() => novoLink.mutate(s.id)}>
                            <RefreshCw className="h-3 w-3" /> Gerar novo link
                          </Button>
                        )}
                      </li>
                    );
                  })}
                  {!total && !novoSig && (
                    <li className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                      Ninguém incluído ainda. Use <strong>Partes</strong> para trazer cliente e proprietário do contrato.
                    </li>
                  )}
                </ul>
                {!temDoc && total > 0 && <p className="mt-2 text-xs text-sem-atividade">Gere o documento para liberar os links.</p>}
              </div>

              <div className="p-4">
                <h3 className="mb-2 text-sm font-semibold">Trilha de auditoria</h3>
                <ol className="space-y-2">
                  {[...painel.eventos].reverse().map((e, i) => (
                    <li key={i} className="text-xs">
                      <p>{e.texto}</p>
                      <p className="text-muted-foreground">
                        {quando(e.em)}
                        {e.ip ? `, IP ${e.ip}` : ""}
                      </p>
                    </li>
                  ))}
                  {!painel.eventos.length && <li className="text-xs text-muted-foreground">Sem eventos ainda.</li>}
                </ol>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
