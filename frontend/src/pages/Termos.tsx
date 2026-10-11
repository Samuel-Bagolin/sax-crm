import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import MarcaSax from "@/components/shared/MarcaSax";
import { TextoTermo } from "@/components/termo/TextoTermo";

/** Termo de adesão vigente, público: dá para ler antes de contratar. */
export default function Termos() {
  const q = useQuery({ queryKey: ["termo-publico"], queryFn: () => apiGet<{ versao: string; texto: string }>("/publico/termo") });
  return (
    <div className="min-h-screen bg-muted/30 px-4 py-8">
      <div className="mx-auto max-w-3xl rounded-2xl border bg-card p-5 sm:p-8">
        <div className="mb-6"><MarcaSax /></div>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p>
          : q.data ? <TextoTermo texto={q.data.texto} />
          : <p className="text-sm text-muted-foreground">Não foi possível carregar o termo. Tente de novo em instantes.</p>}
      </div>
    </div>
  );
}
