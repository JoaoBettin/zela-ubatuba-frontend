/**
 * admin.js — Tela de administração do Zela Ubatuba.
 *
 * Só conversa com window.ZelaAPI (api.js). Painel com resumo, gestão das
 * solicitações (mudar situação, ver contato, excluir, exportar) e cadastro de
 * categorias. ATENÇÃO: a API ainda não tem autenticação; esta tela não protege nada.
 */
(() => {
  'use strict';

  const API = window.ZelaAPI;

  const STATUS = [
    { id: 'aberta', rotulo: 'Aberta', ajuda: 'Recebida, ainda sem análise.' },
    { id: 'em_analise', rotulo: 'Em análise', ajuda: 'A equipe está avaliando o problema.' },
    { id: 'em_andamento', rotulo: 'Em andamento', ajuda: 'O serviço está sendo executado.' },
    { id: 'concluida', rotulo: 'Concluída', ajuda: 'Resolvida. Depois disso a situação não muda mais.' },
    { id: 'cancelada', rotulo: 'Cancelada', ajuda: 'Encerrada sem execução. Depois disso a situação não muda mais.' },
  ];
  const ROTULO = Object.fromEntries(STATUS.map((s) => [s.id, s.rotulo]));
  const FINAIS = ['concluida', 'cancelada'];
  const POR_PAGINA = 15;
  const VIEWS = { painel: 'Painel', solicitacoes: 'Solicitações', categorias: 'Categorias' };

  const estado = {
    categorias: [],
    solicitacoes: [],
    atual: null, // solicitação aberta no modal
    atualId: null,
    aoConfirmar: null,
  };

  /* ==========================================================
     Utilitários
     ========================================================== */

  const $ = (sel) => document.querySelector(sel);

  /** Cria elementos sem innerHTML (texto sempre como texto). */
  function h(tag, props = {}, ...filhos) {
    const no = document.createElement(tag);
    Object.entries(props).forEach(([chave, valor]) => {
      if (valor === null || valor === undefined || valor === false) return;
      if (chave === 'class') no.className = valor;
      else if (chave.startsWith('on') && typeof valor === 'function') no.addEventListener(chave.slice(2).toLowerCase(), valor);
      else no.setAttribute(chave, valor === true ? '' : valor);
    });
    filhos.flat().forEach((filho) => {
      if (filho === null || filho === undefined || filho === false) return;
      no.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
    });
    return no;
  }

  const icone = (nome) => h('i', { class: `bi ${nome}`, 'aria-hidden': 'true' });
  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const formatadorData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const formatarData = (iso) => (iso ? formatadorData.format(new Date(iso)) : '—');
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  function limpar(no) {
    while (no.firstChild) no.removeChild(no.firstChild);
    return no;
  }

  function badgeStatus(status) {
    return h('span', { class: `status-badge status-${status}` }, ROTULO[status] || status);
  }

  const modal = (id) => bootstrap.Modal.getOrCreateInstance(document.getElementById(id));

  function aviso(texto, tipo = 'success') {
    const caixa = $('#toasts');
    const corpo = h('div', { class: 'toast-body' }, texto);
    const botao = h('button', { type: 'button', class: 'btn-close btn-close-white me-2 m-auto', 'data-bs-dismiss': 'toast', 'aria-label': 'Fechar aviso' });
    const toast = h('div', { class: `toast align-items-center text-bg-${tipo} border-0`, role: tipo === 'danger' ? 'alert' : 'status', 'aria-live': tipo === 'danger' ? 'assertive' : 'polite', 'aria-atomic': 'true' },
      h('div', { class: 'd-flex' }, corpo, botao));
    caixa.append(toast);
    toast.addEventListener('hidden.bs.toast', () => toast.remove());
    bootstrap.Toast.getOrCreateInstance(toast, { delay: 5000 }).show();
  }

  const mensagemDeErro = (erro) => (erro && erro.message) || 'Algo deu errado. Tente novamente.';

  /* ==========================================================
     Carga de dados
     ========================================================== */

  /** Carrega categorias e a lista completa (para o painel) e atualiza as tabelas. */
  async function carregar() {
    $('#erroCarga').hidden = true;
    try {
      const [categorias, solicitacoes] = await Promise.all([API.listarCategorias(), API.listarOcorrenciasAdmin()]);
      estado.categorias = categorias;
      estado.solicitacoes = solicitacoes;
      renderPainel();
      renderFiltrosOpcoes();
      renderCategorias();
      if (tabelaSol) tabelaSol.ajax.reload(null, false);
      else iniciarTabelaSolicitacoes();
    } catch (erro) {
      $('#erroCargaTexto').textContent = mensagemDeErro(erro);
      $('#erroCarga').hidden = false;
    }
  }

  /* ==========================================================
     Painel
     ========================================================== */

  const contar = (lista, fn) => {
    const mapa = new Map();
    lista.forEach((item) => mapa.set(fn(item), (mapa.get(fn(item)) || 0) + 1));
    return mapa;
  };

  function kpi(rotulo, valor, destaque = false) {
    return h('div', { class: `adm-kpi${destaque ? ' adm-kpi-destaque' : ''}` },
      h('p', { class: 'adm-kpi-rotulo' }, rotulo),
      h('p', { class: 'adm-kpi-valor' }, valor));
  }

  function barras(itens, total) {
    if (itens.length === 0) return h('p', { class: 'adm-vazio' }, 'Sem dados ainda.');
    const maior = Math.max(1, ...itens.map((i) => i.valor));
    return h('ul', { class: 'adm-barras' }, itens.map((i) => {
      const pct = total ? Math.round((i.valor / total) * 100) : 0;
      return h('li', { class: 'adm-barra-linha' },
        h('span', { class: 'adm-barra-nome', title: i.rotulo }, i.rotulo),
        h('span', { class: 'adm-barra-valor' }, `${i.valor} `, h('span', { class: 'fw-normal text-body-secondary small' }, `(${pct}%)`)),
        h('span', { class: 'adm-barra-trilho', 'aria-hidden': 'true' },
          h('span', { class: 'adm-barra', style: `width:${(i.valor / maior) * 100}%` })));
    }));
  }

  function renderPainel() {
    const lista = estado.solicitacoes;
    const porStatus = contar(lista, (s) => s.status);

    limpar($('#kpis')).append(
      kpi('Total de solicitações', lista.length, true),
      ...STATUS.map((s) => kpi(s.rotulo, porStatus.get(s.id) || 0))
    );

    limpar($('#graficoStatus')).append(
      barras(STATUS.map((s) => ({ rotulo: s.rotulo, valor: porStatus.get(s.id) || 0 })), lista.length)
    );

    const porCategoria = contar(lista, (s) => (s.categoriaInfo ? s.categoriaInfo.nome : 'Sem categoria'));
    const itensCategoria = [...porCategoria.entries()]
      .map(([rotulo, valor]) => ({ rotulo, valor }))
      .sort((a, b) => b.valor - a.valor || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
    limpar($('#graficoCategorias')).append(barras(itensCategoria, lista.length));

    renderDias(lista);
  }

  function renderDias(lista) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const dias = [];
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(hoje);
      d.setDate(hoje.getDate() - i);
      dias.push({ data: d, valor: 0 });
    }
    const inicio = dias[0].data.getTime();
    lista.forEach((s) => {
      const d = new Date(s.criadoEm);
      d.setHours(0, 0, 0, 0);
      const indice = Math.round((d.getTime() - inicio) / 86400000);
      if (indice >= 0 && indice < 14) dias[indice].valor += 1;
    });

    const maior = Math.max(1, ...dias.map((d) => d.valor));
    const total = dias.reduce((soma, d) => soma + d.valor, 0);
    const rotulo = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

    $('#resumoDias').textContent = `${plural(total, 'solicitação nova', 'solicitações novas')} nesse período.`;
    limpar($('#graficoDias')).append(
      h('div', { class: 'adm-dias' }, dias.map((d) =>
        h('div', { class: 'adm-dia', title: `${rotulo(d.data)}: ${plural(d.valor, 'solicitação', 'solicitações')}` },
          h('span', { class: 'visually-hidden' }, `${rotulo(d.data)}: ${plural(d.valor, 'solicitação', 'solicitações')}`),
          h('span', { class: 'adm-dia-valor', 'aria-hidden': 'true' }, d.valor || ''),
          h('span', { class: `adm-dia-coluna${d.valor ? '' : ' vazia'}`, 'aria-hidden': 'true', style: `height:${d.valor ? Math.max(4, (d.valor / maior) * 120) : 2}px` })))),
      h('div', { class: 'adm-dias-rotulos', 'aria-hidden': 'true' }, dias.map((d) => h('span', {}, rotulo(d.data))))
    );
  }

  /* ==========================================================
     Solicitações: DataTables com paginação no servidor
     ========================================================== */

  const LINGUAGEM = {
    emptyTable: 'Nenhuma solicitação encontrada.',
    zeroRecords: 'Nenhum registro encontrado.',
    info: 'Mostrando _START_ a _END_ de _TOTAL_',
    infoEmpty: 'Nenhuma solicitação',
    infoFiltered: '',
    lengthMenu: 'Mostrar _MENU_ por página',
    loadingRecords: 'Carregando…',
    processing: 'Carregando…',
    search: 'Buscar:',
    searchPlaceholder: 'Digite para filtrar',
    paginate: { first: 'Primeira', last: 'Última', next: 'Próxima', previous: 'Anterior' },
    aria: { paginate: { first: 'Primeira página', last: 'Última página', next: 'Próxima página', previous: 'Página anterior' } },
  };

  let tabelaSol = null;
  let tabelaCat = null;

  // coluna da tabela -> campo ordenável no back-end (null = não ordena)
  const CAMPOS_ORDEM = ['lngId', null, 'strDescricao', 'dtmSolicitacao', 'strStatus', null];

  function renderFiltrosOpcoes() {
    const selStatus = $('#fStatus');
    const selCat = $('#fCategoria');
    const valorStatus = selStatus.value;
    const valorCat = selCat.value;

    limpar(selStatus).append(h('option', { value: '' }, 'Todas'), ...STATUS.map((s) => h('option', { value: s.id }, s.rotulo)));
    limpar(selCat).append(h('option', { value: '' }, 'Todas'), ...estado.categorias.map((c) => h('option', { value: c.id }, c.nome)));
    selStatus.value = valorStatus;
    selCat.value = estado.categorias.some((c) => c.id === valorCat) ? valorCat : '';
  }

  const filtrosAtuais = () => ({ status: $('#fStatus').value, categoria: $('#fCategoria').value });

  function iniciarTabelaSolicitacoes() {
    tabelaSol = new DataTable('#tabelaSolicitacoes', {
      serverSide: true,
      processing: true,
      searching: false, // a API só filtra por situação e categoria
      pageLength: 15,
      lengthMenu: [10, 15, 25, 50],
      order: [[3, 'desc']],
      language: LINGUAGEM,
      columns: [
        { data: null, defaultContent: '', className: 'adm-protocolo' },
        { data: null, defaultContent: '', orderable: false },
        { data: null, defaultContent: '', className: 'adm-celula-texto' },
        { data: null, defaultContent: '', className: 'text-nowrap' },
        { data: null, defaultContent: '' },
        { data: null, defaultContent: '', orderable: false, className: 'text-end' },
      ],
      // O DataTables pergunta "página X, N linhas, ordenado por Y"; traduzimos para a API Spring.
      ajax: (dt, retorno) => {
        const ordem = dt.order[0] || { column: 3, dir: 'desc' };
        API.listarPaginaAdmin({
          pagina: Math.floor(dt.start / dt.length),
          tamanho: dt.length,
          ordenar: CAMPOS_ORDEM[ordem.column] || 'dtmSolicitacao',
          direcao: ordem.dir,
          ...filtrosAtuais(),
        }).then((r) => {
          $('#erroCarga').hidden = true;
          retorno({ draw: dt.draw, recordsTotal: r.total, recordsFiltered: r.total, data: r.itens });
        }).catch((erro) => {
          retorno({ draw: dt.draw, recordsTotal: 0, recordsFiltered: 0, data: [] });
          $('#erroCargaTexto').textContent = mensagemDeErro(erro);
          $('#erroCarga').hidden = false;
        });
      },
      // Monta as células com createElement (texto sempre como texto, nunca como HTML).
      createdRow: (linha, s) => {
        const celulas = linha.children;
        celulas[0].textContent = s.protocolo;
        celulas[1].textContent = s.categoriaInfo ? s.categoriaInfo.nome : '—';
        celulas[2].append(
          h('span', { class: 'adm-linha-1' }, s.descricao),
          h('span', { class: 'adm-linha-2' }, s.bairro || 'Sem ponto de referência'));
        celulas[3].textContent = formatarData(s.criadoEm);
        celulas[4].append(badgeStatus(s.status));
        celulas[5].append(h('button', { type: 'button', class: 'btn btn-sm btn-outline-primary', onclick: () => abrirSolicitacao(s) },
          icone('bi-eye'), ' Abrir', h('span', { class: 'visually-hidden' }, ` ${s.protocolo}`)));
      },
    });
  }

  /* ---------- Exportar CSV ---------- */

  function celulaCsv(valor) {
    let texto = String(valor ?? '');
    if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`; // evita fórmulas ao abrir no Excel
    return `"${texto.replace(/"/g, '""')}"`;
  }

  /** Exporta tudo que bate com os filtros de situação e categoria (até 1000 itens). */
  async function exportarCsv() {
    const botao = $('#btnExportar');
    botao.disabled = true;
    let lista;
    try {
      lista = await API.listarOcorrenciasAdmin(filtrosAtuais());
    } catch (e) {
      aviso(mensagemDeErro(e), 'danger');
      botao.disabled = false;
      botao.focus();
      return;
    }
    const cabecalho = ['Protocolo', 'Categoria', 'Descrição', 'Local', 'Latitude', 'Longitude', 'Telefone', 'E-mail', 'Situação', 'Registrada em', 'Atualizada em'];
    const linhas = lista.map((s) => [
      s.protocolo, s.categoriaInfo ? s.categoriaInfo.nome : '', s.descricao, s.bairro, s.latitude, s.longitude,
      s.telefone, s.email, ROTULO[s.status] || s.status, formatarData(s.criadoEm), formatarData(s.atualizadoEm),
    ]);
    const csv = [cabecalho, ...linhas].map((l) => l.map(celulaCsv).join(';')).join('\r\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `solicitacoes-zela-ubatuba-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    botao.disabled = false;
    botao.focus();
    aviso(`${plural(linhas.length, 'solicitação exportada', 'solicitações exportadas')}. O arquivo contém telefone e e-mail: guarde com cuidado.`);
  }

  /* ==========================================================
     Detalhe da solicitação
     ========================================================== */

  function abrirSolicitacao(s) {
    estado.atual = s;
    estado.atualId = s.id;
    renderDetalhe();
    modal('modalSolicitacao').show();
  }

  function linkSeguro(tipo, valor, texto) {
    const ok = tipo === 'tel' ? /^[+\d\s()\-.]{6,30}$/.test(valor) : /^[^@\s<>"]+@[^@\s<>"]+$/.test(valor);
    return ok ? h('a', { href: `${tipo}:${valor.replace(/\s+/g, '')}` }, texto || valor) : (texto || valor || '—');
  }

  function renderDetalhe({ focarFormulario = false } = {}) {
    const s = estado.atual;
    if (!s) return;
    $('#solTitulo').textContent = `Solicitação ${s.protocolo}`;
    const corpo = limpar($('#solCorpo'));

    const quadroFoto = h('div', { class: 'mb-3', 'aria-live': 'polite' });
    if (s.temFoto) {
      quadroFoto.append(h('div', { class: 'adm-foto-vazia' }, 'Carregando foto…'));
      API.obterFoto(s.id).then((url) => {
        if (estado.atualId !== s.id) return;
        limpar(quadroFoto).append(url
          ? h('img', { class: 'adm-foto', src: url, alt: `Foto enviada pelo cidadão: ${s.descricao.slice(0, 80)}` })
          : h('div', { class: 'adm-foto-vazia' }, 'Foto indisponível.'));
      }).catch(() => limpar(quadroFoto).append(h('div', { class: 'adm-foto-vazia' }, 'Não foi possível carregar a foto.')));
    } else {
      quadroFoto.append(h('div', { class: 'adm-foto-vazia' }, 'Sem foto.'));
    }

    const temCoord = typeof s.latitude === 'number' && typeof s.longitude === 'number';
    const mapaLink = temCoord
      ? h('a', { href: `https://www.openstreetmap.org/?mlat=${s.latitude}&mlon=${s.longitude}#map=18/${s.latitude}/${s.longitude}`, target: '_blank', rel: 'noopener noreferrer' },
        `${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)} `, icone('bi-box-arrow-up-right'), h('span', { class: 'visually-hidden' }, ' (abre o mapa em outra aba)'))
      : '—';

    const dl = h('dl', { class: 'adm-dl mb-4' },
      h('dt', {}, 'Categoria'), h('dd', {}, s.categoriaInfo ? s.categoriaInfo.nome : '—'),
      h('dt', {}, 'Descrição'), h('dd', {}, s.descricao),
      h('dt', {}, 'Local'), h('dd', {}, s.bairro || 'Sem ponto de referência'),
      h('dt', {}, 'Coordenadas'), h('dd', {}, mapaLink),
      h('dt', {}, 'Telefone'), h('dd', {}, linkSeguro('tel', s.telefone) || '—'),
      h('dt', {}, 'E-mail'), h('dd', {}, linkSeguro('mailto', s.email) || '—'),
      h('dt', {}, 'Registrada em'), h('dd', {}, formatarData(s.criadoEm)),
      h('dt', {}, 'Última atualização'), h('dd', {}, formatarData(s.atualizadoEm)),
      h('dt', {}, 'Situação atual'), h('dd', {}, badgeStatus(s.status)));

    corpo.append(quadroFoto, dl, formularioStatus(s));
    $('#btnExcluirSolicitacao').disabled = false;
    // o formulário foi recriado: devolve o foco ao título dele para o teclado não se perder
    if (focarFormulario) corpo.querySelector('.adm-form-status h3').focus();
  }

  function formularioStatus(s) {
    const final = FINAIS.includes(s.status);
    const select = h('select', { id: 'selNovoStatus', class: 'form-select', disabled: final, 'aria-describedby': 'ajudaStatus' },
      STATUS.map((o) => h('option', { value: o.id, selected: o.id === s.status }, o.rotulo)));
    const ajuda = h('div', { id: 'ajudaStatus', class: 'form-text' },
      final ? 'Esta solicitação já foi finalizada: a API não permite mais alterar a situação.' : STATUS.find((o) => o.id === s.status).ajuda);
    const erro = h('div', { id: 'statusErro', class: 'alert alert-danger mt-2 mb-0', role: 'alert', hidden: true });
    const botao = h('button', { type: 'submit', class: 'btn btn-zu-acao', disabled: final }, icone('bi-check2'), ' Salvar situação');

    select.addEventListener('change', () => {
      const info = STATUS.find((o) => o.id === select.value);
      ajuda.textContent = info.ajuda;
    });

    const form = h('form', { class: 'adm-form-status', novalidate: true },
      h('h3', { class: 'fs-6 fw-bold', tabindex: '-1' }, 'Alterar situação'),
      h('label', { for: 'selNovoStatus', class: 'form-label' }, 'Nova situação'),
      h('div', { class: 'd-flex flex-wrap gap-2' }, h('div', { class: 'flex-grow-1' }, select), botao),
      ajuda, erro);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const novo = select.value;
      if (novo === s.status) {
        erro.textContent = 'Escolha uma situação diferente da atual.';
        erro.hidden = false;
        return;
      }
      erro.hidden = true;
      botao.disabled = true;
      try {
        const atualizada = await API.atualizarStatus(s.id, novo);
        Object.assign(s, { status: atualizada.status, atualizadoEm: atualizada.atualizadoEm });
        renderDetalhe({ focarFormulario: true });
        carregar(); // atualiza painel e tabela
        aviso(`Situação de ${s.protocolo} alterada para “${ROTULO[s.status]}”.`);
      } catch (e) {
        erro.textContent = mensagemDeErro(e);
        erro.hidden = false;
        botao.disabled = false;
        botao.focus(); // desabilitar o botão tirou o foco da janela: devolve
      }
    });
    return form;
  }

  /* ==========================================================
     Confirmação genérica (exclusões)
     ========================================================== */

  function confirmar({ titulo, texto, botao = 'Excluir', acao }) {
    $('#confTitulo').textContent = titulo;
    $('#confTexto').textContent = texto;
    $('#btnConfirmar').textContent = botao;
    $('#btnConfirmar').disabled = false;
    $('#confErro').hidden = true;
    estado.aoConfirmar = acao;
    modal('modalConfirmar').show();
  }

  async function executarConfirmacao() {
    const botao = $('#btnConfirmar');
    botao.disabled = true;
    $('#confErro').hidden = true;
    try {
      await estado.aoConfirmar();
      modal('modalConfirmar').hide();
    } catch (e) {
      $('#confErro').textContent = mensagemDeErro(e);
      $('#confErro').hidden = false;
      botao.disabled = false;
      botao.focus();
    }
  }

  function pedirExclusaoSolicitacao() {
    const s = estado.atual;
    if (!s) return;
    const el = document.getElementById('modalSolicitacao');
    el.addEventListener('hidden.bs.modal', () => {
      confirmar({
        titulo: 'Excluir solicitação?',
        texto: `A solicitação ${s.protocolo} (${s.categoriaInfo ? s.categoriaInfo.nome : 'sem categoria'}) deixará de aparecer no site e no painel. Essa ação não pode ser desfeita por aqui.`,
        acao: async () => {
          await API.excluirOcorrencia(s.id);
          estado.atual = null;
          estado.atualId = null;
          await carregar();
          aviso(`Solicitação ${s.protocolo} excluída.`);
        },
      });
    }, { once: true });
    modal('modalSolicitacao').hide();
  }

  /* ==========================================================
     Categorias
     ========================================================== */

  /** Categorias são poucas: o DataTables ordena e busca no próprio navegador. */
  function renderCategorias() {
    const contagem = contar(estado.solicitacoes, (s) => s.categoria);
    if (tabelaCat) {
      tabelaCat.destroy();
      tabelaCat = null;
    }
    const tabela = $('#tabelaCategorias');
    const antigo = tabela.querySelector('tbody');
    if (antigo) antigo.remove();
    const corpo = h('tbody');
    estado.categorias.forEach((c) => {
      const n = contagem.get(c.id) || 0;
      corpo.append(h('tr', {},
        h('td', { class: 'fw-semibold' }, h('i', { class: `bi ${c.icone} me-2`, style: `color:${c.corEscura}`, 'aria-hidden': 'true' }), c.nome),
        h('td', { class: 'adm-celula-texto' }, h('span', { class: 'adm-linha-1' }, c.descricao || '—')),
        h('td', { class: 'text-end' }, n),
        h('td', { class: 'text-end text-nowrap' },
          h('button', { type: 'button', class: 'btn btn-sm btn-outline-primary me-1', onclick: () => abrirFormCategoria(c) },
            icone('bi-pencil'), ' Editar', h('span', { class: 'visually-hidden' }, ` ${c.nome}`)),
          h('button', { type: 'button', class: 'btn btn-sm btn-outline-danger', onclick: () => pedirExclusaoCategoria(c, n) },
            icone('bi-trash3'), ' Excluir', h('span', { class: 'visually-hidden' }, ` ${c.nome}`)))));
    });
    tabela.append(corpo);
    tabelaCat = new DataTable('#tabelaCategorias', {
      paging: false,
      info: false,
      order: [[0, 'asc']],
      columnDefs: [{ targets: 3, orderable: false }],
      language: { ...LINGUAGEM, emptyTable: 'Nenhuma categoria cadastrada.', search: 'Buscar categoria:' },
    });
  }

  let categoriaEditando = null;

  function contadores() {
    $('#catNomeContagem').textContent = $('#catNome').value.length;
    $('#catDescContagem').textContent = $('#catDescricao').value.length;
  }

  function abrirFormCategoria(categoria = null) {
    categoriaEditando = categoria;
    $('#catTitulo').textContent = categoria ? 'Editar categoria' : 'Nova categoria';
    $('#catNome').value = categoria ? categoria.nome : '';
    $('#catDescricao').value = categoria ? categoria.descricao : '';
    $('#catNome').classList.remove('is-invalid');
    $('#catErro').hidden = true;
    $('#btnSalvarCategoria').disabled = false;
    contadores();
    modal('modalCategoria').show();
  }

  async function salvarCategoria(ev) {
    ev.preventDefault();
    const nome = $('#catNome').value.trim();
    $('#catErro').hidden = true;
    if (!nome) {
      $('#catNome').classList.add('is-invalid');
      $('#catNome').focus();
      return;
    }
    $('#catNome').classList.remove('is-invalid');
    const botao = $('#btnSalvarCategoria');
    botao.disabled = true;
    const dados = { nome, descricao: $('#catDescricao').value };
    try {
      if (categoriaEditando) await API.atualizarCategoria(categoriaEditando.id, dados);
      else await API.criarCategoria(dados);
      modal('modalCategoria').hide();
      aviso(categoriaEditando ? `Categoria “${nome}” atualizada.` : `Categoria “${nome}” criada.`);
      await carregar();
    } catch (e) {
      $('#catErro').textContent = mensagemDeErro(e);
      $('#catErro').hidden = false;
      botao.disabled = false;
      botao.focus();
    }
  }

  function pedirExclusaoCategoria(c, quantidade) {
    const aviso2 = quantidade > 0
      ? ` Ela é usada por ${plural(quantidade, 'solicitação', 'solicitações')} existentes.`
      : '';
    confirmar({
      titulo: 'Excluir categoria?',
      texto: `A categoria “${c.nome}” deixará de ser oferecida no formulário do cidadão.${aviso2}`,
      acao: async () => {
        await API.excluirCategoria(c.id);
        aviso(`Categoria “${c.nome}” excluída.`);
        await carregar();
      },
    });
  }

  /* ==========================================================
     Navegação por abas (hash)
     ========================================================== */

  function mostrarView(nome, { foco = false } = {}) {
    if (!VIEWS[nome]) nome = 'painel';
    document.querySelectorAll('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== nome; });
    document.querySelectorAll('[data-view-link]').forEach((a) => {
      if (a.dataset.viewLink === nome) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.title = `${VIEWS[nome]} · Administração · Zela Ubatuba`;
    if (foco) $(`#titulo-${nome}`).focus();
  }

  const viewDoHash = () => location.hash.replace('#', '') || 'painel';

  /* ==========================================================
     Início
     ========================================================== */

  function iniciar() {
    if (API.CONFIG.USE_MOCK) {
      $('#rodapeModo').textContent = 'Modo demonstração: dados fictícios, salvos só neste navegador.';
      const link = document.querySelector('a[href="../index.html"]');
      if (link) link.setAttribute('href', '../index.html?mock=1');
    } else {
      $('#rodapeModo').textContent = `Dados da API (${API.CONFIG.BASE_URL})`;
    }

    mostrarView(viewDoHash());
    window.addEventListener('hashchange', () => mostrarView(viewDoHash(), { foco: true }));

    ['fStatus', 'fCategoria'].forEach((id) => {
      document.getElementById(id).addEventListener('change', () => { if (tabelaSol) tabelaSol.ajax.reload(); });
    });
    $('#filtros').addEventListener('submit', (ev) => ev.preventDefault());
    $('#btnLimpar').addEventListener('click', () => {
      $('#fStatus').value = '';
      $('#fCategoria').value = '';
      if (tabelaSol) tabelaSol.ajax.reload();
      $('#fStatus').focus();
    });
    $('#btnExportar').addEventListener('click', exportarCsv);

    $('#btnExcluirSolicitacao').addEventListener('click', pedirExclusaoSolicitacao);
    $('#btnConfirmar').addEventListener('click', executarConfirmacao);

    $('#btnNovaCategoria').addEventListener('click', () => abrirFormCategoria());
    $('#formCategoria').addEventListener('submit', salvarCategoria);
    $('#catNome').addEventListener('input', contadores);
    $('#catDescricao').addEventListener('input', contadores);
    document.getElementById('modalCategoria').addEventListener('shown.bs.modal', () => $('#catNome').focus());

    $('#btnTentarNovamente').addEventListener('click', carregar);
    carregar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
