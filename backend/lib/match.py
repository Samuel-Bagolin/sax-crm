"""Compatibilidade cliente ↔ imóvel.

Regra explicável (o corretor vê os motivos), sem caixa-preta:
- Eliminatório: finalidade incompatível, imóvel vendido/alugado ou valor mais de 15% acima do teto.
- Nota de 0 a 100: tipo 25 · localização 25 · valor 25 · quartos 15 · vagas 5 · área 5.
  Critério que o cliente não informou conta como atendido (não pune perfil incompleto).
"""

import unicodedata

PESOS = {"tipo": 25, "local": 25, "valor": 25, "quartos": 15, "vagas": 5, "area": 5}
TOLERANCIA_VALOR = 0.15


def _norm(t: str | None) -> str:
    t = unicodedata.normalize("NFKD", (t or "").strip().lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def _brl(v: float) -> str:
    if v >= 1_000_000:
        return f"R$ {v / 1_000_000:.2f} mi".replace(".", ",")
    if v >= 1000:
        return f"R$ {round(v / 1000):.0f} mil"
    return f"R$ {v:.0f}"


def valor_do_imovel(imovel: dict, finalidade: str | None) -> float | None:
    if finalidade == "locacao":
        return imovel.get("valor_aluguel")
    return imovel.get("valor_venda") if imovel.get("valor_venda") is not None else imovel.get("valor_aluguel")


def perfil_vazio(perfil: dict | None) -> bool:
    if not perfil:
        return True
    campos = ("tipos", "cidades", "bairros", "valor_max", "valor_min", "quartos_min", "vagas_min", "area_min")
    return not any(perfil.get(c) for c in campos)


def pontuar(perfil: dict, imovel: dict) -> dict | None:
    """Devolve {score, motivos, alertas} ou None se o imóvel for eliminado."""
    if imovel.get("status") in ("vendido", "alugado"):
        return None
    finalidade = perfil.get("finalidade") or "venda"
    fin_imovel = imovel.get("finalidade")
    if fin_imovel != "ambos" and fin_imovel != finalidade:
        return None

    pontos = 0.0
    motivos: list[str] = []
    alertas: list[str] = []

    # tipo
    tipos = perfil.get("tipos") or []
    if not tipos or imovel.get("tipo") in tipos:
        pontos += PESOS["tipo"]
        if tipos:
            motivos.append("Tipo desejado")
    else:
        alertas.append(f"Tipo diferente ({imovel.get('tipo')})")

    # localização: bairro vale cheio, só a cidade vale 60%
    bairros = [_norm(b) for b in perfil.get("bairros") or [] if b.strip()]
    cidades = [_norm(c) for c in perfil.get("cidades") or [] if c.strip()]
    bairro, cidade = _norm(imovel.get("bairro")), _norm(imovel.get("cidade"))
    cidade_ok = not cidades or cidade in cidades
    if bairros and bairro and bairro in bairros and cidade_ok:
        pontos += PESOS["local"]
        motivos.append(f"Bairro {imovel.get('bairro')}")
    elif cidade_ok and not bairros:
        pontos += PESOS["local"]
        if cidades:
            motivos.append(f"Em {imovel.get('cidade')}")
    elif cidade_ok:
        pontos += PESOS["local"] * 0.6
        alertas.append(f"Outro bairro ({imovel.get('bairro') or 'não informado'})")
    else:
        alertas.append(f"Outra cidade ({imovel.get('cidade')})")

    # valor
    valor = valor_do_imovel(imovel, finalidade)
    vmax, vmin = perfil.get("valor_max"), perfil.get("valor_min")
    if valor is None:
        pontos += PESOS["valor"] * 0.5
        alertas.append("Imóvel sem valor cadastrado")
    elif vmax and valor > vmax * (1 + TOLERANCIA_VALOR):
        return None
    elif vmax and valor > vmax:
        acima = (valor / vmax - 1) * 100
        pontos += PESOS["valor"] * (1 - acima / (TOLERANCIA_VALOR * 100)) * 0.7
        alertas.append(f"{acima:.0f}% acima do orçamento")
    elif vmin and valor < vmin * 0.7:
        pontos += PESOS["valor"] * 0.5
        alertas.append("Bem abaixo da faixa pedida")
    else:
        pontos += PESOS["valor"]
        if vmax:
            motivos.append(f"Dentro do orçamento ({_brl(valor)})")

    # quartos, vagas, área: proporcional quando falta pouco
    for campo, chave, rotulo, peso in (("quartos", "quartos_min", "quartos", "quartos"), ("vagas", "vagas_min", "vagas", "vagas"),
                                       ("area_util", "area_min", "m²", "area")):
        pedido = perfil.get(chave) or 0
        tem = imovel.get(campo) or 0
        if not pedido:
            pontos += PESOS[peso]
        elif tem >= pedido:
            pontos += PESOS[peso]
            if campo != "area_util":
                motivos.append(f"{tem} {rotulo}")
            else:
                motivos.append(f"{tem:.0f} m²")
        else:
            pontos += PESOS[peso] * max(0.0, tem / pedido) * 0.5
            alertas.append(f"{tem:.0f} {rotulo} (pediu {pedido:.0f}+)" if campo == "area_util" else f"{tem} {rotulo} (pediu {pedido}+)")

    return {"score": round(pontos), "motivos": motivos[:4], "alertas": alertas[:3]}


def perfil_do_imovel(imovel: dict) -> dict:
    """Sugestão de perfil a partir do imóvel de interesse (preenche o formulário em 1 clique)."""
    finalidade = "locacao" if imovel.get("finalidade") == "locacao" else "venda"
    valor = valor_do_imovel(imovel, finalidade)
    return {
        "finalidade": finalidade,
        "tipos": [imovel["tipo"]] if imovel.get("tipo") else [],
        "cidades": [imovel["cidade"]] if imovel.get("cidade") else [],
        "bairros": [imovel["bairro"]] if imovel.get("bairro") else [],
        "valor_min": round(valor * 0.8, -3) if valor else None,
        "valor_max": round(valor * 1.1, -3) if valor else None,
        "quartos_min": imovel.get("quartos") or None,
        "vagas_min": imovel.get("vagas") or None,
        "area_min": None,
        "observacao": None,
    }
