import { ImportarDados } from "@/components/dados/ImportarDados";
import { useSegmento } from "@/lib/segmento";
import { useConfig } from "@/lib/useConfig";

/** Gestor traz os dados de outro sistema ou planilha (clientes, leads e negócios) e baixa tudo em Excel. */
export default function Dados() {
  const seg = useSegmento();
  const { moduloAtivo } = useConfig();
  const comCrm = moduloAtivo("crm");
  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <div>
        <h1 className="text-xl font-semibold">Importar e exportar dados</h1>
        <p className="text-sm text-muted-foreground">
          Traga {seg.termos.clientes.toLowerCase()}{comCrm ? ", leads e negócios" : ""} de outro sistema ou planilha, e baixe tudo em Excel quando quiser.
        </p>
      </div>
      <ImportarDados base="/dados" comCrm={comCrm} />
    </div>
  );
}
