import { useConfig } from "@/lib/useConfig";
import { useAuth } from "@/lib/useAuth";
import type { SegmentoChave, TermosSegmento } from "@/lib/types";

/** Vocabulário padrão (imobiliária). O servidor manda o do segmento em /configuracoes/publica. */
export const TERMOS_PADRAO: TermosSegmento = {
  cliente: "Cliente",
  clientes: "Clientes",
  profissional: "Corretor",
  profissionais: "Corretores",
  item: "Imóvel",
  itens: "Imóveis",
  unidade: "Unidade",
  unidades: "Unidades",
  atendimento: "Visita",
  atendimentos: "Visitas",
};

export const SERVICOS: SegmentoChave[] = ["barbearia", "terapia", "odontologia", "estetica"];

/** Segmento da empresa logada: chave, termos e o que ela usa (agenda online, prontuário). */
export function useSegmento() {
  const { config } = useConfig();
  const { principal } = useAuth();
  const info = config.segmento;
  const chave: SegmentoChave = (principal?.segmento ?? info?.chave ?? "imobiliaria") as SegmentoChave;
  const termos = info?.termos ?? TERMOS_PADRAO;
  return {
    chave,
    nome: info?.nome ?? "Imobiliária",
    termos,
    categoria: info?.categoria ?? "vendas",
    servicos: SERVICOS.includes(chave),
    saude: chave === "odontologia" || chave === "terapia" || chave === "estetica",
    prontuario: !!info?.prontuario,
    agendaOnline: !!info?.agenda_online,
    veiculos: chave === "veiculos",
    imobiliaria: chave === "imobiliaria",
  };
}
