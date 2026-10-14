/** Prepara a imagem no navegador antes de enviar: reduz o tamanho e, na logo, tira o fundo branco.
 *
 * Fundo branco: se os quatro cantos forem quase brancos, pinta de transparente só o branco que encosta
 * na borda (preenchimento a partir das bordas). O branco dentro da marca, como letras vazadas, fica. */
export async function prepararImagem(
  arquivo: File,
  opcoes: { max: number; logo: boolean },
): Promise<{ base64: string; mime: "image/png" | "image/jpeg"; fundoRemovido: boolean }> {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, opcoes.max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let fundoRemovido = false;
  if (opcoes.logo) fundoRemovido = tirarFundoBranco(ctx, canvas.width, canvas.height);
  const mime = opcoes.logo ? "image/png" : "image/jpeg";
  const url = canvas.toDataURL(mime, 0.82);
  return { base64: url.split(",")[1] ?? "", mime, fundoRemovido };
}

const quaseBranco = (d: Uint8ClampedArray, i: number) => d[i + 3] > 200 && d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235;

function tirarFundoBranco(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const cantos = [0, w - 1, (h - 1) * w, h * w - 1];
  if (!cantos.every((p) => quaseBranco(d, p * 4))) return false;
  const visto = new Uint8Array(w * h);
  const pilha: number[] = [];
  for (let x = 0; x < w; x++) pilha.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) pilha.push(y * w, y * w + w - 1);
  let limpos = 0;
  while (pilha.length) {
    const p = pilha.pop()!;
    if (visto[p]) continue;
    visto[p] = 1;
    if (!quaseBranco(d, p * 4)) continue;
    d[p * 4 + 3] = 0;
    limpos++;
    const x = p % w;
    if (x > 0) pilha.push(p - 1);
    if (x < w - 1) pilha.push(p + 1);
    if (p >= w) pilha.push(p - w);
    if (p < w * (h - 1)) pilha.push(p + w);
  }
  // Imagem quase toda branca (ex.: logo branca sobre branco) não é fundo: mantém como veio.
  if (limpos > w * h * 0.97) return false;
  ctx.putImageData(img, 0, 0);
  return limpos > 0;
}
