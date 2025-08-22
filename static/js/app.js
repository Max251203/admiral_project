'use strict';

const App = {
    lobbyWs: null,
    gameWs: null,
    isAuth: document.body.dataset.auth === '1',
    me: {
        id: document.body.dataset.userId || null,
        login: document.body.dataset.login || '',
        avatar: document.body.dataset.avatar || '/static/img/default-avatar.png',
    },
    waitCtx: { active: false, token: null, canceler: null },
    game: {
        id: null,
        state: null,
        myPlayer: null,
        mode: 'none',
        selection: {
            type: 'none',
            piece: null,
            group: [],
            candidates: [],
            validMoves: [],
            specialAttack: null,
        },
        timers: { uiTimer: null },
        shipCounts: {},
        isFinished: false,
        setupPhase: true,
        allShipsPlaced: false,
        selectedShip: null,
        pausesUsed: { short: false, long: false },
    },
    currentInviteToken: null,
    currentFriendRequest: null,
};

const SHIP_TYPES = {
  'БДК':{count:2,rank:18},'Л':{count:2,rank:17},'А':{count:1,rank:16},'КР':{count:6,rank:15},'Ф':{count:6,rank:14},'ЭС':{count:6,rank:13},'СТ':{count:6,rank:12},'ТР':{count:6,rank:11},'ТК':{count:6,rank:10},'Т':{count:6,rank:9},'ТН':{count:1,rank:8},'С':{count:1,rank:7},'ПЛ':{count:1,rank:6},'КРПЛ':{count:1,rank:5},'М':{count:6,rank:4},'СМ':{count:1,rank:3},'АБ':{count:1,rank:2},'ВМБ':{count:2,rank:1}
};

const IMMOBILE_TYPES = ['ВМБ','СМ'];
const CARRIER_TYPES = {'ЭС':'М','ТК':'Т','А':'С'};

function getCookie(name){
  const v = document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
  return v ? decodeURIComponent(v.split('=')[1]) : '';
}

async function api(url, method='GET', data=null, isForm=false){
  const opts = { method, credentials:'same-origin', headers:{} };
  if(method !== 'GET'){
    if(isForm){ opts.body = data; }
    else{ opts.headers['Content-Type'] = 'application/json'; opts.body = data ? JSON.stringify(data) : null; }
    opts.headers['X-CSRFToken'] = getCookie('csrftoken');
  }
  const r = await fetch(url, opts);
  const responseData = await r.json().catch(() => ({}));
  if(!r.ok) {
    const error = new Error('HTTP ' + r.status + ' on ' + url);
    error.response = { status: r.status, data: responseData };
    throw error;
  }
  return responseData;
}

function showNotification(title, message, type = 'info') {
  document.querySelectorAll('.notification').forEach(n => n.remove());
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `<div class="notification-title">${title}</div><div class="notification-message">${message}</div>`;
  document.body.appendChild(notification);
  setTimeout(() => notification.classList.add('show'), 50);
  setTimeout(() => { notification.classList.remove('show'); setTimeout(() => notification.remove(), 300); }, 4000);
}

function showHint(message) {
  document.querySelectorAll('.hint-message').forEach(h => h.remove());
  const hint = document.createElement('div');
  hint.className = 'hint-message';
  hint.textContent = message;
  document.body.appendChild(hint);
  setTimeout(() => hint.remove(), 3000);
}

function showModal(id) { 
  const modal = document.getElementById(id);
  if(modal) modal.style.display = 'flex'; 
}

function closeModal(id) { 
  const modal = document.getElementById(id);
  if(modal) modal.style.display = 'none'; 
}

function showContent(contentType){
  clearAllHighlights();
  const rulesContent = document.getElementById('rulesContent');
  const lobbyContent = document.getElementById('lobbyContent');
  const gameContent = document.getElementById('gameContent');
  
  [rulesContent, lobbyContent, gameContent].forEach(p => p && (p.style.display = 'none'));
  
  if(contentType === 'rules'){ 
    rulesContent.style.display = 'block'; 
  } else if(contentType === 'lobby'){ 
    lobbyContent.style.display = 'block'; 
    activateLobbyTab('pane-quick'); 
    initTabs(); 
    setTimeout(() => { loadUsers(''); loadFriends(); }, 100);
  } else if(contentType === 'game'){ 
    gameContent.style.display = 'block'; 
  }
  
  const msContainer = document.getElementById('msContainer');
  if(msContainer) msContainer.classList.add('flip');
}

function showMenu(){
  clearAllHighlights();
  const msContainer = document.getElementById('msContainer');
  if(msContainer) msContainer.classList.remove('flip');
  disconnectGameWebSocket();
  if(App.game.setupTimer){ clearInterval(App.game.setupTimer); App.game.setupTimer = null; }
}

function clearAllHighlights() {
  document.querySelectorAll('.cell').forEach(cell => {
    cell.classList.remove('selected', 'valid-move', 'group-candidate', 'torpedo-direction', 'air-attack-zone', 'group-selected', 'my-zone', 'enemy-zone');
    cell.removeAttribute('data-torpedo-dir');
  });
  document.querySelectorAll('.group-indicator').forEach(ind => ind.remove());
  App.game.selection = { type: 'none', piece: null, group: [], candidates: [], validMoves: [], specialAttack: null };
}

function activateLobbyTab(paneId){
  const container = document.getElementById('lobbyContent'); 
  if(!container) return;
  const tabbar = container.querySelector('.tabbar'); 
  if(!tabbar) return;
  const tabs = tabbar.querySelectorAll('.tab');
  tabs.forEach(t => t.classList.toggle('active', t.dataset.pane === paneId));
  const panes = container.querySelectorAll('.pane');
  panes.forEach(p => p.classList.toggle('active', p.id === paneId));
}

function renderTopRight(){
  const profileAvatar = document.getElementById('profileAvatar');
  const profileName = document.getElementById('profileName');
  if(profileAvatar && profileName) {
    profileAvatar.src = App.me.avatar || '/static/img/default-avatar.png';
    profileName.textContent = App.isAuth ? (App.me.login || 'Профиль') : 'Войти';
  }
}

function connectLobbyWebSocket() {
    if (App.lobbyWs || !App.isAuth) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/lobby/`;
    
    App.lobbyWs = new WebSocket(wsUrl);

    App.lobbyWs.onopen = () => console.log('Lobby WebSocket connected');
    App.lobbyWs.onclose = () => { 
        App.lobbyWs = null; 
        setTimeout(connectLobbyWebSocket, 5000); 
    };
    App.lobbyWs.onerror = (err) => console.error('Lobby WebSocket error:', err);
    App.lobbyWs.onmessage = handleLobbyWebSocketMessage;
}

function connectGameWebSocket(gameId) {
    disconnectGameWebSocket();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/game/${gameId}/`;
    
    App.gameWs = new WebSocket(wsUrl);

    App.gameWs.onopen = () => console.log('Game WebSocket connected');
    App.gameWs.onclose = () => { 
        App.gameWs = null;
    };
    App.gameWs.onerror = (err) => console.error('Game WebSocket error:', err);
    App.gameWs.onmessage = handleGameWebSocketMessage;
}

function disconnectGameWebSocket() {
    if (App.gameWs) {
        App.gameWs.close();
        App.gameWs = null;
    }
}

function sendGameMessage(type, data) {
    if (App.gameWs && App.gameWs.readyState === WebSocket.OPEN) {
        App.gameWs.send(JSON.stringify({
            type: type,
            data: data
        }));
    }
}

function handleLobbyWebSocketMessage(event) {
    const data = JSON.parse(event.data);
    
    if (data.type === 'game_invite') {
        showGameInviteModal(data.from_user.login, data.token);
    } else if (data.type === 'friend_request') {
        showFriendRequestModal(data.from_user);
    } else if (data.type === 'invite_accepted') {
        hideWaiting();
        startGameByRoomUrl(data.url);
    } else if (data.type === 'match_found') {
        hideWaiting();
        startGameByRoomUrl(data.url);
    } else if (data.type === 'invite_declined') {
        hideWaiting();
        showNotification('Приглашение отклонено', `${data.from_login} отклонил приглашение`, 'warning');
    } else if (data.type === 'friend_request_accepted') {
        showNotification('Запрос принят', `${data.user.login} принял ваш запрос в друзья`, 'success');
        loadFriends();
    } else if (data.type === 'friend_request_declined') {
        showNotification('Запрос отклонен', `Ваш запрос в друзья был отклонен`, 'warning');
    }
}

function addGlobalEventListeners() {
    const startBut = document.getElementById('startBut');
    const rulesBut = document.getElementById('rulesBut');
    const settExit = document.getElementById('settExit');
    const profileBtn = document.getElementById('profileBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userSearch = document.getElementById('userSearch');
    const friendSearch = document.getElementById('friendSearch');
    const showMeBtn = document.getElementById('showMeBtn');
    const quickBtn = document.getElementById('quickBtn');
    const waitCancel = document.getElementById('waitCancel');
    const gameInviteAccept = document.getElementById('gameInviteAccept');
    const gameInviteDecline = document.getElementById('gameInviteDecline');
    const friendRequestAccept = document.getElementById('friendRequestAccept');
    const friendRequestDecline = document.getElementById('friendRequestDecline');
    const shortPauseBtn = document.getElementById('shortPauseBtn');
    const longPauseBtn = document.getElementById('longPauseBtn');
    const cancelPauseBtn = document.getElementById('cancelPauseBtn');
    const pAvatar = document.getElementById('pAvatar');
    const rAvatar = document.getElementById('rAvatar');
    const profileForm = document.getElementById('profileForm');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    
    if(startBut) startBut.addEventListener('click', () => { showContent('lobby'); });
    if(rulesBut) rulesBut.addEventListener('click', () => showContent('rules'));
    
    if(settExit) {
        settExit.addEventListener('click', () => {
            const gameContent = document.getElementById('gameContent');
            const lobbyContent = document.getElementById('lobbyContent');
            const rulesContent = document.getElementById('rulesContent');
            
            if(gameContent && gameContent.style.display === 'block' && App.game.id) {
                const confirmModal = document.createElement('div');
                confirmModal.className = 'modal-backdrop';
                confirmModal.id = 'exitConfirmModal';
                confirmModal.innerHTML = `
                    <div class="modal">
                        <h3 class="modalTitle">Подтверждение</h3>
                        <p style="text-align:center;">Выйти из текущей игры (зачтется как поражение)?</p>
                        <div class="btnRow">
                            <button id="confirmExitBtn" class="menuButs xs danger">Выйти</button>
                            <button id="cancelExitBtn" class="menuButs xs">Отмена</button>
                        </div>
                    </div>`;
                document.body.appendChild(confirmModal);
                confirmModal.style.display = 'flex';
                document.getElementById('confirmExitBtn').addEventListener('click', async () => {
                    confirmModal.style.display='none';
                    try{ await resignGame(); }catch{}
                    document.body.removeChild(confirmModal);
                    showContent('lobby');
                });
                                document.getElementById('cancelExitBtn').addEventListener('click', () => {
                    confirmModal.style.display='none';
                    document.body.removeChild(confirmModal);
                });
            } else {
                showMenu();
            }
        });
    }
    
    if(profileBtn) profileBtn.addEventListener('click', () => App.isAuth ? openProfile() : openAuth());
    
    if(logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try{
                await api('/accounts/api/logout/','POST',{});
                App.isAuth = false;
                App.me.login = '';
                App.me.avatar = '/static/img/default-avatar.png';
                renderTopRight();
                showMenu();
                showNotification('Выход', 'Вы вышли из аккаунта', 'success');
            }catch(e){
                showNotification('Ошибка', 'Не удалось выйти', 'error');
            }
        });
    }
    
    document.querySelectorAll('.modal-close').forEach(x => x.addEventListener('click', () => closeModal(x.dataset.target)));
    
    if(pAvatar) pAvatar.addEventListener('change', () => {
        const f = pAvatar.files && pAvatar.files[0]; 
        if(!f) return;
        const reader = new FileReader(); 
        reader.onload = ev => { 
            const pAvatarPreview = document.getElementById('pAvatarPreview');
            if(pAvatarPreview) pAvatarPreview.src = ev.target.result; 
        }; 
        reader.readAsDataURL(f);
    });
    
    if(rAvatar) rAvatar.addEventListener('change', () => {
        const f = rAvatar.files && rAvatar.files[0]; 
        if(!f) return;
        const reader = new FileReader(); 
        reader.onload = ev => { 
            const rAvatarPreview = document.getElementById('rAvatarPreview');
            if(rAvatarPreview) rAvatarPreview.src = ev.target.result; 
        }; 
        reader.readAsDataURL(f);
    });
    
    if(profileForm) profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(profileForm);
        if(pAvatar.files && pAvatar.files[0]) fd.set('avatar', pAvatar.files[0]);
        try{
            const res = await api('/accounts/api/profile/update/','POST', fd, true);
            if(res.ok){
                if(res.profile){
                    App.me.login = res.profile.login || App.me.login;
                    if(res.profile.avatar) App.me.avatar = res.profile.avatar;
                }
                renderTopRight();
                showNotification('Успех', 'Профиль сохранен', 'success');
                closeModal('profileModal');
            } else {
                showNotification('Ошибка', 'Не удалось сохранить профиль', 'error');
            }
        }catch(err){ 
            let msg = 'Не удалось сохранить профиль';
            if(err.response && err.response.data && err.response.data.errors) {
                msg = Object.entries(err.response.data.errors).map(([key, val]) => `${key}: ${val}`).join(' ');
            }
            showNotification('Ошибка', msg, 'error'); 
        }
    });
    
    if(loginForm) loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(loginForm).entries());
        try{
            const r = await api('/accounts/api/login/','POST', d);
            if(r.ok){
                App.isAuth=true; 
                App.me.id=r.id;
                App.me.login=r.login||d.username; 
                if(r.avatar) App.me.avatar=r.avatar;
                renderTopRight(); 
                closeModal('authModal');
                connectLobbyWebSocket();
                showNotification('Успех', 'Вы успешно вошли в систему', 'success');
            }else {
                showNotification('Ошибка', 'Неверный логин или пароль', 'error');
            }
        }catch(err){ 
            showNotification('Ошибка', 'Ошибка входа в систему', 'error'); 
        }
    });
    
    if(registerForm) registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(registerForm);
        if(rAvatar.files && rAvatar.files[0]) fd.set('avatar', rAvatar.files[0]);
        try{
            const r = await api('/accounts/api/register/','POST', fd, true);
            if(r.ok){
                const loginData = {
                    username: fd.get('username'),
                    password: fd.get('password')
                };
                const r2 = await api('/accounts/api/login/','POST', loginData);
                if(r2.ok){
                    App.isAuth=true; 
                    App.me.id=r2.id;
                    App.me.login=fd.get('login'); 
                    if(r2.avatar) App.me.avatar=r2.avatar;
                    renderTopRight(); 
                    closeModal('authModal');
                    connectLobbyWebSocket();
                    showNotification('Успех', 'Регистрация прошла успешно', 'success');
                }
            }
        }catch(err){ 
            let msg = 'Ошибка регистрации';
            if(err.response && err.response.data) {
                msg = Object.entries(err.response.data).map(([key, val]) => `${key}: ${Array.isArray(val) ? val.join(', ') : val}`).join(' ');
            }
            showNotification('Ошибка', msg, 'error'); 
        }
    });
    
    if(userSearch) userSearch.addEventListener('input', () => loadUsers(userSearch.value.trim()));
    if(friendSearch) friendSearch.addEventListener('input', () => filterFriends(friendSearch.value.trim()));
    if(showMeBtn) showMeBtn.addEventListener('click', () => {
        if(!App.isAuth) return;
        const usersList = document.getElementById('usersList');
        if(!usersList) return;
        const myItem = usersList.querySelector(`[data-login="${App.me.login}"]`);
        if(myItem) {
            myItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            myItem.style.background = 'rgba(255,255,0,.3)'; 
            setTimeout(() => { myItem.style.background = 'rgba(255,255,0,.1)'; }, 2000);
        }
    });
    
    if(quickBtn) quickBtn.addEventListener('click', async () => {
        if(!App.isAuth){ openAuth(); return; }
        try{
            const r = await api('/match/quick/');
            if(r.url){ startGameByRoomUrl(r.url); return; }
            if(r.queued){
                showWaiting('Ищем соперника...', async () => { await api('/match/cancel/'); });
            }
        }catch(err){ 
            showNotification('Ошибка', 'Не удалось начать поиск соперника', 'error'); 
        }
    });
    
    if(waitCancel) waitCancel.addEventListener('click', async () => { 
        try{ 
            if(App.waitCtx.canceler) await App.waitCtx.canceler(); 
        } finally{ 
            hideWaiting(); 
        } 
    });
    
    if(gameInviteAccept) gameInviteAccept.addEventListener('click', async () => {
        if(!App.currentInviteToken) return;
        try { 
            const res = await api(`/match/invite/${App.currentInviteToken}/accept/`, 'POST'); 
            if(res.ok && res.url) { 
                closeModal('gameInviteModal'); 
                App.currentInviteToken = null; 
                startGameByRoomUrl(res.url); 
            } 
        } catch(err) { 
            showNotification('Ошибка', 'Не удалось принять приглашение', 'error'); 
        }
    });
    
    if(gameInviteDecline) gameInviteDecline.addEventListener('click', async () => {
        if(!App.currentInviteToken) return;
        try { 
            await api(`/match/invite/${App.currentInviteToken}/decline/`, 'POST'); 
            closeModal('gameInviteModal'); 
            App.currentInviteToken = null; 
            showNotification('Информация', 'Приглашение отклонено', 'info'); 
        } catch(err) { 
            showNotification('Ошибка', 'Ошибка отклонения приглашения', 'error'); 
        }
    });
    
    if(friendRequestAccept) friendRequestAccept.addEventListener('click', async () => {
        if(!App.currentFriendRequest) return;
        try { 
            await api('/accounts/api/friends/accept/', 'POST', {request_id: App.currentFriendRequest.request_id}); 
            closeModal('friendRequestModal'); 
            App.currentFriendRequest = null; 
            showNotification('Успех', 'Запрос в друзья принят', 'success');
            loadFriends();
        } catch(err) { 
            showNotification('Ошибка', 'Не удалось принять запрос', 'error'); 
        }
    });
    
    if(friendRequestDecline) friendRequestDecline.addEventListener('click', async () => {
        if(!App.currentFriendRequest) return;
        try { 
            await api('/accounts/api/friends/decline/', 'POST', {request_id: App.currentFriendRequest.request_id}); 
            closeModal('friendRequestModal'); 
            App.currentFriendRequest = null; 
            showNotification('Информация', 'Запрос в друзья отклонен', 'info'); 
        } catch(err) { 
            showNotification('Ошибка', 'Ошибка отклонения запроса', 'error'); 
        }
    });
    
    if(shortPauseBtn) {
        shortPauseBtn.addEventListener('click', async () => {
            try {
                sendGameMessage('pause', {type: 'short'});
                closeModal('pauseModal');
                showNotification('Пауза', 'Короткая пауза активирована (1 минута)', 'info');
            } catch(err) {
                showNotification('Ошибка', 'Не удалось активировать паузу: ' + err.message, 'error');
            }
        });
    }
    
    if(longPauseBtn) {
        longPauseBtn.addEventListener('click', async () => {
            try {
                sendGameMessage('pause', {type: 'long'});
                closeModal('pauseModal');
                showNotification('Пауза', 'Длинная пауза активирована (3 минуты)', 'info');
            } catch(err) {
                showNotification('Ошибка', 'Не удалось активировать паузу: ' + err.message, 'error');
            }
        });
    }
    
    if(cancelPauseBtn) {
        cancelPauseBtn.addEventListener('click', () => {
            closeModal('pauseModal');
        });
    }
    
    initTabs();
}

function handleGameWebSocketMessage(event) {
    const data = JSON.parse(event.data);
    
    if (data.type === 'game_state_update') {
        handleGameStateUpdate(data);
    } else if (data.type === 'tick') {
        handleGameTick(data);
    } else if (data.type === 'game_finished') {
        showGameResult(data.winner, data.reason);
    } else if (data.type === 'game_paused') {
        showPauseOverlay(data.duration, data.initiator === App.game.myPlayer);
    } else if (data.type === 'setup_submitted') {
        if (data.status !== 'SETUP') {
            App.game.setupPhase = false;
            createGameUI();
            showNotification('Игра началась!', 'Фаза расстановки завершена', 'success');
        } else {
            showNotification('Ожидание', 'Ожидаем пока соперник расставит свои фишки', 'info');
        }
    } else if (data.type === 'group_candidates') {
        App.game.selection.candidates = data.candidates || [];
        showGroupCandidates();
    } else if (data.type === 'special_attacks') {
        App.game.selection.specialAttack = data.options;
        showSpecialAttacks();
    } else if (data.type === 'error') {
        showNotification('Ошибка', data.message, 'error');
    }
}

function handleGameStateUpdate(data) {
    App.game.state = data.state;
    App.game.myPlayer = data.my_player;
    App.game.isFinished = data.status === 'FINISHED';
    
    if (data.status === 'SETUP') {
        App.game.setupPhase = true;
        App.game.mode = 'setup';
    } else if (data.status.startsWith('TURN_')) {
        App.game.setupPhase = false;
        App.game.mode = data.turn === App.game.myPlayer ? 'my_turn' : 'waiting_turn';
    }
    
    renderGameStatic();
    updateKilledTable();
    
    if (data.result) {
        handleMoveResult(data.result);
    }
    
    if (App.game.isFinished) {
        showGameResult(data.state.winner, data.state.win_reason);
    }
}

function handleGameTick(tickData) {
    if (tickData.finished) {
        App.game.isFinished = true;
        showGameResult(tickData.winner_player, tickData.reason);
        return;
    }
    
    if (tickData.paused) {
        showPauseOverlay(tickData.pause_left, false);
        return;
    } else {
        hidePauseOverlay();
    }
    
    updateTimersFromTick(tickData);
}

function updateTimersFromTick(data) {
    const hudTimer = document.getElementById('hudTimer');
    const hudMyBank = document.getElementById('hudMyBank');
    const hudOpponentBank = document.getElementById('hudOpponentBank');
    
    if (!hudTimer || !hudMyBank || !hudOpponentBank) return;
    
    const myBankMs = App.game.myPlayer === 1 ? data.bank_ms_p1 : data.bank_ms_p2;
    const opponentBankMs = App.game.myPlayer === 1 ? data.bank_ms_p2 : data.bank_ms_p1;
    const myTurnStartTime = App.game.myPlayer === 1 ? data.turn_start_time_p1 : data.turn_start_time_p2;
    
    const myBankSeconds = Math.floor(myBankMs / 1000);
    const opponentBankSeconds = Math.floor(opponentBankMs / 1000);
    
    const myBankMinutes = Math.floor(myBankSeconds / 60);
    const myBankSecondsRem = myBankSeconds % 60;
    hudMyBank.textContent = `${myBankMinutes}:${String(myBankSecondsRem).padStart(2, '0')}`;
    hudMyBank.style.color = myBankSeconds <= 60 ? '#ff5e2c' : '';
    
    const opponentBankMinutes = Math.floor(opponentBankSeconds / 60);
    const opponentBankSecondsRem = opponentBankSeconds % 60;
    hudOpponentBank.textContent = `${opponentBankMinutes}:${String(opponentBankSecondsRem).padStart(2, '0')}`;
    hudOpponentBank.style.color = opponentBankSeconds <= 60 ? '#ff5e2c' : '';
    
    if (data.turn === App.game.myPlayer && myTurnStartTime) {
        const currentTime = Date.now() / 1000;
        const turnElapsed = currentTime - myTurnStartTime;
        const turnLeft = Math.max(0, 30 - Math.floor(turnElapsed));
        
        if (turnLeft > 0) {
            hudTimer.textContent = `${turnLeft}s`;
            hudTimer.style.color = turnLeft <= 10 ? '#ff5e2c' : '';
        } else {
            hudTimer.textContent = 'Банк';
            hudTimer.style.color = '#ff5e2c';
        }
    } else {
        hudTimer.textContent = 'Ход соперника';
        hudTimer.style.color = '#80e4ff';
    }
}

function showGameInviteModal(fromLogin, token) {
    App.currentInviteToken = token;
    const gameInviteText = document.getElementById('gameInviteText');
    if (gameInviteText) {
        gameInviteText.textContent = `Приглашение в игру от ${fromLogin}`;
    }
    showModal('gameInviteModal');
}

function showFriendRequestModal(fromUser) {
    App.currentFriendRequest = fromUser;
    const friendRequestText = document.getElementById('friendRequestText');
    if (friendRequestText) {
        friendRequestText.textContent = `${fromUser.login} хочет добавить вас в друзья`;
    }
    showModal('friendRequestModal');
}

function showWaiting(text, onCancel, token=null){
    const waitText = document.getElementById('waitText');
    if (waitText) waitText.textContent = text || 'Ожидание...';
    App.waitCtx = {active:true, token, canceler:onCancel};
    showModal('waitModal');
}

function hideWaiting(){ 
    closeModal('waitModal'); 
    App.waitCtx = {active:false, token:null, canceler:null}; 
}

function openProfile(){
    if(!App.isAuth){ openAuth(); return; }
    const pLogin = document.getElementById('pLogin');
    const pUsername = document.getElementById('pUsername');
    const pEmail = document.getElementById('pEmail');
    const pAvatarPreview = document.getElementById('pAvatarPreview');
    
    if (pLogin) pLogin.value = App.me.login || '';
    if (pAvatarPreview) pAvatarPreview.src = App.me.avatar || '/static/img/default-avatar.png';
    
    api('/accounts/api/me/').then(me=>{
        if (pUsername) pUsername.value = me.username || '';
        if (pEmail) pEmail.value = me.email || '';
        if (me.avatar) {
            if (pAvatarPreview) pAvatarPreview.src = me.avatar;
            App.me.avatar = me.avatar;
            renderTopRight();
        }
    }).catch(()=>{});
    showModal('profileModal');
}

function openAuth(){ 
    showModal('authModal'); 
}

function initTabs(){
    document.querySelectorAll('.tabbar').forEach(tabbar => {
        const tabs = tabbar.querySelectorAll('.tab');
        const container = tabbar.closest('.modal, .content-pane, #lobbyContent');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const paneId = tab.dataset.pane;
                const panes = container.querySelectorAll('.pane');
                panes.forEach(pane => pane.classList.remove('active'));
                const targetPane = container.querySelector(`#${paneId}`);
                if(targetPane) {
                    targetPane.classList.add('active');
                    if(paneId === 'p-history') setTimeout(loadHistory, 100);
                    if(paneId === 'pane-friends') setTimeout(loadFriends, 100);
                }
            });
        });
    });
}

function ratingValue(u){
    if(typeof u.rating === 'number') return u.rating;
    const wins = u.wins || 0, losses = u.losses || 0;
    return wins*100 - losses*100;
}

async function loadUsers(q){
    const usersList = document.getElementById('usersList');
    if(!usersList) return;
    try{
        const data = await api('/accounts/api/users/?q='+encodeURIComponent(q||''));
        renderUsers(data.items||[]);
    }catch(err){ 
        usersList.innerHTML='<li>Ошибка загрузки</li>'; 
    }
}

function renderUsers(arr){
    const usersList = document.getElementById('usersList');
    if(!usersList) return;
    usersList.innerHTML='';
    
    if(App.isAuth){
        api('/accounts/api/me/').then(me=>{
            const meItem = {
                id: me.id, login: me.login, username: me.username, 
                rating: me.rating_elo || 0, wins: me.wins || 0, losses: me.losses || 0, isMe:true
            };
            const ids = new Set(arr.map(i=>i.id));
            if(!ids.has(meItem.id)) arr.push(meItem);
            arr.sort((a,b) => (ratingValue(b) - ratingValue(a)));
            renderUsersList(arr);
        }).catch(()=>{ 
            arr.sort((a,b) => (ratingValue(b) - ratingValue(a))); 
            renderUsersList(arr); 
        });
    } else {
        arr.sort((a,b) => (ratingValue(b) - ratingValue(a)));
        renderUsersList(arr);
    }
}

function renderUsersList(arr){
    const usersList = document.getElementById('usersList');
    if(!usersList) return;
    usersList.innerHTML='';
    if(arr.length === 0){ usersList.innerHTML='<li>Пусто</li>'; return; }
    
    arr.forEach((u, index) => {
        const isMe = u.isMe || false;
        const rating = ratingValue(u);
        const li = document.createElement('li');
        li.className = isMe ? 'me' : '';
        li.dataset.login = u.login;
        li.innerHTML = `
            <div>
                <strong>#${index + 1} ${u.login}</strong> ${isMe ? '(Вы)' : ''}<br>
                <span class="muted">Рейтинг: ${rating} • Побед: ${u.wins || 0} • Поражений: ${u.losses || 0}</span>
            </div>
            ${!isMe ? `<div style="display:flex;gap:.4rem">
                <button class="menuButs xs" data-invite="${u.id}">Пригласить в игру</button>
                <button class="menuButs xs" data-add="${u.id}" data-login="${u.login}">В друзья</button>
            </div>` : '<div></div>'}`;
        usersList.appendChild(li);
    });
    
    usersList.querySelectorAll('[data-invite]').forEach(btn => btn.addEventListener('click', () => inviteUser(btn.dataset.invite)));
    usersList.querySelectorAll('[data-add]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try{ 
                await api('/accounts/api/friends/add/','POST',{user_id: parseInt(btn.dataset.add)}); 
                showNotification('Успех', 'Запрос в друзья отправлен', 'success');
            }catch(e){ 
                showNotification('Ошибка', 'Не удалось отправить запрос в друзья', 'error'); 
            }
        });
    });
}

async function loadFriends(){
    const friendsList = document.getElementById('friendsList');
    if(!friendsList) return;
    try{
        const data = await api('/accounts/api/friends/');
        const items = data.items || [];
        items.sort((a,b) => (ratingValue(b) - ratingValue(a)));
        friendsList.innerHTML='';
        if(items.length===0){ friendsList.innerHTML='<li>Нет друзей</li>'; return; }
        
        items.forEach((u) => {
            const rating = ratingValue(u);
            const li = document.createElement('li');
            li.innerHTML = `
                <div>
                    <strong>${u.login}</strong><br>
                    <span class="muted">Рейтинг: ${rating} • Побед: ${u.wins || 0} • Поражений: ${u.losses || 0}</span>
                </div>
                <div style="display:flex;gap:.4rem">
                    <button class="menuButs xs" data-invite="${u.id}">Пригласить в игру</button>
                    <button class="menuButs xs danger" data-remove="${u.id}">Удалить</button>
                </div>`;
            friendsList.appendChild(li);
        });
        
        friendsList.querySelectorAll('[data-invite]').forEach(btn => btn.addEventListener('click', () => inviteUser(btn.dataset.invite)));
        friendsList.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', async () => {
            try{ 
                await api(`/accounts/api/friends/remove/${btn.dataset.remove}/`,'POST',{}); 
                loadFriends(); 
                showNotification('Успех', 'Друг удален', 'success'); 
            } catch(e){ 
                showNotification('Ошибка', 'Не удалось удалить друга', 'error'); 
            }
        }));
    }catch(err){ 
        friendsList.innerHTML='<li>Ошибка загрузки</li>'; 
    }
}

async function inviteUser(userId) {
    if(!App.isAuth){ openAuth(); return; }
    try {
        const res = await api(`/match/invite_ajax/${userId}/`, 'POST');
        if(res.ok) {
            showWaiting('Ожидание ответа...', async () => {
                try { await api(`/match/invite/${res.token}/cancel/`, 'POST'); } catch(e) {}
            }, res.token);
        }
    } catch(err) {
        showNotification('Ошибка', 'Не удалось отправить приглашение', 'error');
    }
}

async function loadHistory() {
    try {
        const data = await api('/game/my/');
        const items = data.items || [];
                const historyList = document.getElementById('historyList');
        
        if(!historyList) return;
        
        historyList.innerHTML = '';
        
        if(items.length === 0) {
            historyList.innerHTML = '<li>История пуста</li>';
            return;
        }
        
        items.forEach(game => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div>
                    <strong>Игра с ${game.opponent}</strong><br>
                    <span class="muted">${game.created_at} • ${game.result}</span>
                </div>
                <div class="tag">${game.status}</div>`;
            historyList.appendChild(li);
        });
    } catch(err) {
        const historyList = document.getElementById('historyList');
        if(historyList) {
            historyList.innerHTML = '<li>Ошибка загрузки</li>';
        }
    }
}

function filterFriends(query) {
    const friendsList = document.getElementById('friendsList');
    if (!friendsList) return;
    const items = friendsList.querySelectorAll('li');
    if(!items.length) return;
    query = (query||'').toLowerCase();
    items.forEach(item => {
        const login = (item.querySelector('strong')?.textContent || '').toLowerCase();
        item.style.display = login.includes(query) ? '' : 'none';
    });
}

async function startGameByRoomUrl(url) {
    const code = url.split('/').filter(Boolean).pop();
    
    try {
        const gameData = await api(`/game/by-code/${code}/`);
        App.game.id = gameData.id;
        App.game.state = gameData.state;
        App.game.myPlayer = gameData.my_player;
        App.game.setupPhase = gameData.state.phase === 'SETUP';
        App.game.pausesUsed = { short: false, long: false };
        App.game.selection = { type: 'none', piece: null, group: [], candidates: [], validMoves: [], specialAttack: null };
        App.game.allShipsPlaced = false;
        App.game.selectedShip = null;
        App.game.isFinished = false;
        
        initializeShipCounts();
        showContent('game');
        createGameUI();
        renderGameStatic();
        connectGameWebSocket(App.game.id);
        
        if(App.game.setupPhase) {
            showNotification('Расстановка', 'Разместите все фишки в своей зоне. У вас 15 минут.', 'info');
        }
    } catch(err) {
        showNotification('Ошибка', 'Не удалось открыть игру: ' + err.message, 'error');
    }
}

function initializeShipCounts() {
    App.game.shipCounts = {};
    Object.keys(SHIP_TYPES).forEach(type => { 
        App.game.shipCounts[type] = SHIP_TYPES[type].count; 
    });
}

function createGameUI() {
    const gameContentEl = document.querySelector('.gameContent');
    if(!gameContentEl) return;
    
    gameContentEl.innerHTML = `
        <div class="game-hud">
            ${App.game.setupPhase ? `
                <div class="tag">Расстановка</div>
                <div class="tag">Таймер: <span id="hudTimer">15:00</span></div>
                <button id="autoPlaceBtn" class="menuButs xs">Авто</button>
                <button id="clearPlaceBtn" class="menuButs xs danger">Очистить</button>
                <button id="submitSetupBtn" class="menuButs xs">Готов</button>
            ` : `
                <div class="tag">Ход: <span id="hudTimer">30s</span></div>
                <div class="tag">Мой банк: <span id="hudMyBank">15:00</span></div>
                <div class="tag">Банк соперника: <span id="hudOpponentBank">15:00</span></div>
                <button id="pauseBtn" class="menuButs xs">Пауза</button>
                <button id="resignBtn" class="menuButs xs danger">Сдаться</button>
            `}
        </div>
        <div class="mobile-fleet" id="mobileFleet">
            <div class="mobile-fleet-inner" id="mobileFleetInner"></div>
        </div>
        <div class="side-panel" id="leftPanel">
            <div class="side-panel-inner" id="leftPanelInner"></div>
        </div>
        <div class="board-container">
            <div id="board" class="board"></div>
        </div>
        <div class="side-panel" id="rightPanel">
            <div class="side-panel-inner" id="rightPanelInner"></div>
        </div>
        <div class="killed-section">
            <div class="killed-table-container">
                <table class="killed-table">
                    <thead><tr><th>Тип</th><th>Убито</th><th>Всего</th></tr></thead>
                    <tbody id="killedTableBody"></tbody>
                </table>
            </div>
        </div>
    `;
    
    const autoPlaceBtn = document.getElementById('autoPlaceBtn');
    const clearPlaceBtn = document.getElementById('clearPlaceBtn');
    const submitSetupBtn = document.getElementById('submitSetupBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const resignBtn = document.getElementById('resignBtn');
    const leftPanelInner = document.getElementById('leftPanelInner');
    const rightPanelInner = document.getElementById('rightPanelInner');
    const mobileFleetInner = document.getElementById('mobileFleetInner');
    
    if(autoPlaceBtn) autoPlaceBtn.addEventListener('click', autoSetup);
    if(clearPlaceBtn) clearPlaceBtn.addEventListener('click', clearSetup);
    if(submitSetupBtn) submitSetupBtn.addEventListener('click', submitSetup);
    if(pauseBtn) pauseBtn.addEventListener('click', openPauseModal);
    if(resignBtn) resignBtn.addEventListener('click', openResignModal);
    
    renderFleetPanels(leftPanelInner, rightPanelInner, mobileFleetInner);
    clearBoard();
    fitBoard();
    window.addEventListener('resize', fitBoard);
}

function clearBoard(){
    const boardEl = document.getElementById('board');
    if(!boardEl) return;
    boardEl.innerHTML = '';
    
    for(let r = 0; r < 15; r++){
        for(let c = 0; c < 14; c++){
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.x = c;
            cell.dataset.y = r;
            
            if(App.game.myPlayer === 1) {
                if(r >= 10) cell.classList.add('my-zone');
                else if(r < 5) cell.classList.add('enemy-zone');
            } else {
                if(r < 5) cell.classList.add('my-zone');
                else if(r >= 10) cell.classList.add('enemy-zone');
            }
            
            if(r === 5 || r === 10) cell.style.borderTop = '3px solid #ff0000';
            
            cell.addEventListener('click', handleCellClick);
            boardEl.appendChild(cell);
        }
    }
}

function handleCellClick(e) {
    const cell = e.currentTarget;
    const x = parseInt(cell.dataset.x), y = parseInt(cell.dataset.y);
    
    if(App.game.isFinished) {
        showNotification('Игра завершена', 'Игра уже закончена', 'info');
        return;
    }
    
    if(App.game.setupPhase) {
        handleSetupClick(x, y, cell);
    } else {
        if(App.game.mode !== 'my_turn') {
            showNotification('Ошибка', 'Сейчас не ваш ход', 'error');
            return;
        }
        handleGameClick(x, y, cell);
    }
}

function handleSetupClick(x, y, cell) {
    if(App.game.selectedShip) {
        placeShip(x, y, App.game.selectedShip);
    } else {
        const piece = cell.querySelector('.piece');
        if(piece && parseInt(piece.dataset.owner) === App.game.myPlayer) {
            showHint('Выберите тип фишки для размещения в панели слева или справа');
        } else {
            showHint('Сначала выберите тип фишки в панели');
        }
    }
}

async function handleGameClick(x, y, cell) {
    const piece = cell.querySelector('.piece');
    
    if(App.game.selection.type === 'none' && piece && parseInt(piece.dataset.owner) === App.game.myPlayer) {
        await selectPiece(x, y, piece);
    } else if(App.game.selection.type !== 'none') {
        if(cell.classList.contains('valid-move')) {
            if(App.game.selection.type === 'group') {
                await moveGroup(x, y);
            } else {
                await movePiece(App.game.selection.piece.x, App.game.selection.piece.y, x, y);
            }
        } else if(cell.classList.contains('group-candidate')) {
            await addToGroup(x, y);
        } else if(cell.classList.contains('torpedo-direction')) {
            await handleTorpedoAttack(x, y, cell);
        } else if(cell.classList.contains('air-attack-zone')) {
            await handleAirAttack(x, y);
        } else if(piece && parseInt(piece.dataset.owner) === App.game.myPlayer) {
            await selectPiece(x, y, piece);
        } else {
            clearSelection();
            showHint('Выбор отменен');
        }
    }
}

async function selectPiece(x, y, piece) {
    const pieceType = piece.dataset.kind;
    const ruType = convertFromApiShipType(pieceType);
    
    if(IMMOBILE_TYPES.includes(ruType)) {
        showNotification('Ошибка', 'Эта фишка неподвижна', 'error');
        return;
    }
    
    clearSelection();
    App.game.selection.type = 'piece';
    App.game.selection.piece = {x, y, kind: pieceType};
    
    highlightCell(x, y, 'selected');
    
    const [realX, realY] = uiToReal(x, y);
    sendGameMessage('get_group_candidates', {coord: [realX, realY]});
    sendGameMessage('get_special_attacks', {});
    
    await showValidMoves(x, y, pieceType);
    
    showHint(`Выбрана ${ruType}. Выберите действие`);
}

function showGroupCandidates() {
    if(App.game.selection.candidates.length > 0) {
        App.game.selection.candidates.forEach(coord => {
            const [uiX, uiY] = realToUi(coord[0], coord[1]);
            highlightCell(uiX, uiY, 'group-candidate');
        });
        showHint('Синие фишки - для группы, зеленые - для хода');
    }
}

function showSpecialAttacks() {
    if(!App.game.selection.specialAttack) return;
    
    if(App.game.selection.specialAttack.torpedo.length > 0) {
        App.game.selection.specialAttack.torpedo.forEach(attack => {
            const [uiTkX, uiTkY] = realToUi(attack.tk[0], attack.tk[1]);
            if(App.game.selection.piece && 
               (App.game.selection.piece.x === uiTkX && App.game.selection.piece.y === uiTkY)) {
                showTorpedoDirections(attack);
                showHint('Доступна торпедная атака! Выберите направление стрельбы');
            }
        });
    }
    
    if(App.game.selection.specialAttack.air.length > 0) {
        App.game.selection.specialAttack.air.forEach(attack => {
            const [uiCarrierX, uiCarrierY] = realToUi(attack.carrier[0], attack.carrier[1]);
            if(App.game.selection.piece && 
               (App.game.selection.piece.x === uiCarrierX && App.game.selection.piece.y === uiCarrierY)) {
                showAirAttackZone(attack);
                showHint('Доступна воздушная атака! Кликните на зону атаки');
            }
        });
    }
}

async function addToGroup(x, y) {
    if(!App.game.selection.piece) return;
    
    if(App.game.selection.group.length === 0) {
        App.game.selection.group.push(App.game.selection.piece);
        const cell = getCellElement(App.game.selection.piece.x, App.game.selection.piece.y);
        cell.classList.add('group-selected');
        const indicator = document.createElement('div');
        indicator.className = 'group-indicator';
        cell.appendChild(indicator);
    }
    
    App.game.selection.group.push({x, y});
    App.game.selection.type = 'group';
    
    const cell = getCellElement(x, y);
    cell.classList.remove('group-candidate');
    cell.classList.add('group-selected');
    const indicator = document.createElement('div');
    indicator.className = 'group-indicator';
    cell.appendChild(indicator);
    
    if(App.game.selection.group.length >= 3) {
        document.querySelectorAll('.cell.group-candidate').forEach(cell => {
            cell.classList.remove('group-candidate');
        });
    }
    
    const groupStrength = App.game.selection.group.reduce((sum, coord) => {
        const piece = getCellElement(coord.x, coord.y).querySelector('.piece');
        if(piece) {
            const shipType = convertFromApiShipType(piece.dataset.kind);
            return sum + (SHIP_TYPES[shipType]?.rank || 0);
        }
        return sum;
    }, 0);
    
    showHint(`Группа из ${App.game.selection.group.length} фишек. Сила группы: ${groupStrength}`);
    
    await showGroupMoves();
    
    App.game.selection.piece = null;
    App.game.selection.candidates = [];
}

async function showValidMoves(x, y, pieceType) {
    document.querySelectorAll('.cell.valid-move').forEach(c => c.classList.remove('valid-move'));
    
    const apiType = convertToApiShipType(convertFromApiShipType(pieceType));
    const directions = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    
    if(apiType === 'TK') {
        directions.forEach(dir => {
                        for(let dist = 1; dist <= 2; dist++) {
                const nx = x + dir.dx * dist;
                const ny = y + dir.dy * dist;
                
                if(nx >= 0 && nx < 14 && ny >= 0 && ny < 15) {
                    const cell = getCellElement(nx, ny);
                    const piece = cell.querySelector('.piece');
                    
                    if(!piece || parseInt(piece.dataset.owner) !== App.game.myPlayer) {
                        highlightCell(nx, ny, 'valid-move');
                    }
                    
                    if(piece) break;
                }
            }
        });
    } else {
        directions.forEach(dir => {
            const nx = x + dir.dx;
            const ny = y + dir.dy;
            
            if(nx >= 0 && nx < 14 && ny >= 0 && ny < 15) {
                const cell = getCellElement(nx, ny);
                const piece = cell.querySelector('.piece');
                
                if(!piece || parseInt(piece.dataset.owner) !== App.game.myPlayer) {
                    highlightCell(nx, ny, 'valid-move');
                }
            }
        });
    }
}

async function showGroupMoves() {
    document.querySelectorAll('.cell.valid-move').forEach(cell => cell.classList.remove('valid-move'));
    
    const adjacentCells = new Set();
    
    App.game.selection.group.forEach(piece => {
        const {x, y} = piece;
        const directions = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
        
        directions.forEach(dir => {
            const nx = x + dir.dx;
            const ny = y + dir.dy;
            
            if(nx >= 0 && nx < 14 && ny >= 0 && ny < 15) {
                const isGroupMember = App.game.selection.group.some(p => p.x === nx && p.y === ny);
                if(!isGroupMember) {
                    const cell = getCellElement(nx, ny);
                    const piece = cell.querySelector('.piece');
                    
                    if(!piece || parseInt(piece.dataset.owner) !== App.game.myPlayer) {
                        adjacentCells.add(`${nx},${ny}`);
                    }
                }
            }
        });
    });
    
    adjacentCells.forEach(coord => {
        const [x, y] = coord.split(',').map(Number);
        highlightCell(x, y, 'valid-move');
    });
}

function showTorpedoDirections(attack) {
    const [uiTorpedoX, uiTorpedoY] = realToUi(attack.torpedo[0], attack.torpedo[1]);
    
    attack.directions.forEach(dir => {
        const [dx, dy] = dir;
        let x = uiTorpedoX;
        let y = uiTorpedoY;
        
        for(let i = 1; i <= 7; i++) {
            x += dx;
            y += dy;
            
            if(x >= 0 && x < 14 && y >= 0 && y < 15) {
                const cell = getCellElement(x, y);
                cell.classList.add('torpedo-direction');
                cell.dataset.torpedoDir = `${dx},${dy}`;
                
                const piece = cell.querySelector('.piece');
                if(piece) break;
            } else {
                break;
            }
        }
    });
}

function showAirAttackZone(attack) {
    const direction = attack.direction;
    const [uiPlaneX, uiPlaneY] = realToUi(attack.plane[0], attack.plane[1]);
    let x = uiPlaneX;
    let y = uiPlaneY;
    
    for(let i = 1; i <= 5; i++) {
        y += direction;
        
        if(x >= 0 && x < 14 && y >= 0 && y < 15) {
            const cell = getCellElement(x, y);
            cell.classList.add('air-attack-zone');
        } else {
            break;
        }
    }
}

async function handleTorpedoAttack(x, y, cell) {
    const direction = cell.dataset.torpedoDir.split(',').map(Number);
    const attack = App.game.selection.specialAttack.torpedo[0];
    
    const [realTorpedoX, realTorpedoY] = uiToReal(attack.torpedo[0], attack.torpedo[1]);
    const [realTkX, realTkY] = uiToReal(attack.tk[0], attack.tk[1]);
    
    sendGameMessage('torpedo_attack', {
        torpedo: [realTorpedoX, realTorpedoY],
        tk: [realTkX, realTkY],
        direction: direction
    });
    
    clearSelection();
    showHint('Торпедная атака выполнена');
}

async function handleAirAttack(x, y) {
    const attack = App.game.selection.specialAttack.air[0];
    
    const [realCarrierX, realCarrierY] = uiToReal(attack.carrier[0], attack.carrier[1]);
    const [realPlaneX, realPlaneY] = uiToReal(attack.plane[0], attack.plane[1]);
    
    sendGameMessage('air_attack', {
        carrier: [realCarrierX, realCarrierY],
        plane: [realPlaneX, realPlaneY]
    });
    
    clearSelection();
    showHint('Воздушная атака выполнена');
}

function clearSelection() {
    App.game.selection = { type: 'none', piece: null, group: [], candidates: [], validMoves: [], specialAttack: null };
    document.querySelectorAll('.cell.selected, .cell.valid-move, .cell.group-candidate, .cell.torpedo-direction, .cell.air-attack-zone, .cell.group-selected').forEach(el => {
        el.classList.remove('selected', 'valid-move', 'group-candidate', 'torpedo-direction', 'air-attack-zone', 'group-selected');
        el.removeAttribute('data-torpedo-dir');
    });
    document.querySelectorAll('.group-indicator').forEach(ind => ind.remove());
}

async function movePiece(fx, fy, tx, ty) {
    try {
        const followers = [];
        
        const [realFx, realFy] = uiToReal(fx, fy);
        const [realTx, realTy] = uiToReal(tx, ty);
        
        sendGameMessage('make_move', {
            src: [realFx, realFy],
            dst: [realTx, realTy],
            followers: followers
        });
        
        clearSelection();
        showHint('Ход отправлен');
        App.game.mode = 'waiting_turn';
        
    } catch(err) {
        showNotification('Ошибка', 'Не удалось выполнить ход: ' + err.message, 'error');
        clearSelection();
    }
}

async function moveGroup(toX, toY) {
    if(App.game.selection.group.length === 0) return;
    
    try {
        const leader = App.game.selection.group[0];
        const followers = App.game.selection.group.slice(1).map(p => {
            const [realPx, realPy] = uiToReal(p.x, p.y);
            const directions = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
            for(const dir of directions) {
                const newX = toX + dir.dx;
                const newY = toY + dir.dy;
                if(newX >= 0 && newX < 14 && newY >= 0 && newY < 15) {
                    const [realTx, realTy] = uiToReal(newX, newY);
                    return [realPx, realPy, realTx, realTy];
                }
            }
            const [realTx, realTy] = uiToReal(toX, toY);
            return [realPx, realPy, realTx, realTy];
        });
        
        const [realLx, realLy] = uiToReal(leader.x, leader.y);
        const [realTx, realTy] = uiToReal(toX, toY);
        
        sendGameMessage('make_move', {
            src: [realLx, realLy],
            dst: [realTx, realTy],
            followers: followers
        });
        
        clearSelection();
        showHint('Группа перемещена');
        App.game.mode = 'waiting_turn';
        
    } catch(err) {
        showNotification('Ошибка', 'Не удалось переместить группу: ' + err.message, 'error');
        clearSelection();
    }
}

function handleMoveResult(result) {
    switch(result.event) {
        case 'combat':
            if(result.captures && result.captures.length > 0) {
                showNotification('Бой!', `Уничтожено: ${result.captures.join(', ')}`, 'success');
            }
            if(result.destroyed_own && result.destroyed_own.length > 0) {
                showNotification('Потери', `Потеряно: ${result.destroyed_own.join(', ')}`, 'warning');
            }
            break;
        case 'explosion':
        case 'atomic_explosion':
            showNotification('Взрыв!', `Уничтожено фишек: ${result.captures.length}`, 'warning');
            showExplosionEffect();
            break;
        case 'mine_explosion':
            showNotification('Мина!', 'Ваша фишка подорвалась на мине', 'error');
            break;
        case 'mine_cleared':
            showNotification('Тральщик', 'Мина успешно обезврежена', 'success');
            break;
        case 'tanker_explosion':
            showNotification('Танкер взорвался!', 'Обе фишки уничтожены', 'warning');
            break;
        case 'static_mine_explosion':
            showNotification('Стационарная мина!', 'Фишка уничтожена', 'error');
            break;
        case 'draw':
            showNotification('Ничья', 'Силы равны, фишки обменялись', 'info');
            break;
        default:
            showHint('Ход выполнен. Ход противника');
    }
}

function showExplosionEffect() {
    const explosion = document.createElement('div');
    explosion.className = 'explosion-effect';
    document.body.appendChild(explosion);
    
    setTimeout(() => {
        explosion.remove();
    }, 800);
}

async function placeShip(x, y, shipType) {
    const isMyZone = App.game.myPlayer === 1 ? (y >= 10) : (y < 5);
    
    if(!isMyZone) {
        showNotification('Ошибка', 'Можно расставлять только в своей зоне', 'error');
        return;
    }
    
    if(App.game.shipCounts[shipType] <= 0) {
        showNotification('Ошибка', 'Корабли этого типа закончились', 'error');
        return;
    }
    
    if(getCellElement(x, y).querySelector('.piece')) {
        showNotification('Ошибка', 'Клетка уже занята', 'error');
        return;
    }
    
    try {
        const [realX, realY] = uiToReal(x, y);
        
        sendGameMessage('setup_piece', {
            placements: [{ x: realX, y: realY, kind: convertToApiShipType(shipType) }]
        });
        
        App.game.shipCounts[shipType]--;
        updateShipCounts();
        checkAllShipsPlaced();
        showNotification('Успех', `${shipType} размещен`, 'success');
        
    } catch(err) {
        showNotification('Ошибка', 'Не удалось разместить корабль: ' + err.message, 'error');
    }
}

function renderFleetPanels(leftPanel, rightPanel, mobilePanel) {
    if(!leftPanel || !rightPanel) return;
    
    const shipTypes = Object.keys(SHIP_TYPES);
    const halfIndex = Math.ceil(shipTypes.length / 2);
    
    leftPanel.innerHTML = '';
    rightPanel.innerHTML = '';
    if(mobilePanel) mobilePanel.innerHTML = '';
    
    shipTypes.slice(0, halfIndex).forEach(type => {
        const item = document.createElement('div');
        item.className = 'fleet-item';
        item.dataset.ship = type;
        
        let count;
        if(App.game.setupPhase) {
            count = App.game.shipCounts[type] || 0;
        } else {
            count = 0;
        }
        
        item.innerHTML = `${type} (${count})`;
        
        const carriedType = CARRIER_TYPES[type];
        if(carriedType) {
            item.classList.add('dependent');
            item.title = `Носитель для ${carriedType}`;
        }
        
        if(App.game.setupPhase) {
            if(count <= 0) item.classList.add('depleted');
            else item.addEventListener('click', () => selectShip(type));
        }
        leftPanel.appendChild(item);
        
        if(mobilePanel) {
            const mobileItem = item.cloneNode(true);
            if(App.game.setupPhase && count > 0) {
                mobileItem.addEventListener('click', () => selectShip(type));
            }
            mobilePanel.appendChild(mobileItem);
        }
    });
    
    shipTypes.slice(halfIndex).forEach(type => {
        const item = document.createElement('div');
        item.className = 'fleet-item';
        item.dataset.ship = type;
        
        let count;
        if(App.game.setupPhase) {
            count = App.game.shipCounts[type] || 0;
        } else {
            count = 0;
        }
        
        item.innerHTML = `${type} (${count})`;
        
        if(Object.values(CARRIER_TYPES).includes(type)) {
            item.classList.add('dependent');
            const carrier = Object.keys(CARRIER_TYPES).find(k => CARRIER_TYPES[k] === type);
            item.title = `Переносится ${carrier}`;
        }
        
        if(App.game.setupPhase) {
            if(count <= 0) item.classList.add('depleted');
            else item.addEventListener('click', () => selectShip(type));
        }
        rightPanel.appendChild(item);
        
        if(mobilePanel) {
            const mobileItem = item.cloneNode(true);
            if(App.game.setupPhase && count > 0) {
                mobileItem.addEventListener('click', () => selectShip(type));
            }
            mobilePanel.appendChild(mobileItem);
        }
    });
}

function selectShip(type) {
    if(!App.game.setupPhase) return;
    if(App.game.shipCounts[type] <= 0) {
        showNotification('Ошибка', 'У вас закончились фишки этого типа', 'error');
        return;
    }
    
    document.querySelectorAll('.fleet-item').forEach(item => item.classList.remove('selected'));
    const items = document.querySelectorAll(`[data-ship="${type}"]`);
    items.forEach(item => item.classList.add('selected'));
    
    App.game.selectedShip = type;
    clearSelection();
    showHint(`Выбран ${type}. Кликните на клетку в своей зоне для размещения`);
}

function checkAllShipsPlaced() {
    let allPlaced = true;
    Object.keys(SHIP_TYPES).forEach(type => {
        if(App.game.shipCounts[type] > 0) allPlaced = false;
    });
    
    if(allPlaced && !App.game.allShipsPlaced) {
        App.game.allShipsPlaced = true;
        setTimeout(() => {
            const submitBtn = document.getElementById('submitSetupBtn');
            if(submitBtn) {
                submitBtn.style.background = 'rgba(39, 232, 129, 0.3)';
                submitBtn.style.borderColor = '#27e881';
                showNotification('Готово', 'Все фишки расставлены! Нажмите "Готов"', 'success');
            }
        }, 500);
    }
}

async function clearSetup() {
    try {
        sendGameMessage('clear_setup', {});
        initializeShipCounts();
        updateShipCounts();
        App.game.allShipsPlaced = false;
        showNotification('Успех', 'Расстановка очищена', 'success');
    } catch(err) {
        showNotification('Ошибка', 'Не удалось очистить расстановку: ' + err.message, 'error');
    }
}

async function submitSetup() {
    let allPlaced = true;
    Object.keys(SHIP_TYPES).forEach(type => {
        if(App.game.shipCounts[type] > 0) allPlaced = false;
    });
    
    if(!allPlaced) {
        showNotification('Ошибка', 'Сначала нужно разместить все фишки', 'error');
        return;
    }
    
    try {
        sendGameMessage('submit_setup', {});
        showNotification('Готово', 'Расстановка подтверждена', 'success');
    } catch(err) {
        showNotification('Ошибка', 'Не удалось подтвердить расстановку: ' + err.message, 'error');
    }
}

async function autoSetup() {
    if(!App.game.id) return;
    
    try {
        sendGameMessage('auto_setup', {});
        Object.keys(App.game.shipCounts).forEach(type => App.game.shipCounts[type] = 0);
        updateShipCounts();
        showNotification('Успех', 'Автоматическая расстановка завершена', 'success');
        App.game.allShipsPlaced = true;
        checkAllShipsPlaced();
    } catch(err) {
        showNotification('Ошибка', 'Ошибка автоматической расстановки: ' + err.message, 'error');
    }
}

function convertToApiShipType(t) {
    const map = {
        'БДК':'BDK','КР':'KR','А':'A','С':'S','ТН':'TN','Л':'L','ЭС':'ES','М':'M','СМ':'SM','Ф':'F','ТК':'TK','Т':'T','ТР':'TR','СТ':'ST','ПЛ':'PL','КРПЛ':'KRPL','АБ':'AB','ВМБ':'VMB'
    };
    return map[t] || t;
}

function convertFromApiShipType(t) {
    const map = {
        'BDK':'БДК','KR':'КР','A':'А','S':'С','TN':'ТН','L':'Л','ES':'ЭС','M':'М','SM':'СМ','F':'Ф','TK':'ТК','T':'Т','TR':'ТР','ST':'СТ','PL':'ПЛ','KRPL':'КРПЛ','AB':'АБ','VMB':'ВМБ'
    };
    return map[t] || t;
}

function updateShipCounts() {
    Object.keys(SHIP_TYPES).forEach(type => {
        document.querySelectorAll(`[data-ship="${type}"]`).forEach(item => {
            let count;
            if(App.game.setupPhase) {
                count = App.game.shipCounts[type] || 0;
            } else {
                count = 0;
            }
            
            item.innerHTML = `${type} (${count})`;
            if(App.game.setupPhase) {
                if(count <= 0) {
                    item.classList.add('depleted');
                } else {
                    item.classList.remove('depleted');
                }
            }
        });
    });
}

function getCellElement(x, y) {
    return document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
}

function highlightCell(x, y, cls) {
    const cell = getCellElement(x, y);
    if(cell) cell.classList.add(cls);
}

function getShipClass(apiType) {
    const ruType = convertFromApiShipType(apiType);
    return `kind${ruType}`;
}

function uiToReal(x, y) {
    if(App.game.myPlayer === 2) {
        return [x, 14 - y];
    }
    return [x, y];
}

function realToUi(x, y) {
    if(App.game.myPlayer === 2) {
        return [x, 14 - y];
    }
    return [x, y];
}

function renderGameStatic() {
    const state = App.game.state || {};
    const boardEl = document.getElementById('board');
    if(!boardEl) return;
    
    document.querySelectorAll('.piece').forEach(piece => piece.remove());
    
    const board = state.board || {};
    
    Object.keys(board).forEach(coordKey => {
        const [realX, realY] = coordKey.split(',').map(Number);
        const [uiX, uiY] = realToUi(realX, realY);
        const cell = getCellElement(uiX, uiY);
        const pieceData = board[coordKey];
        
        if(cell && pieceData) {
            const piece = document.createElement('span');
            piece.className = `piece owner${pieceData.owner} ${getShipClass(pieceData.kind)}`;
            piece.textContent = convertFromApiShipType(pieceData.kind);
            piece.dataset.kind = pieceData.kind;
            piece.dataset.owner = pieceData.owner;
            
            if(!pieceData.alive) {
                piece.classList.add('destroyed');
            }
            
            cell.appendChild(piece);
        }
    });
    
    fitBoard();
    updateKilledTable();
    
    if(!App.game.setupPhase) {
        renderFleetPanels(
            document.getElementById('leftPanelInner'),
            document.getElementById('rightPanelInner'),
            document.getElementById('mobileFleetInner')
        );
    }
}

function fitBoard(){
    const parent = document.querySelector('.board-container');
    const board = document.getElementById('board');
    if(!parent || !board) return;
    
    const r = parent.getBoundingClientRect();
    let cellSize;
    
    if(window.innerWidth <= 600) {
        const availableWidth = r.width - 32;
        const availableHeight = r.height - 32;
        const cellSizeByWidth = Math.floor(availableWidth / 14);
        const cellSizeByHeight = Math.floor(availableHeight / 15);
        cellSize = Math.min(cellSizeByWidth, cellSizeByHeight, 25);
    } else {
        cellSize = Math.floor(Math.min(r.width/14, r.height/15) * 0.95);
    }
    
    const boardWidth = cellSize * 14;
    const boardHeight = cellSize * 15;
    
    board.style.width = boardWidth + 'px';
    board.style.height = boardHeight + 'px';
    board.style.left = '50%';
    board.style.top = '50%';
    board.style.transform = 'translate(-50%, -50%)';
    
    board.querySelectorAll('.piece').forEach(p => {
        let fontSize = Math.max(8, Math.floor(cellSize * 0.35));
        
        const textLength = p.textContent.length;
        if(textLength > 2) {
            fontSize = Math.max(6, Math.floor(cellSize * 0.25));
        }
        
        p.style.fontSize = fontSize + 'px';
    });
}

function updateKilledTable() {
    const killedTableBody = document.getElementById('killedTableBody');
    if(!killedTableBody) return;
    
    api(`/game/killed/${App.game.id}/`).then(data => {
        const items = data.items || [];
        killedTableBody.innerHTML = '';
        
        if(items.length === 0) {
            killedTableBody.innerHTML = '<tr><td colspan="3">Нет данных</td></tr>';
            return;
        }
        
        items.forEach(item => {
            const ruType = convertFromApiShipType(item.piece);
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${ruType}</td><td>${item.killed}</td><td>${SHIP_TYPES[ruType]?.count || '-'}</td>`;
            killedTableBody.appendChild(tr);
        });
    }).catch(() => {
        killedTableBody.innerHTML = '<tr><td colspan="3">Ошибка загрузки</td></tr>';
    });
}

function showPauseOverlay(seconds, isInitiator) {
    const pauseModalOverlay = document.getElementById('pauseModalOverlay');
    const pauseTimer = document.getElementById('pauseTimer');
    const pauseControls = document.getElementById('pauseControls');
    const pauseInfo = document.getElementById('pauseInfo');
    
    if(pauseModalOverlay) {
        pauseModalOverlay.style.display = 'flex';
        
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        
        if(pauseTimer) {
            pauseTimer.textContent = `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
        
        if(pauseControls) {
            pauseControls.style.display = isInitiator ? 'block' : 'none';
        }
        
        if(pauseInfo) {
            pauseInfo.textContent = isInitiator ? 'Вы поставили игру на паузу' : 'Соперник поставил игру на паузу';
        }
        
        const cancelPauseBtn2 = document.getElementById('cancelPauseBtn2');
        if(cancelPauseBtn2) {
            cancelPauseBtn2.onclick = async () => {
                try {
                    sendGameMessage('cancel_pause', {});
                    hidePauseOverlay();
                    showNotification('Пауза снята', 'Игра продолжается', 'success');
                } catch(err) {
                    showNotification('Ошибка', 'Не удалось снять паузу: ' + err.message, 'error');
                }
            };
        }
    }
}

function hidePauseOverlay() {
    const pauseModalOverlay = document.getElementById('pauseModalOverlay');
    if(pauseModalOverlay) {
        pauseModalOverlay.style.display = 'none';
    }
}

function openPauseModal() {
    if(App.game.mode !== 'my_turn') {
        showNotification('Ошибка', 'Пауза доступна только в свой ход', 'error');
        return;
    }
    
    const shortPauseBtn = document.getElementById('shortPauseBtn');
    const longPauseBtn = document.getElementById('longPauseBtn');
    
    if(shortPauseBtn) shortPauseBtn.disabled = App.game.pausesUsed.short;
    if(longPauseBtn) longPauseBtn.disabled = App.game.pausesUsed.long;
    
    showModal('pauseModal');
}

function openResignModal() {
    const resignModal = document.createElement('div');
    resignModal.className = 'modal-backdrop';
    resignModal.id = 'resignConfirmModal';
    resignModal.innerHTML = `
        <div class="modal">
            <h3 class="modalTitle">Подтверждение</h3>
            <p style="text-align:center;margin:1rem 0;">Вы уверены, что хотите сдаться? Это будет засчитано как поражение.</p>
            <div class="btnRow">
                <button id="confirmResignBtn" class="menuButs xs danger">Сдаться</button>
                <button id="cancelResignBtn" class="menuButs xs">Отмена</button>
            </div>
        </div>`;
    
    document.body.appendChild(resignModal);
    resignModal.style.display = 'flex';
    
    document.getElementById('confirmResignBtn').addEventListener('click', async () => {
        resignModal.style.display = 'none';
        await resignGame();
        document.body.removeChild(resignModal);
    });
    
    document.getElementById('cancelResignBtn').addEventListener('click', () => {
        resignModal.style.display = 'none';
        document.body.removeChild(resignModal);
    });
}

async function resignGame() {
    try {
        sendGameMessage('resign', {});
        showNotification('Игра завершена', 'Вы сдались', 'info');
        App.game.isFinished = true;
    } catch(err) {
        showNotification('Ошибка', 'Не удалось сдаться: ' + err.message, 'error');
    }
}

function showGameResult(winner, reason) {
    App.game.isFinished = true;
    
    const isWinner = (winner === App.game.myPlayer);
    const resultTitle = document.getElementById('resultTitle');
    const resultDetails = document.getElementById('resultDetails');
    const ratingChange = document.getElementById('ratingChange');
    const gameResultModal = document.getElementById('gameResultModal');
    const gameResultExit = document.getElementById('gameResultExit');
    
    if(resultTitle) {
        resultTitle.textContent = isWinner ? 'Победа!' : 'Поражение';
        resultTitle.className = `result-title ${isWinner ? 'victory' : 'defeat'}`;
    }
    
    const reasons = {
        'bases_destroyed': 'Уничтожены военно-морские базы',
                'no_mobile_pieces': 'Уничтожены все движущиеся корабли',
        'time': 'Закончилось время',
        'resign': isWinner ? 'Противник сдался' : 'Вы сдались'
    };
    
    if(resultDetails) {
        resultDetails.innerHTML = `<p>${reasons[reason] || 'Игра завершена'}</p>`;
    }
    
    if(ratingChange) {
        ratingChange.textContent = isWinner ? 'Рейтинг: +100 очков' : 'Рейтинг: -100 очков';
        ratingChange.className = `rating-change ${isWinner ? 'positive' : 'negative'}`;
    }
    
    if(gameResultModal) {
        gameResultModal.style.display = 'flex';
    }
    
    if(gameResultExit) {
        gameResultExit.onclick = () => {
            gameResultModal.style.display = 'none';
            showContent('lobby');
            setTimeout(() => {
                loadUsers('');
                loadFriends();
            }, 100);
        };
    }
}

function init() {
    renderTopRight();
    addGlobalEventListeners();
    if (App.isAuth) {
        connectLobbyWebSocket();
    }
    
    const gameId = new URLSearchParams(window.location.search).get('game');
    if(gameId) {
        startGameByRoomUrl(`/game/r/${gameId}/`);
    }
}

if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}