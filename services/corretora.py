import threading
import time
import json
import logging
import websocket
import requests
from datetime import datetime
from binance.client import Client
from config import BINANCE_API_KEY, BINANCE_API_SECRET
from database.manager import obter_ajustes_manuais, obter_memoria_ia, salvar_memoria_ia, obter_alertas_db, deletar_alerta_db

logger = logging.getLogger(__name__)
binance_client = None

# =========================================================
# 🧠 MEMÓRIA CACHE MULTI-THREAD
# =========================================================
CACHE_MERCADO = {
    'precos': {},
    'status_ob': {},
    'usd_brl': 5.40,
    'ativos_vistos': set(),
    'gatilho_ia': False,
    'ultimo_gatilho_ia': 0,
    'precos_ref_volatilidade': {}
}

# =========================================================
# 📡 MÓDULO WEBSOCKET (RÁDIO SINTONIZADO)
# =========================================================
def on_message(ws, message):
    try:
        dados = json.loads(message)
        if isinstance(dados, list):
            for ticker in dados:
                if 's' in ticker and 'c' in ticker:
                    symbol = ticker['s']
                    price = float(ticker['c'])
                    CACHE_MERCADO['precos'][symbol] = price
                    if symbol == 'USDTBRL':
                        CACHE_MERCADO['usd_brl'] = price
    except: pass

def on_error(ws, error):
    pass 

def on_close(ws, close_status_code, close_msg):
    logger.warning("Conexão perdida com a Binance.")

def run_ws():
    url = "wss://stream.binance.com:9443/ws/!miniTicker@arr"
    while True:
        ws = websocket.WebSocketApp(url, on_message=on_message, on_error=on_error, on_close=on_close)
        ws.run_forever()
        logger.info("Reconectando WebSocket em 3 segundos...")
        time.sleep(3)

def iniciar_websockets():
    logger.info("Iniciando WebSocket Binance...")
    threading.Thread(target=run_ws, daemon=True).start()

# =========================================================
# ⚙️ FUNÇÕES GERAIS DE DADOS
# =========================================================
def get_client():
    global binance_client
    if binance_client is None:
        try:
            temp_client = Client(BINANCE_API_KEY, BINANCE_API_SECRET)
            temp_client.API_URL = 'https://api.binance.com/api'
            
            try:
                res = temp_client.get_server_time()
                temp_client.timestamp_offset = res['serverTime'] - int(time.time() * 1000)
            except:
                temp_client.timestamp_offset = 0

            binance_client = temp_client
        except Exception as e:
            logger.warning("Falha ao ligar à Binance: %s", e)
            return None
    return binance_client

def obter_cotacao_dolar():
    return CACHE_MERCADO['usd_brl']

pegar_cotacao_dolar_atual = obter_cotacao_dolar


def pegar_todos_precos():
    return dict(CACHE_MERCADO['precos'])


def calcular_preco_binance(pair, price_usd):
    c = get_client()
    if not c: return price_usd
    try:
        data_corte = int(datetime(2026, 6, 1).timestamp() * 1000)
        base = pair.replace("USDT", "")

        usd_rate = None
        total_cost_usd = 0.0
        total_qty = 0.0

        for p in [pair, f"{base}BRL"]:
            trades = c.get_my_trades(symbol=p, startTime=data_corte, limit=500)
            for t in trades:
                if t['isBuyer']:
                    qty = float(t['qty'])
                    price = float(t['price'])
                    if p.endswith('BRL'):
                        if usd_rate is None:
                            ticker = c.get_symbol_ticker(symbol="USDTBRL")
                            usd_rate = float(ticker['price'])
                        price_usd_val = price / usd_rate
                    else:
                        price_usd_val = price
                    total_cost_usd += price_usd_val * qty
                    total_qty += qty

        if total_qty > 0:
            return total_cost_usd / total_qty

    except Exception as e:
        logger.debug("Erro ao calcular preço médio de %s: %s", pair, e)

    return price_usd

# --- NOVO: ALGORITMO DE DENSIDADE (K-MEANS 1D SIMPLIFICADO) ---
def encontrar_zona_densa(valores, variacao_maxima=0.015):
    """Encontra o cluster (zona) com mais toques (velas) próximos."""
    if not valores: return 0
    clusters = []
    for v in valores:
        alocado = False
        for c in clusters:
            if abs(c['centro'] - v) / c['centro'] <= variacao_maxima:
                c['valores'].append(v)
                c['centro'] = sum(c['valores']) / len(c['valores'])
                alocado = True
                break
        if not alocado:
            clusters.append({'centro': v, 'valores': [v]})
            
    maior_cluster = max(clusters, key=lambda x: len(x['valores']))
    return maior_cluster['centro']
# --------------------------------------------------------------

def calcular_indicadores_tecnicos(symbol, timeframe='1d'):
    c = get_client()
    if not c: return {"rsi": None, "tendencia": "Sem Internet", "suporte": 0, "resistencia": 0, "volume": "N/A", "order_book": "N/A"}
    try:
        mapa_tf = {
            '1m': (Client.KLINE_INTERVAL_1MINUTE, "1 day ago UTC"),
            '15m': (Client.KLINE_INTERVAL_15MINUTE, "3 days ago UTC"),
            '1h': (Client.KLINE_INTERVAL_1HOUR, "10 days ago UTC"),
            '4h': (Client.KLINE_INTERVAL_4HOUR, "30 days ago UTC"),
            '1d': (Client.KLINE_INTERVAL_1DAY, "60 days ago UTC")
        }
        intervalo, janela = mapa_tf.get(timeframe, (Client.KLINE_INTERVAL_1DAY, "60 days ago UTC"))
        
        klines = c.get_historical_klines(f"{symbol}USDT", intervalo, janela)
        if len(klines) < 22: return {"rsi": None, "tendencia": "Dados insuficientes", "suporte": 0, "resistencia": 0, "volume": "N/A", "order_book": "N/A"}

        closes = [float(k[4]) for k in klines]
        
        volumes_usd = [float(k[7]) for k in klines] 
        vol_14d = volumes_usd[-14:]
        media_volume = sum(vol_14d) / len(vol_14d) if len(vol_14d) > 0 else 0
        volume_atual = volumes_usd[-1]

        if volume_atual > (media_volume * 1.5): perfil_volume = "ALTO"
        elif volume_atual < (media_volume * 0.7): perfil_volume = "BAIXO"
        else: perfil_volume = "DENTRO DA MÉDIA"
        
        order_book_status = CACHE_MERCADO['status_ob'].get(symbol, "Equilibrado")

        # --- ZONAS DE SUPORTE E RESISTÊNCIA POR DENSIDADE ---
        todos_lows = [float(k[3]) for k in klines]
        todos_highs = [float(k[2]) for k in klines]
        
        meio_grafico = (max(todos_highs) + min(todos_lows)) / 2
        
        lows_inferiores = [l for l in todos_lows if l < meio_grafico]
        highs_superiores = [h for h in todos_highs if h > meio_grafico]

        suporte = encontrar_zona_densa(lows_inferiores) if lows_inferiores else min(todos_lows)
        resistencia = encontrar_zona_densa(highs_superiores) if highs_superiores else max(todos_highs)
        # ----------------------------------------------------

        period = 14
        gains = [closes[i] - closes[i-1] if closes[i] - closes[i-1] > 0 else 0 for i in range(1, len(closes))]
        losses = [abs(closes[i] - closes[i-1]) if closes[i] - closes[i-1] < 0 else 0 for i in range(1, len(closes))]
        avg_gain = sum(gains[-period:]) / period if period > 0 else 0
        avg_loss = sum(losses[-period:]) / period if period > 0 else 0
        rsi = 100 if avg_loss == 0 else round(100 - (100 / (1 + (avg_gain / avg_loss))), 2)

        def calc_ema(data, p):
            k = 2 / (p + 1)
            ema = sum(data[:p]) / p
            for price in data[p:]: ema = (price - ema) * k + ema
            return ema

        ema9 = calc_ema(closes, 9)
        ema21 = calc_ema(closes, 21)
        preco_atual = closes[-1]

        if ema9 > ema21 and preco_atual > ema9: tendencia = "Alta Forte"
        elif ema9 < ema21 and preco_atual < ema9: tendencia = "Queda Forte"
        elif ema9 > ema21 and preco_atual < ema9: tendencia = "Correção"
        else: tendencia = "Lateralização"

        return {"rsi": rsi, "tendencia": tendencia, "suporte": suporte, "resistencia": resistencia, "volume": perfil_volume, "order_book": order_book_status}
    except: return {"rsi": None, "tendencia": "Desconhecido", "suporte": 0, "resistencia": 0, "volume": "N/A", "order_book": "N/A"}

# =========================================================
# 📊 INDICADORES TÉCNICOS AVANÇADOS
# =========================================================

def _rsi_wilder(closes, period=14):
    """RSI com平滑 (Wilder) — padrão usado por traders."""
    if len(closes) < period + 1:
        return None
    diffs = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    avg_gain = sum(d for d in diffs[:period] if d > 0) / period
    avg_loss = sum(abs(d) for d in diffs[:period] if d < 0) / period
    for d in diffs[period:]:
        avg_gain = (avg_gain * (period - 1) + max(d, 0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-d, 0)) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def _macd(closes, fast=12, slow=26, signal=9):
    """MACD, linha de sinal e histograma."""
    if len(closes) < slow + signal:
        return None, None, None
    def ema(data, p):
        k = 2 / (p + 1)
        out = [sum(data[:p]) / p]
        for v in data[p:]:
            out.append((v - out[-1]) * k + out[-1])
        return out
    ema_fast = ema(closes, fast)
    ema_slow = ema(closes, slow)
    macd_line = [f - s for f, s in zip(ema_fast, ema_slow)]
    signal_line = ema(macd_line, signal)
    histogram = [m - s for m, s in zip(macd_line, signal_line)]
    return macd_line[-1], signal_line[-1], histogram[-1]


def _atr(klines, period=14):
    """Average True Range — volatilidade."""
    if len(klines) < period + 1:
        return None
    trs = []
    for i in range(1, len(klines)):
        high = float(klines[i][2])
        low = float(klines[i][3])
        prev_close = float(klines[i - 1][4])
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        trs.append(tr)
    return sum(trs[-period:]) / period


def _bbands(closes, period=20, std_dev=2):
    """Bollinger Bands — sobrecomprado/sobrevendido."""
    if len(closes) < period:
        return None, None, None
    recent = closes[-period:]
    ma = sum(recent) / period
    variance = sum((x - ma) ** 2 for x in recent) / period
    std = variance ** 0.5
    return ma + std_dev * std, ma, ma - std_dev * std


def calcular_indicadores_completos(symbol, timeframe='1d'):
    """Retorna um dicionário com todos os indicadores de uma vez."""
    c = get_client()
    if not c:
        return {"erro": "Sem conexão"}

    mapa_tf = {
        '1m': (Client.KLINE_INTERVAL_1MINUTE, "1 day ago UTC"),
        '15m': (Client.KLINE_INTERVAL_15MINUTE, "3 days ago UTC"),
        '1h': (Client.KLINE_INTERVAL_1HOUR, "10 days ago UTC"),
        '4h': (Client.KLINE_INTERVAL_4HOUR, "30 days ago UTC"),
        '1d': (Client.KLINE_INTERVAL_1DAY, "60 days ago UTC"),
    }
    intervalo, janela = mapa_tf.get(timeframe, (Client.KLINE_INTERVAL_1DAY, "60 days ago UTC"))

    try:
        klines = c.get_historical_klines(f"{symbol}USDT", intervalo, janela)
    except Exception:
        return {"erro": f"Falha ao obter dados de {symbol}"}

    if len(klines) < 50:
        return {"erro": "Dados insuficientes"}

    closes = [float(k[4]) for k in klines]
    highs = [float(k[2]) for k in klines]
    lows = [float(k[3]) for k in klines]
    volumes = [float(k[5]) for k in klines]
    preco = closes[-1]

    rsi = _rsi_wilder(closes)
    macd_line, signal_line, histogram = _macd(closes)
    atr_val = _atr(klines)
    bb_upper, bb_mid, bb_lower = _bbands(closes)

    # EMA 9, 21, 200
    def _ema(data, p):
        k = 2 / (p + 1)
        out = [sum(data[:p]) / p]
        for v in data[p:]:
            out.append((v - out[-1]) * k + out[-1])
        return out
    ema9 = _ema(closes, 9)[-1] if len(closes) >= 9 else None
    ema21 = _ema(closes, 21)[-1] if len(closes) >= 21 else None
    ema200 = _ema(closes, 200)[-1] if len(closes) >= 200 else None

    # Volume relativo
    vol_medio = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else 0
    vol_rel = volumes[-1] / vol_medio if vol_medio > 0 else 1.0

    # Suporte/resistência por densidade (mesmo algoritmo, mais simples)
    meio = (max(highs[-30:]) + min(lows[-30:])) / 2 if len(highs) >= 30 else preco
    lows_inf = [l for l in lows[-30:] if l < meio]
    highs_sup = [h for h in highs[-30:] if h > meio]
    suporte = sum(lows_inf) / len(lows_inf) if lows_inf else min(lows[-30:])
    resistencia = sum(highs_sup) / len(highs_sup) if highs_sup else max(highs[-30:])

    # Tendência
    if ema9 and ema21:
        if ema9 > ema21 and preco > ema9:
            tendencia = "alta"
        elif ema9 < ema21 and preco < ema9:
            tendencia = "queda"
        elif ema9 > ema21 and preco < ema9:
            tendencia = "correcao"
        else:
            tendencia = "lateral"
    else:
        tendencia = "indefinida"

    return {
        "preco": preco,
        "rsi": rsi,
        "macd": macd_line,
        "macd_sinal": signal_line,
        "macd_hist": histogram,
        "atr": atr_val,
        "atr_pct": (atr_val / preco * 100) if atr_val and preco else None,
        "bb_upper": bb_upper,
        "bb_mid": bb_mid,
        "bb_lower": bb_lower,
        "bb_width": ((bb_upper - bb_lower) / bb_mid * 100) if bb_upper and bb_lower and bb_mid else None,
        "ema9": ema9,
        "ema21": ema21,
        "ema200": ema200,
        "suporte": suporte,
        "resistencia": resistencia,
        "volume_rel": round(vol_rel, 2),
        "tendencia": tendencia,
        "timeframe": timeframe,
    }


# =========================================================
# Modifique a função obter_dados_portfolio no final do arquivo
def obter_dados_portfolio():
    c = get_client()
    if not c: return {"ativos": [], "gatilho_ia": False}
    
    try: account = c.get_account()
    except: return {"ativos": [], "gatilho_ia": False}

    ajustes = obter_ajustes_manuais() 
    memoria_ia = obter_memoria_ia()
    my_assets = []
    saldos = {}
    
    gatilho_global_ia = CACHE_MERCADO['gatilho_ia']
    CACHE_MERCADO['gatilho_ia'] = False 

    # Consolida saldos (Spot + Funding)
    for balance_type in [account['balances'], c.funding_wallet()]:
        for asset in balance_type:
            qty = float(asset['free']) + float(asset['locked'])
            if qty > 0.00001:
                clean_symbol = asset['asset'][2:] if asset['asset'].startswith('LD') else asset['asset']
                if clean_symbol not in saldos: saldos[clean_symbol] = {'total': 0}
                saldos[clean_symbol]['total'] += qty

    for symbol, dados_saldo in saldos.items():
        total_qty = dados_saldo['total']
        
        if symbol == 'USDT':
            my_assets.append({
                "simbolo": f"USDT (Caixa)", 
                "quantidade": total_qty, 
                "preco_medio_usd": 1.0, 
                "preco_atual_usd": 1.0,
                "valor_total_usd": total_qty,
                "pnl_percent": 0.0, "pnl_usd": 0.0
            })
            continue 
            
        pair = f"{symbol}USDT"
        CACHE_MERCADO['ativos_vistos'].add(symbol)
        price_usd = CACHE_MERCADO['precos'].get(pair, 0.0)
        
        if price_usd == 0.0:
            try: price_usd = float(c.get_symbol_ticker(symbol=pair)['price'])
            except: continue

        ajuste = ajustes.get(symbol, {})
        total_qty_ajuste = ajuste.get("quantidade") if ajuste.get("quantidade") is not None else total_qty
        preco_medio_usd = ajuste.get("preco_usd") if ajuste.get("preco_usd") is not None else calcular_preco_binance(pair, price_usd)

        my_assets.append({
            "simbolo": symbol, "quantidade": total_qty_ajuste,
            "preco_medio_usd": preco_medio_usd,
            "preco_atual_usd": price_usd,
            "valor_total_usd": total_qty_ajuste * price_usd,
            "pnl_percent": ((price_usd / preco_medio_usd) - 1) * 100 if preco_medio_usd > 0 else 0,
            "pnl_usd": (price_usd - preco_medio_usd) * total_qty_ajuste
        })
        
    return {"ativos": my_assets, "gatilho_ia": gatilho_global_ia}