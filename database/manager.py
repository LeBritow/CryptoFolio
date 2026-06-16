import sqlite3
from datetime import datetime
from config import DB_NAME


def _con():
    conn = sqlite3.connect(DB_NAME)
    conn.execute('PRAGMA journal_mode=WAL;')
    return conn


def _init_tabelas():
    conn = _con()
    c = conn.cursor()
    c.execute("CREATE TABLE IF NOT EXISTS patrimonio (id INTEGER PRIMARY KEY AUTOINCREMENT, valor REAL, data TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS ajustes (simbolo TEXT PRIMARY KEY, preco_usd REAL, quantidade REAL)")
    c.execute("CREATE TABLE IF NOT EXISTS conselhos_ia (simbolo TEXT PRIMARY KEY, acao TEXT, data TEXT, alvo_stop REAL, preco_ref REAL, alvo_tp REAL, qtd_ref REAL)")
    c.execute("CREATE TABLE IF NOT EXISTS alertas (id INTEGER PRIMARY KEY AUTOINCREMENT, simbolo TEXT, preco_alvo REAL, direcao TEXT, repeticao TEXT)")
    for col in ("quantidade",): c.execute(f"ALTER TABLE ajustes ADD COLUMN {col} REAL", ())
    for col in ("alvo_stop", "preco_ref", "alvo_tp", "qtd_ref"): c.execute(f"ALTER TABLE conselhos_ia ADD COLUMN {col} REAL", ())
    conn.commit()
    conn.close()


def obter_memoria_ia():
    conn = _con()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    try:
        c.execute("SELECT * FROM conselhos_ia")
        rows = c.fetchall()
    except:
        rows = []
    conn.close()
    res = {}
    for r in rows:
        keys = r.keys()
        res[r['simbolo']] = {
            "acao": r['acao'] if 'acao' in keys else "Nenhum",
            "stop": r['alvo_stop'] if 'alvo_stop' in keys else None,
            "ref": r['preco_ref'] if 'preco_ref' in keys else None,
            "tp": r['alvo_tp'] if 'alvo_tp' in keys else None,
            "qtd_ref": r['qtd_ref'] if 'qtd_ref' in keys else None,
        }
    return res


def salvar_memoria_ia(simbolo, acao, alvo_stop, preco_ref=None, alvo_tp=None, qtd_ref=None):
    conn = _con()
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO conselhos_ia (simbolo, acao, data, alvo_stop, preco_ref, alvo_tp, qtd_ref) VALUES (?, ?, ?, ?, ?, ?, ?)",
              (simbolo, acao, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), alvo_stop, preco_ref, alvo_tp, qtd_ref))
    conn.commit()
    conn.close()


def obter_ajustes_manuais():
    conn = _con()
    c = conn.cursor()
    c.execute("SELECT simbolo, preco_usd, quantidade FROM ajustes")
    rows = c.fetchall()
    conn.close()
    return {row[0]: {"preco_usd": row[1], "quantidade": row[2]} for row in rows}


def salvar_historico_patrimonio(valor_total):
    try:
        conn = _con()
        c = conn.cursor()
        c.execute("CREATE TABLE IF NOT EXISTS patrimonio (id INTEGER PRIMARY KEY AUTOINCREMENT, valor REAL, data TEXT)")
        c.execute("SELECT data FROM patrimonio ORDER BY id DESC LIMIT 1")
        row = c.fetchone()
        agora = datetime.now()
        if not row or (agora - datetime.strptime(row[0], "%Y-%m-%d %H:%M:%S")).total_seconds() >= 3600:
            c.execute("INSERT INTO patrimonio (valor, data) VALUES (?, ?)", (valor_total, agora.strftime("%Y-%m-%d %H:%M:%S")))
            conn.commit()
        conn.close()
    except Exception:
        pass


def obter_historico_patrimonio():
    try:
        conn = _con()
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("CREATE TABLE IF NOT EXISTS patrimonio (id INTEGER PRIMARY KEY AUTOINCREMENT, valor REAL, data TEXT)")
        c.execute("SELECT valor, data FROM patrimonio ORDER BY id ASC")
        rows = [{"value": round(r["valor"], 2), "time": int(datetime.strptime(r["data"], "%Y-%m-%d %H:%M:%S").timestamp())} for r in c.fetchall()]
        conn.close()
        return rows
    except Exception:
        return []


def obter_alertas_db():
    conn = _con()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    try:
        c.execute("SELECT id, simbolo, preco_alvo, direcao, repeticao FROM alertas")
        rows = [dict(r) for r in c.fetchall()]
    except:
        rows = []
    conn.close()
    return rows


def criar_alerta_db(simbolo, preco_alvo, direcao, repeticao="sempre"):
    conn = _con()
    c = conn.cursor()
    c.execute("INSERT INTO alertas (simbolo, preco_alvo, direcao, repeticao) VALUES (?, ?, ?, ?)",
              (simbolo, preco_alvo, direcao, repeticao))
    conn.commit()
    conn.close()


def deletar_alerta_db(id_alerta):
    conn = _con()
    c = conn.cursor()
    c.execute("DELETE FROM alertas WHERE id = ?", (id_alerta,))
    conn.commit()
    conn.close()
