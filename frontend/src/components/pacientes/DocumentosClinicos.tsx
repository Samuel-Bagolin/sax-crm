import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown, FilePlus2, Loader2, Paperclip, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, detalheErro } from "@/lib/api";
import { urlApi } from "@/lib/suporte";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type TipoDoc = "receituario" | "atestado" | "declaracao" | "encaminhamento" | "livre";
interface Doc { id: string; tipo: TipoDoc; titulo: string; data: string; autor_nome: string; created_at: string }
interface Arquivo { id: string; nome: string; mime: string; tamanho: number; descricao: string | null; autor_id: string; autor_nome: string; created_at: string }

const ROTULO: Record<TipoDoc, string> = { receituario: "Receituário", atestado: "Atestado", declaracao: "Declaração de comparecimento", encaminhamento: "Encaminhamento", livre: "Documento livre" };

function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function br(d: string) { return d.slice(0, 10).split("-").reverse().join("/"); }

function modelo(tipo: TipoDoc, nome: string, cpf: string | null): string {
  const quem = `${nome}${cpf ? `, CPF ${cpf}` : ""}`;
  const data = br(hoje());
  switch (tipo) {
    case "atestado": return `Atesto, para os devidos fins, que ${quem}, esteve sob meus cuidados profissionais em ${data}, necessitando de ___ dia(s) de afastamento de suas atividades a partir desta data.`;
    case "declaracao": return `Declaro, para os devidos fins, que ${quem}, compareceu a atendimento nesta clínica em ${data}, das __:__ às __:__.`;
    case "encaminhamento": return `Encaminho ${quem} para avaliação com ____________________.\n\nMotivo: \n\nHistórico relevante: `;
    case "receituario": return "1. \n   Uso: \n\n2. \n   Uso: ";
    default: return "";
  }
}

/** Documentos para imprimir (receituário, atestado, declaração) e arquivos do prontuário (exames, laudos). */
export default function DocumentosClinicos({ pacienteId, paciente }: { pacienteId: string; paciente: { nome: string; cpf_cnpj?: string | null } }) {
  const qc = useQueryClient();
  const { principal, isAdmin } = useAuth();
  const docs = useQuery({ queryKey: ["docs-clinicos", pacienteId], queryFn: () => apiGet<Doc[]>(`/pacientes/${pacienteId}/documentos-clinicos`) });
  const arqs = useQuery({ queryKey: ["arquivos", pacienteId], queryFn: () => apiGet<Arquivo[]>(`/pacientes/${pacienteId}/arquivos`) });
  const [novo, setNovo] = useState<TipoDoc | null>(null);
  const [texto, setTexto] = useState("");
  const [cidade, setCidade] = useState("");
  const [enviando, setEnviando] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const emitir = useMutation({
    mutationFn: () => apiPost<Doc>(`/pacientes/${pacienteId}/documentos-clinicos`, { tipo: novo, texto, cidade: cidade || null }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["docs-clinicos", pacienteId] }); setNovo(null);
      window.open(urlApi(`/api/pacientes/${pacienteId}/documentos-clinicos/${d.id}/pdf`), "_blank", "noopener");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível emitir."),
  });
  const remover = useMutation({
    mutationFn: (id: string) => apiDelete(`/pacientes/${pacienteId}/arquivos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["arquivos", pacienteId] }),
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível remover."),
  });
  const anexar = async (file: File) => {
    if (file.size > 3 * 1024 * 1024) { toast.error("Arquivo maior que 3 MB. Reduza ou divida o arquivo."); return; }
    setEnviando(true);
    try {
      const b64 = await new Promise<string>((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = erro; r.readAsDataURL(file); });
      await apiPost(`/pacientes/${pacienteId}/arquivos`, { nome: file.name, mime: file.type, base64: b64, descricao: null });
      qc.invalidateQueries({ queryKey: ["arquivos", pacienteId] });
      toast.success("Arquivo anexado ao prontuário.");
    } catch (e) {
      toast.error(detalheErro(e) ?? "Não foi possível anexar.");
    } finally {
      setEnviando(false);
      if (input.current) input.current.value = "";
    }
  };
  const abrir = (tipo: TipoDoc) => { setNovo(tipo); setTexto(modelo(tipo, paciente.nome, paciente.cpf_cnpj ?? null)); };
  return (
    <div className="mb-4 grid gap-3 lg:grid-cols-2" data-testid="docs-clinicos">
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">Documentos para imprimir</p>
          <a href={urlApi(`/api/pacientes/${pacienteId}/prontuario/pdf`)} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted" data-testid="prontuario-pdf"><FileDown className="h-4 w-4" /> Prontuário em PDF</a>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(ROTULO) as TipoDoc[]).map((t) => <Button key={t} size="sm" variant="outline" onClick={() => abrir(t)} data-testid={`doc-${t}`}><FilePlus2 className="h-3.5 w-3.5" /> {ROTULO[t]}</Button>)}
        </div>
        <ul className="mt-3 divide-y text-sm">
          {(docs.data ?? []).slice(0, 8).map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 truncate">{d.titulo} <span className="text-xs text-muted-foreground">{br(d.data)} · {d.autor_nome}</span></span>
              <a className="shrink-0 text-xs text-primary hover:underline" href={urlApi(`/api/pacientes/${pacienteId}/documentos-clinicos/${d.id}/pdf`)} target="_blank" rel="noopener noreferrer">Abrir PDF</a>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="font-medium">Exames e arquivos</p>
          <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && anexar(e.target.files[0])} data-testid="arquivo-input" />
          <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={enviando}>{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />} Anexar</Button>
        </div>
        {(arqs.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">PDF ou imagem de até 3 MB (laudos, exames, relatórios escolares).</p> : (
          <ul className="divide-y text-sm">
            {(arqs.data ?? []).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
                <a className="min-w-0 truncate hover:underline" href={urlApi(`/api/pacientes/${pacienteId}/arquivos/${a.id}`)} target="_blank" rel="noopener noreferrer">{a.nome} <span className="text-xs text-muted-foreground">{br(a.created_at)} · {Math.ceil(a.tamanho / 1024)} KB · {a.autor_nome}</span></a>
                {(isAdmin || a.autor_id === principal?.usuario_id) && <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Remover" onClick={() => { if (window.confirm("Remover o arquivo do prontuário?")) remover.mutate(a.id); }}><Trash2 className="h-3.5 w-3.5" /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog open={!!novo} onOpenChange={(o) => !o && setNovo(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{novo ? ROTULO[novo] : ""}</DialogTitle><DialogDescription>Confira e complete o texto. Depois de emitido ele não muda: para corrigir, emita outro.</DialogDescription></DialogHeader>
          <Textarea rows={8} value={texto} onChange={(e) => setTexto(e.target.value)} data-testid="doc-texto" />
          <div className="grid gap-1.5"><Label>Cidade (vai junto da data)</Label><Input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex.: Curitiba" /></div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNovo(null)}>Fechar</Button>
            <Button onClick={() => emitir.mutate()} disabled={emitir.isPending || texto.trim().length < 5 || /_{2,}/.test(texto)} data-testid="doc-emitir">{emitir.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Emitir e abrir PDF</Button>
          </div>
          {/_{2,}/.test(texto) && <p className="text-xs text-amber-700 dark:text-amber-400">Preencha os campos com traços (___) antes de emitir.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
