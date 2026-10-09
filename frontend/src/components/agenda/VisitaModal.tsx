import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiDelete, apiPatch, apiPost, detalheErro } from "@/lib/api";
import type { Imovel, Lead, Pessoa, Visita, VisitaStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SEM = "__sem__";

export const STATUS_VISITA_LABEL: Record<VisitaStatus, string> = {
  agendada: "Agendada",
  realizada: "Realizada",
  cancelada: "Cancelada",
};

interface FormState {
  titulo: string;
  data: string;
  hora: string;
  duracao_min: string;
  lead_id: string;
  cliente_id: string;
  imovel_id: string;
  corretor_id: string;
  local: string;
  observacoes: string;
  feedback_proprietario: string;
  status: VisitaStatus;
}

function vazio(data: string): FormState {
  return {
    titulo: "",
    data,
    hora: "09:00",
    duracao_min: "60",
    lead_id: SEM,
    cliente_id: SEM,
    imovel_id: SEM,
    corretor_id: SEM,
    local: "",
    observacoes: "",
    feedback_proprietario: "",
    status: "agendada",
  };
}

export default function VisitaModal({
  open,
  onClose,
  visita,
  dataPadrao,
  leads,
  imoveis,
  pessoas,
  isAdmin,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  visita: Visita | null;
  dataPadrao: string;
  leads: Lead[];
  imoveis: Imovel[];
  pessoas: Pessoa[];
  isAdmin: boolean;
  /** Pré-preenchimento ao agendar a partir de um negócio. */
  preset?: { titulo?: string; lead_id?: string | null; cliente_id?: string | null; imovel_id?: string | null; corretor_id?: string | null; hora?: string };
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(vazio(dataPadrao));
  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    if (visita) {
      setForm({
        titulo: visita.titulo,
        data: visita.data,
        hora: visita.hora,
        duracao_min: String(visita.duracao_min),
        lead_id: visita.lead_id ?? SEM,
        cliente_id: visita.cliente_id ?? SEM,
        imovel_id: visita.imovel_id ?? SEM,
        corretor_id: visita.corretor_id ?? SEM,
        local: visita.local ?? "",
        observacoes: visita.observacoes ?? "",
        feedback_proprietario: visita.feedback_proprietario ?? "",
        status: visita.status,
      });
    } else {
      const base = vazio(dataPadrao);
      setForm({
        ...base,
        titulo: preset?.titulo ?? base.titulo,
        hora: preset?.hora ?? base.hora,
        lead_id: preset?.lead_id ?? SEM,
        cliente_id: preset?.cliente_id ?? SEM,
        imovel_id: preset?.imovel_id ?? SEM,
        corretor_id: preset?.corretor_id ?? SEM,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, visita, dataPadrao]);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["visitas"] });
    qc.invalidateQueries({ queryKey: ["aviso-visitas"] });
    qc.invalidateQueries({ queryKey: ["equipe"] });
  };

  const salvar = useMutation({
    mutationFn: () => {
      const body = {
        titulo: form.titulo.trim(),
        data: form.data,
        hora: form.hora,
        duracao_min: Number(form.duracao_min) || 60,
        lead_id: form.lead_id === SEM ? null : form.lead_id,
        cliente_id: form.cliente_id === SEM ? null : form.cliente_id,
        imovel_id: form.imovel_id === SEM ? null : form.imovel_id,
        corretor_id: form.corretor_id === SEM ? null : form.corretor_id,
        local: form.local.trim() || null,
        observacoes: form.observacoes.trim() || null,
        feedback_proprietario: form.feedback_proprietario.trim() || null,
        status: form.status,
      };
      return visita
        ? apiPatch<Visita>(`/visitas/${visita.id}`, body)
        : apiPost<Visita>("/visitas", body);
    },
    onSuccess: () => {
      invalidar();
      toast.success(visita ? "Visita atualizada." : "Visita agendada!");
      onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar a visita."),
  });

  const excluir = useMutation({
    mutationFn: () => apiDelete<void>(`/visitas/${visita!.id}`),
    onSuccess: () => {
      invalidar();
      toast.success("Visita removida da agenda.");
      onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível remover a visita."),
  });

  const submeter = () => {
    if (!form.titulo.trim()) return toast.error("Informe o título da visita.");
    if (!form.data) return toast.error("Informe a data da visita.");
    salvar.mutate();
  };

  const corretores = pessoas.filter((p) => p.papeis.includes("corretor"));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{visita ? "Editar visita" : "Agendar visita"}</DialogTitle>
          <DialogDescription>
            A visita liga um lead e um imóvel ao corretor responsável. O aviso é enviado no dia
            anterior.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="visita-titulo">Título *</Label>
            <Input
              id="visita-titulo"
              value={form.titulo}
              onChange={(e) => set("titulo", e.target.value)}
              placeholder="Ex.: Visita — Fernanda Rocha"
              data-testid="visita-titulo-input"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="visita-data">Data *</Label>
              <Input
                id="visita-data"
                type="date"
                value={form.data}
                onChange={(e) => set("data", e.target.value)}
                data-testid="visita-data-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="visita-hora">Hora</Label>
              <Input
                id="visita-hora"
                type="time"
                value={form.hora}
                onChange={(e) => set("hora", e.target.value)}
                data-testid="visita-hora-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="visita-duracao">Duração (min)</Label>
              <Input
                id="visita-duracao"
                inputMode="numeric"
                value={form.duracao_min}
                onChange={(e) => set("duracao_min", e.target.value)}
                data-testid="visita-duracao-input"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Lead relacionado</Label>
            <Select value={form.lead_id} onValueChange={(v) => set("lead_id", v)}>
              <SelectTrigger data-testid="visita-lead-select">
                <SelectValue>
                  {form.lead_id === SEM
                    ? "Sem lead vinculado"
                    : (leads.find((l) => l.id === form.lead_id)?.nome ?? "Lead")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Sem lead vinculado</SelectItem>
                {leads.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Cliente (recebe a confirmação por e-mail na véspera)</Label>
            <Select value={form.cliente_id} onValueChange={(v) => set("cliente_id", v)}>
              <SelectTrigger data-testid="visita-cliente-select">
                <SelectValue>
                  {form.cliente_id === SEM
                    ? "Sem cliente vinculado"
                    : (pessoas.find((p) => p.id === form.cliente_id)?.nome ?? "Cliente")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Sem cliente vinculado</SelectItem>
                {pessoas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome}
                    {p.email ? ` · ${p.email}` : " · sem e-mail"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Imóvel</Label>
            <Select value={form.imovel_id} onValueChange={(v) => set("imovel_id", v)}>
              <SelectTrigger data-testid="visita-imovel-select">
                <SelectValue>
                  {form.imovel_id === SEM
                    ? "Sem imóvel específico"
                    : (imoveis.find((i) => i.id === form.imovel_id)?.titulo ?? "Imóvel")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Sem imóvel específico</SelectItem>
                {imoveis.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.titulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isAdmin && (
            <div className="grid gap-2">
              <Label>Corretor responsável</Label>
              <Select value={form.corretor_id} onValueChange={(v) => set("corretor_id", v)}>
                <SelectTrigger data-testid="visita-corretor-select">
                  <SelectValue>
                    {form.corretor_id === SEM
                      ? "Sem corretor"
                      : (corretores.find((p) => p.id === form.corretor_id)?.nome ?? "Corretor")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM}>Sem corretor</SelectItem>
                  {corretores.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="visita-local">Ponto de encontro</Label>
              <Input
                id="visita-local"
                value={form.local}
                onChange={(e) => set("local", e.target.value)}
                placeholder="Ex.: portaria do edifício"
                data-testid="visita-local-input"
              />
            </div>
            <div className="grid gap-2">
              <Label>Situação</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as VisitaStatus)}>
                <SelectTrigger data-testid="visita-status-select">
                  <SelectValue>{STATUS_VISITA_LABEL[form.status]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_VISITA_LABEL) as VisitaStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_VISITA_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="visita-obs">Observações</Label>
            <Textarea
              id="visita-obs"
              rows={2}
              value={form.observacoes}
              onChange={(e) => set("observacoes", e.target.value)}
              data-testid="visita-obs-input"
            />
          </div>

          {form.imovel_id !== SEM && (form.status === "realizada" || !!visita) && (
            <div className="grid gap-2">
              <Label htmlFor="visita-retorno">Retorno para o proprietário</Label>
              <Textarea
                id="visita-retorno"
                rows={2}
                value={form.feedback_proprietario}
                onChange={(e) => set("feedback_proprietario", e.target.value)}
                placeholder="Ex.: gostou da planta, achou o valor alto para o andar. Aparece no relatório do proprietário, sem o nome do cliente."
              />
            </div>
          )}
        </div>

        <DialogFooter>
          {visita && (
            <Button
              variant="destructive"
              onClick={() => excluir.mutate()}
              disabled={excluir.isPending}
              data-testid="visita-delete-button"
              className="mr-auto"
            >
              Excluir
            </Button>
          )}
          <Button variant="outline" type="button" onClick={onClose} data-testid="visita-cancel-button">
            Cancelar
          </Button>
          <Button onClick={submeter} disabled={salvar.isPending} data-testid="visita-submit-button">
            {salvar.isPending ? "Salvando..." : visita ? "Salvar alterações" : "Agendar visita"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
