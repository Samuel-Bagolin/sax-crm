"""Seed idempotente de demonstração — pessoas, plano de contas (3 níveis), 8 imóveis,
12 leads distribuídos no funil e ~26 lançamentos financeiros espalhados nos últimos meses.

Executar: cd /app/backend && python seed.py
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from lib.auth import hash_senha
from lib.db import db, ensure_indexes

# Contas de acesso criadas pelo seed (senhas de demonstração).
USUARIOS = [
    {"nome": "Gestor da Imobiliária", "email": "admin@imobierp.com", "senha": "admin123", "papel": "admin", "corretor_key": None},
    {"nome": "Carlos Menezes", "email": "carlos@imobierp.com", "senha": "corretor123", "papel": "corretor", "corretor_key": "carlos"},
    {"nome": "Patrícia Lopes", "email": "patricia@imobierp.com", "senha": "corretor123", "papel": "corretor", "corretor_key": "patricia"},
]

FOTOS = [
    "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?crop=entropy&cs=srgb&fm=jpg&q=85",
    "https://images.unsplash.com/photo-1624204386084-dd8c05e32226?crop=entropy&cs=srgb&fm=jpg&q=85",
    "https://images.unsplash.com/photo-1760067537255-64d36262cb0a?crop=entropy&cs=srgb&fm=jpg&q=85",
    "https://images.unsplash.com/photo-1760067537293-6b30141d6a52?crop=entropy&cs=srgb&fm=jpg&q=85",
    "https://images.unsplash.com/photo-1516501312919-d0cb0b7b60b8?crop=entropy&cs=srgb&fm=jpg&q=85",
    "https://images.unsplash.com/photo-1515263487990-61b07816b324?crop=entropy&cs=srgb&fm=jpg&q=85",
]

PESSOAS = [
    {"key": "mariana", "nome": "Mariana Costa", "papeis": ["proprietario"], "cpf_cnpj": "312.445.670-11", "telefone": "(11) 98877-1010", "email": "mariana.costa@email.com"},
    {"key": "roberto", "nome": "Roberto Nakamura", "papeis": ["proprietario"], "cpf_cnpj": "402.118.339-70", "telefone": "(11) 97766-2020", "email": "roberto.nakamura@email.com"},
    {"key": "helena", "nome": "Helena Duarte", "papeis": ["proprietario"], "cpf_cnpj": "158.902.447-28", "telefone": "(48) 99123-4040", "email": "helena.duarte@email.com"},
    {"key": "carlos", "nome": "Carlos Menezes", "papeis": ["corretor"], "cpf_cnpj": "275.331.890-05", "telefone": "(11) 99111-5050", "email": "carlos@imobiliaria.com"},
    {"key": "patricia", "nome": "Patrícia Lopes", "papeis": ["corretor"], "cpf_cnpj": "390.774.210-86", "telefone": "(11) 99222-6060", "email": "patricia@imobiliaria.com"},
    {"key": "joao", "nome": "João Batista", "papeis": ["cliente"], "telefone": "(11) 96555-7070", "email": "joao.batista@email.com"},
    {"key": "fernanda", "nome": "Fernanda Rocha", "papeis": ["cliente"], "telefone": "(11) 96444-8080", "email": "fernanda.rocha@email.com"},
    {"key": "andre", "nome": "André Sanchez", "papeis": ["cliente"], "telefone": "(21) 96333-9090", "email": "andre.sanchez@email.com"},
    {"key": "luiza", "nome": "Luiza Prado", "papeis": ["cliente"], "telefone": "(48) 96222-0101", "email": "luiza.prado@email.com"},
    {"key": "pedro", "nome": "Pedro Assunção", "papeis": ["cliente"], "telefone": "(11) 96111-0202", "email": "pedro.assuncao@email.com"},
    {"key": "clara", "nome": "Clara Fuentes", "papeis": ["cliente"], "telefone": "(11) 96000-0303", "email": "clara.fuentes@email.com"},
    {"key": "tiago", "nome": "Tiago Barreto", "papeis": ["cliente"], "telefone": "(41) 95999-0404", "email": "tiago.barreto@email.com"},
]

PLANO = [
    # (codigo, nome, tipo, codigo_pai) — pais antes dos filhos
    ("1", "Receitas", "receita", None),
    ("1.1", "Comissões", "receita", "1"),
    ("1.1.1", "Comissão de Venda", "receita", "1.1"),
    ("1.1.2", "Comissão de Locação", "receita", "1.1"),
    ("1.2", "Administração", "receita", "1"),
    ("1.2.1", "Taxa de Administração de Locação", "receita", "1.2"),
    ("2", "Despesas", "despesa", None),
    ("2.1", "Marketing", "despesa", "2"),
    ("2.1.1", "Anúncios em Portais", "despesa", "2.1"),
    ("2.1.2", "Ads / Redes Sociais", "despesa", "2.1"),
    ("2.2", "Operacional", "despesa", "2"),
    ("2.2.1", "Aluguel do Escritório", "despesa", "2.2"),
    ("2.2.2", "Materiais e Expediente", "despesa", "2.2"),
    ("2.3", "Custos de Imóveis", "despesa", "2"),
    ("2.3.1", "IPTU", "despesa", "2.3"),
    ("2.3.2", "Condomínio", "despesa", "2.3"),
    ("2.3.3", "Manutenção e Reparos", "despesa", "2.3"),
]

IMOVEIS = [
    {"key": "im1", "titulo": "Apartamento 3 quartos Vila Mariana", "tipo": "apartamento", "finalidade": "venda", "status": "publicado", "endereco": "Rua Joaquim Távora, 420 — apto 82", "bairro": "Vila Mariana", "cidade": "São Paulo", "estado": "SP", "cep": "04015-011", "area_util": 96.0, "area_total": 112.0, "quartos": 3, "suites": 1, "vagas": 2, "valor_venda": 780000.0, "valor_aluguel": None, "iptu": 118.0, "condominio": 850.0, "proprietario": "mariana", "descricao": "Apartamento reformado, sala ampla integrada e varanda gourmet a 400m do metrô Ana Rosa.", "foto_url": FOTOS[0], "created": 92},
    {"key": "im2", "titulo": "Casa em condomínio — Alphaville", "tipo": "casa", "finalidade": "venda", "status": "publicado", "endereco": "Alameda Rio Negro, 500", "bairro": "Alphaville", "cidade": "Barueri", "estado": "SP", "cep": "06455-000", "area_util": 210.0, "area_total": 320.0, "quartos": 4, "suites": 3, "vagas": 4, "valor_venda": 1450000.0, "valor_aluguel": None, "iptu": 310.0, "condominio": 1200.0, "proprietario": "roberto", "descricao": "Casa térrea em condomínio fechado com piscina aquecida e área gourmet completa.", "foto_url": FOTOS[2], "created": 74},
    {"key": "im3", "titulo": "Cobertura frente mar — Copacabana", "tipo": "apartamento", "finalidade": "venda", "status": "captado", "endereco": "Av. Atlântica, 3200 — cobertura", "bairro": "Copacabana", "cidade": "Rio de Janeiro", "estado": "RJ", "cep": "22070-001", "area_util": 260.0, "area_total": 260.0, "quartos": 4, "suites": 4, "vagas": 3, "valor_venda": 2100000.0, "valor_aluguel": None, "iptu": 640.0, "condominio": 2100.0, "proprietario": "helena", "descricao": "Cobertura duplex com vista panorâmica para o mar e terraço com piscina privativa.", "foto_url": FOTOS[1], "created": 55},
    {"key": "im4", "titulo": "Apartamento 2 quartos — Centro Histórico", "tipo": "apartamento", "finalidade": "locacao", "status": "alugado", "endereco": "Rua Felipe Schmidt, 190 — apto 301", "bairro": "Centro", "cidade": "Florianópolis", "estado": "SC", "cep": "88010-620", "area_util": 68.0, "area_total": 68.0, "quartos": 2, "suites": 0, "vagas": 1, "valor_venda": None, "valor_aluguel": 3200.0, "iptu": 85.0, "condominio": 480.0, "proprietario": "helena", "descricao": "Prédio histórico restaurado no coração da ilha, a duas quadras da beira-mar.", "foto_url": FOTOS[4], "created": 210},
    {"key": "im5", "titulo": "Sala comercial — Batel", "tipo": "comercial", "finalidade": "ambos", "status": "captado", "endereco": "Av. do Batel, 1630 — conj. 1408", "bairro": "Batel", "cidade": "Curitiba", "estado": "PR", "cep": "80420-090", "area_util": 84.0, "area_total": 84.0, "quartos": 0, "suites": 0, "vagas": 2, "valor_venda": 690000.0, "valor_aluguel": 5500.0, "iptu": 145.0, "condominio": 930.0, "proprietario": "roberto", "descricao": "Sala em edifício corporativo premium, recepción e sala de reunião compartilhada.", "foto_url": FOTOS[5], "created": 30},
    {"key": "im6", "titulo": "Casa 3 quartos — Interlagos", "tipo": "casa", "finalidade": "venda", "status": "publicado", "endereco": "Rua Ruiz de Melo, 115", "bairro": "Interlagos", "cidade": "São Paulo", "estado": "SP", "cep": "04781-100", "area_util": 130.0, "area_total": 180.0, "quartos": 3, "suites": 1, "vagas": 2, "valor_venda": 620000.0, "valor_aluguel": None, "iptu": 96.0, "condominio": 0.0, "proprietario": "mariana", "descricao": "Casa sobrado com quintal, churrasqueira e depósito — ótima para famílias.", "foto_url": FOTOS[3], "created": 48},
    {"key": "im7", "titulo": "Terreno 360m² — Jardim do Lago", "tipo": "terreno", "finalidade": "venda", "status": "captado", "endereco": "Rua das Hortênsias, lote 12", "bairro": "Jardim do Lago", "cidade": "Gramado", "estado": "RS", "cep": "95670-000", "area_util": None, "area_total": 360.0, "quartos": 0, "suites": 0, "vagas": 0, "valor_venda": 350000.0, "valor_aluguel": None, "iptu": 42.0, "condominio": None, "proprietario": "roberto", "descricao": "Terreno plano em rua asfaltada, pronto para construir, documentação em ordem.", "foto_url": None, "created": 18},
    {"key": "im8", "titulo": "Studio compacto — Bela Vista", "tipo": "apartamento", "finalidade": "locacao", "status": "alugado", "endereco": "Rua Augusto de Lima, 205 — unit 1104", "bairro": "Bela Vista", "cidade": "São Paulo", "estado": "SP", "cep": "01402-000", "area_util": 34.0, "area_total": 34.0, "quartos": 1, "suites": 0, "vagas": 0, "valor_venda": None, "valor_aluguel": 2400.0, "iptu": 38.0, "condominio": 420.0, "proprietario": "mariana", "descricao": "Studio mobiliado a 200m da Av. Paulista — ideal para executivos.", "foto_url": FOTOS[0], "created": 160},
]

LEADS = [
    {"nome": "André Sanchez", "cliente": "andre", "imovel": "im1", "corretor": "carlos", "origem": "Portal ZAP", "estagio": "ganho", "valor": 780000.0, "created": 62, "closed": 40, "obs": "Proposta aceita com financiamento aprovado em 30 dias."},
    {"nome": "Luiza Prado", "cliente": "luiza", "imovel": "im8", "corretor": "patricia", "origem": "Instagram / Facebook Ads", "estagio": "ganho", "valor": 2400.0, "created": 50, "closed": 26, "obs": "Contrato de locação de 30 meses assinado."},
    {"nome": "Pedro Assunção", "cliente": "pedro", "imovel": "im2", "corretor": "carlos", "origem": "OLX", "estagio": "perdido", "valor": 1450000.0, "created": 41, "closed": 12, "obs": "Preço acima do orçamento — desistiu após a visita."},
    {"nome": "Clara Fuentes", "cliente": "clara", "imovel": "im6", "corretor": "carlos", "origem": "VivaReal", "estagio": "proposta", "valor": 595000.0, "created": 22, "closed": None, "obs": "Proposta de 595k enviada, aguardando resposta do proprietário."},
    {"nome": "Tiago Barreto", "cliente": "tiago", "imovel": "im3", "corretor": "patricia", "origem": "Portal ZAP", "estagio": "proposta", "valor": 1980000.0, "created": 15, "closed": None, "obs": "Investidor — proposta à vista com 30% de entrada."},
    {"nome": "Fernanda Rocha", "cliente": "fernanda", "imovel": "im4", "corretor": "patricia", "origem": "Site Imobiliária", "estagio": "visita", "valor": 3200.0, "created": 9, "closed": None, "obs": "Visita agendada para sábado às 10h."},
    {"nome": "Marcos Vieira", "cliente": None, "imovel": "im5", "corretor": "carlos", "origem": "Placa no Local", "estagio": "visita", "valor": 5500.0, "created": 6, "closed": None, "obs": "Quer conhecer a estrutura do prédio."},
    {"nome": "Juliana Prates", "cliente": None, "imovel": "im6", "corretor": "patricia", "origem": "Indicação / Carteira", "estagio": "atendimento", "valor": 620000.0, "created": 4, "closed": None, "obs": "Indicação de cliente antigo — primeira conversa feita."},
    {"nome": "Rodrigo Alencar", "cliente": None, "imovel": "im3", "corretor": "carlos", "origem": "Portal ZAP", "estagio": "atendimento", "valor": 2100000.0, "created": 3, "closed": None, "obs": "Prefere contato por WhatsApp."},
    {"nome": "Sérgio Pimentel", "cliente": None, "imovel": "im7", "corretor": None, "origem": "OLX", "estagio": "novo", "valor": 350000.0, "created": 2, "closed": None, "obs": "Ligou pedindo condições de pagamento."},
    {"nome": "Bianca Torres", "cliente": None, "imovel": "im4", "corretor": None, "origem": "VivaReal", "estagio": "novo", "valor": 3200.0, "created": 1, "closed": None, "obs": None},
    {"nome": "Eduardo Lisboa", "cliente": None, "imovel": "im2", "corretor": None, "origem": "Instagram / Facebook Ads", "estagio": "novo", "valor": 1450000.0, "created": 0, "closed": None, "obs": "Formulário do anúncio preenchido ontem."},
]


def dia(offset: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=offset)).strftime("%Y-%m-%d")


def dt_passado(dias: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=dias)


async def main() -> None:
    if await db.imoveis.count_documents({}) > 0 and await db.usuarios.count_documents({}) > 0:
        print("Seed já aplicado — nada a fazer.")
        return

    # Pessoas (cadastro único universal, papel contextual)
    ids: dict[str, str] = {}
    pessoas_docs = []
    for p in PESSOAS:
        pid = str(uuid.uuid4())
        ids[p["key"]] = pid
        pessoas_docs.append({
            "id": pid,
            "nome": p["nome"],
            "papeis": p["papeis"],
            "cpf_cnpj": p.get("cpf_cnpj"),
            "telefone": p.get("telefone"),
            "email": p.get("email"),
            "created_at": dt_passado(300),
        })
    await db.pessoas.insert_many(pessoas_docs)

    # Plano de contas hierárquico (pais antes dos filhos)
    plano_ids: dict[str, str] = {}
    plano_docs = []
    for codigo, nome, tipo, pai in PLANO:
        cid = str(uuid.uuid4())
        plano_ids[codigo] = cid
        plano_docs.append({
            "id": cid,
            "codigo": codigo,
            "nome": nome,
            "tipo": tipo,
            "conta_pai_id": plano_ids.get(pai),
            "created_at": dt_passado(300),
        })
    await db.plano_contas.insert_many(plano_docs)

    # Imóveis
    im_ids: dict[str, str] = {}
    imoveis_docs = []
    for im in IMOVEIS:
        iid = str(uuid.uuid4())
        im_ids[im["key"]] = iid
        imoveis_docs.append({
            "id": iid,
            "titulo": im["titulo"],
            "tipo": im["tipo"],
            "finalidade": im["finalidade"],
            "status": im["status"],
            "endereco": im["endereco"],
            "bairro": im["bairro"],
            "cidade": im["cidade"],
            "estado": im["estado"],
            "cep": im["cep"],
            "area_util": im["area_util"],
            "area_total": im["area_total"],
            "quartos": im["quartos"],
            "suites": im["suites"],
            "vagas": im["vagas"],
            "valor_venda": im["valor_venda"],
            "valor_aluguel": im["valor_aluguel"],
            "iptu": im["iptu"],
            "condominio": im["condominio"],
            "proprietario_id": ids[im["proprietario"]],
            "descricao": im["descricao"],
            "foto_url": im["foto_url"],
            "created_at": dt_passado(im["created"]),
            "updated_at": dt_passado(max(0, im["created"] // 4)),
        })
    await db.imoveis.insert_many(imoveis_docs)

    # Leads do funil
    leads_docs = []
    for l in LEADS:
        leads_docs.append({
            "id": str(uuid.uuid4()),
            "nome": l["nome"],
            "cliente_id": ids[l["cliente"]] if l.get("cliente") else None,
            "imovel_id": im_ids[l["imovel"]] if l.get("imovel") else None,
            "corretor_id": ids[l["corretor"]] if l.get("corretor") else None,
            "origem": l["origem"],
            "estagio": l["estagio"],
            "valor_estimado": l["valor"],
            "observacoes": l.get("obs"),
            "created_at": dt_passado(l["created"]),
            "updated_at": dt_passado(l["closed"] if l.get("closed") is not None else l["created"]),
            "closed_at": dt_passado(l["closed"]) if l.get("closed") is not None else None,
        })
    await db.leads.insert_many(leads_docs)

    # Lançamentos financeiros
    trans_docs = []

    def lanc(descricao, tipo, valor, codigo, imovel_key, pessoa_key, venc_off, pag_off, corretor_key=None):
        trans_docs.append({
            "id": str(uuid.uuid4()),
            "descricao": descricao,
            "tipo": tipo,
            "valor": valor,
            "plano_conta_id": plano_ids[codigo],
            "imovel_id": im_ids[imovel_key] if imovel_key else None,
            "pessoa_id": ids[pessoa_key] if pessoa_key else None,
            "corretor_id": ids[corretor_key] if corretor_key else None,
            "vencimento": dia(venc_off),
            "pagamento": dia(pag_off) if pag_off is not None else None,
            "status": "pago" if pag_off is not None else "pendente",
            "vencido": False,
            "created_at": dt_passado(abs(venc_off) + 5),
        })

    # Comissões das vendas/locações fechadas (leads ganhos) — carimbadas com o corretor dono
    lanc("Comissão de venda — Apartamento Vila Mariana", "receber", 39000.0, "1.1.1", "im1", "andre", -35, -34, "carlos")
    lanc("Comissão de locação — Studio Bela Vista (1º aluguel)", "receber", 2400.0, "1.1.2", "im8", "luiza", -25, -24, "patricia")
    # Taxa de administração mensal do studio alugado (5 meses realizados + mês corrente pendente)
    for off in (-150, -120, -90, -60, -30):
        lanc("Taxa de administração — Studio Bela Vista", "receber", 240.0, "1.2.1", "im8", "luiza", off, off + 2)
    lanc("Taxa de administração — Studio Bela Vista", "receber", 240.0, "1.2.1", "im8", "luiza", 5, None)
    # Aluguel do escritório (5 meses realizados + mês corrente pendente)
    for off in (-155, -125, -95, -65, -25):
        lanc("Aluguel do escritório", "pagar", 1800.0, "2.2.1", None, None, off, off + 1)
    lanc("Aluguel do escritório", "pagar", 1800.0, "2.2.1", None, None, 10, None)
    # Marketing
    for off in (-120, -90, -60):
        lanc("Anúncios em portais", "pagar", 400.0, "2.1.1", None, None, off, off + 1)
    lanc("Anúncios em portais", "pagar", 400.0, "2.1.1", None, None, -2, None)  # vencido de propósito
    lanc("Ads / Instagram", "pagar", 250.0, "2.1.2", None, None, -45, -44)
    lanc("Ads / Instagram", "pagar", 250.0, "2.1.2", None, None, -15, -14)
    # Operacional
    lanc("Materiais e expediente", "pagar", 120.0, "2.2.2", None, None, -80, -79)
    lanc("Materiais e expediente", "pagar", 95.0, "2.2.2", None, None, -5, -4)
    # Custos de imóveis
    lanc("IPTU parcela — Casa Alphaville", "pagar", 310.0, "2.3.1", "im2", "roberto", 18, None)
    lanc("Condomínio — Apartamento Vila Mariana", "pagar", 850.0, "2.3.2", "im1", "mariana", 8, None)
    lanc("Manutenção hidráulica — Centro Histórico", "pagar", 650.0, "2.3.3", "im4", "helena", -20, -19)
    await db.transacoes.insert_many(trans_docs)

    # Contas de acesso — corretores apontam para a Pessoa que carrega a carteira
    usuarios_docs = []
    for u in USUARIOS:
        usuarios_docs.append({
            "id": str(uuid.uuid4()),
            "nome": u["nome"],
            "email": u["email"],
            "senha_hash": hash_senha(u["senha"]),
            "papel": u["papel"],
            "pessoa_id": ids[u["corretor_key"]] if u["corretor_key"] else None,
            "ativo": True,
            "created_at": dt_passado(300),
        })
    await db.usuarios.insert_many(usuarios_docs)

    await ensure_indexes()
    print(f"Seed concluído: {len(pessoas_docs)} pessoas, {len(plano_docs)} contas, "
          f"{len(imoveis_docs)} imóveis, {len(leads_docs)} leads, {len(trans_docs)} lançamentos, "
          f"{len(usuarios_docs)} usuários.")
    for u in USUARIOS:
        print(f"  login: {u['email']} / {u['senha']}  ({u['papel']})")


if __name__ == "__main__":
    asyncio.run(main())
