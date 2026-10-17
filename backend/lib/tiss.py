"""Arquivo XML do Padrão TISS (ANS) para um lote de guias SP/SADT.

Gera a mensagem `ENVIO_LOTE_GUIAS` com cabeçalho, lote, guias e o epílogo com o hash MD5. O hash segue a regra do
padrão: MD5 da concatenação, em ordem, do conteúdo de todos os campos da mensagem (sem as tags e sem o próprio hash).

Atenção (dito também na tela): o arquivo NÃO é validado aqui contra o XSD da versão. Domínios (tipo de atendimento,
conselho, CBO, tabela) vêm da configuração da operadora e do profissional. Antes do primeiro envio real, valide no
portal da operadora ou num validador TISS e ajuste o que ela pedir.
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from xml.sax.saxutils import escape

NS = "http://www.ans.gov.br/padroes/tiss/schemas"
VERSAO_PADRAO = "4.03.00"  # obrigatória desde 01/07/2026 (comunicados da ANS e das operadoras)


class _X:
    """Monta o XML guardando os valores na ordem (para o hash do epílogo)."""

    def __init__(self):
        self.partes: list[str] = []
        self.valores: list[str] = []

    def abre(self, tag: str):
        self.partes.append(f"<ans:{tag}>")

    def fecha(self, tag: str):
        self.partes.append(f"</ans:{tag}>")

    def campo(self, tag: str, valor) -> None:
        if valor is None or valor == "":
            return
        v = str(valor)
        self.valores.append(v)
        self.partes.append(f"<ans:{tag}>{escape(v)}</ans:{tag}>")


def _dinheiro(v: float) -> str:
    return f"{float(v or 0):.2f}"


def _so_digitos(v) -> str:
    return "".join(c for c in str(v or "") if c.isdigit())


def gerar_lote(*, operadora: dict, prestador: dict, lote: dict, guias: list[dict], agora: datetime) -> tuple[str, str]:
    """Devolve (xml, hash). `guias`: [{guia, paciente, profissional, itens: [{data, codigo, descricao, valor, quantidade}]}]."""
    x = _X()
    x.abre("cabecalho")
    x.abre("identificacaoTransacao")
    x.campo("tipoTransacao", "ENVIO_LOTE_GUIAS")
    x.campo("sequencialTransacao", lote["numero"])
    x.campo("dataRegistroTransacao", agora.strftime("%Y-%m-%d"))
    x.campo("horaRegistroTransacao", agora.strftime("%H:%M:%S"))
    x.fecha("identificacaoTransacao")
    x.abre("origem")
    x.abre("identificacaoPrestador")
    if operadora.get("codigo_prestador"):
        x.campo("codigoPrestadorNaOperadora", operadora["codigo_prestador"])
    else:
        x.campo("CNPJ", _so_digitos(prestador.get("cnpj")))
    x.fecha("identificacaoPrestador")
    x.fecha("origem")
    x.abre("destino")
    x.campo("registroANS", operadora.get("registro_ans"))
    x.fecha("destino")
    x.campo("Padrao", operadora.get("versao_tiss") or VERSAO_PADRAO)
    x.fecha("cabecalho")

    x.abre("prestadorParaOperadora")
    x.abre("loteGuias")
    x.campo("numeroLote", lote["numero"])
    x.abre("guiasTISS")
    for g in guias:
        guia, pac, prof = g["guia"], g["paciente"], g["profissional"]
        total = round(sum(float(i["valor"]) * int(i.get("quantidade") or 1) for i in g["itens"]), 2)
        x.abre("guiaSP-SADT")
        x.abre("cabecalhoGuia")
        x.campo("registroANS", operadora.get("registro_ans"))
        x.campo("numeroGuiaPrestador", guia.get("numero_prestador"))
        x.fecha("cabecalhoGuia")
        x.abre("dadosAutorizacao")
        x.campo("numeroGuiaOperadora", guia.get("numero_operadora") or guia.get("senha"))
        x.campo("dataAutorizacao", guia.get("data_autorizacao"))
        x.campo("senha", guia.get("senha"))
        x.campo("dataValidadeSenha", guia.get("validade"))
        x.fecha("dadosAutorizacao")
        x.abre("dadosBeneficiario")
        x.campo("numeroCarteira", guia.get("numero_carteira"))
        x.campo("atendimentoRN", "N")
        x.fecha("dadosBeneficiario")
        x.abre("dadosSolicitante")
        x.abre("contratadoSolicitante")
        if operadora.get("codigo_prestador"):
            x.campo("codigoPrestadorNaOperadora", operadora["codigo_prestador"])
        else:
            x.campo("cpfContratado" if len(_so_digitos(prestador.get("cnpj"))) == 11 else "cnpjContratado", _so_digitos(prestador.get("cnpj")))
        x.fecha("contratadoSolicitante")
        x.campo("nomeContratadoSolicitante", prestador.get("nome"))
        x.abre("profissionalSolicitante")
        x.campo("nomeProfissional", guia.get("solicitante_nome") or prof.get("nome"))
        x.campo("conselhoProfissional", guia.get("solicitante_conselho") or prof.get("conselho"))
        x.campo("numeroConselhoProfissional", guia.get("solicitante_numero_conselho") or prof.get("numero_conselho"))
        x.campo("UF", guia.get("solicitante_uf") or prof.get("uf"))
        x.campo("CBOS", guia.get("solicitante_cbos") or prof.get("cbos"))
        x.fecha("profissionalSolicitante")
        x.fecha("dadosSolicitante")
        x.abre("dadosSolicitacao")
        x.campo("caraterAtendimento", "1")
        x.campo("dataSolicitacao", guia.get("data_solicitacao") or guia.get("data_autorizacao"))
        x.campo("indicacaoClinica", guia.get("indicacao_clinica"))
        x.fecha("dadosSolicitacao")
        x.abre("dadosExecutante")
        x.abre("contratadoExecutante")
        if operadora.get("codigo_prestador"):
            x.campo("codigoPrestadorNaOperadora", operadora["codigo_prestador"])
        else:
            x.campo("cnpjContratado", _so_digitos(prestador.get("cnpj")))
        x.campo("nomeContratado", prestador.get("nome"))
        x.fecha("contratadoExecutante")
        x.campo("CNES", operadora.get("cnes") or prestador.get("cnes") or "9999999")
        x.fecha("dadosExecutante")
        x.abre("dadosAtendimento")
        x.campo("tipoAtendimento", operadora.get("tipo_atendimento") or "")
        x.campo("indicacaoAcidente", "9")
        x.campo("regimeAtendimento", operadora.get("regime_atendimento") or "01")
        x.fecha("dadosAtendimento")
        x.abre("procedimentosExecutados")
        for n, i in enumerate(g["itens"], start=1):
            q = int(i.get("quantidade") or 1)
            x.abre("procedimentoExecutado")
            x.campo("sequencialItem", n)
            x.campo("dataExecucao", i["data"])
            x.abre("procedimento")
            x.campo("codigoTabela", operadora.get("codigo_tabela") or "22")
            x.campo("codigoProcedimento", i["codigo"])
            x.campo("descricaoProcedimento", (i.get("descricao") or "")[:150])
            x.fecha("procedimento")
            x.campo("quantidadeExecutada", q)
            x.campo("reducaoAcrescimo", "1.00")
            x.campo("valorUnitario", _dinheiro(i["valor"]))
            x.campo("valorTotal", _dinheiro(float(i["valor"]) * q))
            x.abre("equipeSadt")
            x.campo("grauPart", "12")
            x.abre("codProfissional")
            x.campo("cpfContratado", _so_digitos(prof.get("cpf")))
            x.fecha("codProfissional")
            x.campo("nomeProf", prof.get("nome"))
            x.campo("conselho", prof.get("conselho"))
            x.campo("numeroConselhoProfissional", prof.get("numero_conselho"))
            x.campo("UF", prof.get("uf"))
            x.campo("CBOS", prof.get("cbos"))
            x.fecha("equipeSadt")
            x.fecha("procedimentoExecutado")
        x.fecha("procedimentosExecutados")
        x.abre("valorTotal")
        x.campo("valorProcedimentos", _dinheiro(total))
        x.campo("valorTotalGeral", _dinheiro(total))
        x.fecha("valorTotal")
        x.fecha("guiaSP-SADT")
    x.fecha("guiasTISS")
    x.fecha("loteGuias")
    x.fecha("prestadorParaOperadora")
    h = hashlib.md5("".join(x.valores).encode("iso-8859-1", errors="replace")).hexdigest()
    corpo = "".join(x.partes)
    xml = (f'<?xml version="1.0" encoding="ISO-8859-1"?>\n<ans:mensagemTISS xmlns:ans="{NS}" '
           f'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">{corpo}<ans:epilogo><ans:hash>{h}</ans:hash></ans:epilogo></ans:mensagemTISS>')
    return xml, h
