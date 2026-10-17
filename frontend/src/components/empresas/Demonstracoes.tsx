import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Loader2, Sparkles } from "lucide-react";
import { apiGet, apiPost, detalheErro } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/* Empresas de demonstração (dados fictícios) que ainda dá para criar. A senha aparece uma vez só. */

interface Demo { chave: string; nome: string; existe: boolean }
interface Criada { empresa_id: string; nome: string; emails: string[]; senha: string; site: string }

export function Demonstracoes() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["demos"], queryFn: () => apiGet<Demo[]>("/plataforma/demos") });
  const [criada, setCriada] = useState<Criada | null>(null);
  const criar = useMutation({
    mutationFn: (chave: string) => apiPost<Criada>(`/plataforma/demos/${chave}`),
    onSuccess: (r) => { setCriada(r); qc.invalidateQueries({ queryKey: ["demos"] }); qc.invalidateQueries({ queryKey: ["empresas"] }); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível criar a demonstração"),
  });
  const copiar = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success("Copiado"), () => toast.error("Não consegui copiar"));
  return (
    <>
      {data.filter((d) => !d.existe).map((d) => (
        <Button key={d.chave} size="sm" variant="outline" onClick={() => criar.mutate(d.chave)} disabled={criar.isPending} data-testid={`demo-${d.chave}`}>
          {criar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Criar {d.nome.replace("[DEMO] ", "demo ")}
        </Button>
      ))}
      {criada && (
        <Dialog open onOpenChange={(o) => !o && setCriada(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{criada.nome} criada</DialogTitle>
              <DialogDescription>Dados fictícios para apresentação. Guarde a senha agora: ela não aparece de novo.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between rounded-md border p-2">
                <span>Senha de todos: <b className="font-mono" data-testid="demo-senha">{criada.senha}</b></span>
                <Button size="icon-sm" variant="ghost" onClick={() => copiar(criada.senha)} aria-label="Copiar senha"><Copy className="h-4 w-4" /></Button>
              </div>
              <ul className="grid gap-1 rounded-md border p-2">
                {criada.emails.map((e, i) => <li key={e} className="flex justify-between gap-2"><span className="truncate">{e}</span><span className="text-muted-foreground">{i === 0 ? "gestor" : "equipe"}</span></li>)}
              </ul>
              <p className="text-muted-foreground">Site de exemplo: <a className="text-primary underline" href={`/s/${criada.site}`} target="_blank" rel="noreferrer">/s/{criada.site}</a></p>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
