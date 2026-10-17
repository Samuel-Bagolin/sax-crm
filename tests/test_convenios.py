"""Convênios: operadora, guia com saldo de sessões consumido pela presença, lote de faturamento, XML TISS e recebimento."""

import hashlib
import xml.etree.ElementTree as ET
from datetime import date, timedelta

from test_segmentos import _cadastrar, cartao_demo, sysadmin  # noqa: F401  (fixtures)
from test_sessoes import _agendar, _preparar

NS = {"ans": "http://www.ans.gov.br/padroes/tiss/schemas"}


def test_guia_lote_xml_e_recebimento(cartao_demo):  # noqa: F811
    c, _ = _cadastrar("terapia", cartao_demo)
    me, grupo, ind = _preparar(c)
    assert c.get("/convenios/modelos").json()["operadoras"][0]["registro_ans"] == "005711"
    base = {"nome": "Bradesco Saúde", "registro_ans": "005711", "codigo_prestador": "PREST123", "tipo_atendimento": "13",
            "tabela": [{"servico_id": ind["id"], "codigo": "12345678", "descricao": "Sessão individual", "valor": 80}]}
    assert c.post("/convenios", json={**base, "registro_ans": "5711"}).status_code == 422
    conv = c.post("/convenios", json=base).json()
    assert c.post("/convenios", json=base).status_code == 409

    hoje = date.today()
    a1 = _agendar(c, me, ind, (hoje - timedelta(days=2)).isoformat(), "09:00", "Paula Convênio", "41990000301")
    pid = a1["cliente_id"]
    # presença antes de cadastrar a guia: a guia consome quando entra
    c.post(f"/sessoes/{a1['id']}/presenca", json={"cliente_id": pid, "presenca": "presente"})
    guia = {"convenio_id": conv["id"], "paciente_id": pid, "numero_carteira": "7654321000", "servico_id": ind["id"], "status": "autorizada",
            "senha": "SENHA99", "data_autorizacao": (hoje - timedelta(days=5)).isoformat(), "validade": (hoje + timedelta(days=5)).isoformat(),
            "sessoes_autorizadas": 2}
    assert c.post("/convenios/guias", json={**guia, "senha": None}).status_code == 422
    g = c.post("/convenios/guias", json=guia).json()
    assert g["usadas"] == 1 and g["saldo"] == 1 and g["numero_prestador"] == "00000001" and g["alerta"]  # saldo baixo e vence em 5 dias
    a2 = _agendar(c, me, ind, (hoje - timedelta(days=1)).isoformat(), "09:00", "Paula Convênio", "41990000301")
    c.post(f"/sessoes/{a2['id']}/presenca", json={"cliente_id": pid, "presenca": "presente"})
    a3 = _agendar(c, me, ind, hoje.isoformat(), "01:00", "Paula Convênio", "41990000301")
    c.post(f"/sessoes/{a3['id']}/presenca", json={"cliente_id": pid, "presenca": "presente"})
    gs = c.get("/convenios/guias", params={"paciente_id": pid}).json()
    assert gs[0]["usadas"] == 2 and gs[0]["situacao"] == "esgotada"
    # tirar a presença devolve a sessão
    c.post(f"/sessoes/{a2['id']}/presenca", json={"cliente_id": pid, "presenca": None})
    assert c.get("/convenios/guias", params={"paciente_id": pid}).json()[0]["usadas"] == 1
    c.post(f"/sessoes/{a2['id']}/presenca", json={"cliente_id": pid, "presenca": "presente"})
    assert c.get(f"/pacientes/{pid}").json()["paciente"]["carteiras"][0]["numero"] == "7654321000"

    # lote
    ini, fim = (hoje - timedelta(days=10)).isoformat(), hoje.isoformat()
    assert c.get("/convenios/a-faturar", params={"convenio_id": conv["id"], "inicio": ini, "fim": fim}).json()["sessoes"] == 2
    lote = c.post("/convenios/lotes", json={"convenio_id": conv["id"], "inicio": ini, "fim": fim}).json()
    assert lote["numero"] == 1 and lote["sessoes"] == 2 and lote["total"] == 160
    assert c.post("/convenios/lotes", json={"convenio_id": conv["id"], "inicio": ini, "fim": fim}).status_code == 422  # já faturadas
    r = c.get(f"/convenios/lotes/{lote['id']}/xml")
    assert r.status_code == 422 and "dados TISS" in r.json()["detail"]
    assert c.put(f"/convenios/profissionais/{me['usuario_id']}", json={"conselho": "09", "numero_conselho": "123456", "uf": "PR", "cbos": "251510"}).status_code == 200
    r = c.get(f"/convenios/lotes/{lote['id']}/xml")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    raiz = ET.fromstring(r.content)
    assert raiz.find(".//ans:destino/ans:registroANS", NS).text == "005711"
    assert raiz.find(".//ans:Padrao", NS).text == "4.03.00"
    assert raiz.find(".//ans:numeroCarteira", NS).text == "7654321000"
    assert len(raiz.findall(".//ans:procedimentoExecutado", NS)) == 2
    assert raiz.find(".//ans:valorTotalGeral", NS).text == "160.00"
    # hash do epílogo: MD5 do conteúdo dos campos em ordem
    textos = "".join(e.text for e in raiz.iter() if e.text and not list(e) and e.tag != f"{{{NS['ans']}}}hash")
    assert raiz.find(".//ans:epilogo/ans:hash", NS).text == hashlib.md5(textos.encode("iso-8859-1")).hexdigest()

    # envio e recebimento com glosa
    assert c.post(f"/convenios/lotes/{lote['id']}/enviado", json={"protocolo": "PRT-1"}).json()["status"] == "enviado"
    assert c.delete(f"/convenios/lotes/{lote['id']}").status_code == 409
    assert c.post(f"/convenios/lotes/{lote['id']}/recebido", json={"valor": 200, "data": fim}).status_code == 422
    l = c.post(f"/convenios/lotes/{lote['id']}/recebido", json={"valor": 80, "data": fim, "motivo_glosa": "Senha vencida"}).json()
    assert l["status"] == "pago_com_glosa" and l["glosa"] == 80
    tx = [t for t in c.get("/transacoes").json() if t["descricao"].startswith("Convênio Bradesco")]
    assert len(tx) == 1 and tx[0]["valor"] == 80 and tx[0]["status"] == "pago"
    assert c.post(f"/convenios/lotes/{lote['id']}/recebido", json={"valor": 80, "data": fim}).status_code == 409
