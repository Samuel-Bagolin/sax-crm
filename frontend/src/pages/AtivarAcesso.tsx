import { useEffect, useState } from "react";
import { apiPost, detalheErro } from "@/lib/api";
import { readActivationToken } from "@/lib/activation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AtivarAcesso() {
  const [token] = useState(() => readActivationToken(window.location.hash));
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [busy, setBusy] = useState(false);
  const [salvo, setSalvo] = useState(false);

  // Remove the secret only after React has committed the captured state.
  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }, [token]);

  if (salvo) return <main className="mx-auto mt-20 max-w-md space-y-4 p-6">
    <h1 className="text-2xl font-bold">Senha salva</h1>
    <p role="status">Sua nova senha foi salva. Entre no ERP com seu e-mail e a nova senha.</p>
    <a className="underline" href="/login">Ir para o login</a>
  </main>;

  return <main className="mx-auto mt-20 max-w-md space-y-4 p-6">
    <h1 className="text-2xl font-bold">Definir senha</h1>
    {!token ? <div role="alert" className="space-y-3">
      <p>O código de recuperação não está nesta página. Abra novamente o link do e-mail mais recente. Se ele expirou, solicite outro link.</p>
      <a className="underline" href="/login">Voltar ao login e recuperar acesso</a>
    </div> : <>
      <p>Use ao menos 12 caracteres. Este link é de uso único.</p>
      <form className="space-y-4" onSubmit={async e => {
        e.preventDefault();
        if (busy) return;
        if (senha !== confirmar) { setMensagem("As senhas não coincidem."); return; }
        if (senha.length < 12) { setMensagem("Use ao menos 12 caracteres."); return; }
        if (new TextEncoder().encode(senha).length > 72) { setMensagem("A senha excede o limite de 72 bytes. Use uma senha menor."); return; }
        setMensagem(""); setBusy(true);
        try {
          await apiPost("/auth/ativar", { token, senha });
          setSenha(""); setConfirmar(""); setSalvo(true);
        } catch (err) { setMensagem(detalheErro(err) || "Não foi possível salvar a senha. Confira o link e tente novamente."); }
        finally { setBusy(false); }
      }}>
        <label htmlFor="nova-senha">Nova senha</label>
        <Input id="nova-senha" type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={senha} onChange={e => setSenha(e.target.value)} />
        <label htmlFor="confirmar-senha">Confirmar senha</label>
        <Input id="confirmar-senha" type="password" autoComplete="new-password" required value={confirmar} onChange={e => setConfirmar(e.target.value)} />
        <Button type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar senha"}</Button>
        <p role="alert" aria-live="polite">{mensagem}</p>
      </form>
    </>}
  </main>;
}
