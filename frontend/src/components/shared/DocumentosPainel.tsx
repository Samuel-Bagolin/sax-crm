import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CloudUpload, ExternalLink, FileText, HardDrive, Image as ImageIcon, Link2, Loader2, MessageCircle, Paperclip, Send, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, detalheErro } from "@/lib/api";
import { enviarArquivo, escolherNoDrive, tamanhoLegivel, useGoogle, type Documento } from "@/lib/google";
import { linkWhatsapp } from "@/lib/crm";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Documentos de um negócio ou contrato: enviar do computador, escolher no Drive, abrir e enviar ao cliente. */
export default function DocumentosPainel({
  negocioId,
  contratoId,
  clienteEmail,
  clienteTelefone,
  clienteNome,
}: {
  negocioId?: string | null;
  contratoId?: string | null;
  clienteEmail?: string | null;
  clienteTelefone?: string | null;
  clienteNome?: string | null;
}) {
  const qc = useQueryClient();
  const { principal, isAdmin } = useAuth();
  const { data: google } = useGoogle();
  const input = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const [enviando, setEnviando] = useState(0);
  const [envio, setEnvio] = useState<Documento | null>(null);
  const [email, setEmail] = useState("");
  const [mensagem, setMensagem] = useState("");

  const chave = ["documentos", negocioId ?? contratoId];
  const q = negocioId ? `negocio_id=${negocioId}` : `contrato_id=${contratoId}`;
  const { data: docs = [], isLoading } = useQuery({ queryKey: chave, queryFn: () => apiGet<Documento[]>(`/documentos?${q}`) });
  const atualizar = () => {
    qc.invalidateQueries({ queryKey: chave });
    qc.invalidateQueries({ queryKey: ["historico"] });
  };

  const subir = async (arquivos: FileList | File[]) => {
    const lista = Array.from(arquivos);
    setEnviando((n) => n + lista.length);
    for (const f of lista) {
      try {
        await enviarArquivo<Documento>("/documentos/upload", { arquivo: f, negocio_id: negocioId ?? null, contrato_id: contratoId ?? null });
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`);
      } finally {
        setEnviando((n) => n - 1);
      }
    }
    atualizar();
  };

  const drive = useMutation({
    mutationFn: async () => {
      const escolhidos = await escolherNoDrive();
      for (const a of escolhidos) await apiPost("/documentos/drive", { file_id: a.id, negocio_id: negocioId ?? null, contrato_id: contratoId ?? null });
      return escolhidos.length;
    },
    onSuccess: (n) => {
      if (n) toast.success(`${n} arquivo(s) do Drive vinculado(s)`);
      atualizar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? (e as Error).message ?? "Não foi possível abrir o Google Drive"),
  });
  const paraDrive = useMutation({
    mutationFn: (d: Documento) => apiPost<Documento>(`/documentos/${d.id}/enviar-drive`),
    onSuccess: () => {
      toast.success("Arquivo copiado para o seu Google Drive");
      atualizar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Falha ao enviar ao Drive"),
  });
  const compartilhar = useMutation({
    mutationFn: () => apiPost<Documento>(`/documentos/${envio!.id}/compartilhar`, { email, mensagem }),
    onSuccess: () => {
      toast.success(`O Google enviou o link para ${email}`);
      setEnvio(null);
      atualizar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Falha ao compartilhar"),
  });
  const remover = useMutation({
    mutationFn: (d: Documento) => apiDelete(`/documentos/${d.id}`),
    onSuccess: atualizar,
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível remover"),
  });

  const abrirEnvio = (d: Documento) => {
    setEmail(clienteEmail ?? "");
    setMensagem(`Olá${clienteNome ? ` ${clienteNome.split(" ")[0]}` : ""}, segue o documento ${d.nome}.`);
    setEnvio(d);
  };

  return (
    <section className="rounded-lg border bg-card" data-testid="documentos">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <h3 className="flex-1 text-sm font-semibold">Documentos {docs.length > 0 && <span className="font-normal text-muted-foreground">({docs.length})</span>}</h3>
        {google?.conectado && google.picker_disponivel && (
          <Button variant="ghost" size="sm" onClick={() => drive.mutate()} disabled={drive.isPending}>
            {drive.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HardDrive className="h-3.5 w-3.5" />} Do Google Drive
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => input.current?.click()}>
          <Paperclip className="h-3.5 w-3.5" /> Anexar
        </Button>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => e.target.files && subir(e.target.files)} data-testid="documento-arquivo" />
      </header>

      <div
        className={cn("m-3 rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground transition-colors", arrastando && "border-primary bg-accent")}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          if (e.dataTransfer.files.length) void subir(e.dataTransfer.files);
        }}
      >
        {enviando > 0 ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Enviando {enviando} arquivo(s)…
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <CloudUpload className="h-4 w-4" />
            Arraste RG, matrícula, proposta ou comprovantes aqui.
            {google?.conectado ? " Eles vão para a pasta SAX CRM no seu Drive." : " Conecte o Google no seu perfil para guardar no Drive."}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="mx-3 mb-3 h-12 animate-pulse rounded bg-muted" />
      ) : (
        <ul className="divide-y">
          {docs.map((d) => {
            const Icone = d.mime.startsWith("image/") ? ImageIcon : FileText;
            const podeRemover = isAdmin || d.criado_por === principal?.usuario_id;
            return (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                <Icone className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <a href={`/api/documentos/${d.id}/abrir`} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:text-primary hover:underline">
                    {d.nome}
                  </a>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {d.armazenamento === "drive" ? (
                      <span className="flex items-center gap-1 text-primary">
                        <HardDrive className="h-3 w-3" /> Google Drive
                      </span>
                    ) : (
                      <span>No CRM</span>
                    )}
                    {tamanhoLegivel(d.tamanho) && <span>{tamanhoLegivel(d.tamanho)}</span>}
                    {d.criado_por_nome && <span>por {d.criado_por_nome.split(" ")[0]}</span>}
                    {d.compartilhado_com.length > 0 && <span>enviado a {d.compartilhado_com.join(", ")}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {d.armazenamento === "crm" && google?.conectado && (
                    <Button variant="ghost" size="icon-sm" title="Copiar para o meu Google Drive" onClick={() => paraDrive.mutate(d)}>
                      <HardDrive className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {d.armazenamento === "drive" && (
                    <Button variant="ghost" size="icon-sm" title="Enviar ao cliente" onClick={() => abrirEnvio(d)} data-testid={`enviar-${d.id}`}>
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <a href={`/api/documentos/${d.id}/abrir`} target="_blank" rel="noreferrer" className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted" title="Abrir">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  {podeRemover && (
                    <Button variant="ghost" size="icon-sm" title="Remover do CRM" onClick={() => remover.mutate(d)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
          {!docs.length && <li className="px-4 pb-4 text-center text-sm text-muted-foreground">Nenhum documento ainda.</li>}
        </ul>
      )}

      <Dialog open={!!envio} onOpenChange={(v) => !v && setEnvio(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar documento</DialogTitle>
            <DialogDescription>{envio?.nome}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm font-medium">Pelo Google Drive (somente leitura)</p>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@cliente.com" aria-label="E-mail do cliente" />
            <Textarea rows={2} value={mensagem} onChange={(e) => setMensagem(e.target.value)} aria-label="Mensagem" />
            <p className="text-xs text-muted-foreground">O Google envia o e-mail com o link. Só essa pessoa consegue abrir.</p>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            {envio?.drive_link && (
              <Button
                variant="outline"
                onClick={() => {
                  const url = linkWhatsapp(clienteTelefone, `${mensagem}\n${envio.drive_link}`);
                  if (url) window.open(url, "_blank", "noopener");
                  else toast.error("Cliente sem telefone cadastrado");
                }}
                title="Envia o link do Drive pelo WhatsApp. Compartilhe por e-mail antes para o cliente conseguir abrir."
              >
                <MessageCircle className="h-4 w-4 text-[#1da851]" /> WhatsApp
              </Button>
            )}
            {envio?.drive_link && (
              <Button
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(envio.drive_link!);
                  toast.success("Link copiado");
                }}
              >
                <Link2 className="h-4 w-4" /> Copiar link
              </Button>
            )}
            <Button onClick={() => compartilhar.mutate()} disabled={!email.includes("@") || compartilhar.isPending} data-testid="compartilhar-confirmar">
              <Send className="h-4 w-4" /> Compartilhar por e-mail
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
