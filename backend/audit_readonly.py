"""Read-only preflight: emits counts and configuration readiness, never credentials or records."""
import os, asyncio, json
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path('/app/backend/.env'))
from lib.db import client, controle
from models.imoveis import Imovel
from models.leads import Lead
from models.contratos import Contrato
from models.financeiro import TransacaoFinanceira
from models.agenda import Visita

async def run():
    hello=await client.admin.command('hello')
    report={'mongo_transactions':bool(hello.get('setName') or hello.get('msg')=='isdbgrid'),
        'app_env':os.environ.get('APP_ENV','desenvolvimento'),
        'app_url_https':os.environ.get('APP_URL','').startswith('https://'),
        'backup_key_configured':bool(os.environ.get('BACKUP_ENCRYPTION_KEY')),
        'email_key_configured':bool(os.environ.get('EMERGENT_EMAIL_KEY')),
        'companies':[]}
    async for company in controle.empresas.find({'ativo':True}):
        bank=client[company['db_name']]
        item={'ordinal':len(report['companies'])+1, 'invalid_models':{}, 'counts':{}}
        for collection, model in [('imoveis',Imovel),('leads',Lead),('contratos',Contrato),('transacoes',TransacaoFinanceira),('visitas',Visita)]:
            invalid=0; total=0
            async for doc in bank[collection].find({}):
                total+=1
                try: model.model_validate(doc)
                except Exception: invalid+=1
            item['invalid_models'][collection]=invalid
            item['counts'][collection]=total
        item['active_duplicate_leads']=len(await bank.contratos.aggregate([
            {'$match':{'status':'ativo','lead_id':{'$type':'string'}}},
            {'$group':{'_id':'$lead_id','n':{'$sum':1}}},{'$match':{'n':{'$gt':1}}}]).to_list(None))
        item['legacy_contracts']=await bank.contratos.count_documents({'financeiro_status':{'$exists':False}})
        item['payment_status_mismatch']=await bank.transacoes.count_documents({'$or':[
            {'status':'pago','pagamento':None},{'status':{'$ne':'pago'},'pagamento':{'$nin':[None,'']}}]})
        report['companies'].append(item)
    print(json.dumps(report,indent=2))
    client.close()
if __name__=='__main__': asyncio.run(run())
