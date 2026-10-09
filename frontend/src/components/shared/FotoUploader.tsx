import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImageUp, RotateCcw, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const AREA = 280; // tamanho do recorte na tela
const SAIDA = 512; // tamanho final enviado ao servidor

/**
 * Criar a foto do consultor: escolher um arquivo ou tirar com a câmera, enquadrar (arrastar + zoom)
 * e gerar um JPEG quadrado de 512px. O arquivo original nunca sai do navegador.
 */
export default function FotoUploader({
  open,
  onClose,
  onConfirmar,
  salvando,
}: {
  open: boolean;
  onClose: () => void;
  onConfirmar: (dataUrl: string) => void;
  salvando?: boolean;
}) {
  const [modo, setModo] = useState<"arquivo" | "camera">("arquivo");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [erroCamera, setErroCamera] = useState<string | null>(null);
  const [arrastandoArquivo, setArrastandoArquivo] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const arraste = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pararCamera = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      pararCamera();
      setImg(null);
      setModo("arquivo");
      setErroCamera(null);
    }
  }, [open, pararCamera]);

  useEffect(() => {
    if (!open || modo !== "camera" || img) return;
    let cancelado = false;
    setErroCamera(null);
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (cancelado) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      })
      .catch(() => setErroCamera("Não foi possível acessar a câmera. Verifique a permissão do navegador ou envie um arquivo."));
    if (!navigator.mediaDevices) setErroCamera("Este navegador não oferece acesso à câmera. Envie um arquivo.");
    return () => {
      cancelado = true;
      pararCamera();
    };
  }, [open, modo, img, pararCamera]);

  const carregar = (src: string) => {
    const i = new Image();
    i.onload = () => {
      setImg(i);
      setZoom(1);
      setPos({ x: 0, y: 0 });
    };
    i.src = src;
  };

  const lerArquivo = (f: File | undefined) => {
    if (!f || !f.type.startsWith("image/")) return;
    const r = new FileReader();
    r.onload = () => carregar(String(r.result));
    r.readAsDataURL(f);
  };

  const capturar = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1); // espelha como a pré-visualização
    ctx.drawImage(v, 0, 0);
    pararCamera();
    carregar(c.toDataURL("image/jpeg", 0.92));
  };

  // Escala base: a imagem cobre todo o recorte.
  const escalaBase = img ? Math.max(AREA / img.width, AREA / img.height) : 1;
  const escala = escalaBase * zoom;
  const limitar = (x: number, y: number) => {
    if (!img) return { x, y };
    const mx = Math.max(0, (img.width * escala - AREA) / 2);
    const my = Math.max(0, (img.height * escala - AREA) / 2);
    return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  };

  useEffect(() => setPos((p) => limitar(p.x, p.y)), [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const gerar = () => {
    if (!img) return;
    const c = document.createElement("canvas");
    c.width = SAIDA;
    c.height = SAIDA;
    const ctx = c.getContext("2d")!;
    const k = SAIDA / AREA;
    const w = img.width * escala * k;
    const h = img.height * escala * k;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, SAIDA, SAIDA);
    ctx.drawImage(img, SAIDA / 2 - w / 2 + pos.x * k, SAIDA / 2 - h / 2 + pos.y * k, w, h);
    onConfirmar(c.toDataURL("image/jpeg", 0.86));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Foto do perfil</DialogTitle>
          <DialogDescription>Aparece na agenda, no funil e para a equipe.</DialogDescription>
        </DialogHeader>

        {!img && (
          <div className="flex rounded-md border p-0.5">
            {(
              [
                ["arquivo", ImageUp, "Enviar imagem"],
                ["camera", Camera, "Tirar foto"],
              ] as const
            ).map(([m, Icone, r]) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded text-sm", modo === m ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
              >
                <Icone className="h-4 w-4" /> {r}
              </button>
            ))}
          </div>
        )}

        {img ? (
          <div className="space-y-4">
            <div
              className="relative mx-auto touch-none overflow-hidden rounded-lg bg-muted"
              style={{ width: AREA, height: AREA, cursor: "grab" }}
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                arraste.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
              }}
              onPointerMove={(e) => {
                if (!arraste.current) return;
                setPos(limitar(arraste.current.px + e.clientX - arraste.current.x, arraste.current.py + e.clientY - arraste.current.y));
              }}
              onPointerUp={() => (arraste.current = null)}
              onWheel={(e) => setZoom((z) => Math.min(4, Math.max(1, z - e.deltaY * 0.0015)))}
            >
              <img
                src={img.src}
                alt="Pré-visualização"
                draggable={false}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                style={{
                  width: img.width * escala,
                  height: img.height * escala,
                  transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
                }}
              />
              {/* máscara circular */}
              <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/85" style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }} />
            </div>
            <label className="flex items-center gap-3 text-sm">
              <ZoomIn className="h-4 w-4 text-muted-foreground" />
              <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-[var(--primary)]" aria-label="Zoom" />
            </label>
            <p className="text-center text-xs text-muted-foreground">Arraste para enquadrar o rosto.</p>
          </div>
        ) : modo === "arquivo" ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setArrastandoArquivo(true);
            }}
            onDragLeave={() => setArrastandoArquivo(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastandoArquivo(false);
              lerArquivo(e.dataTransfer.files[0]);
            }}
            className={cn(
              "flex h-56 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm text-muted-foreground transition-colors",
              arrastandoArquivo ? "border-primary bg-accent" : "hover:border-ring/60 hover:bg-muted/40",
            )}
          >
            <ImageUp className="h-8 w-8" />
            <span className="font-medium text-foreground">Escolha uma imagem ou arraste aqui</span>
            <span className="text-xs">JPG, PNG ou WEBP</span>
            <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => lerArquivo(e.target.files?.[0])} data-testid="foto-arquivo" />
          </button>
        ) : (
          <div className="space-y-3">
            {erroCamera ? (
              <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">{erroCamera}</p>
            ) : (
              <video ref={video} playsInline muted className="aspect-video w-full -scale-x-100 rounded-lg bg-black object-cover" />
            )}
            <Button className="w-full" onClick={capturar} disabled={!!erroCamera}>
              <Camera className="h-4 w-4" /> Capturar
            </Button>
          </div>
        )}

        <DialogFooter>
          {img && (
            <Button variant="ghost" className="mr-auto" onClick={() => setImg(null)}>
              <RotateCcw className="h-4 w-4" /> Outra foto
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={gerar} disabled={!img || salvando} data-testid="foto-salvar">
            {salvando ? "Salvando…" : "Usar esta foto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
