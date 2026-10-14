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

/** Como chamar a empresa do cliente na tela (logo da imobiliária, site da loja, clínica...). */
const EMPRESA: Record<SegmentoChave, string> = {
  imobiliaria: "imobiliária", veiculos: "loja", odontologia: "clínica", terapia: "clínica", barbearia: "barbearia", estetica: "clínica", comercio: "loja",
};
/** Registro profissional do segmento. Loja e barbearia não têm. */
const REGISTRO: Partial<Record<SegmentoChave, string>> = {
  imobiliaria: "CRECI", odontologia: "CRO", terapia: "CRP ou CRFa", estetica: "Registro profissional",
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
    vendas: chave === "imobiliaria" || chave === "veiculos",
    barbearia: chave === "barbearia",
    comercio: chave === "comercio",
    odonto: chave === "odontologia",
    /** "imobiliária", "loja", "clínica" ou "barbearia" (minúsculo). */
    empresa: EMPRESA[chave] ?? "empresa",
    /** "CRECI", "CRO", "CRP ou CRFa"... ou null quando o segmento não tem registro. */
    registro: REGISTRO[chave] ?? null,
    /** Domínio de exemplo para os campos de e-mail e site. */
    dominio: `sua${(EMPRESA[chave] ?? "empresa").normalize("NFD").replace(/[\u0300-\u036f]/g, "")}.com.br`,
  };
}
