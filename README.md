# CryptoFolio

Dashboard de trading quantitativo com análise por IA (Google Gemini) e dados ao vivo da Binance.

## Funcionalidades

- **Carteira ao vivo**: Conecta na sua conta Binance via API (Spot + Funding)
- **Preços em tempo real**: WebSocket Binance para cotações de todos os pares USDT
- **Gráfico de velas**: 5 timeframes (1m, 15m, 1h, 4h, 1d) com indicadores técnicos
- **Indicadores**: RSI, MACD, ATR, Bandas de Bollinger, EMA 9/21/200, Suporte/Resistência
- **Análise por IA (Gemini)**: Analisa seu portfólio, varre mercado e recomenda alocações de caixa
- **Alertas de preço**: Crie alertas com notificações no navegador e som
- **Tabela de posições**: Quantidade, preço médio, P&L por ativo (com tooltip de trades)
- **Termômetro de P&L**: Barras de contribuição de cada ativo no resultado
- **Modo sentinela**: IA dispara análise automaticamente ao detectar baleias no livro de ordens
- **Modo privacidade**: Oculta valores monetários com um clique

## Requisitos

- Python 3.10+
- Conta na Binance com chaves de API (leitura)
- Chave de API do Google Gemini

## Instalação

```bash
pip install -r requirements.txt
```

## Configuração

Copie `.env.example` para `.env` e preencha as chaves:

```env
BINANCE_API_KEY=suas_chave_aqui
BINANCE_API_SECRET=seu_secret_aqui
GEMINI_API_KEY=sua_chave_aqui
```

## Uso

```bash
python run.py
```

Acesse em `http://127.0.0.1:5001`.

## Estrutura

```
├── run.py                 # Entrada do app
├── config.py              # Configurações (variáveis de ambiente)
├── services/
│   ├── corretora.py       # Cliente Binance, WebSocket, indicadores
│   └── analista_ia.py     # Motor de análise IA (Gemini)
├── src/web/
│   ├── app_factory.py     # Criação do Flask + WebSocket
│   └── routes.py          # Rotas da API REST
├── database/
│   └── manager.py         # Persistência SQLite
├── templates/
│   └── index.html         # SPA frontend
└── static/
    ├── css/style.css
    └── js/
        ├── main.js        # Lógica principal
        ├── grafico.js     # Gráfico de velas (Lightweight Charts)
        └── utils.js       # Utilitários (toast, formatação, privacidade)
```

## API REST

| Rota | Descrição |
|---|---|
| `GET /api/portfolio` | Portfólio completo da Binance |
| `GET /api/analise_ia/<timeframe>` | Análise IA do portfólio |
| `GET /api/radar/<timeframe>` | Varredura de mercado pela IA |
| `GET /api/alocacao_ia/<timeframe>` | Recomendação de alocação de caixa |
| `GET /api/indicadores/<simbolo>/<timeframe>` | Indicadores técnicos de um ativo |
| `GET /api/historico_ativo/<simbolo>/<timeframe>` | Dados OHLC para gráfico |
| `GET /api/alertas` | Listar alertas de preço |
| `POST /api/alertas` | Criar alerta de preço |
| `DELETE /api/alertas/<id>` | Excluir alerta |
| `GET /api/patrimonio_historico` | Histórico de patrimônio |
| `GET /api/trades/<simbolo>` | Histórico de trades do ativo |
| `GET /api/ordens_abertas` | Ordens abertas na Binance |

## Segurança

- Chaves de API lidas do `.env` (nunca hardcoded)
- `.env` está no `.gitignore` — **nunca commite suas chaves**
- Aplicação só faz leitura (não executa trades automaticamente)
