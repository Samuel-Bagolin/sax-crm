import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Clock3, Copy, ExternalLink, Globe, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPut, detalheErro } from "@/lib/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Registro { tipo: string; nome: string; valor: string }
interface Situacao {
  dominio: string | null;
  principal?: string;
  raiz?: string;
  status: "sem_dominio" | "ativo" | "aguardando_dns" | "aguardando_ativacao" | "nao_cadastrado" | "erro";
  registros?: Registro[];
  mensagem?: string;
  raiz_ok?: boolean;
}

const ROTULO: Record<Situacao["status"], { texto: string; cor: string }> = {
  sem_dominio: { texto: "Sem domínio próprio", cor: "bg-muted text-muted-foreground" },
  ativo: { texto: "Funcionando", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  aguardando_dns: { texto: "Esperando o DNS", cor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  aguardando_ativacao: { texto: "Aguardando ativação pela equipe SAX", cor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  nao_cadastrado: { texto: "Cadastrando no servidor", cor: "bg-amber-100 text-amber-800" },
  erro: { texto: "Não deu para verificar agora", cor: "bg-red-100 text-red-800" },
};

function copiar(t: string) {
  navigator.clipboard.writeText(t).then(() => toast.success("Copiado."));
}

/** Domínio próprio do site (www.suaempresa.com.br). */
export function DominioSite({ pode, temSite }: { pode: boolean; temSite: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["site-dominio"], queryFn: () => apiGet<Situacao>("/site-imobiliaria/dominio"), enabled: temSite });
  const [texto, setTexto] = useState("");
  const salvar = useMutation({
    mutationFn: () => apiPut<Situacao>("/site-imobiliaria/dominio", { dominio: texto }),
    onSuccess: (r) => { qc.setQueryData(["site-dominio"], r); setTexto(""); toast.success("Domínio ligado ao site. Agora crie os registros no DNS."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível ligar o domínio."),
  });
  const remover = useMutation({
    mutationFn: () => apiDelete<Situacao>("/site-imobiliaria/dominio"),
    onSuccess: (r) => { qc.setQueryData(["site-dominio"], r); toast.success("Domínio desligado do site."); },
  });

  const s = q.data;
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4 sm:p-5" data-testid="site-dominio">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><Globe className="h-4 w-4" /> Domínio próprio</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">Use o seu endereço, como www.suaempresa.com.br, no lugar do link do SAX. O certificado de segurança (HTTPS) é gerado sozinho.</p>
        </div>
        {s && <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", ROTULO[s.status].cor)} data-testid="dominio-status">{ROTULO[s.status].texto}</span>}
      </div>

      {!temSite ? (
        <p className="text-sm text-muted-foreground">Salve o site primeiro (endereço e WhatsApp) e depois ligue o domínio.</p>
      ) : !s ? (
        <div className="h-16 animate-pulse rounded-lg bg-muted" />
      ) : !s.dominio ? (
        pode && (
          <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}>
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="dom">Seu domínio</Label>
              <Input id="dom" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="suaempresa.com.br" autoCapitalize="none" spellCheck={false} data-testid="dominio-input" />
            </div>
            <Button type="submit" disabled={salvar.isPending || texto.trim().length < 4} data-testid="dominio-salvar">
              {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Ligar domínio
            </Button>
          </form>
        )
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{s.principal}</p>
            {s.status === "ativo" && (
              <a href={`https://${s.principal}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <ExternalLink className="h-4 w-4" /> Abrir
              </a>
            )}
            <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="dominio-verificar">
              <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} /> Verificar agora
            </Button>
            {pode && (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => window.confirm(`Desligar ${s.principal} do site? O link do SAX continua funcionando.`) && remover.mutate()}>
                <Trash2 className="h-4 w-4" /> Desligar
              </Button>
            )}
          </div>

          {s.status === "ativo" ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> O site já abre em {s.principal}{s.raiz_ok === false ? `. Falta o registro do ${s.raiz} (sem www), veja abaixo.` : ` e em ${s.raiz}.`}</p>
          ) : (
            <p className="flex items-start gap-2 text-sm text-muted-foreground"><Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
              {s.status === "aguardando_ativacao"
                ? "A equipe SAX vai ativar o domínio no servidor. Enquanto isso, já crie os registros abaixo no DNS."
                : "Crie os registros abaixo onde você comprou o domínio (Registro.br, GoDaddy, Hostinger...). A mudança costuma levar de alguns minutos a algumas horas."}
            </p>
          )}

          {s.status !== "ativo" || s.raiz_ok === false ? (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm" data-testid="dominio-registros">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr><th className="px-3 py-2 font-medium">Tipo</th><th className="px-3 py-2 font-medium">Nome</th><th className="px-3 py-2 font-medium">Valor</th><th className="w-10" /></tr>
                </thead>
                <tbody className="divide-y">
                  {(s.registros ?? []).map((r) => (
                    <tr key={`${r.tipo}-${r.nome}-${r.valor}`}>
                      <td className="px-3 py-2 font-mono text-xs">{r.tipo}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.nome}</td>
                      <td className="break-all px-3 py-2 font-mono text-xs">{r.valor}</td>
                      <td className="px-1"><Button variant="ghost" size="icon-xs" onClick={() => copiar(r.valor)} aria-label={`Copiar ${r.valor}`}><Copy className="h-3.5 w-3.5" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {s.status !== "ativo" && (
            <p className="text-xs text-muted-foreground">
              No Registro.br: entre em <b>Meus domínios</b>, escolha o domínio, abra <b>DNS</b> e adicione as entradas. Se o campo Nome pedir o endereço completo, use www.{s.dominio} e {s.dominio}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
