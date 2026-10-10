import { parseNumber as num } from "@/lib/numbers";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { usePlano } from "@/lib/diferenciais";
import { useAuth } from "@/lib/useAuth";
import SiteStatusPicker from "@/components/site/SiteStatusPicker";
import type { SiteStatus, Imovel, ImovelFinalidade, ImovelStatus, ImovelTipo, Pessoa, ProprietarioResumo } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Combo from "@/components/shared/Combo";
import ProprietarioForm from "@/components/proprietarios/ProprietarioForm";
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

type Aba = "dados" | "local" | "caracteristicas" | "proprietario";

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
  site_status: SiteStatus;
  site_destaque: boolean;
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
  site_status: "inativo",
  site_destaque: false,
};



function inteiro(s: string): number {
  const v = parseInt(s, 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export default function PropertyModal({
  open,
  onClose,
  imovel,
}: {
  open: boolean;
  onClose: () => void;
  imovel: Imovel | null;
  pessoas?: Pessoa[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(VAZIO);
  const { tem } = usePlano();
  const { podeSite } = useAuth();
  const [aba, setAba] = useState<Aba>("dados");
  const [novoDono, setNovoDono] = useState<string | null>(null);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const { data: donos = [] } = useQuery({ queryKey: ["proprietarios"], queryFn: () => apiGet<ProprietarioResumo[]>("/proprietarios"), enabled: open });
  const capaDaGaleria = form.foto_url.startsWith("/api/publico/foto/");
  const set = (k: keyof FormState, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setAba("dados");
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
        site_status: imovel.site_status ?? "inativo",
        site_destaque: !!imovel.site_destaque,
      });
    } else {
      setForm(VAZIO);
    }
  }, [open, imovel]);

  const salvar = useMutation({
    mutationFn: async () => {
      const proprietarioId: string | null = form.proprietario_id || null;
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
        ...(podeSite ? { site_status: form.site_status, site_destaque: form.site_destaque } : {}),
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
    if (!form.titulo.trim()) {
      setAba("dados");
      toast.error("Informe o título do imóvel.");
      return;
    }
    if (!form.endereco.trim() || !form.cidade.trim()) {
      setAba("local");
      toast.error("Preencha endereço e cidade.");
      return;
    }
    salvar.mutate();
  };

  const buscarCep = async () => {
    const cep = form.cep.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = await r.json();
      if (d && !d.erro)
        setForm((f) => ({ ...f, endereco: f.endereco || d.logradouro || "", bairro: f.bairro || d.bairro || "", cidade: f.cidade || d.localidade || "", estado: d.uf || f.estado }));
    } catch {
      /* sem ViaCEP: preenchimento manual */
    } finally {
      setBuscandoCep(false);
    }
  };

  const ABAS: [Aba, string][] = [
    ["dados", "Dados gerais"],
    ["local", "Localização"],
    ["caracteristicas", "Características e valores"],
    ["proprietario", "Proprietário e divulgação"],
  ];
  const ordem = ABAS.map(([a]) => a);
  const proxima = ordem[ordem.indexOf(aba) + 1];
  const dono = donos.find((d) => d.id === form.proprietario_id);

  const campo = (id: string, rotulo: string, k: keyof FormState, extra: Partial<React.ComponentProps<typeof Input>> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <Input id={id} value={form[k] as string} onChange={(e) => set(k, e.target.value)} {...extra} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92svh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-6 pb-4 pt-5">
          <DialogTitle>{imovel ? `Editar imóvel ${imovel.codigo}` : "Novo imóvel"}</DialogTitle>
          <DialogDescription>Campos com * são obrigatórios. Fotos, documentos e o relatório do proprietário ficam na ficha do imóvel.</DialogDescription>
        </DialogHeader>

        <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)} className="min-h-0 flex-1">
          <div className="overflow-x-auto border-b px-6 py-2">
            <TabsList className="h-9">
              {ABAS.map(([a, r], i) => (
                <TabsTrigger key={a} value={a} className="px-3" data-testid={`imovel-aba-${a}`}>
                  <span className="num mr-1 text-xs text-muted-foreground">{i + 1}</span> {r}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="min-h-[340px] overflow-y-auto px-6 py-5">
            <TabsContent value="dados" className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="titulo">Título do anúncio *</Label>
                <Input id="titulo" value={form.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="Ex.: Apartamento 3 quartos com sacada no Centro" data-testid="imovel-titulo-input" />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label>Tipo</Label>
                  <Select value={form.tipo} onValueChange={(v) => set("tipo", v as string)}>
                    <SelectTrigger data-testid="imovel-tipo-select">
                      <SelectValue>{IMOVEL_TIPO[form.tipo]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(IMOVEL_TIPO) as ImovelTipo[]).map((t) => (
                        <SelectItem key={t} value={t}>{IMOVEL_TIPO[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Finalidade</Label>
                  <Select value={form.finalidade} onValueChange={(v) => set("finalidade", v as string)}>
                    <SelectTrigger data-testid="imovel-finalidade-select">
                      <SelectValue>{IMOVEL_FINALIDADE[form.finalidade]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(IMOVEL_FINALIDADE) as ImovelFinalidade[]).map((f) => (
                        <SelectItem key={f} value={f}>{IMOVEL_FINALIDADE[f]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Situação</Label>
                  <Select value={form.status} onValueChange={(v) => set("status", v as string)}>
                    <SelectTrigger data-testid="imovel-status-select">
                      <SelectValue>{IMOVEL_STATUS[form.status].label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(IMOVEL_STATUS) as ImovelStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>{IMOVEL_STATUS[s].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="descricao">Descrição</Label>
                <Textarea id="descricao" rows={5} value={form.descricao} onChange={(e) => set("descricao", e.target.value)} placeholder="O que o cliente precisa saber: posição do sol, reforma, lazer do condomínio, proximidades." data-testid="imovel-descricao-input" />
              </div>
              {!capaDaGaleria && campo("foto_url", "Link da foto de capa (opcional)", "foto_url", { placeholder: "Prefira enviar as fotos pela ficha do imóvel", "data-testid": "imovel-foto-input" } as never)}
            </TabsContent>

            <TabsContent value="local" className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="cep">CEP</Label>
                  <div className="relative">
                    <Input id="cep" inputMode="numeric" value={form.cep} onChange={(e) => set("cep", e.target.value)} onBlur={buscarCep} placeholder="Preenche o endereço" data-testid="imovel-cep-input" />
                    {buscandoCep && <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                </div>
                <div className="grid gap-1.5 sm:col-span-3">
                  <Label htmlFor="endereco">Endereço *</Label>
                  <Input id="endereco" value={form.endereco} onChange={(e) => set("endereco", e.target.value)} placeholder="Rua, número e complemento" data-testid="imovel-endereco-input" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-5">
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="bairro">Bairro</Label>
                  <Input id="bairro" value={form.bairro} onChange={(e) => set("bairro", e.target.value)} data-testid="imovel-bairro-input" />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="cidade">Cidade *</Label>
                  <Input id="cidade" value={form.cidade} onChange={(e) => set("cidade", e.target.value)} data-testid="imovel-cidade-input" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="estado">UF</Label>
                  <Input id="estado" value={form.estado} maxLength={2} onChange={(e) => set("estado", e.target.value.toUpperCase())} data-testid="imovel-estado-input" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="caracteristicas" className="grid gap-6">
              <section className="grid gap-3">
                <h3 className="text-sm font-semibold">Características</h3>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label htmlFor="area_util">Área útil (m²)</Label>
                    <Input id="area_util" inputMode="decimal" value={form.area_util} onChange={(e) => set("area_util", e.target.value)} data-testid="imovel-area-util-input" />
                  </div>
                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label htmlFor="area_total">Área total (m²)</Label>
                    <Input id="area_total" inputMode="decimal" value={form.area_total} onChange={(e) => set("area_total", e.target.value)} data-testid="imovel-area-total-input" />
                  </div>
                  {([
                    ["quartos", "Quartos", "imovel-quartos-input"],
                    ["suites", "Suítes", "imovel-suites-input"],
                    ["banheiros", "Banheiros", undefined],
                    ["vagas", "Vagas", "imovel-vagas-input"],
                  ] as const).map(([k, r, t]) => (
                    <div key={k} className="grid gap-1.5">
                      <Label htmlFor={k}>{r}</Label>
                      <Input id={k} type="number" min={0} inputMode="numeric" value={form[k]} onChange={(e) => set(k, e.target.value)} data-testid={t} />
                    </div>
                  ))}
                </div>
              </section>
              <section className="grid gap-3 border-t pt-5">
                <h3 className="text-sm font-semibold">Valores</h3>
                <div className="grid grid-cols-2 gap-4">
                  {form.finalidade !== "locacao" && (
                    <div className="grid gap-1.5">
                      <Label htmlFor="valor_venda">Valor de venda (R$)</Label>
                      <Input id="valor_venda" inputMode="decimal" value={form.valor_venda} onChange={(e) => set("valor_venda", e.target.value)} data-testid="imovel-price-input" />
                    </div>
                  )}
                  {form.finalidade !== "venda" && (
                    <div className="grid gap-1.5">
                      <Label htmlFor="valor_aluguel">Aluguel mensal (R$)</Label>
                      <Input id="valor_aluguel" inputMode="decimal" value={form.valor_aluguel} onChange={(e) => set("valor_aluguel", e.target.value)} data-testid="imovel-aluguel-input" />
                    </div>
                  )}
                  <div className="grid gap-1.5">
                    <Label htmlFor="iptu">IPTU mensal (R$)</Label>
                    <Input id="iptu" inputMode="decimal" value={form.iptu} onChange={(e) => set("iptu", e.target.value)} data-testid="imovel-iptu-input" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="condominio">Condomínio (R$)</Label>
                    <Input id="condominio" inputMode="decimal" value={form.condominio} onChange={(e) => set("condominio", e.target.value)} data-testid="imovel-condominio-input" />
                  </div>
                </div>
              </section>
            </TabsContent>

            <TabsContent value="proprietario" className="grid gap-6">
              <section className="grid gap-3">
                <h3 className="text-sm font-semibold">Proprietário</h3>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="min-w-0 flex-1">
                    <Combo
                      opcoes={donos.map((d) => ({ valor: d.id, rotulo: d.nome, detalhe: [d.cpf_cnpj, d.telefone, `${d.qtd_imoveis} imóvel(is)`].filter(Boolean).join(", ") }))}
                      valor={form.proprietario_id || null}
                      onChange={(v) => set("proprietario_id", v ?? "")}
                      placeholder="Buscar proprietário por nome ou documento"
                      onCriar={(texto) => setNovoDono(texto)}
                      rotuloCriar="Cadastrar"
                      testid="imovel-proprietario-select"
                    />
                  </div>
                  <Button type="button" variant="outline" onClick={() => setNovoDono("")} data-testid="imovel-novo-proprietario">
                    <Plus className="h-4 w-4" /> Novo proprietário
                  </Button>
                </div>
                {dono ? (
                  <p className="text-sm text-muted-foreground">
                    {dono.tipo_pessoa === "pj" ? "Pessoa jurídica" : "Pessoa física"}
                    {dono.cpf_cnpj ? `, ${dono.cpf_cnpj}` : ""}
                    {dono.telefone ? `, ${dono.telefone}` : ""}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Sem proprietário. Você pode vincular depois, pela tela de Proprietários.</p>
                )}
              </section>

              {tem("site") && (
                <section className="grid gap-3 border-t pt-5">
                  <div>
                    <h3 className="text-sm font-semibold">Site da imobiliária</h3>
                    <p className="text-xs text-muted-foreground">
                      {podeSite ? "Escolha se o imóvel aparece no site e se está reservado." : "Só o gestor ou quem ele liberou muda o imóvel no site."}
                    </p>
                  </div>
                  <SiteStatusPicker value={form.site_status} onChange={(v) => set("site_status", v)} disabled={!podeSite} />
                  {form.site_status !== "inativo" && (
                    <label className="flex items-center gap-2.5 text-sm">
                      <input type="checkbox" disabled={!podeSite} checked={form.site_destaque} onChange={(e) => set("site_destaque", e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" data-testid="imovel-site-destaque" />
                      Mostrar entre os destaques do site
                    </label>
                  )}
                </section>
              )}

              {tem("portais") && (
                <section className="grid gap-3 border-t pt-5">
                  <h3 className="text-sm font-semibold">Divulgação nos portais</h3>
                  <label className="flex items-start gap-2.5 text-sm">
                    <input type="checkbox" checked={form.publicar_portais} onChange={(e) => set("publicar_portais", e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" data-testid="imovel-portais" />
                    <span>
                      <span className="font-medium">Publicar nos portais</span>
                      <span className="block text-xs text-muted-foreground">ZAP Imóveis, VivaReal e OLX, pelo feed configurado em Configurar CRM.</span>
                    </span>
                  </label>
                  {form.publicar_portais && (
                    <div className="grid max-w-xs gap-1.5">
                      <Label>Destaque no portal</Label>
                      <Select value={form.destaque_portal} onValueChange={(v) => set("destaque_portal", v as string)}>
                        <SelectTrigger aria-label="Destaque no portal">
                          <SelectValue>{{ STANDARD: "Padrão", PREMIUM: "Destaque", SUPER_PREMIUM: "Super destaque" }[form.destaque_portal]}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="STANDARD">Padrão</SelectItem>
                          <SelectItem value="PREMIUM">Destaque</SelectItem>
                          <SelectItem value="SUPER_PREMIUM">Super destaque</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </section>
              )}
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter className="mx-0 mb-0 border-t px-6 py-4">
          <Button variant="outline" onClick={onClose} type="button">
            Cancelar
          </Button>
          {proxima && (
            <Button variant="secondary" type="button" onClick={() => setAba(proxima)} data-testid="imovel-proxima-aba">
              Próximo
            </Button>
          )}
          <Button onClick={submeter} disabled={salvar.isPending} data-testid="property-submit-button">
            {salvar.isPending ? "Salvando..." : imovel ? "Salvar alterações" : "Cadastrar imóvel"}
          </Button>
        </DialogFooter>

        <ProprietarioForm
          open={novoDono !== null}
          nomeInicial={novoDono ?? ""}
          onClose={() => setNovoDono(null)}
          onSalvo={(p) => {
            qc.setQueryData<ProprietarioResumo[]>(["proprietarios"], (l) => [...(l ?? []), { ...p, qtd_imoveis: 0, qtd_alugados: 0, qtd_disponiveis: 0, valor_carteira: 0 }]);
            set("proprietario_id", p.id);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
