import { useEffect, useState } from "react";
import { primeiroNome } from "@/lib/format";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Link as LinkRR } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, LogIn } from "lucide-react";
import MarcaSax from "@/components/shared/MarcaSax";
import LoginVitrine from "@/components/shared/LoginVitrine";
import { apiPost, detalheErro } from "@/lib/api";
import { beginSession } from "@/lib/session";
import type { Principal } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";



export default function Login() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  // O login é da plataforma: apaga qualquer resto da última empresa (título, cores e dados em memória).
  useEffect(() => {
    document.title = "SAX CRM";
    const raiz = document.documentElement;
    Array.from(raiz.style).filter((v) => v.startsWith("--")).forEach((v) => raiz.style.removeProperty(v));
    qc.removeQueries({ queryKey: ["config"] });
    qc.removeQueries({ queryKey: ["auth"] });
  }, [qc]);

  const entrar = useMutation({
    mutationFn: (dados: { email: string; senha: string }) => apiPost<Principal>("/auth/login", dados),
    onSuccess: (principal) => {
      beginSession();
      qc.setQueryData(["auth", "me"], principal);
      toast.success(`Bem-vindo, ${primeiroNome(principal.nome)}!`);
      navigate("/", { replace: true });
    },
    onError: (erro) => {
      toast.error(detalheErro(erro) ?? "Não foi possível entrar. Verifique os dados.");
    },
  });

  const submeter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !senha) {
      toast.error("Informe e-mail e senha.");
      return;
    }
    entrar.mutate({ email: email.trim(), senha });
  };



  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      {/* Painel de marca — lado esquerdo, assimétrico */}
      <div
        className="relative flex flex-col justify-between overflow-hidden bg-[#4a03a2] p-8 text-white lg:w-[44%] lg:p-12"
        data-testid="login-painel-marca"
      >
        <div className="flex items-center gap-4">
          {/* Login é da plataforma: sempre a marca SAX, nunca a de um cliente. */}
          <span className="flex items-center gap-3" data-testid="login-marca-sax">
            <MarcaSax className="w-28" />
            <span className="border-l border-white/25 pl-3 text-sm font-medium tracking-wider text-white/75">CRM</span>
          </span>
        </div>

        <div className="pointer-events-none absolute inset-0 opacity-[0.09] [background-image:radial-gradient(#fff_1.5px,transparent_1.5px)] [background-size:26px_26px]" />

        <div className="relative my-10 lg:my-0">
          <h1 className="font-heading text-3xl font-bold leading-tight tracking-tight lg:text-[40px]">
            O CRM feito para o
            <br />
            seu tipo de negócio.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/70">
            Imobiliária, loja de veículos, odontologia, clínica terapêutica, barbearia e estética. Cada um com menu,
            funil, agenda e telas feitas para a sua rotina.
          </p>
          <div className="mt-10 hidden lg:block">
            <LoginVitrine />
          </div>
        </div>

        <p className="relative text-[11px] text-white/50">
          CRM por segmento com tecnologia SAX
        </p>
      </div>

      {/* Formulário */}
      <div className="flex flex-1 items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm">
          <h2 className="font-heading text-2xl font-bold tracking-tight">Entrar</h2>
          <p className="mt-1 text-sm text-muted-foreground">Acesse o CRM da sua empresa.</p>

          <form onSubmit={submeter} className="mt-6 flex flex-col gap-4" data-testid="login-form">
            <div className="grid gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="voce@suaempresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="login-email-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                data-testid="login-senha-input"
              />
            </div>
            <Button
              type="submit"
              className="mt-1 active:scale-[0.98] transition-transform duration-100"
              disabled={entrar.isPending}
              data-testid="login-submit-button"
            >
              {entrar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {entrar.isPending ? "Entrando..." : "Entrar"}
            </Button>
            <Button type="button" variant="ghost" onClick={async () => {
              if (!email.trim()) { toast.error("Informe seu e-mail acima."); return; }
              try { await apiPost("/auth/recuperar", { email: email.trim() }); toast.success("Se o acesso estiver ativo, você receberá um link por e-mail."); }
              catch (e) { toast.error(detalheErro(e) ?? "Não foi possível solicitar recuperação."); }
            }}>Esqueci minha senha / ativar acesso</Button>
            <p className="mt-3 text-center text-sm text-muted-foreground">Ainda não tem conta? <LinkRR to="/cadastro" className="font-semibold text-primary hover:underline" data-testid="link-cadastro">Criar conta</LinkRR></p>
          </form>


        </div>
      </div>
    </div>
  );
}
