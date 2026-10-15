import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import { apiPost, detalheErro } from "@/lib/api";
import { useCrmConfig } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Funil } from "@/lib/types";
import { SelectTemperatura, type Temperatura } from "@/components/crm/Temperatura";

/* Alteração em massa na lista de negócios (todos os segmentos). O servidor confere cada negócio:
   o que estiver fora da regra volta com o motivo e não trava os demais. */

type Acao = "responsavel" | "etapa" | "supervisao" | "temperatura" | "etiqueta" | "perdido" | "reabrir" | "excluir";
interface Resultado { ok: number; iguais: number; falhas: { id: string; nome: string; motivo: string }[] }

const ROTULO: Record<Acao, string> = {
  responsavel: "Trocar responsável", etapa: "Mudar etapa ou funil", supervisao: "Mudar supervisão", temperatura: "Mudar temperatura", etiqueta: "Pôr etiqueta",
  perdido: "Marcar como perdido", reabrir: "Reabrir", excluir: "Excluir",
};

export function EdicaoMassa({ ids, funis, funilAtual, equipe, supervisoes, podeExcluir, onLimpar, onFeito }: {
  ids: string[];
  funis: Funil[];
  funilAtual: Funil | undefined;
  equipe: { pessoa_id: string | null; nome: string }[];
  supervisoes?: { id: string; nome: string }[];
  podeExcluir: boolean;
  onLimpar: () => void;
  onFeito: () => void;
}) {
  const [acao, setAcao] = useState<Acao | null>(null);
  const [falhas, setFalhas] = useState<Resultado["falhas"]>([]);
  if (!ids.length && !falhas.length) return null;
  const acoes: Acao[] = ["responsavel", "etapa", ...(supervisoes?.length ? (["supervisao"] as Acao[]) : []), "temperatura", "etiqueta", "perdido", "reabrir", ...(podeExcluir ? (["excluir"] as Acao[]) : [])];
  return (
    <>
      {ids.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm" data-testid="massa-barra">
          <span className="font-semibold">{ids.length} selecionado(s)</span>
          {acoes.map((a) => (
            <Button key={a} size="sm" variant={a === "excluir" ? "destructive" : "outline"} onClick={() => setAcao(a)} data-testid={`massa-${a}`}>{ROTULO[a]}</Button>
          ))}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onLimpar}><X className="h-4 w-4" /> Limpar seleção</Button>
        </div>
      )}
      {falhas.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="massa-falhas">
          <div className="mb-1 flex items-center justify-between"><b>{falhas.length} negócio(s) não mudaram</b><button onClick={() => setFalhas([])} aria-label="Fechar"><X className="h-4 w-4" /></button></div>
          <ul className="max-h-40 list-disc overflow-y-auto pl-5">{falhas.map((f) => <li key={f.id}><b>{f.nome}</b>: {f.motivo}</li>)}</ul>
        </div>
      )}
      {acao && (
        <MassaDialog acao={acao} ids={ids} funis={funis} funilAtual={funilAtual} equipe={equipe} supervisoes={supervisoes ?? []}
          onClose={() => setAcao(null)}
          onFeito={(r) => { setFalhas(r.falhas); setAcao(null); onFeito(); }} />
      )}
    </>
  );
}

function MassaDialog({ acao, ids, funis, funilAtual, equipe, supervisoes, onClose, onFeito }: {
  acao: Acao; ids: string[]; funis: Funil[]; funilAtual: Funil | undefined; equipe: { pessoa_id: string | null; nome: string }[];
  supervisoes: { id: string; nome: string }[]; onClose: () => void; onFeito: (r: Resultado) => void;
}) {
  const { data: cfg } = useCrmConfig();
  const [corretor, setCorretor] = useState("");
  const [funilId, setFunilId] = useState(funilAtual?.id ?? funis[0]?.id ?? "");
  const [etapaId, setEtapaId] = useState("");
  const [sup, setSup] = useState("");
  const [motivo, setMotivo] = useState("");
  const [etiqueta, setEtiqueta] = useState("");
  const [temp, setTemp] = useState<Temperatura | null>(null);
  const [confirma, setConfirma] = useState("");
  const funil = funis.find((f) => f.id === funilId);
  const enviar = useMutation({
    mutationFn: () => apiPost<Resultado>("/leads/massa", {
      ids, acao, corretor_id: corretor || null, funil_id: funilId || null, etapa_id: etapaId || null, supervisao_id: sup || null,
      motivo: motivo.trim() || null, etiqueta: etiqueta.trim() || null, confirmacao: confirma.trim() || null, temperatura: temp,
    }),
    onSuccess: (r) => {
      const partes = [`${r.ok} alterado(s)`, r.iguais ? `${r.iguais} já estava(m) assim` : "", r.falhas.length ? `${r.falhas.length} fora da regra` : ""].filter(Boolean);
      (r.falhas.length ? toast.warning : toast.success)(partes.join(", "));
      onFeito(r);
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível alterar"),
  });
  const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";
  const valido =
    acao === "responsavel" ? !!corretor :
    acao === "etapa" ? !!etapaId :
    acao === "etiqueta" ? etiqueta.trim().length > 0 :
    acao === "perdido" ? !(cfg?.exige_motivo_perda) || motivo.trim().length > 0 :
    acao === "excluir" ? confirma.trim() === "EXCLUIR" : true;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ROTULO[acao]}: {ids.length} negócio(s)</DialogTitle>
          <DialogDescription>
            {acao === "etapa" ? "Etapa com cadeado nunca é pulada: o negócio sem a evidência fica de fora e aparece na lista de avisos." :
              acao === "excluir" ? "Excluir não tem volta. Negócio com pedido, contrato ou visita não é excluído." :
              "O que estiver fora da sua área ou da regra fica de fora e aparece na lista de avisos."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          {acao === "responsavel" && (
            <select className={sel} value={corretor} onChange={(e) => setCorretor(e.target.value)} aria-label="Responsável" data-testid="massa-responsavel-sel">
              <option value="">Escolha a pessoa</option>
              {equipe.filter((m) => m.pessoa_id).map((m) => <option key={m.pessoa_id!} value={m.pessoa_id!}>{m.nome}</option>)}
            </select>
          )}
          {acao === "etapa" && (
            <>
              <select className={sel} value={funilId} onChange={(e) => { setFunilId(e.target.value); setEtapaId(""); }} aria-label="Funil">
                {funis.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
              <select className={sel} value={etapaId} onChange={(e) => setEtapaId(e.target.value)} aria-label="Etapa" data-testid="massa-etapa-sel">
                <option value="">Escolha a etapa</option>
                {funil?.etapas.map((e) => <option key={e.id} value={e.id}>{e.nome}{e.requisito ? " (exige evidência)" : ""}</option>)}
              </select>
            </>
          )}
          {acao === "supervisao" && (
            <select className={sel} value={sup} onChange={(e) => setSup(e.target.value)} aria-label="Supervisão">
              <option value="">Sem supervisão (todos da praça veem)</option>
              {supervisoes.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          )}
          {acao === "temperatura" && (
            <SelectTemperatura valor={temp} onChange={setTemp} vazio="Tirar a temperatura" className="w-full" data-testid="massa-temperatura-sel" />
          )}
          {acao === "etiqueta" && (
            <>
              <Input list="massa-etiquetas" value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Ex.: Quente" maxLength={40} />
              <datalist id="massa-etiquetas">{(cfg?.etiquetas ?? []).map((t) => <option key={t} value={t} />)}</datalist>
            </>
          )}
          {acao === "perdido" && (
            <>
              <select className={sel} value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo da perda">
                <option value="">{cfg?.exige_motivo_perda ? "Escolha o motivo" : "Sem motivo"}</option>
                {(cfg?.motivos_perda ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </>
          )}
          {acao === "reabrir" && <p className="text-muted-foreground">Os negócios ganhos ou perdidos voltam para a etapa em que estavam.</p>}
          {acao === "excluir" && <Input value={confirma} onChange={(e) => setConfirma(e.target.value)} placeholder="Digite EXCLUIR" data-testid="massa-confirma" />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant={acao === "excluir" ? "destructive" : "default"} disabled={!valido || enviar.isPending} onClick={() => enviar.mutate()} data-testid="massa-aplicar">
            {enviar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
