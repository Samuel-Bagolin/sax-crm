import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, FileSpreadsheet, Images, Loader2 } from "lucide-react";
import { apiGet, apiPost, detalheErro } from "@/lib/api";
import { prepararPrint } from "@/components/crm/Prints";
import { linkWhatsapp } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Acesso { nome: string; email: string; perfil: string; papel: string; link: string | null; situacao: string; telefone: string | null }
interface Resultado { simulado: boolean; contagens: Record<string, number>; acessos: Acesso[]; avisos: string[] }

const ROTULOS: [string, string][] = [
  ["supervisoes", "Supervisões"], ["lojas", "Lojas"], ["usuarios", "Acessos novos"], ["clientes", "Clientes"], ["leads", "Leads"],
  ["negocios", "Negócios"], ["atividades", "Atividades"], ["historico", "Histórico"], ["pedidos", "Pedidos"], ["prints_pendentes", "Prints a enviar"], ["atualizados", "Completados"], ["ja_importados", "Já importados antes"],
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

/** Prints do Google Drive: depois de importar a planilha, envie os arquivos da pasta de anexos (baixada do Drive).
 *  Cada arquivo casa pelo nome com a atividade que a planilha indicou e fica visível só para o autor e a gestão. */
export function ImportarPrints({ empresa, onClose }: { empresa: { id: string; nome: string }; onClose: () => void }) {
  const { data: situacao, refetch } = useQuery({
    queryKey: ["prints-pendentes", empresa.id],
    queryFn: () => apiGet<{ pendentes: number; trazidos: number }>(`/plataforma/empresas/${empresa.id}/prints-pendentes`),
  });
  const [progresso, setProgresso] = useState<{ feitos: number; total: number; ok: number; fora: string[] } | null>(null);
  const enviar = async (files: File[]) => {
    const fora: string[] = [];
    let ok = 0;
    setProgresso({ feitos: 0, total: files.length, ok: 0, fora: [] });
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const { base64 } = await prepararPrint(f);
        const r = await apiPost<{ ok: boolean; motivo?: string }>(`/plataforma/empresas/${empresa.id}/importar-print`, { nome: f.name, base64 });
        if (r.ok) ok++;
        else fora.push(`${f.name}: ${r.motivo}`);
      } catch (e) {
        fora.push(`${f.name}: ${e instanceof Error && !("status" in e) ? e.message : detalheErro(e) ?? "erro ao enviar"}`);
      }
      setProgresso({ feitos: i + 1, total: files.length, ok, fora: [...fora] });
    }
    refetch();
    toast.success(`${ok} print(s) importado(s)`);
  };
  const rodando = !!progresso && progresso.feitos < progresso.total;
  return (
    <Dialog open onOpenChange={(o) => !o && !rodando && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar prints: {empresa.nome}</DialogTitle>
          <DialogDescription>
            No Google Drive, baixe a pasta de anexos do CRM (ela vem em .zip), descompacte e escolha todos os arquivos aqui.
            Cada print vai para a atividade e o negócio indicados na planilha. Só quem fez a atividade e a gestão veem.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg border p-2.5"><p className="text-xs text-muted-foreground">Esperando arquivo</p><p className="text-lg font-bold" data-testid="prints-pendentes">{situacao?.pendentes ?? "…"}</p></div>
          <div className="rounded-lg border p-2.5"><p className="text-xs text-muted-foreground">Já no sistema</p><p className="text-lg font-bold">{situacao?.trazidos ?? "…"}</p></div>
        </div>
        <label className={"inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted" + (rodando ? " pointer-events-none opacity-60" : "")}>
          {rodando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />} Escolher os arquivos da pasta
          <input type="file" accept="image/*" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) enviar(f); }} data-testid="prints-arquivos" />
        </label>
        {progresso && (
          <div className="space-y-1 text-sm">
            <p>{progresso.feitos} de {progresso.total} enviados, {progresso.ok} ligados a atividades.</p>
            {progresso.fora.length > 0 && (
              <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-xs text-muted-foreground">{progresso.fora.map((f) => <li key={f}>{f}</li>)}</ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
