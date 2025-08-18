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

// Уведомления
function showNotification(title, message, type = 'info') {
  document.querySelectorAll('.notification').forEach(n => n.remove());
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `<div class="notification-title">${title}</div><div class="notification-message">${message}</div>`;
  document.body.appendChild(notification);
  setTimeout(() => notification.classList.add('show'), 50);
  setTimeout(() => { notification.classList.remove('show'); setTimeout(() => notification.remove(), 300); }, 4000);
}

// Константы набора
const SHIP_TYPES = {'БДК':{count:2},'КР':{count:6},'А':{count:1},'С':{count:1},'ТН':{count:1},'Л':{count:2},'ЭС':{count:6},'М':{count:6},'СМ':{count:1},'Ф':{count:6},'ТК':{count:6},'Т':{count:6},'ТР':{count:6},'СТ':{count:6},'ПЛ':{count:1},'КРПЛ':{count:1},'АБ':{count:1},'ВМБ':{count:2}};
const IMMOBILE_TYPES = ['ВМБ','СМ'];
const SPECIAL_MOVES = {'ТК':2,'М':{carrier:'ЭС'},'Т':{carrier:'ТК'},'С':{carrier:'А'}};

// Глобальное приложение
const App = {
  isAuth: document.body.dataset.auth === '1',
  meLogin: document.body.dataset.login || '',
  meAvatar: document.body.dataset.avatar || '/static/img/avatar_stub.png',
  waitCtx: { active:false, token:null, canceler:null },
  game: { 
    id: null, state: null, myPlayer: null, pollTimer: null,
    selectedShip: null, selectedPiece: null, selectedCells: [],
    groupMode: false, attackMode: false, setupPhase: true, shipCounts: {},
    pausesUsed: { short: false, long: false }, selectedGroup: [],
    setupTimer: null, setupDeadline: null,
    allShipsPlaced: false
  }
};

// DOM ссылки
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

// Навигация и карточки
function showContent(contentType){
  [rulesContent, lobbyContent, gameContent].forEach(p => p && (p.style.display = 'none'));
  if(contentType === 'rules'){ rulesContent.style.display = 'block'; }
  else if(contentType === 'lobby'){ lobbyContent.style.display = 'block'; activateLobbyTab('pane-quick'); initTabs(); }
  else if(contentType === 'game'){ gameContent.style.display = 'block'; }
  msContainer.classList.add('flip');
}
function showMenu(){
  msContainer.classList.remove('flip');
  if(App.game.pollTimer){ clearInterval(App.game.pollTimer); App.game.pollTimer = null; }
  if(App.game.setupTimer){ clearInterval(App.game.setupTimer); App.game.setupTimer = null; }
}
// Активировать вкладку лобби
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

// Модалки/Профиль/Авторизация
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

// Табы
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

// Инициализация навигации
if(startBut) startBut.addEventListener('click', () => { showContent('lobby'); setTimeout(() => { loadUsers(''); loadFriends(); }, 100); });
if(rulesBut) rulesBut.addEventListener('click', () => showContent('rules'));
if(settExit){
  settExit.addEventListener('click', () => {
    if(gameContent && gameContent.style.display === 'block' && App.game.id){
      // подтверждение с автосдачей
      const confirmModal = document.createElement('div');
      confirmModal.className = 'modal-backdrop';
      confirmModal.id = 'exitConfirmModal';
      confirmModal.innerHTML = `
        <div class="modal">
          <h3 class="modalTitle">Подтверждение</h3>
          <p class="text-center">Выйти из текущей игры (зачтется как поражение)?</p>
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
      // дефолт — в меню
      showMenu();
    }
  });
}

// Профиль/Auth/Logout
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

// Users/Friends
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

// Инвайты/Вэйтинг
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

// Нотификации
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

// Быстрый матч
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

// ИГРА
function initializeShipCounts() {
  App.game.shipCounts = {};
  Object.keys(SHIP_TYPES).forEach(type => { App.game.shipCounts[type] = SHIP_TYPES[type].count; });
}

// Подгонка доски под контейнер (полностью видимая, квадратные клетки)
function fitBoard(){
  const parent = document.querySelector('.board-container');
  const board = document.getElementById('board');
  if(!parent || !board) return;
  const r = parent.getBoundingClientRect();
  const cellPx = Math.floor(Math.min(r.width/14, r.height/15));
  const w = cellPx*14, h = cellPx*15;
  board.style.width = w+'px';
  board.style.height = h+'px';
  board.querySelectorAll('.piece').forEach(p => p.style.fontSize = Math.max(10, Math.floor(cellPx*0.55))+'px');
}

function createGameUI() {
  const gameContentEl = document.querySelector('.gameContent');
  if(!gameContentEl) return;
  
  if(App.game.setupPhase) {
    gameContentEl.innerHTML = `
      <div class="game-hud">
        <div class="tag">Расстановка фишек</div>
        <div class="tag">Таймер: <span id="hudTimer">15:00</span></div>
        <div class="tag" style="display:flex;gap:.4rem;flex-wrap:wrap">
          <button id="autoPlaceBtn" class="menuButs xs">Авторасстановка</button>
          <button id="clearPlaceBtn" class="menuButs xs danger">Очистить</button>
        </div>
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
  } else {
    gameContentEl.innerHTML = `
      <div class="game-hud">
        <div class="tag"><span id="turnIndicator">Ваш ход</span></div>
        <div class="tag">Таймер: <span id="hudTimer">30s</span></div>
        <div class="tag">Банк: <span id="hudBank">15:00</span></div>
        <div class="tag" style="display:flex;gap:.4rem;flex-wrap:wrap">
          <button id="pauseBtn" class="menuButs xs">Пауза</button>
          <button id="resignBtn" class="menuButs xs danger">Сдаться</button>
        </div>
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
  }
  
  const autoPlaceBtn = document.getElementById('autoPlaceBtn');
  const clearPlaceBtn = document.getElementById('clearPlaceBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resignBtn = document.getElementById('resignBtn');
  const leftPanelInner = document.getElementById('leftPanelInner');
  const rightPanelInner = document.getElementById('rightPanelInner');
  
  if(autoPlaceBtn) autoPlaceBtn.addEventListener('click', autoSetup);
  if(clearPlaceBtn) clearPlaceBtn.addEventListener('click', clearSetup);
  if(pauseBtn) pauseBtn.addEventListener('click', openPauseModal);
  if(resignBtn) resignBtn.addEventListener('click', openResignModal);
  
  if(App.game.setupPhase && leftPanelInner && rightPanelInner) {
    const shipTypes = Object.keys(SHIP_TYPES);
    const halfIndex = Math.ceil(shipTypes.length / 2);
    shipTypes.slice(0, halfIndex).forEach(type => {
      const item = document.createElement('div');
      item.className = 'ship-item';
      item.dataset.ship = type;
      item.innerHTML = `${type} <span class="ship-count">${App.game.shipCounts[type]||0}</span>`;
      item.addEventListener('click', () => selectShip(type));
      leftPanelInner.appendChild(item);
    });
    shipTypes.slice(halfIndex).forEach(type => {
      const item = document.createElement('div');
      item.className = 'ship-item';
      item.dataset.ship = type;
      item.innerHTML = `${type} <span class="ship-count">${App.game.shipCounts[type]||0}</span>`;
      item.addEventListener('click', () => selectShip(type));
      rightPanelInner.appendChild(item);
    });
  }
  if(!App.game.setupPhase && leftPanelInner && rightPanelInner) {
    const groupBtn = document.createElement('div');
    groupBtn.className = 'control-item';
    groupBtn.id = 'groupBtn';
    groupBtn.textContent = 'Группа';
    groupBtn.addEventListener('click', toggleGroupMode);
    leftPanelInner.appendChild(groupBtn);

    const attackBtn = document.createElement('div');
    attackBtn.className = 'control-item';
    attackBtn.id = 'attackBtn';
    attackBtn.textContent = 'Атака';
    attackBtn.addEventListener('click', toggleAttackMode);
    rightPanelInner.appendChild(attackBtn);

    const title = document.createElement('div');
    title.style.cssText = 'margin-top:10px;font-weight:bold;';
    title.textContent = 'Специальные атаки:';
    rightPanelInner.appendChild(title);

    [['torpedo','Торпедный выстрел'],['airstrike','Воздушная атака'],['bomb','Атомная бомба']].forEach(([id, label])=>{
      const b = document.createElement('div');
      b.className='control-button';
      b.id = id+'Btn';
      b.textContent = label;
      b.addEventListener('click', ()=> startSpecialAttack(id));
      rightPanelInner.appendChild(b);
    });
  }
  clearBoard();
  fitBoard();
  window.addEventListener('resize', fitBoard);
}

function openResignModal() {
  const resignModal = document.createElement('div');
  resignModal.className = 'modal-backdrop';
  resignModal.id = 'resignConfirmModal';
  resignModal.innerHTML = `
    <div class="modal">
      <h3 class="modalTitle">Подтверждение</h3>
      <p class="text-center">Вы уверены, что хотите сдаться? Это будет засчитано как поражение.</p>
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

function openPauseModal() {
  if(App.game.state && App.game.state.turn !== App.game.myPlayer) {
    showNotification('Ошибка', 'Пауза доступна только в свой ход', 'error');
    return;
  }
  if(shortPauseBtn) shortPauseBtn.disabled = App.game.pausesUsed.short;
  if(longPauseBtn) longPauseBtn.disabled = App.game.pausesUsed.long;
  pauseModal.style.display = 'flex';
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

function startSpecialAttack(type) {
  if(App.game.state && App.game.state.turn !== App.game.myPlayer) {
    showNotification('Ошибка', 'Сейчас не ваш ход', 'error');
    return;
  }
  App.game.groupMode = false;
  App.game.attackMode = false;
  App.game.selectedShip = null;
  App.game.selectedPiece = null;
  clearSelection();
  clearGroupSelection();
  document.querySelectorAll('.control-button, .control-item').forEach(btn => btn.classList.remove('selected'));
  document.getElementById(`${type}Btn`)?.classList.add('selected');
  App.game.specialAttackMode = type;
  const hints={torpedo:'Выберите торпеду (Т) и торпедный катер (ТК), затем направление', airstrike:'Выберите авианосец (А) и самолёт (С)', bomb:'Выберите атомную бомбу (АБ)'};
  showNotification('Специальная атака', hints[type]||'', 'info');
}

function toggleGroupMode() {
  if(App.game.state && App.game.state.turn !== App.game.myPlayer) {
    showNotification('Ошибка', 'Сейчас не ваш ход', 'error');
    return;
  }
  const attackBtn = document.getElementById('attackBtn');
  const groupBtn = document.getElementById('groupBtn');
  App.game.groupMode = !App.game.groupMode; App.game.attackMode = false; App.game.selectedShip = null; App.game.selectedPiece = null; App.game.specialAttackMode=null;
  if(groupBtn) groupBtn.classList.toggle('selected', App.game.groupMode);
  if(attackBtn) attackBtn.classList.remove('selected');
  clearSelection();
  clearGroupSelection();
}

function toggleAttackMode() {
  if(App.game.state && App.game.state.turn !== App.game.myPlayer) {
    showNotification('Ошибка', 'Сейчас не ваш ход', 'error');
    return;
  }
  const attackBtn = document.getElementById('attackBtn');
  const groupBtn = document.getElementById('groupBtn');
  App.game.attackMode = !App.game.attackMode; App.game.groupMode = false; App.game.selectedShip = null; App.game.selectedPiece = null; App.game.specialAttackMode=null;
  if(attackBtn) attackBtn.classList.toggle('selected', App.game.attackMode);
  if(groupBtn) groupBtn.classList.remove('selected');
  clearSelection(); clearGroupSelection();
}

function selectShip(type) {
  if(App.game.shipCounts[type] <= 0) {
    showNotification('Ошибка', 'У вас закончились фишки этого типа', 'error');
    return;
  }
  document.querySelectorAll('.ship-item').forEach(item => item.classList.remove('selected'));
  const item = document.querySelector(`[data-ship="${type}"]`);
  if(item) {
    item.classList.add('selected');
    App.game.selectedShip = type; 
    App.game.selectedPiece = null; 
    App.game.groupMode = false; 
    App.game.attackMode = false;
    App.game.specialAttackMode = null;
    document.querySelectorAll('.control-button, .control-item').forEach(btn => btn.classList.remove('selected'));
    clearSelection(); 
    clearGroupSelection();
  }
}

// Построение доски
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
        if(r >= 10) cell.classList.add('my-zone'); else if(r < 5) cell.classList.add('enemy-zone'); 
      } else { 
        if(r < 5) cell.classList.add('my-zone'); else if(r >= 10) cell.classList.add('enemy-zone'); 
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
  if(pauseModalOverlay.style.display === 'flex') { showNotification('Игра на паузе', 'Дождитесь окончания паузы', 'warning'); return; }
  if(App.game.setupPhase && App.game.selectedShip) { placeShip(x, y, App.game.selectedShip); }
  else if(!App.game.setupPhase){
    if(App.game.state && App.game.state.turn !== App.game.myPlayer){ showNotification('Ошибка', 'Сейчас не ваш ход', 'error'); return; }
    if(App.game.specialAttackMode) { handleSpecialAttack(x, y); return; }
    if(App.game.groupMode) handleGroupSelection(x, y);
    else if(App.game.attackMode) handleAttack(x, y);
    else handlePieceSelection(x, y);
  }
}

// Спецатаки
let torpedoState = { t: null, tk: null, direction: null };
function handleSpecialAttack(x, y) {
  const cell = getCellElement(x, y);
  const piece = cell.querySelector('.piece');
  switch(App.game.specialAttackMode) {
    case 'torpedo': return handleTorpedoAttack(x, y, piece);
    case 'airstrike': return handleAirstrikeAttack(x, y, piece);
    case 'bomb': return handleBombAttack(x, y, piece);
  }
}
function handleTorpedoAttack(x, y, piece) {
  if(!piece){ showNotification('Ошибка','Выберите фишку','error'); return; }
  if(parseInt(piece.dataset.owner)!==App.game.myPlayer){ showNotification('Ошибка','Выберите свою фишку','error'); return; }
  if(!torpedoState.t && piece.dataset.kind==='T'){ torpedoState.t=[x,y]; highlightCell(x,y,'selected'); showNotification('Торпедный выстрел','Теперь выберите торпедный катер (ТК)','info'); return; }
  if(torpedoState.t && !torpedoState.tk && piece.dataset.kind==='TK'){
    const [tx,ty]=torpedoState.t; if(Math.abs(x-tx)+Math.abs(y-ty)!==1){ showNotification('Ошибка','ТК должен быть рядом с Т','error'); return; }
    torpedoState.tk=[x,y]; highlightCell(x,y,'selected'); showTorpedoDirections(tx,ty); return;
  }
  if(torpedoState.t && torpedoState.tk && getCellElement(x,y).classList.contains('valid-move')){
    const [tx,ty]=torpedoState.t; torpedoState.direction=[x-tx,y-ty]; executeTorpedoAttack();
  }
}
function showTorpedoDirections(tx,ty){
  document.querySelectorAll('.cell.valid-move').forEach(cell => cell.classList.remove('valid-move'));
  const [tkx,tky]=torpedoState.tk; const back=[tkx-tx,tky-ty];
  const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  dirs.forEach(d => {
    if(d[0]===back[0] && d[1]===back[1]) return;
    const nx=tx+d[0], ny=ty+d[1];
    if(nx>=0 && nx<14 && ny>=0 && ny<15) highlightCell(nx,ny,'valid-move');
  });
  showNotification('Торпедный выстрел','Выберите направление выстрела','info');
}
async function executeTorpedoAttack() {
  try {
    const res = await api(`/game/torpedo/${App.game.id}/`, 'POST', { t: torpedoState.t, tk: torpedoState.tk, dir: torpedoState.direction });
    if(res.state) {
      App.game.state = res.state;
      renderGame();
      clearSelection();
      torpedoState = { t: null, tk: null, direction: null };
      App.game.specialAttackMode = null;
      document.querySelectorAll('.control-button').forEach(btn => btn.classList.remove('selected'));
      updateKilledTable();
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось выполнить торпедный выстрел: ' + err.message, 'error');
    torpedoState = { t: null, tk: null, direction: null };
    clearSelection();
  }
}
let airstrikeState = { a: null, s: null };
function handleAirstrikeAttack(x, y, piece) {
  if(!piece){ showNotification('Ошибка','Выберите фишку','error'); return; }
  if(parseInt(piece.dataset.owner)!==App.game.myPlayer){ showNotification('Ошибка','Выберите свою фишку','error'); return; }
  if(!airstrikeState.a && piece.dataset.kind==='A'){ airstrikeState.a=[x,y]; highlightCell(x,y,'selected'); showNotification('Воздушная атака','Теперь выберите самолёт (С)','info'); return; }
  if(airstrikeState.a && !airstrikeState.s && piece.dataset.kind==='S'){
    const [ax,ay]=airstrikeState.a; const dir = App.game.myPlayer===1 ? -1 : 1;
    if(x===ax && y===ay+dir){ airstrikeState.s=[x,y]; highlightCell(x,y,'selected'); executeAirstrikeAttack(); }
    else showNotification('Ошибка','Самолёт должен быть перед авианосцем','error');
  }
}
async function executeAirstrikeAttack() {
  try {
    const res = await api(`/game/air/${App.game.id}/`, 'POST', { a: airstrikeState.a, s: airstrikeState.s });
    if(res.state) {
      App.game.state = res.state;
      renderGame();
      clearSelection();
      airstrikeState = { a: null, s: null };
      App.game.specialAttackMode = null;
      document.querySelectorAll('.control-button').forEach(btn => btn.classList.remove('selected'));
      updateKilledTable();
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось выполнить воздушную атаку: ' + err.message, 'error');
    airstrikeState = { a: null, s: null };
    clearSelection();
  }
}
function handleBombAttack(x, y, piece) {
  if(!piece){ showNotification('Ошибка','Выберите фишку','error'); return; }
  if(parseInt(piece.dataset.owner)!==App.game.myPlayer){ showNotification('Ошибка','Выберите свою фишку','error'); return; }
  if(piece.dataset.kind!=='AB'){ showNotification('Ошибка','Выберите атомную бомбу (АБ)','error'); return; }
  const confirmModal = document.createElement('div');
  confirmModal.className = 'modal-backdrop';
  confirmModal.id = 'bombConfirmModal';
  confirmModal.innerHTML = `
    <div class="modal">
      <h3 class="modalTitle">Подтверждение</h3>
      <p class="text-center">Взорвать атомную бомбу? Это уничтожит фишки в радиусе 2 клеток.</p>
      <div class="btnRow">
        <button id="confirmBombBtn" class="menuButs xs danger">Взорвать</button>
        <button id="cancelBombBtn" class="menuButs xs">Отмена</button>
      </div>
    </div>`;
  document.body.appendChild(confirmModal);
  confirmModal.style.display = 'flex';
  document.getElementById('confirmBombBtn').addEventListener('click', async () => {
    confirmModal.style.display = 'none';
    try {
      const res = await api(`/game/bomb/${App.game.id}/`, 'POST', { ab: [x, y] });
      if(res.state) {
        App.game.state = res.state;
        renderGame();
        clearSelection();
        App.game.specialAttackMode = null;
        document.querySelectorAll('.control-button').forEach(btn => btn.classList.remove('selected'));
        updateKilledTable();
      }
    } catch(err) {
      showNotification('Ошибка', 'Не удалось выполнить атомный взрыв: ' + err.message, 'error');
    }
    document.body.removeChild(confirmModal);
  });
  document.getElementById('cancelBombBtn').addEventListener('click', () => {
    confirmModal.style.display = 'none';
    document.body.removeChild(confirmModal);
  });
}

// Группа/Атака
function handleGroupSelection(x, y) {
  const cell = getCellElement(x, y);
  const piece = cell.querySelector('.piece');
  if(!piece || parseInt(piece.dataset.owner) !== App.game.myPlayer){ showNotification('Ошибка', 'Выберите свою фишку', 'error'); return; }
  if(IMMOBILE_TYPES.includes(piece.dataset.kind)){ showNotification('Ошибка', 'Этот корабль неподвижен', 'error'); return; }
  if(App.game.selectedGroup.length === 0){
    App.game.selectedGroup.push({x, y, kind: piece.dataset.kind}); cell.classList.add('group-selected'); const ind=document.createElement('div'); ind.className='group-indicator'; cell.appendChild(ind); showNotification('Группа','Фишка добавлена (1/3)','info');
  } else if(App.game.selectedGroup.length < 3){
    const first = App.game.selectedGroup[0];
    if(piece.dataset.kind !== first.kind){ showNotification('Ошибка','Группа должна быть из одинаковых фишек','error'); return; }
    const adjacent = App.game.selectedGroup.some(gp => Math.abs(x-gp.x)+Math.abs(y-gp.y)===1);
    if(!adjacent){ showNotification('Ошибка','Фишки должны быть смежными','error'); return; }
    if(App.game.selectedGroup.some(gp => gp.x===x && gp.y===y)){ showNotification('Ошибка','Фишка уже в группе','error'); return; }
    App.game.selectedGroup.push({x,y,kind:piece.dataset.kind}); cell.classList.add('group-selected'); const ind=document.createElement('div'); ind.className='group-indicator'; cell.appendChild(ind);
    if(App.game.selectedGroup.length === 3) showGroupMoves();
  } else {
    showNotification('Информация','Максимум 3','info');
  }
}
function showGroupMoves() {
  document.querySelectorAll('.cell.valid-move').forEach(cell => cell.classList.remove('valid-move'));
  const adjacentCells = new Set();
  App.game.selectedGroup.forEach(piece => {
    const {x, y} = piece;
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy])=>{
      const nx=x+dx, ny=y+dy;
      if(nx>=0&&nx<14&&ny>=0&&ny<15 && !App.game.selectedGroup.some(p => p.x===nx && p.y===ny)){
        const pc = getCellElement(nx,ny).querySelector('.piece');
        if(!pc || parseInt(pc.dataset.owner)!==App.game.myPlayer) adjacentCells.add(`${nx},${ny}`);
      }
    });
  });
  adjacentCells.forEach(coord => { const [x, y] = coord.split(',').map(Number); highlightCell(x, y, 'valid-move'); });
  showNotification('Группа','Выберите клетку для перемещения группы','info');
}
function handleAttack(x, y){
  if(App.game.selectedPiece){
    const {x:fx, y:fy} = App.game.selectedPiece;
    const man = Math.abs(x-fx)+Math.abs(y-fy);
    if(man!==1){ showNotification('Ошибка','Атаковать можно только соседнюю клетку','error'); return; }
    moveAndAttack(fx, fy, x, y);
  } else {
    const cell = getCellElement(x, y), piece = cell.querySelector('.piece');
    if(!piece || parseInt(piece.dataset.owner)!==App.game.myPlayer){ showNotification('Ошибка','Выберите свою фишку для атаки','error'); return; }
    if(IMMOBILE_TYPES.includes(piece.dataset.kind)){ showNotification('Ошибка','Этот корабль неподвижен','error'); return; }
    App.game.selectedPiece = {x, y, kind: piece.dataset.kind}; highlightCell(x, y, 'selected'); showAttackZones(x, y);
  }
}
function showAttackZones(x, y){
  document.querySelectorAll('.cell.attack-zone').forEach(cell => cell.classList.remove('attack-zone'));
  [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}].forEach(dir=>{
    const nx=x+dir.dx, ny=y+dir.dy; 
    if(nx>=0&&nx<14&&ny>=0&&ny<15) {
      const piece = getCellElement(nx, ny).querySelector('.piece');
      if(!piece || parseInt(piece.dataset.owner) !== App.game.myPlayer) highlightCell(nx,ny,'attack-zone');
    }
  });
}
async function moveAndAttack(fx, fy, tx, ty){
  try{
    const res = await api(`/game/move/${App.game.id}/`, 'POST', { src:[fx,fy], dst:[tx,ty] });
    if(res.state){
      App.game.state = res.state; 
      renderGame(); 
      clearSelection();
      updateKilledTable();
    }
  }catch(err){ showNotification('Ошибка', 'Не удалось выполнить атаку: ' + err.message, 'error'); clearSelection(); }
}

// Перемещения
function handlePieceSelection(x, y){
  const cell = getCellElement(x, y), piece = cell.querySelector('.piece');
  if(App.game.selectedPiece){
    if(!getCellElement(x,y).classList.contains('valid-move')){ showNotification('Ошибка', 'Недопустимый ход', 'error'); clearSelection(); return; }
    movePiece(App.game.selectedPiece.x, App.game.selectedPiece.y, x, y);
  } else if(App.game.selectedGroup.length>0){
    if(!getCellElement(x,y).classList.contains('valid-move')){ showNotification('Ошибка','Недопустимый ход для группы','error'); return; }
    moveGroup(x, y);
  } else {
    if(!piece || parseInt(piece.dataset.owner)!==App.game.myPlayer){ showNotification('Ошибка','Выберите свою фишку','error'); return; }
    if(IMMOBILE_TYPES.includes(piece.dataset.kind)){ showNotification('Ошибка','Фишка неподвижна','error'); return; }
    App.game.selectedPiece = {x,y,kind:piece.dataset.kind}; highlightCell(x,y,'selected'); showValidMoves(x, y, piece.dataset.kind);
  }
}
async function movePiece(fx, fy, tx, ty){
  try{
    const res = await api(`/game/move/${App.game.id}/`, 'POST', { src:[fx,fy], dst:[tx,ty] });
    if(res.state){
      App.game.state = res.state; 
      renderGame(); 
      clearSelection();
      updateKilledTable();
    }
  }catch(err){ showNotification('Ошибка', 'Не удалось переместить фишку: ' + err.message, 'error'); clearSelection(); }
}
async function moveGroup(toX, toY){
  if(App.game.selectedGroup.length===0) return;
  try{
    const first = App.game.selectedGroup[0];
    const followers = App.game.selectedGroup.slice(1).map(p => [p.x, p.y, toX, toY]);
    const res = await api(`/game/move/${App.game.id}/`, 'POST', { src:[first.x, first.y], dst:[toX,toY], followers });
    if(res.state){
      App.game.state = res.state; 
      renderGame(); 
      clearGroupSelection();
      updateKilledTable();
    }
  }catch(err){ showNotification('Ошибка', 'Не удалось переместить группу: ' + err.message, 'error'); clearGroupSelection(); }
}
function showValidMoves(x, y, kind){
  document.querySelectorAll('.cell.valid-move').forEach(c => c.classList.remove('valid-move'));
  const special = SPECIAL_MOVES[kind];
  if(typeof special === 'number'){
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(d=>{
      for(let i=1;i<=special;i++){
        const nx=x+d[0]*i, ny=y+d[1]*i;
        if(nx>=0&&nx<14&&ny>=0&&ny<15){
          const piece = getCellElement(nx,ny).querySelector('.piece');
          if(piece && parseInt(piece.dataset.owner) === App.game.myPlayer) break;
          highlightCell(nx,ny,'valid-move');
          if(piece) break;
        }
      }
    });
  }else{
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(d=>{
      const nx=x+d[0], ny=y+d[1];
      if(nx>=0&&nx<14&&ny>=0&&ny<15){
        const piece = getCellElement(nx,ny).querySelector('.piece');
        if(!piece || parseInt(piece.dataset.owner)!==App.game.myPlayer) highlightCell(nx,ny,'valid-move');
      }
    });
  }
}

// Размещение
async function placeShip(x, y, shipType){
  const validZone = (App.game.myPlayer===1 && y>=10) || (App.game.myPlayer===2 && y<5);
  if(!validZone){ showNotification('Ошибка', 'Можно расставлять только в своей зоне', 'error'); return; }
  if(App.game.shipCounts[shipType] <= 0){ showNotification('Ошибка', 'Корабли этого типа закончились', 'error'); return; }
  if(getCellElement(x,y).querySelector('.piece')){ showNotification('Ошибка', 'Клетка уже занята', 'error'); return; }
  try{
    const res = await api(`/game/setup/${App.game.id}/`, 'POST', { placements: [{ x, y, kind: convertToApiShipType(shipType) }] });
    if(res.state){
      App.game.state = res.state; 
      App.game.shipCounts[shipType]--; 
      updateShipCounts(); 
      renderGame();
      checkAllShipsPlaced();
      showNotification('Успех', `${shipType} размещен`, 'success');
    }
  }catch(err){ showNotification('Ошибка', 'Не удалось разместить корабль: ' + err.message, 'error'); }
}
function checkAllShipsPlaced() {
  let allPlaced = true;
  Object.keys(SHIP_TYPES).forEach(type => { if(App.game.shipCounts[type] > 0) allPlaced = false; });
  if(allPlaced && !App.game.allShipsPlaced) { App.game.allShipsPlaced = true; submitSetup(); }
}
async function clearSetup() {
  try {
    const res = await api(`/game/clear_setup/${App.game.id}/`, 'POST', {});
    if(res.state){
      App.game.state = res.state;
      initializeShipCounts();
      updateShipCounts();
      renderGame();
      showNotification('Успех','Расстановка очищена','success');
    }
  } catch (err) {
    showNotification('Ошибка','Не удалось очистить расстановку: '+err.message,'error');
  }
}
function convertToApiShipType(t){ const map={'БДК':'BDK','КР':'KR','А':'A','С':'S','ТН':'TN','Л':'L','ЭС':'ES','М':'M','СМ':'SM','Ф':'F','ТК':'TK','Т':'T','ТР':'TR','СТ':'ST','ПЛ':'PL','КРПЛ':'KRPL','АБ':'AB','ВМБ':'VMB'}; return map[t]||t; }
function convertFromApiShipType(t){ const map={'BDK':'БДК','KR':'КР','A':'А','S':'С','TN':'ТН','L':'Л','ES':'ЭС','M':'М','SM':'СМ','F':'Ф','TK':'ТК','T':'Т','TR':'ТР','ST':'СТ','PL':'ПЛ','KRPL':'КРПЛ','AB':'АБ','VMB':'ВМБ'}; return map[t]||t; }
function updateShipCounts(){ Object.keys(SHIP_TYPES).forEach(type => { document.querySelectorAll(`[data-ship="${type}"] .ship-count`).forEach(span => { if(span) span.textContent = App.game.shipCounts[type] || 0; }); }); }
function getCellElement(x, y){ return document.querySelector(`[data-x="${x}"][data-y="${y}"]`); }
function highlightCell(x, y, cls){ const cell = getCellElement(x,y); if(cell) cell.classList.add(cls); }
function clearSelection(){ App.game.selectedPiece=null; App.game.selectedCells=[]; document.querySelectorAll('.cell').forEach(cell => cell.classList.remove('selected', 'valid-move', 'attack-zone')); }
function clearGroupSelection(){ document.querySelectorAll('.cell.group-selected').forEach(cell => cell.classList.remove('group-selected')); document.querySelectorAll('.group-indicator').forEach(ind => ind.remove()); App.game.selectedGroup=[]; }

// Убитые фишки
function updateKilledTable(){
  const killedTableBody = document.getElementById('killedTableBody'); 
  if(!killedTableBody) return;
  api(`/game/killed/${App.game.id}/`).then(data=>{
    const items=data.items||[]; 
    killedTableBody.innerHTML='';
    if(items.length===0){ killedTableBody.innerHTML='<tr><td colspan="3">Нет данных</td></tr>'; return; }
    items.forEach(it=>{
      const ru = convertFromApiShipType(it.piece);
      const tr = document.createElement('tr'); 
      tr.innerHTML = `<td>${ru}</td><td>${it.killed}</td><td>${SHIP_TYPES[ru]?.count || '-'}</td>`;
      killedTableBody.appendChild(tr);
    });
  }).catch(()=>{ killedTableBody.innerHTML='<tr><td colspan="3">Ошибка загрузки</td></tr>'; });
}

// Таймеры и поллинг
function startSetupTimer(minutes) {
  if(App.game.setupTimer) clearInterval(App.game.setupTimer);
  const deadline = new Date(); deadline.setMinutes(deadline.getMinutes() + minutes);
  App.game.setupDeadline = deadline;
  updateSetupTimerDisplay();
  App.game.setupTimer = setInterval(updateSetupTimerDisplay, 1000);
}
function updateSetupTimerDisplay() {
  if (!App.game.setupDeadline) return;
  const hudTimer = document.getElementById('hudTimer'); if(!hudTimer) return;
  const now = new Date();
  const diff = Math.max(0, Math.floor((App.game.setupDeadline - now) / 1000));
  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;
  hudTimer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  if (diff <= 0) {
    if (App.game.setupTimer) { clearInterval(App.game.setupTimer); App.game.setupTimer = null; }
    if (App.game.setupPhase && !App.game.allShipsPlaced) autoSetup();
  }
}
function startGamePolling() {
  if (App.game.pollTimer) clearInterval(App.game.pollTimer);
  App.game.pollTimer = setInterval(async () => {
    if (!App.game.id) return;
    try {
      const d = await api(`/game/state/${App.game.id}/`);
      if (d && d.state) {
        const oldPhase = App.game.state?.phase;
        const oldTurn = App.game.state?.turn;
        App.game.state = d.state;
        if (oldPhase === 'SETUP' && d.state.phase !== 'SETUP') {
          App.game.setupPhase = false;
          showNotification('Игра началась!', 'Фаза расстановки завершена', 'success');
          if (waitOpponentModal) waitOpponentModal.style.display = 'none';
          if (App.game.setupTimer) { clearInterval(App.game.setupTimer); App.game.setupTimer = null; }
          createGameUI();
        }
        renderGame();
        if (d.state.winner) showGameResult(d.state.winner, d.state.win_reason);
      }
      const t = await api(`/game/timers/${App.game.id}/`);
      if (t) {
        updateTimers(t);
        App.game.pausesUsed.short = !t.short_available;
        App.game.pausesUsed.long = !t.long_available;
        if (t.paused && typeof t.pause_left === 'number') showPauseOverlay(t.pause_left, (t.pause_initiator === App.game.myPlayer));
        else hidePauseOverlay();
        if (t.finished && t.winner_player) showGameResult(t.winner_player, t.reason);
      }
    } catch (err) {}
  }, 1000);
}
function updateTimers(data) {
  const hudTimer = document.getElementById('hudTimer');
  const hudBank = document.getElementById('hudBank');
  const turnIndicator = document.getElementById('turnIndicator');
  if (hudTimer && typeof data.turn_left === 'number') {
    hudTimer.textContent = `${data.turn_left}s`;
    hudTimer.style.color = data.turn_left <= 10 ? '#ff5e2c' : '';
  }
  if (hudBank && typeof data.bank_left === 'number') {
    const minutes = Math.floor(data.bank_left / 60), seconds = data.bank_left % 60;
    hudBank.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
    hudBank.style.color = data.bank_left <= 60 ? '#ff5e2c' : '';
  }
  if (turnIndicator && typeof data.turn !== 'undefined' && !App.game.setupPhase) {
    const isMyTurn = (data.turn === App.game.myPlayer);
    turnIndicator.textContent = isMyTurn ? 'Ваш ход' : 'Ход соперника';
    turnIndicator.style.color = isMyTurn ? '#27e881' : '#ff5e2c';
  }
}

// Пауза/Результат
function showPauseOverlay(seconds, isInitiator) {
  pauseModalOverlay.style.display = 'flex';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  pauseTimer.textContent = `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  pauseControls.style.display = isInitiator ? 'block' : 'none';
  pauseInfo.textContent = isInitiator ? 'Вы поставили игру на паузу' : 'Соперник поставил игру на паузу';
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
function hidePauseOverlay() { pauseModalOverlay.style.display = 'none'; }

function openResignModal(){
  const m = document.createElement('div'); m.className='modal-backdrop';
  m.innerHTML = `<div class="modal"><h3 class="modalTitle">Подтверждение</h3><p class="text-center">Сдаться и засчитать поражение?</p><div class="btnRow"><button id="confirmResignBtn" class="menuButs xs danger">Сдаться</button><button id="cancelResignBtn" class="menuButs xs">Отмена</button></div></div>`;
  document.body.appendChild(m); m.style.display='flex';
  m.querySelector('#confirmResignBtn').addEventListener('click', async ()=>{
    m.style.display='none';
    try{ const res = await api(`/game/resign/${App.game.id}/`,'POST',{}); if(res.ok){ App.game.state=res.state; showGameResult(3-App.game.myPlayer,'resign'); } }catch{}
    document.body.removeChild(m);
  });
  m.querySelector('#cancelResignBtn').addEventListener('click', ()=>{ m.style.display='none'; document.body.removeChild(m); });
}
function showGameResult(winner, reason) {
  if (App.game.pollTimer) { clearInterval(App.game.pollTimer); App.game.pollTimer = null; }
  const isWinner = (winner === App.game.myPlayer);
  resultTitle.textContent = isWinner ? 'Победа!' : 'Поражение';
  resultTitle.className = `result-title ${isWinner ? 'victory' : 'defeat'}`;
  const reasons = {bases:'Уничтожены военно-морские базы',moves:'Уничтожены все движущиеся корабли',time:'Закончилось время',resign:isWinner?'Противник сдался':'Вы сдались'};
  resultDetails.innerHTML = `<p>${reasons[reason] || 'Игра завершена'}</p>`;
  ratingChange.textContent = isWinner ? 'Рейтинг: +100 очков' : 'Рейтинг: -100 очков';
  ratingChange.className = `rating-change ${isWinner ? 'positive' : 'negative'}`;
  gameResultModal.style.display = 'flex';
  if(gameResultExit) gameResultExit.onclick = () => {
    gameResultModal.style.display = 'none';
    showContent('lobby'); setTimeout(() => { loadUsers(''); loadFriends(); }, 100);
  };
}

// Start game
async function startGameByRoomUrl(url) {
  const code = url.split('/').filter(Boolean).pop();
  try {
    const d = await api(`/game/by-code/${code}/`);
    App.game.id = d.id;
    App.game.state = d.state;
    App.game.myPlayer = d.my_player;
    App.game.setupPhase = d.state.phase === 'SETUP';
    App.game.pausesUsed = { short: false, long: false };
    App.game.selectedGroup = [];
    App.game.allShipsPlaced = false;
    initializeShipCounts();
    showContent('game');
    createGameUI();
    renderGame();
    startGamePolling();
    if (App.game.setupPhase) { showNotification('Расстановка', 'Разместите все фишки в своей зоне. У вас 15 минут.', 'info'); startSetupTimer(15); }
  } catch (err) {
    showNotification('Ошибка', 'Не удалось открыть игру: ' + err.message, 'error');
  }
}
async function submitSetup() {
  let allPlaced = true; Object.keys(SHIP_TYPES).forEach(t => { if (App.game.shipCounts[t] > 0) allPlaced = false; });
  if (!allPlaced) { showNotification('Ошибка', 'Сначала нужно разместить все фишки', 'error'); return; }
  try {
    const res = await api(`/game/submit_setup/${App.game.id}/`, 'POST', {});
    if (res && res.ok) {
      showNotification('Готово', 'Расстановка подтверждена', 'success');
      waitOpponentModal.style.display = 'flex';
      if (res.status !== 'SETUP') {
        App.game.setupPhase = false;
        if (App.game.state) { App.game.state.phase = res.status; App.game.state.turn = res.turn; }
        waitOpponentModal.style.display = 'none';
        if (App.game.setupTimer) { clearInterval(App.game.setupTimer); App.game.setupTimer = null; }
        createGameUI();
        renderGame();
      }
    }
  } catch (err) { showNotification('Ошибка', 'Не удалось подтвердить расстановку: ' + err.message, 'error'); }
}
async function autoSetup() {
  if (!App.game.id) return;
  try {
    const res = await api(`/game/autosetup/${App.game.id}/`, 'POST', {});
    if (res && res.state) {
      App.game.state = res.state;
      Object.keys(App.game.shipCounts).forEach(t => App.game.shipCounts[t] = 0);
      updateShipCounts();
      renderGame();
      showNotification('Успех', 'Автоматическая расстановка завершена', 'success');
      App.game.allShipsPlaced = true;
      submitSetup();
    }
  } catch (err) { showNotification('Ошибка', 'Ошибка автоматической расстановки: ' + err.message, 'error'); }
}

// Рендер состояния игры
function renderGame() {
  const st = App.game.state || {};
  clearBoard();
  const boardEl = document.getElementById('board'); if(!boardEl) return;
  const board = st.board || {};
  Object.keys(board).forEach(k => {
    const [x, y] = k.split(',').map(Number);
    const cell = getCellElement(x, y);
    const pieces = board[k];
    if (cell && pieces && pieces.length > 0) {
      const p = pieces[0];
      if (App.game.setupPhase && p.owner !== App.game.myPlayer) return;
      if (!App.game.setupPhase && p.owner !== App.game.myPlayer && p.alive) return;
      const span = document.createElement('span');
      span.className = `piece owner${p.owner} ${classKind(p.kind)}`;
      span.textContent = labelKind(p.kind);
      span.dataset.kind = p.kind;
      span.dataset.owner = p.owner;
      if (!p.alive) span.classList.add('destroyed');
      cell.appendChild(span);
    }
  });
  fitBoard();
  updateKilledTable();
}

// Вкладки и история
async function loadHistory() {
  try {
    const d = await api('/game/my/');
    const items = d.items || [];
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    historyList.innerHTML = '';
    if (items.length === 0) { historyList.innerHTML = '<li>История пуста</li>'; return; }
    items.forEach(g => {
      const li = document.createElement('li');
      li.innerHTML = `<div><strong>Игра с ${g.opponent}</strong><br><span class="muted">${g.created_at} • ${g.result}</span></div><div class="tag">${g.status}</div>`;
      historyList.appendChild(li);
    });
  } catch (err) {
    const historyList = document.getElementById('historyList');
    if (historyList) historyList.innerHTML = '<li>Ошибка загрузки</li>';
  }
}

// Хелперы
function labelKind(kind) { return convertFromApiShipType(kind); }
function classKind(kind) { return 'kind' + convertFromApiShipType(kind); }

// Инициализация
function init() {
  renderTopRight();
  initTabs();
  activateLobbyTab('pane-quick');
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();