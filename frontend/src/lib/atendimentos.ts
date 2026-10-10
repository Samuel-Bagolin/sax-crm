import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

// Espelho de backend/routers/atendimentos.py
export type StatusAg = "agendado" | "confirmado" | "em_atendimento" | "concluido" | "faltou" | "cancelado";

export interface Servico {
  id: string;
  nome: string;
  duracao_min: number;
  preco: number;
  categoria: string | null;
  descricao: string | null;
  online: boolean;
  ativo: boolean;
  profissionais: string[];
  retorno_dias: number | null;
  unidade: string | null;
  valor_exemplo?: boolean;
}

export interface Profissional {
  id: string;
  nome: string;
  pessoa_id: string | null;
  atende: boolean;
  jornada: Record<string, [string, string][]> | null;
  unidade_ids: string[];
  comissao_pct: number;
  online: boolean;
  slug: string | null;
  especialidade: string | null;
  registro: string | null;
  cor: string | null;
  tem_foto: boolean;
  foto_v: number;
  papel: string;
}

export interface Agendamento {
  id: string;
  profissional_id: string;
  profissional_nome: string;
  unidade_id: string | null;
  servico_ids: string[];
  servicos: { id: string; nome: string; preco: number; duracao_min: number }[];
  cliente_id: string;
  cliente_nome: string;
  cliente_telefone: string | null;
  data: string;
  inicio: string;
  fim: string;
  status: StatusAg;
  valor: number;
  valor_cobrado?: number;
  forma_pagamento?: string;
  origem: "online" | "manual";
  observacoes: string | null;
}

export interface AgendaConfig {
  ativo: boolean;
  slug: string | null;
  sugestao_slug?: string;
  intervalo_min: number;
  antecedencia_min: number;
  janela_dias: number;
  cancelamento_horas: number;
  mensagem: string;
  pedir_email: boolean;
  jornada_padrao: Record<string, [string, string][]>;
  dias_retorno: number;
}

export const STATUS_AG: Record<StatusAg, { rotulo: string; classe: string }> = {
  agendado: { rotulo: "Agendado", classe: "border-sky-400 bg-sky-50 text-sky-950 dark:bg-sky-950/60 dark:text-sky-100" },
  confirmado: { rotulo: "Confirmado", classe: "border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-100" },
  em_atendimento: { rotulo: "Em atendimento", classe: "border-violet-500 bg-violet-50 text-violet-950 dark:bg-violet-950/60 dark:text-violet-100" },
  concluido: { rotulo: "Concluído", classe: "border-slate-400 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  faltou: { rotulo: "Faltou", classe: "border-red-400 bg-red-50 text-red-900 line-through dark:bg-red-950/50 dark:text-red-200" },
  cancelado: { rotulo: "Cancelado", classe: "border-slate-300 bg-transparent text-slate-400 line-through" },
};

export const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function useServicos() {
  return useQuery({ queryKey: ["servicos"], queryFn: () => apiGet<Servico[]>("/atendimentos/servicos") });
}
export function useProfissionais(todos = false) {
  return useQuery({ queryKey: ["profissionais", todos], queryFn: () => apiGet<Profissional[]>(`/atendimentos/profissionais${todos ? "?todos=true" : ""}`) });
}

export function minutos(h: string) {
  const [a, b] = h.split(":").map(Number);
  return a * 60 + b;
}
export function hhmm(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export function linkWhatsConfirmacao(a: Agendamento, empresa: string) {
  const d = a.data.split("-").reverse().join("/");
  const texto = `Olá, ${a.cliente_nome.split(" ")[0]}! Confirmando seu horário na ${empresa}: ${a.servicos.map((s) => s.nome).join(", ")} em ${d} às ${a.inicio} com ${a.profissional_nome}. Pode confirmar?`;
  const n = (a.cliente_telefone ?? "").replace(/\D/g, "");
  if (!n) return null;
  return `https://wa.me/${n.length <= 11 ? "55" + n : n}?text=${encodeURIComponent(texto)}`;
}
