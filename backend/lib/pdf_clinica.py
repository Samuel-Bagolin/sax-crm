"""PDFs da clínica para impressão: orçamento (plano de tratamento), prontuário, receituário, atestado e declarações.

Um só modelo (reportlab platypus): faixa com a cor e o nome da empresa, logo, título, blocos de texto ou tabela e
linha de assinatura do profissional com o registro (CRP, CRO, CRFa...).
"""

from __future__ import annotations

import base64
import io
from datetime import datetime
from html import escape as esc

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from lib.pdf import _brl, _data_br


def _estilos(cor):
    return {
        "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=15, leading=19, spaceAfter=3),
        "sub": ParagraphStyle("sub", fontName="Helvetica", fontSize=9, leading=12, textColor=HexColor("#6b7280"), spaceAfter=8),
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11, leading=15, spaceBefore=8, spaceAfter=3, textColor=cor),
        "corpo": ParagraphStyle("corpo", fontName="Helvetica", fontSize=10, leading=14.5, spaceAfter=5),
        "grande": ParagraphStyle("grande", fontName="Helvetica", fontSize=12, leading=19, spaceAfter=8),
        "rot": ParagraphStyle("rot", fontName="Helvetica", fontSize=8.5, leading=11, textColor=HexColor("#4b5563")),
        "cel": ParagraphStyle("cel", fontName="Helvetica", fontSize=9, leading=12),
        "celb": ParagraphStyle("celb", fontName="Helvetica-Bold", fontSize=9, leading=12),
        "peq": ParagraphStyle("peq", fontName="Helvetica", fontSize=8, leading=11, textColor=HexColor("#4b5563")),
    }


def _p(texto: str | None, estilo) -> list:
    return [Paragraph(esc(par.strip()) if par.strip() else "&nbsp;", estilo) for par in (texto or "").split("\n")]


def montar(*, empresa: str, titulo: str, subtitulo: str, blocos: list, assinatura: dict | None, cor_primaria: str = "#4a03a2",
           logo_base64: str | None = None, rodape: str | None = None, contato: str | None = None) -> bytes:
    """`blocos`: lista de ("h2", texto) | ("texto", texto) | ("grande", texto) | ("tabela", linhas, larguras) | ("par", [(rótulo, valor)])."""
    try:
        cor = HexColor(cor_primaria)
    except Exception:
        cor = HexColor("#4a03a2")
    e = _estilos(cor)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=22 * mm, bottomMargin=20 * mm,
                            title=titulo, author=empresa)

    def moldura(c, d):
        c.saveState()
        c.setFillColor(cor)
        c.rect(0, A4[1] - 11 * mm, A4[0], 11 * mm, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(20 * mm, A4[1] - 7 * mm, empresa[:80])
        if contato:
            c.setFont("Helvetica", 8)
            c.drawRightString(A4[0] - 20 * mm, A4[1] - 7 * mm, contato[:90])
        c.setFillColor(HexColor("#9ca3af"))
        c.setFont("Helvetica", 7.5)
        c.drawString(20 * mm, 10 * mm, f"{titulo} · gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')}")
        c.drawRightString(A4[0] - 20 * mm, 10 * mm, f"Página {d.page}")
        c.restoreState()

    h: list = []
    if logo_base64:
        try:
            h.append(Image(io.BytesIO(base64.b64decode(logo_base64)), width=22 * mm, height=22 * mm, kind="proportional"))
            h.append(Spacer(1, 2 * mm))
        except Exception:
            pass
    h.append(Paragraph(esc(titulo), e["h1"]))
    h.append(Paragraph(esc(subtitulo), e["sub"]))
    for b in blocos:
        tipo = b[0]
        if tipo == "h2":
            h.append(Paragraph(esc(b[1]), e["h2"]))
        elif tipo == "texto":
            h.extend(_p(b[1], e["corpo"]))
        elif tipo == "grande":
            h.extend(_p(b[1], e["grande"]))
        elif tipo == "peq":
            h.extend(_p(b[1], e["peq"]))
        elif tipo == "par":
            t = Table([[Paragraph(esc(r), e["rot"]), Paragraph(esc(v or "-"), e["celb"])] for r, v in b[1]], colWidths=[45 * mm, 125 * mm])
            t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.3, HexColor("#e5e7eb")), ("TOPPADDING", (0, 0), (-1, -1), 3),
                                   ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            h.append(t)
        elif tipo == "tabela":
            linhas, larguras = b[1], b[2]
            dados = [[Paragraph(esc(str(c)), e["celb"] if i == 0 else e["cel"]) for c in l]
                     for i, l in enumerate(linhas)]
            t = Table(dados, colWidths=[w * mm for w in larguras], repeatRows=1)
            t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), HexColor("#f3f4f6")), ("LINEBELOW", (0, 0), (-1, -1), 0.3, HexColor("#e5e7eb")),
                                   ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            h.append(t)
        elif tipo == "espaco":
            h.append(Spacer(1, b[1] * mm))
    if assinatura:
        linhas = [f"<b>{esc(assinatura.get('nome') or '')}</b>"]
        if assinatura.get("cargo"):
            linhas.append(esc(assinatura["cargo"]))
        if assinatura.get("registro"):
            linhas.append(esc(assinatura["registro"]))
        bloco = Table([[""], [Paragraph("<br/>".join(linhas), e["rot"])]], colWidths=[85 * mm], rowHeights=[16 * mm, None])
        bloco.setStyle(TableStyle([("LINEABOVE", (0, 1), (0, 1), 0.6, HexColor("#111827")), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
        cidade = assinatura.get("local_data")
        itens = [Spacer(1, 6 * mm)]
        if cidade:
            itens.append(Paragraph(esc(cidade), e["corpo"]))
        itens.append(bloco)
        if assinatura.get("segunda"):
            seg = Table([[""], [Paragraph(f"<b>{esc(assinatura['segunda'])}</b>", e["rot"])]], colWidths=[85 * mm], rowHeights=[16 * mm, None])
            seg.setStyle(TableStyle([("LINEABOVE", (0, 1), (0, 1), 0.6, HexColor("#111827")), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
            bloco = Table([[""], [Paragraph("<br/>".join(linhas), e["rot"])]], colWidths=[75 * mm], rowHeights=[16 * mm, None])
            bloco.setStyle(TableStyle([("LINEABOVE", (0, 1), (0, 1), 0.6, HexColor("#111827")), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
            seg = Table([[""], [Paragraph(f"<b>{esc(assinatura['segunda'])}</b>", e["rot"])]], colWidths=[75 * mm], rowHeights=[16 * mm, None])
            seg.setStyle(TableStyle([("LINEABOVE", (0, 1), (0, 1), 0.6, HexColor("#111827")), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
            dupla = Table([[bloco, seg]], colWidths=[85 * mm, 85 * mm])
            dupla.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0)]))
            itens = itens[:-1] + [dupla]
        h.append(KeepTogether(itens))
    if rodape:
        h.append(Spacer(1, 6 * mm))
        h.extend(_p(rodape, e["peq"]))
    doc.build(h, onFirstPage=moldura, onLaterPages=moldura)
    return buf.getvalue()


def orcamento(*, empresa: dict, paciente: dict, t: dict, profissional: dict | None, odonto: bool) -> bytes:
    com_onde = odonto or any(i.get("regiao") or i.get("dente") for i in t["itens"])
    linhas = [["Procedimento"] + (["Dente/região"] if com_onde else []) + ["Qtd.", "Valor unit.", "Total"]]
    for i in t["itens"]:
        onde = (f"{i.get('dente')}{' ' + ''.join(i.get('faces') or []) if i.get('faces') else ''}" if i.get("dente") else i.get("regiao") or "")
        qtd = f"{i['quantidade']:g} {i.get('unidade') if i.get('unidade') not in (None, 'un') else ''}".strip()
        linhas.append([i["descricao"]] + ([onde] if com_onde else []) + [qtd, _brl(i["valor_unitario"]), _brl(i["quantidade"] * i["valor_unitario"])])
    blocos: list = [("par", [("Paciente", paciente.get("nome")), ("CPF", paciente.get("cpf_cnpj")), ("Telefone", paciente.get("telefone")),
                             ("Profissional", (profissional or {}).get("nome"))]),
                    ("h2", "Procedimentos"), ("tabela", linhas, [70, 26, 18, 28, 28] if com_onde else [96, 18, 28, 28])]
    resumo = [("Subtotal", _brl(t.get("subtotal") or 0))]
    if t.get("desconto"):
        resumo.append(("Desconto", _brl(t["desconto"])))
    resumo.append(("Total", _brl(t.get("total") or 0)))
    parcelas = int(t.get("parcelas") or 1)
    if parcelas > 1:
        resumo.append(("Pagamento", f"{parcelas}x de {_brl(round((t.get('total') or 0) / parcelas, 2))}"))
    criado = t.get("created_at")
    if hasattr(criado, "date") and t.get("validade_dias"):
        from datetime import timedelta

        resumo.append(("Válido até", (criado + timedelta(days=int(t["validade_dias"]))).strftime("%d/%m/%Y")))
    blocos += [("espaco", 3), ("par", resumo)]
    if t.get("observacoes"):
        blocos += [("h2", "Observações"), ("texto", t["observacoes"])]
    blocos += [("peq", "Valores sujeitos a reavaliação clínica. Procedimentos não listados são orçados à parte.")]
    numero = f"Orçamento {t.get('numero') or t['id'][:8].upper()}"
    criado = t.get("created_at")
    return montar(empresa=empresa["nome"], titulo=t.get("titulo") or "Orçamento", cor_primaria=empresa.get("cor"), logo_base64=empresa.get("logo"),
                  contato=empresa.get("contato"),
                  subtitulo=f"{numero} · emitido em {(criado.strftime('%d/%m/%Y') if hasattr(criado, 'strftime') else datetime.now().strftime('%d/%m/%Y'))}",
                  blocos=blocos, assinatura={"nome": paciente.get("nome"), "cargo": "Paciente (de acordo)",
                                             "segunda": (profissional or {}).get("nome") or empresa["nome"]})
