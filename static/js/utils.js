function tocarBeep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        function playTone(freq, startTime, duration) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
            gain.gain.setValueAtTime(0.2, ctx.currentTime + startTime);
            osc.start(ctx.currentTime + startTime);
            gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + startTime + duration);
            osc.stop(ctx.currentTime + startTime + duration);
        }
        playTone(880, 0, 0.4);        
        playTone(1046.50, 0.15, 0.8); 
    } catch(e) {}
}

function mostrarToast(mensagem, cor = 'var(--accent-yellow)') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.borderLeftColor = cor;
    toast.innerHTML = `
        <div>${mensagem}</div>
        <div class="toast-close" onclick="this.parentElement.remove()">X</div>
    `;
    container.appendChild(toast);
    tocarBeep();
    setTimeout(() => toast.remove(), 10000); 
}

function mostrarNotificacaoSistema(titulo, mensagem) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
        const notificacao = new Notification(titulo, {
            body: mensagem,
            icon: 'https://cdn-icons-png.flaticon.com/512/2933/2933116.png' 
        });
        notificacao.onclick = function() {
            window.focus();
            this.close();
        };
    }
}

function formatarDinheiro(valor, moeda = 'BRL') {
    if (valor == null || isNaN(valor)) return 'R$ 0,00';
    let casas = 2;
    const abs = Math.abs(valor);
    if (abs < 0.0001 && abs > 0) casas = 8;
    else if (abs < 0.01) casas = 6;
    else if (abs < 1) casas = 4;
    try {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency', currency: moeda === 'BRL' ? 'BRL' : 'USD',
            minimumFractionDigits: casas, maximumFractionDigits: casas,
        }).format(valor);
    } catch(e) {
        return (moeda === 'BRL' ? 'R$ ' : '$ ') + valor.toFixed(casas);
    }
}

function formatarNumeroBR(valor) {
    if (valor == null || isNaN(valor)) return '0,00';
    return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

function alternarPrivacidade() {
    document.body.classList.toggle('modo-privado');
    const btn = document.getElementById('btnPrivacidade');
    btn.innerText = document.body.classList.contains('modo-privado') ? '[Mostrar]' : '[Ocultar]';
}
