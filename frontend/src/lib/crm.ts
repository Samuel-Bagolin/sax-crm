import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  CalendarCheck,
  Coffee,
  Flag,
  Home,
  Mail,
  MessageCircle,
  Phone,
  type LucideIcon,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import type { CrmConfig, Funil, MembroEquipe, PapelSignatario, TipoAtividade } from "@/lib/types";

export const TIPOS_ATIVIDADE: { tipo: TipoAtividade; label: string; icon: LucideIcon }[] = [
  { tipo: "ligacao", label: "Ligação", icon: Phone },
  { tipo: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { tipo: "email", label: "E-mail", icon: Mail },
  { tipo: "reuniao", label: "Reunião", icon: Briefcase },
  { tipo: "visita", label: "Visita", icon: Home },
  { tipo: "tarefa", label: "Tarefa", icon: CalendarCheck },
  { tipo: "prazo", label: "Prazo", icon: Flag },
  { tipo: "almoco", label: "Almoço", icon: Coffee },
];

export const ATIVIDADE = Object.fromEntries(TIPOS_ATIVIDADE.map((t) => [t.tipo, t])) as Record<
  TipoAtividade,
  (typeof TIPOS_ATIVIDADE)[number]
>;

export const PAPEL_SIGNATARIO: Record<PapelSignatario, string> = {
  comprador: "Comprador(a)",
  vendedor: "Vendedor(a)",
  locatario: "Locatário(a)",
  locador: "Locador(a)",
  fiador: "Fiador(a)",
  testemunha: "Testemunha",
  imobiliaria: "Imobiliária",
  loja: "Loja",
  corretor: "Corretor(a)",
  outro: "Outro",
};

/** Paleta para identificar consultores na agenda da equipe (contraste AA sobre branco). */
export const CORES_EQUIPE = ["#1f6f5c", "#4f7cac", "#b8862f", "#8a5a9e", "#c25b3f", "#2f8f9d", "#6b7f2a", "#b0476e"];

export function corDoMembro(m: { cor?: string | null; usuario_id?: string; pessoa_id?: string | null } | null | undefined, indice = 0) {
  if (m?.cor) return m.cor;
  const base = m?.pessoa_id || m?.usuario_id || String(indice);
  let h = 0;
  for (const ch of base) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES_EQUIPE[h % CORES_EQUIPE.length];
}

export function fotoUrl(usuarioId: string | null | undefined, versao = 0): string | null {
  return usuarioId ? `/api/usuarios/${usuarioId}/foto?v=${versao}` : null;
}

export function useFunis() {
  return useQuery({ queryKey: ["funis"], queryFn: () => apiGet<Funil[]>("/funis"), staleTime: 60_000 });
}

export function useCrmConfig() {
  return useQuery({ queryKey: ["crm-config"], queryFn: () => apiGet<CrmConfig>("/crm/config"), staleTime: 60_000 });
}

export function useEquipe() {
  return useQuery({ queryKey: ["equipe"], queryFn: () => apiGet<MembroEquipe[]>("/equipe"), staleTime: 30_000 });
}

export function iniciais(nome: string | null | undefined): string {
  return (nome ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export function diasDesde(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export function soDigitos(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

/** Link do WhatsApp com DDI 55 quando o número vier só com DDD. */
export function linkWhatsapp(telefone: string | null | undefined, texto?: string): string | null {
  let n = soDigitos(telefone);
  if (!n) return null;
  if (n.length <= 11) n = "55" + n;
  return `https://wa.me/${n}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const data = new Date(y, m - 1, d);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diff = Math.round((data.getTime() - hoje.getTime()) / 86_400_000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
