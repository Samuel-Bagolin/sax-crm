import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, Pencil, Plus, Store } from "lucide-react";
import { apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { useSegmento } from "@/lib/segmento";
import { usePlano } from "@/lib/diferenciais";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Unidade {
  id: string;
  nome: string;
  principal: boolean;
  ativa: boolean;
  endereco: string | null;
  cidade: string | null;
  telefone: string | null;
  whatsapp: string | null;
  cadeiras: number | null;
}

/** Nome do posto de atendimento no segmento: cadeira na barbearia, consultório nas clínicas. */
export function nomePosto(seg: string, plural = false) {
  if (seg === "barbearia") return plural ? "Cadeiras" : "Cadeira";
  if (seg === "estetica") return plural ? "Salas" : "Sala";
  return plural ? "Consultórios" : "Consultório";
}

export default function Unidades() {
  const seg = useSegmento();
  const q = useQuery({ queryKey: ["unidades"], queryFn: () => apiGet<Unidade[]>("/unidades") });
  const [edit, setEdit] = useState<Unidade | "nova" | null>(null);
  const plano = usePlano();
  const ativas = (q.data ?? []).filter((u) => u.ativa).length;
  const limite = plano.data?.unidades ?? null;
  return (
    <div className="grid gap-4">
      <div className="rounded-xl border bg-card p-4 text-sm">
        <p className="font-semibold">{ativas} {ativas === 1 ? seg.termos.unidade.toLowerCase() : seg.termos.unidades.toLowerCase()} ativa(s){limite != null ? ` de ${limite} no plano ${plano.data?.nome}` : ` no plano ${plano.data?.nome ?? ""}`}</p>
        <p className="text-muted-foreground">Cada {seg.termos.unidade.toLowerCase()} vinculada à empresa entra na assinatura. Para abrir mais do que o plano permite, contrate {seg.termos.unidades.toLowerCase()} extras em Assinatura ou fale com o suporte.</p>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground">Cada {seg.termos.unidade.toLowerCase()} tem endereço próprio. {seg.termos.profissionais} e agenda podem ser separados por {seg.termos.unidade.toLowerCase()}.</p>
        <Button className="ml-auto shrink-0" onClick={() => setEdit("nova")} data-testid="nova-unidade"><Plus className="h-4 w-4" /> Nova {seg.termos.unidade.toLowerCase()}</Button>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {(q.data ?? []).map((u) => (
          <li key={u.id} className="flex items-start gap-3 rounded-xl border bg-card p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary"><Store className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{u.nome} {u.principal && <span className="ml-1 rounded bg-muted px-1.5 text-[11px] font-normal">principal</span>} {!u.ativa && <span className="ml-1 rounded bg-muted px-1.5 text-[11px] font-normal">desativada</span>}</p>
              <p className="flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> {[u.endereco, u.cidade].filter(Boolean).join(", ") || "Sem endereço"}</p>
              {!seg.vendas && <p className="text-sm text-muted-foreground">{u.cadeiras ? `${u.cadeiras} ${nomePosto(seg.chave, u.cadeiras !== 1).toLowerCase()}` : `${nomePosto(seg.chave, true)} não informados`}</p>}
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => setEdit(u)} aria-label={`Editar ${u.nome}`}><Pencil className="h-4 w-4" /></Button>
          </li>
        ))}
      </ul>
      <UnidadeDialog unidade={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function UnidadeDialog({ unidade, onClose }: { unidade: Unidade | "nova" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const seg = useSegmento();
  const [f, setF] = useState({ nome: "", endereco: "", cidade: "", telefone: "", whatsapp: "", cadeiras: "", ativa: true });
  useEffect(() => {
    if (unidade === "nova") setF({ nome: "", endereco: "", cidade: "", telefone: "", whatsapp: "", cadeiras: "", ativa: true });
    else if (unidade) setF({ nome: unidade.nome, endereco: unidade.endereco ?? "", cidade: unidade.cidade ?? "", telefone: unidade.telefone ?? "", whatsapp: unidade.whatsapp ?? "", cadeiras: unidade.cadeiras ? String(unidade.cadeiras) : "", ativa: unidade.ativa });
  }, [unidade]);
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { ...f, endereco: f.endereco || null, cidade: f.cidade || null, telefone: f.telefone || null, whatsapp: f.whatsapp || null, cadeiras: f.cadeiras ? Number(f.cadeiras) : null };
      return unidade === "nova" ? apiPost("/unidades", corpo) : apiPut(`/unidades/${(unidade as Unidade).id}`, corpo);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["unidades"] }); toast.success("Salvo"); onClose(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  return (
    <Dialog open={!!unidade} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{unidade === "nova" ? `Nova ${seg.termos.unidade.toLowerCase()}` : f.nome}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="u-nome">Nome</Label><Input id="u-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="u-end">Endereço</Label><Input id="u-end" value={f.endereco} onChange={(e) => setF({ ...f, endereco: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="u-cid">Cidade</Label><Input id="u-cid" value={f.cidade} onChange={(e) => setF({ ...f, cidade: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="u-wpp">WhatsApp</Label><Input id="u-wpp" inputMode="tel" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} /></div>
          </div>
          {!seg.vendas && (
            <div className="grid gap-1.5"><Label htmlFor="u-cad">{nomePosto(seg.chave, true)} de atendimento</Label>
              <Input id="u-cad" inputMode="numeric" value={f.cadeiras} onChange={(e) => setF({ ...f, cadeiras: e.target.value.replace(/\D/g, "").slice(0, 3) })} placeholder="Ex.: 4" data-testid="u-cadeiras" />
              <p className="text-xs text-muted-foreground">Usado no painel de ocupação: quantas estão em uso e quantas ficam paradas.</p>
            </div>
          )}
          {unidade !== "nova" && !(unidade as Unidade | null)?.principal && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ativa} onChange={(e) => setF({ ...f, ativa: e.target.checked })} className="accent-[var(--primary)]" /> Ativa</label>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={() => salvar.mutate()} disabled={f.nome.trim().length < 2 || salvar.isPending}>Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
