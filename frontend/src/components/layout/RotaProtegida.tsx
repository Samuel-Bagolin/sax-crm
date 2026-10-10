import { useConfig } from "@/lib/useConfig";
import { useLocation } from "react-router-dom";
import { Navigate, Outlet } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import TrocaObrigatoria from "@/components/shared/TrocarSenha";
import { Link } from "react-router-dom";
import { endSession } from "@/lib/session";

function Bloqueado({ motivo, admin }: { motivo: string; admin: boolean }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-2xl border bg-card p-8 text-center">
        <p className="text-lg font-semibold">Acesso pausado</p>
        <p className="mt-2 text-sm text-muted-foreground">{motivo}</p>
        {admin ? (
          <Link to="/assinatura" className="mt-5 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground">Regularizar assinatura</Link>
        ) : <p className="mt-4 text-sm">Fale com o gestor da sua empresa.</p>}
        <button type="button" onClick={() => endSession()} className="mt-4 block w-full text-sm text-muted-foreground underline">Sair</button>
      </div>
    </div>
  );
}

/** Porteiro da UI. A autorização real é do servidor — isto só evita telas sem dados. */
export default function RotaProtegida({
  somenteAdmin = false,
  somenteSysadmin = false,
}: {
  somenteAdmin?: boolean;
  somenteSysadmin?: boolean;
}) {
  const { autenticado, carregando, isAdmin, isSysadmin, principal } = useAuth();
  const { moduloAtivo, carregando: configurando } = useConfig();
  const { pathname } = useLocation();
  const modules: Record<string, string> = { "/crm": "crm", "/leads": "crm", "/relatorios": "crm", "/crm/configurar": "crm", "/imoveis": "imoveis", "/proprietarios": "imoveis", "/veiculos": "veiculos", "/atendimentos": "atendimentos", "/agenda-online": "atendimentos", "/pacientes": "pacientes", "/orcamentos": "pacientes", "/clube": "atendimentos", "/agenda": "agenda", "/contratos": "contratos", "/financeiro": "financeiro", "/usuarios": "usuarios" };
  const module = modules[pathname] ?? (pathname.startsWith("/negocios/") ? "crm" : pathname.startsWith("/proprietarios/") ? "imoveis" : pathname.startsWith("/pacientes/") ? "pacientes" : undefined);

  if (carregando || configurando) {
    return (
      <div className="flex min-h-svh items-center justify-center" data-testid="auth-carregando">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!autenticado) return <Navigate to="/login" replace />;
  if (principal?.trocar_senha) return <TrocaObrigatoria />;
  if (principal?.bloqueio && pathname !== "/assinatura") return <Bloqueado motivo={principal.bloqueio} admin={isAdmin} />;
  if (somenteAdmin && !isAdmin) return <Navigate to="/" replace />;
  if (somenteSysadmin && !isSysadmin) return <Navigate to="/" replace />;

  if (module && !moduloAtivo(module)) return <Navigate to="/" replace />;
  return <Outlet />;
}
