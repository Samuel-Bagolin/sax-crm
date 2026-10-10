import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { useSegmento } from "@/lib/segmento";
import { useAuth } from "@/lib/useAuth";
import { nomePosto } from "@/pages/Unidades";
import { cn } from "@/lib/utils";
import type { Posto } from "./Cadeiras3D";

const Cadeiras3D = lazy(() => import("./Cadeiras3D"));

interface UnidadeOcupacao {
  id: string;
  nome: string;
  cadeiras: number;
  cadeiras_definidas: boolean;
  profissionais: number;
  ocupadas_agora: number | null;
  taxa_dia: number;
  atendimentos: number;
  horas: { hora: string; ocupadas: number }[];
  postos: Posto[];
}
interface Ocupacao {
  data: string;
  agora: string | null;
  abre: string;
  fecha: string;
  unidades: UnidadeOcupacao[];
}

/** Ocupação das cadeiras (ou consultórios) por unidade: agora, por hora e no dia. */
export default function PainelOcupacao() {
  const seg = useSegmento();
  const { isAdmin } = useAuth();
  const q = useQuery({ queryKey: ["ocupacao"], queryFn: () => apiGet<Ocupacao>("/atendimentos/ocupacao"), refetchInterval: 120_000 });
  const [sel, setSel] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <div className="h-[420px] animate-pulse rounded-xl bg-muted" />;
  const u = d.unidades.find((x) => x.id === sel) ?? d.unidades[0];
  if (!u) return null;
  const posto = nomePosto(seg.chave, true).toLowerCase();
  const ocupadas = u.ocupadas_agora ?? 0;
  const ociosas = u.cadeiras - ocupadas;
  const max = Math.max(1, u.cadeiras);
  return (
    <section className="overflow-hidden rounded-xl border bg-card" data-testid="painel-ocupacao">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="font-semibold">Ocupação das {posto}</p>
          <p className="text-xs text-muted-foreground">Funcionamento de hoje: {d.abre} às {d.fecha}{d.agora ? `, agora ${d.agora}` : ""}</p>
        </div>
        {d.unidades.length > 1 && (
          <div className="ml-auto flex flex-wrap gap-1.5" role="tablist" aria-label={seg.termos.unidades}>
            {d.unidades.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={x.id === u.id} onClick={() => setSel(x.id)}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium", x.id === u.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                {x.nome}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-0 lg:grid-cols-[1fr_300px]">
        <div className="relative bg-gradient-to-b from-[#faf7f3] to-[#efe7df] dark:from-[#1f1a26] dark:to-[#14101a]">
          {seg.barbearia ? (
            <Suspense fallback={<div className="h-[300px] animate-pulse sm:h-[360px]" />}>
              <Cadeiras3D postos={u.postos} />
            </Suspense>
          ) : (
            <div className="flex min-h-[220px] flex-wrap content-center justify-center gap-3 p-6">
              {u.postos.map((p) => (
                <div key={p.numero} className={cn("flex h-20 w-28 flex-col items-center justify-center rounded-xl border-2 text-center text-xs", p.ocupada ? "border-[#ff7a00] bg-[#ff7a00]/10" : "border-dashed border-muted-foreground/40")}>
                  <span className="font-semibold">{nomePosto(seg.chave)} {p.numero}</span>
                  <span className="truncate px-1 text-muted-foreground">{p.ocupada ? p.cliente : "livre"}</span>
                </div>
              ))}
            </div>
          )}
          <div className="pointer-events-none absolute left-3 top-3 flex gap-2 text-[11px] font-medium">
            <span className="flex items-center gap-1 rounded-full bg-card/85 px-2 py-1 shadow-sm"><span className="h-2.5 w-2.5 rounded-full bg-[#ff7a00]" /> Ocupada</span>
            <span className="flex items-center gap-1 rounded-full bg-card/85 px-2 py-1 shadow-sm"><span className="h-2.5 w-2.5 rounded-full bg-[#9aa0ad]" /> Ociosa</span>
          </div>
        </div>

        <div className="grid content-start gap-4 border-t p-4 lg:border-l lg:border-t-0">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Numero rotulo="Ocupadas" valor={d.agora ? String(ocupadas) : "-"} destaque />
            <Numero rotulo="Ociosas" valor={d.agora ? String(ociosas) : "-"} />
            <Numero rotulo="Total" valor={String(u.cadeiras)} />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium">Ocupação do dia</p>
              <p className="num text-xl font-bold">{u.taxa_dia}%</p>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-[#ff7a00]" style={{ width: `${Math.min(100, u.taxa_dia)}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{u.atendimentos} {seg.termos.atendimentos.toLowerCase()} marcados hoje em {u.cadeiras} {posto}.</p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">Hora a hora</p>
            <div className="flex items-end gap-[3px]" aria-label="Cadeiras ocupadas por hora">
              {u.horas.map((h) => {
                const agoraAqui = d.agora?.slice(0, 2) === h.hora.slice(0, 2);
                return (
                  <div key={h.hora} className="flex flex-1 flex-col items-center gap-1" title={`${h.hora}: ${h.ocupadas} de ${u.cadeiras} ocupadas`}>
                    <div className="flex h-20 w-full items-end rounded-sm bg-muted">
                      <div className={cn("w-full rounded-sm", agoraAqui ? "bg-[#4a03a2]" : "bg-[#ff7a00]")} style={{ height: `${(h.ocupadas / max) * 100}%` }} />
                    </div>
                    <span className="text-[9px] text-muted-foreground">{h.hora.slice(0, 2)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {!u.cadeiras_definidas && isAdmin && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Contamos 1 {nomePosto(seg.chave).toLowerCase()} por {seg.termos.profissional.toLowerCase()}. Informe o número real em <Link to="/unidades" className="font-semibold underline">{seg.termos.unidades}</Link>.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-2", destaque && "border-[#ff7a00]/50 bg-[#ff7a00]/5")}>
      <p className="num text-2xl font-bold">{valor}</p>
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
    </div>
  );
}
