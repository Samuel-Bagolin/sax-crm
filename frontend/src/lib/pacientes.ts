// Espelho de backend/routers/pacientes.py
import type { EstadoDente } from "@/components/odonto/odontoDados";

export interface PacienteResumo {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  data_nascimento: string | null;
  ultimo_atendimento: string | null;
  cpf_cnpj: string | null;
}

export interface ItemTratamento {
  id?: string;
  servico_id?: string | null;
  descricao: string;
  dente?: string | null;
  faces?: string[];
  regiao?: string | null;
  ponto?: [number, number, number] | null;
  quantidade: number;
  unidade: string;
  valor_unitario: number;
  valor?: number;
  status?: "planejado" | "realizado";
  realizado_em?: string;
}

export type StatusTratamento = "rascunho" | "apresentado" | "aprovado" | "recusado" | "concluido";

export interface Tratamento {
  id: string;
  paciente_id: string;
  tipo: "odonto" | "facial" | "geral";
  titulo: string;
  itens: ItemTratamento[];
  subtotal: number;
  desconto: number;
  total: number;
  parcelas: number;
  primeira_parcela: string | null;
  observacoes: string | null;
  validade_dias: number;
  status: StatusTratamento;
  profissional_nome: string;
  negocio_id: string | null;
  created_at: string;
  motivo_recusa?: string;
}

export interface DenteFicha {
  estado: EstadoDente;
  faces: Record<string, EstadoDente>;
  nota: string | null;
  em?: string;
  por?: string;
}

export interface FichaPaciente {
  paciente: PacienteResumo & Record<string, string | null>;
  anamnese: Record<string, string | boolean | null>;
  alertas: string[];
  odontograma: Record<string, DenteFicha>;
  agendamentos: { id: string; data: string; inicio: string; fim: string; status: string; profissional_nome: string; servicos: { nome: string }[]; valor: number; valor_cobrado?: number }[];
  proximo: { data: string; inicio: string; profissional_nome: string } | null;
  tratamentos: Tratamento[];
  resumo: { atendimentos: number; faltas: number; gasto_total: number; primeiro: string | null; ultimo: string | null };
  financeiro: { pago: number; a_receber: number; parcelas: { id: string; descricao: string; valor: number; vencimento: string; pagamento: string | null; status: string }[] } | null;
  pode_prontuario: boolean;
  dados_clinicos?: boolean;
}

export interface Evolucao {
  id: string;
  tipo: "evolucao" | "avaliacao" | "anotacao" | "plano_terapeutico";
  texto: string;
  data: string;
  autor_nome: string;
  adendos: { texto: string; autor_nome: string; em: string }[];
  pode_editar: boolean;
  created_at: string;
}

export const STATUS_TRAT: Record<StatusTratamento, { rotulo: string; classe: string }> = {
  rascunho: { rotulo: "Rascunho", classe: "bg-muted text-muted-foreground" },
  apresentado: { rotulo: "Apresentado", classe: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  aprovado: { rotulo: "Aprovado", classe: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  concluido: { rotulo: "Concluído", classe: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  recusado: { rotulo: "Recusado", classe: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
};

/** Perguntas de anamnese por segmento (respostas livres + sim/não). */
export const ANAMNESE: Record<string, { chave: string; pergunta: string; tipo: "sim_nao" | "texto" }[]> = {
  odontologia: [
    { chave: "queixa", pergunta: "Queixa principal", tipo: "texto" },
    { chave: "alergia", pergunta: "Tem alergia a medicamento ou anestésico?", tipo: "sim_nao" },
    { chave: "alergia_qual", pergunta: "Qual alergia?", tipo: "texto" },
    { chave: "cardiaco", pergunta: "Problema cardíaco ou pressão alta?", tipo: "sim_nao" },
    { chave: "diabetes", pergunta: "Diabetes?", tipo: "sim_nao" },
    { chave: "anticoagulante", pergunta: "Usa anticoagulante?", tipo: "sim_nao" },
    { chave: "gestante", pergunta: "Está grávida ou amamentando?", tipo: "sim_nao" },
    { chave: "medicamentos", pergunta: "Medicamentos em uso", tipo: "texto" },
    { chave: "sangramento", pergunta: "Sangramento ao escovar?", tipo: "sim_nao" },
    { chave: "ultima_consulta", pergunta: "Última ida ao dentista", tipo: "texto" },
  ],
  terapia: [
    { chave: "queixa", pergunta: "Motivo da procura", tipo: "texto" },
    { chave: "encaminhamento", pergunta: "Encaminhado por", tipo: "texto" },
    { chave: "tratamento_anterior", pergunta: "Já fez terapia antes?", tipo: "sim_nao" },
    { chave: "medicacao", pergunta: "Usa medicação psiquiátrica ou neurológica?", tipo: "sim_nao" },
    { chave: "medicacao_qual", pergunta: "Qual medicação e dose?", tipo: "texto" },
    { chave: "responsavel", pergunta: "Responsável (se menor de idade)", tipo: "texto" },
    { chave: "escola", pergunta: "Escola e série (fonoaudiologia infantil)", tipo: "texto" },
    { chave: "objetivos", pergunta: "Objetivos combinados", tipo: "texto" },
  ],
  estetica: [
    { chave: "queixa", pergunta: "O que a cliente quer melhorar", tipo: "texto" },
    { chave: "alergia", pergunta: "Tem alergia (medicamento, látex, lidocaína)?", tipo: "sim_nao" },
    { chave: "gestante", pergunta: "Está grávida ou amamentando?", tipo: "sim_nao" },
    { chave: "autoimune", pergunta: "Doença autoimune ou neuromuscular?", tipo: "sim_nao" },
    { chave: "anticoagulante", pergunta: "Usa anticoagulante ou ácido acetilsalicílico?", tipo: "sim_nao" },
    { chave: "procedimentos_previos", pergunta: "Procedimentos anteriores (o que e quando)", tipo: "texto" },
    { chave: "herpes", pergunta: "Histórico de herpes labial?", tipo: "sim_nao" },
    { chave: "expectativa", pergunta: "Expectativa de resultado", tipo: "texto" },
  ],
  barbearia: [
    { chave: "preferencias", pergunta: "Preferências de corte e acabamento", tipo: "texto" },
    { chave: "alergia", pergunta: "Alergia a algum produto?", tipo: "sim_nao" },
    { chave: "bebida", pergunta: "Bebida preferida", tipo: "texto" },
  ],
};
