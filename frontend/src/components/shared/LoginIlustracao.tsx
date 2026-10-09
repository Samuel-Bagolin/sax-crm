import { BedDouble, CalendarCheck, Car, FileSignature, MapPin, Maximize2 } from "lucide-react";

/** Silhueta de prédios e casas em traço fino (decoração do painel de login). */
export function Skyline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 220" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      {/* prédio alto */}
      <rect x="40" y="40" width="70" height="180" />
      {Array.from({ length: 7 }).map((_, l) =>
        [0, 1, 2].map((c) => <rect key={`a${l}${c}`} x={50 + c * 20} y={52 + l * 22} width="10" height="12" />),
      )}
      {/* prédio médio com antena */}
      <path d="M130 220V90h60v130M160 90V62M150 62h20" />
      {Array.from({ length: 5 }).map((_, l) =>
        [0, 1].map((c) => <rect key={`b${l}${c}`} x={142 + c * 24} y={102 + l * 22} width="12" height="12" />),
      )}
      {/* casa */}
      <path d="M215 220v-70l50-40 50 40v70M200 162l65-52 65 52" />
      <rect x="252" y="178" width="26" height="42" />
      <rect x="226" y="160" width="18" height="16" />
      <rect x="286" y="160" width="18" height="16" />
      {/* prédio largo */}
      <rect x="340" y="70" width="110" height="150" />
      {Array.from({ length: 6 }).map((_, l) =>
        [0, 1, 2, 3].map((c) => <rect key={`c${l}${c}`} x={350 + c * 26} y={82 + l * 22} width="14" height="12" />),
      )}
      {/* sobrado */}
      <path d="M470 220v-60l40-30 40 30v60M460 168l50-38 50 38" />
      <rect x="498" y="186" width="24" height="34" />
      <rect x="480" y="166" width="14" height="14" />
      <rect x="526" y="166" width="14" height="14" />
      <path d="M0 220h600" />
    </svg>
  );
}

/** Cartão de imóvel ilustrativo, para o painel de login parecer o dia a dia de uma imobiliária. */
export function CartaoImovelDemo() {
  return (
    <div className="relative w-[320px]">
      <div className="overflow-hidden rounded-xl bg-white text-[#1d1530] shadow-2xl shadow-black/30">
        <div className="relative h-28 bg-gradient-to-br from-[#efe6fb] to-[#ffe8d1]">
          <Skyline className="absolute inset-x-4 bottom-0 h-24 text-[#4a03a2]/35" />
          <span className="absolute left-3 top-3 rounded-full bg-[#ff7a00] px-2 py-0.5 text-[10px] font-semibold text-white">
            Venda
          </span>
          <span className="absolute bottom-2 right-3 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-[#4a03a2]">
            AP-0142
          </span>
        </div>
        <div className="space-y-2 p-4">
          <div>
            <p className="text-sm font-semibold">Apartamento 3 quartos com sacada</p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[#6b6280]">
              <MapPin className="h-3 w-3" /> Bairro Centro
            </p>
          </div>
          <div className="flex gap-3 text-[11px] text-[#6b6280]">
            <span className="flex items-center gap-1"><Maximize2 className="h-3 w-3" /> 98 m²</span>
            <span className="flex items-center gap-1"><BedDouble className="h-3 w-3" /> 3</span>
            <span className="flex items-center gap-1"><Car className="h-3 w-3" /> 2</span>
          </div>
          <p className="font-heading text-lg font-bold text-[#4a03a2]">R$ 890.000</p>
        </div>
      </div>

      <div className="absolute -right-12 -top-7 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[#1d1530] shadow-xl shadow-black/25">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#efe6fb] text-[#4a03a2]">
          <CalendarCheck className="h-4 w-4" />
        </span>
        <div className="leading-tight">
          <p className="text-[11px] font-semibold">Visita confirmada</p>
          <p className="text-[10px] text-[#6b6280]">Amanhã, 10:00</p>
        </div>
      </div>

      <div className="absolute -bottom-6 -left-8 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[#1d1530] shadow-xl shadow-black/25">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#fff1e3] text-[#ff7a00]">
          <FileSignature className="h-4 w-4" />
        </span>
        <div className="leading-tight">
          <p className="text-[11px] font-semibold">Proposta aceita</p>
          <p className="text-[10px] text-[#6b6280]">Contrato enviado para assinatura</p>
        </div>
      </div>
    </div>
  );
}
