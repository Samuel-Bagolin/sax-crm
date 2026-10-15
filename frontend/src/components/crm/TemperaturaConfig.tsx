import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CrmConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ChipTemperatura, SelectTemperatura, type Temperatura } from "@/components/crm/Temperatura";

type Regra = { origem: string; temperatura: Temperatura };

/** Regras de temperatura por origem (ex.: Google Maps entra frio) e a ordem quente, morno, frio. */
export function TemperaturaConfig({ config, salvar }: { config: CrmConfig; salvar: (p: Partial<CrmConfig>) => void }) {
  const [regras, setRegras] = useState<Regra[]>(config.regras_temperatura ?? []);
  useEffect(() => setRegras(config.regras_temperatura ?? []), [config.regras_temperatura]);
  const mudou = JSON.stringify(regras) !== JSON.stringify(config.regras_temperatura ?? []);
  const validas = regras.filter((r) => r.origem.trim());
  return (
    <section className="grid gap-3 rounded-lg border bg-card p-4 text-sm lg:col-span-3" data-testid="cfg-temperatura">
      <div>
        <h3 className="font-semibold">Temperatura dos leads</h3>
        <p className="text-muted-foreground">Quem cadastra escolhe quente, morno ou frio. Se ficar em branco, a origem decide pelas regras abaixo.</p>
      </div>
      <label className="flex items-center gap-2">
        <Checkbox checked={config.ordenar_por_temperatura !== false} onCheckedChange={(v) => salvar({ ordenar_por_temperatura: !!v })} data-testid="cfg-ordenar-temp" />
        Mostrar quente em cima, morno no meio e frio no fim (quadro e listas)
      </label>
      <div className="grid gap-2">
        {regras.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Origem com</span>
            <Input list="cfg-origens" value={r.origem} maxLength={80} className="h-8 w-56" placeholder="Ex.: Google Maps" aria-label="Origem"
              onChange={(e) => setRegras(regras.map((x, k) => (k === i ? { ...x, origem: e.target.value } : x)))} />
            <span className="text-muted-foreground">entra</span>
            <SelectTemperatura valor={r.temperatura} vazio="Escolha" className="h-8"
              onChange={(v) => v && setRegras(regras.map((x, k) => (k === i ? { ...x, temperatura: v } : x)))} />
            <ChipTemperatura valor={r.temperatura} />
            <Button size="icon-sm" variant="ghost" aria-label="Tirar regra" onClick={() => setRegras(regras.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <datalist id="cfg-origens">{config.origens.map((o) => <option key={o} value={o} />)}</datalist>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setRegras([...regras, { origem: "", temperatura: "frio" }])} data-testid="cfg-temp-add"><Plus className="h-4 w-4" /> Regra</Button>
          {mudou && <Button size="sm" onClick={() => salvar({ regras_temperatura: validas })} data-testid="cfg-temp-salvar">Salvar regras</Button>}
        </div>
      </div>
    </section>
  );
}
