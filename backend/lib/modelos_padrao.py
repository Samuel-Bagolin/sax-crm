"""Modelos-base de contrato. São pontos de partida editáveis no Configurador do CRM e devem ser
revisados pelo jurídico da imobiliária antes do uso em operações reais."""

VARIAVEIS = [
    ("empresa_nome", "Nome da imobiliária"),
    ("contrato_numero", "Número do contrato"),
    ("data_hoje", "Data de hoje"),
    ("cliente_nome", "Comprador / locatário"),
    ("cliente_cpf", "CPF/CNPJ do cliente"),
    ("cliente_email", "E-mail do cliente"),
    ("cliente_telefone", "Telefone do cliente"),
    ("proprietario_nome", "Proprietário"),
    ("proprietario_cpf", "CPF/CNPJ do proprietário"),
    ("corretor_nome", "Corretor responsável"),
    ("imovel_codigo", "Código do imóvel"),
    ("imovel_titulo", "Título do imóvel"),
    ("imovel_endereco", "Endereço completo do imóvel"),
    ("imovel_cidade", "Cidade do imóvel"),
    ("valor", "Valor (venda) ou aluguel mensal"),
    ("comissao_pct", "Comissão (%)"),
    ("taxa_admin_pct", "Taxa de administração (%)"),
    ("inicio", "Início da vigência"),
    ("fim", "Fim da vigência"),
    ("dia_vencimento", "Dia de vencimento"),
    ("parcelas", "Número de parcelas"),
]

MODELO_VENDA = """# INSTRUMENTO PARTICULAR DE COMPROMISSO DE COMPRA E VENDA

Contrato nº {{contrato_numero}}

## 1. Das partes

PROMITENTE VENDEDOR(A): {{proprietario_nome}}, inscrito(a) no CPF/CNPJ sob nº {{proprietario_cpf}}.

PROMISSÁRIO(A) COMPRADOR(A): {{cliente_nome}}, inscrito(a) no CPF/CNPJ sob nº {{cliente_cpf}}, e-mail {{cliente_email}}, telefone {{cliente_telefone}}.

INTERVENIENTE IMOBILIÁRIA: {{empresa_nome}}, representada pelo(a) corretor(a) {{corretor_nome}}.

## 2. Do objeto

O presente instrumento tem por objeto o imóvel {{imovel_titulo}} (código {{imovel_codigo}}), situado em {{imovel_endereco}}, livre e desembaraçado de quaisquer ônus.

## 3. Do preço e da forma de pagamento

O preço total ajustado é de {{valor}}, a ser pago conforme condições acordadas entre as partes e descritas em anexo.

## 4. Da comissão de intermediação

A comissão de intermediação devida à {{empresa_nome}} é de {{comissao_pct}}% sobre o valor da venda, paga em {{parcelas}} parcela(s), com primeiro vencimento a partir de {{inicio}}.

## 5. Da escritura e da posse

A escritura pública definitiva será outorgada após a quitação do preço, correndo por conta do(a) comprador(a) as despesas de ITBI, registro e emolumentos, salvo ajuste diverso. A posse será transmitida na data acordada entre as partes.

## 6. Das disposições gerais

As partes declaram que leram e concordam com todas as cláusulas, e reconhecem a validade da assinatura eletrônica deste instrumento, com registro de data, hora, IP e código de integridade do documento.

Fica eleito o foro da comarca de {{imovel_cidade}} para dirimir quaisquer questões oriundas deste contrato.

{{imovel_cidade}}, {{data_hoje}}.
"""

MODELO_LOCACAO = """# CONTRATO DE LOCAÇÃO RESIDENCIAL

Contrato nº {{contrato_numero}}

## 1. Das partes

LOCADOR(A): {{proprietario_nome}}, CPF/CNPJ nº {{proprietario_cpf}}, neste ato representado(a) pela administradora {{empresa_nome}}.

LOCATÁRIO(A): {{cliente_nome}}, CPF/CNPJ nº {{cliente_cpf}}, e-mail {{cliente_email}}, telefone {{cliente_telefone}}.

## 2. Do imóvel

Imóvel {{imovel_titulo}} (código {{imovel_codigo}}), localizado em {{imovel_endereco}}, destinado exclusivamente a fins residenciais.

## 3. Do prazo

A locação vigorará de {{inicio}} a {{fim}}, nos termos da Lei nº 8.245/1991.

## 4. Do aluguel

O aluguel mensal é de {{valor}}, com vencimento todo dia {{dia_vencimento}} de cada mês, reajustado anualmente pelo índice acordado entre as partes. Encargos como IPTU, condomínio e consumo de água, luz e gás correm por conta do(a) locatário(a), salvo ajuste diverso.

## 5. Da administração

A {{empresa_nome}} fará a administração da locação mediante taxa de {{taxa_admin_pct}}% sobre o aluguel, devida pelo(a) locador(a).

## 6. Das obrigações

O(A) locatário(a) se obriga a conservar o imóvel, devolvendo-o no estado em que o recebeu conforme laudo de vistoria, ressalvado o desgaste natural pelo uso.

## 7. Das disposições gerais

As partes reconhecem a validade da assinatura eletrônica deste instrumento, com registro de data, hora, IP e código de integridade do documento. Fica eleito o foro da comarca de {{imovel_cidade}}.

{{imovel_cidade}}, {{data_hoje}}.
"""

MODELOS_PADRAO = [
    ("Compromisso de compra e venda", "venda", MODELO_VENDA),
    ("Locação residencial", "locacao", MODELO_LOCACAO),
]
