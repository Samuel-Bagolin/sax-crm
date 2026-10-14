import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Plus, ShieldAlert, Smartphone, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, detalheErro } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface Conexao { id: string; nome: string; status: "conectado" | "conectando" | "desconectado" | "aguardando_qr"; numero: string | null; perfil: string | null; criado_em: string | null }

const STATUS: Record<Conexao["status"], { rotulo: string; cor: string }> = {
  conectado: { rotulo: "Conectado", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  conectando: { rotulo: "Conectando", cor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  aguardando_qr: { rotulo: "Falta ler o QR code", cor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  desconectado: { rotulo: "Desconectado", cor: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

function numeroBonito(n: string | null) {
  if (!n) return "";
  const d = n.replace(/\D/g, "");
  return d.length >= 12 ? `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, d.length - 4)}-${d.slice(-4)}` : `+${d}`;
}

/** Números de WhatsApp conectados ao CRM. Só o gestor conecta e desconecta. */
export function NumerosWhatsApp({ conexoes, podeGerir }: { conexoes: Conexao[]; podeGerir: boolean }) {
  const qc = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [qr, setQr] = useState<Conexao | null>(null);
  const remover = useMutation({
    mutationFn: (id: string) => apiDelete(`/whatsapp/conexoes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wa"] }); toast.success("Número desconectado do CRM."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível desconectar."),
  });

  return (
    <div className="grid content-start gap-4 overflow-y-auto">
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Números de WhatsApp</h2>
          <p className="text-sm text-muted-foreground">Conecte o WhatsApp da empresa lendo o QR code no celular, como no WhatsApp Web. As conversas chegam para toda a equipe aqui no CRM.</p>
        </div>
        {podeGerir && <Button onClick={() => setNovo(true)} data-testid="wa-conectar"><Plus className="h-4 w-4" /> Conectar número</Button>}
      </section>

      <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        A conexão por QR code não é a API oficial do WhatsApp. Use para atender clientes um a um. Mandar mensagem em massa para quem não te procurou pode fazer o WhatsApp bloquear o número.
      </p>

      {conexoes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhum número conectado ainda.</div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card" data-testid="wa-numeros">
          {conexoes.map((c) => (
            <li key={c.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><Smartphone className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.nome}{c.perfil ? <span className="text-muted-foreground"> · {c.perfil}</span> : null}</p>
                  <p className="text-xs text-muted-foreground">{c.numero ? numeroBonito(c.numero) : "Número aparece depois de ler o QR code"}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-[52px] sm:pl-0">
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", STATUS[c.status]?.cor)} data-testid="wa-status">{STATUS[c.status]?.rotulo ?? c.status}</span>
                {podeGerir && c.status !== "conectado" && <Button size="sm" variant="outline" onClick={() => setQr(c)}>Ler QR code</Button>}
                {podeGerir && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => window.confirm(`Desconectar o número ${c.nome} do CRM? As conversas ficam guardadas.`) && remover.mutate(c.id)}>
                    <Trash2 className="h-4 w-4" /> Desconectar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {novo && <NovoNumero onClose={() => setNovo(false)} onCriado={(c) => { setNovo(false); setQr(c); }} />}
      {qr && <LerQr conexao={qr} onClose={() => setQr(null)} />}
    </div>
  );
}

function NovoNumero({ onClose, onCriado }: { onClose: () => void; onCriado: (c: Conexao) => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const criar = useMutation({
    mutationFn: () => apiPost<Conexao & { qr: string | null }>("/whatsapp/conexoes", { nome: nome.trim() }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ["wa"] }); onCriado(c); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível criar a conexão."),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar número</DialogTitle>
          <DialogDescription>Dê um nome para reconhecer o número na equipe, como Comercial ou Recepção.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); criar.mutate(); }}>
          <div className="grid gap-1.5"><Label htmlFor="wa-nome">Nome do número</Label>
            <Input id="wa-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} placeholder="Comercial" autoFocus data-testid="wa-nome" /></div>
          <Button type="submit" disabled={nome.trim().length < 2 || criar.isPending} data-testid="wa-gerar-qr">{criar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Gerar QR code</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LerQr({ conexao, onClose }: { conexao: Conexao; onClose: () => void }) {
  const qc = useQueryClient();
  // O QR do WhatsApp troca a cada ~20 s: busca de novo a cada 5 s até conectar.
  const q = useQuery({
    queryKey: ["wa", "qr", conexao.id],
    queryFn: () => apiGet<{ conectado: boolean; qr: string | null; codigo: string | null }>(`/whatsapp/conexoes/${conexao.id}/qr`),
    refetchInterval: (query) => (query.state.data?.conectado ? false : 5000),
    retry: 1,
  });
  const conectado = !!q.data?.conectado;
  useEffect(() => {
    if (conectado) {
      qc.invalidateQueries({ queryKey: ["wa", "situacao"] });
      toast.success("WhatsApp conectado. As conversas começam a chegar.");
    }
  }, [conectado, qc]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ler QR code: {conexao.nome}</DialogTitle>
          <DialogDescription>No celular, abra o WhatsApp, toque em Mais opções (ou Configurações), Aparelhos conectados, Conectar um aparelho, e aponte para o código.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-[288px] items-center justify-center rounded-xl border bg-white p-4" data-testid="wa-qr">
          {conectado ? (
            <div className="grid justify-items-center gap-2 text-center text-emerald-700"><CheckCircle2 className="h-12 w-12" /><p className="font-semibold">Conectado</p></div>
          ) : q.isError ? (
            <p className="text-center text-sm text-destructive">{detalheErro(q.error) ?? "Não foi possível gerar o QR code."}</p>
          ) : q.data?.qr ? (
            <img src={q.data.qr} alt="QR code para conectar o WhatsApp" className="h-64 w-64" style={{ imageRendering: "pixelated" }} />
          ) : (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          )}
        </div>
        {!conectado && <p className="text-center text-xs text-muted-foreground">O código se renova sozinho. Esta janela fecha quando conectar.</p>}
        {conectado && <Button onClick={onClose}>Ir para as conversas</Button>}
      </DialogContent>
    </Dialog>
  );
}
