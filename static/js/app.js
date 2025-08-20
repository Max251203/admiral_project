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
  if(!r.ok) throw new Error('HTTP '+r.status+' '+url);
  const ct = r.headers.get('content-type')||'';
  if(ct.includes('application/json')) return await r.json();
  return {};
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

const SHIP_TYPES = {
  'БДК':{count:2,rank:18},'Л':{count:2,rank:17},'А':{count:1,rank:16},'КР':{count:6,rank:15},'Ф':{count:6,rank:14},'ЭС':{count:6,rank:13},'СТ':{count:6,rank:12},'ТР':{count:6,rank:11},'ТК':{count:6,rank:10},'Т':{count:6,rank:9},'ТН':{count:1,rank:8},'С':{count:1,rank:7},'ПЛ':{count:1,rank:6},'КРПЛ':{count:1,rank:5},'М':{count:6,rank:4},'СМ':{count:1,rank:3},'АБ':{count:1,rank:2},'ВМБ':{count:2,rank:1}
};

const IMMOBILE_TYPES = ['ВМБ','СМ'];
const CARRIER_TYPES = {'ЭС':'М','ТК':'Т','А':'С'};

const App = {
  isAuth: document.body.dataset.auth === '1',
  meLogin: document.body.dataset.login || '',
  meAvatar: document.body.dataset.avatar || '/static/img/avatar_stub.png',
  waitCtx: { active:false, token:null, canceler:null },
  game: { 
    id: null, state: null, myPlayer: null, pollTimer: null,
    selectedPiece: null, selectedGroup: [], setupPhase: true, 
    shipCounts: {}, pausesUsed: { short: false, long: false },
    setupTimer: null, setupDeadline: null, allShipsPlaced: false,
    pendingAttack: null, moveMode: 'normal', setupSubmitted: false,
    turnStartTime: null, bankTimeUsed: 0, selectedShip: null,
    groupCandidates: [], specialAttacks: null, carriedPieces: [],
    moveSelectionActive: false,
    myTurnLeft: 30,
    myBankLeft: 900,
    opponentBankLeft: 900
  }
};

const msContainer = document.getElementById('msContainer');
const settings = document.getElementById('settings');
const settExit = document.getElementById('settExit');
const startBut = document.getElementById('startBut');
const rulesBut = document.getElementById('rulesBut');
const rulesContent = document.getElementById('rulesContent');
const lobbyContent = document.getElementById('lobbyContent');
const gameContent = document.getElementById('gameContent');
const profileBtn = document.getElementById('profileBtn');
const logoutBtn = document.getElementById('logoutBtn');
const profileAvatar = document.getElementById('profileAvatar');
const profileName = document.getElementById('profileName');
const authModal = document.getElementById('authModal');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const profileModal = document.getElementById('profileModal');
const profileForm = document.getElementById('profileForm');
const pLogin = document.getElementById('pLogin');
const pUsername = document.getElementById('pUsername');
const pEmail = document.getElementById('pEmail');
const pAvatar = document.getElementById('pAvatar');
const pAvatarPreview = document.getElementById('pAvatarPreview');
const quickBtn = document.getElementById('quickBtn');
const usersList = document.getElementById('usersList');
const friendsList = document.getElementById('friendsList');
const userSearch = document.getElementById('userSearch');
const friendSearch = document.getElementById('friendSearch');
const showMeBtn = document.getElementById('showMeBtn');
const inviteModal = document.getElementById('inviteModal');
const inviteText = document.getElementById('inviteText');
const inviteAccept = document.getElementById('inviteAccept');
const inviteDecline = document.getElementById('inviteDecline');
const waitModal = document.getElementById('waitModal');
const waitText = document.getElementById('waitText');
const waitCancel = document.getElementById('waitCancel');
const waitOpponentModal = document.getElementById('waitOpponentModal');
const pauseModal = document.getElementById('pauseModal');
const shortPauseBtn = document.getElementById('shortPauseBtn');
const longPauseBtn = document.getElementById('longPauseBtn');
const cancelPauseBtn = document.getElementById('cancelPauseBtn');
const pauseModalOverlay = document.getElementById('pauseModalOverlay');
const pauseTimer = document.getElementById('pauseTimer');
const pauseInfo = document.getElementById('pauseInfo');
const pauseControls = document.getElementById('pauseControls');
const gameResultModal = document.getElementById('gameResultModal');
const gameResultExit = document.getElementById('gameResultExit');
const resultTitle = document.getElementById('resultTitle');
const resultDetails = document.getElementById('resultDetails');
const ratingChange = document.getElementById('ratingChange');

function showContent(contentType){
  clearAllHighlights();
  [rulesContent, lobbyContent, gameContent].forEach(p => p && (p.style.display = 'none'));
  if(contentType === 'rules'){ rulesContent.style.display = 'block'; }
  else if(contentType === 'lobby'){ lobbyContent.style.display = 'block'; activateLobbyTab('pane-quick'); initTabs(); }
  else if(contentType === 'game'){ gameContent.style.display = 'block'; }
  msContainer.classList.add('flip');
}

function clearAllHighlights() {
  document.querySelectorAll('.cell').forEach(cell => {
    cell.classList.remove('selected', 'valid-move', 'group-candidate', 'torpedo-direction', 'air-attack-zone', 'group-selected', 'my-zone', 'enemy-zone');
    cell.removeAttribute('data-torpedo-dir');
  });
  document.querySelectorAll('.group-indicator').forEach(ind => ind.remove());
  App.game.moveSelectionActive = false;
}

function showMenu(){
  clearAllHighlights();
  msContainer.classList.remove('flip');
  if(App.game.pollTimer){ clearInterval(App.game.pollTimer); App.game.pollTimer = null; }
  if(App.game.setupTimer){ clearInterval(App.game.setupTimer); App.game.setupTimer = null; }
}

function activateLobbyTab(paneId){
  const container = document.getElementById('lobbyContent'); if(!container) return;
  const tabbar = container.querySelector('.tabbar'); if(!tabbar) return;
  const tabs = tabbar.querySelectorAll('.tab');
  tabs.forEach(t => t.classList.toggle('active', t.dataset.pane === paneId));
  const panes = container.querySelectorAll('.pane');
  panes.forEach(p => p.classList.toggle('active', p.id === paneId));
}

function renderTopRight(){
  if(profileAvatar && profileName) {
    profileAvatar.src = App.meAvatar || '/static/img/avatar_stub.png';
    profileName.textContent = App.isAuth ? (App.meLogin || 'Профиль') : 'Войти';
  }
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
      
      if(r >= 10) {
        cell.classList.add('my-zone');
      } else if(r < 5) {
        cell.classList.add('enemy-zone');
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
  
  if(pauseModalOverlay && pauseModalOverlay.style.display === 'flex') {
    showNotification('Игра на паузе', 'Дождитесь окончания паузы', 'warning');
    return;
  }
  
  if(App.game.setupPhase) {
    handleSetupClick(x, y, cell);
  } else {
    if(App.game.state && App.game.state.turn !== App.game.myPlayer) {
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
  
  if(cell.classList.contains('torpedo-direction')) {
    await executeTorpedoAttack(x, y);
    return;
  }
  
  if(cell.classList.contains('air-attack-zone')) {
    await executeAirAttack(x, y);
    return;
  }
  
  if(App.game.moveSelectionActive) {
    if(App.game.selectedPiece && App.game.selectedPiece.x === x && App.game.selectedPiece.y === y) {
      clearSelection();
      showHint('Выбор отменен');
      return;
    }
    
    if(cell.classList.contains('valid-move')) {
      if(App.game.selectedPiece) {
        await movePiece(App.game.selectedPiece.x, App.game.selectedPiece.y, x, y);
      } else if(App.game.selectedGroup.length > 0) {
        await moveGroup(x, y);
      }
      return;
    }
    
    if(cell.classList.contains('group-candidate')) {
      await addToGroup(x, y);
      return;
    }
    
    if(piece && parseInt(piece.dataset.owner) === App.game.myPlayer) {
      clearSelectionVisuals();
      await selectPiece(x, y, piece);
      return;
    }
    
    clearSelection();
    showHint('Выбор отменен');
    return;
  }
  
  if(piece && parseInt(piece.dataset.owner) === App.game.myPlayer) {
    await selectPiece(x, y, piece);
  } else if(piece && parseInt(piece.dataset.owner) !== App.game.myPlayer) {
    showHint('Это фишка противника');
  } else {
    showHint('Выберите свою фишку для хода');
  }
}

function clearSelectionVisuals() {
  document.querySelectorAll('.cell').forEach(cell => {
    cell.classList.remove('selected', 'valid-move', 'group-candidate', 'torpedo-direction', 'air-attack-zone', 'group-selected');
    cell.removeAttribute('data-torpedo-dir');
  });
  document.querySelectorAll('.group-indicator').forEach(ind => ind.remove());
}

function clearSelection() {
  App.game.selectedPiece = null;
  App.game.groupCandidates = [];
  App.game.moveSelectionActive = false;
  clearSelectionVisuals();
}

function clearGroupSelection() {
  document.querySelectorAll('.cell.group-selected').forEach(cell => {
    cell.classList.remove('group-selected');
  });
  document.querySelectorAll('.group-indicator').forEach(ind => ind.remove());
  App.game.selectedGroup = [];
}

async function selectPiece(x, y, piece) {
  const pieceType = piece.dataset.kind;
  
  if(IMMOBILE_TYPES.includes(convertFromApiShipType(pieceType))) {
    showNotification('Ошибка', 'Эта фишка неподвижна', 'error');
    return;
  }
  
  App.game.moveSelectionActive = true;
  
  try {
    const [realX, realY] = uiToReal(x, y);
    const response = await api(`/game/group_candidates/${App.game.id}/`, 'POST', {coord: [realX, realY]});
    App.game.groupCandidates = response.candidates || [];
  } catch(e) {
    App.game.groupCandidates = [];
  }
  
  App.game.selectedPiece = {x, y, kind: pieceType};
  highlightCell(x, y, 'selected');
  
  if(App.game.groupCandidates.length > 0) {
    App.game.groupCandidates.forEach(coord => {
      highlightCell(coord[0], coord[1], 'group-candidate');
    });
    showHint(`Выбрана ${convertFromApiShipType(pieceType)}. Кликните на мигающие фишки для группы или выберите ход`);
  } else {
    showHint(`Выбрана ${convertFromApiShipType(pieceType)}. Выберите клетку для перемещения`);
  }
  
  await showValidMoves(x, y, pieceType);
  await checkSpecialAttacks();
}

async function placeShip(x, y, shipType) {
  if(y < 10) {
    showNotification('Ошибка', 'Можно расставлять только в своей зоне (нижняя область)', 'error');
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
    const res = await api(`/game/setup/${App.game.id}/`, 'POST', {
      placements: [{ x, y, kind: convertToApiShipType(shipType) }]
    });
    
    if(res.ok && res.state) {
      App.game.state = res.state;
      App.game.shipCounts[shipType]--;
      updateShipCounts();
      renderGame();
      checkAllShipsPlaced();
      showNotification('Успех', `${shipType} размещен`, 'success');
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось разместить корабль: ' + err.message, 'error');
  }
}

async function movePiece(fx, fy, tx, ty) {
  try {
    const followers = [];
    
    if(App.game.selectedGroup.length > 0) {
            const leader = App.game.selectedGroup[0];
      App.game.selectedGroup.slice(1).forEach(p => {
        followers.push([p.x, p.y, tx, ty]);
      });
      fx = leader.x;
      fy = leader.y;
    }
    
    if(App.game.selectedPiece) {
      try {
        const response = await api(`/game/carried_pieces/${App.game.id}/`, 'POST', {coord: [fx, fy]});
        const carried = response.carried || [];
        
        carried.forEach(carriedCoord => {
          const directions = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
          for(const dir of directions) {
            const newX = tx + dir.dx;
            const newY = ty + dir.dy;
            
            if(newX >= 0 && newX < 14 && newY >= 0 && newY < 15) {
              const cell = getCellElement(newX, newY);
              if(!cell.querySelector('.piece')) {
                followers.push([carriedCoord[0], carriedCoord[1], newX, newY]);
                break;
              }
            }
          }
        });
      } catch(e) {}
    }
    
    const res = await api(`/game/move/${App.game.id}/`, 'POST', {
      src: [fx, fy],
      dst: [tx, ty],
      followers: followers
    });
    
    if(res.ok) {
      App.game.state = res.state;
      renderGame();
      clearSelection();
      clearGroupSelection();
      updateKilledTable();
      
      if(res.result && res.result.event) {
        handleMoveResult(res.result);
      } else {
        showHint('Ход выполнен. Ход противника');
      }
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось выполнить ход: ' + err.message, 'error');
    clearSelection();
    clearGroupSelection();
  }
}

async function moveGroup(toX, toY) {
  if(App.game.selectedGroup.length === 0) return;
  
  try {
    const leader = App.game.selectedGroup[0];
    const followers = App.game.selectedGroup.slice(1).map(p => [p.x, p.y, toX, toY]);
    
    const res = await api(`/game/move/${App.game.id}/`, 'POST', {
      src: [leader.x, leader.y],
      dst: [toX, toY],
      followers: followers
    });
    
    if(res.ok) {
      App.game.state = res.state;
      renderGame();
      clearGroupSelection();
      updateKilledTable();
      
      if(res.result && res.result.event) {
        handleMoveResult(res.result);
      } else {
        showHint('Группа перемещена. Ход противника');
      }
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось переместить группу: ' + err.message, 'error');
    clearGroupSelection();
  }
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
  
  if(autoPlaceBtn) autoPlaceBtn.addEventListener('click', autoSetup);
  if(clearPlaceBtn) clearPlaceBtn.addEventListener('click', clearSetup);
  if(submitSetupBtn) submitSetupBtn.addEventListener('click', submitSetup);
  if(pauseBtn) pauseBtn.addEventListener('click', openPauseModal);
  if(resignBtn) resignBtn.addEventListener('click', openResignModal);
  
  renderFleetPanels(leftPanelInner, rightPanelInner);
  clearBoard();
  fitBoard();
  window.addEventListener('resize', fitBoard);
}

function startGamePolling() {
  if(App.game.pollTimer) clearInterval(App.game.pollTimer);
  
  App.game.pollTimer = setInterval(async () => {
    if(!App.game.id) return;
    
    try {
      const stateData = await api(`/game/state/${App.game.id}/`);
      if(stateData && stateData.state) {
        const oldPhase = App.game.state?.phase;
        App.game.state = stateData.state;
        
        if(oldPhase === 'SETUP' && stateData.state.phase !== 'SETUP') {
          App.game.setupPhase = false;
          showNotification('Игра началась!', 'Фаза расстановки завершена', 'success');
          if(waitOpponentModal) waitOpponentModal.style.display = 'none';
          if(App.game.setupTimer) {
            clearInterval(App.game.setupTimer);
            App.game.setupTimer = null;
          }
          createGameUI();
        }
        
        renderGame();
        
        if(stateData.state.winner) {
          showGameResult(stateData.state.winner, stateData.state.win_reason);
        }
      }
      
      const timerData = await api(`/game/timers/${App.game.id}/`);
      if(timerData) {
        updateTimers(timerData);
        App.game.pausesUsed.short = !timerData.short_available;
        App.game.pausesUsed.long = !timerData.long_available;
        
        if(timerData.paused && typeof timerData.pause_left === 'number') {
          showPauseOverlay(timerData.pause_left, (timerData.pause_initiator === App.game.myPlayer));
        } else {
          hidePauseOverlay();
        }
        
        if(timerData.finished && timerData.winner_player) {
          showGameResult(timerData.winner_player, timerData.reason);
        }
      }
    } catch(err) {
      console.error('Polling error:', err);
    }
  }, 1000);
}

function updateTimers(data) {
  const hudTimer = document.getElementById('hudTimer');
  const hudMyBank = document.getElementById('hudMyBank');
  const hudOpponentBank = document.getElementById('hudOpponentBank');
  
  if(hudTimer && hudMyBank && hudOpponentBank) {
    if(data.my_turn) {
      if(typeof data.my_turn_left === 'number' && data.my_turn_left > 0) {
        hudTimer.textContent = `${data.my_turn_left}s`;
        hudTimer.style.color = data.my_turn_left <= 10 ? '#ff5e2c' : '';
      } else {
        hudTimer.textContent = 'Банк';
        hudTimer.style.color = '#ff5e2c';
      }
    } else {
      hudTimer.textContent = 'Ход соперника';
      hudTimer.style.color = '#ff5e2c';
    }
    
    if(typeof data.my_bank_left === 'number') {
      const minutes = Math.floor(data.my_bank_left / 60);
      const seconds = data.my_bank_left % 60;
      hudMyBank.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
      hudMyBank.style.color = data.my_bank_left <= 60 ? '#ff5e2c' : '';
    }
    
    if(typeof data.opponent_bank_left === 'number') {
      const minutes = Math.floor(data.opponent_bank_left / 60);
      const seconds = data.opponent_bank_left % 60;
      hudOpponentBank.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
      hudOpponentBank.style.color = data.opponent_bank_left <= 60 ? '#ff5e2c' : '';
    }
  }
}

function renderGame() {
  const state = App.game.state || {};
  clearBoard();
  
  const boardEl = document.getElementById('board');
  if(!boardEl) return;
  
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
      document.getElementById('rightPanelInner')
    );
  }
}

function openProfile(){
  if(!App.isAuth){ openAuth(); return; }
  pLogin.value = App.meLogin || '';
  pAvatarPreview.src = App.meAvatar || '/static/img/avatar_stub.png';
  api('/accounts/api/me/').then(me=>{
    pUsername.value = me.username || '';
    pEmail.value = me.email || '';
    if(me.avatar) {
      pAvatarPreview.src = me.avatar;
      App.meAvatar = me.avatar;
      renderTopRight();
    }
  }).catch(()=>{});
  profileModal.style.display='flex';
}

function openAuth(){ authModal.style.display='flex'; }
function closeModal(id){ document.getElementById(id).style.display='none'; }

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

if(startBut) startBut.addEventListener('click', () => { showContent('lobby'); setTimeout(() => { loadUsers(''); loadFriends(); }, 100); });
if(rulesBut) rulesBut.addEventListener('click', () => showContent('rules'));
if(settExit){
  settExit.addEventListener('click', () => {
    if(gameContent && gameContent.style.display === 'block' && App.game.id){
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
        showContent('lobby'); setTimeout(()=>{ loadUsers(''); loadFriends(); }, 100);
      });
      document.getElementById('cancelExitBtn').addEventListener('click', () => {
        confirmModal.style.display='none';
        document.body.removeChild(confirmModal);
      });
    } else if (lobbyContent && lobbyContent.style.display === 'block') {
      showMenu();
    } else if (rulesContent && rulesContent.style.display === 'block') {
      showMenu();
    } else {
      showMenu();
    }
  });
}

if(profileBtn) profileBtn.addEventListener('click', () => App.isAuth ? openProfile() : openAuth());
if(logoutBtn){
  logoutBtn.addEventListener('click', async () => {
    try{
      await api('/accounts/api/logout/','POST',{});
      App.isAuth = false;
      App.meLogin = '';
      App.meAvatar = '/static/img/avatar_stub.png';
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
  const f = pAvatar.files && pAvatar.files[0]; if(!f) return;
  const reader = new FileReader(); reader.onload = ev => { pAvatarPreview.src = ev.target.result; }; reader.readAsDataURL(f);
});

if(profileForm) profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(profileForm);
  if(pAvatar.files && pAvatar.files[0]) fd.set('avatar', pAvatar.files[0]);
  try{
    const res = await api('/accounts/api/profile/update/','POST', fd, true);
    if(res.ok){
      if(res.profile){
        App.meLogin = res.profile.login || App.meLogin;
        if(res.profile.avatar) App.meAvatar = res.profile.avatar;
      }
      renderTopRight();
      showNotification('Успех', 'Профиль сохранен', 'success');
      closeModal('profileModal');
    } else {
      showNotification('Ошибка', 'Не удалось сохранить профиль', 'error');
    }
  }catch(err){ showNotification('Ошибка', 'Не удалось сохранить профиль: ' + err.message, 'error'); }
});

if(loginForm) loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(loginForm).entries());
  try{
    const r = await api('/accounts/api/login/','POST', d);
    if(r.ok){
      App.isAuth=true; App.meLogin=r.login||d.username; if(r.avatar) App.meAvatar=r.avatar;
      renderTopRight(); authModal.style.display='none';
      showNotification('Успех', 'Вы успешно вошли в систему', 'success');
    }else showNotification('Ошибка', 'Неверный логин или пароль', 'error');
  }catch(err){ showNotification('Ошибка', 'Ошибка входа в систему', 'error'); }
});

if(registerForm) registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(registerForm).entries());
  try{
    const r = await api('/accounts/api/register/','POST', d);
    if(r.ok){
      const r2 = await api('/accounts/api/login/','POST',{username:d.username,password:d.password});
      if(r2.ok){
        App.isAuth=true; App.meLogin=d.login; if(r2.avatar) App.meAvatar=r2.avatar;
        renderTopRight(); authModal.style.display='none';
        showNotification('Успех', 'Регистрация прошла успешно', 'success');
      }
    }else showNotification('Ошибка', 'Ошибка регистрации', 'error');
  }catch(err){ showNotification('Ошибка', 'Ошибка регистрации', 'error'); }
});

function ratingValue(u){
  if(typeof u.rating === 'number') return u.rating;
  const wins = u.wins || 0, losses = u.losses || 0;
  return wins*100 - losses*100;
}

async function loadUsers(q){
  if(!usersList) return;
  try{
    const data = await api('/accounts/api/users/?q='+encodeURIComponent(q||''));
    renderUsers(data.items||[]);
  }catch(err){ usersList.innerHTML='<li>Ошибка загрузки</li>'; }
}

function renderUsers(arr){
  if(!usersList) return;
  usersList.innerHTML='';
  if(App.isAuth){
    api('/accounts/api/me/').then(me=>{
      const meItem = {id: me.id, login: me.login, username: me.username, rating: me.rating_elo || 0, wins: me.wins || 0, losses: me.losses || 0, isMe:true};
      const ids = new Set(arr.map(i=>i.id));
      if(!ids.has(meItem.id)) arr.push(meItem);
      arr.sort((a,b) => (ratingValue(b) - ratingValue(a)));
      renderUsersList(arr);
    }).catch(()=>{ arr.sort((a,b) => (ratingValue(b) - ratingValue(a))); renderUsersList(arr); });
  } else {
    arr.sort((a,b) => (ratingValue(b) - ratingValue(a)));
    renderUsersList(arr);
  }
}

function renderUsersList(arr){
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
        <button class="menuButs xs" data-invite="${u.id}">Игра</button>
        <button class="menuButs xs" data-add="${u.id}" data-login="${u.login}">Друг</button>
      </div>` : '<div></div>'}`;
    usersList.appendChild(li);
  });
  usersList.querySelectorAll('[data-invite]').forEach(btn => btn.addEventListener('click', () => inviteUser(btn.dataset.invite)));
  usersList.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const login = btn.dataset.login;
      try{ 
        await api('/accounts/api/friends/add/','POST',{login}); 
        loadFriends(); 
        showNotification('Успех', 'Друг добавлен', 'success');
      }catch(e){ showNotification('Ошибка', 'Не удалось добавить друга', 'error'); }
    });
  });
}

if(userSearch) userSearch.addEventListener('input', () => loadUsers(userSearch.value.trim()));
if(friendSearch) friendSearch.addEventListener('input', () => filterFriends(friendSearch.value.trim()));
if(showMeBtn) showMeBtn.addEventListener('click', () => {
  if(!App.isAuth) return;
  const myItem = usersList.querySelector(`[data-login="${App.meLogin}"]`);
  if(myItem) {
    myItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    myItem.style.background = 'rgba(255,255,0,.3)'; setTimeout(() => { myItem.style.background = 'rgba(255,255,0,.1)'; }, 2000);
  }
});

function filterFriends(query) {
  const items = friendsList.querySelectorAll('li');
  if(!items.length) return;
  query = (query||'').toLowerCase();
  items.forEach(item => {
    const login = (item.querySelector('strong')?.textContent || '').toLowerCase();
    item.style.display = login.includes(query) ? '' : 'none';
  });
}

async function loadFriends(){
  if(!friendsList) return;
  try{
    const data = await api('/accounts/api/friends/');
    const items = data.items || [];
    const friendsWithInfo = [];
    for(const friend of items) {
      try {
        const info = await api(`/accounts/api/users/${friend.id}/`);
        friendsWithInfo.push({ ...friend, rating: info.rating || 0, wins: info.wins || 0, losses: info.losses || 0 });
      } catch(e) {
        friendsWithInfo.push(friend);
      }
    }
    friendsWithInfo.sort((a,b) => (ratingValue(b) - ratingValue(a)));
    friendsList.innerHTML='';
    if(friendsWithInfo.length===0){ friendsList.innerHTML='<li>Нет друзей</li>'; return; }
    friendsWithInfo.forEach((u) => {
      const rating = ratingValue(u);
      const li = document.createElement('li');
      li.innerHTML = `
        <div>
          <strong>${u.login}</strong><br>
          <span class="muted">Рейтинг: ${rating} • Побед: ${u.wins || 0} • Поражений: ${u.losses || 0}</span>
        </div>
        <div style="display:flex;gap:.4rem">
          <button class="menuButs xs" data-invite="${u.id}">Игра</button>
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
      } catch(e){ showNotification('Ошибка', 'Не удалось удалить друга', 'error'); }
    }));
  }catch(err){ friendsList.innerHTML='<li>Ошибка загрузки</li>'; }
}

function showWaiting(text, onCancel, token=null){
  waitText.textContent = text || 'Ожидание...';
  App.waitCtx = {active:true, token, canceler:onCancel};
  waitModal.style.display = 'flex';
}

function hideWaiting(){ waitModal.style.display = 'none'; App.waitCtx = {active:false, token:null, canceler:null}; }

if(waitCancel) waitCancel.addEventListener('click', async () => { try{ if(App.waitCtx.canceler) await App.waitCtx.canceler(); } finally{ hideWaiting(); } });

let currentInviteToken = null;
function showInviteModal(fromLogin, token){ currentInviteToken = token; inviteText.textContent = `Приглашение в игру от ${fromLogin}`; inviteModal.style.display = 'flex'; }

if(inviteAccept) inviteAccept.addEventListener('click', async () => {
  if(!currentInviteToken) return;
  try { 
    const res = await api(`/match/invite/${currentInviteToken}/accept/`, 'POST'); 
    if(res.ok && res.url) { 
      inviteModal.style.display = 'none'; 
      currentInviteToken = null; 
      startGameByRoomUrl(res.url); 
    } 
  } catch(err) { showNotification('Ошибка', 'Не удалось принять приглашение', 'error'); }
});

if(inviteDecline) inviteDecline.addEventListener('click', async () => {
  if(!currentInviteToken) return;
  try { 
    await api(`/match/invite/${currentInviteToken}/decline/`, 'POST'); 
    inviteModal.style.display = 'none'; 
    currentInviteToken = null; 
    showNotification('Информация', 'Приглашение отклонено', 'info'); 
  } catch(err) { showNotification('Ошибка', 'Ошибка отклонения приглашения', 'error'); }
});

function handleEvent(m){
  if(!m || !m.type) return;
  if(m.type === 'friend_invite'){ showInviteModal(m.from, m.token); }
  if(m.type === 'invite_accepted'){ hideWaiting(); if(m.url) startGameByRoomUrl(m.url); }
  if(m.type === 'invite_declined'){ hideWaiting(); showNotification('Информация', 'Ваше приглашение отклонено', 'warning'); }
  if(m.type === 'match_found'){ hideWaiting(); if(m.url) startGameByRoomUrl(m.url); }
}

async function poll(){
  if(!App.isAuth) return;
  try{ const data = await api('/match/notify/poll/'); (data.items||[]).forEach(handleEvent); }catch(err){}
}

setInterval(poll, 1200);

let quickTimer = null;
if(quickBtn) quickBtn.addEventListener('click', async () => {
  if(!App.isAuth){ openAuth(); return; }
  try{
    const r = await api('/match/quick/');
    if(r.url){ startGameByRoomUrl(r.url); return; }
    if(r.queued){
      showWaiting('Ищем соперника...', async () => { await api('/match/cancel/'); });
      if(quickTimer) clearInterval(quickTimer);
      quickTimer = setInterval(async () => {
        try {
          const s = await api('/match/status/');
          if(s.url){ clearInterval(quickTimer); hideWaiting(); startGameByRoomUrl(s.url); }
        } catch(err) {}
      }, 1200);
    }
  }catch(err){ showNotification('Ошибка', 'Не удалось начать поиск соперника', 'error'); }
});

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

function initializeShipCounts() {
  App.game.shipCounts = {};
  Object.keys(SHIP_TYPES).forEach(type => { App.game.shipCounts[type] = SHIP_TYPES[type].count; });
}

function renderFleetPanels(leftPanel, rightPanel) {
  if(!leftPanel || !rightPanel) return;
  
  const shipTypes = Object.keys(SHIP_TYPES);
  const halfIndex = Math.ceil(shipTypes.length / 2);
  
  leftPanel.innerHTML = '';
  rightPanel.innerHTML = '';
  
  shipTypes.slice(0, halfIndex).forEach(type => {
    const item = document.createElement('div');
    item.className = 'fleet-item';
    item.dataset.ship = type;
    
    let count;
    if(App.game.setupPhase) {
      count = App.game.shipCounts[type] || 0;
    } else {
      count = SHIP_TYPES[type].count;
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
  });
  
  shipTypes.slice(halfIndex).forEach(type => {
    const item = document.createElement('div');
    item.className = 'fleet-item';
    item.dataset.ship = type;
    
    let count;
    if(App.game.setupPhase) {
      count = App.game.shipCounts[type] || 0;
    } else {
      count = SHIP_TYPES[type].count;
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
  });
}

function selectShip(type) {
  if(!App.game.setupPhase) return;
  if(App.game.shipCounts[type] <= 0) {
    showNotification('Ошибка', 'У вас закончились фишки этого типа', 'error');
    return;
  }
  
  document.querySelectorAll('.fleet-item').forEach(item => item.classList.remove('selected'));
  const item = document.querySelector(`[data-ship="${type}"]`);
  if(item) {
    item.classList.add('selected');
    App.game.selectedShip = type;
    clearSelection();
    showHint(`Выбран ${type}. Кликните на клетку в своей зоне для размещения`);
  }
}

async function addToGroup(x, y) {
  if(!App.game.selectedPiece) return;
  
  App.game.selectedGroup.push(App.game.selectedPiece);
  App.game.selectedGroup.push({x, y});
  
  document.querySelectorAll('.cell.group-candidate').forEach(cell => {
    cell.classList.remove('group-candidate');
  });
  
  App.game.selectedGroup.forEach(coord => {
    const cell = getCellElement(coord.x, coord.y);
    cell.classList.add('group-selected');
    const indicator = document.createElement('div');
    indicator.className = 'group-indicator';
    cell.appendChild(indicator);
  });
  
  const groupStrength = App.game.selectedGroup.reduce((sum, coord) => {
    const piece = getCellElement(coord.x, coord.y).querySelector('.piece');
    if(piece) {
      const shipType = convertFromApiShipType(piece.dataset.kind);
      return sum + (SHIP_TYPES[shipType]?.rank || 0);
    }
    return sum;
  }, 0);
  
  showHint(`Группа из ${App.game.selectedGroup.length} фишек. Сила группы: ${groupStrength}`);
  
  await showGroupMoves();
  
  App.game.selectedPiece = null;
  App.game.groupCandidates = [];
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
  
  App.game.selectedGroup.forEach(piece => {
    const {x, y} = piece;
    const directions = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    
    directions.forEach(dir => {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      
      if(nx >= 0 && nx < 14 && ny >= 0 && ny < 15) {
        const isGroupMember = App.game.selectedGroup.some(p => p.x === nx && p.y === ny);
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

async function checkSpecialAttacks() {
  try {
    const response = await api(`/game/special_attacks/${App.game.id}/`);
    App.game.specialAttacks = response.options;
    
    if(App.game.specialAttacks.torpedo.length > 0) {
      App.game.specialAttacks.torpedo.forEach(attack => {
        if(App.game.selectedPiece && 
           (App.game.selectedPiece.x === attack.tk[0] && App.game.selectedPiece.y === attack.tk[1])) {
          showTorpedoDirections(attack);
          showHint('Доступна торпедная атака! Выберите направление стрельбы');
        }
      });
    }
    
    if(App.game.specialAttacks.air.length > 0) {
      App.game.specialAttacks.air.forEach(attack => {
        if(App.game.selectedPiece && 
           (App.game.selectedPiece.x === attack.carrier[0] && App.game.selectedPiece.y === attack.carrier[1])) {
          showAirAttackZone(attack);
          showHint('Доступна воздушная атака! Кликните на зону атаки');
        }
      });
    }
  } catch(e) {
    App.game.specialAttacks = {torpedo: [], air: []};
  }
}

function showTorpedoDirections(attack) {
  const tkCell = getCellElement(attack.tk[0], attack.tk[1]);
  const torpedoCell = getCellElement(attack.torpedo[0], attack.torpedo[1]);
  
  attack.directions.forEach(dir => {
    const [dx, dy] = dir;
    let x = attack.torpedo[0];
    let y = attack.torpedo[1];
    
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
  let x = attack.plane[0];
  let y = attack.plane[1];
  
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

async function executeTorpedoAttack(x, y) {
  const cell = getCellElement(x, y);
  const direction = cell.dataset.torpedoDir.split(',').map(Number);
  
  if(!App.game.selectedPiece) return;
  
  const tkCoord = [App.game.selectedPiece.x, App.game.selectedPiece.y];
  let torpedoCoord = null;
  
  const directions = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
  for(const dir of directions) {
    const nx = tkCoord[0] + dir.dx;
    const ny = tkCoord[1] + dir.dy;
    const adjCell = getCellElement(nx, ny);
    const adjPiece = adjCell?.querySelector('.piece');
    
    if(adjPiece && adjPiece.dataset.kind === 'T' && 
       parseInt(adjPiece.dataset.owner) === App.game.myPlayer) {
      torpedoCoord = [nx, ny];
      break;
    }
  }
  
  if(!torpedoCoord) {
    showNotification('Ошибка', 'Торпеда не найдена', 'error');
    return;
  }
  
  try {
    const res = await api(`/game/torpedo/${App.game.id}/`, 'POST', {
      torpedo: torpedoCoord,
      tk: tkCoord,
      direction: direction
    });
    
    if(res.ok) {
      App.game.state = res.state;
      renderGame();
      clearSelection();
      updateKilledTable();
      
      if(res.result && res.result.captures && res.result.captures.length > 0) {
        showNotification('Торпедная атака!', `Уничтожено: ${res.result.captures.join(', ')}`, 'success');
      } else {
        showNotification('Торпедная атака!', 'Промах', 'info');
      }
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось выполнить торпедную атаку: ' + err.message, 'error');
    clearSelection();
  }
}

async function executeAirAttack(x, y) {
  if(!App.game.selectedPiece) return;
  
  const carrierCoord = [App.game.selectedPiece.x, App.game.selectedPiece.y];
  const direction = App.game.myPlayer === 1 ? -1 : 1;
  const planeCoord = [carrierCoord[0], carrierCoord[1] + direction];
  
  try {
    const res = await api(`/game/air/${App.game.id}/`, 'POST', {
      carrier: carrierCoord,
      plane: planeCoord
    });
    
    if(res.ok) {
      App.game.state = res.state;
      renderGame();
      clearSelection();
      updateKilledTable();
      
      if(res.result && res.result.captures && res.result.captures.length > 0) {
        showNotification('Воздушная атака!', `Уничтожено: ${res.result.captures.length} целей`, 'success');
      } else {
        showNotification('Воздушная атака!', 'Цели не обнаружены', 'info');
      }
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось выполнить воздушную атаку: ' + err.message, 'error');
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
    case 'mutual_destruction':
      showNotification('Взаимное уничтожение', 'Обе фишки уничтожены', 'warning');
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
    const res = await api(`/game/clear_setup/${App.game.id}/`, 'POST', {});
    if(res.ok && res.state) {
      App.game.state = res.state;
      initializeShipCounts();
      updateShipCounts();
      renderGame();
      App.game.allShipsPlaced = false;
      showNotification('Успех', 'Расстановка очищена', 'success');
    }
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
    const res = await api(`/game/submit_setup/${App.game.id}/`, 'POST', {});
    if(res && res.ok) {
      App.game.setupSubmitted = true;
      showNotification('Готово', 'Расстановка подтверждена', 'success');
      
      if(res.status !== 'SETUP') {
        App.game.setupPhase = false;
        if(App.game.state) {
          App.game.state.phase = res.status;
          App.game.state.turn = res.turn;
        }
        if(App.game.setupTimer) {
          clearInterval(App.game.setupTimer);
          App.game.setupTimer = null;
        }
        createGameUI();
        renderGame();
        showNotification('Игра началась!', 'Фаза расстановки завершена', 'success');
      } else {
        if(waitOpponentModal) waitOpponentModal.style.display = 'flex';
        showNotification('Ожидание', 'Ожидаем пока соперник расставит свои фишки', 'info');
      }
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось подтвердить расстановку: ' + err.message, 'error');
  }
}

async function autoSetup() {
  if(!App.game.id) return;
  
  try {
    const res = await api(`/game/autosetup/${App.game.id}/`, 'POST', {});
    if(res && res.state) {
      App.game.state = res.state;
      Object.keys(App.game.shipCounts).forEach(type => App.game.shipCounts[type] = 0);
      updateShipCounts();
      renderGame();
      showNotification('Успех', 'Автоматическая расстановка завершена', 'success');
      App.game.allShipsPlaced = true;
      checkAllShipsPlaced();
    }
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
        count = SHIP_TYPES[type].count;
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

function fitBoard(){
  const parent = document.querySelector('.board-container');
  const board = document.getElementById('board');
  if(!parent || !board) return;
  
  const r = parent.getBoundingClientRect();
  let cellSize;
  
  if(window.innerWidth <= 600) {
    cellSize = Math.floor(Math.min(r.width/14, r.height/15) * 0.95);
  } else {
    cellSize = Math.floor(Math.min(r.width/14, r.height/15) * 0.98);
  }
  
  const boardWidth = cellSize * 14;
  const boardHeight = cellSize * 15;
  
  board.style.width = boardWidth + 'px';
  board.style.height = boardHeight + 'px';
  board.style.left = '50%';
  board.style.top = '50%';
  board.style.transform = 'translate(-50%, -50%)';
  
  board.classList.remove('player1', 'player2');
  
  board.querySelectorAll('.piece').forEach(p => {
    p.style.fontSize = Math.max(8, Math.floor(cellSize * 0.45)) + 'px';
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

function startSetupTimer(minutes) {
  if(App.game.setupTimer) clearInterval(App.game.setupTimer);
  
  const deadline = new Date();
  deadline.setMinutes(deadline.getMinutes() + minutes);
  App.game.setupDeadline = deadline;
  
  updateSetupTimerDisplay();
  App.game.setupTimer = setInterval(updateSetupTimerDisplay, 1000);
}

function updateSetupTimerDisplay() {
  if(!App.game.setupDeadline) return;
  
  const hudTimer = document.getElementById('hudTimer');
  if(!hudTimer) return;
  
  const now = new Date();
  const diff = Math.max(0, Math.floor((App.game.setupDeadline - now) / 1000));
  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;
  
  hudTimer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  hudTimer.style.color = diff <= 60 ? '#ff5e2c' : '';
  
  if(diff <= 0) {
    if(App.game.setupTimer) {
      clearInterval(App.game.setupTimer);
      App.game.setupTimer = null;
    }
    if(App.game.setupPhase && !App.game.allShipsPlaced) {
      autoSetup();
    }
  }
}

function showPauseOverlay(seconds, isInitiator) {
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
          await api(`/game/cancel_pause/${App.game.id}/`, 'POST');
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
  if(pauseModalOverlay) {
    pauseModalOverlay.style.display = 'none';
  }
}

function openPauseModal() {
  if(App.game.state && App.game.state.turn !== App.game.myPlayer) {
    showNotification('Ошибка', 'Пауза доступна только в свой ход', 'error');
    return;
  }
  
  if(shortPauseBtn) shortPauseBtn.disabled = App.game.pausesUsed.short;
  if(longPauseBtn) longPauseBtn.disabled = App.game.pausesUsed.long;
  
  if(pauseModal) pauseModal.style.display = 'flex';
}

if(shortPauseBtn) {
  shortPauseBtn.addEventListener('click', async () => {
    try {
      const res = await api(`/game/pause/${App.game.id}/`, 'POST', {type: 'short'});
      if(res.ok) {
        pauseModal.style.display = 'none';
        showNotification('Пауза', 'Короткая пауза активирована (1 минута)', 'info');
      }
    } catch(err) {
      showNotification('Ошибка', 'Не удалось активировать паузу: ' + err.message, 'error');
    }
  });
}

if(longPauseBtn) {
  longPauseBtn.addEventListener('click', async () => {
    try {
      const res = await api(`/game/pause/${App.game.id}/`, 'POST', {type: 'long'});
      if(res.ok) {
        pauseModal.style.display = 'none';
        showNotification('Пауза', 'Длинная пауза активирована (3 минуты)', 'info');
      }
    } catch(err) {
      showNotification('Ошибка', 'Не удалось активировать паузу: ' + err.message, 'error');
    }
  });
}

if(cancelPauseBtn) {
  cancelPauseBtn.addEventListener('click', () => {
    if(pauseModal) pauseModal.style.display = 'none';
  });
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
    const res = await api(`/game/resign/${App.game.id}/`, 'POST');
    if(res.ok) {
      showNotification('Игра завершена', 'Вы сдались', 'info');
      if(res.state) {
        App.game.state = res.state;
        showGameResult(3 - App.game.myPlayer, 'resign');
      }
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось сдаться: ' + err.message, 'error');
  }
}

function showGameResult(winner, reason) {
  if(App.game.pollTimer) {
    clearInterval(App.game.pollTimer);
    App.game.pollTimer = null;
  }
  
  const isWinner = (winner === App.game.myPlayer);
  
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

async function startGameByRoomUrl(url) {
  const code = url.split('/').filter(Boolean).pop();
  
  try {
    const gameData = await api(`/game/by-code/${code}/`);
    App.game.id = gameData.id;
    App.game.state = gameData.state;
    App.game.myPlayer = gameData.my_player;
    App.game.setupPhase = gameData.state.phase === 'SETUP';
    App.game.pausesUsed = { short: false, long: false };
    App.game.selectedGroup = [];
    App.game.allShipsPlaced = false;
    App.game.pendingAttack = null;
    App.game.setupSubmitted = false;
    App.game.selectedShip = null;
    App.game.groupCandidates = [];
    App.game.specialAttacks = null;
    App.game.carriedPieces = [];
    App.game.moveSelectionActive = false;
    
    initializeShipCounts();
    showContent('game');
    createGameUI();
    renderGame();
    startGamePolling();
    
    if(App.game.setupPhase) {
      showNotification('Расстановка', 'Разместите все фишки в своей зоне. У вас 15 минут.', 'info');
      startSetupTimer(15);
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось открыть игру: ' + err.message, 'error');
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

function init() {
  renderTopRight();
  initTabs();
  activateLobbyTab('pane-quick');
  
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