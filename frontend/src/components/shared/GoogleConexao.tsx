import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CalendarDays, Check, HardDrive, Loader2, RefreshCw, Unplug } from "lucide-react";
import { apiGet, apiPatch, apiPost, detalheErro } from "@/lib/api";
import { useGoogle, type StatusGoogle } from "@/lib/google";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const RETORNO: Record<string, [string, "ok" | "erro"]> = {
  ok: ["Conta Google conectada. Seus compromissos já estão indo para o Google Agenda.", "ok"],
  cancelado: ["Conexão com o Google cancelada.", "erro"],
  expirado: ["A autorização demorou demais. Tente conectar de novo.", "erro"],
  "outra-sessao": ["A autorização voltou para outra sessão. Entre de novo e conecte.", "erro"],
  erro: ["O Google não concluiu a conexão. Tente novamente.", "erro"],
};

function LogoGoogle() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function GoogleConexao() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: st, isLoading } = useGoogle();

  useEffect(() => {
    const r = params.get("google");
    if (!r) return;
    const [msg, tipo] = RETORNO[r] ?? RETORNO.erro;
    if (tipo === "ok") toast.success(msg);
    else toast.error(msg);
    params.delete("google");
    setParams(params, { replace: true });
    qc.invalidateQueries({ queryKey: ["google"] });
    if (r === "ok") void apiPost("/google/sincronizar").then(() => qc.invalidateQueries({ queryKey: ["google"] }));
  }, [params, setParams, qc]);

  const conectar = useMutation({
    mutationFn: () => apiGet<{ url: string }>("/google/conectar"),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível iniciar a conexão"),
  });
  const desconectar = useMutation({
    mutationFn: () => apiPost("/google/desconectar"),
    onSuccess: () => {
      toast.success("Conta Google desconectada");
      qc.invalidateQueries({ queryKey: ["google"] });
    },
  });
  const pref = useMutation({
    mutationFn: (p: Partial<StatusGoogle>) => apiPatch<StatusGoogle>("/google/preferencias", p),
    onSuccess: (s) => qc.setQueryData(["google", "status"], s),
  });
  const sincronizar = useMutation({
    mutationFn: () => apiPost<{ enviados: number }>("/google/sincronizar"),
    onSuccess: (r) => toast.success(`${r.enviados} compromisso(s) enviados ao Google Agenda`),
    onError: (e) => toast.error(detalheErro(e) ?? "Falha ao sincronizar"),
  });

  return (
    <section className="rounded-lg border bg-card p-6" data-testid="google-conexao">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg border bg-white">
          <LogoGoogle />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Google Agenda e Google Drive</h3>
          <p className="text-sm text-muted-foreground">
            {st?.conectado ? (
              <>
                Conectado como <strong className="text-foreground">{st.email}</strong>
              </>
            ) : (
              "Conecte sua conta para levar atividades e visitas ao Google Agenda e guardar documentos no seu Drive."
            )}
          </p>
          {st?.erro && <p className="mt-1 text-sm text-atrasada">{st.erro}</p>}
        </div>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : st && !st.no_plano ? (
          <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">Disponível no plano Business</span>
        ) : !st?.configurado ? (
          <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">Aguardando o administrador configurar</span>
        ) : st.conectado ? (
          <Button variant="outline" size="sm" onClick={() => desconectar.mutate()} disabled={desconectar.isPending}>
            <Unplug className="h-3.5 w-3.5" /> Desconectar
          </Button>
        ) : (
          <Button onClick={() => conectar.mutate()} disabled={conectar.isPending} data-testid="google-conectar">
            Conectar conta Google
          </Button>
        )}
      </div>

      {st?.conectado && (
        <div className="mt-5 grid gap-3 border-t pt-4 sm:grid-cols-2">
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={st.sync_agenda} onCheckedChange={(v) => pref.mutate({ sync_agenda: !!v })} className="mt-0.5" />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <CalendarDays className="h-4 w-4 text-primary" /> Enviar para o Google Agenda
              </span>
              <span className="text-muted-foreground">Atividades e visitas que você cria ou recebe aparecem no seu calendário, com lembrete.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={st.mostrar_agenda} onCheckedChange={(v) => pref.mutate({ mostrar_agenda: !!v })} className="mt-0.5" />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <Check className="h-4 w-4 text-primary" /> Mostrar meu Google Agenda no CRM
              </span>
              <span className="text-muted-foreground">Seus compromissos pessoais aparecem em cinza na sua agenda. O gestor vê só “ocupado”, sem títulos.</span>
            </span>
          </label>
          <p className="flex items-start gap-2.5 text-sm sm:col-span-2">
            <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="text-muted-foreground">
              Documentos que você anexa vão para a pasta <strong className="text-foreground">SAX CRM</strong> no seu Drive, separados por negócio. O CRM só acessa arquivos que ele criou ou que você escolher.
            </span>
          </p>
          <div className="sm:col-span-2">
            <Button variant="ghost" size="sm" onClick={() => sincronizar.mutate()} disabled={sincronizar.isPending}>
              <RefreshCw className="h-3.5 w-3.5" /> Reenviar meus compromissos
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
