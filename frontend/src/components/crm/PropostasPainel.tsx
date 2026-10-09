import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowDownRight, Check, FileText, HandCoins, Plus, Reply, Trophy, X } from "lucide-react";
import { apiGet, apiPost, detalheErro } from "@/lib/api";
import { brl, dataBR, dataHoraBR } from "@/lib/format";
import { isoLocal } from "@/lib/crm";
import { FORMAS_PAGAMENTO, STATUS_PROPOSTA, type FormaPagamento, type Proposta } from "@/lib/diferenciais";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Form {
  valor: string;
  formas: FormaPagamento[];
  sinal: string;
  financiado: string;
  validade: string;
  condicoes: string;
  autor: "cliente" | "proprietario";
}

function numero(v: string): number | null {
  const limpo = v.replace(/[^\d,.-]/g, "");
  const n = Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
  return v.trim() && Number.isFinite(n) ? n : null;
}

function emDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return isoLocal(d);
}

/** Propostas e contrapropostas do negócio, em cadeia. */
export default function PropostasPainel({ negocioId, aberto, valorAnunciado }: { negocioId: string; aberto: boolean; valorAnunciado?: number | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dialogo, setDialogo] = useState<{ base: Proposta | null } | null>(null);
  const [f, setF] = useState<Form>({ valor: "", formas: ["avista"], sinal: "", financiado: "", validade: emDias(5), condicoes: "", autor: "cliente" });
  const [resposta, setResposta] = useState<{ p: Proposta; status: "aceita" | "recusada" } | null>(null);
  const [obs, setObs] = useState("");

  const { data: propostas = [] } = useQuery({ queryKey: ["propostas", negocioId], queryFn: () => apiGet<Proposta[]>(`/leads/${negocioId}/propostas`) });
  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ["propostas", negocioId] });
    qc.invalidateQueries({ queryKey: ["negocio", negocioId] });
    qc.invalidateQueries({ queryKey: ["historico", negocioId] });
    qc.invalidateQueries({ queryKey: ["atividades"] });
    qc.invalidateQueries({ queryKey: ["kanban"] });
  };

  const abrir = (base: Proposta | null) => {
    setF({
      valor: base ? String(base.valor) : valorAnunciado ? String(valorAnunciado) : "",
      formas: base?.formas_pagamento ?? ["avista"],
      sinal: base?.sinal ? String(base.sinal) : "",
      financiado: base?.valor_financiado ? String(base.valor_financiado) : "",
      validade: emDias(5),
      condicoes: "",
      autor: base ? (base.autor === "cliente" ? "proprietario" : "cliente") : "cliente",
    });
    setDialogo({ base });
  };

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        valor: numero(f.valor),
        formas_pagamento: f.formas,
        sinal: numero(f.sinal),
        valor_financiado: f.formas.includes("financiamento") ? numero(f.financiado) : null,
        validade: f.validade || null,
        condicoes: f.condicoes.trim() || null,
        autor: f.autor,
      };
      return dialogo?.base ? apiPost<Proposta>(`/propostas/${dialogo.base.id}/contraproposta`, corpo) : apiPost<Proposta>(`/leads/${negocioId}/propostas`, corpo);
    },
    onSuccess: (p) => {
      toast.success(`${p.tipo === "contraproposta" ? "Contraproposta" : "Proposta"} ${p.numero} registrada`);
      setDialogo(null);
      atualizar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível registrar"),
  });
  const responder = useMutation({
    mutationFn: () => apiPost<Proposta>(`/propostas/${resposta!.p.id}/responder`, { status: resposta!.status, observacao: obs.trim() || null }),
    onSuccess: (p) => {
      toast.success(p.status === "aceita" ? "Proposta aceita. O valor do negócio foi atualizado." : "Proposta recusada");
      setResposta(null);
      setObs("");
      atualizar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível responder"),
  });
  const cancelar = useMutation({ mutationFn: (p: Proposta) => apiPost(`/propostas/${p.id}/cancelar`), onSuccess: atualizar });
  const ganhar = useMutation({
    mutationFn: () => apiPost(`/leads/${negocioId}/ganhar`),
    onSuccess: () => {
      atualizar();
      navigate(`/contratos?novo=1&lead=${negocioId}`);
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível marcar como ganho"),
  });

  // Cadeias: raiz (sem pai) seguida das respostas, da mais antiga para a mais nova.
  const porPai = new Map<string | null, Proposta[]>();
  for (const p of [...propostas].reverse()) porPai.set(p.parent_id, [...(porPai.get(p.parent_id) ?? []), p]);
  const cadeias: Proposta[][] = (porPai.get(null) ?? []).map((raiz) => {
    const lista = [raiz];
    let atual = raiz;
    for (;;) {
      const prox = porPai.get(atual.id)?.[0];
      if (!prox) break;
      lista.push(prox);
      atual = prox;
    }
    return lista;
  });
  cadeias.reverse();
  const aceita = propostas.find((p) => p.status === "aceita");

  return (
    <section className="rounded-lg border bg-card" data-testid="propostas">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <h3 className="flex flex-1 items-center gap-1.5 text-sm font-semibold">
          <HandCoins className="h-4 w-4 text-muted-foreground" /> Propostas
          {propostas.length > 0 && <span className="font-normal text-muted-foreground">({propostas.length})</span>}
        </h3>
        {aberto && (
          <Button variant="ghost" size="sm" onClick={() => abrir(null)} data-testid="proposta-nova">
            <Plus className="h-3.5 w-3.5" /> Nova proposta
          </Button>
        )}
      </header>

      {aceita && aberto && (
        <div className="flex flex-wrap items-center gap-3 border-b bg-hoje/10 px-4 py-2.5 text-sm">
          <Check className="h-4 w-4 text-hoje" />
          <span className="flex-1">
            Proposta <strong>{aceita.numero}</strong> aceita por <strong className="num">{brl(aceita.valor)}</strong>. Próximo passo: ganhar o negócio e gerar o contrato.
          </span>
          <Button size="sm" className="bg-hoje text-white hover:bg-hoje/85" onClick={() => ganhar.mutate()} disabled={ganhar.isPending}>
            <Trophy className="h-3.5 w-3.5" /> Ganhar e gerar contrato
          </Button>
        </div>
      )}

      {!cadeias.length ? (
        <p className="px-4 py-5 text-center text-sm text-muted-foreground">
          Registre a proposta do cliente para negociar com o proprietário. O negócio avança para a etapa de proposta e o follow-up é agendado sozinho.
        </p>
      ) : (
        <div className="divide-y">
          {cadeias.map((cadeia) => (
            <ol key={cadeia[0].id} className="space-y-0 px-4 py-3">
              {cadeia.map((p, i) => {
                const st = STATUS_PROPOSTA[p.status];
                return (
                  <li key={p.id} className={cn("relative flex gap-3", i > 0 && "mt-3")}>
                    {i > 0 && <ArrowDownRight className="absolute -left-0.5 -top-3 h-3.5 w-3.5 text-muted-foreground/50" aria-hidden />}
                    <div className={cn("min-w-0 flex-1 rounded-md border p-3", p.autor === "proprietario" ? "ml-6 bg-muted/30" : "bg-card")}>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          {p.numero} · {p.autor === "cliente" ? "Cliente" : "Proprietário"} · {dataHoraBR(p.created_at)}
                        </span>
                        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", st.classe)}>{st.rotulo}</span>
                      </div>
                      <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                        <span className="num text-lg font-bold">{brl(p.valor)}</span>
                        {p.desconto_pct != null && p.desconto_pct !== 0 && (
                          <span className={cn("text-xs font-medium", p.desconto_pct > 0 ? "text-muted-foreground" : "text-hoje")}>
                            {p.desconto_pct > 0 ? `${p.desconto_pct.toLocaleString("pt-BR")}% abaixo` : `${Math.abs(p.desconto_pct).toLocaleString("pt-BR")}% acima`} do anunciado
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.formas_pagamento.map((x) => FORMAS_PAGAMENTO.find((fp) => fp.valor === x)?.rotulo).join(" + ")}
                        {p.sinal ? ` · sinal ${brl(p.sinal)}` : ""}
                        {p.valor_financiado ? ` · financiado ${brl(p.valor_financiado)}` : ""}
                        {p.validade ? ` · válida até ${dataBR(p.validade)}` : ""}
                      </p>
                      {p.condicoes && <p className="mt-1.5 whitespace-pre-wrap text-sm">{p.condicoes}</p>}
                      {p.observacao_resposta && <p className="mt-1.5 text-xs italic text-muted-foreground">Resposta: {p.observacao_resposta}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {p.status === "enviada" && aberto && (
                          <>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setResposta({ p, status: "aceita" })}>
                              <Check className="h-3 w-3" /> Aceita
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => abrir(p)}>
                              <Reply className="h-3 w-3" /> Contraproposta
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setResposta({ p, status: "recusada" })}>
                              <X className="h-3 w-3" /> Recusada
                            </Button>
                          </>
                        )}
                        {p.status === "expirada" && aberto && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => abrir(p)}>
                            <Reply className="h-3 w-3" /> Renovar com contraproposta
                          </Button>
                        )}
                        <a href={`/api/propostas/${p.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium hover:bg-muted">
                          <FileText className="h-3 w-3" /> PDF
                        </a>
                        {p.status === "enviada" && aberto && (
                          <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-destructive" onClick={() => cancelar.mutate(p)}>
                            Cancelar
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          ))}
        </div>
      )}

      <Dialog open={!!dialogo} onOpenChange={(v) => !v && setDialogo(null)}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogo?.base ? `Contraproposta ${f.autor === "proprietario" ? "do proprietário" : "do cliente"}` : "Nova proposta"}</DialogTitle>
            <DialogDescription>
              {dialogo?.base ? `Respondendo a ${dialogo.base.numero} (${brl(dialogo.base.valor)}).` : valorAnunciado ? `Valor anunciado: ${brl(valorAnunciado)}.` : "Registre os termos que o cliente ofereceu."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!dialogo?.base && (
              <div className="flex gap-1 rounded-md bg-muted p-1">
                {(["cliente", "proprietario"] as const).map((a) => (
                  <button key={a} type="button" onClick={() => setF({ ...f, autor: a })} className={cn("h-8 flex-1 rounded text-sm font-medium", f.autor === a ? "bg-card shadow-sm" : "text-muted-foreground")}>
                    {a === "cliente" ? "Do cliente" : "Do proprietário"}
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pr-valor">Valor (R$)</Label>
              <Input id="pr-valor" inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} className="num text-lg font-semibold" autoFocus data-testid="proposta-valor" />
              {valorAnunciado && numero(f.valor) ? (
                <p className="text-xs text-muted-foreground">{(((numero(f.valor) ?? 0) / valorAnunciado - 1) * 100).toFixed(1).replace(".", ",")}% em relação ao anunciado</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Forma de pagamento</span>
              <div className="flex flex-wrap gap-1.5">
                {FORMAS_PAGAMENTO.map((fp) => {
                  const marcado = f.formas.includes(fp.valor);
                  return (
                    <button
                      key={fp.valor}
                      type="button"
                      onClick={() => setF({ ...f, formas: marcado ? (f.formas.length > 1 ? f.formas.filter((x) => x !== fp.valor) : f.formas) : [...f.formas, fp.valor] })}
                      className={cn("h-8 rounded-full border px-3 text-sm", marcado ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted")}
                    >
                      {fp.rotulo}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pr-sinal">Sinal / entrada (R$)</Label>
                <Input id="pr-sinal" inputMode="decimal" value={f.sinal} onChange={(e) => setF({ ...f, sinal: e.target.value })} />
              </div>
              {f.formas.includes("financiamento") && (
                <div className="space-y-1.5">
                  <Label htmlFor="pr-fin">Valor financiado (R$)</Label>
                  <Input id="pr-fin" inputMode="decimal" value={f.financiado} onChange={(e) => setF({ ...f, financiado: e.target.value })} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="pr-validade">Válida até</Label>
                <Input id="pr-validade" type="date" value={f.validade} onChange={(e) => setF({ ...f, validade: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-cond">Condições</Label>
              <Textarea id="pr-cond" rows={3} value={f.condicoes} onChange={(e) => setF({ ...f, condicoes: e.target.value })} placeholder="Sujeito à aprovação do crédito; entrega das chaves em 60 dias; móveis planejados inclusos…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogo(null)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={!numero(f.valor) || salvar.isPending} data-testid="proposta-salvar">
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resposta} onOpenChange={(v) => !v && setResposta(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{resposta?.status === "aceita" ? "Registrar aceite" : "Registrar recusa"}</DialogTitle>
            <DialogDescription>
              {resposta?.p.numero} · {brl(resposta?.p.valor)}
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder={resposta?.status === "aceita" ? "Como foi confirmado? (opcional)" : "Motivo (opcional)"} aria-label="Observação" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResposta(null)}>
              Voltar
            </Button>
            <Button onClick={() => responder.mutate()} disabled={responder.isPending} className={resposta?.status === "aceita" ? "bg-hoje text-white hover:bg-hoje/85" : ""}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
