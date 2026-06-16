var tvChart = null;
var candleSeries = null;
var linhaPrecoMedio = null; 
var linhaTP = null;
var linhaSL = null;
var linhaSuporte = null;
var linhaResistencia = null;
var miniChart = null;
var miniSeries = null;

var rsiChart = null;
var rsiSeriesLine = null; 

function calcularRSI(dados, period = 14) {
    let rsiData = [];
    if (dados.length <= period) return rsiData;
    
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        let diff = dados[i].close - dados[i-1].close;
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    for (let i = 0; i < period; i++) {
        rsiData.push({ time: dados[i].time, value: 50 });
    }
    
    for (let i = period; i < dados.length; i++) {
        if (i > period) {
            let diff = dados[i].close - dados[i-1].close;
            let currentGain = diff >= 0 ? diff : 0;
            let currentLoss = diff < 0 ? -diff : 0;
            avgGain = (avgGain * (period - 1) + currentGain) / period;
            avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
        }
        let rs = avgLoss === 0 ? 0 : avgGain / avgLoss;
        let rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
        rsiData.push({ time: dados[i].time, value: rsi });
    }
    return rsiData;
}

function inicializarGrafico() {
    const containerVelas = document.getElementById('graficoVelas');
    const wrapperVelas = document.getElementById('graficoWrapper');
    
    tvChart = LightweightCharts.createChart(containerVelas, {
        layout: { background: { type: 'solid', color: '#1e2329' }, textColor: '#848E9C' },
        grid: { vertLines: { color: '#2b3139' }, horzLines: { color: '#2b3139' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#2b3139' },
        timeScale: { 
            borderColor: '#2b3139', 
            timeVisible: true, 
            visible: true,
            rightOffset: 15
        }
    });

    candleSeries = tvChart.addCandlestickSeries({
        upColor: '#0ECB81', downColor: '#F6465D', borderVisible: false,
        wickUpColor: '#0ECB81', wickDownColor: '#F6465D'
    });

    const containerRSI = document.getElementById('graficoRSI');
    rsiChart = LightweightCharts.createChart(containerRSI, {
        layout: { background: { type: 'solid', color: '#1e2329' }, textColor: '#848E9C' },
        grid: { vertLines: { color: '#2b3139' }, horzLines: { visible: false } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#2b3139', scaleMargins: { top: 0.1, bottom: 0.1 }, visible: true, borderVisible: false },
        timeScale: { 
            borderColor: '#2b3139', 
            timeVisible: true, 
            visible: true, 
            borderVisible: false,
            rightOffset: 15
        }, 
        handleScroll: true, 
        handleScale: true
    });

    rsiSeriesLine = rsiChart.addLineSeries({
        color: '#b28dff', lineWidth: 2,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    rsiSeriesLine.createPriceLine({ price: 70, color: 'rgba(246, 70, 93, 0.5)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: 'OB' });
    rsiSeriesLine.createPriceLine({ price: 30, color: 'rgba(14, 203, 129, 0.5)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: 'OS' });

    let isSyncingLeft = false;
    let isSyncingRight = false;

    tvChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (isSyncingLeft || !range) return;
        const rsiWrapper = document.getElementById('rsiWrapper');
        if (!rsiWrapper || rsiWrapper.style.display === 'none') return;
        
        isSyncingRight = true;
        rsiChart.timeScale().setVisibleLogicalRange(range);
        isSyncingRight = false;
    });

    rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (isSyncingRight || !range) return; 
        
        isSyncingLeft = true;
        tvChart.timeScale().setVisibleLogicalRange(range);
        isSyncingLeft = false;
    });

    tvChart.subscribeCrosshairMove((param) => {
        const regua = document.getElementById('reguaBinance');
        const modoRegua = document.getElementById('modoRegua').value; 
        const ativo = dadosGlobaisAtivos.find(a => a.simbolo === ativoSelecionado);
        
        let precoReferencia = precoAtualAtivo;
        let textoReferencia = 'Preco Atual (Variacao da Moeda)';

        if (modoRegua === 'medio' && ativo && ativo.preco_medio_brl > 0) {
            precoReferencia = ativo.preco_medio_brl;
            textoReferencia = 'Preco Medio (Seu P&L)';
        }

        if (!param.point || !param.time || !precoReferencia) {
            regua.style.display = 'none'; 
            return;
        }

        const precoHover = candleSeries.coordinateToPrice(param.point.y);
        const diferencaPreco = precoHover - precoReferencia;
        const diferencaPct = (diferencaPreco / precoReferencia) * 100;
        
        let valorExibido = diferencaPreco; 
        if (modoRegua === 'medio' && ativo) valorExibido = diferencaPreco * ativo.quantidade; 
        
        const corHex = diferencaPct >= 0 ? '#0ECB81' : '#F6465D';
        const sinal = diferencaPct >= 0 ? '+' : '';
        
        regua.innerHTML = `
            <div style="color: var(--accent-yellow); margin-bottom: 4px; font-size: 0.75rem; font-weight: bold; border-bottom: 1px solid #2b3139; padding-bottom: 4px;">
                Ref: ${textoReferencia}
            </div>
            <div style="color: #EAECEF; margin-bottom: 4px; margin-top: 4px;">
                Alvo: <strong>R$ ${formatarNumeroBR(precoHover)}</strong>
            </div>
            <div style="color: ${corHex}; font-weight: bold;">
                ${sinal}${diferencaPct.toFixed(2)}% <br>
                <span style="font-weight: normal; font-size: 0.8rem;">
                    (R$ ${sinal}${formatarNumeroBR(valorExibido)})
                </span>
            </div>
        `;
        
        regua.style.borderColor = corHex;
        regua.style.transform = param.point.x < 150 ? 'translate(20px, 10px)' : 'translate(calc(-100% - 20px), 10px)'; 
        regua.style.left = param.point.x + 'px';
        regua.style.top = param.point.y + 'px';
        regua.style.display = 'block';
    });

    const rsiWrapper = document.getElementById('rsiWrapper');
    new ResizeObserver(entries => {
        if (entries.length === 0) return;
        const entry = entries[0];
        if (entry.target === wrapperVelas) tvChart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
        if (entry.target === rsiWrapper) rsiChart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
    }).observe(wrapperVelas);
    new ResizeObserver(entries => {
        if (entries.length === 0) return;
        rsiChart.applyOptions({ width: entries[0].contentRect.width, height: entries[0].contentRect.height });
    }).observe(rsiWrapper);
}

function mudarTimeframe(tf) {
    timeframeAtual = tf;
    document.getElementById('legendTimeframe').innerText = `(${tf})`; 
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('tf-active'));
    document.getElementById('btn-tf-' + tf).classList.add('tf-active');
    if (ativoSelecionado) carregarGrafico(ativoSelecionado);
}

async function carregarGrafico(simbolo, atualizacaoSilenciosa = false) {
    if (!tvChart || !rsiChart) return;

    if (!atualizacaoSilenciosa) {
        if (linhaTP) { candleSeries.removePriceLine(linhaTP); linhaTP = null; }
        if (linhaSL) { candleSeries.removePriceLine(linhaSL); linhaSL = null; }
        valoresAtuaisAlvos = { tp: null, sl: null }; 
    }

    ativoSelecionado = simbolo;
    document.getElementById('tituloGrafico').innerText = `${simbolo}/BRL`;
    document.getElementById('legendTicker').innerText = `${simbolo}/BRL`;
    
    const ativo = dadosGlobaisAtivos.find(a => a.simbolo === simbolo);
    if(ativo) {
        precoAtualAtivo = ativo.preco_atual_brl;
        document.getElementById('precoAtualGrafico').innerText = `R$ ${formatarNumeroBR(precoAtualAtivo)}`;
        document.getElementById('precoAtualGrafico').className = ativo.pnl_percent >= 0 ? 'text-up' : 'text-down';

        let precisao = 2; let mMove = 0.01;
        if (precoAtualAtivo < 0.00001) { precisao = 8; mMove = 0.00000001; }
        else if (precoAtualAtivo < 0.001) { precisao = 6; mMove = 0.000001; }
        else if (precoAtualAtivo < 1) { precisao = 4; mMove = 0.0001; }

        tvChart.applyOptions({ localization: { priceFormatter: price => price.toFixed(precisao) } });
        candleSeries.applyOptions({ priceFormat: { type: 'price', precision: precisao, minMove: mMove } });
    }

    try {
        const res = await fetch(`/api/historico_ativo/${simbolo}/${timeframeAtual}`);
        const data = await res.json();
        
        if (data.error || !Array.isArray(data)) return; 
        
        const tvData = data.map(d => ({
            time: d.x / 1000, open: d.y[0], high: d.y[1], low: d.y[2], close: d.y[3]
        })).sort((a, b) => a.time - b.time);
        
        let rangeLogicoSalvo = null;
        if (atualizacaoSilenciosa) {
            rangeLogicoSalvo = tvChart.timeScale().getVisibleLogicalRange();
        }

        candleSeries.setData(tvData);

        if (linhaSuporte) { candleSeries.removePriceLine(linhaSuporte); linhaSuporte = null; }
        if (linhaResistencia) { candleSeries.removePriceLine(linhaResistencia); linhaResistencia = null; }

        const checkSupRes = document.getElementById('checkSupRes') ? document.getElementById('checkSupRes').checked : true;

        if (checkSupRes && tvData.length >= 14) {
            const ultimas14 = tvData.slice(-14);
            const fundosOrdenados = ultimas14.map(c => c.low).sort((a, b) => a - b);
            const precoSuporte = (fundosOrdenados[0] + fundosOrdenados[1] + (fundosOrdenados[2] || fundosOrdenados[1])) / Math.min(3, fundosOrdenados.length);
            const toposOrdenados = ultimas14.map(c => c.high).sort((a, b) => b - a);
            const precoResistencia = (toposOrdenados[0] + toposOrdenados[1] + (toposOrdenados[2] || toposOrdenados[1])) / Math.min(3, toposOrdenados.length);

            linhaSuporte = candleSeries.createPriceLine({ price: precoSuporte, color: 'rgba(14, 203, 129, 0.4)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: 'Sup (Zona)' });
            linhaResistencia = candleSeries.createPriceLine({ price: precoResistencia, color: 'rgba(246, 70, 93, 0.4)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: 'Res (Zona)' });
        }

        const checkRSI = document.getElementById('checkRSI') ? document.getElementById('checkRSI').checked : false;
        const rsiWrapper = document.getElementById('rsiWrapper');

        if (checkRSI && tvData.length > 14) {
            const rsiData = calcularRSI(tvData, 14);
            rsiWrapper.style.display = 'block';
            tvChart.applyOptions({ timeScale: { visible: false } });
            rsiSeriesLine.setData(rsiData);
        } else {
            rsiWrapper.style.display = 'none';
            tvChart.applyOptions({ timeScale: { visible: true } });
            rsiSeriesLine.setData([]); 
        }

        if (atualizacaoSilenciosa && rangeLogicoSalvo) {
            tvChart.timeScale().setVisibleLogicalRange(rangeLogicoSalvo);
            if (checkRSI && rsiWrapper.style.display !== 'none') {
                rsiChart.timeScale().setVisibleLogicalRange(rangeLogicoSalvo);
            }
        } else if (!atualizacaoSilenciosa) {
            tvChart.priceScale('right').applyOptions({ autoScale: true }); 
            
            setTimeout(() => {
                const totalCandles = tvData.length;
                const velasMostrar = Math.min(totalCandles, 100);
                
                tvChart.timeScale().setVisibleLogicalRange({
                    from: totalCandles - velasMostrar,
                    to: totalCandles + 15 
                });
                
                if(checkRSI && rsiWrapper.style.display !== 'none') {
                    rsiChart.timeScale().setVisibleLogicalRange(tvChart.timeScale().getVisibleLogicalRange());
                }
            }, 10);
            
            renderizarTabela(); 
            if (dicasGlobaisIA[simbolo]) desenharAlvosNoGrafico(dicasGlobaisIA[simbolo].tp, dicasGlobaisIA[simbolo].sl);
        }

        function atualizarLegendaUI(candle) {
            if (!candle) return;
            document.getElementById('legendOpen').innerText = formatarNumeroBR(candle.open);
            document.getElementById('legendHigh').innerText = formatarNumeroBR(candle.high);
            document.getElementById('legendLow').innerText = formatarNumeroBR(candle.low);
            document.getElementById('legendClose').innerText = formatarNumeroBR(candle.close);
            
            const diferenca = candle.close - candle.open;
            const pctChange = ((diferenca / candle.open) * 100).toFixed(2);
            const elChange = document.getElementById('legendChange');
            
            elChange.innerText = `(${diferenca >= 0 ? '+' : ''}${pctChange}%)`;
            elChange.style.color = diferenca >= 0 ? '#0ECB81' : '#F6465D';
        }

        function atualizarLegendaRSI(rsi) {
            if (!rsi) return;
            document.getElementById('legendRSI').innerText = rsi.value.toFixed(2);
        }

        const ultimaVela = tvData[tvData.length - 1];
        if (ultimaVela) atualizarLegendaUI(ultimaVela);
        if (checkRSI && tvData.length > 14) {
             const rsiData = rsiSeriesLine.data();
             if(rsiData.length > 0) atualizarLegendaRSI(rsiData[rsiData.length-1]);
        }

        tvChart.subscribeCrosshairMove((param) => {
            if (param.time) {
                const candleHover = tvData.find(c => c.time === param.time);
                if (candleHover) atualizarLegendaUI(candleHover);
                
                if (checkRSI && rsiSeriesLine) {
                    const rsiHover = rsiSeriesLine.data().find(r => r.time === param.time);
                    if(rsiHover) atualizarLegendaRSI(rsiHover);
                }
            } else if (ultimaVela) {
                atualizarLegendaUI(ultimaVela);
                if (checkRSI && tvData.length > 14) {
                    const rsiData = rsiSeriesLine.data();
                    if(rsiData.length > 0) atualizarLegendaRSI(rsiData[rsiData.length-1]);
                }
            }
        });

        rsiChart.subscribeCrosshairMove((param) => {
             if (param.time) {
                if (checkRSI && rsiSeriesLine) {
                    const rsiHover = rsiSeriesLine.data().find(r => r.time === param.time);
                    if(rsiHover) atualizarLegendaRSI(rsiHover);
                }
                const candleHover = tvData.find(c => c.time === param.time);
                if (candleHover) atualizarLegendaUI(candleHover);
            }
        });

        try {
            const resTrades = await fetch(`/api/trades/${simbolo}`);
            const trades = await resTrades.json();
            
            if (trades.length > 0) {
                const tfSegundos = { '1m': 60, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }[timeframeAtual] || 86400;
                const tradesAgrupados = {};
                
                trades.forEach(t => {
                    const candleTime = Math.floor(t.time / tfSegundos) * tfSegundos;
                    if (!tradesAgrupados[candleTime]) tradesAgrupados[candleTime] = { time: candleTime, qty: 0 };
                    tradesAgrupados[candleTime].qty += t.qty;
                });

                const markers = Object.values(tradesAgrupados).map(grupo => ({
                    time: grupo.time, position: 'belowBar', color: '#0ECB81', shape: 'arrowUp', text: `+${grupo.qty.toFixed(4)}` 
                })).sort((a,b) => a.time - b.time);
                
                candleSeries.setMarkers(markers);
            } else {
                candleSeries.setMarkers([]); 
            }
        } catch (e) { }

        if (linhaPrecoMedio) { candleSeries.removePriceLine(linhaPrecoMedio); linhaPrecoMedio = null; }
        if (ativo && ativo.preco_medio_brl > 0) {
            linhaPrecoMedio = candleSeries.createPriceLine({ price: ativo.preco_medio_brl, color: '#FCD535', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: 'Medio', });
        }
        
    } catch (e) { console.error("Erro no grafico:", e); }
}

function desenharAlvosNoGrafico(tp, sl) {
    if (!candleSeries) return;
    const exibir = document.getElementById('checkLinhasIA').checked;

    if (linhaTP) { candleSeries.removePriceLine(linhaTP); linhaTP = null; }
    if (linhaSL) { candleSeries.removePriceLine(linhaSL); linhaSL = null; }

    if (!exibir) { valoresAtuaisAlvos = { tp: null, sl: null }; return; }

    if (tp && tp !== 'N/A') {
        linhaTP = candleSeries.createPriceLine({ price: parseFloat(tp), color: '#0ecb81', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: 'ALVO PROFIT', });
    }

    if (sl && sl !== 'N/A') {
        linhaSL = candleSeries.createPriceLine({ price: parseFloat(sl), color: '#f6465d', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: 'TRAILING STOP', });
    }
    
    valoresAtuaisAlvos.tp = tp;
    valoresAtuaisAlvos.sl = sl;
}
