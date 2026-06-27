const MEU_STOP_LOSS = -15.0; 
const MEU_TAKE_PROFIT = 25.0; 

let timerId = null;
let dadosGlobaisAtivos = [];
let ordenacaoAtual = { coluna: 'valor_total_brl', crescente: false };

let ativoSelecionado = null;
let precoAtualAtivo = 0; 
let timeframeAtual = '1d'; 
let dicasGlobaisIA = {}; 
let valoresAtuaisAlvos = { tp: null, sl: null };
let cacheTradesHistorico = {};
let memoriaExtremosPnL = {};

let meusAlertas = [];
let precosAnteriores = {}; 
let alertasDisparadosIA = {};
let abortControllerIA = null;
let cotacaoAtual = 5.40;

// ── Menu gear ────────────────────────────
function toggleMenu() {
    document.getElementById('headerDropdown').classList.toggle('ativo');
}
function fecharMenu() {
    document.getElementById('headerDropdown').classList.remove('ativo');
}
document.addEventListener('click', (e) => {
    if (!e.target.closest('.header-actions')) fecharMenu();
});

// ── Modal ─────────────────────────────────
function abrirModal(titulo, html) {
    document.getElementById('modalTitulo').innerText = titulo;
    document.getElementById('modalBody').innerHTML = html;
    document.getElementById('modalOverlay').classList.add('ativo');
}
function fecharModal() {
    document.getElementById('modalOverlay').classList.remove('ativo');
}
function fecharModalPorFora(e) {
    if (e.target === document.getElementById('modalOverlay')) fecharModal();
}

// ── Seletor de ativos ─────────────────────
const TOP_ATIVOS = ['BTC','ETH','SOL','BNB','XRP','ADA','AVAX','LINK','DOGE','DOT','PEPE','SUI','ARB','OP','INJ','ATOM','FTM','NEAR','APT','MATIC','GRT','EGLD','ALGO','FIL','SAND','AXS','AAVE','UNI','CRV','MKR','COMP','SNX','YFI','LTC','BCH','EOS','TRX','VET','ICP','FIL','FET','AGIX','OCEAN','RNDR'];

function mostrarListaAtivos() {
    const val = document.getElementById('inputBuscaAtivo').value.toUpperCase();
    const lista = document.getElementById('seletorLista');

    let ativos = [...TOP_ATIVOS];
    dadosGlobaisAtivos.forEach(a => {
        const s = a.simbolo.replace(' (BRL)','').replace('Caixa','');
        if (s && !ativos.includes(s)) ativos.push(s);
    });

    const filtrados = ativos.filter(a => a.includes(val)).slice(0, 30);
    if (filtrados.length === 0) { lista.classList.remove('ativo'); return; }
    const sel = (ativoSelecionado || '').toUpperCase();
    lista.innerHTML = filtrados.map(a =>
        `<div class="seletor-item${a === sel ? ' ativo' : ''}" onclick="selecionarAtivo('${a}')"><span class="sigla">${a}</span><span class="nome">/BRL</span></div>`
    ).join('');
    lista.classList.add('ativo');
}

function filtrarAtivos(val) {
    mostrarListaAtivos();
}

function selecionarAtivo(simbolo) {
    document.getElementById('inputBuscaAtivo').value = simbolo;
    document.getElementById('seletorLista').classList.remove('ativo');
    carregarGrafico(simbolo);
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.seletor-ativo-wrapper')) {
        document.getElementById('seletorLista').classList.remove('ativo');
    }
});

async function gerenciarAlerta(simbolo, precoAtual) {
    abrirModal(
        `Novo Alerta — ${simbolo}`,
        `<div style="margin-bottom:12px;color:var(--text-muted);font-size:0.85rem;">
            Preco atual: <strong style="color:#fff;">R$ ${formatarNumeroBR(precoAtual)}</strong>
        </div>
        <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:4px;font-size:0.85rem;color:var(--text-muted);">Preco alvo (BRL):</label>
            <input type="text" id="inputPrecoAlvo" class="input-dark" style="width:100%;" placeholder="Ex: 350000" value="${precoAtual.toFixed(2)}">
        </div>
        <div style="margin-bottom:16px;">
            <label style="font-size:0.85rem;color:var(--text-muted);display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="checkRepetirUmaVez"> Disparar apenas uma vez
            </label>
        </div>
        <div style="display:flex;gap:8px;">
            <button class="btn-yellow" style="background:var(--bg-hover);color:var(--text-main);flex:1;" onclick="fecharModal()">Cancelar</button>
            <button class="btn-yellow" style="flex:1;" onclick="confirmarAlerta('${simbolo}', ${precoAtual})">Criar Alerta</button>
        </div>`
    );
}

async function confirmarAlerta(simbolo, precoAtual) {
    const val = document.getElementById('inputPrecoAlvo').value.replace(',', '.');
    const precoAlvo = parseFloat(val);
    if (isNaN(precoAlvo) || precoAlvo <= 0) {
        mostrarToast('Preco invalido.', '#F6465D');
        return;
    }
    const direcao = precoAlvo > precoAtual ? 'acima' : 'abaixo';
    const repeticao = document.getElementById('checkRepetirUmaVez').checked ? 'uma_vez' : 'sempre';
    fecharModal();
    await fetch('/api/alertas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simbolo, preco_alvo: precoAlvo, direcao, repeticao })
    });
    mostrarToast(`Alerta criado: ${simbolo} ${direcao} R$ ${formatarNumeroBR(precoAlvo)}`, '#0ECB81');
    carregarAlertas();
}

async function verAlertas() {
    if (meusAlertas.length === 0) {
        abrirModal('Meus Alertas', '<div style="color:var(--text-muted);text-align:center;padding:20px;">Nenhum alerta configurado.</div>');
        return;
    }
    let html = '';
    meusAlertas.forEach((a, i) => {
        const dir = a.direcao === 'acima' ? '\u2191 Acima de' : '\u2193 Abaixo de';
        html += `
            <div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg-dark);border:1px solid var(--bg-hover);border-radius:6px;padding:10px 12px;margin-bottom:8px;">
                <div>
                    <strong style="color:#fff;">${a.simbolo}</strong>
                    <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;">
                        ${dir} <strong style="color:var(--accent-yellow);">R$ ${Number(a.preco_alvo).toFixed(2)}</strong>
                        <span style="margin-left:8px;">(${a.repeticao})</span>
                    </div>
                </div>
                <button class="btn-yellow" style="background:var(--accent-red);color:#fff;padding:4px 12px;font-size:0.8rem;" onclick="excluirAlerta(${i})">Excluir</button>
            </div>`;
    });
    abrirModal(`Meus Alertas (${meusAlertas.length})`, html);
}

async function excluirAlerta(idx) {
    const alerta = meusAlertas[idx];
    if (!alerta) return;
    await fetch(`/api/alertas/${alerta.id}`, { method: 'DELETE' });
    mostrarToast(`Alerta de ${alerta.simbolo} removido.`, '#F6465D');
    carregarAlertas();
    verAlertas();
}

async function carregarAlertas() {
    const res = await fetch('/api/alertas');
    meusAlertas = await res.json();
}

async function verOrdensAbertas() {
    try {
        const res = await fetch('/api/ordens_abertas');
        const data = await res.json();

        if (data.erro) {
            abrirModal('Erro', `<div style="color:var(--accent-red);">${data.erro}</div>`);
            return;
        }

        if (data.total === 0) {
            abrirModal('Ordens Abertas', '<div style="color:var(--text-muted);text-align:center;padding:20px;">Nenhuma ordem aberta no momento.</div>');
            return;
        }

        let html = `<div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:12px;">Total: <strong style="color:#fff;">${data.total}</strong> ordens</div>`;
        data.ordens.forEach(o => {
            const preco = Number(o.preco);
            const stop = Number(o.stop_price);
            const ladoCor = o.lado === 'COMPRA' ? 'var(--accent-green)' : 'var(--accent-red)';
            html += `
                <div style="background:var(--bg-dark);border:1px solid var(--bg-hover);border-radius:6px;padding:12px;margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <strong style="color:#fff;">${o.simbolo}</strong>
                        <span style="color:${ladoCor};font-weight:bold;font-size:0.8rem;">${o.lado} ${o.tipo}</span>
                    </div>
                    <div style="font-size:0.85rem;color:var(--text-muted);display:grid;grid-template-columns:1fr 1fr;gap:4px;">
                        <span>Preco: <strong style="color:#fff;">${preco > 0 ? 'R$ '+preco.toFixed(2) : 'MERCADO'}</strong></span>
                        ${stop > 0 ? `<span>Stop: <strong style="color:var(--accent-red);">R$ ${stop.toFixed(2)}</strong></span>` : ''}
                        <span>Qtd: <strong style="color:#fff;">${o.quantidade}</strong></span>
                        <span>Preenchido: <strong style="color:#fff;">${o.preenchido}</strong></span>
                        <span style="grid-column:span 2;">Criada: ${o.data}</span>
                    </div>
                </div>`;
        });
        abrirModal(`Ordens Abertas (${data.total})`, html);
    } catch (e) {
        abrirModal('Erro', `<div style="color:var(--accent-red);">Erro ao buscar ordens: ${e.message}</div>`);
    }
}

async function editarPrecoMedio(simbolo) {
    const ativo = dadosGlobaisAtivos.find(a => a.simbolo === simbolo);
    const atual = ativo ? ativo.preco_medio_brl : 0;
    abrirModal(
        'Editar Preco Medio',
        `<div style="margin-bottom:12px;color:var(--text-muted);font-size:0.85rem;">Ativo: <strong style="color:#fff;">${simbolo}</strong> | Preco atual: <strong style="color:var(--accent-yellow);">R$ ${atual.toFixed(2)}</strong></div>
        <div style="display:flex;gap:8px;">
            <input type="text" id="inputNovoPreco" class="input-dark" style="flex:1;" placeholder="Novo preco medio em BRL" value="${atual.toFixed(2)}">
            <button class="btn-yellow" onclick="salvarEdicaoPreco('${simbolo}')">Salvar</button>
        </div>
        <div style="margin-top:8px;font-size:0.8rem;color:var(--text-muted);">Use ponto (.) como separador decimal.</div>`
    );
}

async function salvarEdicaoPreco(simbolo) {
    const val = document.getElementById('inputNovoPreco').value.replace(',', '.');
    if (!val || isNaN(val)) {
        mostrarToast('Valor invalido.', '#F6465D');
        return;
    }
    await fetch('/api/salvar_ajuste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simbolo, preco_brl: parseFloat(val) })
    });
    mostrarToast(`Preco medio de ${simbolo} atualizado!`, '#0ECB81');
    fecharModal();
    buscarDados();
}

async function restaurarPrecoMedio(simbolo) {
    abrirModal(
        'Restaurar Preco Medio',
        `<div style="text-align:center;padding:10px 0;">
            <div style="margin-bottom:16px;color:var(--text-muted);">Deseja apagar a edicao manual e restaurar o preco medio original da Binance para <strong style="color:#fff;">${simbolo}</strong>?</div>
            <div style="display:flex;gap:10px;justify-content:center;">
                <button class="btn-yellow" style="background:var(--bg-hover);color:var(--text-main);" onclick="fecharModal()">Cancelar</button>
                <button class="btn-yellow" onclick="confirmarRestauracao('${simbolo}')">Sim, Restaurar</button>
            </div>
        </div>`
    );
}

async function confirmarRestauracao(simbolo) {
    fecharModal();
    await fetch(`/api/restaurar_preco/${simbolo}`, { method: 'POST' });
    mostrarToast(`Preco de ${simbolo} sincronizado via Binance!`, '#0ECB81');
    buscarDados();
}

let miniChartDolar = null;

function carregarMiniGraficoDolar() {
    if (miniChartDolar) return; 

    setTimeout(async () => {
        const container = document.getElementById('miniGraficoDolarContainer');
        if (miniChartDolar) return; 

        miniChartDolar = LightweightCharts.createChart(container, {
            width: container.clientWidth, 
            height: 110,
            layout: { background: { color: 'transparent' }, textColor: '#848E9C' },
            grid: { vertLines: { visible: false }, horzLines: { visible: false } }, 
            rightPriceScale: { 
                visible: true, 
                borderVisible: false,
                scaleMargins: { top: 0.1, bottom: 0.1 }
            },
            timeScale: { 
                visible: true,        
                borderVisible: false, 
                timeVisible: true     
            },
            crosshair: { mode: LightweightCharts.CrosshairMode.Magnet },
            handleScroll: false,
            handleScale: false
        });

        miniChartDolar.applyOptions({ localization: { priceFormatter: price => 'R$ ' + price.toFixed(2) } });

        const areaSeriesDolar = miniChartDolar.addAreaSeries({
            lineColor: '#0ECB81', 
            topColor: 'rgba(14, 203, 129, 0.4)',
            bottomColor: 'rgba(14, 203, 129, 0.0)',
            lineWidth: 2,
            crosshairMarkerVisible: true,
            priceLineVisible: false, 
        });

        try {
            const res = await fetch('https://api.binance.com/api/v3/klines?symbol=USDTBRL&interval=1d&limit=30');
            const data = await res.json();
            
            const formatado = data.map(d => ({
                time: d[0] / 1000,
                value: parseFloat(d[4]) 
            }));
            
            areaSeriesDolar.setData(formatado);
            miniChartDolar.timeScale().fitContent(); 

            if (formatado.length > 0) {
                const valorInicial = formatado[0].value;
                const valorFinal = formatado[formatado.length - 1].value;
                const pct = ((valorFinal - valorInicial) / valorInicial) * 100;
                
                const cor = pct >= 0 ? '#0ECB81' : '#F6465D';
                const sinal = pct >= 0 ? '+' : '';

                const tituloDolar = document.querySelector('#popupDolar div');
                if(tituloDolar) {
                    tituloDolar.innerHTML = `Evolucao (30d) <span style="color: ${cor}; font-size: 0.85rem; margin-left: 6px; padding: 2px 6px; background: rgba(255,255,255,0.05); border-radius: 4px;">${sinal}${pct.toFixed(2)}%</span>`;
                }
            }

        } catch(e) {
            console.error("Erro ao puxar historico do dolar", e);
        }
    }, 50);
}

function carregarMiniGraficoPatrimonio() {
    if (miniChart) return; 

    setTimeout(async () => {
        if (miniChart) return;

        const container = document.getElementById('miniGraficoContainer');
        miniChart = LightweightCharts.createChart(container, {
            width: container.clientWidth, 
            height: 110,
            layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#848E9C' },
            grid: { vertLines: { visible: false }, horzLines: { visible: false } }, 
            timeScale: { visible: true, borderVisible: false, timeVisible: true }, 
            
            rightPriceScale: { 
                visible: true, 
                borderVisible: false,
                scaleMargins: { top: 0.05, bottom: 0.02 }
            }, 
            
            crosshair: { mode: LightweightCharts.CrosshairMode.Magnet }, 
            handleScroll: false, handleScale: false 
        });

        miniChart.applyOptions({ localization: { priceFormatter: price => 'R$ ' + price.toFixed(2) } });
        
        miniSeries = miniChart.addAreaSeries({ 
            lineColor: '#FCD535', 
            topColor: 'rgba(252, 213, 53, 0.4)',
            bottomColor: 'rgba(252, 213, 53, 0.0)',
            lineWidth: 2, 
            crosshairMarkerVisible: true,
            priceLineVisible: false
        });

        try {
            const res = await fetch('/api/patrimonio_historico');
            const data = await res.json();
            
            if (data.length > 0) {
                const textoPatrimonio = document.getElementById('patrimonioTotal').innerText;
                const valorLimpo = textoPatrimonio.replace(/\./g, '').replace(/[^\d,-]/g, '').replace(',', '.');
                const valorAtual = parseFloat(valorLimpo);
                
                const textoPnl = document.getElementById('patrimonioPnl').innerText;
                const pnlLimpo = textoPnl.replace(/\./g, '').replace(/[^\d,-]/g, '').replace(',', '.');
                const valorPnl = parseFloat(pnlLimpo);

                const tempoAgora = Math.floor(Date.now() / 1000);
                const ultimoPonto = data[data.length - 1];
                
                if (tempoAgora > ultimoPonto.time && !isNaN(valorAtual) && valorAtual > 0) {
                    data.push({ time: tempoAgora, value: valorAtual });
                }

                miniSeries.setData(data);
                miniChart.timeScale().fitContent();

                if (!isNaN(valorAtual) && !isNaN(valorPnl) && valorAtual > 0) {
                    const investimentoInicial = valorAtual - valorPnl; 
                    let pctLucro = 0;
                    if (investimentoInicial > 0) {
                        pctLucro = (valorPnl / investimentoInicial) * 100;
                    }
                    const cor = pctLucro >= 0 ? '#0ECB81' : '#F6465D';
                    const sinal = pctLucro >= 0 ? '+' : '';

                    const tituloPatrimonio = document.querySelector('#popupPatrimonio div');
                    if(tituloPatrimonio) {
                        tituloPatrimonio.innerHTML = `P&L Global <span style="color: ${cor}; font-size: 0.85rem; margin-left: 6px; padding: 2px 6px; background: rgba(255,255,255,0.05); border-radius: 4px;">${sinal}${pctLucro.toFixed(2)}%</span>`;
                    }
                }
            }
        } catch(e) {
            console.error("Erro ao carregar o grafico de patrimonio:", e);
        }
    }, 50);
}

function _corPorAcao(acao) {
    const a = String(acao || "MANTER").toUpperCase();
    if (a.includes("COMPRAR")) return { bg: "rgba(0,200,83,0.2)", fg: "#00e676", simbolo: "[C]" };
    if (a.includes("VENDER")) return { bg: "rgba(246,70,93,0.2)", fg: "#f6465d", simbolo: "[V]" };
    return { bg: "rgba(252,213,53,0.15)", fg: "#fcd535", simbolo: "[M]" };
}

function _corPorRisco(risco) {
    const r = String(risco || "medio").toLowerCase();
    if (r === "baixo") return { bg: "rgba(14,203,129,0.15)", fg: "#0ecb81", label: "Baixo" };
    if (r === "alto") return { bg: "rgba(246,70,93,0.15)", fg: "#f6465d", label: "Alto" };
    return { bg: "rgba(252,213,53,0.15)", fg: "#fcd535", label: "Medio" };
}

async function pedirAnaliseIA() {
    const btn = document.getElementById('btnIA');
    const div = document.getElementById('resultadoIA');

    if (abortControllerIA) { abortControllerIA.abort(); return; }

    abortControllerIA = new AbortController();
    const signal = abortControllerIA.signal;

    btn.innerText = "Cancelar IA";
    btn.style.background = "var(--accent-red)";
    btn.style.color = "#fff";

    div.innerHTML = `
        <div style="text-align:center;padding:40px 20px;">
            <div id="statusTextoIA" style="color:#0ecb81;font-family:monospace;background:var(--bg-dark);
                 padding:10px;border-radius:4px;border:1px dashed #0ecb81;font-weight:bold;">Iniciando...</div>
        </div>`;

    const t = setInterval(async () => {
        try {
            const r = await fetch('/api/status_ia');
            const d = await r.json();
            const el = document.getElementById('statusTextoIA');
            if (el) el.innerText = d.status;
        } catch (_) {}
    }, 1000);

    try {
        const res = await fetch(`/api/analise_ia/${timeframeAtual}`, { signal });
        const data = await res.json();
        clearInterval(t);

        if (data.erro) { div.innerHTML = `<div style="color:var(--accent-red);padding:15px;font-weight:bold;">${data.erro}</div>`; return; }

        const visao = data.visao_geral || "Analise concluida.";
        const dicas = Array.isArray(data.dicas) ? data.dicas : [];

        let html = `
            <div style="background:rgba(252,213,53,0.08);border-left:3px solid var(--accent-yellow);padding:12px;border-radius:4px;margin-bottom:15px;">
                <p style="margin:0;font-size:0.9rem;color:var(--text-main);line-height:1.5;">${visao}</p>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">`;

        dicas.forEach(d => {
            const c = _corPorAcao(d.acao);
            const r = _corPorRisco(d.risco);
            const conf = d.confianca != null ? (d.confianca * 100).toFixed(0) + "%" : "—";
            html += `
                <div style="background:var(--bg-dark);border:1px solid var(--bg-hover);border-radius:6px;padding:12px;cursor:pointer;transition:.15s;"
                     onclick="carregarGrafico('${d.simbolo||''}')"
                     onmouseover="this.style.borderColor='var(--accent-yellow)'" onmouseout="this.style.borderColor='var(--bg-hover)'">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <strong style="color:#fff;font-size:1rem;">${d.simbolo||'?'}</strong>
                        <span style="background:${c.bg};color:${c.fg};padding:2px 8px;border-radius:4px;font-size:.75rem;font-weight:bold;">${c.simbolo} ${(d.acao||'MANTER').toUpperCase()}</span>
                    </div>
                    <div style="display:flex;gap:8px;margin-bottom:6px;font-size:.75rem;">
                        <span style="background:${r.bg};color:${r.fg};padding:1px 6px;border-radius:3px;">Risco: ${r.label}</span>
                        <span style="background:rgba(255,255,255,0.05);color:var(--text-muted);padding:1px 6px;border-radius:3px;">Confianca: ${conf}</span>
                    </div>
                    <p style="margin:0;font-size:.8rem;color:var(--text-muted);line-height:1.4;">${d.motivo||''}</p>
                </div>`;
        });

        dicasGlobaisIA = {};
        dicas.forEach(d => {
            if (d.simbolo) {
                const tp_usd = d.alvo_profit && d.alvo_profit !== 'N/A' ? parseFloat(d.alvo_profit) : null;
                const sl_usd = d.alvo_stop && d.alvo_stop !== 'N/A' ? parseFloat(d.alvo_stop) : null;
                dicasGlobaisIA[d.simbolo] = {
                    acao: d.acao || 'MANTER',
                    tp: tp_usd ? tp_usd * cotacaoAtual : null,
                    sl: sl_usd ? sl_usd * cotacaoAtual : null,
                    confianca: d.confianca,
                };
            }
        });

        div.innerHTML = html + `</div>`;
        renderizarTabela();

    } catch (e) {
        clearInterval(t);
        div.innerHTML = e.name === 'AbortError'
            ? `<div style="color:var(--accent-yellow);padding:15px;text-align:center;font-weight:bold;">Cancelado.</div>`
            : `<div style="color:var(--accent-red);padding:15px;text-align:center;font-weight:bold;">Erro de comunicacao.</div>`;
    } finally {
        abortControllerIA = null;
        btn.innerText = "Atualizar Scanner";
        btn.style.background = "var(--accent-yellow)";
        btn.style.color = "#000";
    }
}

async function pedirAlocacaoIA() {
    const div = document.getElementById('resultadoIA');
    div.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-muted);">
        <div style="color:#0ecb81;font-family:monospace;padding:10px;border:1px dashed #0ecb81;border-radius:4px;">
        Analisando caixa disponivel e varrendo top 15 ativos...</div></div>`;
    try {
        const res = await fetch(`/api/alocacao_ia/${timeframeAtual}`);
        const data = await res.json();
        if (data.erro) {
            div.innerHTML = `<div style="color:var(--accent-red);padding:15px;font-weight:bold;">${data.erro}</div>`;
            return;
        }
        const visao = data.visao_geral || "Alocacao concluida.";
        const alocacoes = Array.isArray(data.alocacoes) ? data.alocacoes : [];
        let html = `
            <div style="background:rgba(14,203,129,0.08);border-left:3px solid var(--accent-green);padding:12px;border-radius:4px;margin-bottom:15px;">
                <p style="margin:0;font-size:0.9rem;color:var(--text-main);line-height:1.5;">${visao}</p>
                <p style="margin:8px 0 0;font-size:0.85rem;color:var(--text-muted);">
                Caixa disponivel: <strong style="color:var(--accent-yellow);">${formatarDinheiro(data.caixa_brl)}</strong></p>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">`;
        alocacoes.forEach(a => {
            if (a.porcentagem <= 0) return;
            const cor = a.porcentagem > 30 ? '#0ECB81' : a.porcentagem > 10 ? '#FCD535' : '#848E9C';
            const conf = a.confianca != null ? (a.confianca * 100).toFixed(0) : '?';
            const confCor = a.confianca >= 0.7 ? '#0ECB81' : a.confianca >= 0.6 ? '#FCD535' : '#F6465D';
            html += `
                <div style="background:var(--bg-dark);border:1px solid var(--bg-hover);border-radius:6px;padding:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <strong style="color:#fff;font-size:1.05rem;">${a.simbolo}</strong>
                        <div style="display:flex;align-items:center;gap:10px;">
                            <span style="color:${confCor};font-weight:bold;font-size:0.85rem;">\u{1F52C} ${conf}%</span>
                            <span style="color:${cor};font-weight:bold;font-size:0.95rem;">
                                ${a.porcentagem}% (${formatarDinheiro(a.valor_brl)})</span>
                        </div>
                    </div>
                    <div style="display:flex;gap:10px;font-size:0.8rem;color:var(--text-muted);margin-bottom:6px;flex-wrap:wrap;">
                        <span>\u{1F4B5} Entrada: <strong style="color:#fff;">R$ ${Number(a.preco_entrada).toFixed(4)}</strong></span>
                        <span>\u{23F0} ${a.tipo_ordem || 'LIMITE'}</span>
                        <span>\u{1F4C5} ${a.janela || 'imediato'}</span>
                    </div>
                    <p style="margin:0;font-size:0.8rem;color:var(--text-muted);line-height:1.4;">${a.motivo||''}</p>
                </div>`;
        });
        html += `</div>`;
        if (alocacoes.length === 0) html += '<p style="text-align:center;color:var(--text-muted);">Nenhuma alocacao recomendada no momento.</p>';
        div.innerHTML = html;
    } catch (e) {
        div.innerHTML = `<div style="color:var(--accent-red);padding:15px;font-weight:bold;">Erro: ${e.message}</div>`;
    }
}

function alternarAutoIA() {
    const ligado = document.getElementById('checkAutoIA').checked;
    if (ligado) {
        mostrarToast("Modo Sentinela ativado. A IA gastara tokens apenas se detectar movimentacoes de Baleias.", "#0ECB81");
        pedirAnaliseIA(); 
    }
}

function ordenarTabela(coluna) {
    if (ordenacaoAtual.coluna === coluna) ordenacaoAtual.crescente = !ordenacaoAtual.crescente;
    else { ordenacaoAtual.coluna = coluna; ordenacaoAtual.crescente = false; }
    renderizarTabela();
}

function renderizarTabela() {
    const tbody = document.getElementById('tabelaCorpo');
    tbody.innerHTML = ''; 
    if (dadosGlobaisAtivos.length === 0) return;

    let ativosExibidos = [...dadosGlobaisAtivos];

    ativosExibidos.sort((a, b) => {
        let vA = a[ordenacaoAtual.coluna], vB = b[ordenacaoAtual.coluna];
        if (typeof vA === 'string') vA = vA.toLowerCase();
        if (typeof vB === 'string') vB = vB.toLowerCase();
        if (vA < vB) return ordenacaoAtual.crescente ? -1 : 1;
        if (vA > vB) return ordenacaoAtual.crescente ? 1 : -1;
        return 0;
    }).forEach(moeda => {
        const tr = document.createElement('tr');
        
        if (moeda.simbolo === ativoSelecionado) tr.classList.add("linha-ativa");
        
        tr.onclick = (e) => {
            if(e.target.tagName !== 'SPAN' && !moeda.simbolo.includes("Caixa")) {
                carregarGrafico(moeda.simbolo); 
            }
        };

        const corLucro = moeda.pnl_percent > 0 ? 'text-up' : 'text-down';
        let sinalText = "HOLD", sinalColor = "text-muted-custom";
        
        if (dicasGlobaisIA[moeda.simbolo]) {
            sinalText = "IA: " + dicasGlobaisIA[moeda.simbolo].acao;
            if (sinalText.includes("COMPRAR") || sinalText.includes("HOLD")) sinalColor = "text-warning-custom";
            else if (sinalText.includes("VEND") || sinalText.includes("LUCRO") || sinalText.includes("TAKE")) sinalColor = "text-up";
            else if (sinalText.includes("STOP")) sinalColor = "text-down";
        } else {
            if (moeda.pnl_percent <= MEU_STOP_LOSS) { sinalText = "STOP LOSS"; sinalColor = "text-down"; }
            else if (moeda.pnl_percent >= MEU_TAKE_PROFIT) { sinalText = "TAKE PROFIT"; sinalColor = "text-up"; }
        }

        const sinalEmoji = moeda.pnl_percent > 0 ? '\u2197' : moeda.pnl_percent < 0 ? '\u2198' : '\u2192';
        const iaEmoji = sinalText.includes('COMPRAR') ? '\u{1F4C8}' : sinalText.includes('VEND') || sinalText.includes('STOP') ? '\u{1F4C9}' : '\u{1F504}';

        tr.innerHTML = `
            <td style="font-weight: 600;">
                ${moeda.simbolo} 
                ${!moeda.simbolo.includes("Caixa") ? `<span style="cursor:pointer; font-size: 0.85rem; margin-left: 8px;" onclick="gerenciarAlerta('${moeda.simbolo}', ${moeda.preco_atual_brl})" title="Criar Alerta de Preco">\u{1F514}</span>` : ''}
            </td>
            
            <td class="valor-privado">${moeda.valor_total_brl != null ? formatarDinheiro(moeda.valor_total_brl, 'BRL') : '—'}</td>
            
            <td style="position: relative;">
                ${!moeda.simbolo.includes("Caixa") ? `
                <div class="trade-tooltip-container" onmouseenter="preencherTooltipTrades('${moeda.simbolo}')">
                    <span style="border-bottom: 1px dashed var(--text-muted); cursor: help;">
                        ${moeda.preco_medio_brl != null ? formatarDinheiro(moeda.preco_medio_brl, 'BRL') : formatarDinheiro(moeda.preco_medio_usd, 'USD')}
                    </span>
                    <div id="tooltip-trades-${moeda.simbolo}" class="trade-tooltip-content">
                        ${cacheTradesHistorico[moeda.simbolo] || '<div style="text-align:center; padding:10px; color: var(--text-muted);">\u{1F504} Carregando dados da Binance...</div>'}
                    </div>
                </div>
                ` : (moeda.preco_medio_brl != null ? formatarDinheiro(moeda.preco_medio_brl, 'BRL') : formatarDinheiro(moeda.preco_medio_usd, 'USD'))}
                
                ${!moeda.simbolo.includes("Caixa") ? `
                    <span style="margin-left: 8px; cursor: pointer; color: var(--accent-yellow);" onclick="editarPrecoMedio('${moeda.simbolo}')" title="Editar Preco Manual">\u270F\uFE0F</span>
                    <span style="margin-left: 4px; cursor: pointer; font-size: 0.85rem;" onclick="restaurarPrecoMedio('${moeda.simbolo}')" title="Restaurar Preco da Binance">\u{1F504}</span>
                ` : ''}
            </td>

            <td class="text-warning-custom" style="font-weight: 600;">${moeda.preco_atual_brl != null ? formatarDinheiro(moeda.preco_atual_brl, 'BRL') : formatarDinheiro(moeda.preco_atual_usd, 'USD')}</td>
            
            <td class="valor-privado">${formatarDinheiro(moeda.valor_total_brl, 'BRL')}</td>
            
            <td class="${corLucro}">
                ${sinalEmoji} ${moeda.pnl_percent > 0 ? '+' : ''}${moeda.pnl_percent != null ? moeda.pnl_percent.toFixed(2) : '0.00'}% 
                <span class="valor-privado">(${moeda.pnl_reais != null ? formatarDinheiro(moeda.pnl_reais, 'BRL') : formatarDinheiro(moeda.pnl_usd, 'USD')})</span>
                ${!moeda.simbolo.includes("Caixa") && memoriaExtremosPnL[moeda.simbolo] ? `
                <div style="font-size:0.65rem;margin-top:2px;opacity:0.7;display:flex;gap:6px;flex-wrap:wrap;">
                    ${memoriaExtremosPnL[moeda.simbolo].max !== moeda.pnl_reais ? `<span style="color:#0ECB81;">▲ ${formatarDinheiro(memoriaExtremosPnL[moeda.simbolo].max)}</span>` : ''}
                    ${memoriaExtremosPnL[moeda.simbolo].min !== moeda.pnl_reais ? `<span style="color:#F6465D;">▼ ${formatarDinheiro(memoriaExtremosPnL[moeda.simbolo].min)}</span>` : ''}
                </div>` : ''}
            </td>
            
            <td class="${!moeda.simbolo.includes("Caixa") ? sinalColor : 'text-muted-custom'} font-weight-bold" style="font-size: 0.85rem;">
                ${!moeda.simbolo.includes("Caixa") ? iaEmoji + ' ' + sinalText : '-'}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function preencherTooltipTrades(simbolo) {
    const posicionarCaixa = () => {
        const div = document.getElementById(`tooltip-trades-${simbolo}`);
        if (!div) return;
        
        const rect = div.parentElement.getBoundingClientRect();
        
        div.classList.remove('abrir-para-cima', 'abrir-para-baixo');
        
        if (window.innerHeight - rect.bottom < 280) {
            div.classList.add('abrir-para-cima');
        } else {
            div.classList.add('abrir-para-baixo');
        }
    };

    if (cacheTradesHistorico[simbolo] && cacheTradesHistorico[simbolo] !== 'carregando') {
        const div = document.getElementById(`tooltip-trades-${simbolo}`);
        if (div && div.innerHTML !== cacheTradesHistorico[simbolo]) {
            div.innerHTML = cacheTradesHistorico[simbolo];
        }
        posicionarCaixa();
        return;
    }
    
    cacheTradesHistorico[simbolo] = 'carregando';
    
    try {
        const res = await fetch(`/api/trades/${simbolo}`);
        const trades = await res.json();
        
        if (!trades || trades.length === 0) {
            cacheTradesHistorico[simbolo] = '<div style="text-align:center; padding:10px; color: var(--text-muted);">Nenhuma compra encontrada.</div>';
        } else {
            let html = `<div style="font-weight:bold; color:var(--accent-yellow); margin-bottom:8px; border-bottom:1px solid var(--bg-hover); padding-bottom:6px;">Ultimos Aportes (${simbolo})</div>`;
            
            trades.slice(-6).reverse().forEach(t => {
                const dataObj = new Date(t.time * 1000);
                const dataFormatada = dataObj.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'}) + ' ' + dataObj.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
                
                html += `
                <div class="trade-item">
                    <span style="color: var(--text-muted);">${dataFormatada}</span>
                    <span><b style="color: #fff;">${t.qty.toFixed(4)}</b> a <span style="color: var(--accent-green);">R$ ${t.price.toFixed(4)}</span></span>
                </div>`;
            });
            cacheTradesHistorico[simbolo] = html;
        }
        
        const div = document.getElementById(`tooltip-trades-${simbolo}`);
        if (div) div.innerHTML = cacheTradesHistorico[simbolo];
        
        posicionarCaixa();
        
    } catch (e) {
        cacheTradesHistorico[simbolo] = null;
    }
}

async function buscarDados() {
    try {
        const res = await fetch('/api/portfolio', { cache: 'no-store' });
        const data = await res.json();
        
        if (data.ativos) {
            dadosGlobaisAtivos = data.ativos;
            document.getElementById('patrimonioTotal').innerText = formatarDinheiro(data.total, 'BRL');
            
            if (data.dolar) {
                cotacaoAtual = data.dolar;
                document.getElementById('cotacaoDolar').innerText = `R$ ${data.dolar.toFixed(2).replace('.', ',')}`;
            }
            
            const pnlEl = document.getElementById('patrimonioPnl');
            if(data.total_pnl >= 0) {
                pnlEl.innerText = `+${formatarDinheiro(data.total_pnl)}`;
                pnlEl.className = 'text-up';
            } else {
                pnlEl.innerText = `${formatarDinheiro(data.total_pnl)}`;
                pnlEl.className = 'text-down';
            }

            if (data.gatilho_ia) {
                const autoIA = document.getElementById('checkAutoIA').checked;
                
                if (autoIA) {
                    mostrarNotificacaoSistema('Radar Quantitativo', 'Movimentacao institucional (Baleia) detectada no Livro de Ordens!');
                    mostrarToast("Movimentacao abrupta detectada. A IA registrou a anomalia.", "#FCD535");
                }
            }

            for (let moeda of data.ativos) {
                
                if (!moeda.simbolo.includes("Caixa")) {
                    if (!memoriaExtremosPnL[moeda.simbolo]) {
                        memoriaExtremosPnL[moeda.simbolo] = { max: moeda.pnl_reais, min: moeda.pnl_reais };
                    } else {
                        if (moeda.pnl_reais > memoriaExtremosPnL[moeda.simbolo].max) memoriaExtremosPnL[moeda.simbolo].max = moeda.pnl_reais;
                        if (moeda.pnl_reais < memoriaExtremosPnL[moeda.simbolo].min) memoriaExtremosPnL[moeda.simbolo].min = moeda.pnl_reais;
                    }
                }

                const precoAgora = moeda.preco_atual_brl;
                
                if (!moeda.simbolo.includes("Caixa") && moeda.alvo_stop !== null) {
                    if (precoAgora <= moeda.alvo_stop) {
                        if (!alertasDisparadosIA[moeda.simbolo]) {
                            const msgTexto = `STOP ATINGIDO: ${moeda.simbolo} perdeu o suporte de R$ ${formatarNumeroBR(moeda.alvo_stop)}!`;
                            mostrarToast(msgTexto + ' Execute a venda.', '#F6465D');
                            mostrarNotificacaoSistema('ALERTA DE VENDA DA IA!', msgTexto);
                            alertasDisparadosIA[moeda.simbolo] = true; 
                        }
                    } else {
                        alertasDisparadosIA[moeda.simbolo] = false;
                    }
                }

                const precoAntes = precosAnteriores[moeda.simbolo];
                if (precoAntes !== undefined && !moeda.simbolo.includes("Caixa")) {
                    const alertasMoeda = meusAlertas.filter(a => a.simbolo === moeda.simbolo);
                    for (let alerta of alertasMoeda) {
                        let disparou = false;
                        if (alerta.direcao === 'acima' && precoAntes < alerta.preco_alvo && precoAgora >= alerta.preco_alvo) disparou = true;
                        if (alerta.direcao === 'abaixo' && precoAntes > alerta.preco_alvo && precoAgora <= alerta.preco_alvo) disparou = true;

                        if (disparou) {
                            if (!window.alertasJaApitados) window.alertasJaApitados = {};
                            if (window.alertasJaApitados[alerta.id]) continue;
                            window.alertasJaApitados[alerta.id] = true;

                            const cor = alerta.direcao === 'acima' ? '#0ECB81' : '#F6465D';
                            const msgTexto = `ALERTA: ${moeda.simbolo} cruzou o alvo de R$ ${formatarNumeroBR(alerta.preco_alvo)}!`;
                            mostrarToast(msgTexto, cor);
                            mostrarNotificacaoSistema('Alvo Atingido!', msgTexto);
                            
                            if (alerta.repeticao === 'uma_vez') {
                                setTimeout(carregarAlertas, 4000); 
                            }
                        }
                    }
                }
                precosAnteriores[moeda.simbolo] = precoAgora; 
            }
            
            if (!ativoSelecionado) {
                const primeiro = dadosGlobaisAtivos.find(a => !a.simbolo.includes("Caixa"));
                if (primeiro) carregarGrafico(primeiro.simbolo);
            } else {
                carregarGrafico(ativoSelecionado, true);
            }
            
            renderizarTabela();
            renderizarTermometroPnL(data.ativos);
        }
    } catch (error) { console.error("Erro na Binance:", error); }
}

function iniciarMonitoramento() {
    if (timerId) clearInterval(timerId);
    buscarDados(); 
    timerId = setInterval(buscarDados, 3000); 
}

async function pedirRadarIA() {
    const btn = document.getElementById('btnRadar');
    const div = document.getElementById('resultadoIA');
    btn.disabled = true; btn.innerText = "Buscando...";
    div.innerHTML = `<p style="text-align: center; color: var(--text-muted); margin-top: 20px;">Varrendo Top 10 Criptos por Anomalias Matematicas...</p>`;

    try {
        const res = await fetch(`/api/radar/${timeframeAtual}`);
        const data = await res.json();

        if (data.erro) { div.innerHTML = `<span class='text-down'>${data.erro}</span>`; return; }

        let html = `
            <div style="background: rgba(14, 203, 129, 0.1); border-left: 3px solid var(--accent-green); padding: 10px; border-radius: 4px; margin-bottom: 15px;">
                <p style="margin: 0; font-size: 0.9rem; color: var(--text-main);"><strong>Radar:</strong> ${data.visao_radar}</p>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
        `;

        if (data.sugestoes && data.sugestoes.length > 0) {
            data.sugestoes.forEach(s => {
                let corText = "var(--text-muted)";
                if (s.veredito.includes("COMPRA")) corText = "var(--accent-green)";
                if (s.veredito.includes("AGUARD")) corText = "var(--accent-yellow)";

                html += `
                    <div style="border: 1px solid var(--bg-hover); background: var(--bg-dark); border-radius: 6px; padding: 10px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                            <strong style="color: var(--text-main); font-size: 1.1rem;">${s.ativo}</strong>
                            <span style="color: ${corText}; font-weight: bold; font-size: 0.85rem;">${s.veredito}</span>
                        </div>
                        <div style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.4;">${s.justificativa_matematica}</div>
                    </div>
                `;
            });
        } else {
            html += `<p style="text-align: center; color: var(--text-muted);">Nenhuma oportunidade clara detectada.</p>`;
        }
        div.innerHTML = html + `</div>`;
    } catch (e) {
        div.innerHTML = "Erro ao processar Radar da IA.";
    } finally {
        btn.disabled = false; btn.innerText = "Radar de Oportunidades";
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }
    try { inicializarGrafico(); } catch(e) { console.error("Erro Grafico", e); }
    carregarAlertas(); 
    
    document.getElementById('checkAutoIA').addEventListener('change', alternarAutoIA);
    
    document.getElementById('checkLinhasIA').addEventListener('change', () => {
        if (ativoSelecionado && dicasGlobaisIA[ativoSelecionado]) {
            desenharAlvosNoGrafico(dicasGlobaisIA[ativoSelecionado].tp, dicasGlobaisIA[ativoSelecionado].sl);
        } else {
            desenharAlvosNoGrafico(null, null);
        }
    });

    document.getElementById('checkRSI').addEventListener('change', () => {
        if (ativoSelecionado) carregarGrafico(ativoSelecionado, true);
    });

    document.getElementById('checkSupRes').addEventListener('change', () => {
        if (ativoSelecionado) carregarGrafico(ativoSelecionado, true);
    });

    iniciarMonitoramento();
});

function renderizarTermometroPnL(ativos) {
    const container = document.getElementById('termometroPnL');
    if (!container) return;

    const moedas = ativos.filter(a => !a.simbolo.includes('Caixa') && Math.abs(a.pnl_reais) > 0);
    if (!moedas.length) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:8px;font-size:0.85rem;">Sem dados de P&L</div>';
        return;
    }

    moedas.sort((a, b) => b.pnl_reais - a.pnl_reais);
    const maxAbs = Math.max(...moedas.map(m => Math.abs(m.pnl_reais)), 1);

    let html = moedas.map(m => {
        const pct = (Math.abs(m.pnl_reais) / maxAbs) * 100;
        const cor = m.pnl_reais >= 0 ? '#0ECB81' : '#F6465D';
        const sinal = m.pnl_reais >= 0 ? '+' : '';
        const align = m.pnl_reais >= 0 ? 'left:50%;' : 'right:50%;';
        return `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;font-size:0.85rem;">
                <span style="width:48px;font-weight:600;text-align:right;color:var(--text-main);flex-shrink:0;">${m.simbolo}</span>
                <div style="flex:1;height:18px;background:var(--bg-dark);border-radius:4px;overflow:hidden;position:relative;">
                    <div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--bg-hover);z-index:1;"></div>
                    <div style="position:absolute;top:0;bottom:0;${align}width:${pct}%;border-radius:4px;background:${cor};opacity:0.8;transition:width 0.3s;"></div>
                </div>
                <span class="valor-privado" style="width:90px;text-align:right;font-weight:600;color:${cor};flex-shrink:0;">${sinal}${formatarDinheiro(m.pnl_reais)}</span>
            </div>`;
    }).join('');

    container.innerHTML = html;
}
