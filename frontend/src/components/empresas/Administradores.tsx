import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Link2, Loader2, Plus, ShieldCheck } from "lucide-react";
import { apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Admin { id: string; nome: string; email: string; ativo: boolean; pendente: boolean; criado_em: string | null }
interface LinkAcesso { link: string; email_enviado: boolean }

/** Equipe SAX com acesso total: plano de controle, configurador e entrada nas empresas para suporte. */
export function Administradores() {
  const qc = useQueryClient();
  const { principal } = useAuth();
  const q = useQuery({ queryKey: ["plataforma", "admins"], queryFn: () => apiGet<Admin[]>("/plataforma/administradores") });
  const [novo, setNovo] = useState(false);
  const [link, setLink] = useState<(LinkAcesso & { nome: string }) | null>(null);
  const ativo = useMutation({
    mutationFn: (a: Admin) => apiPut<Admin>(`/plataforma/administradores/${a.id}/ativo`, { ativo: !a.ativo }),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ["plataforma", "admins"] }); toast.success(a.ativo ? "Acesso reativado." : "Acesso desativado. A sessão dele caiu na hora."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível mudar o acesso."),
  });
  const reenviar = useMutation({
    mutationFn: (a: Admin) => apiPost<LinkAcesso>(`/plataforma/administradores/${a.id}/link`).then((r) => ({ ...r, nome: a.nome })),
    onSuccess: (r) => setLink(r),
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível gerar o link."),
  });

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-5" data-testid="admins">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-primary" /> Administradores da plataforma</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Equipe SAX com acesso total: este painel, o configurador e a entrada em qualquer empresa para suporte. Dê esse acesso só para quem é do time.
          </p>
        </div>
        <Button onClick={() => setNovo(true)} data-testid="admin-novo"><Plus className="h-4 w-4" /> Novo administrador</Button>
      </div>

      <ul className="divide-y rounded-lg border">
        {(q.data ?? []).map((a) => (
          <li key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center" data-testid="admin-item">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{a.nome}{a.id === principal?.usuario_id && <span className="text-muted-foreground"> (você)</span>}</p>
              <p className="truncate text-xs text-muted-foreground">{a.email}</p>
            </div>
            <span className={cn("w-fit rounded-full px-2.5 py-1 text-xs font-semibold",
              !a.ativo ? "bg-muted text-muted-foreground" : a.pendente ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300")}>
              {!a.ativo ? "Desativado" : a.pendente ? "Aguardando definir senha" : "Ativo"}
            </span>
            <div className="flex gap-1">
              {a.ativo && a.id !== principal?.usuario_id && (
                <Button size="sm" variant="ghost" onClick={() => reenviar.mutate(a)} disabled={reenviar.isPending}><Link2 className="h-4 w-4" /> Link de acesso</Button>
              )}
              {a.id !== principal?.usuario_id && (
                <Button size="sm" variant="ghost" className={a.ativo ? "text-destructive" : ""} data-testid="admin-ativo"
                  onClick={() => (a.ativo ? window.confirm(`Desativar o acesso de ${a.nome}?`) : true) && ativo.mutate(a)}>
                  {a.ativo ? "Desativar" : "Reativar"}
                </Button>
              )}
            </div>
          </li>
        ))}
        {q.isLoading && <li className="p-4 text-sm text-muted-foreground">Carregando...</li>}
      </ul>

      {novo && <NovoAdmin onClose={() => setNovo(false)} onCriado={(r) => { setNovo(false); setLink(r); }} />}
      {link && <MostrarLink dados={link} onClose={() => setLink(null)} />}
    </section>
  );
}

function NovoAdmin({ onClose, onCriado }: { onClose: () => void; onCriado: (r: LinkAcesso & { nome: string }) => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const criar = useMutation({
    mutationFn: () => apiPost<Admin & LinkAcesso>("/plataforma/administradores", { nome: nome.trim(), email: email.trim() }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["plataforma", "admins"] }); onCriado({ link: r.link, email_enviado: r.email_enviado, nome: r.nome }); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível criar o acesso."),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo administrador</DialogTitle>
          <DialogDescription>A pessoa recebe um link para definir a própria senha. Ninguém mais vê a senha dela.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); criar.mutate(); }}>
          <div className="grid gap-1.5"><Label htmlFor="adm-nome">Nome</Label>
            <Input id="adm-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoFocus data-testid="admin-nome" /></div>
          <div className="grid gap-1.5"><Label htmlFor="adm-email">E-mail</Label>
            <Input id="adm-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@sax.com.br" data-testid="admin-email" /></div>
          <Button type="submit" disabled={nome.trim().length < 3 || !email.includes("@") || criar.isPending} data-testid="admin-criar">
            {criar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Criar acesso
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MostrarLink({ dados, onClose }: { dados: LinkAcesso & { nome: string }; onClose: () => void }) {
  const copiar = async () => {
    try { await navigator.clipboard.writeText(dados.link); toast.success("Link copiado."); } catch { toast.error("Copie o link manualmente."); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link de acesso de {dados.nome}</DialogTitle>
          <DialogDescription>
            {dados.email_enviado ? "Mandamos o link por e-mail. Se não chegar, envie este pelo WhatsApp." : "Envie este link para a pessoa pelo WhatsApp."} Ele vale por 24 horas e funciona uma vez só.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={dados.link} onFocus={(e) => e.target.select()} className="font-mono text-xs" data-testid="admin-link" />
          <Button variant="outline" onClick={copiar}><Copy className="h-4 w-4" /> Copiar</Button>
        </div>
        <Button onClick={onClose}>Pronto</Button>
      </DialogContent>
    </Dialog>
  );
}
