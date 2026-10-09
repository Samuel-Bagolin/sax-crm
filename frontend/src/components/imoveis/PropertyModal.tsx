import { parseNumber as num } from "@/lib/numbers";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost, apiPut, detalheErro } from "@/lib/api";
import { usePlano } from "@/lib/diferenciais";
import type { Imovel, ImovelFinalidade, ImovelStatus, ImovelTipo, Pessoa } from "@/lib/types";
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
import { IMOVEL_FINALIDADE, IMOVEL_STATUS, IMOVEL_TIPO } from "@/lib/constants";

const NOVO_PROP = "__novo__";

interface FormState {
  titulo: string;
  tipo: ImovelTipo;
  finalidade: ImovelFinalidade;
  status: ImovelStatus;
  endereco: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  area_util: string;
  area_total: string;
  quartos: string;
  suites: string;
  vagas: string;
  valor_venda: string;
  valor_aluguel: string;
  iptu: string;
  condominio: string;
  proprietario_id: string;
  descricao: string;
  foto_url: string;
  banheiros: string;
  publicar_portais: boolean;
  destaque_portal: "STANDARD" | "PREMIUM" | "SUPER_PREMIUM";
  novoProprietario: boolean;
  novoNome: string;
  novoTelefone: string;
  novoEmail: string;
}

const VAZIO: FormState = {
  titulo: "",
  tipo: "apartamento",
  finalidade: "venda",
  status: "captado",
  endereco: "",
  bairro: "",
  cidade: "",
  estado: "SP",
  cep: "",
  area_util: "",
  area_total: "",
  quartos: "0",
  suites: "0",
  vagas: "0",
  valor_venda: "",
  valor_aluguel: "",
  iptu: "",
  condominio: "",
  proprietario_id: "",
  descricao: "",
  foto_url: "",
  banheiros: "0",
  publicar_portais: false,
  destaque_portal: "STANDARD",
  novoProprietario: false,
  novoNome: "",
  novoTelefone: "",
  novoEmail: "",
};



function inteiro(s: string): number {
  const v = parseInt(s, 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export default function PropertyModal({
  open,
  onClose,
  imovel,
  pessoas,
}: {
  open: boolean;
  onClose: () => void;
  imovel: Imovel | null;
  pessoas: Pessoa[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(VAZIO);
  const { tem } = usePlano();
  const capaDaGaleria = form.foto_url.startsWith("/api/publico/foto/");
  const set = (k: keyof FormState, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    if (imovel) {
      setForm({
        titulo: imovel.titulo,
        tipo: imovel.tipo,
        finalidade: imovel.finalidade,
        status: imovel.status,
        endereco: imovel.endereco,
        bairro: imovel.bairro ?? "",
        cidade: imovel.cidade,
        estado: imovel.estado ?? "",
        cep: imovel.cep ?? "",
        area_util: imovel.area_util?.toString() ?? "",
        area_total: imovel.area_total?.toString() ?? "",
        quartos: String(imovel.quartos),
        suites: String(imovel.suites),
        vagas: String(imovel.vagas),
        valor_venda: imovel.valor_venda?.toString() ?? "",
        valor_aluguel: imovel.valor_aluguel?.toString() ?? "",
        iptu: imovel.iptu?.toString() ?? "",
        condominio: imovel.condominio?.toString() ?? "",
        proprietario_id: imovel.proprietario_id ?? "",
        descricao: imovel.descricao ?? "",
        foto_url: imovel.foto_url ?? "",
        banheiros: String(imovel.banheiros ?? 0),
        publicar_portais: !!imovel.publicar_portais,
        destaque_portal: imovel.destaque_portal ?? "STANDARD",
        novoProprietario: false,
        novoNome: "",
        novoTelefone: "",
        novoEmail: "",
      });
    } else {
      setForm(VAZIO);
    }
  }, [open, imovel]);

  const salvar = useMutation({
    mutationFn: async () => {
      let proprietarioId: string | null = form.proprietario_id || null;
      if (form.novoProprietario) {
        const pessoa = await apiPost<Pessoa>("/pessoas", {
          nome: form.novoNome.trim(),
          papeis: ["proprietario"],
          cpf_cnpj: null,
          telefone: form.novoTelefone.trim() || null,
          email: form.novoEmail.trim() || null,
        });
        proprietarioId = pessoa.id;
      }
      const body = {
        titulo: form.titulo.trim(),
        tipo: form.tipo,
        finalidade: form.finalidade,
        status: form.status,
        endereco: form.endereco.trim(),
        bairro: form.bairro.trim() || null,
        cidade: form.cidade.trim(),
        estado: form.estado.trim() || null,
        cep: form.cep.trim() || null,
        area_util: num(form.area_util),
        area_total: num(form.area_total),
        quartos: inteiro(form.quartos),
        suites: inteiro(form.suites),
        vagas: inteiro(form.vagas),
        valor_venda: num(form.valor_venda),
        valor_aluguel: num(form.valor_aluguel),
        iptu: num(form.iptu),
        condominio: num(form.condominio),
        proprietario_id: proprietarioId,
        descricao: form.descricao.trim() || null,
        foto_url: form.foto_url.trim() || null,
        banheiros: inteiro(form.banheiros),
        publicar_portais: form.publicar_portais,
        destaque_portal: form.destaque_portal,
      };
      return imovel
        ? apiPut<Imovel>(`/imoveis/${imovel.id}`, body)
        : apiPost<Imovel>("/imoveis", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["imoveis"] });
      qc.invalidateQueries({ queryKey: ["imovel"] });
      toast.success(imovel ? "Imóvel atualizado com sucesso!" : "Imóvel cadastrado com sucesso!");
      onClose();
    },
    onError: (erro) => {
      toast.error("Não foi possível salvar o imóvel.", {
        description: detalheErro(erro) ?? (erro instanceof Error ? erro.message : undefined),
      });
    },
  });

  const submeter = () => {
    if (!form.titulo.trim() || !form.endereco.trim() || !form.cidade.trim()) {
      toast.error("Preencha título, endereço e cidade.");
      return;
    }
    if (form.novoProprietario && !form.novoNome.trim()) {
      toast.error("Informe o nome do novo proprietário.");
      return;
    }
    salvar.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{imovel ? "Editar imóvel" : "Novo imóvel"}</DialogTitle>
          <DialogDescription>
            O imóvel é o centro de custo/receita — leads, contratos e lançamentos se ligam a ele.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="titulo">Título *</Label>
            <Input
              id="titulo"
              value={form.titulo}
              onChange={(e) => set("titulo", e.target.value)}
              placeholder="Ex.: Apartamento 3 quartos Vila Mariana"
              data-testid="imovel-titulo-input"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => set("tipo", v)}>
                <SelectTrigger data-testid="imovel-tipo-select">
                  <SelectValue>{IMOVEL_TIPO[form.tipo]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(IMOVEL_TIPO) as ImovelTipo[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {IMOVEL_TIPO[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Finalidade</Label>
              <Select value={form.finalidade} onValueChange={(v) => set("finalidade", v)}>
                <SelectTrigger data-testid="imovel-finalidade-select">
                  <SelectValue>{IMOVEL_FINALIDADE[form.finalidade]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(IMOVEL_FINALIDADE) as ImovelFinalidade[]).map((f) => (
                    <SelectItem key={f} value={f}>
                      {IMOVEL_FINALIDADE[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger data-testid="imovel-status-select">
                  <SelectValue>{IMOVEL_STATUS[form.status].label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(IMOVEL_STATUS) as ImovelStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {IMOVEL_STATUS[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="endereco">Endereço *</Label>
            <Input
              id="endereco"
              value={form.endereco}
              onChange={(e) => set("endereco", e.target.value)}
              placeholder="Rua, número, complemento"
              data-testid="imovel-endereco-input"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="bairro">Bairro</Label>
              <Input
                id="bairro"
                value={form.bairro}
                onChange={(e) => set("bairro", e.target.value)}
                data-testid="imovel-bairro-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cidade">Cidade *</Label>
              <Input
                id="cidade"
                value={form.cidade}
                onChange={(e) => set("cidade", e.target.value)}
                data-testid="imovel-cidade-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="estado">UF</Label>
              <Input
                id="estado"
                value={form.estado}
                maxLength={2}
                onChange={(e) => set("estado", e.target.value.toUpperCase())}
                data-testid="imovel-estado-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cep">CEP</Label>
              <Input
                id="cep"
                value={form.cep}
                onChange={(e) => set("cep", e.target.value)}
                data-testid="imovel-cep-input"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
            <div className="grid gap-2">
              <Label htmlFor="area_util">Área útil (m²)</Label>
              <Input id="area_util" inputMode="decimal" value={form.area_util} onChange={(e) => set("area_util", e.target.value)} data-testid="imovel-area-util-input" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="area_total">Área total (m²)</Label>
              <Input id="area_total" inputMode="decimal" value={form.area_total} onChange={(e) => set("area_total", e.target.value)} data-testid="imovel-area-total-input" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quartos">Quartos</Label>
              <Input id="quartos" inputMode="numeric" value={form.quartos} onChange={(e) => set("quartos", e.target.value)} data-testid="imovel-quartos-input" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="suites">Suítes</Label>
              <Input id="suites" inputMode="numeric" value={form.suites} onChange={(e) => set("suites", e.target.value)} data-testid="imovel-suites-input" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="banheiros">Banheiros</Label>
              <Input id="banheiros" inputMode="numeric" value={form.banheiros} onChange={(e) => set("banheiros", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vagas">Vagas</Label>
              <Input id="vagas" inputMode="numeric" value={form.vagas} onChange={(e) => set("vagas", e.target.value)} data-testid="imovel-vagas-input" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="valor_venda">Valor de venda (R$)</Label>
              <Input
                id="valor_venda"
                inputMode="decimal"
                value={form.valor_venda}
                onChange={(e) => set("valor_venda", e.target.value)}
                data-testid="imovel-price-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="valor_aluguel">Aluguel (R$)</Label>
              <Input id="valor_aluguel" inputMode="decimal" value={form.valor_aluguel} onChange={(e) => set("valor_aluguel", e.target.value)} data-testid="imovel-aluguel-input" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="iptu">IPTU mensal (R$)</Label>
              <Input id="iptu" inputMode="decimal" value={form.iptu} onChange={(e) => set("iptu", e.target.value)} data-testid="imovel-iptu-input" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="condominio">Condomínio (R$)</Label>
              <Input id="condominio" inputMode="decimal" value={form.condominio} onChange={(e) => set("condominio", e.target.value)} data-testid="imovel-condominio-input" />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Proprietário</Label>
            {!form.novoProprietario ? (
              <Select
                value={form.proprietario_id || "__sem__"}
                onValueChange={(v) => set("proprietario_id", v === "__sem__" ? "" : v)}
              >
                <SelectTrigger data-testid="imovel-proprietario-select">
                  <SelectValue>
                    {form.proprietario_id
                      ? (pessoas.find((p) => p.id === form.proprietario_id)?.nome ?? "Proprietário")
                      : "Sem proprietário / selecionar"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__sem__">Sem proprietário</SelectItem>
                  {pessoas
                    .filter((p) => p.papeis.includes("proprietario"))
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nome}
                      </SelectItem>
                    ))}
                  <SelectItem value={NOVO_PROP}>+ Cadastrar novo proprietário</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-3">
                <Input
                  placeholder="Nome do proprietário *"
                  value={form.novoNome}
                  onChange={(e) => set("novoNome", e.target.value)}
                  data-testid="imovel-owner-name-input"
                />
                <Input
                  placeholder="Telefone / WhatsApp"
                  value={form.novoTelefone}
                  onChange={(e) => set("novoTelefone", e.target.value)}
                />
                <Input
                  placeholder="E-mail"
                  value={form.novoEmail}
                  onChange={(e) => set("novoEmail", e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="foto_url">Foto de capa</Label>
              {capaDaGaleria ? (
                <p className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">Definida pela galeria de fotos</p>
              ) : (
                <Input id="foto_url" value={form.foto_url} onChange={(e) => set("foto_url", e.target.value)} placeholder="Envie as fotos pela ficha do imóvel ou cole um link" data-testid="imovel-foto-input" />
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="descricao">Descrição</Label>
              <Textarea
                id="descricao"
                rows={2}
                value={form.descricao}
                onChange={(e) => set("descricao", e.target.value)}
                data-testid="imovel-descricao-input"
              />
            </div>
          </div>

          {tem("portais") && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <label className="flex min-w-0 flex-1 items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={form.publicar_portais}
                  onChange={(e) => set("publicar_portais", e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                  data-testid="imovel-portais"
                />
                <span>
                  <span className="font-medium">Publicar nos portais</span>
                  <span className="block text-xs text-muted-foreground">ZAP Imóveis, VivaReal e OLX, pelo feed configurado em Configurar CRM.</span>
                </span>
              </label>
              {form.publicar_portais && (
                <Select value={form.destaque_portal} onValueChange={(v) => set("destaque_portal", v as string)}>
                  <SelectTrigger className="w-44" aria-label="Destaque no portal">
                    <SelectValue>{{ STANDARD: "Padrão", PREMIUM: "Destaque", SUPER_PREMIUM: "Super destaque" }[form.destaque_portal]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STANDARD">Padrão</SelectItem>
                    <SelectItem value="PREMIUM">Destaque</SelectItem>
                    <SelectItem value="SUPER_PREMIUM">Super destaque</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} type="button">
            Cancelar
          </Button>
          <Button onClick={submeter} disabled={salvar.isPending} data-testid="property-submit-button">
            {salvar.isPending ? "Salvando..." : imovel ? "Salvar alterações" : "Cadastrar imóvel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
