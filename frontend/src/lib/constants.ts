import type { ImovelFinalidade, ImovelStatus, ImovelTipo, LeadEstagio, PlanoTipo, TransacaoTipo } from "./types";

export const IMOVEL_STATUS: Record<ImovelStatus, { label: string; badge: string }> = {
  captado: {
    label: "Captado",
    badge: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",
  },
  publicado: {
    label: "Publicado",
    badge:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
  },
  vendido: {
    label: "Vendido",
    badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  },
  alugado: {
    label: "Alugado",
    badge:
      "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-900",
  },
};

export const IMOVEL_TIPO: Record<ImovelTipo, string> = {
  apartamento: "Apartamento",
  casa: "Casa",
  terreno: "Terreno",
  comercial: "Comercial",
};

export const IMOVEL_FINALIDADE: Record<ImovelFinalidade, string> = {
  venda: "Venda",
  locacao: "Locação",
  ambos: "Venda / Locação",
};

export const ORIGENS = [
  "Portal ZAP",
  "VivaReal",
  "OLX",
  "Instagram / Facebook Ads",
  "Indicação / Carteira",
  "Placa no Local",
  "Site Imobiliária",
];

export interface KanbanColumn {
  id: string;
  estagio: LeadEstagio;
  titulo: string;
  accent: string;
}

export const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: "novo", estagio: "novo", titulo: "Novo Lead", accent: "border-t-sky-500" },
  { id: "atendimento", estagio: "atendimento", titulo: "Em Atendimento", accent: "border-t-blue-500" },
  { id: "visita", estagio: "visita", titulo: "Visita Agendada", accent: "border-t-amber-500" },
  { id: "proposta", estagio: "proposta", titulo: "Proposta Enviada", accent: "border-t-purple-500" },
  { id: "fechado_ganho", estagio: "ganho", titulo: "Ganho (Fechado)", accent: "border-t-emerald-500" },
  { id: "fechado_perdido", estagio: "perdido", titulo: "Perdido", accent: "border-t-rose-500" },
];

export const LEAD_ESTAGIO_LABEL: Record<LeadEstagio, string> = {
  novo: "Novo",
  atendimento: "Em Atendimento",
  visita: "Visita",
  proposta: "Proposta",
  ganho: "Ganho",
  perdido: "Perdido",
};

export const PLANO_TIPO: Record<PlanoTipo, string> = { receita: "Receita", despesa: "Despesa" };

export const TRANSACAO_TIPO: Record<TransacaoTipo, string> = { receber: "A Receber", pagar: "A Pagar" };
