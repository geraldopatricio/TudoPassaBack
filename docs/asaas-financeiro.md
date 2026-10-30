# Financeiro / Asaas

Tela local: `/financeiro/asaas`. API interna: `/asaas`. Requer login válido de Admin ou Gerente, conforme os usuários locais e o token de login existente. A chave `ASAAS_API_KEY` e `ASAAS_URL` ficam exclusivamente no backend. Após atualizar, reinicie o backend para registrar as novas rotas.

## Consultas

- Saldo disponível, pendentes, vencidos, confirmado líquido a liberar e recebido acumulado: endpoints oficiais de saldo e estatísticas do Asaas.
- Hoje, próximos sete dias (incluindo hoje) e restante do mês: cobranças PENDING por vencimento, no horário de Brasília. Não representam a data garantida de crédito. Cobranças futuras ainda não geradas por assinaturas não estão incluídas.
- Entradas, saídas e movimento líquido: todos os lançamentos do extrato no mês até hoje. Recebimentos de cobranças são identificados por PAYMENT_RECEIVED. Incluem-se taxas, transferências e estornos nos movimentos correspondentes. Não somar previsão e saldo como se fossem um único saldo.
- Gráfico diário de entradas e saídas no mês.
- Cobranças, clientes, assinaturas, notas e extrato têm paginação real no Asaas de dez registros. Filtros operam no servidor, não apenas na página visível.
- Cliente → Cobranças e status permite conferir suas cobranças; também é possível consultar suas notas. As cobranças mostram identificação do cliente, cadastro, vencimento, pagamento, tipo, valores bruto e líquido, crédito previsto e recorrência. Detalhes preservam os demais campos do Asaas.
- Cada indicador indisponível é apresentado como ausente, acompanhado de aviso. Erro de consulta não vira saldo zero.

## Operações

Cadastro e edição de cliente; criação e edição de cobrança avulsa Pix, boleto, cartão por link ou escolha do cliente; exclusão de cobrança pendente/vencida; criação, edição e cancelamento de recorrência. O cartão é informado pelo pagador na fatura do Asaas, não é coletado neste painel. Faturas, boletos e comprovantes podem ser abertos; Pix apresenta QR Code e copia e cola.

NFS-e: agendar vinculada à cobrança ou cliente, editar nota agendada/com erro, solicitar emissão e solicitar cancelamento. Consulta de serviço municipal ou preenchimento manual de código/nome. Todas as alíquotas devem ser informadas, inclusive zero quando aplicável. A autorização depende da prefeitura, da configuração fiscal da conta e dos requisitos vigentes do serviço. O formulário cobre NFS-e de serviços usuais; operações fiscais especiais com campos adicionais devem ser tratadas conforme sua configuração fiscal. Não é emissor de NF-e de mercadorias. Acompanhe o status; agendamento/solicitação não equivale a autorização.

As ações são executadas quando o operador usa os formulários. Não há alterações automáticas ou sincronização com lançamentos internos de pedidos. As consultas são sob demanda, sem polling contínuo.

## Registro de operações

Mutações exigem `X-Request-Id` único. `src/database/asaas/operations.json` registra a operação antes do envio, seu resultado ou resultado incerto. Repetição da mesma operação concluída retorna a resposta anterior; resultado incerto bloqueia reenvio com o mesmo identificador. Confira a conta após timeout, antes de iniciar uma nova operação. O registro fica fora do Git e deve ser persistido em produção, junto aos demais JSONs. Pressupõe uma instância gravadora, como o restante do armazenamento JSON deste projeto.

A comunicação usa conexão direta por padrão. Para instalações que exigem proxy de rede configurado no ambiente, defina `ASAAS_USE_SYSTEM_PROXY=true`. Nenhuma credencial vai para o navegador.

## Validação

Testes em `test/asaasFinance.test.js`: datas em Brasília, virada de mês, agregação de todas as páginas do extrato, falhas parciais, autenticação/permissões, paginação, validação de cobrança/assinatura/nota, idempotência, resultado incerto e gravações concorrentes. As operações de escrita são testadas com transporte simulado. A validação na conta real usa apenas GETs.

Referências: https://docs.asaas.com/reference/estatisticas-de-cobrancas · https://docs.asaas.com/reference/recuperar-extrato · https://docs.asaas.com/reference/criar-nova-cobranca · https://docs.asaas.com/reference/criar-nova-assinatura · https://docs.asaas.com/reference/agendar-nota-fiscal

## Grade unificada de clientes e cobranças

A aba inicial agora é **Clientes e cobranças**, baseada na referência visual fornecida. Uma linha por cobrança; clientes sem cobrança também aparecem. Cadastro do cliente e criação da cobrança são campos distintos. O período filtra o cadastro do cliente; Hoje seleciona o dia atual em Brasília. Sem período, consulta todos os cadastros.

`GET /asaas/grid` une clientes, cobranças e notas. Aceita `page`, `customerStart`, `customerEnd`, `purchased=yes|no`, `search`, `status`, `billingType`, `account=active|deleted|unknown`, `invoiceStatus`, `sortBy`, `sortDirection` e filtros `column.<chave>`. `customer`, `subscription`, `dueStart` e `dueEnd` restringem consultas específicas. Filtros e ordenação precedem a paginação de dez linhas. A busca inclui nome, documento, e-mail, descrição e referência da cobrança. CPF/CNPJ pode conter pontuação.

O servidor lê todas as páginas dos três recursos e mantém um snapshot em memória por até 60 segundos. Consultas simultâneas compartilham a leitura. Mutações invalidam o snapshot. Atualizar conta solicita nova leitura. A atualização automática opcional da grade ocorre a cada 60 segundos, com a aba visível e sem formulário/operação aberto. O resumo financeiro permanece recolhível acima da grade.

Notas vinculadas à cobrança aparecem na própria linha. Para clientes sem cobrança, aparecem as notas avulsas vinculadas ao cliente. Falha fiscal é indisponibilidade, nunca ausência de nota. Emissão não é oferecida enquanto não é possível verificar notas existentes. Conta representa o cadastro do cliente no Asaas, não uma conta Cognito. Atividade da fatura informa visualização retornada pelo Asaas, sem afirmar envio de e-mail ou mensagem.
