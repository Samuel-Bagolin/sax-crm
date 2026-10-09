import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { apiDelete, detalheErro } from "@/lib/api";
import { PLANO_TIPO } from "@/lib/constants";
import type { PlanoConta } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PlanoContasModal from "@/components/financeiro/PlanoContasModal";
import { cn } from "@/lib/utils";

interface LinhaPlana {
  conta: PlanoConta;
  nivel: number;
  filhos: number;
}

/** Achata a hierarquia em linhas com nível — render iterativo (sem componente recursivo). */
function achatar(contas: PlanoConta[]): LinhaPlana[] {
  const filhosDe = new Map<string, PlanoConta[]>();
  const raizes: PlanoConta[] = [];
  for (const c of contas) {
    if (c.conta_pai_id) {
      const atual = filhosDe.get(c.conta_pai_id) ?? [];
      atual.push(c);
      filhosDe.set(c.conta_pai_id, atual);
    } else {
      raizes.push(c);
    }
  }
  const ordenar = (lista: PlanoConta[]) => [...lista].sort((a, b) => a.codigo.localeCompare(b.codigo));
  const saida: LinhaPlana[] = [];
  const pilha: LinhaPlana[] = ordenar(raizes)
    .reverse()
    .map((conta) => ({ conta, nivel: 0, filhos: (filhosDe.get(conta.id) ?? []).length }));

  while (pilha.length > 0) {
    const linha = pilha.pop()!;
    saida.push(linha);
    const filhos = ordenar(filhosDe.get(linha.conta.id) ?? []);
    for (let i = filhos.length - 1; i >= 0; i--) {
      pilha.push({
        conta: filhos[i],
        nivel: linha.nivel + 1,
        filhos: (filhosDe.get(filhos[i].id) ?? []).length,
      });
    }
  }
  return saida;
}

export default function PlanoContasTab({
  contas,
  carregando,
}: {
  contas: PlanoConta[];
  carregando: boolean;
}) {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ aberto: boolean; conta: PlanoConta | null; pai: string | null }>({
    aberto: false,
    conta: null,
    pai: null,
  });

  const excluirConta = useMutation({
    mutationFn: (id: string) => apiDelete(`/plano-contas/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plano-contas"] });
      toast.success("Conta removida do plano.");
    },
    onError: (e) => toast.error("Não foi possível remover a conta.", { description: detalheErro(e) }),
  });

  const linhas = achatar(contas);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Estrutura hierárquica dinâmica — contas sintéticas agrupam, contas analíticas recebem lançamentos.
        </p>
        <Button onClick={() => setModal({ aberto: true, conta: null, pai: null })} data-testid="btn-new-plano-conta">
          <Plus className="h-4 w-4" /> Nova Conta
        </Button>
      </div>

      <div className="flex flex-col gap-1.5" data-testid="plano-contas-arvore">
        {carregando && <p className="text-sm text-muted-foreground">Carregando plano de contas…</p>}
        {!carregando && linhas.length === 0 && (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nenhuma conta cadastrada — crie a primeira conta raiz.
          </p>
        )}
        {linhas.map(({ conta, nivel, filhos }) => (
          <div
            key={conta.id}
            className="group flex items-center gap-2 rounded-md border px-3 py-2 transition-colors hover:bg-muted/40"
            style={{ marginLeft: nivel * 28 }}
            data-testid={`plano-row-${conta.codigo}`}
          >
            <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{conta.codigo}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{conta.nome}</span>
            {filhos > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {filhos} subconta(s)
              </Badge>
            )}
            <Badge
              variant="outline"
              className={cn(
                conta.tipo === "receita"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                  : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
              )}
            >
              {PLANO_TIPO[conta.tipo]}
            </Badge>
            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon-xs"
                title="Adicionar subconta"
                onClick={() => setModal({ aberto: true, conta: null, pai: conta.id })}
                data-testid={`plano-add-child-${conta.codigo}`}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                title="Editar"
                onClick={() => setModal({ aberto: true, conta, pai: null })}
                data-testid={`plano-edit-${conta.codigo}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                title="Excluir"
                onClick={() => excluirConta.mutate(conta.id)}
                data-testid={`plano-del-${conta.codigo}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <PlanoContasModal
        open={modal.aberto}
        onClose={() => setModal({ aberto: false, conta: null, pai: null })}
        conta={modal.conta}
        contas={contas}
        paiInicial={modal.pai}
      />
    </div>
  );
}
