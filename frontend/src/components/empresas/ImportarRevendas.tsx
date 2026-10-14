import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, FileSpreadsheet, Loader2 } from "lucide-react";
import { apiPost, detalheErro } from "@/lib/api";
import { linkWhatsapp } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Acesso { nome: string; email: string; perfil: string; papel: string; link: string | null; situacao: string; telefone: string | null }
interface Resultado { simulado: boolean; contagens: Record<string, number>; acessos: Acesso[]; avisos: string[] }

const ROTULOS: [string, string][] = [
  ["supervisoes", "Supervisões"], ["lojas", "Lojas"], ["usuarios", "Acessos novos"], ["clientes", "Clientes"], ["leads", "Leads"],
  ["negocios", "Negócios"], ["atividades", "Atividades"], ["historico", "Histórico"], ["pedidos", "Pedidos"], ["atualizados", "Completados"], ["ja_importados", "Já importados antes"],
];

function base64(arquivo: File): Promise<string> {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",").pop() ?? "");
    r.onerror = () => erro(r.error);
    r.readAsDataURL(arquivo);
  });
}

/** Importa o CRM Revendas & Eventos (planilha Google) para uma empresa: primeiro mostra o que vai entrar, depois grava. */
export function ImportarRevendas({ empresa, onClose }: { empresa: { id: string; nome: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [novosLinks, setNovosLinks] = useState(false);
  const enviar = useMutation({
    mutationFn: (simular: boolean) => apiPost<Resultado>(`/plataforma/empresas/${empresa.id}/importar-revendas`, { arquivo_base64: arquivo, simular, novos_links: novosLinks }),
    onSuccess: (r) => { if (!r.simulado) { qc.invalidateQueries(); toast.success("Planilha importada."); } },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível ler a planilha."),
  });
  const r = enviar.data;
  const escolher = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 8_000_000) { toast.error("Arquivo grande demais (máximo 8 MB)."); return; }
    setNomeArquivo(f.name);
    const b = await base64(f);
    setArquivo(b);
    enviar.reset();
  };
  const copiarTodos = () => {
    const texto = (r?.acessos ?? []).filter((a) => a.link).map((a) => `${a.nome} (${a.email}): ${a.link}`).join("\n");
    void navigator.clipboard?.writeText(texto);
    toast.success("Links copiados.");
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar CRM Revendas para {empresa.nome}</DialogTitle>
          <DialogDescription>
            No Google Planilhas: Arquivo &gt; Fazer download &gt; Microsoft Excel (.xlsx). Entram lojas, equipe com acesso, leads, negócios, atividades e histórico.
            Senhas não são copiadas: cada pessoa recebe um link para criar a dela.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-sm" data-testid="importar-revendas">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-4 hover:bg-muted/50">
            <FileSpreadsheet className="h-6 w-6 text-primary" />
            <span className="flex-1">{nomeArquivo || "Escolher o arquivo .xlsx da planilha"}</span>
            <input type="file" accept=".xlsx,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
              onChange={(e) => { void escolher(e.target.files?.[0]); e.target.value = ""; }} data-testid="importar-arquivo" />
          </label>
          {arquivo && !r && (
            <Button onClick={() => enviar.mutate(true)} disabled={enviar.isPending} data-testid="importar-conferir">
              {enviar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Conferir antes de importar
            </Button>
          )}
          {r && (
            <>
              <p className="font-medium">{r.simulado ? "O que vai entrar (nada foi gravado ainda):" : "Importado:"}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ROTULOS.map(([k, rot]) => (
                  <div key={k} className="rounded-lg border p-2.5"><p className="text-xs text-muted-foreground">{rot}</p><p className="text-lg font-bold">{r.contagens[k] ?? 0}</p></div>
                ))}
              </div>
              {r.avisos.length > 0 && (
                <ul className="list-disc space-y-1 rounded-lg bg-amber-50 py-2 pl-8 pr-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  {r.avisos.map((a) => <li key={a}>{a}</li>)}
                </ul>
              )}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-medium">Acessos ({r.acessos.length})</p>
                  {!r.simulado && r.acessos.some((a) => a.link) && <Button size="sm" variant="outline" onClick={copiarTodos}><Copy className="h-4 w-4" /> Copiar todos os links</Button>}
                </div>
                <ul className="divide-y rounded-lg border">
                  {r.acessos.map((a) => (
                    <li key={a.email} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{a.nome}</span> <span className="text-xs text-muted-foreground">{a.email}</span>
                        <span className="block text-xs text-muted-foreground">{a.perfil} · {a.papel} · {a.situacao}</span>
                      </span>
                      {a.link && (
                        <span className="flex gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(a.link!); toast.success("Link copiado."); }}><Copy className="h-4 w-4" /></Button>
                          {a.telefone && (
                            <a className="inline-flex h-8 items-center rounded-md bg-[#1fa855] px-3 text-xs font-semibold text-white" target="_blank" rel="noopener noreferrer"
                              href={linkWhatsapp(a.telefone, `Oi, ${a.nome.split(" ")[0]}! Seu acesso ao novo CRM está pronto. Crie sua senha por este link (vale 24 horas): ${a.link}`) ?? "#"}>WhatsApp</a>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              {r.simulado && r.acessos.some((a) => a.situacao.startsWith("Ainda não ativou")) && (
                <label className="flex items-start gap-2 rounded-lg border p-3">
                  <input type="checkbox" className="mt-0.5" checked={novosLinks} onChange={(e) => setNovosLinks(e.target.checked)} />
                  <span>Gerar link novo para quem ainda não ativou <span className="block text-xs text-muted-foreground">O link mandado antes deixa de valer. Use se ele venceu (24 horas).</span></span>
                </label>
              )}
              {r.simulado ? (
                <Button onClick={() => enviar.mutate(false)} disabled={enviar.isPending} data-testid="importar-confirmar">
                  {enviar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Importar agora
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">Pode importar de novo a mesma planilha depois: só entra o que ainda não veio.</p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
