import json
import time
import os
import logging
from datetime import datetime
from google import genai
from pydantic import BaseModel
from config import GEMINI_API_KEY
from database.manager import obter_memoria_ia, salvar_memoria_ia, criar_alerta_db
from services.corretora import (
    pegar_todos_precos,
    calcular_indicadores_completos,
    calcular_indicadores_tecnicos,
    get_client,
)

logger = logging.getLogger(__name__)

_client_ai = None
_ultima_chamada = 0
_INTERVALO_MINIMO = 10
_HISTORICO_ALOCACAO = "historico_alocacao.json"


def _carregar_historico_alocacao():
    if not os.path.exists(_HISTORICO_ALOCACAO):
        return []
    try:
        with open(_HISTORICO_ALOCACAO) as f:
            dados = json.load(f)
            return dados[-5:]
    except:
        return []


def _salvar_historico_alocacao(caixa_brl, alocacoes, visao_geral):
    historico = _carregar_historico_alocacao()
    historico.append({
        "data": datetime.now().strftime("%d/%m/%Y %H:%M"),
        "caixa_brl": caixa_brl,
        "visao_geral": visao_geral,
        "alocacoes": [{
            "simbolo": a["simbolo"],
            "porcentagem": a["porcentagem"],
            "preco_entrada": a["preco_entrada"],
            "tipo_ordem": a["tipo_ordem"],
            "janela": a["janela"],
        } for a in alocacoes],
    })
    with open(_HISTORICO_ALOCACAO, "w") as f:
        json.dump(historico[-10:], f, indent=2)

# ── Schemas ──────────────────────────────────────────

class DicaAtivo(BaseModel):
    simbolo: str
    acao: str
    motivo: str
    confianca: float
    risco: str
    alvo_profit: float
    alvo_stop: float

class AnalisePortfolio(BaseModel):
    visao_geral: str
    dicas: list[DicaAtivo]

class SugestaoRadar(BaseModel):
    ativo: str
    sinal: str
    confianca: float
    justificativa: str

class AnaliseRadar(BaseModel):
    visao_radar: str
    sugestoes: list[SugestaoRadar]

class AlertaIsolado(BaseModel):
    visao: str
    acao: str
    urgencia: str

class ItemAlocacao(BaseModel):
    simbolo: str
    porcentagem: float
    preco_entrada: float
    tipo_ordem: str
    janela: str
    confianca: float
    motivo: str

class RecomendacaoAlocacao(BaseModel):
    visao_geral: str
    alocacoes: list[ItemAlocacao]

TOP_15 = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE", "DOT", "PEPE", "SUI", "ARB", "OP", "INJ"]

STATUS_MOTOR_IA = "Sistema pronto."

# ── Helpers ──────────────────────────────────────────

def get_status_ia():
    return STATUS_MOTOR_IA

def _get_client():
    global _client_ai
    if _client_ai is None:
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY nao configurada — defina no .env")
        _client_ai = genai.Client(api_key=GEMINI_API_KEY)
    return _client_ai

def _rate_limit():
    global _ultima_chamada
    agora = time.time()
    espera = _INTERVALO_MINIMO - (agora - _ultima_chamada)
    if espera > 0:
        time.sleep(espera)
    _ultima_chamada = time.time()

def _chamar_ia(prompt, schema, temperatura=0.3, max_tentativas=3):
    global STATUS_MOTOR_IA
    for tentativa in range(1, max_tentativas + 1):
        try:
            STATUS_MOTOR_IA = f"Conectando ao Gemini ({tentativa}/{max_tentativas})..."
            _rate_limit()
            client = _get_client()
            resposta = client.models.generate_content(
                model="gemini-flash-lite-latest",
                contents=prompt,
                config={
                    "temperature": temperatura,
                    "response_mime_type": "application/json",
                    "response_schema": schema,
                },
            )
            STATUS_MOTOR_IA = "Resposta recebida."
            return json.loads(resposta.text)
        except Exception as e:
            if tentativa == max_tentativas:
                STATUS_MOTOR_IA = "Falha apos tentativas."
                return {"erro": str(e)}
            espera = 3 * tentativa
            logger.warning("Gemini ocupado — tentativa %d, aguardando %ds", tentativa, espera)
            for s in range(espera, 0, -1):
                STATUS_MOTOR_IA = f"Aguardando Gemini ({s}s)..."
                time.sleep(1)

# ── Analise do Portfolio existente ──────────────────

def processar_analise_ia(timeframe="1d"):
    global STATUS_MOTOR_IA
    STATUS_MOTOR_IA = "Lendo carteira ao vivo..."
    client = get_client()
    if not client:
        return {"erro": "Sem conexao com a Binance. Verifique sua internet e chaves de API."}
    carteira = {}
    caixa = 0.0
    try:
        account = client.get_account()
        for saldo in account["balances"]:
            qtd = float(saldo["free"]) + float(saldo["locked"])
            if qtd <= 0:
                continue
            if saldo["asset"] == "USDT":
                caixa = qtd
            elif saldo["asset"] != "BRL":
                carteira[saldo["asset"]] = carteira.get(saldo["asset"], 0) + qtd
    except Exception as e:
        return {"erro": f"Falha ao ler carteira da Binance: {e}"}
    precos = pegar_todos_precos()
    memoria = obter_memoria_ia()
    if not carteira or all(qtd <= 0 for qtd in carteira.values()):
        return {"visao_geral": "Carteira vazia (somente caixa). Aguardando oportunidades.", "dicas": []}
    STATUS_MOTOR_IA = "Calculando indicadores..."
    linhas = [f"## Carteira — Caixa: ${caixa:.2f}\n"]
    linhas.append("| Ativo | Preco | RSI | MACD | Tendencia | Suporte | Resistencia | Volatilidade(ATR%) | Volume(rel) | Acao Anterior |")
    linhas.append("|-------|-------|-----|------|-----------|---------|-------------|-------------------|-------------|--------------|")
    for simbolo, qtd in carteira.items():
        if qtd <= 0: continue
        ind = calcular_indicadores_completos(simbolo, timeframe)
        if "erro" in ind: continue
        p = ind["preco"]
        rsi = f'{ind["rsi"]:.1f}' if ind["rsi"] else "N/A"
        macd = f'{ind["macd_hist"]:+.2e}' if ind["macd_hist"] else "N/A"
        atr_pct = f'{ind["atr_pct"]:.2f}%' if ind["atr_pct"] else "N/A"
        mem = memoria.get(simbolo, {})
        acao_ant = mem.get("acao", "-")
        linhas.append(
            f'| {simbolo} | ${p:.6f} | {rsi} | {macd} | {ind["tendencia"]} | '
            f'${ind["suporte"]:.6f} | ${ind["resistencia"]:.6f} | {atr_pct} | '
            f'{ind["volume_rel"]}x | {acao_ant} |'
        )
    prompt = f"""Voce e um analista quantitativo. Analise a carteira abaixo e recomende acoes objetivas.
Dados ({timeframe}):
{chr(10).join(linhas)}
Regras:
- COMPRAR: RSI < 35 + MACD histograma subindo + tendencia de alta
- VENDER: RSI > 70 + MACD histograma caindo, ou preco proximo da resistencia
- MANTER: ativo saudavel, sem indicios de reversao
- AGUARDAR: sem sinal claro
- confianca deve refletir o numero de indicadores convergentes
- Risco alto = ATR acima de 5% ou volume muito baixo
- Se nao houver sinal claro para um ativo, use acao MANTER com confianca baixa"""
    STATUS_MOTOR_IA = "Enviando para analise..."
    dados = _chamar_ia(prompt, AnalisePortfolio)
    if not isinstance(dados, dict) or "erro" in dados:
        return dados if isinstance(dados, dict) else {"erro": str(dados)}
    dados.setdefault("visao_geral", "Analise concluida.")
    dados.setdefault("dicas", [])
    for dica in dados["dicas"]:
        simb = dica.get("simbolo", "")
        if not simb: continue
        try:
            stop = float(dica.get("alvo_stop") or 0)
            tp = float(dica.get("alvo_profit") or 0)
        except (ValueError, TypeError):
            stop = 0; tp = 0
        preco_atual = precos.get(simb + "USDT", 0)
        qtd_atual = carteira.get(simb, 0)
        max_ref = memoria.get(simb, {}).get("ref") or preco_atual
        if preco_atual and preco_atual > max_ref:
            max_ref = preco_atual
        salvar_memoria_ia(simb, dica.get("acao", "MANTER"), stop, max_ref, tp, qtd_atual)
    return dados

gerar_relatorio = processar_analise_ia

# ── Radar de Mercado (TOP 10) ────────────────────────

def processar_radar_mercado(timeframe="1d"):
    global STATUS_MOTOR_IA
    STATUS_MOTOR_IA = "Varrendo top 10 ativos..."
    linhas = []
    c = get_client()
    for coin in TOP_15[:10]:
        ind = calcular_indicadores_completos(coin, timeframe)
        if "erro" in ind: continue
        if c:
            try:
                depth = c.get_order_book(symbol=f"{coin}USDT", limit=50)
                bid_vol = sum(float(b[0]) * float(b[1]) for b in depth["bids"])
                ask_vol = sum(float(a[0]) * float(a[1]) for a in depth["asks"])
                ob_status = "compra" if bid_vol > ask_vol * 1.5 else "venda" if ask_vol > bid_vol * 1.5 else "neutro"
            except Exception:
                ob_status = "neutro"
        else:
            ob_status = "neutro"
        linhas.append(
            f"- {coin}: RSI={ind['rsi']}, MACD_hist={ind['macd_hist']:+.2e}, "
            f"Tendencia={ind['tendencia']}, Vol_rel={ind['volume_rel']}x, OB={ob_status}"
        )
    prompt = f"""Varredura de mercado ({timeframe}). Identifique ativos com assimetria positiva.
Dados:
{chr(10).join(linhas)}
Regras:
- COMPRA: RSI <= 40 + OB compra + tendencia de alta ou correcao
- AGUARDAR: RSI baixo sem confirmacao no OB
- IGNORAR: demais casos"""
    dados = _chamar_ia(prompt, AnaliseRadar, temperatura=0.2)
    if not isinstance(dados, dict):
        return {"visao_radar": "Nenhuma oportunidade clara.", "sugestoes": []}
    dados.setdefault("visao_radar", "Varredura concluida.")
    dados.setdefault("sugestoes", [])
    return dados

# ── Alerta Isolado ──────────────────────────────────

def processar_alerta_isolado(simbolo, motivo, preco_atual, timeframe="1d"):
    ind = calcular_indicadores_completos(simbolo, timeframe)
    if "erro" in ind:
        return {"erro": ind["erro"]}
    prompt = f"""Alerta para {simbolo} a ${preco_atual}.
Gatilho: {motivo}
Indicadores ({timeframe}):
- RSI: {ind['rsi']}
- MACD hist: {ind['macd_hist']}
- Tendencia: {ind['tendencia']}
- Suporte: ${ind['suporte']:.6f}
- Resistencia: ${ind['resistencia']:.6f}
- ATR%: {ind['atr_pct']}
- Volume rel: {ind['volume_rel']}x
- BB upper: ${ind['bb_upper']:.6f}
- BB lower: ${ind['bb_lower']:.6f}
Avalie se o gatilho e um falso alarme ou acao real. Responda com urgencia baixa/media/alta."""
    dados = _chamar_ia(prompt, AlertaIsolado, temperatura=0.2)
    return dados if isinstance(dados, dict) else {"erro": str(dados)}

# ── Alocacao Inteligente (Caixa -> novos ativos) ─────

def processar_alocacao(caixa_brl=1000, timeframe="1d", ativos_existentes=None, cotacao_dolar=5.4):
    global STATUS_MOTOR_IA
    STATUS_MOTOR_IA = "Coletando dados de mercado para alocacao..."
    if ativos_existentes is None:
        ativos_existentes = []
    linhas = []
    c = get_client()
    for coin in TOP_15:
        ind = calcular_indicadores_completos(coin, timeframe)
        if "erro" in ind: continue
        preco_brl = ind["preco"] * cotacao_dolar
        sup_brl = ind["suporte"] * cotacao_dolar
        res_brl = ind["resistencia"] * cotacao_dolar
        if c:
            try:
                depth = c.get_order_book(symbol=f"{coin}USDT", limit=50)
                bid_vol = sum(float(b[0]) * float(b[1]) for b in depth["bids"])
                ask_vol = sum(float(a[0]) * float(a[1]) for a in depth["asks"])
                ob_status = "compra" if bid_vol > ask_vol * 1.5 else "venda" if ask_vol > bid_vol * 1.5 else "neutro"
            except Exception:
                ob_status = "neutro"
        else:
            ob_status = "neutro"
        ja_tenho = "SIM" if coin in ativos_existentes else "NAO"
        linhas.append(
            f"- {coin} [tenho={ja_tenho}]: R${preco_brl:.2f}, RSI={ind['rsi']}, "
            f"MACD_hist={ind['macd_hist']:+.2e}, Tendencia={ind['tendencia']}, "
            f"ATR%={ind['atr_pct']:.2f}%, Vol_rel={ind['volume_rel']}x, "
            f"OB={ob_status}, Sup=R${sup_brl:.2f}, Res=R${res_brl:.2f}"
        )
    historico = _carregar_historico_alocacao()
    historico_str = ""
    if historico:
        historico_str = "\nHISTORICO DE RECOMENDACOES ANTERIORES:\n"
        for h in historico[-3:]:
            aloc = ", ".join([f"{a['simbolo']} {a['porcentagem']}% (R${a['preco_entrada']:.2f})" for a in h["alocacoes"]])
            historico_str += f"[{h['data']}] Caixa R${h['caixa_brl']:.2f} -> {aloc}\n"

    STATUS_MOTOR_IA = "Enviando para analise de alocacao..."
    prompt = f"""Voce e um gestor de portfolio quantitativo. Um investidor tem R$ {caixa_brl:.2f} disponiveis em caixa.
Ativos que ele ja possui: {', '.join(ativos_existentes) if ativos_existentes else 'nenhum'}
{historico_str}
Dados de mercado ({timeframe}) para os principais ativos:
{chr(10).join(linhas)}
CALCULE A CONFIANCA (0.0 a 1.0) para cada ativo conforme:
- confianca = 0.6 (minimo para recomendar) + bônus
- Bônus +0.2 se RSI entre 30-50 (comprando na fraqueza)
- Bônus +0.1 se tendencia = "alta" ou "correcao"
- Bônus +0.1 se OB = "compra"
- Bônus +0.1 se volume_rel > 1.0 (acima da media)
- Desconto -0.1 se RSI > 65 (quase sobrecomprado)
- Desconto -0.2 se tendencia = "queda"
- NUNCA recomende ativo com confianca < 0.6
- Para BTC/ETH/SOL: confianca minima de partida = 0.7
- confianca maxima = 1.0
REGRAS DE ALOCACAO:
- O campo 'porcentagem' indica o QUANTO alocar de 0 a 100%
- A soma das porcentagens deve ser exatamente 100%
- Cada ativo recomendado DEVE ter no minimo 15% de alocacao
- Nao recomende ativos com menos de 15% - concentre em menos ativos com tese forte
PRIORIZE ATIVOS POR CAPITALIZACAO (maior primeiro):
1. BTC, ETH (blue chips - considerar sempre se RSI < 55)
2. SOL, BNB (large caps - priorizar se indicadores neutros/positivos)
3. XRP, ADA, DOT, LINK (mid caps - so se confianca >= 0.7)
4. Outros (so em casos excepcionais com confianca >= 0.8)
APRENDIZADO COM HISTORICO:
- Revise as recomendacoes anteriores listadas acima
- Se um ativo foi recomendado antes e os indicadores pioraram, evite ou reduza
- Se um ativo NAO foi recomendado antes mas agora tem indicadores melhores, considere
- Seja consistente: nao mude recomendacoes drasticamente sem mudanca significativa nos dados
INSTRUCOES:
- Para cada ativo, defina o PRECO DE ENTRADA ideal em REAIS (preco_entrada)
- Defina o TIPO DE ORDEM: LIMITE ou MERCADO
- Defina a JANELA: "imediato", "24h", "esta semana", "aguardar correcao"
- Considere diversificacao - nao coloque mais de 40% em um unico ativo
- Se o momento for desfavoravel, pode recomendar manter parte em caixa
- Seja CONSERVADOR: prefira BTC/ETH/SOL/BNB"""
    dados = _chamar_ia(prompt, RecomendacaoAlocacao, temperatura=0.3)
    if not isinstance(dados, dict) or "erro" in dados:
        return dados if isinstance(dados, dict) else {"erro": str(dados)}
    dados.setdefault("visao_geral", "Alocacao concluida.")
    dados.setdefault("alocacoes", [])
    for item in dados["alocacoes"]:
        item["valor_brl"] = round(caixa_brl * item["porcentagem"] / 100, 2)
        item["porcentagem"] = round(item["porcentagem"], 1)
    dados["caixa_brl"] = caixa_brl
    _salvar_historico_alocacao(caixa_brl, dados["alocacoes"], dados["visao_geral"])
    precos_atuais = pegar_todos_precos()
    for item in dados["alocacoes"]:
        preco_alvo = item["preco_entrada"]
        if preco_alvo <= 0:
            continue
        par = item["simbolo"] + "USDT"
        preco_usd = precos_atuais.get(par)
        if not preco_usd:
            continue
        preco_atual_brl = preco_usd * cotacao_dolar
        direcao = "abaixo" if preco_alvo < preco_atual_brl else "acima"
        try:
            criar_alerta_db(item["simbolo"], preco_alvo, direcao, "sempre")
        except Exception:
            pass
    return dados
