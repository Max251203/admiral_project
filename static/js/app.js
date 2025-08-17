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
  setTimeout(() => notification.classList.add('show'), 100);
  setTimeout(() => { notification.classList.remove('show'); setTimeout(() => notification.remove(), 300); }, 4000);
}

// Константы игрового набора
const SHIP_TYPES = {
  'БДК': { count: 2, rating: 18, color: '#b93b2e' },
  'КР': { count: 6, rating: 15, color: '#1c6fb1' },
  'А': { count: 1, rating: 16, color: '#b93b2e' },
  'С': { count: 1, rating: 7, color: '#b93b2e' },
  'ТН': { count: 1, rating: 8, color: '#d35400' },
  'Л': { count: 2, rating: 17, color: '#1c6fb1' },
  'ЭС': { count: 6, rating: 13, color: '#1c6fb1' },
  'М': { count: 6, rating: 4, color: '#6e7b85' },
  'СМ': { count: 1, rating: 3, color: '#6e7b85' },
  'Ф': { count: 6, rating: 14, color: '#1c6fb1' },
  'ТК': { count: 6, rating: 10, color: '#1f8f55' },
  'Т': { count: 6, rating: 9, color: '#1f8f55' },
  'ТР': { count: 6, rating: 11, color: '#1f8f55' },
  'СТ': { count: 6, rating: 12, color: '#1c6fb1' },
  'ПЛ': { count: 1, rating: 6, color: '#0b4f6c' },
  'КРПЛ': { count: 1, rating: 5, color: '#0b4f6c' },
  'АБ': { count: 1, rating: 2, color: '#b93b2e' },
  'ВМБ': { count: 2, rating: 1, color: '#95a5a6', immobile: true }
};

// Особые правила (по правилам игры)
const SPECIAL_KILLS = {
  'ПЛ': ['БДК', 'А'],
  'КРПЛ': ['КР'],
  'ТР': ['М']
};
const IMMOBILE_TYPES = ['ВМБ', 'СМ'];
const SPECIAL_MOVES = { 'ТК': 2, 'М': { carrier: 'ЭС', range: 1 }, 'Т': { carrier: 'ТК', range: 1 }, 'С': { carrier: 'А', range: 1 } };

// Глобальный стейт
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
    setupTimer: null, setupDeadline: null
  },
  pauseTimer: null
};

// DOM ссылки
const msContainer = document.getElementById('msContainer');
const menu = document.getElementById('menu');
const settings = document.getElementById('settings');
const settExit = document.getElementById('settExit');

const startBut = document.getElementById('startBut');
const rulesBut = document.getElementById('rulesBut');

const profileBtn = document.getElementById('profileBtn');
const logoutBtn = document.getElementById('logoutBtn');
const profileAvatar = document.getElementById('profileAvatar');
const profileName = document.getElementById('profileName');

const rulesContent = document.getElementById('rulesContent');
const lobbyContent = document.getElementById('lobbyContent');
const gameContent = document.getElementById('gameContent');

const quickBtn = document.getElementById('quickBtn');
const showMeBtn = document.getElementById('showMeBtn');

const userSearch = document.getElementById('userSearch');
const friendSearch = document.getElementById('friendSearch');
const usersList = document.getElementById('usersList');
const friendsList = document.getElementById('friendsList');

// game
const boardEl = document.getElementById('board');
const turnIndicator = document.getElementById('turnIndicator');
const hudTimer = document.getElementById('hudTimer');
const hudBank = document.getElementById('hudBank');
const shipsContainer = document.getElementById('shipsContainer');
const pauseBtn = document.getElementById('pauseBtn');
const resignBtn = document.getElementById('resignBtn');

// modals
const profileModal = document.getElementById('profileModal');
const profileForm = document.getElementById('profileForm');
const pLogin = document.getElementById('pLogin');
const pUsername = document.getElementById('pUsername');
const pEmail = document.getElementById('pEmail');
const pAvatar = document.getElementById('pAvatar');
const pAvatarPreview = document.getElementById('pAvatarPreview');

const authModal = document.getElementById('authModal');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

const inviteModal = document.getElementById('inviteModal');
const inviteText = document.getElementById('inviteText');
const inviteAccept = document.getElementById('inviteAccept');
const inviteDecline = document.getElementById('inviteDecline');

const waitModal = document.getElementById('waitModal');
const waitText = document.getElementById('waitText');
const waitCancel = document.getElementById('waitCancel');

const waitOpponentModal = document.getElementById('waitOpponentModal');
const setupTimerDisplay = document.getElementById('setupTimerDisplay');

const gameResultModal = document.getElementById('gameResultModal');
const gameResultExit = document.getElementById('gameResultExit');
const resultTitle = document.getElementById('resultTitle');
const resultDetails = document.getElementById('resultDetails');
const ratingChange = document.getElementById('ratingChange');

const pauseModal = document.getElementById('pauseModal');
const shortPauseBtn = document.getElementById('shortPauseBtn');
const longPauseBtn = document.getElementById('longPauseBtn');
const cancelPauseBtn = document.getElementById('cancelPauseBtn');

const pauseModalOverlay = document.getElementById('pauseModalOverlay');
const pauseTimer = document.getElementById('pauseTimer');
const pauseInfo = document.getElementById('pauseInfo');
const pauseControls = document.getElementById('pauseControls');

// UI helpers
function showContent(contentType){
  [rulesContent, lobbyContent, gameContent].forEach(pane => pane.style.display = 'none');
  if(contentType === 'rules'){ rulesContent.style.display = 'block'; }
  else if(contentType === 'lobby'){ lobbyContent.style.display = 'block'; }
  else if(contentType === 'game'){ gameContent.style.display = 'block'; }
  msContainer.classList.add('flip');
}
function showMenu(){
  msContainer.classList.remove('flip');
  if(App.game.pollTimer){ clearInterval(App.game.pollTimer); App.game.pollTimer = null; }
  if(App.game.setupTimer){ clearInterval(App.game.setupTimer); App.game.setupTimer = null; }
}
function renderTopRight(){
  if(profileAvatar && profileName) {
    profileAvatar.src = App.meAvatar || '/static/img/avatar_stub.png';
    profileName.textContent = App.isAuth ? (App.meLogin || 'Профиль') : 'Войти';
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

// Tabs
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

// Меню
startBut.addEventListener('click', () => {
  showContent('lobby');
  setTimeout(() => { loadUsers(''); loadFriends(); }, 100);
});
rulesBut.addEventListener('click', () => showContent('rules'));
settExit.addEventListener('click', () => showMenu());

// Профиль/Auth/Logout
profileBtn.addEventListener('click', () => App.isAuth ? openProfile() : openAuth());
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
if(pAvatar) pAvatar.addEventListener('change', (e) => {
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
  // Подмешиваем себя корректно (без дубликатов)
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
    }).catch(()=>renderUsersList(arr));
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
        <button class="menuButs xs" data-invite="${u.id}">Пригласить</button>
        <button class="menuButs xs" data-add="${u.id}" data-login="${u.login}">Добавить</button>
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

// Фильтрация друзей
function filterFriends(query) {
  const items = friendsList.querySelectorAll('li');
  if(!items.length) return;
  
  query = query.toLowerCase();
  items.forEach(item => {
    const login = item.querySelector('strong').textContent.toLowerCase();
    if(login.includes(query)) {
      item.style.display = '';
    } else {
      item.style.display = 'none';
    }
  });
}

async function loadFriends(){
  if(!friendsList) return;
  try{
    const data = await api('/accounts/api/friends/');
    const items = data.items || [];
    
    // Получаем дополнительную информацию о каждом друге
    const friendsWithInfo = [];
    for(const friend of items) {
      try {
        const info = await api(`/accounts/api/users/${friend.id}/`);
        friendsWithInfo.push({
          ...friend,
          rating: info.rating || 0,
          wins: info.wins || 0,
          losses: info.losses || 0
        });
      } catch(e) {
        friendsWithInfo.push(friend);
      }
    }
    
    // Сортируем по рейтингу
    friendsWithInfo.sort((a, b) => (ratingValue(b) - ratingValue(a)));
    
    friendsList.innerHTML='';
    if(friendsWithInfo.length===0){ friendsList.innerHTML='<li>Нет друзей</li>'; return; }
    
    friendsWithInfo.forEach((u, index) => {
      const rating = ratingValue(u);
      const li = document.createElement('li');
      li.innerHTML = `
        <div>
          <strong>${u.login}</strong><br>
          <span class="muted">Рейтинг: ${rating} • Побед: ${u.wins || 0} • Поражений: ${u.losses || 0}</span>
        </div>
        <div style="display:flex;gap:.4rem">
          <button class="menuButs xs" data-invite="${u.id}">Пригласить</button>
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
      }
      catch(e){ showNotification('Ошибка', 'Не удалось удалить друга', 'error'); }
    }));
  }catch(err){ friendsList.innerHTML='<li>Ошибка загрузки</li>'; }
}

async function inviteUser(uid){
  if(!App.isAuth){ openAuth(); return; }
  try{
    const r = await api(`/match/invite_ajax/${uid}/`);
    if(r.ok){
      showWaiting('Ожидаем ответ соперника...', async () => { await api(`/match/invite/${r.token}/cancel/`); }, r.token);
    }
  }catch(err){ showNotification('Ошибка', 'Не удалось отправить приглашение', 'error'); }
}

// Waiting/Invite modals
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
  }
  catch(err) { 
    showNotification('Ошибка', 'Не удалось принять приглашение', 'error'); 
  }
});
if(inviteDecline) inviteDecline.addEventListener('click', async () => {
  if(!currentInviteToken) return;
  try { 
    await api(`/match/invite/${currentInviteToken}/decline/`, 'POST'); 
    inviteModal.style.display = 'none'; 
    currentInviteToken = null; 
    showNotification('Информация', 'Приглашение отклонено', 'info'); 
  }
  catch(err) { 
    showNotification('Ошибка', 'Ошибка отклонения приглашения', 'error'); 
  }
});

// Notifications polling
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

// Quick match
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

function createShipsList() {
  if(!shipsContainer) return;
  
  // Создаем обертку для скролла
  shipsContainer.innerHTML = '<div class="ships-panel-inner" id="shipsPanelInner"></div>';
  const shipsPanelInner = document.getElementById('shipsPanelInner');
  
  if(!shipsPanelInner) return;
  
  Object.keys(SHIP_TYPES).forEach(type => {
    const count = App.game.shipCounts[type] || 0;
    const item = document.createElement('div');
    item.className = 'ship-item';
    item.dataset.ship = type;
    item.innerHTML = `${type} <span class="ship-count">${count}</span>`;
    item.addEventListener('click', () => selectShip(type));
    shipsPanelInner.appendChild(item);
  });
}

function createControlsPanel() {
  const controlsContainer = document.getElementById('controlsContainer');
  if(!controlsContainer) return;
  
  // Создаем обертку для скролла
  controlsContainer.innerHTML = '<div class="controls-panel-inner" id="controlsPanelInner"></div>';
  const controlsPanelInner = document.getElementById('controlsPanelInner');
  
  if(!controlsPanelInner) return;
  
  if(App.game.setupPhase) {
    const autoPlaceBtn = document.createElement('div');
    autoPlaceBtn.className = 'control-button';
    autoPlaceBtn.id = 'autoPlaceBtn';
    autoPlaceBtn.innerHTML = `Авто <div class="tooltip">Автоматическое размещение всех кораблей</div>`;
    autoPlaceBtn.addEventListener('click', autoSetup);
    
    const readyBtn = document.createElement('div');
    readyBtn.className = 'control-button';
    readyBtn.id = 'readyBtn';
    readyBtn.innerHTML = `Готов <div class="tooltip">Подтвердить готовность к игре</div>`;
    readyBtn.addEventListener('click', submitSetup);
    
    controlsPanelInner.appendChild(autoPlaceBtn);
    controlsPanelInner.appendChild(readyBtn);
  } else {
    const groupBtn = document.createElement('div');
    groupBtn.className = 'control-item';
    groupBtn.id = 'groupBtn';
    groupBtn.textContent = 'Группа';
    groupBtn.addEventListener('click', toggleGroupMode);
    
    const attackBtn = document.createElement('div');
    attackBtn.className = 'control-item';
    attackBtn.id = 'attackBtn';
    attackBtn.textContent = 'Атака';
    attackBtn.addEventListener('click', toggleAttackMode);
    
    controlsPanelInner.appendChild(groupBtn);
    controlsPanelInner.appendChild(attackBtn);
  }
}

function toggleGroupMode() {
  const groupBtn = document.getElementById('groupBtn');
  if(App.game.groupMode){
    App.game.groupMode = false; groupBtn.classList.remove('selected'); clearGroupSelection();
  } else {
    App.game.groupMode = true; App.game.attackMode = false; App.game.selectedShip = null; App.game.selectedPiece = null;
    groupBtn.classList.add('selected');
    document.getElementById('attackBtn')?.classList.remove('selected');
    document.querySelectorAll('.ship-item').forEach(item => item.classList.remove('selected'));
    clearSelection();
  }
}
function toggleAttackMode() {
  const attackBtn = document.getElementById('attackBtn');
  if(App.game.attackMode){
    App.game.attackMode = false; attackBtn.classList.remove('selected');
  } else {
    App.game.attackMode = true; App.game.groupMode = false; App.game.selectedShip = null; App.game.selectedPiece = null;
    attackBtn.classList.add('selected');
    document.getElementById('groupBtn')?.classList.remove('selected');
    document.querySelectorAll('.ship-item').forEach(item => item.classList.remove('selected'));
    clearSelection(); clearGroupSelection();
  }
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
    App.game.selectedShip = type; App.game.selectedPiece = null; App.game.groupMode = false; App.game.attackMode = false;
    document.querySelectorAll('.control-button, .control-item').forEach(btn => btn.classList.remove('selected'));
    clearSelection(); clearGroupSelection();
  }
}

function clearBoard(){
  if(!boardEl) return;
  boardEl.innerHTML = '';
  for(let r = 0; r < 15; r++){
    for(let c = 0; c < 14; c++){
      const cell = document.createElement('div');
      cell.className = 'cell'; cell.dataset.x = c; cell.dataset.y = r;
      if(App.game.myPlayer === 1) { if(r >= 10) cell.classList.add('my-zone'); else if(r < 5) cell.classList.add('enemy-zone'); }
      else { if(r < 5) cell.classList.add('my-zone'); else if(r >= 10) cell.classList.add('enemy-zone'); }
      cell.addEventListener('click', handleCellClick);
      boardEl.appendChild(cell);
    }
  }
}

function handleCellClick(e) {
  const cell = e.currentTarget;
  const x = parseInt(cell.dataset.x), y = parseInt(cell.dataset.y);
  
  if(App.game.setupPhase && App.game.selectedShip) {
    placeShip(x, y, App.game.selectedShip);
  }
  else if(!App.game.setupPhase){
    if(App.game.state.turn !== App.game.myPlayer){ 
      showNotification('Ошибка', 'Сейчас не ваш ход', 'error'); 
      return; 
    }
    
    if(App.game.groupMode) {
      handleGroupSelection(x, y);
    }
    else if(App.game.attackMode) {
      handleAttack(x, y);
    }
    else {
      handlePieceSelection(x, y);
    }
  }
}

// Группа
function handleGroupSelection(x, y) {
  const cell = getCellElement(x, y);
  const piece = cell.querySelector('.piece');
  if(!piece || parseInt(piece.dataset.owner) !== App.game.myPlayer){ 
    showNotification('Ошибка', 'Выберите свою фишку', 'error'); 
    return; 
  }
  if(IMMOBILE_TYPES.includes(piece.dataset.kind)){ 
    showNotification('Ошибка', 'Этот корабль неподвижен', 'error'); 
    return; 
  }
  
  if(App.game.selectedGroup.length === 0){
    App.game.selectedGroup.push({x, y, kind: piece.dataset.kind}); 
    cell.classList.add('group-selected'); 
    const ind = document.createElement('div'); 
    ind.className='group-indicator'; 
    cell.appendChild(ind);
  } else if(App.game.selectedGroup.length < 3){
    const first = App.game.selectedGroup[0];
    if(piece.dataset.kind !== first.kind){ 
      showNotification('Ошибка', 'Группа — только одного типа', 'error'); 
      return; 
    }
    let adjacent = App.game.selectedGroup.some(gp => Math.abs(x-gp.x)+Math.abs(y-gp.y)===1);
    if(!adjacent){ 
      showNotification('Ошибка', 'Должна быть смежность', 'error'); 
      return; 
    }
    if(App.game.selectedGroup.some(gp => gp.x===x && gp.y===y)){ 
      showNotification('Ошибка', 'Уже в группе', 'error'); 
      return; 
    }
    App.game.selectedGroup.push({x,y,kind:piece.dataset.kind}); 
    cell.classList.add('group-selected'); 
    const ind = document.createElement('div'); 
    ind.className='group-indicator'; 
    cell.appendChild(ind);
  } else {
    showNotification('Информация', 'Максимум 3 в группе', 'info');
  }
}

// Атака (соседняя клетка)
function handleAttack(x, y){
  if(App.game.selectedPiece){
    const {x:fx, y:fy} = App.game.selectedPiece;
    const man = Math.abs(x-fx)+Math.abs(y-fy);
    if(man!==1){ 
      showNotification('Ошибка', 'Атаковать можно соседнюю клетку', 'error'); 
      return; 
    }
    moveAndAttack(fx, fy, x, y);
  } else {
    const cell = getCellElement(x, y), piece = cell.querySelector('.piece');
    if(!piece || parseInt(piece.dataset.owner)!==App.game.myPlayer){ 
      showNotification('Ошибка', 'Выберите свою фишку для атаки', 'error'); 
      return; 
    }
    if(IMMOBILE_TYPES.includes(piece.dataset.kind)){ 
      showNotification('Ошибка', 'Этот корабль неподвижен', 'error'); 
      return; 
    }
    App.game.selectedPiece = {x, y, kind: piece.dataset.kind}; 
    highlightCell(x, y, 'selected'); 
    showAttackZones(x, y);
  }
}

function showAttackZones(x, y){
  document.querySelectorAll('.cell.attack-zone').forEach(cell => cell.classList.remove('attack-zone'));
  [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}].forEach(dir=>{
    const nx=x+dir.dx, ny=y+dir.dy; 
    if(nx>=0&&nx<14&&ny>=0&&ny<15) {
      highlightCell(nx,ny,'attack-zone');
    }
  });
}

async function moveAndAttack(fx, fy, tx, ty){
  try{
    // Анимация перемещения
    const srcCell = getCellElement(fx, fy);
    const dstCell = getCellElement(tx, ty);
    const piece = srcCell.querySelector('.piece');
    
    if(piece) {
      // Клонируем фишку для анимации
      const clone = piece.cloneNode(true);
      document.body.appendChild(clone);
      
      // Позиционируем клон над исходной фишкой
      const srcRect = srcCell.getBoundingClientRect();
      const dstRect = dstCell.getBoundingClientRect();
      
      clone.style.position = 'fixed';
      clone.style.zIndex = '1000';
      clone.style.top = srcRect.top + 'px';
      clone.style.left = srcRect.left + 'px';
      clone.style.width = srcRect.width + 'px';
      clone.style.height = srcRect.height + 'px';
      
      // Вычисляем смещение для анимации
      const moveX = dstRect.left - srcRect.left;
      const moveY = dstRect.top - srcRect.top;
      
      clone.style.setProperty('--move-x', moveX + 'px');
      clone.style.setProperty('--move-y', moveY + 'px');
      clone.classList.add('piece-moving');
      
            // Ждем завершения анимации
      await new Promise(resolve => setTimeout(resolve, 500));
      clone.remove();
    }
    
    const res = await api(`/game/move/${App.game.id}/`, 'POST', { src:[fx,fy], dst:[tx,ty] });
    if(res.state){
      App.game.state = res.state; 
      renderGame(); 
      clearSelection();
      if(res.res && res.res.event){ 
        showNotification('Результат', res.res.event, 'success'); 
      }
      updateKilledTable();
    }
  }catch(err){ 
    showNotification('Ошибка', 'Не удалось выполнить атаку: ' + err.message, 'error'); 
    clearSelection(); 
  }
}

// Перемещение одной фишки
function handlePieceSelection(x, y){
  const cell = getCellElement(x, y), piece = cell.querySelector('.piece');
  
  if(App.game.selectedPiece){
    if(!getCellElement(x,y).classList.contains('valid-move')){ 
      showNotification('Ошибка', 'Недопустимый ход', 'error'); 
      clearSelection(); 
      return; 
    }
    movePiece(App.game.selectedPiece.x, App.game.selectedPiece.y, x, y);
  } else if(App.game.selectedGroup.length>0){
    moveGroup(x, y);
  } else {
    if(!piece || parseInt(piece.dataset.owner)!==App.game.myPlayer){ 
      showNotification('Ошибка', 'Выберите свою фишку', 'error'); 
      return; 
    }
    if(IMMOBILE_TYPES.includes(piece.dataset.kind)){ 
      showNotification('Ошибка', 'Этот корабль неподвижен', 'error'); 
      return; 
    }
    App.game.selectedPiece = {x,y,kind:piece.dataset.kind}; 
    highlightCell(x,y,'selected'); 
    showValidMoves(x, y, piece.dataset.kind);
  }
}

async function movePiece(fx, fy, tx, ty){
  try{
    // Анимация перемещения
    const srcCell = getCellElement(fx, fy);
    const dstCell = getCellElement(tx, ty);
    const piece = srcCell.querySelector('.piece');
    
    if(piece) {
      // Клонируем фишку для анимации
      const clone = piece.cloneNode(true);
      document.body.appendChild(clone);
      
      // Позиционируем клон над исходной фишкой
      const srcRect = srcCell.getBoundingClientRect();
      const dstRect = dstCell.getBoundingClientRect();
      
      clone.style.position = 'fixed';
      clone.style.zIndex = '1000';
      clone.style.top = srcRect.top + 'px';
      clone.style.left = srcRect.left + 'px';
      clone.style.width = srcRect.width + 'px';
      clone.style.height = srcRect.height + 'px';
      
      // Вычисляем смещение для анимации
      const moveX = dstRect.left - srcRect.left;
      const moveY = dstRect.top - srcRect.top;
      
      clone.style.setProperty('--move-x', moveX + 'px');
      clone.style.setProperty('--move-y', moveY + 'px');
      clone.classList.add('piece-moving');
      
      // Ждем завершения анимации
      await new Promise(resolve => setTimeout(resolve, 500));
      clone.remove();
    }
    
    const res = await api(`/game/move/${App.game.id}/`, 'POST', { src:[fx,fy], dst:[tx,ty] });
    if(res.state){
      App.game.state = res.state; 
      renderGame(); 
      clearSelection();
      if(res.res && res.res.event){ 
        showNotification('Результат', res.res.event, 'success'); 
      }
      updateKilledTable();
    }
  }catch(err){ 
    showNotification('Ошибка', 'Не удалось переместить фишку: ' + err.message, 'error'); 
    clearSelection(); 
  }
}

// Перемещение группы
async function moveGroup(toX, toY){
  if(App.game.selectedGroup.length===0) return;
  let adjacent = App.game.selectedGroup.some(gp=>Math.abs(toX-gp.x)+Math.abs(toY-gp.y)===1);
  if(!adjacent){ 
    showNotification('Ошибка', 'Группа ходит на соседнюю клетку', 'error'); 
    return; 
  }
  
  try{
    const first = App.game.selectedGroup[0];
    const followers = App.game.selectedGroup.slice(1).map(p => [p.x, p.y, toX, toY]);
    
    // Анимация перемещения группы
    for(const piece of App.game.selectedGroup) {
      const srcCell = getCellElement(piece.x, piece.y);
      const dstCell = getCellElement(toX, toY);
      const pieceEl = srcCell.querySelector('.piece');
      
      if(pieceEl) {
        // Клонируем фишку для анимации
        const clone = pieceEl.cloneNode(true);
        document.body.appendChild(clone);
        
        // Позиционируем клон над исходной фишкой
        const srcRect = srcCell.getBoundingClientRect();
        const dstRect = dstCell.getBoundingClientRect();
        
        clone.style.position = 'fixed';
        clone.style.zIndex = '1000';
        clone.style.top = srcRect.top + 'px';
        clone.style.left = srcRect.left + 'px';
        clone.style.width = srcRect.width + 'px';
        clone.style.height = srcRect.height + 'px';
        
        // Вычисляем смещение для анимации
        const moveX = dstRect.left - srcRect.left;
        const moveY = dstRect.top - srcRect.top;
        
        clone.style.setProperty('--move-x', moveX + 'px');
        clone.style.setProperty('--move-y', moveY + 'px');
        clone.classList.add('piece-moving');
        
        // Удаляем клон после анимации
        setTimeout(() => clone.remove(), 500);
      }
    }
    
    // Ждем завершения анимации
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const res = await api(`/game/move/${App.game.id}/`, 'POST', { src:[first.x, first.y], dst:[toX,toY], followers });
    if(res.state){
      App.game.state = res.state; 
      renderGame(); 
      clearGroupSelection();
      if(res.res && res.res.event){ 
        showNotification('Результат', res.res.event, 'success'); 
      }
      updateKilledTable();
    }
  }catch(err){ 
    showNotification('Ошибка', 'Не удалось переместить группу: ' + err.message, 'error'); 
    clearGroupSelection(); 
  }
}

// Подсветка допустимых ходов
function showValidMoves(x, y, kind){
  document.querySelectorAll('.cell.valid-move').forEach(c => c.classList.remove('valid-move'));
  const special = SPECIAL_MOVES[kind];
  if(special){
    if(typeof special === 'number'){
      const range=special, dirs=[{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
      dirs.forEach(d=>{ 
        for(let i=1;i<=range;i++){ 
          const nx=x+d.dx*i, ny=y+d.dy*i; 
          if(nx>=0&&nx<14&&ny>=0&&ny<15){ 
            const cell=getCellElement(nx,ny); 
            const piece = cell.querySelector('.piece'); 
            if(piece) break; 
            highlightCell(nx,ny,'valid-move'); 
          } 
        }
      });
    } else {
      const carrier = special.carrier, dirs=[{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
      dirs.forEach(d=>{
        const cx=x+d.dx, cy=y+d.dy;
        if(cx>=0&&cx<14&&cy>=0&&cy<15){
          const cp = getCellElement(cx,cy).querySelector('.piece');
          if(cp && cp.dataset.kind===carrier && parseInt(cp.dataset.owner)===App.game.myPlayer){
            dirs.forEach(md=>{
              const nx=cx+md.dx, ny=cy+md.dy; if(nx===x && ny===y) return;
              if(nx>=0&&nx<14&&ny>=0&&ny<15){ 
                const cell=getCellElement(nx,ny); 
                const piece=cell.querySelector('.piece'); 
                if(!piece) highlightCell(nx,ny,'valid-move'); 
              }
            });
          }
        }
      });
    }
  } else {
    [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}].forEach(d=>{
      const nx=x+d.dx, ny=y+d.dy; 
      if(nx>=0&&nx<14&&ny>=0&&ny<15){
        const cell=getCellElement(nx,ny), piece=cell.querySelector('.piece');
        if(!piece || parseInt(piece.dataset.owner)!==App.game.myPlayer) 
          highlightCell(nx,ny,'valid-move');
      }
    });
  }
}

// Размещение
async function placeShip(x, y, shipType){
  let validZone = false;
  if(App.game.myPlayer===1 && y>=10) validZone = true;
  else if(App.game.myPlayer===2 && y<5) validZone = true;
  
  if(!validZone){ 
    showNotification('Ошибка', 'Можно расставлять только в своей зоне', 'error'); 
    return; 
  }
  
  if(App.game.shipCounts[shipType] <= 0){ 
    showNotification('Ошибка', 'Корабли этого типа закончились', 'error'); 
    return; 
  }
  
  // Проверяем, не занята ли клетка
  const cell = getCellElement(x, y);
  if(cell.querySelector('.piece')) {
    showNotification('Ошибка', 'Клетка уже занята', 'error');
    return;
  }
  
  try{
    const res = await api(`/game/setup/${App.game.id}/`, 'POST', { placements: [{ x, y, kind: convertToApiShipType(shipType) }] });
    if(res.state){
      App.game.state = res.state; 
      App.game.shipCounts[shipType]--; 
      updateShipCounts(); 
      renderGame();
      showNotification('Успех', `${shipType} размещен`, 'success');
    }
  }catch(err){ 
    showNotification('Ошибка', 'Не удалось разместить корабль: ' + err.message, 'error'); 
  }
}

function convertToApiShipType(t){ 
  const map={'БДК':'BDK','КР':'KR','А':'A','С':'S','ТН':'TN','Л':'L','ЭС':'ES','М':'M','СМ':'SM','Ф':'F','ТК':'TK','Т':'T','ТР':'TR','СТ':'ST','ПЛ':'PL','КРПЛ':'KRPL','АБ':'AB','ВМБ':'VMB'}; 
  return map[t]||t; 
}

function convertFromApiShipType(t){ 
  const map={'BDK':'БДК','KR':'КР','A':'А','S':'С','TN':'ТН','L':'Л','ES':'ЭС','M':'М','SM':'СМ','F':'Ф','TK':'ТК','T':'Т','TR':'ТР','ST':'СТ','PL':'ПЛ','KRPL':'КРПЛ','AB':'АБ','VMB':'ВМБ'}; 
  return map[t]||t; 
}

function updateShipCounts(){ 
  Object.keys(SHIP_TYPES).forEach(type => { 
    const span = document.querySelector(`[data-ship="${type}"] .ship-count`); 
    if(span) span.textContent = App.game.shipCounts[type] || 0; 
  }); 
}

function getCellElement(x, y){ 
  return document.querySelector(`[data-x="${x}"][data-y="${y}"]`); 
}

function highlightCell(x, y, cls){ 
  const cell = getCellElement(x,y); 
  if(cell) cell.classList.add(cls); 
}

function clearSelection(){
  App.game.selectedPiece = null; 
  App.game.selectedCells = [];
  document.querySelectorAll('.cell').forEach(cell => cell.classList.remove('selected', 'valid-move', 'attack-zone'));
}

function clearGroupSelection(){
  document.querySelectorAll('.cell.group-selected').forEach(cell => cell.classList.remove('group-selected'));
  document.querySelectorAll('.group-indicator').forEach(ind => ind.remove());
  App.game.selectedGroup = [];
}

// Убитые фишки
function updateKilledTable(){
  const killedTableBody = document.getElementById('killedTableBody'); 
  if(!killedTableBody) return;
  
  api(`/game/killed/${App.game.id}/`).then(data=>{
    const items=data.items||[]; 
    killedTableBody.innerHTML='';
    
    if(items.length===0){ 
      killedTableBody.innerHTML='<tr><td colspan="3">Нет данных</td></tr>'; 
      return; 
    }
    
    items.forEach(it=>{
      const ru = convertFromApiShipType(it.piece);
      const tr = document.createElement('tr'); 
      tr.innerHTML = `<td>${ru}</td><td>${it.killed}</td><td>${SHIP_TYPES[ru]?.count || '-'}</td>`;
      killedTableBody.appendChild(tr);
    });
  }).catch(()=>{ 
    killedTableBody.innerHTML='<tr><td colspan="3">Ошибка загрузки</td></tr>'; 
  });
}

// Таймер расстановки
function startSetupTimer(minutes) {
  if(App.game.setupTimer) {
    clearInterval(App.game.setupTimer);
  }
  
  const deadline = new Date();
    deadline.setMinutes(deadline.getMinutes() + minutes);
  App.game.setupDeadline = deadline;

  // Показываем модалку ожидания во время расстановки, чтобы был виден таймер
  if (waitOpponentModal) waitOpponentModal.style.display = 'flex';
  updateSetupTimerDisplay();

  App.game.setupTimer = setInterval(() => {
    updateSetupTimerDisplay();
  }, 1000);
}

function updateSetupTimerDisplay() {
  if (!App.game.setupDeadline || !setupTimerDisplay) return;

  const now = new Date();
  const diff = Math.max(0, Math.floor((App.game.setupDeadline - now) / 1000));
  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;
  setupTimerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  // Когда таймер истек — автоматически подтвердим расстановку
  if (diff <= 0) {
    if (App.game.setupTimer) {
      clearInterval(App.game.setupTimer);
      App.game.setupTimer = null;
    }
    // Если мы ещё в фазе расстановки — отправим подтверждение
    if (App.game.setupPhase) {
      submitSetup();
    } else {
      // На всякий случай скрыть модалку
      if (waitOpponentModal) waitOpponentModal.style.display = 'none';
    }
  }
}

// Поллинг игры: состояние и таймеры
function startGamePolling() {
  if (App.game.pollTimer) clearInterval(App.game.pollTimer);

  App.game.pollTimer = setInterval(async () => {
    if (!App.game.id) return;

    try {
      // Состояние игры (доска/фаза/победитель)
      const d = await api(`/game/state/${App.game.id}/`);
      if (d && d.state) {
        const oldPhase = App.game.state?.phase;
        const oldTurn = App.game.state?.turn;
        App.game.state = d.state;

        // Переход из SETUP -> игровая фаза
        if (oldPhase === 'SETUP' && d.state.phase !== 'SETUP') {
          App.game.setupPhase = false;
          showNotification('Игра началась!', 'Фаза расстановки завершена', 'success');
          if (waitOpponentModal) waitOpponentModal.style.display = 'none';
          if (App.game.setupTimer) {
            clearInterval(App.game.setupTimer);
            App.game.setupTimer = null;
          }
          createControlsPanel();
        }

        // Уведомление "Ваш ход"
        if (typeof oldTurn !== 'undefined' && oldTurn !== d.state.turn && d.state.turn === App.game.myPlayer) {
          showNotification('Ваш ход', 'Сейчас ваша очередь ходить', 'info');
        }

        renderGame();

        // Показ результата
        if (d.state.winner) {
          showGameResult(d.state.winner, d.state.win_reason);
        }
      }

      // Таймеры/паузы/банк времени
      const t = await api(`/game/timers/${App.game.id}/`);
      if (t) {
        updateTimers(t);
        App.game.pausesUsed.short = !t.short_available;
        App.game.pausesUsed.long = !t.long_available;

        if (t.paused && typeof t.pause_left === 'number') {
          showPauseOverlay(t.pause_left, (t.pause_initiator === App.game.myPlayer));
        } else {
          hidePauseOverlay();
        }

        if (t.finished && t.winner) {
          showGameResult(t.winner, t.reason);
        }
      }
    } catch (err) {
      // no-op; сеть может шевелиться
    }
  }, 1000);
}

function updateTimers(data) {
  if (hudTimer && typeof data.turn_left === 'number') {
    hudTimer.textContent = `${data.turn_left}s`;
    hudTimer.style.color = data.turn_left <= 10 ? '#ff5e2c' : '';
  }
  if (hudBank && typeof data.bank_left === 'number') {
    const minutes = Math.floor(data.bank_left / 60), seconds = data.bank_left % 60;
    hudBank.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
    hudBank.style.color = data.bank_left <= 60 ? '#ff5e2c' : '';
  }
  if (turnIndicator && typeof data.turn !== 'undefined') {
    const isMyTurn = (data.turn === App.game.myPlayer);
    turnIndicator.textContent = isMyTurn ? 'Ваш ход' : 'Ход соперника';
    turnIndicator.style.color = isMyTurn ? '#27e881' : '#ff5e2c';
  }
}

// Подстройка правой панели под 60/40 высоты (управление/убитые)
function adjustRightPanelLayout() {
  const cpi = document.getElementById('controlsPanelInner');
  const ks = document.querySelector('.killed-section');
  if (cpi) cpi.style.bottom = '40%';  // верхняя часть = 60%
  if (ks) ks.style.top = '60%';       // нижняя часть = 40%
}

function renderGame() {
  const st = App.game.state || {};

  if (turnIndicator) {
    const isMyTurn = st.turn === App.game.myPlayer;
    turnIndicator.textContent = isMyTurn ? 'Ваш ход' : 'Ход соперника';
    turnIndicator.style.color = isMyTurn ? '#27e881' : '#ff5e2c';
  }

  // Перерисуем поле
  clearBoard();

  const board = st.board || {};
  Object.keys(board).forEach(k => {
    const [x, y] = k.split(',').map(Number);
    const cell = getCellElement(x, y);
    const pieces = board[k];

    if (cell && pieces && pieces.length > 0) {
      const p = pieces[0];

      // Фаза расстановки: показываем только свои фишки
      if (App.game.setupPhase && p.owner !== App.game.myPlayer) return;

      // Игровая фаза: чужие только если уничтожены (alive=false) — чтобы не палить состав
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

  // Подстроим правую панель после рендера
  adjustRightPanelLayout();

  // Обновим таблицу убитых
  updateKilledTable();
}

function labelKind(kind) { return convertFromApiShipType(kind); }
function classKind(kind) { return 'kind' + convertFromApiShipType(kind); }

// Вход в игру по URL комнаты
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

    initializeShipCounts();
    showContent('game');
    renderGame();
    createShipsList();
    createControlsPanel();
    adjustRightPanelLayout();
    startGamePolling();

    // Запуск таймера расстановки при входе в игру в фазе SETUP
    if (App.game.setupPhase) {
      startSetupTimer(15);
    }
  } catch (err) {
    showNotification('Ошибка', 'Не удалось открыть игру: ' + err.message, 'error');
  }
}

async function submitSetup() {
  // Проверяем, всё ли выставлено
  let allPlaced = true;
  Object.keys(SHIP_TYPES).forEach(t => { if (App.game.shipCounts[t] > 0) allPlaced = false; });

  if (!allPlaced) {
    showNotification('Ошибка', 'Сначала нужно разместить все фишки', 'error');
    return;
  }
  try {
    const res = await api(`/game/submit_setup/${App.game.id}/`, 'POST', {});
    if (res && res.ok) {
      showNotification('Готово', 'Расстановка подтверждена', 'success');

      // Переходим в ожидание соперника и показываем таймер постановки (оставим текущий отсчет)
      if (waitOpponentModal) waitOpponentModal.style.display = 'flex';

      if (res.status !== 'SETUP') {
        // Уже стартанула игра
        App.game.setupPhase = false;
        if (App.game.state) {
          App.game.state.phase = res.status;
          App.game.state.turn = res.turn;
        }
        if (waitOpponentModal) waitOpponentModal.style.display = 'none';
        if (App.game.setupTimer) { clearInterval(App.game.setupTimer); App.game.setupTimer = null; }
        createControlsPanel();
        renderGame();
      }
    }
  } catch (err) {
    showNotification('Ошибка', 'Не удалось подтвердить расстановку: ' + err.message, 'error');
  }
}

async function autoSetup() {
  if (!App.game.id) return;
  try {
    // Неважно, что было — авторасстановка сервером очистит и расставит
    const res = await api(`/game/autosetup/${App.game.id}/`, 'POST', {});
    if (res && res.state) {
      App.game.state = res.state;
      // Обнулим локальные остатки (все фишки распределены)
      Object.keys(App.game.shipCounts).forEach(t => App.game.shipCounts[t] = 0);
      updateShipCounts();
      renderGame();
      showNotification('Успех', 'Автоматическая расстановка завершена', 'success');
    }
  } catch (err) {
    showNotification('Ошибка', 'Ошибка автоматической расстановки: ' + err.message, 'error');
  }
}

// Очистка текущей расстановки только в UI (сервер мы не меняем — авторасстановка перепишет)
async function clearSetup() {
  if (!App.game.id || !App.game.setupPhase) return;
  try {
    initializeShipCounts();
    updateShipCounts();
    document.querySelectorAll('.cell.my-zone').forEach(cell => { while (cell.firstChild) cell.removeChild(cell.firstChild); });
    const d = await api(`/game/state/${App.game.id}/`);
    if (d && d.state) App.game.state = d.state;
  } catch (err) {
    showNotification('Ошибка', 'Не удалось очистить расстановку: ' + err.message, 'error');
  }
}

function showGameResult(winner, reason) {
  if (App.game.pollTimer) { clearInterval(App.game.pollTimer); App.game.pollTimer = null; }
  const isWinner = (winner === App.game.myPlayer);
  resultTitle.textContent = isWinner ? 'Победа!' : 'Поражение';
  resultTitle.className = `result-title ${isWinner ? 'victory' : 'defeat'}`;
  let reasonText = '';
  switch (reason) {
    case 'bases': reasonText = 'Уничтожены военно-морские базы'; break;
    case 'moves': reasonText = 'Уничтожены все движущиеся корабли'; break;
    case 'time': reasonText = 'Закончилось время'; break;
    case 'resign': reasonText = isWinner ? 'Противник сдался' : 'Вы сдались'; break;
    default: reasonText = 'Игра завершена';
  }
  resultDetails.innerHTML = `<p>${reasonText}</p>`;
  ratingChange.textContent = '';
  gameResultModal.style.display = 'flex';
}

// История игр (в профиле)
async function loadHistory() {
  try {
    const d = await api('/game/my/');
    const items = d.items || [];
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    historyList.innerHTML = '';
    if (items.length === 0) {
      historyList.innerHTML = '<li>История пуста</li>';
      return;
    }
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

// Инициализация
function init() {
  renderTopRight();
  initTabs();

  // Гарантируем, что панели растянуты по высоте
  const shipsWrap = document.getElementById('shipsContainer');
  if (shipsWrap && !document.getElementById('shipsPanelInner')) {
    shipsWrap.innerHTML = '<div class="ships-panel-inner" id="shipsPanelInner"></div>';
  }
  const controlsWrap = document.getElementById('controlsContainer');
  if (controlsWrap && !document.getElementById('controlsPanelInner')) {
    controlsWrap.innerHTML = '<div class="controls-panel-inner" id="controlsPanelInner"></div>';
  }

  // Вкладки лобби: активная — Быстрая игра
  const quickPane = document.getElementById('pane-quick');
  const friendPane = document.getElementById('pane-friends');
  if (quickPane) quickPane.classList.add('active');
  if (friendPane) friendPane.classList.remove('active');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}