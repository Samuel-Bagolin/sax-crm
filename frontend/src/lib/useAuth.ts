import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { Principal } from "@/lib/types";

/** Quem sou eu — a resposta vem do servidor a cada carga; o token fica no cookie httpOnly. */
export function useAuth() {
  const q = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => apiGet<Principal>("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });

  return {
    principal: q.data ?? null,
    carregando: q.isLoading,
    autenticado: !!q.data,
    isSysadmin: q.data?.papel === "sysadmin",
    isAdmin: q.data?.papel === "admin" || q.data?.papel === "sysadmin",
    isCorretor: q.data?.papel === "corretor",
    /** sysadmin fora de qualquer empresa → opera o plano de controle (Empresas). */
    noControle: q.data?.papel === "sysadmin" && !q.data?.empresa_id,
    empresaNome: q.data?.empresa_nome ?? null,
    suporte: !!q.data?.suporte,
  };
}
