import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { ConfiguracaoPublica } from "@/lib/types";

export const PADRAO: ConfiguracaoPublica = {
  nome_software: "SAX",
  slogan: "",
  modulos_ativos: ["dashboard", "imoveis", "crm", "agenda", "contratos", "financeiro", "usuarios"],
  titulos_modulos: {
    dashboard: "Visão Geral",
    imoveis: "Imóveis",
    crm: "CRM & Funil",
    agenda: "Agenda",
    contratos: "Contratos",
    financeiro: "Financeiro",
    usuarios: "Consultores",
  },
  cor_painel: "#ffffff",
  cor_fonte: "#1c1c1c",
  cor_primaria: "#4a03a2",
  imagem_fundo_login: null,
  tem_logo: false,
};

/** Identidade visual e módulos ativos definidos pelo Administrador de Sistema. */
export function useConfig() {
  const q = useQuery({
    queryKey: ["config", "publica"],
    queryFn: () => apiGet<ConfiguracaoPublica>("/configuracoes/publica"),
    staleTime: 60_000,
  });

  const config = q.data ?? PADRAO;
  return {
    config,
    carregando: q.isLoading,
    logoUrl: config.tem_logo ? "/api/configuracoes/logo" : null,
    moduloAtivo: (m: string) => config.modulos_ativos.includes(m),
    titulo: (m: string) => config.titulos_modulos[m] ?? PADRAO.titulos_modulos[m] ?? m,
  };
}
