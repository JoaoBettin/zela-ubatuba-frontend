/**
 * script.js — Interface do Zela Ubatuba.
 * Depende de: Bootstrap 5 (bundle), Leaflet, api.js (window.ZelaAPI).
 */
(() => {
  'use strict';

  const API = window.ZelaAPI;

  /* ==========================================================
     Constantes e estado
     ========================================================== */

  const CENTRO_UBATUBA = [-23.4336, -45.0838];
  const LIMITES_UBATUBA = { latMin: -23.6, latMax: -23.2, lngMin: -45.3, lngMax: -44.8 };
  const LIMITE_FOTO_MB = 10;

  const STATUS = {
    aberta: { rotulo: 'Aberta' },
    em_analise: { rotulo: 'Em análise' },
    em_andamento: { rotulo: 'Em andamento' },
    concluida: { rotulo: 'Concluída' },
    cancelada: { rotulo: 'Cancelada' },
  };

  const TITULOS = {
    inicio: 'Início',
    mapa: 'Mapa de ocorrências',
    minhas: 'Minhas ocorrências',
  };

  const estado = {
    categorias: [],
    ocorrencias: [],
    minhas: [],
    viewAtual: null,
    focoMapa: null,
    categoriasExtras: new Map(), // categorias que aparecem em ocorrências mas não na lista ativa
    filtros: { categoria: '', status: '' },
  };

  const mapas = { home: null, completo: null, picker: null };
  const localizacao = { lat: null, lng: null, marcador: null };
  let fotoDataUrl = null;
  let fotoNome = null;
  let detalheAtual = null;

  /* ==========================================================
     Utilitários
     ========================================================== */

  const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
  const $$ = (seletor, raiz = document) => Array.from(raiz.querySelectorAll(seletor));

  /** Cria elementos DOM de forma segura (texto sempre via createTextNode). */
  function h(tag, props = {}, ...filhos) {
    const no = document.createElement(tag);
    Object.entries(props).forEach(([chave, valor]) => {
      if (valor === null || valor === undefined || valor === false) return;
      if (chave === 'class') no.className = valor;
      else if (chave === 'style' && typeof valor === 'object') Object.assign(no.style, valor);
      else if (chave.startsWith('on') && typeof valor === 'function') no.addEventListener(chave.slice(2).toLowerCase(), valor);
      else no.setAttribute(chave, valor === true ? '' : valor);
    });
    filhos.flat().forEach((filho) => {
      if (filho === null || filho === undefined || filho === false) return;
      no.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
    });
    return no;
  }

  const normalizar = (texto) =>
    texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const formatadorData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const formatadorRelativo = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

  function tempoRelativo(iso) {
    const minutos = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    if (Math.abs(minutos) < 1) return 'agora mesmo';
    if (Math.abs(minutos) < 60) return formatadorRelativo.format(minutos, 'minute');
    const horas = Math.round(minutos / 60);
    if (Math.abs(horas) < 24) return formatadorRelativo.format(horas, 'hour');
    return formatadorRelativo.format(Math.round(horas / 24), 'day');
  }

  const porDataDesc = (a, b) => new Date(b.criadoEm) - new Date(a.criadoEm);

  function categoriaPorId(id) {
    return (
      estado.categorias.find((c) => c.id === id) ||
      estado.categoriasExtras.get(id) || {
        id,
        nome: 'Outros',
        icone: 'bi-three-dots',
        cor: '#6c757d',
        corEscura: '#495057',
        departamento: '',
      }
    );
  }

  /* ==========================================================
     Avisos (toasts)
     ========================================================== */

  function mostrarToast(mensagem, { tipo = 'success', link = null } = {}) {
    const corpo = h(
      'div',
      { class: 'toast-body d-flex align-items-center justify-content-between gap-3' },
      h('span', {}, mensagem),
      link && h('a', { class: 'fw-semibold text-reset text-decoration-underline', href: link.href }, link.texto)
    );
    const toast = h(
      'div',
      {
        class: `toast align-items-center text-bg-${tipo} border-0`,
        role: tipo === 'danger' ? 'alert' : 'status',
        'aria-live': tipo === 'danger' ? 'assertive' : 'polite',
        'aria-atomic': 'true',
      },
      h(
        'div',
        { class: 'd-flex' },
        corpo,
        h('button', {
          type: 'button',
          class: 'btn-close btn-close-white me-2 m-auto',
          'data-bs-dismiss': 'toast',
          'aria-label': 'Fechar aviso',
        })
      )
    );
    $('#toasts').append(toast);
    toast.addEventListener('hidden.bs.toast', () => toast.remove());
    new bootstrap.Toast(toast, { delay: 8000 }).show();
  }

  /* ==========================================================
     Componentes de interface
     ========================================================== */

  function badgeStatus(status) {
    const info = STATUS[status];
    return h('span', { class: `status-badge status-${status}` }, info ? info.rotulo : status);
  }

  function itemOcorrencia(o) {
    const cat = categoriaPorId(o.categoria);
    const miniatura = o.foto
      ? h('img', { class: 'ocorrencia-foto', src: o.foto, alt: '', loading: 'lazy', width: 56, height: 56 })
      : h(
          'span',
          {
            class: 'ocorrencia-foto',
            style: { background: `${cat.cor}26`, color: cat.corEscura },
            'aria-hidden': 'true',
          },
          h('i', { class: `bi ${cat.icone}` })
        );

    return h(
      'li',
      {},
      h(
        'button',
        { type: 'button', class: 'ocorrencia-item', onclick: () => abrirDetalhe(o.id) },
        miniatura,
        h(
          'span',
          { class: 'ocorrencia-texto' },
          h('span', { class: 'ocorrencia-titulo' }, cat.nome),
          h('span', { class: 'ocorrencia-local' }, o.bairro || 'Local marcado no mapa'),
          h(
            'span',
            { class: 'ocorrencia-meta' },
            badgeStatus(o.status),
            h('time', { datetime: o.criadoEm }, tempoRelativo(o.criadoEm))
          )
        ),
        h('i', { class: 'bi bi-chevron-right ocorrencia-seta', 'aria-hidden': 'true' })
      )
    );
  }

  function renderCategorias() {
    $('#listaCategorias').replaceChildren(
      ...estado.categorias.map((c) =>
        h(
          'li',
          { 'data-nome': normalizar(c.nome) },
          h(
            'button',
            {
              type: 'button',
              class: 'cat-btn',
              'data-bs-toggle': 'modal',
              'data-bs-target': '#modalReportar',
              'data-categoria': c.id,
            },
            h('span', { class: 'cat-circulo', 'aria-hidden': 'true' }, h('i', { class: `bi ${c.icone}` })),
            h('span', { class: 'cat-nome' }, c.nome)
          )
        )
      )
    );

    const opcoes = () => estado.categorias.map((c) => new Option(c.nome, c.id));
    $('#fCategoria').replaceChildren(new Option('Selecione…', ''), ...opcoes());
    $('#filtroCategoria').replaceChildren(new Option('Todas as categorias', ''), ...opcoes());

    $('#legenda').replaceChildren(
      ...estado.categorias.map((c) =>
        h('li', {}, h('span', { class: 'legenda-pin', 'aria-hidden': 'true', style: { background: c.cor } }), c.nome)
      )
    );
  }

  function renderListas() {
    const recentes = [...estado.ocorrencias].sort(porDataDesc).slice(0, 5);
    $('#listaRecentes').replaceChildren(...recentes.map(itemOcorrencia));
    $('#recentesVazio').textContent = 'Nenhuma ocorrência registrada ainda.';
    $('#recentesVazio').hidden = recentes.length > 0;

    const minhas = [...estado.minhas].sort(porDataDesc);
    $('#listaMinhas').replaceChildren(...minhas.map(itemOcorrencia));
    $('#listaMinhas').hidden = minhas.length === 0;
    $('#minhasVazio').hidden = minhas.length > 0;
  }

  /* ==========================================================
     Mapas (Leaflet)
     ========================================================== */

  function iconePin(cor) {
    return L.divIcon({
      className: 'zu-pin',
      html:
        '<svg viewBox="0 0 24 32" width="30" height="40" aria-hidden="true" focusable="false">' +
        `<path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 32 12 32s12-11.6 12-20.3C24 5.2 18.6 0 12 0z" fill="${cor}" stroke="#fff" stroke-width="1.5"/>` +
        '<circle cx="12" cy="11.5" r="4.5" fill="#fff"/></svg>',
      iconSize: [30, 40],
      iconAnchor: [15, 40],
      popupAnchor: [0, -36],
    });
  }

  function criarMapaBase(idElemento, { zoomComRoda = false, zoom = 12 } = {}) {
    if (typeof L === 'undefined') {
      $(`#${idElemento}`).replaceChildren(
        h('p', { class: 'mapa-falha' }, 'Não foi possível carregar o mapa. Verifique sua conexão e recarregue a página.')
      );
      return null;
    }
    const mapa = L.map(idElemento, { scrollWheelZoom: zoomComRoda }).setView(CENTRO_UBATUBA, zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa);
    return { mapa, camada: L.layerGroup().addTo(mapa), marcadores: {} };
  }

  function conteudoPopup(o) {
    const cat = categoriaPorId(o.categoria);
    return h(
      'div',
      { class: 'popup-zu' },
      h('strong', {}, cat.nome),
      h('span', {}, o.bairro || 'Local marcado no mapa'),
      badgeStatus(o.status),
      h('button', { type: 'button', class: 'btn btn-sm btn-primary mt-2', onclick: () => abrirDetalhe(o.id) }, 'Ver detalhes')
    );
  }

  function renderMarcadores(m, itens) {
    if (!m) return;
    m.camada.clearLayers();
    m.marcadores = {};
    itens
      .filter((o) => o.latitude != null && o.longitude != null)
      .forEach((o) => {
        const cat = categoriaPorId(o.categoria);
        const info = STATUS[o.status];
        const marcador = L.marker([o.latitude, o.longitude], {
          icon: iconePin(cat.cor),
          title: `${cat.nome} — ${info ? info.rotulo : o.status}`,
          keyboard: true,
        });
        marcador.bindPopup(() => conteudoPopup(o));
        marcador.addTo(m.camada);
        m.marcadores[o.id] = marcador;
      });
  }

  function garantirMapaHome() {
    if (!mapas.home) {
      mapas.home = criarMapaBase('mapaHome');
      renderMarcadores(mapas.home, estado.ocorrencias);
    }
  }

  function aplicarFiltrosMapa() {
    const { categoria, status } = estado.filtros;
    const itens = estado.ocorrencias.filter(
      (o) => (!categoria || o.categoria === categoria) && (!status || o.status === status)
    );
    renderMarcadores(mapas.completo, itens);
    const comLocal = itens.filter((o) => o.latitude != null && o.longitude != null).length;
    $('#mapaResumo').textContent =
      comLocal === 1 ? '1 ocorrência no mapa.' : `${comLocal} ocorrências no mapa.`;
  }

  function aplicarFocoMapa() {
    const id = estado.focoMapa;
    if (!id || !mapas.completo) return;
    estado.focoMapa = null;

    let marcador = mapas.completo.marcadores[id];
    if (!marcador) {
      $('#filtrosMapa').reset(); // limpa os filtros (o evento "reset" reaplica)
      marcador = mapas.completo.marcadores[id];
    }
    if (marcador) {
      mapas.completo.mapa.setView(marcador.getLatLng(), 16);
      marcador.openPopup();
    }
  }

  function irParaMapaComFoco(id) {
    estado.focoMapa = id;
    if (estado.viewAtual === 'mapa') aplicarFocoMapa();
    else location.hash = '#mapa';
  }

  /* ==========================================================
     Navegação entre telas (hash)
     ========================================================== */

  function viewDaUrl() {
    const nome = location.hash.slice(1);
    return TITULOS[nome] ? nome : 'inicio';
  }

  function mostrarView(nome, { moverFoco = true } = {}) {
    estado.viewAtual = nome;

    $$('[data-view]').forEach((secao) => {
      secao.hidden = secao.dataset.view !== nome;
    });
    $$('[data-view-link]').forEach((link) => {
      if (link.dataset.viewLink === nome) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.title = `${TITULOS[nome]} · Zela Ubatuba`;

    if (nome === 'inicio') {
      garantirMapaHome();
      setTimeout(() => mapas.home && mapas.home.mapa.invalidateSize(), 0);
    }

    if (nome === 'mapa') {
      if (!mapas.completo) mapas.completo = criarMapaBase('mapaCompleto', { zoomComRoda: true });
      aplicarFiltrosMapa();
      setTimeout(() => {
        if (mapas.completo) mapas.completo.mapa.invalidateSize();
        aplicarFocoMapa();
      }, 0);
    }

    if (moverFoco) {
      const titulo = $(`#view-${nome} h1`);
      if (titulo) titulo.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    }
  }

  /* ==========================================================
     Detalhe da ocorrência
     ========================================================== */

  /** A foto não vem na lista (só os metadados): é buscada ao abrir o detalhe. */
  async function carregarFotoDetalhe(o) {
    if (!o.temFoto) return;
    const area = () => $('#detalheFoto');
    try {
      const url = await API.obterFoto(o.id);
      if (detalheAtual !== o.id || !area()) return;
      if (!url) {
        area().textContent = 'Foto indisponível.';
        return;
      }
      area().removeAttribute('role');
      area().replaceChildren(h('img', { class: 'img-fluid rounded', src: url, alt: 'Foto enviada com a ocorrência' }));
    } catch (erro) {
      if (detalheAtual === o.id && area()) area().textContent = 'Não foi possível carregar a foto.';
    }
  }

  function abrirDetalhe(id) {
    const o = estado.ocorrencias.find((x) => x.id === id) || estado.minhas.find((x) => x.id === id);
    if (!o) return;
    detalheAtual = o.id;
    const cat = categoriaPorId(o.categoria);

    const linha = (rotulo, valor) => [
      h('dt', { class: 'col-5 col-sm-4' }, rotulo),
      h('dd', { class: 'col-7 col-sm-8' }, valor),
    ];

    $('#detalheTitulo').textContent = `Protocolo ${o.protocolo}`;
    $('#detalheCorpo').replaceChildren(
      ...[
        o.temFoto && h('div', { id: 'detalheFoto', class: 'mb-3 text-center text-body-secondary', role: 'status' }, 'Carregando foto…'),
        h('p', { class: 'text-break' }, o.descricao),
        h(
          'dl',
          { class: 'row mb-0' },
          linha('Categoria', cat.nome),
          linha('Situação', badgeStatus(o.status)),
          linha('Local', o.bairro || 'Marcado no mapa'),
          linha('Registrada em', formatadorData.format(new Date(o.criadoEm))),
          linha('Atualizada em', formatadorData.format(new Date(o.atualizadoEm || o.criadoEm)))
        ),
      ].filter(Boolean)
    );

    const botaoMapa = $('#btnVerNoMapa');
    const temLocal = o.latitude != null && o.longitude != null;
    botaoMapa.disabled = !temLocal;
    botaoMapa.onclick = () => {
      const elModal = $('#modalDetalhe');
      elModal.addEventListener('hidden.bs.modal', () => irParaMapaComFoco(o.id), { once: true });
      bootstrap.Modal.getOrCreateInstance(elModal).hide();
    };

    bootstrap.Modal.getOrCreateInstance($('#modalDetalhe')).show();
    carregarFotoDetalhe(o);
  }

  /* ==========================================================
     Formulário: localização
     ========================================================== */

  function dentroDeUbatuba(lat, lng) {
    return (
      lat >= LIMITES_UBATUBA.latMin &&
      lat <= LIMITES_UBATUBA.latMax &&
      lng >= LIMITES_UBATUBA.lngMin &&
      lng <= LIMITES_UBATUBA.lngMax
    );
  }

  function mostrarStatusGps(texto, tipo = 'info') {
    const classes = {
      info: 'text-body-secondary',
      ok: 'text-success-emphasis',
      aviso: 'text-warning-emphasis',
      erro: 'text-danger-emphasis',
    };
    const el = $('#gpsStatus');
    el.className = `small mb-2 ${classes[tipo]}`;
    el.textContent = texto;
  }

  /** A API exige coordenadas (GPS ou ponto marcado no mapa); o bairro é opcional. */
  function atualizarValidadeLocal({ mostrarErro = false } = {}) {
    const ok = localizacao.lat !== null;
    $('#localErro').hidden = ok || !mostrarErro;
    return ok;
  }

  function definirLocalizacao(lat, lng, { origem = 'mapa', precisao = null } = {}) {
    localizacao.lat = lat;
    localizacao.lng = lng;
    $('#fLat').value = lat.toFixed(6);
    $('#fLng').value = lng.toFixed(6);

    const picker = mapas.picker;
    if (picker) {
      const posicao = L.latLng(lat, lng);
      if (!localizacao.marcador) {
        localizacao.marcador = L.marker(posicao, {
          icon: iconePin('#0b5c8f'),
          draggable: true,
          keyboard: true,
          title: 'Local da ocorrência (arraste para ajustar)',
        }).addTo(picker.mapa);
        localizacao.marcador.on('dragend', () => {
          const ponto = localizacao.marcador.getLatLng();
          definirLocalizacao(ponto.lat, ponto.lng, { origem: 'mapa' });
        });
      } else {
        localizacao.marcador.setLatLng(posicao);
      }
      if (origem === 'gps') picker.mapa.setView(posicao, 17);
      else picker.mapa.panTo(posicao);
    }

    let texto = `Localização marcada: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (precisao) texto += ` (precisão de cerca de ${Math.round(precisao)} m)`;
    texto += '.';
    if (dentroDeUbatuba(lat, lng)) {
      mostrarStatusGps(texto, 'ok');
    } else {
      mostrarStatusGps(`${texto} Atenção: este ponto parece estar fora de Ubatuba.`, 'aviso');
    }
    atualizarValidadeLocal();
  }

  function capturarLocalizacao() {
    const botao = $('#btnGps');

    if (!('geolocation' in navigator)) {
      mostrarStatusGps('Seu navegador não oferece localização. Toque no mapa ou informe o bairro.', 'erro');
      return;
    }
    if (!window.isSecureContext) {
      mostrarStatusGps(
        'A localização só funciona em conexão segura (HTTPS) ou em localhost. Toque no mapa ou informe o bairro.',
        'erro'
      );
      return;
    }

    botao.disabled = true;
    mostrarStatusGps('Obtendo sua localização…', 'info');

    navigator.geolocation.getCurrentPosition(
      (posicao) => {
        botao.disabled = false;
        const { latitude, longitude, accuracy } = posicao.coords;
        definirLocalizacao(latitude, longitude, { origem: 'gps', precisao: accuracy });
      },
      (erro) => {
        botao.disabled = false;
        const mensagens = {
          1: 'Permissão negada. Libere a localização no navegador ou toque no mapa para marcar o ponto.',
          2: 'Não foi possível determinar sua posição. Toque no mapa para marcar o ponto.',
          3: 'A busca pela localização demorou demais. Tente de novo ou toque no mapa.',
        };
        mostrarStatusGps(mensagens[erro.code] || 'Não foi possível obter a localização.', 'erro');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  function garantirMapaPicker() {
    if (mapas.picker) return;
    mapas.picker = criarMapaBase('mapaPicker', { zoom: 13 });
    if (mapas.picker) {
      const { mapa } = mapas.picker;
      mapa.on('click', (e) => definirLocalizacao(e.latlng.lat, e.latlng.lng, { origem: 'mapa' }));
      // Teclado: com o mapa focado, as setas movem o mapa e Enter marca o ponto no centro.
      mapa.getContainer().addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === mapa.getContainer()) {
          e.preventDefault();
          const centro = mapa.getCenter();
          definirLocalizacao(centro.lat, centro.lng, { origem: 'mapa' });
        }
      });
    }
  }

  /* ==========================================================
     Formulário: foto
     ========================================================== */

  function carregarImagem(arquivo) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(arquivo);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('imagem inválida'));
      };
      img.src = url;
    });
  }

  /** Reduz a foto (lado maior = 1024 px, JPEG) para caber no armazenamento e no envio. */
  async function reduzirImagem(arquivo, maxLado = 1024, qualidade = 0.75) {
    const img = await carregarImagem(arquivo);
    const escala = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
    const largura = Math.round(img.naturalWidth * escala);
    const altura = Math.round(img.naturalHeight * escala);
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    canvas.getContext('2d').drawImage(img, 0, 0, largura, altura);
    return canvas.toDataURL('image/jpeg', qualidade);
  }

  /** Nome do arquivo enviado: o original, seguro e com extensão .jpg (a foto é reduzida para JPEG). */
  function nomeParaJpeg(nome) {
    const base = String(nome || 'foto').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 100) || 'foto';
    return `${base}.jpg`;
  }

  function limparFoto() {
    fotoDataUrl = null;
    fotoNome = null;
    $('#fFoto').setCustomValidity('');
    $('#fFoto').value = '';
    $('#fotoPreview').hidden = true;
    $('#fotoImg').removeAttribute('src');
    $('#fotoMsg').textContent = '';
  }

  async function aoEscolherFoto(evento) {
    const entrada = evento.target;
    const arquivo = entrada.files[0];
    fotoDataUrl = null;
    fotoNome = null;
    $('#fotoPreview').hidden = true;
    $('#fotoMsg').textContent = '';
    if (!arquivo) return;

    if (!arquivo.type.startsWith('image/')) {
      entrada.value = '';
      $('#fotoMsg').textContent = 'Escolha um arquivo de imagem (JPG ou PNG).';
      return;
    }
    if (arquivo.size > LIMITE_FOTO_MB * 1024 * 1024) {
      entrada.value = '';
      $('#fotoMsg').textContent = `A foto passa de ${LIMITE_FOTO_MB} MB. Escolha uma menor.`;
      return;
    }

    entrada.setCustomValidity('Aguarde o processamento da foto.');
    try {
      fotoDataUrl = await reduzirImagem(arquivo);
      fotoNome = nomeParaJpeg(arquivo.name);
      $('#fotoImg').src = fotoDataUrl;
      $('#fotoPreview').hidden = false;
    } catch (e) {
      entrada.value = '';
      $('#fotoMsg').textContent = 'Não foi possível ler essa imagem. Tente uma foto em JPG ou PNG.';
    } finally {
      entrada.setCustomValidity('');
    }
  }

  /* ==========================================================
     Formulário: envio
     ========================================================== */

  function resetarFormulario() {
    const form = $('#formOcorrencia');
    form.reset();
    form.classList.remove('was-validated');
    limparFoto();

    if (localizacao.marcador && mapas.picker) mapas.picker.mapa.removeLayer(localizacao.marcador);
    localizacao.marcador = null;
    localizacao.lat = null;
    localizacao.lng = null;
    $('#fLat').value = '';
    $('#fLng').value = '';
    if (mapas.picker) mapas.picker.mapa.setView(CENTRO_UBATUBA, 13);

    mostrarStatusGps('Localização ainda não marcada.', 'info');
    $('#descContador').textContent = '0/500';
    $('#erroEnvio').hidden = true;
    atualizarValidadeLocal();
  }

  function alternarEnvio(enviando) {
    const botao = $('#btnEnviar');
    botao.disabled = enviando;
    $('.spinner-border', botao).hidden = !enviando;
    $('.rotulo-enviar', botao).textContent = enviando ? 'Enviando…' : 'Enviar ocorrência';
  }

  async function aoEnviarFormulario(evento) {
    evento.preventDefault();
    const form = evento.currentTarget;

    form.classList.add('was-validated');
    const localOk = atualizarValidadeLocal({ mostrarErro: true });
    if (!form.checkValidity() || !localOk) {
      const invalido = form.querySelector(':invalid');
      if (invalido) invalido.focus();
      else $('#btnGps').focus();
      return;
    }

    const dados = {
      categoria: $('#fCategoria').value,
      descricao: $('#fDescricao').value.trim(),
      bairro: $('#fBairro').value.trim(),
      latitude: localizacao.lat,
      longitude: localizacao.lng,
      email: $('#fEmail').value.trim(),
      telefone: $('#fTelefone').value.trim(),
      foto: fotoDataUrl,
      fotoNome,
    };

    $('#erroEnvio').hidden = true;
    alternarEnvio(true);
    try {
      const nova = await API.criarOcorrencia(dados);
      resetarFormulario();
      bootstrap.Modal.getOrCreateInstance($('#modalReportar')).hide();
      mostrarToast(`Ocorrência registrada! Protocolo ${nova.protocolo}.`, {
        link: { href: '#minhas', texto: 'Acompanhar' },
      });
      // A ocorrência já foi enviada; se atualizar as listas falhar, não é erro de envio.
      recarregarDados().catch((erro) => {
        console.error(erro);
        mostrarToast('A ocorrência foi enviada, mas não foi possível atualizar as listas. Recarregue a página.', {
          tipo: 'warning',
        });
      });
    } catch (erro) {
      const caixa = $('#erroEnvio');
      caixa.textContent = erro.message || 'Não foi possível enviar a ocorrência. Tente novamente.';
      caixa.hidden = false;
      caixa.scrollIntoView({ block: 'nearest' });
    } finally {
      alternarEnvio(false);
    }
  }

  /* ==========================================================
     Dados
     ========================================================== */

  function renderMapasAtuais() {
    if (mapas.home) renderMarcadores(mapas.home, estado.ocorrencias);
    if (mapas.completo) aplicarFiltrosMapa();
  }

  async function recarregarDados() {
    const [categorias, ocorrencias, minhas] = await Promise.all([
      API.listarCategorias(),
      API.listarOcorrencias(),
      API.listarMinhasOcorrencias(),
    ]);
    estado.categorias = categorias;
    estado.ocorrencias = ocorrencias;
    estado.minhas = minhas;
    estado.categoriasExtras = new Map();
    [...ocorrencias, ...minhas].forEach((o) => {
      if (o.categoriaInfo && !categorias.some((c) => c.id === o.categoriaInfo.id)) {
        estado.categoriasExtras.set(o.categoriaInfo.id, o.categoriaInfo);
      }
    });
    renderListas();
    renderMapasAtuais();
  }

  /* ==========================================================
     Eventos
     ========================================================== */

  function configurarBusca() {
    const campo = $('#busca');

    campo.addEventListener('input', () => {
      const termo = normalizar(campo.value.trim());
      let visiveis = 0;
      $$('#listaCategorias li').forEach((li) => {
        const combina = !termo || li.dataset.nome.includes(termo);
        li.hidden = !combina;
        if (combina) visiveis += 1;
      });
      $('#buscaStatus').textContent = !termo
        ? ''
        : visiveis
        ? `${visiveis} categoria(s) encontrada(s).`
        : 'Nenhuma categoria encontrada. Tente "Outros".';
    });

    $('#formBusca').addEventListener('submit', (e) => {
      e.preventDefault();
      const visiveis = $$('#listaCategorias li:not([hidden]) .cat-btn');
      if (visiveis.length === 1) visiveis[0].click();
    });
  }

  function configurarModalReportar() {
    const elModal = $('#modalReportar');

    elModal.addEventListener('show.bs.modal', (e) => {
      const categoria = e.relatedTarget && e.relatedTarget.dataset ? e.relatedTarget.dataset.categoria : null;
      if (categoria) $('#fCategoria').value = categoria;
    });

    elModal.addEventListener('shown.bs.modal', () => {
      garantirMapaPicker();
      if (mapas.picker) mapas.picker.mapa.invalidateSize();
      $('#fCategoria').focus();
    });

    $('#formOcorrencia').addEventListener('submit', aoEnviarFormulario);
    $('#btnGps').addEventListener('click', capturarLocalizacao);
    $('#fFoto').addEventListener('change', aoEscolherFoto);
    // Câmera: o atributo "capture" abre direto a câmera do celular. A foto tirada
    // é passada para o campo principal, que faz a validação e a pré-visualização.
    $('#btnTirarFoto').addEventListener('click', () => $('#fFotoCamera').click());
    $('#fFotoCamera').addEventListener('change', (e) => {
      const arquivo = e.target.files[0];
      if (!arquivo) return;
      try {
        const lote = new DataTransfer();
        lote.items.add(arquivo);
        $('#fFoto').files = lote.files;
        $('#fFoto').dispatchEvent(new Event('change', { bubbles: true }));
      } catch (erro) {
        $('#fotoMsg').textContent = 'Não foi possível usar a câmera neste aparelho. Escolha uma imagem da galeria.';
      }
      e.target.value = '';
    });
    $('#btnRemoverFoto').addEventListener('click', () => {
      limparFoto();
      $('#fFoto').focus();
    });
    $('#fDescricao').addEventListener('input', (e) => {
      $('#descContador').textContent = `${e.target.value.length}/500`;
    });
  }

  function configurarFiltrosMapa() {
    $('#filtroCategoria').addEventListener('change', (e) => {
      estado.filtros.categoria = e.target.value;
      aplicarFiltrosMapa();
    });
    $('#filtroStatus').addEventListener('change', (e) => {
      estado.filtros.status = e.target.value;
      aplicarFiltrosMapa();
    });
    $('#filtrosMapa').addEventListener('reset', () => {
      estado.filtros = { categoria: '', status: '' };
      aplicarFiltrosMapa();
    });
  }

  /* ==========================================================
     Inicialização
     ========================================================== */

  function mostrarErroCarga(erro) {
    $('#erroCargaTexto').textContent = (erro && erro.message) || 'Não foi possível carregar os dados.';
    $('#erroCarga').hidden = false;
    $('#recentesVazio').textContent = 'Não foi possível carregar as ocorrências.';
    $('#recentesVazio').hidden = false;
  }

  async function carregarTudo() {
    $('#erroCarga').hidden = true;
    try {
      await recarregarDados();
      renderCategorias();
    } catch (erro) {
      console.error(erro);
      mostrarErroCarga(erro);
    }
  }

  async function iniciar() {
    configurarBusca();
    configurarModalReportar();
    configurarFiltrosMapa();
    atualizarValidadeLocal();
    window.addEventListener('hashchange', () => mostrarView(viewDaUrl()));

    $('#btnTentarNovamente').addEventListener('click', carregarTudo);
    $('#avisoMock').hidden = !API.CONFIG.USE_MOCK;
    await carregarTudo();

    mostrarView(viewDaUrl(), { moverFoco: false });
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
