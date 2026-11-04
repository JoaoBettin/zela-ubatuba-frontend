# Zela Ubatuba — Front-end do cidadão

Interface web do **Zela Ubatuba**, plataforma de zeladoria urbana para a Prefeitura de Ubatuba (Projeto Integrador II — UNIVESP). O cidadão registra um problema urbano (buraco, iluminação, lixo etc.) com foto e localização e acompanha a situação da ocorrência.

Este front-end consome a API REST do repositório [afnarcizo/Zeladoria](https://github.com/afnarcizo/Zeladoria) (Java 21, Spring Boot 3.3, JPA, MySQL).

## Tecnologias

- HTML, CSS e JavaScript puro
- [Bootstrap 5](https://getbootstrap.com/) e [Bootstrap Icons](https://icons.getbootstrap.com/)
- [Leaflet](https://leafletjs.com/) com mapas do [OpenStreetMap](https://www.openstreetmap.org/) (sem chave de API)

Bootstrap, ícones e Leaflet vêm de CDN, então é preciso estar conectado à internet.

## Como rodar

1. **Back-end:** suba a API conforme o repositório do back-end (ajuste as credenciais do MySQL em `application.properties`). Ela deve responder em `http://localhost:8080`.
2. **Front-end:** a geolocalização (GPS) do navegador só funciona em `localhost` ou HTTPS, então **não abra o `index.html` com duplo clique**. Use:
   - a extensão *Live Server* do VS Code (*Go Live*), ou
   - `python -m http.server 8000` na pasta do projeto e acesse `http://localhost:8000`.
3. Se a API estiver em outro endereço, ajuste `CONFIG.BASE_URL` em `js/api.js`.

### Modo demonstração (sem back-end)

Abra a página com `?mock=1` (por exemplo `http://localhost:8000/?mock=1`) para usar dados fictícios no **mesmo formato da API real**. As ocorrências criadas ficam só no navegador. Um aviso aparece no rodapé. Para usar sempre esse modo, troque `USE_MOCK` para `true` em `api.js`.

## Estrutura

```
zela-ubatuba-frontend/
├── index.html          Site do cidadão (Início, Mapa, Minhas ocorrências)
├── admin/
│   ├── index.html      Tela de administração  (endereço: /admin/)
│   ├── admin.js
│   └── admin.css
├── css/style.css       Estilos; as cores ficam nas variáveis :root no topo
├── js/
│   ├── api.js          Acesso à API: chamadas, tradução de campos, modo demonstração
│   ├── script.js       Interface do site: navegação, mapas, formulário, GPS, foto
│   └── mock-data.js    Dados fictícios (formato da API) para o modo demonstração
├── img/logo-zela.svg   Logo provisória
├── .gitignore
└── README.md
```

## Integração com a API

Tudo que fala com o servidor está em `api.js`; a interface só usa `window.ZelaAPI`.

| Uso | Endpoint |
|---|---|
| Categorias | `GET /api/v1/categorias` |
| Lista (todas as páginas, até 1000) | `GET /api/v1/solicitacoes?page=&size=&sort=` |
| Detalhe / "Minhas ocorrências" | `GET /api/v1/solicitacoes/{lngId}` |
| Foto (carregada ao abrir o detalhe) | `GET /api/v1/solicitacoes/{lngId}/imagem` |
| Registrar | `POST /api/v1/solicitacoes` (JSON, foto em Base64 sem prefixo `data:`) |

`api.js` traduz os campos da API (`lngId`, `strDescricao`, `dblLatitude`, `strEnderecoReferencia`, `strStatus`…) para nomes simples usados na interface (`id`, `descricao`, `latitude`, `bairro`, `status`…). A tabela completa está no comentário no topo do arquivo.

### Regras do formulário (iguais às do back-end)

- Obrigatórios: categoria, descrição, **foto**, **localização (coordenadas)**, **e-mail** e **telefone**.
- Localização: GPS ou ponto marcado no mapa (toque/clique; com o teclado, setas + Enter). O bairro/ponto de referência é opcional.
- A foto é reduzida para no máximo 1024 px (JPEG) antes do envio.

### Situações (status)

`Aberta`, `Em análise`, `Em andamento`, `Concluída` e `Cancelada` — os cinco valores do enum `StatusSolicitacao` do back-end.

## Pontos de atenção para o back-end

1. **CORS.** O back-end não tem configuração de CORS, então o navegador bloqueia as chamadas feitas de `localhost:5500` ou `:8000`. Sugestão:

   ```java
   @Configuration
   public class CorsConfig implements WebMvcConfigurer {
       @Override
       public void addCorsMappings(CorsRegistry registry) {
           registry.addMapping("/api/**")
                   .allowedOrigins("http://localhost:5500", "http://127.0.0.1:5500", "http://localhost:8000")
                   .allowedMethods("GET", "POST", "PATCH", "PUT", "DELETE")
                   .allowedHeaders("*");
       }
   }
   ```

2. **Fuso horário.** As datas chegam sem fuso (`LocalDateTime`, ex.: `2026-10-28T19:05:00`) e o navegador as lê como horário local. Se o servidor rodar em UTC (comum em nuvem), as horas aparecerão adiantadas em 3 h. Configure o servidor com `-Duser.timezone=America/Sao_Paulo` (ou devolva datas com fuso).
3. **Privacidade (LGPD).** A listagem pública devolve `strTelefoneUsuario` e `strEmailUsuario` de cada solicitação. O front descarta esses campos, mas qualquer pessoa que chame a API os vê. O ideal é não incluí-los na resposta pública.
4. **Sem autenticação.** Qualquer um pode alterar status, excluir solicitações e editar categorias. O painel do administrador vai precisar de login e de rotas protegidas.
5. **Protocolo.** A API não tem número de protocolo; o front mostra `ZU-ANO-000012`, gerado a partir do id. Se o back-end passar a ter um protocolo próprio, basta trocar em `adaptarSolicitacao`.

## Decisões de projeto e limitações

- **Sem login por enquanto.** "Minhas ocorrências" lista o que foi registrado **neste aparelho** (ids guardados no `localStorage`). Quando houver autenticação, trocar por um endpoint do usuário.
- A lista carrega até 1000 ocorrências (10 páginas de 100); acima disso, falta paginar/filtrar por região.
- Os ícones e cores das categorias são escolhidos pelo nome (`api.js`, lista `VISUAIS`); categorias novas usam um ícone genérico.
- **Acessibilidade:** HTML semântico, rótulos nos campos, foco visível, navegação por teclado (inclusive marcar o ponto no mapa), avisos com `aria-live` e respeito a `prefers-reduced-motion`. A verificação automática com axe-core não encontrou violações nas telas Início, Mapa, Minhas ocorrências, formulário e detalhe. Falta uma revisão manual com leitor de tela.

## Testes realizados

- 63 verificações automáticas da tela de administração (fluxo completo, axe-core, celular, modo demonstração, API fora do ar) e 47 em navegador (Chromium, desktop e celular) cobrindo: carga de categorias e ocorrências, validação do formulário, GPS, foto, envio e conteúdo do JSON enviado, detalhe com foto sob demanda, mapa e filtros, "Minhas ocorrências" após recarregar, modo demonstração, mensagem de erro quando a API está inacessível ou sem CORS.
- Esses testes usaram um **servidor de teste escrito a partir dos DTOs do back-end, e não a API Spring em execução**. Falta validar a integração contra a API real (principalmente CORS, formato das datas e erros de validação).

## Pendências sugeridas

- Testes automatizados no repositório (Jest para `api.js`; Playwright ou Cypress para os fluxos principais)
- Autenticação e "Minhas ocorrências" por usuário
- Logo e identidade visual definitivas
- Revisão de acessibilidade com leitor de tela
