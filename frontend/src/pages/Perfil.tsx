import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPut, detalheErro } from "@/lib/api";
import type { UsuarioPublico } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Avatar from "@/components/shared/Avatar";
import FotoUploader from "@/components/shared/FotoUploader";
import GoogleConexao from "@/components/shared/GoogleConexao";

export default function Perfil() {
  const qc = useQueryClient();
  const { data: eu } = useQuery({ queryKey: ["perfil"], queryFn: () => apiGet<UsuarioPublico>("/perfil") });
  const [f, setF] = useState({ nome: "", telefone: "", cargo: "", creci: "" });
  const [foto, setFoto] = useState(false);

  useEffect(() => {
    if (eu) setF({ nome: eu.nome, telefone: eu.telefone ?? "", cargo: eu.cargo ?? "", creci: eu.creci ?? "" });
  }, [eu]);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["perfil"] });
    qc.invalidateQueries({ queryKey: ["auth", "me"] });
    qc.invalidateQueries({ queryKey: ["equipe"] });
    qc.invalidateQueries({ queryKey: ["usuarios"] });
  };
  const salvar = useMutation({
    mutationFn: () => apiPatch<UsuarioPublico>("/perfil", { nome: f.nome.trim(), telefone: f.telefone.trim() || null, cargo: f.cargo.trim() || null, creci: f.creci.trim() || null }),
    onSuccess: () => {
      toast.success("Perfil salvo");
      invalidar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });
  const enviarFoto = useMutation({
    mutationFn: (dataUrl: string) => apiPut(`/usuarios/${eu!.id}/foto`, { base64: dataUrl, mime: "image/jpeg" }),
    onSuccess: () => {
      toast.success("Foto atualizada");
      setFoto(false);
      invalidar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar a foto"),
  });
  const removerFoto = useMutation({ mutationFn: () => apiDelete(`/usuarios/${eu!.id}/foto`), onSuccess: invalidar });

  if (!eu) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="flex flex-col items-center gap-4 rounded-lg border bg-card p-6 sm:flex-row sm:items-center">
        <button type="button" onClick={() => setFoto(true)} className="group relative rounded-full" aria-label="Alterar foto">
          <Avatar nome={eu.nome} usuarioId={eu.id} temFoto={eu.tem_foto} versao={eu.foto_v} cor={eu.cor} tamanho="xl" />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Camera className="h-6 w-6" />
          </span>
        </button>
        <div className="flex-1 text-center sm:text-left">
          <h2 className="text-xl font-semibold">{eu.nome}</h2>
          <p className="text-sm text-muted-foreground">{eu.email}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Button size="sm" onClick={() => setFoto(true)}>
              <Camera className="h-3.5 w-3.5" /> {eu.tem_foto ? "Trocar foto" : "Criar foto"}
            </Button>
            {eu.tem_foto && (
              <Button size="sm" variant="ghost" onClick={() => removerFoto.mutate()}>
                <Trash2 className="h-3.5 w-3.5" /> Remover
              </Button>
            )}
          </div>
        </div>
      </section>

      <form
        className="grid gap-4 rounded-lg border bg-card p-6 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          salvar.mutate();
        }}
      >
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pf-nome">Nome</Label>
          <Input id="pf-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-tel">WhatsApp</Label>
          <Input id="pf-tel" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-creci">CRECI</Label>
          <Input id="pf-creci" value={f.creci} onChange={(e) => setF({ ...f, creci: e.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pf-cargo">Cargo</Label>
          <Input id="pf-cargo" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={salvar.isPending || f.nome.trim().length < 2}>
            Salvar perfil
          </Button>
        </div>
      </form>

      <GoogleConexao />

      <FotoUploader open={foto} onClose={() => setFoto(false)} salvando={enviarFoto.isPending} onConfirmar={(d) => enviarFoto.mutate(d)} />
    </div>
  );
}
