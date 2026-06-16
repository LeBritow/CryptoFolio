import json
import os
import time
import logging
from datetime import datetime
from flask import Blueprint, jsonify, request
from services.corretora import obter_cotacao_dolar, pegar_todos_precos, get_client, calcular_preco_binance
from services.analista_ia import (
    gerar_relatorio,
    get_status_ia,
    processar_radar_mercado,
    processar_alocacao,
    calcular_indicadores_completos,
)
from database.manager import salvar_historico_patrimonio, obter_historico_patrimonio, criar_alerta_db, obter_alertas_db, deletar_alerta_db

logger = logging.getLogger(__name__)
api = Blueprint("api", __name__)

_CACHE_PRECO_MEDIO = {}
_CACHE_PRECO_MEDIO_TTL = 0


def _live_caixa_brl(cotacao_dolar):
    """Retorna caixa em BRL a partir de dados ao vivo da Binance."""
    client = get_client()
    if not client:
        return 0
    try:
        account = client.get_account()
        total_brl = 0.0
        wallets = [account["balances"]]
        for extra in ("funding_wallet",):
            try:
                ew = getattr(client, extra, None)
                if ew:
                    wallets.append(ew())
            except:
                pass
        for wallet in wallets:
            for saldo in wallet:
                qtd = float(saldo.get("free", 0)) + float(saldo.get("locked", 0))
                simbolo = saldo.get("asset")
                if qtd <= 0:
                    continue
                if simbolo in ("USDT", "BRL"):
                    total_brl += qtd * cotacao_dolar if simbolo == "USDT" else qtd
        return total_brl
    except:
        return 0


def _preco_medio_binance(symbol_pair):
    global _CACHE_PRECO_MEDIO_TTL
    now = time.time()
    if now > _CACHE_PRECO_MEDIO_TTL:
        _CACHE_PRECO_MEDIO.clear()
        _CACHE_PRECO_MEDIO_TTL = now + 60
    if symbol_pair not in _CACHE_PRECO_MEDIO:
        # try Binance trade history; fallback to current price later
        _CACHE_PRECO_MEDIO[symbol_pair] = calcular_preco_binance(symbol_pair, None)
    return _CACHE_PRECO_MEDIO[symbol_pair]


_PRECOS_MEDIOS_FILE = "precos_medios.json"

def _carregar_precos_medios():
    if not os.path.exists(_PRECOS_MEDIOS_FILE):
        return {}
    try:
        with open(_PRECOS_MEDIOS_FILE) as f:
            return json.load(f)
    except:
        return {}

def _salvar_precos_medios(dados):
    try:
        with open(_PRECOS_MEDIOS_FILE, "w") as f:
            json.dump(dados, f, indent=2)
    except:
        pass

# ── helpers ──────────────────────────────────────────

# ── páginas ──────────────────────────────────────────

@api.route("/")
def index():
    from flask import render_template
    return render_template("index.html")


# ── portfolio ────────────────────────────────────────

def _preco_vivo(symbol_pair):
    """Tenta WebSocket cache primeiro, depois REST."""
    from services.corretora import CACHE_MERCADO
    p = CACHE_MERCADO["precos"].get(symbol_pair)
    if p and p > 0:
        return p
    try:
        import requests
        r = requests.get(
            f"https://api.binance.com/api/v3/ticker/price?symbol={symbol_pair}",
            timeout=5,
        )
        return float(r.json()["price"])
    except Exception:
        return 0.0


@api.route("/api/portfolio")
def portfolio():
    cotacao_dolar = obter_cotacao_dolar()
    if not cotacao_dolar or cotacao_dolar < 1:
        try:
            import requests
            r = requests.get(
                "https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL",
                timeout=5,
            )
            cotacao_dolar = float(r.json()["price"])
        except Exception:
            cotacao_dolar = 5.40

    client = get_client()
    carteira = None

    if not client:
        return jsonify({"ativos": [], "total": 0, "total_pnl": 0, "dolar": cotacao_dolar, "modo": "SEM_DADOS"})

    try:
        account = client.get_account()
        moedas = {}
        caixa_usd = 0.0
        wallets = [account["balances"]]
        for extra in ("funding_wallet",):
            try:
                ew = getattr(client, extra, None)
                if ew:
                    wallets.append(ew())
            except:
                pass
        for wallet in wallets:
            for saldo in wallet:
                qtd = float(saldo.get("free", 0)) + float(saldo.get("locked", 0))
                simbolo = saldo.get("asset") or saldo.get("asset")
                if qtd <= 0:
                    continue
                if simbolo in ("USDT", "BRL"):
                    caixa_usd += qtd / cotacao_dolar if simbolo == "BRL" else qtd
                else:
                    par_usdt = simbolo + "USDT"
                    preco_prod = _preco_vivo(par_usdt)
                    if preco_prod > 0 and (qtd * preco_prod) > 1:
                        moedas[simbolo] = moedas.get(simbolo, 0) + qtd
        carteira = {"caixa_usd": caixa_usd, "moedas": moedas}
        logger.info("Portfolio ao vivo carregado - caixa: %.2f USDT, ativos: %d", caixa_usd, len(moedas))
    except Exception as e:
        logger.warning("Falha ao buscar dados ao vivo: %s", e)
        return jsonify({"ativos": [], "total": 0, "total_pnl": 0, "dolar": cotacao_dolar, "modo": "SEM_DADOS"})

    ativos = []
    caixa_brl = carteira["caixa_usd"] * cotacao_dolar
    total_brl = caixa_brl
    total_pnl_brl = 0.0
    precos_medios = _carregar_precos_medios()
    precos_alterados = False

    ativos.append({
        "simbolo": "Caixa (BRL)",
        "quantidade": carteira["caixa_usd"],
        "preco_atual_usd": 1.0,
        "preco_atual_brl": cotacao_dolar,
        "valor_total_brl": caixa_brl,
        "valor_total_usd": carteira["caixa_usd"],
        "preco_medio_usd": 1.0,
        "preco_medio_brl": cotacao_dolar,
        "pnl_percent": 0.0,
        "pnl_usd": 0.0,
        "pnl_reais": 0.0,
    })

    for symb, qtd in carteira["moedas"].items():
        if qtd <= 0:
            continue
        preco_usd = _preco_vivo(symb + "USDT")
        if preco_usd == 0:
            continue
        preco_brl = preco_usd * cotacao_dolar

        pm_brl = precos_medios.get(symb)
        if pm_brl is None or pm_brl <= 0:
            pm_usd = _preco_medio_binance(symb + "USDT")
            if pm_usd and pm_usd > 0:
                pm_brl = pm_usd * cotacao_dolar
        if pm_brl is None or pm_brl <= 0:
            pm_brl = preco_brl

        rounded = round(pm_brl, 2)
        if precos_medios.get(symb) != rounded:
            precos_medios[symb] = rounded
            precos_alterados = True

        preco_medio_usd = pm_brl / cotacao_dolar if cotacao_dolar > 0 else 0

        valor_usd = qtd * preco_usd
        valor_brl = valor_usd * cotacao_dolar
        pnl_percent = ((preco_brl - pm_brl) / pm_brl) * 100 if pm_brl > 0 else 0
        pnl_usd = (preco_usd - preco_medio_usd) * qtd
        pnl_reais = pnl_usd * cotacao_dolar

        total_brl += valor_brl
        total_pnl_brl += pnl_reais

        ativos.append({
            "simbolo": symb,
            "quantidade": qtd,
            "preco_atual_usd": round(preco_usd, 8),
            "preco_atual_brl": round(preco_brl, 8),
            "valor_total_brl": round(valor_brl, 2),
            "valor_total_usd": round(valor_usd, 2),
            "preco_medio_usd": round(preco_medio_usd, 8),
            "preco_medio_brl": round(pm_brl, 8),
            "pnl_percent": round(pnl_percent, 2),
            "pnl_usd": round(pnl_usd, 2),
            "pnl_reais": round(pnl_reais, 2),
        })

    if precos_alterados:
        _salvar_precos_medios(precos_medios)

    salvar_historico_patrimonio(total_brl)

    return jsonify({
        "ativos": ativos,
        "total": round(total_brl, 2),
        "total_pnl": round(total_pnl_brl, 2),
        "dolar": cotacao_dolar,
        "modo": "LIVE",
    })


# ── análise IA ───────────────────────────────────────

@api.route("/api/analise_ia/<timeframe>")
def analise_ia(timeframe):
    if timeframe not in ("1m", "15m", "1h", "4h", "1d"):
        timeframe = "1d"
    resultado = gerar_relatorio(timeframe)
    return jsonify(resultado)


@api.route("/api/radar/<timeframe>")
def radar(timeframe):
    if timeframe not in ("1m", "15m", "1h", "4h", "1d"):
        timeframe = "1d"
    return jsonify(processar_radar_mercado(timeframe))


@api.route("/api/alocacao_ia/<timeframe>")
def alocacao_ia(timeframe):
    if timeframe not in ("1m", "15m", "1h", "4h", "1d"):
        timeframe = "1d"
    cotacao = obter_cotacao_dolar()
    caixa_brl = _live_caixa_brl(cotacao)
    if caixa_brl <= 0:
        return jsonify({"erro": "Nao foi possivel detectar seu caixa. O saldo BRL pode estar na carteira Fiat da Binance (nao na Spot). Transfira de Fiat para Spot no site da Binance e tente novamente.", "caixa_brl": 0, "alocacoes": []})
    client = get_client()
    ativos_existentes = []
    if client:
        try:
            account = client.get_account()
            for saldo in account["balances"]:
                qtd = float(saldo["free"]) + float(saldo["locked"])
                if qtd > 0 and saldo["asset"] not in ("USDT", "BRL"):
                    ativos_existentes.append(saldo["asset"])
        except:
            pass
    resultado = processar_alocacao(caixa_brl, timeframe, ativos_existentes, cotacao)
    return jsonify(resultado)


@api.route("/api/status_ia")
def status_ia():
    return jsonify({"status": get_status_ia()})


# ── dados auxiliares ────────────────────────────────

@api.route("/api/alertas", methods=["GET", "POST"])
def handle_alertas():
    if request.method == "POST":
        data = request.get_json()
        criar_alerta_db(
            simbolo=data["simbolo"],
            preco_alvo=data["preco_alvo"],
            direcao=data.get("direcao", "acima"),
            repeticao=data.get("repeticao", "sempre"),
        )
        logger.info("Alerta criado: %s %s R$ %.2f", data["simbolo"], data.get("direcao"), data["preco_alvo"])
        return jsonify({"ok": True})
    return jsonify(obter_alertas_db())


@api.route("/api/alertas/<int:id_alerta>", methods=["DELETE"])
def deletar_alerta(id_alerta):
    deletar_alerta_db(id_alerta)
    return jsonify({"ok": True})


@api.route("/api/patrimonio_historico")
def hist_patrimonio():
    return jsonify(obter_historico_patrimonio())


@api.route("/api/indicadores/<simbolo>/<timeframe>")
def indicadores(simbolo, timeframe):
    if timeframe not in ("1m", "15m", "1h", "4h", "1d"):
        timeframe = "1d"
    return jsonify(calcular_indicadores_completos(simbolo.upper(), timeframe))


@api.route("/api/historico_ativo/<simbolo>/<timeframe>")
def historico_ativo(simbolo, timeframe):
    if timeframe not in ("1m", "15m", "1h", "4h", "1d"):
        timeframe = "1d"
    c = get_client()
    if not c:
        return jsonify({"error": "Sem conexao"})
    from binance.client import Client
    mapa = {
        "1m": (Client.KLINE_INTERVAL_1MINUTE, 1000),
        "15m": (Client.KLINE_INTERVAL_15MINUTE, 1000),
        "1h": (Client.KLINE_INTERVAL_1HOUR, 1000),
        "4h": (Client.KLINE_INTERVAL_4HOUR, 750),
        "1d": (Client.KLINE_INTERVAL_1DAY, 500),
    }
    intervalo, limite = mapa.get(timeframe, (Client.KLINE_INTERVAL_1DAY, 500))
    cotacao = obter_cotacao_dolar()
    try:
        klines = c.get_klines(symbol=f"{simbolo}USDT", interval=intervalo, limit=limite)
        dados = [
            {
                "x": int(k[0]),
                "y": [round(float(k[1]) * cotacao, 2), round(float(k[2]) * cotacao, 2),
                      round(float(k[3]) * cotacao, 2), round(float(k[4]) * cotacao, 2)],
            }
            for k in klines
        ]
        return jsonify(dados)
    except Exception as e:
        return jsonify({"error": str(e)})


@api.route("/api/trades/<simbolo>")
def trades(simbolo):
    c = get_client()
    if not c:
        return jsonify([])
    from datetime import datetime as dt
    cotacao = obter_cotacao_dolar()
    data_corte = int(dt(2026, 6, 1).timestamp() * 1000)
    for pair in (f"{simbolo}USDT", f"{simbolo}BRL"):
        try:
            trades_raw = c.get_my_trades(symbol=pair, startTime=data_corte, limit=100)
            dados = [
                {
                    "time": int(t["time"]) // 1000,
                    "qty": float(t["qty"]),
                    "price": round(float(t["price"]) * (cotacao if pair.endswith("USDT") else 1), 2),
                }
                for t in trades_raw if t["isBuyer"]
            ]
            if dados:
                return jsonify(dados)
        except Exception:
            continue
    return jsonify([])


@api.route("/api/ordens_abertas")
def ordens_abertas():
    c = get_client()
    if not c:
        return jsonify({"erro": "Sem conexao", "ordens": []})
    try:
        ordens = c.get_open_orders()
        return jsonify({
            "ordens": [{
                "simbolo": o["symbol"],
                "lado": "COMPRA" if o["side"] == "BUY" else "VENDA",
                "tipo": o["type"],
                "quantidade": float(o["origQty"]),
                "preco": float(o["price"]),
                "stop_price": float(o.get("stopPrice", 0)),
                "status": o["status"],
                "data": datetime.fromtimestamp(o["time"] / 1000).strftime("%d/%m/%Y %H:%M"),
                "preenchido": f"{float(o['executedQty']) / float(o['origQty']) * 100:.1f}%" if float(o['origQty']) > 0 else "0%",
            } for o in ordens],
            "total": len(ordens)
        })
    except Exception as e:
        return jsonify({"erro": str(e), "ordens": []})
