"""Termo de adesão do SAX CRM: aceite eletrônico do gestor da empresa contratante.

Como funciona:
- O texto é versionado (VERSAO). Mudou o texto, troque a versão: todas as empresas aceitam de novo.
- Os dados da contratada (razão social, CNPJ, endereço, foro) ficam no banco de controle e são
  preenchidos no plano de controle (Empresas > Pagamentos). Sem eles, o termo não é exigido, porque
  um termo sem a identificação da contratada vale pouco como prova.
- O gestor (papel admin) da empresa aceita no primeiro acesso. Acesso de suporte nunca aceita.
- O registro guarda o texto integral aceito, o hash SHA-256, data e hora, IP, navegador, nome, CPF
  e cargo de quem aceitou. É imutável: um registro por empresa e versão (`_id` fixo).
"""

from __future__ import annotations

import hashlib
from datetime import datetime

from lib.db import controle

VERSAO = "1.0"
VIGENCIA = "11/10/2026"
DOC_CONTRATADA = "contratada"
COLECAO = "termos_aceite"
CAMPOS_CONTRATADA = ("razao_social", "cnpj", "endereco", "cidade_uf", "email")


async def contratada() -> dict:
    doc = await controle.plataforma.find_one({"_id": DOC_CONTRATADA}) or {}
    return {c: (doc.get(c) or "").strip() for c in CAMPOS_CONTRATADA}


def configurada(c: dict) -> bool:
    return all(c.get(k) for k in CAMPOS_CONTRATADA)


def _secoes(c: dict) -> list[tuple[str, list[str]]]:
    """Cláusulas. Texto puro, sem travessão. Títulos viram '##' no texto final."""
    foro = c.get("cidade_uf") or "[cidade da sede da contratada]"
    email = c.get("email") or "[e-mail de suporte]"
    return [
        ("1. Objeto", [
            "1.1. Este termo regula a licença de uso, não exclusiva e intransferível, do software SAX CRM, "
            "fornecido pela internet no modelo de software como serviço (SaaS), no plano escolhido pela CONTRATANTE "
            "e pelo período pago. A licença não transfere a propriedade do software nem do seu código.",
            "1.2. Quando contratada, a implantação compreende a preparação do ambiente da CONTRATANTE, a configuração "
            "inicial, a importação de dados fornecidos por ela quando prevista no plano e a orientação inicial de uso.",
            "1.3. As funcionalidades, limites de usuários, de unidades e de cadastros de cada plano são os informados na "
            "tela de contratação ou na proposta comercial aceita pela CONTRATANTE, que integram este termo.",
        ]),
        ("2. Natureza empresarial da contratação", [
            "2.1. A CONTRATANTE declara que é empresário, sociedade ou profissional que contrata o SAX CRM como ferramenta "
            "de gestão da sua própria atividade econômica, para atender os seus clientes, e não como destinatária final "
            "do serviço.",
            "2.2. A CONTRATANTE declara ainda que teve acesso prévio a este termo, aos preços e às condições, que pôde "
            "testar e esclarecer dúvidas antes de contratar e que tem condições técnicas, jurídicas e econômicas de "
            "avaliar a contratação.",
            "2.3. Por isso, as partes reconhecem que esta é uma relação empresarial regida pelo Código Civil, em "
            "especial pelos artigos 421 e 421-A, e que não se aplica o Código de Defesa do Consumidor (Lei 8.078/1990), "
            "inclusive o direito de arrependimento do seu artigo 49, conforme o entendimento do Superior Tribunal de "
            "Justiça sobre a aquisição de bens e serviços como insumo da atividade empresarial.",
        ]),
        ("3. Preço e pagamento", [
            "3.1. A CONTRATANTE paga o valor do plano na periodicidade escolhida (mensal ou anual), os adicionais "
            "contratados e, quando houver, a taxa de implantação, conforme a tela de contratação ou a proposta comercial.",
            "3.2. A cobrança é recorrente e feita por meio da plataforma de pagamentos Asaas, no cartão de crédito, Pix "
            "ou boleto. A renovação é automática ao fim de cada período, até que a CONTRATANTE cancele.",
            "3.3. Sem o pagamento, o acesso pode ser suspenso até a regularização, com aviso no próprio sistema. Os "
            "dados da CONTRATANTE são preservados durante a suspensão.",
            "3.4. Os preços podem ser reajustados no máximo uma vez a cada 12 meses, com aviso por e-mail de pelo menos "
            "30 dias. A CONTRATANTE que não concordar pode cancelar antes do reajuste, sem multa.",
        ]),
        ("4. Sem fidelidade e sem multa", [
            "4.1. Não há prazo mínimo de permanência nem multa por cancelamento. A CONTRATANTE pode cancelar a qualquer "
            f"momento pela tela Assinatura do sistema ou pelo e-mail {email}.",
            "4.2. O cancelamento interrompe as cobranças seguintes. O acesso continua liberado até o fim do período já "
            "pago e termina nessa data.",
        ]),
        ("5. Valores pagos não são devolvidos", [
            "5.1. Em contrapartida à ausência de fidelidade e de multa (cláusula 4), os valores pagos não são devolvidos, "
            "no todo ou em parte, quando o cancelamento, a desistência, a troca para um plano menor, a falta de uso ou o "
            "uso parcial ocorrerem por iniciativa ou decisão da CONTRATANTE. Isso inclui:",
            "a) a mensalidade ou anuidade do período em andamento, mesmo que o período não seja usado até o fim;",
            "b) a taxa de implantação, que remunera um serviço executado no início da contratação e cujo custo a "
            "CONTRATADA suporta independentemente do tempo de uso do sistema.",
            "5.2. O plano anual tem preço menor que doze mensalidades justamente por ser pago antecipadamente e sem "
            "devolução. Ao escolher o plano anual, a CONTRATANTE declara estar ciente disso.",
            "5.3. Esta cláusula não se aplica e a CONTRATADA devolve o valor nos seguintes casos: (i) cobrança em "
            "duplicidade ou em valor diferente do contratado, com estorno da diferença; (ii) descumprimento grave da "
            "CONTRATADA, inclusive indisponibilidade do sistema por mais de 7 dias seguidos fora de manutenção avisada, "
            "não corrigido em até 15 dias após notificação por escrito da CONTRATANTE, caso em que a CONTRATANTE pode "
            "rescindir e receber de volta o valor proporcional ao período pago e não utilizado; (iii) encerramento do "
            "serviço por decisão da CONTRATADA sem culpa da CONTRATANTE, com devolução proporcional do período não "
            "utilizado.",
        ]),
        ("6. Obrigações da CONTRATADA", [
            "6.1. Manter o SAX CRM em funcionamento, buscando a maior disponibilidade possível, e avisar com antecedência "
            "as manutenções programadas.",
            "6.2. Fazer cópias de segurança dos dados, aplicar medidas de segurança da informação compatíveis com o "
            "serviço e prestar suporte pelos canais informados no sistema.",
            "6.3. Não acessar os dados da CONTRATANTE além do necessário para prestar o serviço e o suporte solicitado. "
            "O acesso de suporte não abre prontuários nem anamneses.",
        ]),
        ("7. Obrigações da CONTRATANTE", [
            "7.1. Informar dados verdadeiros, manter o cadastro atualizado e guardar as senhas de acesso, respondendo "
            "pelo uso feito com os acessos dos seus usuários.",
            "7.2. Usar o sistema de forma lícita, responsabilizando-se pelo conteúdo que cadastra e pelas mensagens que "
            "envia aos seus clientes, inclusive por WhatsApp e e-mail.",
            "7.3. Obter as autorizações e ter base legal para tratar os dados dos seus clientes, pacientes, proprietários "
            "e leads, inclusive dados de saúde, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).",
        ]),
        ("8. Proteção de dados pessoais", [
            "8.1. Quanto aos dados que a CONTRATANTE cadastra no sistema, a CONTRATANTE é a controladora e a CONTRATADA é "
            "a operadora, tratando esses dados apenas para prestar o serviço e conforme as instruções da CONTRATANTE.",
            "8.2. A CONTRATADA comunicará à CONTRATANTE, em prazo razoável, qualquer incidente de segurança que possa "
            "afetar esses dados.",
            "8.3. Encerrada a contratação, a CONTRATANTE pode exportar os seus dados por até 30 dias. Depois desse prazo "
            "a CONTRATADA pode excluí-los, ressalvados os que a lei obrigue a guardar.",
        ]),
        ("9. Limitação de responsabilidade", [
            "9.1. A CONTRATADA não responde por lucros cessantes, perda de negócios ou danos indiretos, nem por falhas "
            "causadas por internet, equipamentos ou serviços de terceiros fora do seu controle, ou por uso indevido do "
            "sistema pela CONTRATANTE.",
            "9.2. A responsabilidade total da CONTRATADA por este termo fica limitada ao valor pago pela CONTRATANTE nos "
            "12 meses anteriores ao fato, salvo em caso de dolo.",
        ]),
        ("10. Propriedade intelectual", [
            "10.1. O SAX CRM, a marca SAX, o código, as telas e a documentação pertencem à CONTRATADA. É proibido copiar, "
            "revender, sublicenciar, fazer engenharia reversa ou criar produto concorrente a partir do sistema.",
            "10.2. Os dados cadastrados pela CONTRATANTE continuam sendo dela.",
        ]),
        ("11. Suspensão e rescisão pela CONTRATADA", [
            "11.1. A CONTRATADA pode suspender ou encerrar o acesso em caso de falta de pagamento, uso ilícito, risco à "
            "segurança do sistema ou violação deste termo, com aviso prévio sempre que possível.",
        ]),
        ("12. Alterações deste termo", [
            "12.1. A CONTRATADA pode atualizar este termo. A nova versão será apresentada no sistema e passa a valer "
            "após o aceite. Quem não concordar pode cancelar nas condições da cláusula 4.",
        ]),
        ("13. Aceite eletrônico", [
            "13.1. Este termo é aceito eletronicamente, por clique, pela pessoa identificada no registro de aceite, que "
            "declara ter poderes para representar e obrigar a CONTRATANTE.",
            "13.2. O sistema registra data e hora, endereço IP, navegador, nome, CPF e cargo de quem aceitou e o código "
            "de integridade (SHA-256) do texto aceito. As partes reconhecem esse registro como meio válido de prova da "
            "autoria e da integridade do aceite, nos termos do artigo 10, parágrafo 2º, da Medida Provisória "
            "2.200-2/2001 e do artigo 107 do Código Civil, com a mesma validade de uma assinatura em papel.",
            "13.3. Uma cópia deste termo e do registro de aceite fica disponível no sistema e é enviada ao e-mail de "
            "quem aceitou.",
        ]),
        ("14. Foro", [
            f"14.1. Fica eleito o foro da comarca de {foro}, local da sede da CONTRATADA, para resolver questões deste "
            "termo, com renúncia a qualquer outro, por mais privilegiado que seja.",
        ]),
    ]


def _partes(c: dict, contratante: dict | None) -> list[str]:
    linhas = [
        f"CONTRATADA: {c.get('razao_social') or '[razão social]'}, CNPJ {c.get('cnpj') or '[CNPJ]'}, "
        f"com sede em {c.get('endereco') or '[endereço]'}, titular do software SAX CRM.",
    ]
    if contratante:
        linhas.append(f"CONTRATANTE: {contratante['nome']}, CPF/CNPJ {contratante.get('documento') or '[a informar]'}, "
                      "representada pela pessoa identificada no registro de aceite ao final.")
    else:
        linhas.append("CONTRATANTE: a empresa ou profissional que contrata o SAX CRM, identificada no registro de aceite.")
    return linhas


def texto(c: dict, contratante: dict | None = None) -> str:
    """Texto integral em formato simples ('#' título, '##' cláusula), o mesmo que vai para o PDF."""
    partes = [f"# Termo de Adesão e Condições de Uso do SAX CRM", f"Versão {VERSAO}, vigente desde {VIGENCIA}.", ""]
    for linha in _partes(c, contratante):
        partes += [linha, ""]
    for titulo, paragrafos in _secoes(c):
        partes.append(f"## {titulo}")
        for p in paragrafos:
            partes += [p, ""]
    return "\n".join(partes).strip() + "\n"


def sha256(t: str) -> str:
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def hash_versao(c: dict) -> str:
    """Identifica o texto exibido (cláusulas + contratada), antes de entrar o nome do contratante."""
    return sha256(texto(c))


def documento_da_empresa(e: dict) -> str | None:
    return e.get("cnpj") or (e.get("titular") or {}).get("documento") or None


def resumo(registro: dict | None) -> dict | None:
    if not registro:
        return None
    from models.common import utc_aware

    em = registro.get("em")
    return {"versao": registro.get("versao"), "em": utc_aware(em).isoformat() if isinstance(em, datetime) else em,
            "nome": registro.get("nome"), "email": registro.get("email"), "cargo": registro.get("cargo"),
            "hash": registro.get("hash")}
