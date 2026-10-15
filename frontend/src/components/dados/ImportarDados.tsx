import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { apiPost, detalheErro } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* Importar e exportar dados por planilha (clientes, leads e negócios). Serve ao gestor (base "/dados")
   e ao administrador SAX em qualquer empresa (base "/plataforma/empresas/{id}/dados"). */

interface Mensagem { aba: string; linha: number; motivo: string }
interface Resultado { simulado: boolean; contagens: Record<string, number>; erros: Mensagem[]; avisos: Mensagem[]; abas: string[]; mais_mensagens: boolean }

const ROTULOS: [string, string][] = [
  ["clientes_novos", "Cadastros novos"], ["clientes_atualizados", "Cadastros atualizados"], ["leads_novos", "Leads novos"],
  ["leads_atualizados", "Leads atualizados"], ["negocios_novos", "Negócios novos"], ["negocios_atualizados", "Negócios atualizados"],
  ["linhas_com_erro", "Linhas com problema"],
];
const LIMITE = 3 * 1024 * 1024;

async function baixar(caminho: string, nomePadrao: string) {
  const r = await fetch(`/api${caminho}`);
  if (!r.ok) {
    const corpo = await r.json().catch(() => null);
    throw new Error(corpo?.detail ?? "Não foi possível baixar a planilha");
  }
  const nome = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? nomePadrao;
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function base64(arquivo: File): Promise<string> {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",").pop() ?? "");
    r.onerror = () => erro(r.error);
    r.readAsDataURL(arquivo);
  });
}

export function ImportarDados({ base, comCrm = true }: { base: string; comCrm?: boolean }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<{ nome: string; b64: string } | null>(null);
  const [baixando, setBaixando] = useState<"modelo" | "exportar" | null>(null);
  const enviar = useMutation({
    mutationFn: (simular: boolean) => apiPost<Resultado>(`${base}/importar`, { arquivo_base64: arquivo!.b64, simular }),
    onSuccess: (r) => {
      if (!r.simulado) {
        qc.invalidateQueries();
        toast.success("Dados importados.");
      }
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível ler a planilha."),
  });
  const r = enviar.data;
  const escolher = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > LIMITE) {
      toast.error("Arquivo acima de 3 MB. Divida a planilha em partes menores.");
      return;
    }
    setArquivo({ nome: f.name, b64: await base64(f) });
    enviar.reset();
  };
  const download = async (tipo: "modelo" | "exportar") => {
    setBaixando(tipo);
    try {
      await baixar(`${base}/${tipo}`, tipo === "modelo" ? "Modelo de dados.xlsx" : "Dados.xlsx");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível baixar");
    } finally {
      setBaixando(null);
    }
  };
  const total = r ? ROTULOS.filter(([k]) => k !== "linhas_com_erro").reduce((s, [k]) => s + (r.contagens[k] ?? 0), 0) : 0;

  return (
    <div className="grid gap-4" data-testid="importar-dados">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <p className="font-semibold">1. Baixe o modelo</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Planilha feita para esta empresa: {comCrm ? "abas de clientes, leads e negócios, com os funis, etapas, origens e a equipe daqui." : "aba de clientes, com instruções."}
          </p>
          <Button className="mt-3" variant="outline" onClick={() => download("modelo")} disabled={!!baixando} data-testid="dados-modelo">
            {baixando === "modelo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Baixar modelo
          </Button>
        </div>
        <div className="rounded-lg border p-4">
          <p className="font-semibold">Ou exporte o que já existe</p>
          <p className="mt-1 text-sm text-muted-foreground">Mesmo formato do modelo, com a coluna ID SAX. Edite e importe de volta: atualiza sem duplicar.</p>
          <Button className="mt-3" variant="outline" onClick={() => download("exportar")} disabled={!!baixando} data-testid="dados-exportar">
            {baixando === "exportar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Exportar dados
          </Button>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <p className="font-semibold">2. Envie a planilha preenchida</p>
        <p className="mt-1 text-sm text-muted-foreground">Excel (.xlsx) ou CSV, até 3 MB. Primeiro confira: nada é gravado até você confirmar.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => ref.current?.click()} data-testid="dados-escolher"><Upload className="h-4 w-4" /> Escolher arquivo</Button>
          <span className="truncate text-sm text-muted-foreground">{arquivo?.nome ?? "Nenhum arquivo escolhido"}</span>
          <input ref={ref} type="file" hidden accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => { escolher(e.target.files?.[0]); e.target.value = ""; }} data-testid="dados-arquivo" />
          <span className="flex-1" />
          <Button variant="outline" disabled={!arquivo || enviar.isPending} onClick={() => enviar.mutate(true)} data-testid="dados-conferir">
            {enviar.isPending && enviar.variables ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Conferir
          </Button>
          <Button disabled={!arquivo || !r?.simulado || enviar.isPending || total === 0} onClick={() => enviar.mutate(false)} data-testid="dados-importar">
            {enviar.isPending && enviar.variables === false ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Importar {r?.simulado && total ? `${total} registro(s)` : ""}
          </Button>
        </div>
      </div>

      {r && (
        <div className={cn("grid gap-3 rounded-lg border p-4", r.simulado ? "border-primary/40 bg-primary/5" : "border-emerald-500/40 bg-emerald-500/5")} data-testid="dados-resultado">
          <p className="flex items-center gap-2 font-semibold">
            {r.simulado ? <FileSpreadsheet className="h-4 w-4 text-primary" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            {r.simulado ? "Conferência: isto vai entrar (ainda nada foi gravado)" : "Importação concluída"}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ROTULOS.filter(([k]) => (r.contagens[k] ?? 0) > 0 || k.endsWith("_novos")).filter(([k]) => comCrm || !k.startsWith("leads") && !k.startsWith("negocios")).map(([k, rot]) => (
              <div key={k} className={cn("rounded-md border bg-card p-2", k === "linhas_com_erro" && r.contagens[k] ? "border-destructive/40" : "")}>
                <p className="text-xs text-muted-foreground">{rot}</p>
                <p className="text-lg font-bold">{r.contagens[k] ?? 0}</p>
              </div>
            ))}
          </div>
          {r.erros.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-card p-3 text-sm">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-destructive"><AlertTriangle className="h-4 w-4" /> Linhas que não entram (corrija e envie de novo)</p>
              <ul className="max-h-48 list-disc overflow-y-auto pl-5">{r.erros.map((m, i) => <li key={i}><b>{m.aba}, linha {m.linha}:</b> {m.motivo}</li>)}</ul>
            </div>
          )}
          {r.avisos.length > 0 && (
            <div className="rounded-md border border-amber-400/40 bg-card p-3 text-sm">
              <p className="mb-1 font-semibold text-amber-700 dark:text-amber-300">Entram com ajuste</p>
              <ul className="max-h-48 list-disc overflow-y-auto pl-5">{r.avisos.map((m, i) => <li key={i}><b>{m.aba}, linha {m.linha}:</b> {m.motivo}</li>)}</ul>
            </div>
          )}
          {r.mais_mensagens && <p className="text-xs text-muted-foreground">Mostrando as 200 primeiras mensagens.</p>}
        </div>
      )}
    </div>
  );
}
