/**
 * mock-data.js — Dados FICTÍCIOS no mesmo formato que a API real devolve
 * (campos lng/str/dbl/dtm). Só são usados no modo demonstração
 * (CONFIG.USE_MOCK = true em api.js, ou abrindo a página com ?mock=1).
 *
 * Bairros e coordenadas são apenas ilustrativos. Telefones e e-mails são
 * inventados.
 */
(() => {
  'use strict';

  const d2 = (n) => String(n).padStart(2, '0');

  /** LocalDateTime do Java (sem fuso), a "dias" atrás. */
  const diasAtras = (dias) => {
    const d = new Date(Date.now() - dias * 86400000);
    return `${d.getFullYear()}-${d2(d.getMonth() + 1)}-${d2(d.getDate())}T${d2(d.getHours())}:${d2(d.getMinutes())}:${d2(d.getSeconds())}`;
  };

  // Mesmas categorias que o back-end cadastra na primeira execução (DataInitializer).
  const categorias = [
    { lngId: 1, strNome: 'Buraco em Logradouro', strDescricao: 'Buracos, crateras ou afundamentos no asfalto ou calçamento de vias públicas.', dtmCriacao: diasAtras(60) },
    { lngId: 2, strNome: 'Iluminação Pública', strDescricao: 'Lâmpadas queimadas, piscando, acesas durante o dia ou postes sem iluminação.', dtmCriacao: diasAtras(60) },
    { lngId: 3, strNome: 'Coleta de Lixo e Entulho', strDescricao: 'Acúmulo irregular de lixo domiciliar, entulho de obras ou descarte clandestino em vias públicas.', dtmCriacao: diasAtras(60) },
    { lngId: 4, strNome: 'Poda de Árvore e Jardinagem', strDescricao: 'Árvores com risco de queda, galhos obstruindo fiação/sinalização ou mato alto em praças e canteiros.', dtmCriacao: diasAtras(60) },
    { lngId: 5, strNome: 'Sinalização Viária', strDescricao: 'Placas de trânsito danificadas, semáforos apagados ou faixas de pedestres apagadas.', dtmCriacao: diasAtras(60) },
  ];

  const cat = (id) => categorias.find((c) => c.lngId === id);

  const sol = (lngId, categoriaId, strStatus, strDescricao, strEnderecoReferencia, lat, lng, criada, atualizada) => ({
    lngId,
    strTelefoneUsuario: '(00) 00000-0000',
    strEmailUsuario: `exemplo${lngId}@exemplo.com`,
    dblLatitude: lat,
    dblLongitude: lng,
    strEnderecoReferencia,
    dtmSolicitacao: diasAtras(criada),
    categoria: cat(categoriaId),
    imagem: null, // sem foto nos exemplos; as criadas na demonstração têm foto
    strDescricao,
    strStatus,
    dtmAtualizacao: diasAtras(atualizada),
  });

  window.ZELA_MOCK = {
    categorias,
    solicitacoes: [
      sol(1, 1, 'EM_ANDAMENTO', 'Buraco grande na faixa da direita, perto do cruzamento. Já causou dano em carros.', 'Centro', -23.4365, -45.0842, 6, 3),
      sol(2, 2, 'EM_ANALISE', 'Poste com a lâmpada queimada há mais de uma semana. A rua fica escura à noite.', 'Itaguá', -23.431, -45.0705, 2, 2),
      sol(3, 3, 'CONCLUIDA', 'Acúmulo de lixo e entulho na esquina, atraindo animais.', 'Praia Grande', -23.4585, -45.059, 9, 5),
      sol(4, 1, 'ABERTA', 'Asfalto afundado em frente ao mercado, com risco para motos.', 'Perequê-Açu', -23.405, -45.101, 1, 1),
      sol(5, 3, 'EM_ANDAMENTO', 'Caçamba transbordando e sacos de lixo espalhados na calçada.', 'Toninhas', -23.485, -45.057, 4, 2),
      sol(6, 2, 'CONCLUIDA', 'Três postes seguidos apagados na avenida principal do bairro.', 'Estufa', -23.445, -45.095, 12, 7),
      sol(7, 4, 'EM_ANDAMENTO', 'Galhos de árvore encostando na fiação elétrica após as chuvas.', 'Lázaro', -23.498, -45.125, 5, 4),
      sol(8, 5, 'EM_ANALISE', 'Semáforo apagado no cruzamento principal, trânsito confuso no horário de pico.', 'Sumaré', -23.427, -45.078, 3, 3),
      sol(9, 2, 'ABERTA', 'Luminária piscando e desligando sozinha perto da escola.', 'Ipiranguinha', -23.42, -45.059, 0, 0),
      sol(10, 5, 'CANCELADA', 'Pedido de placa de pare em duplicidade: já existe uma no local.', 'Centro', -23.433, -45.083, 15, 10),
    ],
  };
})();
