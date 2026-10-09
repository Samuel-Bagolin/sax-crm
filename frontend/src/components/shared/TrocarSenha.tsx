import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost, detalheErro } from "@/lib/api";
import { endSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MarcaSax from "@/components/shared/MarcaSax";

/** Formulário de troca de senha do próprio usuário (Perfil e troca obrigatória). */
export function FormTrocarSenha({ aoSalvar }: { aoSalvar?: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ atual: "", nova: "", confirmar: "" });
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        if (f.nova !== f.confirmar) return setErro("As senhas novas não coincidem.");
        if (f.nova.length < 12) return setErro("Use ao menos 12 caracteres.");
        if (new TextEncoder().encode(f.nova).length > 72) return setErro("A senha excede o limite de 72 bytes.");
        setErro("");
        setBusy(true);
        try {
          await apiPost("/auth/senha", { senha_atual: f.atual, nova_senha: f.nova });
          setF({ atual: "", nova: "", confirmar: "" });
          toast.success("Senha alterada");
          await qc.invalidateQueries({ queryKey: ["auth", "me"] });
          aoSalvar?.();
        } catch (err) {
          setErro(detalheErro(err) ?? "Não foi possível trocar a senha.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="ts-atual">Senha atual</Label>
        <Input id="ts-atual" type="password" autoComplete="current-password" required value={f.atual} onChange={(e) => setF({ ...f, atual: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ts-nova">Nova senha (mínimo 12 caracteres)</Label>
        <Input id="ts-nova" type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={f.nova} onChange={(e) => setF({ ...f, nova: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ts-confirmar">Confirmar nova senha</Label>
        <Input id="ts-confirmar" type="password" autoComplete="new-password" required value={f.confirmar} onChange={(e) => setF({ ...f, confirmar: e.target.value })} />
      </div>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Salvando..." : "Salvar nova senha"}
        </Button>
      </div>
    </form>
  );
}

/** Tela cheia exibida quando o servidor exige a troca da senha inicial. */
export default function TrocaObrigatoria() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-5 rounded-lg border bg-card p-6 shadow-sm">
        <MarcaSax />
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Crie uma senha nova</h1>
          <p className="text-sm text-muted-foreground">
            A senha usada neste primeiro acesso é fraca. Troque agora para liberar o sistema.
          </p>
        </div>
        <FormTrocarSenha />
        <button type="button" className="text-sm text-muted-foreground underline" onClick={() => endSession()}>
          Sair
        </button>
      </div>
    </main>
  );
}
