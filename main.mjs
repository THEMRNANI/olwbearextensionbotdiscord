// Main entry point for the Owlbear extension - GitHub Pages version v3
// Using ES Modules

import OBR from "@owlbear-rodeo/sdk";

let socket = null;
let isConnected = false;
let tokens = new Map();
let selectedTokenId = null;
let botTokens = new Set();
let hiddenZones = new Map();
let mapInfo = { gridSize: 150, gridUnit: 'm', width: 0, height: 0 };

// UI Elements
let connectBtn, serverUrlInput, connectionStatus;
let tokensSection, tokensList, zonesSection, zonesList;
let selectedSection, distancesList, logContainer, addZoneBtn;
let copyIdBtn, botCheckbox, selectedIdSpan;

function initUI() {
    connectBtn = document.getElementById('connect-btn');
    serverUrlInput = document.getElementById('server-url');
    connectionStatus = document.getElementById('connection-status');
    tokensSection = document.getElementById('tokens-section');
    tokensList = document.getElementById('tokens-list');
    zonesSection = document.getElementById('hidden-zones-section');
    zonesList = document.getElementById('zones-list');
    selectedSection = document.getElementById('selected-token-section');
    distancesList = document.getElementById('distances-list');
    logContainer = document.getElementById('log-container');
    addZoneBtn = document.getElementById('add-zone-btn');
    copyIdBtn = document.getElementById('copy-id-btn');
    botCheckbox = document.getElementById('bot-checkbox');
    selectedIdSpan = document.getElementById('selected-id');

    // Load saved server URL
    const savedUrl = localStorage.getItem('discordBridge_serverUrl');
    if (savedUrl) {
        serverUrlInput.value = savedUrl;
    }

    // Event listeners
    connectBtn.addEventListener('click', () => {
        console.log('Botão Conectar clicado');
        log('Botão clicado...', 'info');
        handleConnect();
    });
    addZoneBtn.addEventListener('click', handleAddZone);
    copyIdBtn.addEventListener('click', handleCopyId);
    botCheckbox.addEventListener('change', handleBotToggle);

    log('v4 - UI inicializada', 'info');
}

// ========== Connection ==========
async function handleConnect() {
    log('Iniciando handleConnect...', 'info');

    if (isConnected) {
        disconnect();
        return;
    }

    const serverUrl = serverUrlInput.value.trim();
    if (!serverUrl) {
        log('❌ Cole a URL do ngrok!', 'error');
        return;
    }

    log(`Tentando conectar a: ${serverUrl}`, 'info');
    localStorage.setItem('discordBridge_serverUrl', serverUrl);

    updateConnectionUI('connecting');
    connectBtn.textContent = 'Conectando...';
    connectBtn.disabled = true;

    try {
        await connect(serverUrl);
    } catch (error) {
        log(`❌ Falha: ${error.message}`, 'error');
        console.error(error);
        updateConnectionUI('disconnected');
        connectBtn.textContent = 'Conectar';
        connectBtn.disabled = false;
    }
}

function connect(serverUrl) {
    return new Promise((resolve, reject) => {
        try {
            if (typeof window.io === 'undefined') {
                throw new Error('Socket.IO não carregou (window.io undefined)');
            }

            log('Iniciando socket...', 'info');
            socket = window.io(serverUrl, {
                query: { type: 'owlbear' },
                reconnection: true,
                reconnectionAttempts: 10,
                reconnectionDelay: 1000,
                transports: ['websocket', 'polling'],
            });

            socket.on('connect', () => {
                isConnected = true;
                updateConnectionUI('connected');
                connectBtn.textContent = 'Desconectar';
                connectBtn.disabled = false;
                tokensSection.classList.remove('hidden');
                zonesSection.classList.remove('hidden');
                log('Conectado!', 'success');
                socket.emit('sync:request', {});
                resolve();
            });

            socket.on('disconnect', () => {
                isConnected = false;
                updateConnectionUI('disconnected');
                connectBtn.textContent = 'Conectar';
                connectBtn.disabled = false;
                log('Desconectado', 'warning');
            });

            socket.on('connect_error', (error) => {
                log(`Erro: ${error.message}`, 'error');
                reject(error);
            });

            socket.on('owlbear:token:move', async (data) => {
                log(`Move: ${data.direction} ${data.distance}`, 'info');
                await moveToken(data.tokenId, data.direction, data.distance);
            });

            socket.on('sync:response', (data) => {
                if (data.tokens) {
                    data.tokens.forEach(t => tokens.set(t.id, t));
                    updateTokensList();
                }
                if (data.hiddenZones) {
                    data.hiddenZones.forEach(z => hiddenZones.set(z.id, z));
                    updateZonesList();
                }
                if (data.mapInfo) {
                    mapInfo = data.mapInfo;
                }
            });

            setTimeout(() => {
                if (!isConnected) {
                    reject(new Error('Timeout'));
                }
            }, 10000);

        } catch (error) {
            reject(error);
        }
    });
}

function disconnect() {
    if (socket) {
        socket.disconnect();
        socket = null;
        isConnected = false;
        updateConnectionUI('disconnected');
        connectBtn.textContent = 'Conectar';
    }
}

function emit(event, data) {
    if (socket && isConnected) {
        socket.emit(event, data);
    }
}

// ========== OBR Integration ==========
async function initOBR() {
    log('Iniciando OBR...', 'info');

    OBR.onReady(async () => {
        log('OBR pronto!', 'success');

        OBR.scene.items.onChange(async (items) => {
            await processItems(items);
        });

        OBR.player.onChange(async () => {
            const selection = await OBR.player.getSelection();
            if (selection && selection.length > 0) {
                const newSelectedId = selection[0];
                if (newSelectedId !== selectedTokenId) {
                    selectedTokenId = newSelectedId;
                    onTokenSelected(newSelectedId);
                }
            }
        });

        try {
            const dpi = await OBR.scene.grid.getDpi();
            const scale = await OBR.scene.grid.getScale();
            mapInfo.gridSize = dpi;
            mapInfo.gridUnit = scale?.parsed?.unit || 'm';
        } catch (e) { }

        const items = await OBR.scene.items.getItems();
        await processItems(items);
    });
}

async function processItems(items) {
    const characterItems = items.filter(
        item => item.layer === 'CHARACTER' || item.type === 'IMAGE'
    );

    const newTokens = new Map();

    for (const item of characterItems) {
        const token = {
            id: item.id,
            name: item.name || item.text?.plainText || 'Token',
            position: item.position,
            size: Math.max(item.scale?.x || 1, item.scale?.y || 1) * (item.image?.width || 100),
            hidden: item.visible === false,
            controllerId: item.metadata?.controllerId || '',
            isBot: botTokens.has(item.id),
        };
        newTokens.set(item.id, token);

        const oldToken = tokens.get(item.id);
        if (oldToken && (oldToken.position.x !== token.position.x || oldToken.position.y !== token.position.y)) {
            emit('token:move', { tokenId: token.id, position: token.position });
        }
    }

    tokens = newTokens;
    updateTokensList();

    if (selectedTokenId && tokens.has(selectedTokenId)) {
        updateSelectedToken(tokens.get(selectedTokenId));
    }
}

function onTokenSelected(tokenId) {
    const token = tokens.get(tokenId);
    if (token) {
        emit('token:select', { tokenId: token.id, playerId: 'owlbear' });
        updateSelectedToken(token);
    }
}

async function moveToken(tokenId, direction, distance) {
    const token = tokens.get(tokenId);
    if (!token) return;

    let dpi = 150;
    try {
        dpi = await OBR.scene.grid.getDpi();
    } catch (e) { }

    const moveDistance = distance * dpi;

    const directionMap = {
        norte: { x: 0, y: -1 },
        sul: { x: 0, y: 1 },
        leste: { x: 1, y: 0 },
        oeste: { x: -1, y: 0 },
        nordeste: { x: 1, y: -1 },
        sudeste: { x: 1, y: 1 },
        sudoeste: { x: -1, y: 1 },
        noroeste: { x: -1, y: -1 },
    };

    const dir = directionMap[direction] || { x: 0, y: 0 };
    const normalizer = Math.sqrt(dir.x * dir.x + dir.y * dir.y) || 1;

    const newPosition = {
        x: token.position.x + (dir.x / normalizer) * moveDistance,
        y: token.position.y + (dir.y / normalizer) * moveDistance,
    };

    await OBR.scene.items.updateItems([tokenId], (items) => {
        for (const item of items) {
            item.position = newPosition;
        }
    });
}

// ========== Hidden Zones ==========
async function handleAddZone() {
    try {
        const viewport = await OBR.viewport.getPosition();
        const zoneId = `zone_${Date.now()}`;

        const shape = OBR.buildShape()
            .width(200)
            .height(200)
            .shapeType('RECTANGLE')
            .fillColor('#FFAA00')
            .fillOpacity(0.2)
            .strokeColor('#FFAA00')
            .strokeOpacity(0.8)
            .strokeWidth(2)
            .position(viewport)
            .layer('DRAWING')
            .name('Zona Escondida')
            .metadata({ hiddenZone: true })
            .build();

        await OBR.scene.items.addItems([shape]);

        const zoneData = {
            id: shape.id,
            bounds: { x: viewport.x, y: viewport.y, width: 200, height: 200 },
        };
        hiddenZones.set(shape.id, zoneData);
        emit('zone:hidden:add', zoneData);
        updateZonesList();

        log('Zona criada!', 'success');
    } catch (error) {
        log(`Erro zona: ${error.message}`, 'error');
    }
}

// ========== UI Updates ==========
function updateConnectionUI(status) {
    connectionStatus.className = `status ${status}`;
    const textMap = {
        connected: 'Conectado',
        disconnected: 'Desconectado',
        connecting: 'Conectando...',
    };
    connectionStatus.querySelector('.text').textContent = textMap[status] || status;
}

function updateTokensList() {
    const selected = selectedTokenId ? tokens.get(selectedTokenId) : null;

    tokensList.innerHTML = Array.from(tokens.values()).map(token => `
    <div class="token-item ${selected?.id === token.id ? 'selected' : ''}" data-id="${token.id}">
      <span class="name">${token.name}</span>
      <div>
        ${token.isBot ? '<span class="bot-badge">🤖</span>' : ''}
        ${token.hidden ? '<span class="hidden-badge">🙈</span>' : ''}
      </div>
    </div>
  `).join('');

    tokensList.querySelectorAll('.token-item').forEach(el => {
        el.addEventListener('click', async () => {
            const tokenId = el.dataset.id;
            try {
                await OBR.player.select([tokenId]);
            } catch (e) {
                log('Erro ao selecionar', 'error');
            }
        });
    });
}

function updateZonesList() {
    zonesList.innerHTML = Array.from(hiddenZones.values()).map(zone => `
    <div class="zone-item" data-id="${zone.id}">
      <span>Zona ${zone.id.slice(0, 8)}...</span>
      <button class="small-btn remove-zone-btn" data-id="${zone.id}">🗑️</button>
    </div>
  `).join('');

    zonesList.querySelectorAll('.remove-zone-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const zoneId = btn.dataset.id;
            try {
                await OBR.scene.items.deleteItems([zoneId]);
            } catch (e) { }
            hiddenZones.delete(zoneId);
            emit('zone:hidden:remove', { zoneId });
            updateZonesList();
            log('Zona removida', 'info');
        });
    });
}

function updateSelectedToken(token) {
    if (!token) {
        selectedSection.classList.add('hidden');
        return;
    }

    selectedSection.classList.remove('hidden');
    document.getElementById('selected-name').textContent = token.name;
    selectedIdSpan.textContent = token.id;
    document.getElementById('selected-position').textContent =
        `(${Math.round(token.position.x)}, ${Math.round(token.position.y)})`;
    document.getElementById('selected-size').textContent = Math.round(token.size);

    botCheckbox.checked = botTokens.has(token.id);

    const distances = {};
    for (const [id, otherToken] of tokens) {
        if (id !== token.id) {
            const dx = otherToken.position.x - token.position.x;
            const dy = otherToken.position.y - token.position.y;
            const pixelDistance = Math.sqrt(dx * dx + dy * dy);
            distances[id] = Math.round(pixelDistance / mapInfo.gridSize);
        }
    }

    distancesList.innerHTML = Object.entries(distances).map(([tokenId, distance]) => {
        const otherToken = tokens.get(tokenId);
        return `
      <div class="distance-item">
        <span>${otherToken?.name || tokenId}</span>
        <span class="distance">${distance} □</span>
      </div>
    `;
    }).join('');
}

function handleCopyId() {
    if (selectedTokenId) {
        navigator.clipboard.writeText(selectedTokenId).then(() => {
            copyIdBtn.classList.add('copy-success');
            copyIdBtn.textContent = '✅';
            setTimeout(() => {
                copyIdBtn.classList.remove('copy-success');
                copyIdBtn.textContent = '📋';
            }, 1500);
            log(`ID copiado!`, 'success');
        });
    }
}

function handleBotToggle() {
    if (!selectedTokenId) return;

    if (botCheckbox.checked) {
        botTokens.add(selectedTokenId);
        emit('bot:register', {
            tokenId: selectedTokenId,
            name: tokens.get(selectedTokenId)?.name || 'Bot'
        });
        log(`🤖 Marcado como Bot`, 'success');
    } else {
        botTokens.delete(selectedTokenId);
        emit('bot:unregister', { tokenId: selectedTokenId });
        log(`Desmarcado Bot`, 'info');
    }

    const token = tokens.get(selectedTokenId);
    if (token) {
        token.isBot = botCheckbox.checked;
        updateTokensList();
    }
}

function log(message, type = 'info') {
    if (!logContainer) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContainer.insertBefore(entry, logContainer.firstChild);

    while (logContainer.children.length > 30) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

// ========== Initialize ==========
initUI();
initOBR();
