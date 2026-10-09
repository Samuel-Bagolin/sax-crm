import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Loader2, User } from "lucide-react";
import { apiPost, apiPut, detalheErro } from "@/lib/api";
import type { DadosPessoa, Pessoa } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Form = Required<{ [K in keyof DadosPessoa]: K extends "papeis" ? string[] : string }>;

const VAZIO: Form = {
  nome: "", papeis: ["proprietario"], tipo_pessoa: "pf", cpf_cnpj: "", telefone: "", telefone2: "", email: "",
  rg: "", data_nascimento: "", estado_civil: "", profissao: "", nacionalidade: "",
  nome_fantasia: "", inscricao_estadual: "", responsavel_nome: "", responsavel_cpf: "",
  cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "",
  banco: "", agencia: "", conta: "", tipo_conta: "", pix: "", observacoes: "",
};

const digitos = (v: string) => v.replace(/\D/g, "");

function mascaraDocumento(v: string, pj: boolean): string {
  const d = digitos(v).slice(0, pj ? 14 : 11);
  if (pj) return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function mascaraTelefone(v: string): string {
  const d = digitos(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

function Campo({ id, rotulo, children, className }: { id?: string; rotulo: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4 border-t pt-4 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full text-sm font-semibold">{titulo}</legend>
      {children}
    </fieldset>
  );
}

/** Cadastro e edição de proprietário (pessoa física ou jurídica). `onSalvo` devolve o registro salvo. */
export default function ProprietarioForm({
  open,
  onClose,
  pessoa,
  onSalvo,
  nomeInicial,
}: {
  open: boolean;
  onClose: () => void;
  pessoa?: Pessoa | null;
  onSalvo?: (p: Pessoa) => void;
  nomeInicial?: string;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(VAZIO);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const pj = f.tipo_pessoa === "pj";
  const set = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!open) return;
    if (pessoa) {
      const base = { ...VAZIO };
      (Object.keys(VAZIO) as (keyof Form)[]).forEach((k) => {
        const v = (pessoa as unknown as Record<string, unknown>)[k];
        if (k === "papeis") base.papeis = (pessoa.papeis as string[]) ?? ["proprietario"];
        else if (v != null) (base as Record<string, unknown>)[k] = String(v);
      });
      if (!base.tipo_pessoa) base.tipo_pessoa = "pf";
      setF(base);
    } else setF({ ...VAZIO, nome: nomeInicial ?? "" });
  }, [open, pessoa, nomeInicial]);

  const buscarCep = async () => {
    const cep = digitos(f.cep);
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = await r.json();
      if (d && !d.erro) {
        setF((x) => ({
          ...x,
          logradouro: x.logradouro || d.logradouro || "",
          bairro: x.bairro || d.bairro || "",
          cidade: x.cidade || d.localidade || "",
          estado: x.estado || d.uf || "",
        }));
      }
    } catch {
      /* sem internet para o ViaCEP: o usuário preenche à mão */
    } finally {
      setBuscandoCep(false);
    }
  };

  const salvar = useMutation({
    mutationFn: () => {
      const corpo: Record<string, unknown> = {};
      (Object.keys(VAZIO) as (keyof Form)[]).forEach((k) => {
        const v = f[k];
        corpo[k] = Array.isArray(v) ? v : typeof v === "string" && v.trim() ? v.trim() : null;
      });
      corpo.tipo_pessoa = f.tipo_pessoa;
      corpo.papeis = Array.from(new Set([...(f.papeis ?? []), "proprietario"]));
      return pessoa ? apiPut<Pessoa>(`/pessoas/${pessoa.id}`, corpo) : apiPost<Pessoa>("/proprietarios", corpo);
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["proprietarios"] });
      qc.invalidateQueries({ queryKey: ["proprietario", p.id] });
      qc.invalidateQueries({ queryKey: ["pessoas"] });
      toast.success(pessoa ? "Proprietário atualizado" : "Proprietário cadastrado");
      onSalvo?.(p);
      onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar o proprietário"),
  });

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (f.nome.trim().length < 2) {
      toast.error(pj ? "Informe a razão social." : "Informe o nome completo.");
      return;
    }
    salvar.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{pessoa ? "Editar proprietário" : "Novo proprietário"}</DialogTitle>
          <DialogDescription>Só o nome é obrigatório. O resto você completa quando tiver.</DialogDescription>
        </DialogHeader>

        <form id="form-proprietario" onSubmit={enviar} className="grid gap-5">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Tipo de pessoa">
            {([
              ["pf", "Pessoa física", User],
              ["pj", "Pessoa jurídica", Building2],
            ] as const).map(([v, rot, Icone]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={f.tipo_pessoa === v}
                onClick={() => setF((x) => ({ ...x, tipo_pessoa: v, cpf_cnpj: "" }))}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition-colors",
                  f.tipo_pessoa === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`proprietario-tipo-${v}`}
              >
                <Icone className="h-4 w-4" /> {rot}
              </button>
            ))}
          </div>

          <Secao titulo="Identificação">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="pr-nome" rotulo={pj ? "Razão social *" : "Nome completo *"} className="sm:col-span-2">
                <Input id="pr-nome" value={f.nome} onChange={(e) => set("nome", e.target.value)} autoFocus data-testid="proprietario-nome" />
              </Campo>
              <Campo id="pr-doc" rotulo={pj ? "CNPJ" : "CPF"}>
                <Input
                  id="pr-doc"
                  inputMode="numeric"
                  value={f.cpf_cnpj}
                  onChange={(e) => set("cpf_cnpj", mascaraDocumento(e.target.value, pj))}
                  placeholder={pj ? "00.000.000/0000-00" : "000.000.000-00"}
                  data-testid="proprietario-documento"
                />
              </Campo>
              {pj ? (
                <>
                  <Campo id="pr-fantasia" rotulo="Nome fantasia">
                    <Input id="pr-fantasia" value={f.nome_fantasia} onChange={(e) => set("nome_fantasia", e.target.value)} />
                  </Campo>
                  <Campo id="pr-ie" rotulo="Inscrição estadual">
                    <Input id="pr-ie" value={f.inscricao_estadual} onChange={(e) => set("inscricao_estadual", e.target.value)} />
                  </Campo>
                  <Campo id="pr-resp" rotulo="Responsável legal">
                    <Input id="pr-resp" value={f.responsavel_nome} onChange={(e) => set("responsavel_nome", e.target.value)} />
                  </Campo>
                  <Campo id="pr-resp-cpf" rotulo="CPF do responsável">
                    <Input id="pr-resp-cpf" inputMode="numeric" value={f.responsavel_cpf} onChange={(e) => set("responsavel_cpf", mascaraDocumento(e.target.value, false))} />
                  </Campo>
                </>
              ) : (
                <>
                  <Campo id="pr-rg" rotulo="RG">
                    <Input id="pr-rg" value={f.rg} onChange={(e) => set("rg", e.target.value)} />
                  </Campo>
                  <Campo id="pr-nasc" rotulo="Data de nascimento">
                    <Input id="pr-nasc" type="date" value={f.data_nascimento} onChange={(e) => set("data_nascimento", e.target.value)} />
                  </Campo>
                  <Campo id="pr-civil" rotulo="Estado civil">
                    <select
                      id="pr-civil"
                      value={f.estado_civil}
                      onChange={(e) => set("estado_civil", e.target.value)}
                      className="h-9 rounded-md border bg-transparent px-3 text-sm"
                    >
                      <option value="">Selecionar</option>
                      {["Solteiro(a)", "Casado(a)", "União estável", "Divorciado(a)", "Viúvo(a)"].map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </Campo>
                  <Campo id="pr-prof" rotulo="Profissão">
                    <Input id="pr-prof" value={f.profissao} onChange={(e) => set("profissao", e.target.value)} />
                  </Campo>
                  <Campo id="pr-nac" rotulo="Nacionalidade">
                    <Input id="pr-nac" value={f.nacionalidade} onChange={(e) => set("nacionalidade", e.target.value)} placeholder="Brasileira" />
                  </Campo>
                </>
              )}
            </div>
          </Secao>

          <Secao titulo="Contato">
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo id="pr-tel" rotulo="WhatsApp">
                <Input id="pr-tel" inputMode="tel" value={f.telefone} onChange={(e) => set("telefone", mascaraTelefone(e.target.value))} data-testid="proprietario-telefone" />
              </Campo>
              <Campo id="pr-tel2" rotulo="Outro telefone">
                <Input id="pr-tel2" inputMode="tel" value={f.telefone2} onChange={(e) => set("telefone2", mascaraTelefone(e.target.value))} />
              </Campo>
              <Campo id="pr-email" rotulo="E-mail">
                <Input id="pr-email" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
              </Campo>
            </div>
          </Secao>

          <Secao titulo="Endereço">
            <div className="grid gap-4 sm:grid-cols-6">
              <Campo id="pr-cep" rotulo="CEP" className="sm:col-span-2">
                <div className="relative">
                  <Input id="pr-cep" inputMode="numeric" value={f.cep} onChange={(e) => set("cep", digitos(e.target.value).slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2"))} onBlur={buscarCep} />
                  {buscandoCep && <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
              </Campo>
              <Campo id="pr-rua" rotulo="Rua" className="sm:col-span-4">
                <Input id="pr-rua" value={f.logradouro} onChange={(e) => set("logradouro", e.target.value)} />
              </Campo>
              <Campo id="pr-num" rotulo="Número" className="sm:col-span-2">
                <Input id="pr-num" value={f.numero} onChange={(e) => set("numero", e.target.value)} />
              </Campo>
              <Campo id="pr-comp" rotulo="Complemento" className="sm:col-span-4">
                <Input id="pr-comp" value={f.complemento} onChange={(e) => set("complemento", e.target.value)} />
              </Campo>
              <Campo id="pr-bairro" rotulo="Bairro" className="sm:col-span-2">
                <Input id="pr-bairro" value={f.bairro} onChange={(e) => set("bairro", e.target.value)} />
              </Campo>
              <Campo id="pr-cidade" rotulo="Cidade" className="sm:col-span-3">
                <Input id="pr-cidade" value={f.cidade} onChange={(e) => set("cidade", e.target.value)} />
              </Campo>
              <Campo id="pr-uf" rotulo="UF" className="sm:col-span-1">
                <Input id="pr-uf" maxLength={2} value={f.estado} onChange={(e) => set("estado", e.target.value.toUpperCase())} />
              </Campo>
            </div>
          </Secao>

          <Secao titulo="Dados para repasse">
            <div className="grid gap-4 sm:grid-cols-4">
              <Campo id="pr-banco" rotulo="Banco" className="sm:col-span-2">
                <Input id="pr-banco" value={f.banco} onChange={(e) => set("banco", e.target.value)} />
              </Campo>
              <Campo id="pr-ag" rotulo="Agência">
                <Input id="pr-ag" value={f.agencia} onChange={(e) => set("agencia", e.target.value)} />
              </Campo>
              <Campo id="pr-conta" rotulo="Conta">
                <Input id="pr-conta" value={f.conta} onChange={(e) => set("conta", e.target.value)} />
              </Campo>
              <Campo id="pr-tipo-conta" rotulo="Tipo de conta">
                <select id="pr-tipo-conta" value={f.tipo_conta} onChange={(e) => set("tipo_conta", e.target.value)} className="h-9 rounded-md border bg-transparent px-3 text-sm">
                  <option value="">Selecionar</option>
                  <option value="corrente">Corrente</option>
                  <option value="poupanca">Poupança</option>
                </select>
              </Campo>
              <Campo id="pr-pix" rotulo="Chave Pix" className="sm:col-span-3">
                <Input id="pr-pix" value={f.pix} onChange={(e) => set("pix", e.target.value)} />
              </Campo>
            </div>
          </Secao>

          <Secao titulo="Observações">
            <Textarea id="pr-obs" rows={3} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} aria-label="Observações" />
          </Secao>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="form-proprietario" disabled={salvar.isPending} data-testid="proprietario-salvar">
            {salvar.isPending ? "Salvando..." : pessoa ? "Salvar alterações" : "Cadastrar proprietário"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
