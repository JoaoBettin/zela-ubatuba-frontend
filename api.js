/**
 * api.js — Camada de acesso aos dados do Zela Ubatuba.
 *
 * Toda comunicação com o back-end (Spring Boot, repositório "Zeladoria") passa
 * por aqui. A interface (script.js) só usa window.ZelaAPI e enxerga um modelo
 * simples em português. Este arquivo traduz entre esse modelo e o da API.
 *
 * ENDPOINTS USADOS (prefixo CONFIG.BASE_URL = /api/v1):
 *   GET  /categorias
 *   GET  /solicitacoes?page=&size=&sort=&strStatus=&lngCategoriaId=   (Page)
 *   GET  /solicitacoes/{lngId}
 *   GET  /solicitacoes/{lngId}/imagem                (foto em Base64)
 *   POST /solicitacoes                               (JSON, foto em Base64)
 *
 * TRADUÇÃO DOS CAMPOS (API -> interface):
 *   lngId                  -> id (texto)
 *   strDescricao           -> descricao
 *   strEnderecoReferencia  -> bairro (bairro / ponto de referência)
 *   dblLatitude/Longitude  -> latitude / longitude
 *   strStatus              -> status em minúsculas: aberta, em_analise,
 *                             em_andamento, concluida, cancelada
 *   dtmSolicitacao         -> criadoEm        dtmAtualizacao -> atualizadoEm
 *   categoria.{lngId,strNome} -> categoria (id) + categoriaInfo
 *   imagem (metadados)     -> temFoto (a foto em si vem de obterFoto)
 *   (protocolo não existe na API: é gerado a partir do id, ex. ZU-2026-000012)
 *   strTelefoneUsuario / strEmailUsuario são DESCARTADOS ao ler: a interface
 *   nunca guarda nem mostra dados de contato de outras pessoas.
 *
 * MODO DEMONSTRAÇÃO (mock): com CONFIG.USE_MOCK = true (ou abrindo a página
 * com ?mock=1) o próprio navegador simula a API, no mesmo formato de resposta,
 * usando mock-data.js e o localStorage. Útil para demonstrar sem o back-end.
 *
 * "Minhas ocorrências": sem login, os ids criados neste aparelho ficam no
 * localStorage e cada um é consultado por GET /solicitacoes/{id}.
 */
(() => {
  'use strict';

  /* ==========================================================
     Configuração
     ========================================================== */

  const busca = (window.location && window.location.search) || '';

  const CONFIG = {
    // true = sempre usar dados fictícios. Também ativado por ?mock=1 na URL.
    USE_MOCK: new URLSearchParams(busca).get('mock') === '1',
    BASE_URL: 'http://localhost:8080/api/v1',
    TIMEOUT_MS: 15000,
    MOCK_LATENCY_MS: 300,
    TAMANHO_PAGINA: 100, // itens por página ao buscar a lista
    MAX_PAGINAS: 10, // limite de segurança (100 x 10 = 1000 ocorrências)
  };

  const CHAVE_MOCK = 'zela.mock.solicitacoes';
  const chaveMinhas = () => (CONFIG.USE_MOCK ? 'zela.mock.minhasIds' : 'zela.api.minhasIds');

  /* ==========================================================
     Utilitários
     ========================================================== */

  function lerLS(chave, padrao) {
    try {
      const valor = localStorage.getItem(chave);
      return valor ? JSON.parse(valor) : padrao;
    } catch (e) {
      return padrao;
    }
  }

  function gravarLS(chave, valor) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
      return true;
    } catch (e) {
      return false;
    }
  }

  const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const porDataDesc = (a, b) => new Date(b.criadoEm) - new Date(a.criadoEm);

  const lerIds = () => lerLS(chaveMinhas(), []).map(String).filter((id) => /^\d+$/.test(id));
  const gravarIds = (ids) => gravarLS(chaveMinhas(), ids);

  function registrarMinha(id) {
    const ids = lerIds();
    if (!ids.includes(String(id))) {
      ids.push(String(id));
      gravarIds(ids);
    }
  }

  /** Erro com status HTTP e (se houver) detalhes de validação por campo. */
  class ErroApi extends Error {
    constructor(mensagem, { status = 0, detalhes = null } = {}) {
      super(mensagem);
      this.name = 'ErroApi';
      this.status = status;
      this.detalhes = detalhes;
    }
  }

  /* ==========================================================
     Tradução API -> interface
     ========================================================== */

  // Ícone e cor de cada tipo de problema, escolhidos pelo nome da categoria
  // (a API não guarda esses dados visuais). Categorias novas usam o padrão.
  const VISUAIS = [
    { re: /buraco|pavimenta|asfalt/, icone: 'bi-cone-striped', cor: '#e8710a', corEscura: '#9a4a00' },
    { re: /ilumina|lampada|poste/, icone: 'bi-lightbulb', cor: '#f2b705', corEscura: '#7a5c00' },
    { re: /lixo|coleta|entulho|residuo/, icone: 'bi-trash3', cor: '#1f8a4c', corEscura: '#14633a' },
    { re: /arvore|poda|jardin/, icone: 'bi-tree', cor: '#7b5ea7', corEscura: '#54398a' },
    { re: /sinaliza|semaforo|transito|placa/, icone: 'bi-sign-stop', cor: '#c0392b', corEscura: '#8e1f14' },
    { re: /saneamento|esgoto|agua|vazamento/, icone: 'bi-droplet-half', cor: '#0d8abc', corEscura: '#09638a' },
  ];
  const VISUAL_PADRAO = { icone: 'bi-three-dots', cor: '#6c757d', corEscura: '#495057' };

  function adaptarCategoria(c) {
    const nome = c.strNome || 'Outros';
    const visual = VISUAIS.find((v) => v.re.test(semAcento(nome))) || VISUAL_PADRAO;
    return {
      id: String(c.lngId),
      nome,
      descricao: c.strDescricao || '',
      icone: visual.icone,
      cor: visual.cor,
      corEscura: visual.corEscura,
    };
  }

  /** LocalDateTime do Java chega sem fuso ("2026-10-28T19:05:00.123456"). */
  function paraIso(valor) {
    if (!valor) return null;
    if (Array.isArray(valor)) {
      const [ano, mes, dia, hora = 0, min = 0, seg = 0] = valor;
      const d = (n) => String(n).padStart(2, '0');
      return `${ano}-${d(mes)}-${d(dia)}T${d(hora)}:${d(min)}:${d(seg)}`;
    }
    return String(valor).replace(/(\.\d{3})\d+/, '$1');
  }

  function adaptarSolicitacao(s) {
    const criadoEm = paraIso(s.dtmSolicitacao);
    const categoriaInfo = s.categoria ? adaptarCategoria(s.categoria) : null;
    return {
      id: String(s.lngId),
      protocolo: `ZU-${String(criadoEm || '').slice(0, 4) || new Date().getFullYear()}-${String(s.lngId).padStart(6, '0')}`,
      categoria: categoriaInfo ? categoriaInfo.id : '',
      categoriaInfo,
      descricao: s.strDescricao || '',
      bairro: s.strEnderecoReferencia || '',
      latitude: s.dblLatitude ?? null,
      longitude: s.dblLongitude ?? null,
      status: String(s.strStatus || 'ABERTA').toLowerCase(),
      criadoEm,
      atualizadoEm: paraIso(s.dtmAtualizacao) || criadoEm,
      temFoto: Boolean(s.imagem),
      // telefone e e-mail do cidadão são descartados de propósito
    };
  }

  const TIPOS_IMAGEM = /^image\/(jpeg|png|webp|gif)$/;
  const BASE64 = /^[A-Za-z0-9+/=\s]+$/;

  /** Monta uma data URL segura a partir da resposta de /imagem (ou null). */
  function montarDataUrl(img) {
    if (!img || !img.strDadosBase64) return null;
    const dados = String(img.strDadosBase64);
    const pronta = /^data:(image\/(?:jpeg|png|webp|gif));base64,([\s\S]+)$/.exec(dados);
    if (pronta) return BASE64.test(pronta[2]) ? `data:${pronta[1]};base64,${pronta[2].replace(/\s+/g, '')}` : null;
    const tipo = String(img.strTipoConteudo || '').toLowerCase();
    if (!TIPOS_IMAGEM.test(tipo) || !BASE64.test(dados)) return null;
    return `data:${tipo};base64,${dados.replace(/\s+/g, '')}`;
  }

  function separarDataUrl(dataUrl) {
    const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl || '');
    return m ? { tipo: m[1], dados: m[2] } : null;
  }

  /* ==========================================================
     Transporte REAL (fetch)
     ========================================================== */

  async function erroDaResposta(resposta) {
    let corpo = null;
    try {
      corpo = await resposta.json();
    } catch (e) {
      /* resposta sem JSON */
    }
    const status = resposta.status;
    const detalhes = corpo && corpo.mapDetalhesValidacao ? corpo.mapDetalhesValidacao : null;
    let mensagem;
    if (status >= 500) {
      mensagem = 'O servidor encontrou um problema. Tente novamente em instantes.';
    } else if (corpo && corpo.strMensagem) {
      mensagem = corpo.strMensagem;
      if (detalhes) mensagem += ` ${Object.values(detalhes).join(' ')}`;
    } else {
      mensagem = `O servidor respondeu com erro ${status}.`;
    }
    return new ErroApi(mensagem, { status, detalhes });
  }

  async function http(caminho, { metodo = 'GET', corpo } = {}) {
    const controle = new AbortController();
    const temporizador = setTimeout(() => controle.abort(), CONFIG.TIMEOUT_MS);
    try {
      const opcoes = { method: metodo, signal: controle.signal, headers: { Accept: 'application/json' } };
      if (corpo !== undefined) {
        opcoes.headers['Content-Type'] = 'application/json';
        opcoes.body = JSON.stringify(corpo);
      }
      const resposta = await fetch(CONFIG.BASE_URL + caminho, opcoes);
      if (!resposta.ok) throw await erroDaResposta(resposta);
      return resposta.status === 204 ? null : await resposta.json();
    } catch (erro) {
      if (erro instanceof ErroApi) throw erro;
      if (erro && erro.name === 'AbortError') {
        throw new ErroApi('O servidor demorou demais para responder.');
      }
      console.error('Falha de rede ao chamar a API:', erro);
      throw new ErroApi(
        'Não foi possível conectar ao servidor. Verifique sua conexão e se a API está no ar (e com CORS liberado).'
      );
    } finally {
      clearTimeout(temporizador);
    }
  }

  /* ==========================================================
     Transporte MOCK — simula a API no navegador, mesmo contrato
     ========================================================== */

  const pad2 = (n) => String(n).padStart(2, '0');
  function localIso(d = new Date()) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  const mockSolicitacoes = () => [...window.ZELA_MOCK.solicitacoes, ...lerLS(CHAVE_MOCK, [])];
  const semFoto = (s) => ({ ...s, imagem: s.imagem ? { ...s.imagem, strDadosBase64: null } : null });

  function mockBuscar(id) {
    const s = mockSolicitacoes().find((x) => String(x.lngId) === String(id));
    if (!s) throw new ErroApi(`Solicitação de zeladoria não encontrada com o ID: ${id}`, { status: 404 });
    return s;
  }

  function tamanhoBase64(texto) {
    const t = String(texto);
    const limpo = t.includes(',') ? t.slice(t.indexOf(',') + 1) : t;
    try {
      return atob(limpo.trim()).length;
    } catch (e) {
      throw new ErroApi('O conteúdo da imagem enviado não é uma string Base64 válida.', { status: 422 });
    }
  }

  function mockListar(q) {
    const status = q.get('strStatus');
    const categoria = q.get('lngCategoriaId');
    let lista = mockSolicitacoes();
    if (status) lista = lista.filter((s) => s.strStatus === status);
    if (categoria) lista = lista.filter((s) => String(s.categoria.lngId) === categoria);
    lista.sort((a, b) => (a.dtmSolicitacao < b.dtmSolicitacao ? 1 : -1));
    const pagina = Math.max(0, parseInt(q.get('page') || '0', 10) || 0);
    const tamanho = Math.min(Math.max(1, parseInt(q.get('size') || '10', 10) || 10), 2000);
    return {
      content: lista.slice(pagina * tamanho, (pagina + 1) * tamanho).map(semFoto),
      number: pagina,
      size: tamanho,
      totalElements: lista.length,
      totalPages: Math.ceil(lista.length / tamanho),
      first: pagina === 0,
      last: (pagina + 1) * tamanho >= lista.length,
    };
  }

  function mockCriar(c = {}) {
    const d = {};
    if (!c.strTelefoneUsuario) d.strTelefoneUsuario = 'O telefone do usuário (strTelefoneUsuario) é obrigatório';
    if (!/^[^@\s]+@[^@\s]+$/.test(c.strEmailUsuario || '')) d.strEmailUsuario = 'Informe um endereço de e-mail válido';
    if (typeof c.dblLatitude !== 'number') d.dblLatitude = 'A latitude da geolocalização (dblLatitude) é obrigatória';
    if (typeof c.dblLongitude !== 'number') d.dblLongitude = 'A longitude da geolocalização (dblLongitude) é obrigatória';
    if (!c.lngCategoriaId) d.lngCategoriaId = 'O ID da categoria do problema (lngCategoriaId) é obrigatório';
    if (!c.strDescricao || !String(c.strDescricao).trim()) d.strDescricao = 'A descrição do problema (strDescricao) é obrigatória';
    if (!c.imagem || !c.imagem.strDadosBase64) d.imagem = 'A imagem do problema é obrigatória';
    if (Object.keys(d).length) {
      throw new ErroApi('Um ou mais campos estão inválidos. Verifique os detalhes.', { status: 400, detalhes: d });
    }

    const categoria = window.ZELA_MOCK.categorias.find((x) => x.lngId === Number(c.lngCategoriaId));
    if (!categoria) throw new ErroApi(`Categoria não encontrada com o ID: ${c.lngCategoriaId}`, { status: 404 });
    const tamanho = tamanhoBase64(c.imagem.strDadosBase64);

    const proximoId = Math.max(0, ...mockSolicitacoes().map((s) => s.lngId)) + 1;
    const agora = localIso();
    const nova = {
      lngId: proximoId,
      strTelefoneUsuario: c.strTelefoneUsuario,
      strEmailUsuario: c.strEmailUsuario,
      dblLatitude: c.dblLatitude,
      dblLongitude: c.dblLongitude,
      strEnderecoReferencia: c.strEnderecoReferencia || null,
      dtmSolicitacao: agora,
      categoria: structuredClone(categoria),
      imagem: {
        lngId: proximoId,
        strNomeArquivo: c.imagem.strNomeArquivo,
        strTipoConteudo: c.imagem.strTipoConteudo,
        lngTamanhoBytes: tamanho,
        strDadosBase64: c.imagem.strDadosBase64,
        dtmCriacao: agora,
      },
      strDescricao: c.strDescricao,
      strStatus: 'ABERTA',
      dtmAtualizacao: agora,
    };

    const guardadas = lerLS(CHAVE_MOCK, []);
    guardadas.push(nova);
    if (!gravarLS(CHAVE_MOCK, guardadas)) {
      // Foto grande demais para o localStorage: guarda sem a foto.
      nova.imagem = null;
      guardadas[guardadas.length - 1] = nova;
      if (!gravarLS(CHAVE_MOCK, guardadas)) {
        throw new ErroApi('Armazenamento do navegador cheio (modo demonstração).', { status: 507 });
      }
    }
    return semFoto(nova);
  }

  async function mockHttp(caminho, { metodo = 'GET', corpo } = {}) {
    await espera(CONFIG.MOCK_LATENCY_MS);
    const url = new URL(caminho, 'http://mock.local');
    const [recurso, id, sub] = url.pathname.split('/').filter(Boolean);

    if (recurso === 'categorias' && metodo === 'GET' && !id) {
      return structuredClone(window.ZELA_MOCK.categorias);
    }
    if (recurso === 'solicitacoes') {
      if (!id && metodo === 'GET') return mockListar(url.searchParams);
      if (!id && metodo === 'POST') return mockCriar(corpo);
      if (id && !sub && metodo === 'GET') return semFoto(mockBuscar(id));
      if (id && sub === 'imagem' && metodo === 'GET') {
        const s = mockBuscar(id);
        if (!s.imagem || !s.imagem.strDadosBase64) {
          throw new ErroApi(`Nenhuma imagem encontrada para a solicitação ID: ${id}`, { status: 404 });
        }
        return s.imagem;
      }
    }
    throw new ErroApi('Endpoint inexistente no modo demonstração.', { status: 404 });
  }

  /* ==========================================================
     API pública (usada pelo script.js)
     ========================================================== */

  const transporte = () => (CONFIG.USE_MOCK ? mockHttp : http);
  const cacheFotos = new Map();

  async function listarCategorias() {
    const lista = await transporte()('/categorias');
    return lista.map(adaptarCategoria);
  }

  /** Busca todas as páginas (até MAX_PAGINAS) e devolve a lista já traduzida. */
  async function listarOcorrencias(filtros = {}) {
    const itens = [];
    for (let n = 0; n < CONFIG.MAX_PAGINAS; n += 1) {
      const params = new URLSearchParams({
        page: n,
        size: CONFIG.TAMANHO_PAGINA,
        sort: 'dtmSolicitacao,desc',
      });
      if (filtros.status) params.set('strStatus', String(filtros.status).toUpperCase());
      if (filtros.categoria) params.set('lngCategoriaId', filtros.categoria);

      const pagina = await transporte()(`/solicitacoes?${params}`);
      itens.push(...(pagina.content || []).map(adaptarSolicitacao));
      if (pagina.last !== false) break;
    }
    return itens.sort(porDataDesc);
  }

  async function listarMinhasOcorrencias() {
    const ids = lerIds();
    if (ids.length === 0) return [];

    const resultados = await Promise.allSettled(ids.map((id) => transporte()(`/solicitacoes/${id}`)));
    const encontradas = [];
    const manter = [];
    let falhaDeRede = null;

    resultados.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        encontradas.push(adaptarSolicitacao(r.value));
        manter.push(ids[i]);
      } else if (!(r.reason && r.reason.status === 404)) {
        manter.push(ids[i]); // falha temporária: não esquece a ocorrência
        falhaDeRede = falhaDeRede || r.reason;
      } // 404: foi excluída no servidor, deixa de aparecer
    });

    if (manter.length !== ids.length) gravarIds(manter);
    if (encontradas.length === 0 && falhaDeRede) throw falhaDeRede;
    return encontradas.sort(porDataDesc);
  }

  /** dados: { categoria, descricao, bairro, latitude, longitude, email, telefone, foto (data URL), fotoNome } */
  async function criarOcorrencia(dados) {
    const foto = separarDataUrl(dados.foto);
    if (!foto) throw new ErroApi('A foto do problema é obrigatória.', { status: 400 });

    const corpo = {
      strTelefoneUsuario: dados.telefone,
      strEmailUsuario: dados.email,
      dblLatitude: dados.latitude,
      dblLongitude: dados.longitude,
      strEnderecoReferencia: dados.bairro || null,
      lngCategoriaId: Number(dados.categoria),
      strDescricao: dados.descricao,
      imagem: {
        strNomeArquivo: String(dados.fotoNome || 'foto.jpg').slice(0, 255),
        strTipoConteudo: foto.tipo,
        strDadosBase64: foto.dados,
      },
    };

    const criada = await transporte()('/solicitacoes', { metodo: 'POST', corpo });
    const adaptada = adaptarSolicitacao(criada);
    registrarMinha(adaptada.id);
    return adaptada;
  }

  /** Foto de uma ocorrência como data URL (ou null se não houver/for inválida). */
  async function obterFoto(id) {
    if (cacheFotos.has(id)) return cacheFotos.get(id);
    try {
      const img = await transporte()(`/solicitacoes/${encodeURIComponent(id)}/imagem`);
      const url = montarDataUrl(img);
      cacheFotos.set(id, url);
      return url;
    } catch (erro) {
      if (erro && erro.status === 404) {
        cacheFotos.set(id, null);
        return null;
      }
      throw erro;
    }
  }

  window.ZelaAPI = {
    CONFIG,
    ErroApi,
    listarCategorias,
    listarOcorrencias,
    listarMinhasOcorrencias,
    criarOcorrencia,
    obterFoto,
  };
})();
