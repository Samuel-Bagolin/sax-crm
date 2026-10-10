import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { MessageCircle, Phone, Plus, Search, UserRound } from "lucide-react";
import { apiGet, apiPost, detalheErro } from "@/lib/api";
import type { PacienteResumo } from "@/lib/pacientes";
import { useSegmento } from "@/lib/segmento";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Retorno {
  cliente_id: string;
  cliente_nome: string;
  telefone: string | null;
  ultimo_atendimento: string;
  dias: number;
  profissional: string | null;
  servicos: string[];
}

function dataBR(iso: string | null) {
  return iso ? iso.slice(0, 10).split("-").reverse().join("/") : "-";
}
function whats(tel: string | null, texto: string) {
  const n = (tel ?? "").replace(/\D/g, "");
  return n ? `https://wa.me/${n.length <= 11 ? "55" + n : n}?text=${encodeURIComponent(texto)}` : null;
}

export default function Pacientes() {
  const seg = useSegmento();
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState(false);
  const lista = useQuery({ queryKey: ["pacientes-lista"], queryFn: () => apiGet<PacienteResumo[]>("/pacientes") });
  const retorno = useQuery({ queryKey: ["retorno"], queryFn: () => apiGet<Retorno[]>("/atendimentos/retorno") });
  const filtrada = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (lista.data ?? []).filter((p) => !t || `${p.nome} ${p.telefone ?? ""} ${p.email ?? ""} ${p.cpf_cnpj ?? ""}`.toLowerCase().includes(t));
  }, [lista.data, busca]);

  return (
    <Tabs defaultValue="todos">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <TabsList>
          <TabsTrigger value="todos">Todos ({lista.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="retorno" data-testid="aba-retorno">Chamar de volta ({retorno.data?.length ?? 0})</TabsTrigger>
        </TabsList>
        <Button className="sm:ml-auto" onClick={() => setNovo(true)} data-testid="novo-paciente"><Plus className="h-4 w-4" /> Novo {seg.termos.cliente.toLowerCase()}</Button>
      </div>
      <TabsContent value="todos" className="mt-4 grid gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome, telefone, e-mail ou CPF" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {lista.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : !filtrada.length ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            {lista.data?.length ? "Ninguém encontrado com essa busca." : `Nenhum ${seg.termos.cliente.toLowerCase()} ainda. Eles entram sozinhos quando agendam pelo link.`}
          </div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card" data-testid="lista-pacientes">
            {filtrada.map((p) => (
              <li key={p.id}>
                <Link to={`/pacientes/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-primary"><UserRound className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.nome}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[p.telefone, p.email].filter(Boolean).join(", ") || "Sem contato"}</span>
                  </span>
                  <span className="hidden text-right text-xs text-muted-foreground sm:block">última vez<br />{dataBR(p.ultimo_atendimento)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
      <TabsContent value="retorno" className="mt-4 grid gap-3">
        <p className="text-sm text-muted-foreground">Quem não volta há algum tempo e não tem horário marcado. O prazo vem do serviço (ex.: toxina em 120 dias) ou da configuração do link.</p>
        {!retorno.data?.length ? <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Ninguém para chamar agora.</div> : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {retorno.data.map((r) => {
              const link = whats(r.telefone, `Olá, ${r.cliente_nome.split(" ")[0]}! Faz ${r.dias} dias desde a sua última visita (${r.servicos.join(", ")}). Quer agendar o próximo horário?`);
              return (
                <li key={r.cliente_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <Link to={`/pacientes/${r.cliente_id}`} className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.cliente_nome}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.servicos.join(", ")}, com {r.profissional}, em {dataBR(r.ultimo_atendimento)}</p>
                  </Link>
                  <span className="num text-sm font-semibold text-amber-700 dark:text-amber-400">{r.dias} dias</span>
                  {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted"><MessageCircle className="h-4 w-4" /> Chamar</a>
                    : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3.5 w-3.5" /> sem telefone</span>}
                </li>
              );
            })}
          </ul>
        )}
      </TabsContent>
      <NovoPaciente aberto={novo} onClose={() => setNovo(false)} />
    </Tabs>
  );
}

function NovoPaciente({ aberto, onClose }: { aberto: boolean; onClose: () => void }) {
  const seg = useSegmento();
  const qc = useQueryClient();
  const navegar = useNavigate();
  const [f, setF] = useState({ nome: "", telefone: "", email: "", cpf_cnpj: "", data_nascimento: "" });
  const salvar = useMutation({
    mutationFn: () => apiPost<{ id: string }>("/pacientes", { ...f, email: f.email || null, cpf_cnpj: f.cpf_cnpj || null, data_nascimento: f.data_nascimento || null, telefone: f.telefone || null }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["pacientes-lista"] });
      onClose();
      navegar(`/pacientes/${p.id}`);
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Confira os dados"),
  });
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Novo {seg.termos.cliente.toLowerCase()}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="p-nome">Nome completo</Label><Input id="p-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} data-testid="paciente-nome" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="p-tel">WhatsApp</Label><Input id="p-tel" inputMode="tel" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="p-nasc">Nascimento</Label><Input id="p-nasc" type="date" value={f.data_nascimento} onChange={(e) => setF({ ...f, data_nascimento: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="p-cpf">CPF</Label><Input id="p-cpf" inputMode="numeric" value={f.cpf_cnpj} onChange={(e) => setF({ ...f, cpf_cnpj: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="p-email">E-mail</Label><Input id="p-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={f.nome.trim().length < 2 || salvar.isPending} data-testid="paciente-salvar">Cadastrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
