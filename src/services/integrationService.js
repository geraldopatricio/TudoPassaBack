const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../database/integracoes/integracoes.json');
const ALLOWED_TYPES = ['representante', 'revendedor', 'fornecedor', 'afiliado', 'vendedor', 'transportadora'];

const readConfig = () => JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const writeConfig = (config) => {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
};

const publicConfig = (config = readConfig()) => ({
  ...config,
  credentials: {
    ...config.credentials,
    token: config.credentials?.token ? '********' : '',
    apiKey: config.credentials?.apiKey ? '********' : '',
    clientSecret: config.credentials?.clientSecret ? '********' : ''
  }
});

const presets = {
  alpha: {
    credentials: { baseUrl: '', token: '', apiKey: '', clientId: '', clientSecret: '' },
    resources: {
      produtos: { get: 'https://api-tudopassaweb.alphasystemas.com.br/v1/produtos', post: '', put: '', responsePath: '' },
      clientes: { get: 'https://api-tudopassaweb.alphasystemas.com.br/v1/clientes?Pagina=1&TamanhoPagina=10000', getOne: 'https://api-tudopassaweb.alphasystemas.com.br/v1/clientes/{id}', post: '', put: '', responsePath: 'itens' },
      profissionais: { get: 'https://api-tudopassaweb.alphasystemas.com.br/v1/representantes?Ativo=true&Pagina=1&TamanhoPagina=100', getOne: '', post: '', put: '', responsePath: 'itens', tipo: 'representante' }
    }
  }
};

const mergeConfig = (incoming) => {
  const old = readConfig();
  const preset = presets[incoming.provider] || {};
  const providerChanged = incoming.provider && incoming.provider !== old.provider;
  const keepSecret = (value, oldValue) => value === '********' ? oldValue : (value ?? oldValue ?? '');
  const result = {
    ...old, ...preset, ...incoming,
    enabled: incoming.provider !== 'local' && incoming.enabled !== false,
    credentials: { ...old.credentials, ...preset.credentials, ...incoming.credentials },
    resources: Object.fromEntries(['produtos', 'clientes', 'profissionais'].map(resource => {
      const blank = { get: '', getOne: '', post: '', put: '', responsePath: '', ...(resource === 'profissionais' ? { tipo: 'representante' } : {}) };
      const supplied = incoming.resources?.[resource] || {};
      const selected = providerChanged && preset.resources?.[resource]
        ? { ...supplied, ...preset.resources[resource] }
        : { ...preset.resources?.[resource], ...supplied };
      return [resource, { ...(providerChanged ? blank : old.resources?.[resource]), ...selected }];
    }))
  };
  result.credentials.token = keepSecret(incoming.credentials?.token, old.credentials?.token);
  result.credentials.apiKey = keepSecret(incoming.credentials?.apiKey, old.credentials?.apiKey);
  result.credentials.clientSecret = keepSecret(incoming.credentials?.clientSecret, old.credentials?.clientSecret);
  if (!ALLOWED_TYPES.includes(result.resources.profissionais.tipo)) result.resources.profissionais.tipo = 'fornecedor';
  writeConfig(result);
  return result;
};

const value = (obj, keys, fallback = '') => {
  for (const key of keys) {
    const parts = key.split('.');
    const found = parts.reduce((current, part) => current?.[part], obj);
    if (found !== undefined && found !== null && found !== '') return found;
  }
  return fallback;
};
const digits = (v) => String(v || '').replace(/\D/g, '');
const endpoint = (template, id) => String(template || '').replace('{id}', encodeURIComponent(id || ''));
const resolveEndpoint = (config, template, id) => {
  const url = endpoint(template, id);
  if (/^https?:\/\//i.test(url)) return url;
  return `${String(config.credentials?.baseUrl || '').replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
};
const extract = (data, responsePath) => {
  if (responsePath) return responsePath.split('.').reduce((v, key) => v?.[key], data);
  if (Array.isArray(data)) return data;
  return data?.itens || data?.items || data?.data?.itens || data?.data?.items || data?.data;
};

const headers = (config) => {
  const c = config.credentials || {};
  const prefix = String(config.provider || '').replace(/[^a-z0-9]/gi, '_').toUpperCase();
  const env = (suffix) => process.env[`${prefix}_${suffix}`];
  const token = env('TOKEN') || c.token;
  const apiKey = env('API_KEY') || (config.provider === 'alpha' ? process.env['X-Api-Key'] : '') || c.apiKey;
  const clientId = env('CLIENT_ID') || c.clientId;
  const clientSecret = env('CLIENT_SECRET') || c.clientSecret;
  const h = { Accept: 'application/json' };
  if (token) h.Authorization = token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
  if (apiKey) h['X-Api-Key'] = apiKey;
  if (clientId) h['X-Client-Id'] = clientId;
  if (clientSecret) h['X-Client-Secret'] = clientSecret;
  return h;
};

const normalizeProduto = (p) => {
  const byColor = new Map();
  for (const item of (Array.isArray(p.grades) ? p.grades : [])) {
    const colorKey = String(value(item, ['codigoCor', 'descricaoCor'], 'PADRAO'));
    if (!byColor.has(colorKey)) byColor.set(colorKey, {
      cor_codigo_nome: value(item, ['descricaoCor', 'codigoCor'], 'PADRÃO'),
      codigo_cor: value(item, ['codigoCor']),
      grade: { PP: 0, P: 0, M: 0, G: 0, GG: 0, U: 0 },
      itens_grade: [], quantidade_total: 0,
      valor_unitario: 0, valor_total: 0,
      valor_unitario_tb1: 0, valor_total_tb1: 0,
      valor_unitario_tb2: 0, valor_total_tb2: 0,
      valor_unitario_tb3: 0, valor_total_tb3: 0
    });
    const variant = byColor.get(colorKey);
    const size = String(item.tamanho || '').trim().toUpperCase();
    if (size && variant.grade[size] === undefined) variant.grade[size] = 0;
    variant.itens_grade.push({ ...item, tamanho: size });
  }
  return {
    ...p,
    referencia: String(value(p, ['referencia', 'codigo', 'code', 'id', 'sku'])),
    categoria: value(p, ['categoria', 'grupo.descricao', 'category.nome', 'category', 'familia.descricao', 'familia', 'grupo'], 'GERAL'),
    descricao: value(p, ['descricao', 'nome', 'description', 'name']),
    unidade: String(value(p, ['unidade', 'unit', 'unidadeMedida'], 'UN')).trim(),
    imagem: value(p, ['imagem', 'image', 'urlImagem'], 'avatar.png'),
    variantes: Array.isArray(p.variantes) && p.variantes.length ? p.variantes : [...byColor.values()]
  };
};

const normalizePerson = (p, tipo) => ({
  ...p,
  codigo: String(value(p, ['codigo', 'code', 'id', 'Id'])),
  nome: value(p, ['nome', 'nomeFantasia', 'fantasia', 'name', 'razaoSocial', 'companyName']),
  cpf_cnpj: value(p, ['cpf_cnpj', 'cnpjCpf', 'cpfCnpj', 'cnpj', 'cpf', 'document', 'taxId']),
  celular: value(p, ['celular', 'whatsApp', 'telefone', 'phone', 'mobile']),
  email: value(p, ['email', 'emailAddress']),
  endereco: value(p, ['endereco', 'logradouro', 'address.street', 'address']),
  numero: value(p, ['numero', 'address.number']),
  bairro: value(p, ['bairro', 'address.district']),
  cidade: value(p, ['cidade.nome', 'cidade', 'municipio', 'address.city']),
  uf: value(p, ['uf.sigla', 'uf', 'estado', 'address.state']),
  cep: value(p, ['cep', 'address.zipCode', 'postalCode']),
  ...(tipo ? { tipo } : {})
});

const enrichCnpj = async (person, enabled) => {
  const cnpj = digits(person.cpf_cnpj);
  if (!enabled || cnpj.length !== 14) return person;
  const needsData = !person.endereco || !person.email || !person.cep;
  if (!needsData) return person;
  try {
    const { data } = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { timeout: 8000 });
    return {
      ...person,
      nome: person.nome || data.nome_fantasia || data.razao_social,
      email: person.email || data.email, celular: person.celular || data.ddd_telefone_1,
      endereco: person.endereco || data.logradouro, numero: person.numero || data.numero,
      bairro: person.bairro || data.bairro, cidade: person.cidade || data.municipio,
      uf: person.uf || data.uf, cep: person.cep || data.cep, razao_social: data.razao_social
    };
  } catch (_) { return person; }
};

const active = () => { const c = readConfig(); return c.enabled && c.provider !== 'local' ? c : null; };
const list = async (resource) => {
  const config = active();
  if (!config || !config.resources?.[resource]?.get) return null;
  const spec = config.resources[resource];
  const { data } = await axios.get(resolveEndpoint(config, spec.get), { headers: headers(config), timeout: 20000 });
  const raw = extract(data, spec.responsePath);
  if (!Array.isArray(raw)) throw new Error(`A resposta de ${resource} não contém uma lista`);
  if (resource === 'produtos') return raw.map(normalizeProduto);
  return raw.map(item => normalizePerson(item, resource === 'profissionais' ? spec.tipo : null));
};

const getOne = async (resource, id) => {
  const config = active(); const spec = config?.resources?.[resource];
  if (!spec?.getOne) return null;
  const { data } = await axios.get(resolveEndpoint(config, spec.getOne, id), { headers: headers(config), timeout: 20000 });
  return resource === 'produtos' ? normalizeProduto(data) : enrichCnpj(normalizePerson(data, resource === 'profissionais' ? spec.tipo : null), config.cnpjEnrichment);
};

const writeRemote = async (resource, method, id, payload) => {
  const config = active(); const template = config?.resources?.[resource]?.[method];
  if (!template) return null;
  const url = resolveEndpoint(config, template, id);
  const { data } = await axios({ method, url, data: payload, headers: { ...headers(config), 'Content-Type': 'application/json' }, timeout: 20000 });
  return data;
};

module.exports = { readConfig, publicConfig, mergeConfig, list, getOne, writeRemote };
