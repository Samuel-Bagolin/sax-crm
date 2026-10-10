import { useSegmento } from "@/lib/segmento";
import { csvCell } from "@/lib/numbers";
import { Download } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { brl, brlCompacto, mesLabel } from "@/lib/format";
import type { DreImovel, ResumoFinanceiro } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

function exportarCSV(dre: DreImovel[]) {
  const cabecalho = [
    "Imóvel",
    "Receitas (R$)",
    "Despesas (R$)",
    "Resultado (R$)",
    "A receber (R$)",
    "A pagar (R$)",
  ];
  const linhas = dre.map((d) =>
    [d.titulo, d.receitas, d.despesas, d.resultado, d.a_receber, d.a_pagar]
      .map(csvCell)
      .join(";"),
  );
  const csv = ["\uFEFF" + cabecalho.join(";"), ...linhas].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "receita-vs-despesa-por-imovel.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function RelatoriosTab({
  resumo,
  carregando,
}: {
  resumo: ResumoFinanceiro | undefined;
  carregando: boolean;
}) {
  const seg = useSegmento();
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fluxo de caixa — realizados nos últimos 6 meses</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72" data-testid="financeiro-cashflow-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={resumo?.fluxo_mensal ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.25)" />
                <XAxis
                  dataKey="mes"
                  tickFormatter={(m) => mesLabel(String(m))}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(v) => brlCompacto(Number(v))}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  width={76}
                />
                <Tooltip
                  formatter={(value, name) => [brl(Number(value)), String(name)]}
                  labelFormatter={(label) => mesLabel(String(label))}
                />
                <Legend />
                <Bar dataKey="receitas" name="Receitas" fill="#16a34a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="despesas" name="Despesas" fill="#dc2626" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="saldo" name="Saldo" stroke="#0284c7" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {seg.imobiliaria && (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Receita vs Despesa por Imóvel</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportarCSV(resumo?.dre_imoveis ?? [])}
            data-testid="btn-export-csv"
          >
            <Download className="h-4 w-4" /> Exportar CSV
          </Button>
        </CardHeader>
        <CardContent>
          <div data-testid="financeiro-property-dre-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Imóvel</TableHead>
                  <TableHead className="text-right">Receitas</TableHead>
                  <TableHead className="text-right">Despesas</TableHead>
                  <TableHead className="text-right">Resultado</TableHead>
                  <TableHead className="text-right">A receber</TableHead>
                  <TableHead className="text-right">A pagar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {carregando && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      Calculando…
                    </TableCell>
                  </TableRow>
                )}
                {!carregando && (resumo?.dre_imoveis?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      Nenhum imóvel na carteira.
                    </TableCell>
                  </TableRow>
                )}
                {(resumo?.dre_imoveis ?? []).map((d) => (
                  <TableRow key={d.imovel_id} data-testid={`dre-row-${d.imovel_id}`}>
                    <TableCell>
                      <p className="max-w-72 truncate text-sm font-medium">{d.titulo}</p>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-emerald-600">{brl(d.receitas)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-red-600">{brl(d.despesas)}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono text-sm font-semibold",
                        d.resultado >= 0 ? "text-emerald-600" : "text-red-600",
                      )}
                    >
                      {brl(d.resultado)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {brl(d.a_receber)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {brl(d.a_pagar)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
