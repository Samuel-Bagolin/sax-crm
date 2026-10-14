import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { useSegmento } from "@/lib/segmento";

/* Rede de lojas (comércio): praças, supervisões, lojas e onde cada pessoa atua. Lógica em backend/lib/supervisoes.py. */

export type PerfilRede = "diretoria" | "gerente_op" | "gerente_exp" | "supervisor" | "lider";
export const PERFIS_REDE: { v: PerfilRede; rotulo: string; dica: string }[] = [
  { v: "diretoria", rotulo: "Diretoria (ADM)", dica: "Vê e configura tudo." },
  { v: "gerente_op", rotulo: "Gerente de Operações", dica: "Vê tudo, cuida de funis, supervisões, equipe e aprova comissão." },
  { v: "gerente_exp", rotulo: "Gerente de Expansão", dica: "Vê tudo, cuida de funis, supervisões, equipe e aprova comissão." },
  { v: "supervisor", rotulo: "Supervisor de Lojas", dica: "Vê as supervisões dele (sem supervisão, a praça inteira), define o responsável e aprova comissão." },
  { v: "lider", rotulo: "Líder de Lojas", dica: "Vê só os cards em que é responsável e só a própria comissão." },
];

export interface SupervisaoRede { id: string; nome: string; praca: string | null; ativa: boolean }
export interface MembroRede { pessoa_id: string; nome: string; perfil: PerfilRede | null; supervisoes: string[]; pracas: string[]; unidade_id: string | null; atua_em: string }
export interface Rede {
  pracas: string[];
  supervisoes: SupervisaoRede[];
  lojas: { id: string; nome: string; praca: string | null; supervisao_id: string | null }[];
  equipe: MembroRede[];
  eu: { supervisoes: string[]; pracas: string[]; equipe: string[] };
}

export function useRede() {
  const seg = useSegmento();
  const q = useQuery({ queryKey: ["rede"], queryFn: () => apiGet<Rede>("/supervisoes/atuacao"), enabled: seg.comercio, staleTime: 60_000 });
  const rede = q.data;
  const nomeSup = (id: string | null | undefined) => (id ? rede?.supervisoes.find((s) => s.id === id)?.nome ?? null : null);
  const nomeLoja = (id: string | null | undefined) => (id ? rede?.lojas.find((l) => l.id === id)?.nome ?? null : null);
  return { ativa: seg.comercio && !!rede, rede, nomeSup, nomeLoja, carregando: q.isLoading };
}
