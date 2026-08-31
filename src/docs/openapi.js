const json = { 'application/json': { schema: { type: 'object', additionalProperties: true } } };
const listResponse = { description: 'Lista retornada com sucesso', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', additionalProperties: true } }, example: [{ id: '123', descricao: 'Exemplo' }] } } };
const itemResponse = { description: 'Operação realizada com sucesso', content: { 'application/json': { schema: { type: 'object', additionalProperties: true }, example: { id: '123', success: true } } } };
const errorResponses = {
  400: { description: 'Dados inválidos' },
  401: { description: 'Não autenticado' },
  404: { description: 'Registro não encontrado' },
  500: { description: 'Erro interno' }
};
const parameter = (name, description = `Identificador de ${name}`) => ({ name, in: 'path', required: true, description, schema: { type: 'string' }, example: '123' });
const operation = (tag, summary, description, options = {}) => ({
  tags: [tag], summary, description,
  ...(options.parameters ? { parameters: options.parameters } : {}),
  ...(options.security ? { security: [{ bearerAuth: [] }] } : {}),
  ...(options.body ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true }, example: options.body } } } } : {}),
  responses: { 200: options.list ? listResponse : itemResponse, ...errorResponses }
});

const paths = {};
const add = (path, method, data) => { paths[path] = paths[path] || {}; paths[path][method] = data; };
const crud = (base, tag, id, singular, body, options = {}) => {
  add(base, 'get', operation(tag, `Listar ${tag.toLowerCase()}`, `Retorna todos os registros de ${tag.toLowerCase()}. Quando uma integração está ativa, consulta o ERP/CRM e normaliza o resultado.`, { list: true }));
  add(base, 'post', operation(tag, `Cadastrar ${singular}`, `Cria um novo ${singular}. Aceita JSON ou multipart/form-data nas rotas com imagem.`, { body }));
  if (options.detail !== false) add(`${base}/{${id}}`, 'get', operation(tag, `Consultar ${singular}`, `Retorna os detalhes de um ${singular} pelo identificador.`, { parameters: [parameter(id)] }));
  add(`${base}/{${id}}`, 'put', operation(tag, `Editar ${singular}`, `Atualiza o registro. Em integrações somente leitura, realiza upsert no armazenamento local.`, { parameters: [parameter(id)], body }));
  add(`${base}/{${id}}`, 'delete', operation(tag, `Excluir ${singular}`, `Remove o registro e seus arquivos associados quando aplicável.`, { parameters: [parameter(id)] }));
};

crud('/produtos', 'Produtos', 'ref', 'produto', { referencia: '0720014', descricao: 'Camiseta', categoria: 'CAMISAS', unidade: 'UN', variantes: [] }, { detail: false });
crud('/clientes', 'Clientes', 'codigo', 'cliente', { codigo: '101', nome: 'Empresa Exemplo', cpf_cnpj: '19131243000197', email: 'contato@empresa.com.br' });
crud('/profissionais', 'Profissionais', 'codigo', 'profissional', { codigo: '1', nome: 'Representante', cpf_cnpj: '19131243000197', tipo: 'representante' });
crud('/usuarios', 'Usuários', 'login', 'usuário', { login: 'usuario', senha: 'senha-segura', email: 'usuario@exemplo.com', tipo: 'Admin' });
crud('/tabela-precos', 'Tabela de preços', 'id', 'tabela de preços', { nome: 'Atacado', percentual: 10, ativa: true }, { detail: false });
crud('/financeiro', 'Financeiro', 'id', 'lançamento financeiro', { tipo_movimento: 'Venda', valor_original: 150.5, situacao: 'Em aberto' }, { detail: false });

add('/usuarios/login', 'post', operation('Autenticação', 'Autenticar usuário', 'Valida login e senha e devolve os dados públicos do usuário com um accessToken.', { body: { login: 'admin', senha: 'senha' } }));
add('/usuarios/recuperar-senha', 'post', operation('Autenticação', 'Recuperar senha', 'Envia a recuperação de acesso para o e-mail cadastrado.', { body: { email: 'usuario@exemplo.com' } }));
add('/usuarios/alterar-senha', 'post', operation('Autenticação', 'Alterar senha', 'Altera a senha após validar a senha atual.', { body: { login: 'usuario', senhaAntiga: 'antiga', novaSenha: 'nova' } }));

add('/pedidos', 'get', operation('Pedidos', 'Listar pedidos', 'Retorna todos os pedidos cadastrados.', { list: true }));
add('/pedidos', 'post', operation('Pedidos', 'Criar pedido', 'Cria o pedido e seus itens. O pagamento posterior pode gerar financeiro, baixa de estoque e entrega.', { body: { cliente: { nome: 'Cliente', cpf: '12345678900' }, itens: [{ referencia: '0720014', chosenSize: 'M', chosenQty: 1, unitPrice: 50, totalPrice: 50 }], subtotal: 50, frete: 10, total: 60 } }));
add('/pedidos/{id}', 'get', operation('Pedidos', 'Detalhar pedido', 'Retorna o pedido com todos os seus itens.', { parameters: [parameter('id')] }));
add('/pedidos/{id}', 'delete', operation('Pedidos', 'Excluir pedido', 'Remove o pedido e seus itens.', { parameters: [parameter('id')] }));
add('/pedidos/{id}/status', 'put', operation('Pedidos', 'Atualizar status', 'Atualiza o status. Ao marcar como Pago, baixa estoque e gera financeiro e logística; ao cancelar, executa os estornos aplicáveis.', { parameters: [parameter('id')], body: { status: 'Pago' } }));

add('/produtos/checkout/pix', 'post', operation('Checkout', 'Gerar cobrança PIX', 'Cria os dados da cobrança PIX para o checkout.', { body: { valor: 150.5, descricao: 'Pedido Tudo Passa' } }));
add('/produtos/notificar-pedido', 'post', operation('Checkout', 'Notificar pedido', 'Envia ao cliente o e-mail de confirmação do pedido.', { body: { cliente: { nome: 'Cliente', email: 'cliente@exemplo.com' }, itens: [], total: 150.5, frete: 10 } }));

add('/logistica/gerar', 'post', operation('Logística', 'Gerar entrega', 'Cria uma entrega a partir de um pedido pago.', { body: { pedido: { id: '123', numero_pedido: 10, cliente_nome: 'Cliente' } } }));
add('/logistica/aceitar/{entregaId}', 'put', operation('Logística', 'Aceitar entrega', 'Vincula um profissional a uma entrega disponível.', { parameters: [parameter('entregaId')], body: { profissionalId: '1' } }));
add('/logistica/rastreio/posicao', 'post', operation('Logística', 'Atualizar posição', 'Atualiza a latitude e longitude das entregas ativas do profissional.', { body: { profissionalId: '1', lat: -3.7319, lng: -38.5267 } }));
add('/logistica/status/{entregaId}', 'put', operation('Logística', 'Atualizar status da entrega', 'Registra uma mudança operacional de status.', { parameters: [parameter('entregaId')], body: { status: 'Em Rota' } }));
add('/logistica/disponiveis', 'get', operation('Logística', 'Listar entregas disponíveis', 'Retorna entregas ainda não aceitas por um profissional.', { list: true }));
add('/logistica/rastreio/{pedidoId}', 'get', operation('Logística', 'Rastrear pedido', 'Retorna a entrega e a posição atual pelo identificador do pedido.', { parameters: [parameter('pedidoId')] }));
add('/logistica/cliente/{documento}', 'get', operation('Logística', 'Entregas do cliente', 'Lista as entregas associadas ao CPF/CNPJ informado.', { parameters: [parameter('documento', 'CPF ou CNPJ do cliente')], list: true }));
add('/logistica/admin/monitoramento', 'get', operation('Logística', 'Monitoramento administrativo', 'Retorna todas as entregas para a torre de controle.', { list: true }));
add('/logistica/admin/entregas/{entregaId}', 'put', operation('Logística', 'Atualizar entrega administrativa', 'Atualiza status e adiciona fotos, assinatura e observação. Requer usuário Admin.', { parameters: [parameter('entregaId')], security: true, body: { status: 'Entregue', tipo_evidencia: 'entrega', observacao: 'Recebido pelo cliente' } }));

add('/integracoes', 'get', operation('Integrações', 'Consultar integração ativa', 'Retorna a configuração sem expor tokens, API Keys ou secrets.'));
add('/integracoes', 'put', operation('Integrações', 'Salvar integração', 'Seleciona ERP/CRM, endpoints, capacidades e credenciais.', { body: { provider: 'alpha', enabled: true, cnpjEnrichment: true } }));
add('/integracoes/testar', 'post', operation('Integrações', 'Testar integração', 'Testa clientes, produtos e profissionais e retorna os totais de cada recurso.', { body: { provider: 'alpha', enabled: true } }));

module.exports = {
  openapi: '3.0.3',
  info: { title: 'Tudo Passa API', version: '1.0.0', description: 'Documentação oficial dos serviços do Tudo Passa. Os endpoints de cadastro podem usar a base local ou o ERP/CRM selecionado em Integrações.' },
  servers: [{ url: process.env.API_PUBLIC_URL || '/api', description: 'Servidor atual' }],
  tags: ['Autenticação', 'Produtos', 'Clientes', 'Profissionais', 'Usuários', 'Pedidos', 'Checkout', 'Tabela de preços', 'Financeiro', 'Logística', 'Integrações'].map(name => ({ name })),
  paths,
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Token devolvido por POST /usuarios/login' } }, schemas: { GenericObject: json } }
};
