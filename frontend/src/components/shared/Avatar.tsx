import { useState } from "react";
import { corDoMembro, fotoUrl, iniciais } from "@/lib/crm";
import { cn } from "@/lib/utils";

const TAMANHOS = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
  lg: "h-14 w-14 text-base",
  xl: "h-24 w-24 text-2xl",
} as const;

/** Foto do usuário quando existe; senão, iniciais sobre a cor do consultor. */
export default function Avatar({
  nome,
  usuarioId,
  temFoto,
  versao = 0,
  cor,
  tamanho = "sm",
  className,
  anel,
}: {
  nome: string | null | undefined;
  usuarioId?: string | null;
  temFoto?: boolean;
  versao?: number;
  cor?: string | null;
  tamanho?: keyof typeof TAMANHOS;
  className?: string;
  anel?: string;
}) {
  const [falhou, setFalhou] = useState(false);
  const src = temFoto && !falhou ? fotoUrl(usuarioId, versao) : null;
  const fundo = cor ?? corDoMembro({ usuario_id: usuarioId ?? nome ?? "" });
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold text-white",
        TAMANHOS[tamanho],
        className,
      )}
      style={{ backgroundColor: src ? undefined : fundo, boxShadow: anel ? `0 0 0 2px ${anel}` : undefined }}
      title={nome ?? undefined}
      aria-label={nome ?? undefined}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFalhou(true)} />
      ) : (
        iniciais(nome)
      )}
    </span>
  );
}
