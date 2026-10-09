"""Run explicitly on the homologation host. Isolated data; no real credentials/email."""
import asyncio, json, os, sys, tempfile
from pathlib import Path
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from cryptography.fernet import Fernet
from lib.db import client, controle, definir_empresa
from lib.auth import Principal, principal_atual
from routers import contratos, financeiro, empresas, operacao
from models.empresas import RestauracaoEmpresa

async def main():
    suffix=uuid4().hex[:12]
    company='hml-'+suffix
    name='app_hml_'+suffix
    bank=client[name]
    await controle.empresas.insert_one({'id':company,'slug':company,'db_name':name,'ativo':False,'modulos':['contratos','financeiro']})
    definir_empresa(name)
    await bank.imoveis.insert_one({'id':'hml-imovel','titulo':'Homologacao isolada'})
    await bank.configuracoes.insert_one({'id':'singleton','modulos_ativos':['contratos','financeiro']})
    for code in ['1.1.1','1.1.2','1.2.1']:
        await bank.plano_contas.insert_one({'id':code,'codigo':code,'ativo':True,'tipo':'receita','nome':'Homologacao'})
    await bank.usuarios.insert_one({'id':'hml-admin','email':company+'@example.invalid','papel':'admin','ativo':True,'session_version':0})
    state={'role':'admin'}
    async def identity():
        definir_empresa(name)
        return Principal(usuario_id='hml-'+state['role'],nome='Homologacao',email='hml@example.invalid',papel=state['role'],pessoa_id='hml-broker',empresa_id=company)
    app=FastAPI()
    for router in [contratos.router,financeiro.router,operacao.router]: app.include_router(router)
    app.dependency_overrides[principal_atual]=identity
    results=[]
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://isolated') as http:
        for role in ['sysadmin','admin','corretor']:
            state['role']=role
            payload={'request_id':'hml-'+uuid4().hex,'tipo':'venda','imovel_id':'hml-imovel','valor':100000,'inicio':'2026-10-08','parcelas':3}
            response=await http.post('/contratos',json=payload)
            assert response.status_code==201,(role,response.status_code,response.text)
            contract=response.json()
            repeat=await http.post('/contratos',json=payload)
            assert repeat.status_code==201 and repeat.json()['id']==contract['id']
            assert len(repeat.json()['transacoes'])==3
            metrics=await http.get('/operacao/metricas')
            assert metrics.status_code==(403 if role=='corretor' else 200)
            tx=contract['transacoes'][0]['id']
            paid=await http.patch('/transacoes/'+tx,json={'status':'pago'})
            assert paid.status_code==(403 if role=='corretor' else 200),(role,paid.text)
            cancel=await http.patch('/contratos/'+contract['id'],json={'status':'cancelado'})
            assert cancel.status_code==(403 if role=='corretor' else 200),(role,cancel.text)
            if role!='corretor':
                rows=await bank.transacoes.find({'contrato_id':contract['id']}).to_list(None)
                assert sum(t['status']=='pago' for t in rows)==1
                assert sum(t['status']=='cancelado' for t in rows)==2
            results.append(role+': criar/repetir/permissoes/baixa/cancelamento OK')
        state['role']='admin'
        rental=await http.post('/contratos',json={'request_id':'hml-'+uuid4().hex,'tipo':'locacao','imovel_id':'hml-imovel','valor':2500,'comissao_pct':30,'inicio':'2026-11-10','fim':'2027-11-09','parcelas':12})
        assert rental.status_code==201,rental.text
        assert rental.json()['total_gerado']==3750 and len(rental.json()['transacoes'])==13
        results.append('locacao: 12 taxas + comissao OK')
    definir_empresa(name)
    principal=await identity()
    with tempfile.TemporaryDirectory() as temp:
        secret=Path(temp)/'backup.key'; recovery=Fernet.generate_key().decode(); secret.write_text(recovery); secret.chmod(0o600)
        os.environ['BACKUP_ENCRYPTION_KEY_FILE']=str(secret)
        backup=await empresas.backup_empresa(company,principal)
        payload=json.loads(backup.body)
        secret.unlink()
        secret.write_text(recovery); secret.chmod(0o600)
        restored=await empresas.restaurar_empresa(company,RestauracaoEmpresa(**payload),principal)
        assert restored['restaurado']['contratos']==4
        assert await bank.usuarios.find_one({'id':'hml-admin','session_version':1})
        del os.environ['BACKUP_ENCRYPTION_KEY_FILE']
    results.append('backup/restauracao transacional + recuperacao simulada da chave OK (nao cofre real)')
    async with await client.start_session() as session:
        session.start_transaction()
        await bank.transaction_probe.insert_one({'_id':'rollback'},session=session)
        await session.abort_transaction()
    assert not await bank.transaction_probe.find_one({'_id':'rollback'})
    results.append('rollback MongoDB real OK')
    print(json.dumps({'banco_isolado':name,'resultados':results},ensure_ascii=False,indent=2))
    client.close()

if __name__=='__main__': asyncio.run(main())
