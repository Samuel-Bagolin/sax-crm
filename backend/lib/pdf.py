"""Geração de recibo em PDF no servidor (reportlab) — sem dependência do navegador."""

import base64
import io
from datetime import datetime

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


def _brl(valor: float) -> str:
    inteiro = f"{valor:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return f"R$ {inteiro}"


def _data_br(iso: str | None) -> str:
    if not iso:
        return "—"
    return f"{iso[8:10]}/{iso[5:7]}/{iso[0:4]}"


def gerar_recibo(
    *,
    numero: str,
    emitente: str,
    pagador: str,
    descricao: str,
    valor: float,
    pagamento: str | None,
    vencimento: str,
    imovel: str | None,
    contrato: str | None,
    cor_primaria: str = "#5b2bd0",
    logo_base64: str | None = None,
) -> bytes:
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    largura, altura = A4
    try:
        cor = HexColor(cor_primaria)
    except Exception:
        cor = HexColor("#5b2bd0")

    # Faixa superior com a marca do configurador
    c.setFillColor(cor)
    c.rect(0, altura - 35 * mm, largura, 35 * mm, fill=1, stroke=0)

    if logo_base64:
        try:
            img = ImageReader(io.BytesIO(base64.b64decode(logo_base64)))
            c.drawImage(img, 18 * mm, altura - 30 * mm, height=20 * mm, width=20 * mm,
                        preserveAspectRatio=True, mask="auto")
        except Exception:
            pass

    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(45 * mm, altura - 20 * mm, emitente)
    c.setFont("Helvetica", 10)
    c.drawString(45 * mm, altura - 27 * mm, "Recibo de pagamento")
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(largura - 18 * mm, altura - 20 * mm, f"Nº {numero}")

    y = altura - 55 * mm
    c.setFillColor(HexColor("#1c1c1c"))
    c.setFont("Helvetica", 11)
    c.drawString(
        18 * mm,
        y,
        f"Recebemos de {pagador} a importância de {_brl(valor)}, referente a:",
    )

    y -= 12 * mm
    c.setFont("Helvetica-Bold", 13)
    c.drawString(18 * mm, y, descricao[:80])

    linhas = [
        ("Valor pago", _brl(valor)),
        ("Data do pagamento", _data_br(pagamento)),
        ("Vencimento", _data_br(vencimento)),
    ]
    if imovel:
        linhas.append(("Imóvel", imovel[:60]))
    if contrato:
        linhas.append(("Contrato", contrato))

    y -= 14 * mm
    for rotulo, valor_txt in linhas:
        c.setFont("Helvetica", 9)
        c.setFillColor(HexColor("#6b7280"))
        c.drawString(18 * mm, y, rotulo.upper())
        c.setFont("Helvetica-Bold", 11)
        c.setFillColor(HexColor("#1c1c1c"))
        c.drawString(70 * mm, y, valor_txt)
        y -= 9 * mm

    y -= 10 * mm
    c.setStrokeColor(HexColor("#d1d5db"))
    c.line(18 * mm, y, largura - 18 * mm, y)
    y -= 8 * mm
    c.setFont("Helvetica", 9)
    c.setFillColor(HexColor("#6b7280"))
    c.drawString(
        18 * mm,
        y,
        "Para clareza e validade, firmamos o presente recibo, dando plena quitação do valor acima.",
    )

    c.setFont("Helvetica", 9)
    c.drawString(18 * mm, 32 * mm, "_______________________________________")
    c.drawString(18 * mm, 26 * mm, emitente)
    c.setFont("Helvetica", 8)
    c.drawString(
        18 * mm,
        16 * mm,
        f"Emitido em {datetime.now().strftime('%d/%m/%Y %H:%M')} por {emitente} · documento gerado pelo sistema",
    )

    c.showPage()
    c.save()
    return buffer.getvalue()


def _fmt_dt(dt) -> str:
    if not dt:
        return "—"
    try:
        from zoneinfo import ZoneInfo
        import os
        return dt.astimezone(ZoneInfo(os.environ.get("APP_TZ", "America/Sao_Paulo"))).strftime("%d/%m/%Y %H:%M:%S")
    except Exception:
        return str(dt)


def gerar_contrato_pdf(
    *,
    empresa: str,
    numero: str,
    titulo: str,
    texto: str,
    hash_documento: str,
    signatarios: list[dict],
    eventos: list[dict],
    cor_primaria: str = "#5b2bd0",
    logo_base64: str | None = None,
) -> bytes:
    """Contrato + página de assinaturas + trilha de auditoria (platypus quebra as páginas)."""
    from html import escape as esc
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    try:
        cor = HexColor(cor_primaria)
    except Exception:
        cor = HexColor("#5b2bd0")
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                            topMargin=24 * mm, bottomMargin=20 * mm, title=f"{numero} — {titulo}", author=empresa)
    corpo = ParagraphStyle("corpo", fontName="Helvetica", fontSize=10, leading=14.5, spaceAfter=6, alignment=4)
    h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=14, leading=18, spaceAfter=10, alignment=1)
    h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11, leading=15, spaceBefore=8, spaceAfter=4, textColor=cor)
    pequeno = ParagraphStyle("pequeno", fontName="Helvetica", fontSize=8, leading=11, textColor=HexColor("#4b5563"))
    rotulo = ParagraphStyle("rotulo", fontName="Helvetica-Bold", fontSize=9, leading=12)

    def cabecalho(c, d):
        c.saveState()
        c.setFillColor(cor)
        c.rect(0, A4[1] - 12 * mm, A4[0], 12 * mm, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(20 * mm, A4[1] - 7.5 * mm, empresa[:70])
        c.drawRightString(A4[0] - 20 * mm, A4[1] - 7.5 * mm, numero)
        c.setFillColor(HexColor("#6b7280"))
        c.setFont("Helvetica", 7)
        c.drawString(20 * mm, 10 * mm, f"Código de integridade (SHA-256): {hash_documento}")
        c.drawRightString(A4[0] - 20 * mm, 10 * mm, f"Página {d.page}")
        c.restoreState()

    historia = []
    if logo_base64:
        try:
            historia.append(Image(io.BytesIO(base64.b64decode(logo_base64)), width=22 * mm, height=22 * mm, kind="proportional"))
            historia.append(Spacer(1, 4 * mm))
        except Exception:
            pass
    paragrafo: list[str] = []

    def fechar():
        if paragrafo:
            historia.append(Paragraph(esc(" ".join(paragrafo)), corpo))
            paragrafo.clear()

    for linha in texto.splitlines():
        crua = linha.strip()
        if not crua:
            fechar()
        elif crua.startswith("# "):
            fechar()
            historia.append(Paragraph(esc(crua[2:]), h1))
        elif crua.startswith("## "):
            fechar()
            historia.append(Paragraph(esc(crua[3:]), h2))
        else:
            paragrafo.append(crua)
    fechar()

    historia.append(PageBreak())
    historia.append(Paragraph("Página de assinaturas", h1))
    historia.append(Paragraph(
        "As assinaturas abaixo foram coletadas eletronicamente pelo sistema, com registro de data e hora, "
        "endereço IP, navegador e o código de integridade do documento exibido no rodapé de cada página.", pequeno))
    historia.append(Spacer(1, 6 * mm))
    for s in signatarios:
        bloco = []
        if s.get("png"):
            try:
                bloco.append(Image(io.BytesIO(s["png"]), width=60 * mm, height=22 * mm, kind="proportional"))
            except Exception:
                pass
        dados = [
            [Paragraph(esc(s.get("nome_assinado") or s.get("nome") or ""), rotulo), Paragraph(esc((s.get("papel") or "").capitalize()), pequeno)],
            [Paragraph(f"CPF: {esc(s.get('cpf_informado') or s.get('cpf') or '—')}", pequeno), Paragraph(f"Status: {esc(s.get('status', ''))}", pequeno)],
            [Paragraph(f"Assinado em: {_fmt_dt(s.get('assinado_em'))}", pequeno), Paragraph(f"IP: {esc(s.get('ip') or '—')}", pequeno)],
        ]
        tabela = Table(dados, colWidths=[95 * mm, 70 * mm])
        tabela.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.6, HexColor("#9ca3af")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        bloco.append(tabela)
        bloco.append(Spacer(1, 7 * mm))
        historia.append(KeepTogether(bloco))

    historia.append(Spacer(1, 4 * mm))
    historia.append(Paragraph("Trilha de auditoria", h2))
    for e in eventos:
        historia.append(Paragraph(f"{_fmt_dt(e.get('em'))} — {esc(e.get('texto', ''))}" + (f" (IP {esc(e['ip'])})" if e.get("ip") else ""), pequeno))
    historia.append(Spacer(1, 4 * mm))
    historia.append(Paragraph(f"Documento emitido por {esc(empresa)} em {datetime.now().strftime('%d/%m/%Y %H:%M')}.", pequeno))

    doc.build(historia, onFirstPage=cabecalho, onLaterPages=cabecalho)
    return buffer.getvalue()


def gerar_proposta_pdf(
    *,
    empresa: str,
    numero: str,
    titulo: str,
    linhas: list[tuple[str, str]],
    condicoes: str | None,
    proponente: str,
    corretor: str | None,
    historico: list[str],
    cor_primaria: str = "#4a03a2",
    logo_base64: str | None = None,
) -> bytes:
    """Proposta de compra/locação em uma página: quadro de valores, condições e campos de assinatura."""
    from html import escape as esc
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    try:
        cor = HexColor(cor_primaria)
    except Exception:
        cor = HexColor("#4a03a2")
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                            topMargin=24 * mm, bottomMargin=20 * mm, title=f"{numero} — {titulo}", author=empresa)
    corpo = ParagraphStyle("corpo", fontName="Helvetica", fontSize=10, leading=14.5, spaceAfter=6)
    h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=15, leading=19, spaceAfter=4)
    sub = ParagraphStyle("sub", fontName="Helvetica", fontSize=9, leading=12, textColor=HexColor("#6b7280"), spaceAfter=10)
    h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11, leading=15, spaceBefore=10, spaceAfter=4, textColor=cor)
    rot = ParagraphStyle("rot", fontName="Helvetica", fontSize=9, leading=12, textColor=HexColor("#4b5563"))
    val = ParagraphStyle("val", fontName="Helvetica-Bold", fontSize=10, leading=13)
    pequeno = ParagraphStyle("pequeno", fontName="Helvetica", fontSize=8, leading=11, textColor=HexColor("#4b5563"))

    def cabecalho(c, d):
        c.saveState()
        c.setFillColor(cor)
        c.rect(0, A4[1] - 12 * mm, A4[0], 12 * mm, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(20 * mm, A4[1] - 7.5 * mm, empresa[:70])
        c.drawRightString(A4[0] - 20 * mm, A4[1] - 7.5 * mm, numero)
        c.restoreState()

    historia = []
    if logo_base64:
        try:
            historia.append(Image(io.BytesIO(base64.b64decode(logo_base64)), width=20 * mm, height=20 * mm, kind="proportional"))
            historia.append(Spacer(1, 3 * mm))
        except Exception:
            pass
    historia.append(Paragraph(esc(titulo), h1))
    historia.append(Paragraph(f"{esc(numero)} · emitida em {datetime.now().strftime('%d/%m/%Y')}", sub))
    tabela = Table([[Paragraph(esc(a), rot), Paragraph(esc(b), val)] for a, b in linhas], colWidths=[55 * mm, 115 * mm])
    tabela.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, HexColor("#e5e7eb")), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    historia.append(tabela)
    if condicoes:
        historia.append(Paragraph("Condições", h2))
        for par in condicoes.split("\n"):
            if par.strip():
                historia.append(Paragraph(esc(par.strip()), corpo))
    if historico:
        historia.append(Paragraph("Histórico da negociação", h2))
        for h in historico:
            historia.append(Paragraph(esc(h), pequeno))
    historia.append(Spacer(1, 18 * mm))
    assin = Table([["", ""], [Paragraph(f"<b>{esc(proponente)}</b><br/>Proponente", rot), Paragraph(f"<b>{esc(corretor or empresa)}</b><br/>Corretor responsável", rot)]],
                  colWidths=[80 * mm, 80 * mm], rowHeights=[10 * mm, None])
    assin.setStyle(TableStyle([("LINEABOVE", (0, 1), (0, 1), 0.6, HexColor("#111827")), ("LINEABOVE", (1, 1), (1, 1), 0.6, HexColor("#111827")),
                               ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, -1), 10 * mm)]))
    historia.append(assin)
    historia.append(Spacer(1, 8 * mm))
    historia.append(Paragraph("Esta proposta não substitui o contrato. A aceitação está sujeita à análise documental e à confirmação "
                              "por escrito do proprietário.", pequeno))
    doc.build(historia, onFirstPage=cabecalho, onLaterPages=cabecalho)
    return buffer.getvalue()
