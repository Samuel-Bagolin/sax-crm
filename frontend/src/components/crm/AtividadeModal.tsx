import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, detalheErro } from "@/lib/api";
import { TIPOS_ATIVIDADE, isoLocal, useEquipe } from "@/lib/crm";
import { useAuth } from "@/lib/useAuth";
import type { Atividade, NegocioResumo, TipoAtividade } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Combo from "@/components/shared/Combo";
import { cn } from "@/lib/utils";

export interface PadraoAtividade {
  tipo?: TipoAtividade;
  data?: string;
  hora?: string | null;
  negocio_id?: string | null;
  corretor_id?: string | null;
  assunto?: string;
}

const DURACOES = [15, 30, 45, 60, 90, 120];

export default function AtividadeModal({
  open,
  onClose,
  atividade,
  padrao,
  travarNegocio = false,
}: {
  open: boolean;
  onClose: () => void;
  atividade?: Atividade | null;
  padrao?: PadraoAtividade;
  travarNegocio?: boolean;
}) {
  const qc = useQueryClient();
  const { isAdmin, principal } = useAuth();
  const { data: equipe = [] } = useEquipe();
  const { data: negocios = [] } = useQuery({
    queryKey: ["kanban", "abertos-todos"],
    queryFn: () => apiGet<NegocioResumo[]>("/leads/kanban?status=aberto"),
    enabled: open && !travarNegocio,
  });

  const [tipo, setTipo] = useState<TipoAtividade>("ligacao");
  const [assunto, setAssunto] = useState("");
  const [assuntoTocado, setAssuntoTocado] = useState(false);
  const [data, setData] = useState(isoLocal(new Date()));
  const [hora, setHora] = useState("");
  const [duracao, setDuracao] = useState(30);
  const [negocioId, setNegocioId] = useState<string | null>(null);
  const [corretorId, setCorretorId] = useState<string | null>(null);
  const [notas, setNotas] = useState("");
  const [concluida, setConcluida] = useState(false);

  const estavaAberto = useRef(false);
  useEffect(() => {
    if (!open) {
      estavaAberto.current = false;
      return;
    }
    if (estavaAberto.current) return; // inicializa só na abertura (padrao pode mudar de referência)
    estavaAberto.current = true;
    if (atividade) {
      setTipo(atividade.tipo);
      setAssunto(atividade.assunto);
      setAssuntoTocado(true);
      setData(atividade.data);
      setHora(atividade.hora ?? "");
      setDuracao(atividade.duracao_min);
      setNegocioId(atividade.negocio_id);
      setCorretorId(atividade.corretor_id);
      setNotas(atividade.notas ?? "");
      setConcluida(atividade.concluida);
    } else {
      setTipo(padrao?.tipo ?? "ligacao");
      setAssunto(padrao?.assunto ?? "");
      setAssuntoTocado(!!padrao?.assunto);
      setData(padrao?.data ?? isoLocal(new Date()));
      setHora(padrao?.hora ?? "");
      setDuracao(30);
      setNegocioId(padrao?.negocio_id ?? null);
      setCorretorId(padrao?.corretor_id ?? principal?.pessoa_id ?? null);
      setNotas("");
      setConcluida(false);
    }
  }, [open, atividade, padrao, principal?.pessoa_id]);

  const rotuloTipo = TIPOS_ATIVIDADE.find((t) => t.tipo === tipo)?.label ?? "";
  const assuntoFinal = assunto.trim() || rotuloTipo;

  const opcoesNegocios = useMemo(
    () => negocios.map((n) => ({ valor: n.id, rotulo: n.nome, detalhe: n.cliente_nome })),
    [negocios],
  );

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["atividades"] });
    qc.invalidateQueries({ queryKey: ["kanban"] });
    qc.invalidateQueries({ queryKey: ["negocio"] });
    qc.invalidateQueries({ queryKey: ["historico"] });
    qc.invalidateQueries({ queryKey: ["equipe"] });
  };

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        tipo,
        assunto: assuntoFinal,
        data,
        hora: hora || null,
        duracao_min: duracao,
        negocio_id: negocioId,
        corretor_id: isAdmin ? corretorId : undefined,
        notas: notas.trim() || null,
        concluida,
      };
      return atividade ? apiPatch<Atividade>(`/atividades/${atividade.id}`, corpo) : apiPost<Atividade>("/atividades", corpo);
    },
    onSuccess: () => {
      toast.success(atividade ? "Atividade atualizada" : "Atividade agendada");
      invalidar();
      onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar a atividade"),
  });

  const excluir = useMutation({
    mutationFn: () => apiDelete(`/atividades/${atividade!.id}`),
    onSuccess: () => {
      toast.success("Atividade excluída");
      invalidar();
      onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível excluir"),
  });

  const atalhos = [
    { rotulo: "Hoje", dias: 0 },
    { rotulo: "Amanhã", dias: 1 },
    { rotulo: "Em 3 dias", dias: 3 },
    { rotulo: "Próx. semana", dias: 7 },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{atividade ? "Editar atividade" : "Agendar atividade"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            salvar.mutate();
          }}
        >
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo de atividade">
            {TIPOS_ATIVIDADE.map((t) => (
              <button
                key={t.tipo}
                type="button"
                role="radio"
                aria-checked={tipo === t.tipo}
                onClick={() => {
                  setTipo(t.tipo);
                  if (!assuntoTocado) setAssunto("");
                }}
                className={cn(
                  "flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                  tipo === t.tipo ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
                title={t.label}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="at-assunto">Assunto</Label>
            <Input
              id="at-assunto"
              value={assunto}
              onChange={(e) => {
                setAssunto(e.target.value);
                setAssuntoTocado(true);
              }}
              placeholder={rotuloTipo}
              data-testid="atividade-assunto"
            />
          </div>

          <div className="grid grid-cols-[1fr_auto_auto] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="at-data">Data</Label>
              <Input id="at-data" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="at-hora">Hora</Label>
              <Input id="at-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="w-28" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="at-dur">Duração</Label>
              <select
                id="at-dur"
                value={duracao}
                onChange={(e) => setDuracao(Number(e.target.value))}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
              >
                {DURACOES.map((d) => (
                  <option key={d} value={d}>
                    {d < 60 ? `${d} min` : `${d / 60}h`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="-mt-2 flex flex-wrap gap-1.5">
            {atalhos.map((a) => {
              const d = new Date();
              d.setDate(d.getDate() + a.dias);
              const v = isoLocal(d);
              return (
                <button
                  key={a.rotulo}
                  type="button"
                  onClick={() => setData(v)}
                  className={cn("rounded-full border px-2.5 py-0.5 text-xs", data === v ? "border-primary text-primary" : "text-muted-foreground hover:bg-muted")}
                >
                  {a.rotulo}
                </button>
              );
            })}
          </div>

          {!travarNegocio && (
            <div className="space-y-1.5">
              <Label>Negócio</Label>
              <Combo opcoes={opcoesNegocios} valor={negocioId} onChange={setNegocioId} placeholder="Vincular a um negócio (opcional)" />
            </div>
          )}

          {isAdmin && (
            <div className="space-y-1.5">
              <Label htmlFor="at-resp">Responsável</Label>
              <select
                id="at-resp"
                value={corretorId ?? ""}
                onChange={(e) => setCorretorId(e.target.value || null)}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
              >
                <option value="">Responsável do negócio</option>
                {equipe
                  .filter((m) => m.pessoa_id)
                  .map((m) => (
                    <option key={m.usuario_id} value={m.pessoa_id!}>
                      {m.nome}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="at-notas">Notas</Label>
            <Textarea id="at-notas" rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="O que precisa ser feito ou falado" />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={concluida} onCheckedChange={(v) => setConcluida(!!v)} />
            Marcar como concluída
          </label>

          <DialogFooter className="items-center">
            {atividade && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive"
                onClick={() => excluir.mutate()}
                disabled={excluir.isPending}
              >
                <Trash2 className="h-4 w-4" /> Excluir
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvar.isPending || !data} data-testid="atividade-salvar">
              {salvar.isPending ? "Salvando…" : atividade ? "Salvar" : "Agendar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
