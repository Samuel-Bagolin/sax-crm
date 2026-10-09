import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Copy, Globe, Inbox, RefreshCw } from "lucide-react";
import { apiGet, apiPost, detalheErro } from "@/lib/api";
import { urlCompleta, type PortaisConfig as Config } from "@/lib/diferenciais";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function CampoUrl({ rotulo, ajuda, valor }: { rotulo: string; ajuda: string; valor: string }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{rotulo}</p>
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5">
        <code className="min-w-0 flex-1 truncate text-xs">{valor}</code>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Copiar ${rotulo}`}
          onClick={() => {
            void navigator.clipboard?.writeText(valor);
            toast.success("Copiado");
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{ajuda}</p>
    </div>
  );
}

export default function PortaisConfig() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["portais-config"], queryFn: () => apiGet<Config>("/portais/config") });
  const trocar = useMutation({
    mutationFn: () => apiPost<Config>("/portais/novo-token"),
    onSuccess: (c) => {
      qc.setQueryData(["portais-config"], c);
      toast.success("Novos endereços gerados. Atualize no painel dos portais.");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível trocar"),
  });
  if (isLoading || !data) return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  if (!data.liberado)
    return (
      <div className="rounded-lg border bg-card p-6 text-center">
        <Globe className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 font-semibold">Publicação em portais não faz parte do seu plano</p>
        <p className="text-sm text-muted-foreground">Disponível a partir do plano Business. Fale com o suporte para ampliar.</p>
      </div>
    );

  const bloqueados = data.pendencias.filter((p) => p.bloqueia);
  const melhorar = data.pendencias.filter((p) => !p.bloqueia);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Na carteira", data.carteira],
            ["Marcados para portais", data.publicados],
            ["Aceitos no feed", data.prontos],
            ["Leads de portais (30 dias)", data.leads_30d],
          ].map(([r, v]) => (
            <div key={r as string} className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">{r}</p>
              <p className="num text-2xl font-semibold">{v}</p>
            </div>
          ))}
        </section>

        <section className="rounded-lg border bg-card">
          <header className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">O que falta nos anúncios</h3>
            <p className="text-xs text-muted-foreground">
              Em vermelho, o portal recusa o anúncio. Em amarelo, ele entra mas perde posição na busca. Marque os imóveis em “Publicar nos portais” na edição do imóvel.
            </p>
          </header>
          {!data.pendencias.length ? (
            <p className="flex items-center gap-2 px-4 py-5 text-sm text-hoje">
              <CheckCircle2 className="h-4 w-4" /> {data.publicados ? "Todos os anúncios estão completos." : "Nenhum imóvel marcado para os portais ainda."}
            </p>
          ) : (
            <ul className="divide-y">
              {[...bloqueados, ...melhorar].map((p) => (
                <li key={p.imovel_id} className="flex items-start gap-3 px-4 py-2.5">
                  <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", p.bloqueia ? "text-atrasada" : "text-[#a26a00] dark:text-sem-atividade")} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/imoveis?id=${p.imovel_id}`} className="block truncate text-sm font-medium hover:text-primary">
                      {p.codigo} · {p.titulo}
                    </Link>
                    <p className="text-xs text-muted-foreground">Falta: {p.faltando.join(", ")}</p>
                  </div>
                  <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold", p.bloqueia ? "bg-atrasada/10 text-atrasada" : "bg-sem-atividade/15 text-[#8a5a00] dark:text-sem-atividade")}>
                    {p.bloqueia ? "Fora do feed" : "Pode melhorar"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="h-fit space-y-4 rounded-lg border bg-card p-4">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Globe className="h-4 w-4 text-muted-foreground" /> Grupo OLX (ZAP Imóveis, VivaReal e OLX)
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">Cadastre os dois endereços uma vez no painel do anunciante (Canal Pro), na área de integração com CRM.</p>
        </div>
        {data.aviso && <p className="rounded-md bg-sem-atividade/15 p-2 text-xs text-[#8a5a00] dark:text-sem-atividade">{data.aviso}</p>}
        <CampoUrl rotulo="Feed de imóveis (XML)" ajuda="Formato VRSync. O portal lê este endereço algumas vezes por dia." valor={urlCompleta(data.feed_url)} />
        <CampoUrl rotulo="Recebimento de leads" ajuda="Os contatos dos anúncios caem na caixa de Leads, já ligados ao imóvel e distribuídos." valor={urlCompleta(data.leads_url)} />
        <p className="text-xs text-muted-foreground">
          Último acesso do portal ao feed: <strong>{data.feed_acessado_em ? new Date(data.feed_acessado_em).toLocaleString("pt-BR") : "ainda não acessou"}</strong>
        </p>
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button variant="outline" size="sm" render={<Link to="/leads" />}>
            <Inbox className="h-3.5 w-3.5" /> Ver leads
          </Button>
          <Button variant="ghost" size="sm" onClick={() => trocar.mutate()} disabled={trocar.isPending} title="Use se suspeitar que os endereços vazaram">
            <RefreshCw className="h-3.5 w-3.5" /> Trocar endereços
          </Button>
        </div>
      </section>
    </div>
  );
}
