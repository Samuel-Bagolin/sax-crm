"""Migração única: move os dados atuais (banco de controle) para o banco da primeira empresa.

Depois dela, o banco de controle guarda apenas o registro de empresas, as contas de
Administrador de Sistema e o índice e-mail → empresa.

Executar: cd /app/backend && python migrar_para_empresa.py "Nome da Empresa"
"""

import asyncio
import sys

from lib.db import client, controle, ensure_indexes_empresa, nome_banco_empresa
from models.empresas import Empresa, slugificar
from lib.tenant import indexar_usuario, provisionar_empresa

COLECOES = [
    "pessoas",
    "imoveis",
    "leads",
    "plano_contas",
    "transacoes",
    "contratos",
    "visitas",
    "configuracoes",
    "config_logs",
]


async def main() -> None:
    nome = sys.argv[1] if len(sys.argv) > 1 else "Minha Imobiliária"
    slug = slugificar(sys.argv[2] if len(sys.argv) > 2 else nome)

    existente = await controle.empresas.find_one({"slug": slug})
    if existente:
        print(f"Empresa '{slug}' já existe — nada a fazer.")
        return

    db_name = nome_banco_empresa(slug)
    destino = client[db_name]
    await ensure_indexes_empresa(db_name)

    # 1) copia as coleções de negócio
    for colecao in COLECOES:
        docs = await controle[colecao].find().to_list(100000)
        if docs:
            await destino[colecao].delete_many({})
            await destino[colecao].insert_many(docs)
        print(f"{colecao}: {len(docs)} documento(s)")

    # 2) usuários: admin/corretor vão para a empresa; sysadmin fica no controle
    usuarios = await controle.usuarios.find({"papel": {"$ne": "sysadmin"}}).to_list(1000)
    if usuarios:
        await destino.usuarios.delete_many({"papel": {"$ne": "sysadmin"}})
        await destino.usuarios.insert_many(usuarios)
    print(f"usuarios da empresa: {len(usuarios)}")

    config = await destino.configuracoes.find_one({"id": "singleton"}, {"site_api_key": 1})
    api_key = (config or {}).get("site_api_key")
    if not api_key:
        api_key = await provisionar_empresa(nome=nome, db_name=db_name, admin=usuarios[0] if usuarios else {})

    empresa = Empresa(nome=nome, slug=slug, db_name=db_name, site_api_key=api_key)
    await controle.empresas.insert_one(empresa.model_dump())
    for u in usuarios:
        await indexar_usuario(u["email"], empresa.id, db_name)

    # 3) limpa do controle o que agora pertence à empresa
    for colecao in COLECOES:
        await controle[colecao].drop()
    await controle.usuarios.delete_many({"papel": {"$ne": "sysadmin"}})

    print(f"\nEmpresa '{nome}' ({slug}) criada no banco {db_name}.")
    print("Banco de controle mantém: empresas, usuarios (sysadmin) e usuarios_index.")


if __name__ == "__main__":
    asyncio.run(main())
