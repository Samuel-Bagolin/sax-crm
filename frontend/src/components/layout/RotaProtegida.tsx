import { useConfig } from "@/lib/useConfig";
import { useLocation } from "react-router-dom";
import { Navigate, Outlet } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import TrocaObrigatoria from "@/components/shared/TrocarSenha";

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
  const modules: Record<string, string> = { "/crm": "crm", "/leads": "crm", "/relatorios": "crm", "/crm/configurar": "crm", "/imoveis": "imoveis", "/proprietarios": "imoveis", "/meu-site": "imoveis", "/agenda": "agenda", "/contratos": "contratos", "/financeiro": "financeiro", "/usuarios": "usuarios" };
  const module = modules[pathname] ?? (pathname.startsWith("/negocios/") ? "crm" : pathname.startsWith("/proprietarios/") ? "imoveis" : undefined);

  if (carregando || configurando) {
    return (
      <div className="flex min-h-svh items-center justify-center" data-testid="auth-carregando">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!autenticado) return <Navigate to="/login" replace />;
  if (principal?.trocar_senha) return <TrocaObrigatoria />;
  if (somenteAdmin && !isAdmin) return <Navigate to="/" replace />;
  if (somenteSysadmin && !isSysadmin) return <Navigate to="/" replace />;

  if (module && !moduloAtivo(module)) return <Navigate to="/" replace />;
  return <Outlet />;
}
