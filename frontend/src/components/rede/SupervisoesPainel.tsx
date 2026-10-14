import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPinned, Pencil, Plus, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Sup { id: string; nome: string; praca: string | null; pixels: string[]; ativa: boolean; abertos: number; equipe: string[] }

/** Praças e supervisões (ex.: CWB Norte e Sul): o pixel da campanha manda o lead para a supervisão certa. */
export function SupervisoesPainel() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const q = useQuery({ queryKey: ["supervisoes"], queryFn: () => apiGet<{ pracas: string[]; supervisoes: Sup[] }>("/supervisoes") });
  const [edit, setEdit] = useState<Sup | "nova" | null>(null);
  const excluir = useMutation({
    mutationFn: (id: string) => apiDelete(`/supervisoes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["supervisoes"] }); qc.invalidateQueries({ queryKey: ["rede"] }); toast.success("Supervisão excluída"); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível excluir"),
  });
  const dados = q.data;
  const pracas = [...new Set([...(dados?.pracas ?? []), ...(dados?.supervisoes ?? []).map((s) => s.praca ?? "")])].filter(Boolean).sort();
  return (
    <section className="grid gap-3" data-testid="supervisoes-painel">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><MapPinned className="h-4 w-4 text-primary" /> Praças e supervisões</h3>
          <p className="text-sm text-muted-foreground">O supervisor vê os negócios da supervisão dele. Lead sem supervisão aparece para todos os supervisores da praça, para não se perder.</p>
        </div>
        {isAdmin && <Button size="sm" onClick={() => setEdit("nova")} data-testid="nova-supervisao"><Plus className="h-4 w-4" /> Nova supervisão</Button>}
      </div>
      {!pracas.length && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Cadastre a cidade de cada loja para as praças aparecerem aqui.</p>}
      <div className="grid gap-3 md:grid-cols-3">
        {pracas.map((p) => {
          const sups = (dados?.supervisoes ?? []).filter((s) => s.praca === p);
          return (
            <div key={p} className="rounded-xl border bg-card p-4">
              <p className="font-semibold">{p}</p>
              {!sups.length && <p className="mt-1 text-sm text-muted-foreground">Praça toda, sem divisão.</p>}
              <ul className="mt-2 grid gap-2">
                {sups.map((s) => (
                  <li key={s.id} className="rounded-lg bg-muted/50 p-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 font-medium">{s.nome}{!s.ativa && <span className="ml-1 text-xs text-muted-foreground">(desativada)</span>}</span>
                      <span className="text-xs text-muted-foreground">{s.abertos} aberto(s)</span>
                      {isAdmin && (
                        <>
                          <Button variant="ghost" size="icon-sm" onClick={() => setEdit(s)} aria-label={`Editar ${s.nome}`}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${s.nome}`}
                            onClick={() => window.confirm(`Excluir a supervisão ${s.nome}?`) && excluir.mutate(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{s.pixels.length ? `Pixels: ${s.pixels.join(", ")}` : "Sem pixel: cadastre para os leads da campanha caírem aqui"}</p>
                    {s.equipe.length > 0 && <p className="text-xs text-muted-foreground">{s.equipe.join(", ")}</p>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {edit && <SupDialog sup={edit} pracas={pracas} onClose={() => setEdit(null)} />}
    </section>
  );
}

function SupDialog({ sup, pracas, onClose }: { sup: Sup | "nova"; pracas: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const s = sup === "nova" ? null : sup;
  const [nome, setNome] = useState(s?.nome ?? "");
  const [praca, setPraca] = useState(s?.praca ?? pracas[0] ?? "");
  const [pixels, setPixels] = useState((s?.pixels ?? []).join(", "));
  const [ativa, setAtiva] = useState(s?.ativa ?? true);
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { nome: nome.trim(), praca: praca.trim(), ativa, pixels: pixels.split(",").map((x) => x.trim()).filter(Boolean) };
      return s ? apiPut<{ movidos: number }>(`/supervisoes/${s.id}`, corpo) : apiPost<{ movidos: number }>("/supervisoes", corpo);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["supervisoes"] });
      qc.invalidateQueries({ queryKey: ["rede"] });
      toast.success(r.movidos ? `Salvo. ${r.movidos} lead(s) e negócio(s) entraram nesta supervisão pelo pixel.` : "Salvo");
      onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{s ? s.nome : "Nova supervisão"}</DialogTitle>
          <DialogDescription>O pixel da campanha do Meta decide a supervisão do lead. O nome da supervisão também vale como pixel.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="sp-nome">Nome</Label><Input id="sp-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: CWB Norte" /></div>
          <div className="grid gap-1.5"><Label htmlFor="sp-praca">Praça</Label>
            <Input id="sp-praca" list="sp-pracas" value={praca} onChange={(e) => setPraca(e.target.value)} placeholder="Ex.: Curitiba" />
            <datalist id="sp-pracas">{pracas.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="sp-pix">Pixels (separe por vírgula)</Label><Input id="sp-pix" value={pixels} onChange={(e) => setPixels(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} /> Ativa</label>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={nome.trim().length < 2 || praca.trim().length < 2 || salvar.isPending}>Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
