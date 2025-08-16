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

// ===== Кастомные уведомления =====
function showNotification(title, message, type = 'info') {
  document.querySelectorAll('.notification').forEach(n => n.remove());
  
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <div class="notification-title">${title}</div>
    <div class="notification-message">${message}</div>
  `;
  
  document.body.appendChild(notification);
  setTimeout(() => notification.classList.add('show'), 100);
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 4000);
}

// ===== Игровые константы =====
const SHIP_TYPES = {
  'БДК': { count: 2, rating: 20, color: '#b93b2e' },
  'КР': { count: 6, rating: 18, color: '#1c6fb1' },
  'А': { count: 1, rating: 17, color: '#b93b2e' },
  'Л': { count: 2, rating: 16, color: '#1c6fb1' },
  'ЭС': { count: 6, rating: 15, color: '#1c6fb1' },
  'Ф': { count: 6, rating: 14, color: '#1c6fb1' },
  'ТК': { count: 6, rating: 13, color: '#1f8f55' },
  'ТР': { count: 6, rating: 12, color: '#1f8f55' },
  'СТ': { count: 6, rating: 11, color: '#1c6fb1' },
  'ПЛ': { count: 1, rating: 10, color: '#0b4f6c' },
  'КРПЛ': { count: 1, rating: 9, color: '#0b4f6c' },
  'С': { count: 1, rating: 8, color: '#b93b2e' },
  'Т': { count: 6, rating: 7, color: '#1f8f55' },
  'М': { count: 6, rating: 6, color: '#6e7b85' },
  'ТН': { count: 1, rating: 5, color: '#d35400' },
  'АБ': { count: 1, rating: 4, color: '#b93b2e' },
  'СМ': { count: 1, rating: 3, color: '#6e7b85' },
  'ВМБ': { count: 2, rating: 2, color: '#95a5a6', immobile: true }
};

const SPECIAL_KILLS = {
  'ПЛ': ['БДК', 'А'],
  'КРПЛ': ['КР'],
  'ТР': ['М'] // ТР обезвреживает мины
};

// ===== global state =====
const App = {
  isAuth: document.body.dataset.auth === '1',
  meLogin: document.body.dataset.login || '',
  meAvatar: document.body.dataset.avatar || '/static/img/avatar_stub.png',
  waitCtx: { active:false, token:null, canceler:null },
  game: { 
    id: null, 
    state: null, 
    myPlayer: null, 
    pollTimer: null,
    selectedShip: null,
    selectedWeapon: null,
    selectedCells: [],
    attackMode: false,
    setupPhase: true,
    shipCounts: {}
  },
  selectedCell: null,
  draggedPiece: null
};

// ===== DOM refs =====
const msContainer = document.getElementById('msContainer');
const menu = document.getElementById('menu');
const settings = document.getElementById('settings');
const settExit = document.getElementById('settExit');

const startBut = document.getElementById('startBut');
const rulesBut = document.getElementById('rulesBut');

const profileBtn = document.getElementById('profileBtn');
const profileAvatar = document.getElementById('profileAvatar');
const profileName = document.getElementById('profileName');

// content panes
const rulesContent = document.getElementById('rulesContent');
const lobbyContent = document.getElementById('lobbyContent');
const gameContent = document.getElementById('gameContent');

const quickBtn = document.getElementById('quickBtn');
const showMeBtn = document.getElementById('showMeBtn');

const userSearch = document.getElementById('userSearch');
const searchBtn = document.getElementById('searchBtn');
const usersList = document.getElementById('usersList');
const friendsList = document.getElementById('friendsList');

// game
const boardEl = document.getElementById('board');
const turnIndicator = document.getElementById('turnIndicator');
const hudTimer = document.getElementById('hudTimer');
const hudBank = document.getElementById('hudBank');
const shipsContainer = document.getElementById('shipsContainer');
const weaponsContainer = document.getElementById('weaponsContainer');
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

const gameResultModal = document.getElementById('gameResultModal');
const gameResultExit = document.getElementById('gameResultExit');
const resultTitle = document.getElementById('resultTitle');
const resultDetails = document.getElementById('resultDetails');
const ratingChange = document.getElementById('ratingChange');

const pauseModal = document.getElementById('pauseModal');
const shortPauseBtn = document.getElementById('shortPauseBtn');
const longPauseBtn = document.getElementById('longPauseBtn');
const cancelPauseBtn = document.getElementById('cancelPauseBtn');

// ===== UI helpers =====
function showContent(contentType){
  [rulesContent, lobbyContent, gameContent].forEach(pane => {
    pane.style.display = 'none';
  });
  
  if(contentType === 'rules'){
    rulesContent.style.display = 'block';
  } else if(contentType === 'lobby'){
    lobbyContent.style.display = 'block';
  } else if(contentType === 'game'){
    gameContent.style.display = 'block';
  }
  
  msContainer.classList.add('flip');
}

function showMenu(){
  msContainer.classList.remove('flip');
  
  if(App.game.pollTimer){
    clearInterval(App.game.pollTimer);
    App.game.pollTimer = null;
  }
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

function openAuth(){ 
  authModal.style.display='flex'; 
}

function closeModal(id){ 
  document.getElementById(id).style.display='none'; 
}

// ===== Tab system =====
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
        panes.forEach(pane => {
          pane.classList.remove('active');
        });
        
        const targetPane = container.querySelector(`#${paneId}`);
        if(targetPane) {
          targetPane.classList.add('active');
          
          if(paneId === 'p-history') {
            setTimeout(loadHistory, 100);
          }
        }
      });
    });
  });
}

// ===== Menu navigation =====
startBut.addEventListener('click', () => {
  showContent('lobby');
  setTimeout(() => {
    loadUsers('');
    loadFriends();
  }, 100);
});

rulesBut.addEventListener('click', () => showContent('rules'));
settExit.addEventListener('click', () => showMenu());

// ===== Profile/Auth =====
profileBtn.addEventListener('click', () => App.isAuth ? openProfile() : openAuth());

document.querySelectorAll('.modal-close').forEach(x => {
  x.addEventListener('click', () => closeModal(x.dataset.target));
});

if(pAvatar) {
  pAvatar.addEventListener('change', (e) => {
    const f = pAvatar.files && pAvatar.files[0];
    if(!f) return;
    const reader = new FileReader();
    reader.onload = ev => { pAvatarPreview.src = ev.target.result; };
    reader.readAsDataURL(f);
  });
}

if(profileForm) {
  profileForm.addEventListener('submit', async (e) => {
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
    }catch(err){ 
      showNotification('Ошибка', 'Не удалось сохранить профиль: ' + err.message, 'error');
    }
  });
}

if(loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(loginForm).entries());
    try{
      const r = await api('/accounts/api/login/','POST', d);
      if(r.ok){
        App.isAuth=true; 
        App.meLogin=r.login||d.username; 
        if(r.avatar) App.meAvatar=r.avatar;
        renderTopRight(); 
        authModal.style.display='none';
        showNotification('Успех', 'Вы успешно вошли в систему', 'success');
      }else {
        showNotification('Ошибка', 'Неверный логин или пароль', 'error');
      }
    }catch(err){ 
      showNotification('Ошибка', 'Ошибка входа в систему', 'error');
    }
  });
}

if(registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(registerForm).entries());
    try{
      const r = await api('/accounts/api/register/','POST', d);
      if(r.ok){
        const r2 = await api('/accounts/api/login/','POST',{username:d.username,password:d.password});
        if(r2.ok){
          App.isAuth=true; 
          App.meLogin=d.login; 
          if(r2.avatar) App.meAvatar=r2.avatar;
          renderTopRight(); 
          authModal.style.display='none';
          showNotification('Успех', 'Регистрация прошла успешно', 'success');
        }
      }else {
        showNotification('Ошибка', 'Ошибка регистрации', 'error');
      }
    }catch(err){ 
      showNotification('Ошибка', 'Ошибка регистрации', 'error');
    }
  });
}

// ===== Users/Friends =====
if(searchBtn) {
  searchBtn.addEventListener('click', () => loadUsers(userSearch.value.trim()));
}

if(userSearch) {
  userSearch.addEventListener('input', () => loadUsers(userSearch.value.trim()));
}

if(showMeBtn) {
  showMeBtn.addEventListener('click', () => {
    if(!App.isAuth) return;
    const myItem = usersList.querySelector('.me');
    if(myItem) {
      myItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      myItem.style.background = 'rgba(255,255,0,.3)';
      setTimeout(() => {
        myItem.style.background = 'rgba(255,255,0,.1)';
      }, 2000);
    }
  });
}

function calculateRating(wins, losses) {
  return 1200 + (wins * 100) - (losses * 100);
}

async function loadUsers(q){
  if(!usersList) return;
  try{
    const data = await api('/accounts/api/users/?q='+encodeURIComponent(q||''));
    renderUsers(data.items||[]);
  }catch(err){ 
    usersList.innerHTML='<li>Ошибка загрузки</li>'; 
  }
}

function renderUsers(arr){
  if(!usersList) return;
  
  // Добавляем себя в список если авторизованы
  if(App.isAuth && App.meLogin) {
    const meData = {
      id: 'me',
      login: App.meLogin,
      wins: 0, // Можно получить из API
      losses: 0,
      rating: 1200
    };
    arr.unshift(meData);
  }
  
  // Сортируем по рейтингу
  arr.sort((a, b) => calculateRating(b.wins, b.losses) - calculateRating(a.wins, a.losses));
  
  usersList.innerHTML='';
  if(arr.length===0){ 
    usersList.innerHTML='<li>Пусто</li>'; 
    return; 
  }
  
  arr.forEach((u, index) => {
    const rating = calculateRating(u.wins, u.losses);
    const isMe = u.id === 'me' || (App.isAuth && u.login === App.meLogin);
    
    const li = document.createElement('li');
    li.className = isMe ? 'me' : '';
    li.innerHTML = `
      <div>
        <strong>#${index + 1} ${u.login}</strong> ${isMe ? '(Вы)' : ''}<br>
        <span class="muted">Рейтинг: ${rating} • Побед: ${u.wins} • Поражений: ${u.losses}</span>
      </div>
      ${!isMe ? `<div style="display:flex;gap:.4rem">
        <button class="menuButs xs" data-invite="${u.id}">Пригласить</button>
        <button class="menuButs xs" data-add="${u.id}" data-login="${u.login}">Добавить</button>
      </div>` : '<div></div>'}`;
    usersList.appendChild(li);
  });
  
  usersList.querySelectorAll('[data-invite]').forEach(btn => {
    btn.addEventListener('click', () => inviteUser(btn.dataset.invite));
  });
  
  usersList.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const login = btn.dataset.login;
      try{ 
        await api('/accounts/api/friends/add/','POST',{login}); 
        loadFriends(); 
        showNotification('Успех', 'Друг добавлен', 'success');
      }catch(e){ 
        showNotification('Ошибка', 'Не удалось добавить друга', 'error');
      }
    });
  });
}

async function loadFriends(){
  if(!friendsList) return;
  try{
    const data = await api('/accounts/api/friends/');
    const items = data.items || [];
    friendsList.innerHTML='';
    if(items.length===0){ 
      friendsList.innerHTML='<li>Нет друзей</li>'; 
      return; 
    }
    
    items.forEach(u=>{
      const li=document.createElement('li');
      li.innerHTML = `
        <div><strong>${u.login}</strong></div>
        <div style="display:flex;gap:.4rem">
          <button class="menuButs xs" data-invite="${u.id}">Пригласить</button>
          <button class="menuButs xs danger" data-remove="${u.id}">Удалить</button>
        </div>`;
      friendsList.appendChild(li);
    });
    
    friendsList.querySelectorAll('[data-invite]').forEach(btn => {
      btn.addEventListener('click', () => inviteUser(btn.dataset.invite));
    });
    
    friendsList.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try{ 
          await api(`/accounts/api/friends/remove/${btn.dataset.remove}/`,'POST',{}); 
          loadFriends(); 
          showNotification('Успех', 'Друг удален', 'success');
        }catch(e){ 
          showNotification('Ошибка', 'Не удалось удалить друга', 'error');
        }
      });
    });
  }catch(err){ 
    friendsList.innerHTML='<li>Ошибка загрузки</li>'; 
  }
}

async function inviteUser(uid){
  if(!App.isAuth){ openAuth(); return; }
  try{
    const r = await api(`/match/invite_ajax/${uid}/`);
    if(r.ok){
      showWaiting('Ожидаем ответ соперника...', async () => {
        await api(`/match/invite/${r.token}/cancel/`);
      }, r.token);
    }
  }catch(err){ 
    showNotification('Ошибка', 'Не удалось отправить приглашение', 'error');
  }
}

// ===== Waiting/Invite modals =====
function showWaiting(text, onCancel, token=null){
  waitText.textContent = text || 'Ожидание...';
  App.waitCtx = {active:true, token, canceler:onCancel};
  waitModal.style.display = 'flex';
}

function hideWaiting(){ 
  waitModal.style.display = 'none'; 
  App.waitCtx = {active:false, token:null, canceler:null}; 
}

if(waitCancel) {
  waitCancel.addEventListener('click', async () => {
    try{ 
      if(App.waitCtx.canceler) await App.waitCtx.canceler(); 
    } finally{ 
      hideWaiting(); 
    }
  });
}

let currentInviteToken = null;
function showInviteModal(fromLogin, token){
  currentInviteToken = token;
  inviteText.textContent = `Приглашение в игру от ${fromLogin}`;
  inviteModal.style.display = 'flex';
}

if(inviteAccept) {
  inviteAccept.addEventListener('click', async () => {
    if(currentInviteToken) {
      try {
        const res = await api(`/match/invite/${currentInviteToken}/accept/`, 'POST');
        if(res.ok && res.url) {
          inviteModal.style.display = 'none';
          currentInviteToken = null;
          startGameByRoomUrl(res.url);
        }
      } catch(err) {
        showNotification('Ошибка', 'Не удалось принять приглашение', 'error');
      }
    }
  });
}

if(inviteDecline) {
  inviteDecline.addEventListener('click', async () => {
    if(currentInviteToken) {
      try {
        await api(`/match/invite/${currentInviteToken}/decline/`, 'POST');
        inviteModal.style.display = 'none';
        currentInviteToken = null;
        showNotification('Информация', 'Приглашение отклонено', 'info');
      } catch(err) {
        showNotification('Ошибка', 'Ошибка отклонения приглашения', 'error');
      }
    }
  });
}

// ===== Notifications polling =====
function handleEvent(m){
  if(!m || !m.type) return;
  
  if(m.type === 'friend_invite'){ 
    showInviteModal(m.from, m.token); 
  }
  if(m.type === 'invite_accepted'){ 
    hideWaiting(); 
    if(m.url) startGameByRoomUrl(m.url); 
  }
  if(m.type === 'invite_declined'){ 
    hideWaiting(); 
    showNotification('Информация', 'Ваше приглашение отклонено', 'warning');
  }
  if(m.type === 'match_found'){ 
    hideWaiting(); 
    if(m.url) startGameByRoomUrl(m.url); 
  }
}

async function poll(){
  if(!App.isAuth) return;
  try{
    const data = await api('/match/notify/poll/');
    (data.items||[]).forEach(handleEvent);
  }catch(err){}
}

setInterval(poll, 1200);

// ===== Quick match =====
let quickTimer = null;
if(quickBtn) {
  quickBtn.addEventListener('click', async () => {
    if(!App.isAuth){ openAuth(); return; }
    
    try{
      const r = await api('/match/quick/');
      if(r.url){ 
        startGameByRoomUrl(r.url); 
        return; 
      }
      if(r.queued){
        showWaiting('Ищем соперника...', async () => {
          await api('/match/cancel/');
        });
        
        if(quickTimer) clearInterval(quickTimer);
        quickTimer = setInterval(async () => {
          try {
            const s = await api('/match/status/');
            if(s.url){ 
              clearInterval(quickTimer); 
              hideWaiting(); 
              startGameByRoomUrl(s.url); 
            }
          } catch(err) {
            // Игнорируем ошибки поллинга
          }
        }, 1200);
      }
    }catch(err){ 
      showNotification('Ошибка', 'Не удалось начать поиск соперника', 'error');
    }
  });
}

// ===== GAME ENGINE =====
function initializeShipCounts() {
  App.game.shipCounts = {};
  Object.keys(SHIP_TYPES).forEach(type => {
    App.game.shipCounts[type] = SHIP_TYPES[type].count;
  });
}

function createShipButtons() {
  if(!shipsContainer) return;
  shipsContainer.innerHTML = '';
  
  Object.keys(SHIP_TYPES).forEach(type => {
    const shipData = SHIP_TYPES[type];
    const count = App.game.shipCounts[type] || 0;
    
    const button = document.createElement('div');
    button.className = 'ship-button';
    button.style.backgroundColor = shipData.color;
    button.dataset.ship = type;
    button.innerHTML = `<span>${type}</span>`;
    
    const countDiv = document.createElement('div');
    countDiv.className = 'ship-count';
    countDiv.textContent = count;
    
    const container = document.createElement('div');
    container.appendChild(button);
    container.appendChild(countDiv);
    
    button.addEventListener('click', () => selectShip(type));
    shipsContainer.appendChild(container);
  });
}

function selectShip(type) {
  if(App.game.shipCounts[type] <= 0) return;
  
  // Убираем выделение с других кораблей
  document.querySelectorAll('.ship-button').forEach(btn => {
    btn.classList.remove('selected');
  });
  
  // Выделяем выбранный корабль
  const button = document.querySelector(`[data-ship="${type}"]`);
  if(button) {
    button.classList.add('selected');
    App.game.selectedShip = type;
    App.game.selectedWeapon = null;
    
    // Убираем выделение с оружия
    document.querySelectorAll('.weapon-button').forEach(btn => {
      btn.classList.remove('selected');
    });
  }
}

function selectWeapon(type) {
  // Убираем выделение с кораблей
  document.querySelectorAll('.ship-button').forEach(btn => {
    btn.classList.remove('selected');
  });
  
  // Убираем выделение с других видов оружия
  document.querySelectorAll('.weapon-button').forEach(btn => {
    btn.classList.remove('selected');
  });
  
  // Выделяем выбранное оружие
  const button = document.querySelector(`[data-weapon="${type}"]`);
  if(button) {
    button.classList.add('selected');
    App.game.selectedWeapon = type;
    App.game.selectedShip = null;
    App.game.attackMode = true;
  }
}

function clearBoard(){
  if(!boardEl) return;
  boardEl.innerHTML = '';
  
  // Создаем 15x14 клеток
  for(let r = 0; r < 15; r++){
    for(let c = 0; c < 14; c++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = c;
      cell.dataset.y = r;
      
      // Добавляем зоны
      if(r >= 10) cell.classList.add('my-zone');
      else if(r < 5) cell.classList.add('enemy-zone');
      
      cell.addEventListener('click', handleCellClick);
      cell.addEventListener('dragover', handleDragOver);
      cell.addEventListener('drop', handleDrop);
      boardEl.appendChild(cell);
    }
  }
}

function handleCellClick(e) {
  const cell = e.target;
  const x = parseInt(cell.dataset.x);
  const y = parseInt(cell.dataset.y);
  
  if(App.game.setupPhase && App.game.selectedShip) {
    // Режим расстановки
    placeShip(x, y, App.game.selectedShip);
  } else if(App.game.attackMode && App.game.selectedWeapon) {
    // Режим атаки
    handleWeaponAttack(x, y, App.game.selectedWeapon);
  } else if(!App.game.setupPhase) {
    // Обычный ход
    handleMove(x, y);
  }
}

async function placeShip(x, y, shipType) {
  // Проверяем зону расстановки
  if(y < 10) {
    showNotification('Ошибка', 'Можно расставлять только в своей зоне', 'error');
    return;
  }
  
  if(App.game.shipCounts[shipType] <= 0) {
    showNotification('Ошибка', 'Корабли этого типа закончились', 'error');
    return;
  }
  
  try {
    const res = await api(`/game/setup/${App.game.id}/`, 'POST', {
      placements: [{
        x: x,
        y: y,
        kind: shipType
      }]
    });
    
    if(res.state) {
      App.game.state = res.state;
      App.game.shipCounts[shipType]--;
      updateShipCounts();
      renderGame();
      showNotification('Успех', `${shipType} размещен`, 'success');
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось разместить корабль', 'error');
  }
}

function updateShipCounts() {
  Object.keys(SHIP_TYPES).forEach(type => {
    const countDiv = document.querySelector(`[data-ship="${type}"]`)?.parentElement?.querySelector('.ship-count');
    if(countDiv) {
      countDiv.textContent = App.game.shipCounts[type] || 0;
    }
  });
}

async function handleWeaponAttack(x, y, weaponType) {
  try {
    let res;
    
    switch(weaponType) {
      case 'torpedo':
        if(!App.game.selectedCells.length) {
          // Первый клик - выбираем торпеду
          App.game.selectedCells.push({x, y, type: 'torpedo'});
          highlightCell(x, y, 'selected');
          showNotification('Торпедная атака', 'Теперь выберите торпедный катер', 'info');
          return;
        } else if(App.game.selectedCells.length === 1) {
          // Второй клик - выбираем катер
          App.game.selectedCells.push({x, y, type: 'tk'});
          highlightCell(x, y, 'selected');
          
          // Показываем возможные направления
          showTorpedoDirections(App.game.selectedCells[0], App.game.selectedCells[1]);
          return;
        }
        break;
        
      case 'air':
        if(!App.game.selectedCells.length) {
          // Первый клик - выбираем авианосец
          App.game.selectedCells.push({x, y, type: 'carrier'});
          highlightCell(x, y, 'selected');
          showNotification('Воздушная атака', 'Теперь выберите самолет', 'info');
          return;
        } else {
          // Второй клик - выбираем самолет и атакуем
          const carrier = App.game.selectedCells[0];
          res = await api(`/game/air/${App.game.id}/`, 'POST', {
            a: [carrier.x, carrier.y],
            s: [x, y]
          });
        }
        break;
        
      case 'bomb':
        // Атомная бомба - сразу взрыв
        res = await api(`/game/bomb/${App.game.id}/`, 'POST', {
          ab: [x, y]
        });
        showExplosion(x, y, 5); // Показываем взрыв 5x5
        break;
    }
    
    if(res && res.state) {
      App.game.state = res.state;
      renderGame();
      clearSelection();
      showNotification('Атака выполнена', 'Специальная атака проведена', 'success');
    }
    
  } catch(err) {
    showNotification('Ошибка', 'Не удалось выполнить атаку', 'error');
    clearSelection();
  }
}

function showTorpedoDirections(torpedo, tk) {
  // Показываем 7 возможных направлений для торпеды
  const directions = [
    {dx: 1, dy: 0, name: 'вправо'},
    {dx: -1, dy: 0, name: 'влево'},
    {dx: 0, dy: 1, name: 'вниз'},
    {dx: 0, dy: -1, name: 'вверх'},
    {dx: 1, dy: 1, name: 'вправо-вниз'},
    {dx: -1, dy: 1, name: 'влево-вниз'},
    {dx: 1, dy: -1, name: 'вправо-вверх'},
    {dx: -1, dy: -1, name: 'влево-вверх'}
  ];
  
  // Исключаем направление назад к катеру
  const backDir = {
    dx: tk.x - torpedo.x,
    dy: tk.y - torpedo.y
  };
  
  const validDirections = directions.filter(dir => 
    !(dir.dx === backDir.dx && dir.dy === backDir.dy)
  );
  
  // Создаем стрелки для выбора направления
  validDirections.forEach(dir => {
    const targetX = torpedo.x + dir.dx;
    const targetY = torpedo.y + dir.dy;
    
    if(targetX >= 0 && targetX < 14 && targetY >= 0 && targetY < 15) {
      const cell = getCellElement(targetX, targetY);
      if(cell) {
        const arrow = document.createElement('div');
        arrow.className = 'attack-arrow';
        arrow.textContent = '→';
        arrow.style.transform = `rotate(${getArrowRotation(dir.dx, dir.dy)}deg)`;
        arrow.addEventListener('click', () => fireTorpedo(torpedo, tk, dir));
        cell.appendChild(arrow);
      }
    }
  });
}

function getArrowRotation(dx, dy) {
  if(dx === 1 && dy === 0) return 0;    // вправо
  if(dx === -1 && dy === 0) return 180; // влево
  if(dx === 0 && dy === 1) return 90;   // вниз
  if(dx === 0 && dy === -1) return 270; // вверх
  if(dx === 1 && dy === 1) return 45;   // вправо-вниз
  if(dx === -1 && dy === 1) return 135; // влево-вниз
  if(dx === 1 && dy === -1) return 315; // вправо-вверх
  if(dx === -1 && dy === -1) return 225; // влево-вверх
  return 0;
}

async function fireTorpedo(torpedo, tk, direction) {
  try {
    const res = await api(`/game/torpedo/${App.game.id}/`, 'POST', {
      t: [torpedo.x, torpedo.y],
      tk: [tk.x, tk.y],
      dir: [direction.dx, direction.dy]
    });
    
    if(res.state) {
      App.game.state = res.state;
      renderGame();
      clearSelection();
      showNotification('Торпедная атака', 'Торпеда выпущена!', 'success');
      
      // Анимация полета торпеды
      animateTorpedoPath(torpedo, direction);
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось выстрелить торпедой', 'error');
    clearSelection();
  }
}

function animateTorpedoPath(start, direction) {
  let x = start.x;
  let y = start.y;
  
  const animate = () => {
    x += direction.dx;
    y += direction.dy;
    
    if(x < 0 || x >= 14 || y < 0 || y >= 15) return;
    
    const cell = getCellElement(x, y);
    if(cell) {
      const torpedo = document.createElement('div');
      torpedo.className = 'attack-arrow';
      torpedo.textContent = '●';
      torpedo.style.background = '#ff4500';
      cell.appendChild(torpedo);
      
      setTimeout(() => {
        torpedo.remove();
        animate();
      }, 200);
    }
  };
  
  setTimeout(animate, 100);
}

function showExplosion(centerX, centerY, size) {
  const halfSize = Math.floor(size / 2);
  
  for(let dy = -halfSize; dy <= halfSize; dy++) {
    for(let dx = -halfSize; dx <= halfSize; dx++) {
      const x = centerX + dx;
      const y = centerY + dy;
      
      if(x >= 0 && x < 14 && y >= 0 && y < 15) {
        const cell = getCellElement(x, y);
        if(cell) {
          const explosion = document.createElement('div');
          explosion.className = 'explosion';
          cell.appendChild(explosion);
          
          setTimeout(() => explosion.remove(), 800);
        }
      }
    }
  }
}

function getCellElement(x, y) {
  return document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
}

function highlightCell(x, y, className) {
  const cell = getCellElement(x, y);
  if(cell) cell.classList.add(className);
}

function clearSelection() {
  App.game.selectedCells = [];
  App.game.attackMode = false;
  App.game.selectedWeapon = null;
  
  // Убираем все выделения
  document.querySelectorAll('.cell').forEach(cell => {
    cell.classList.remove('selected', 'valid-move', 'attack-zone');
  });
  
  // Убираем стрелки
  document.querySelectorAll('.attack-arrow').forEach(arrow => arrow.remove());
  
  // Убираем выделение с кнопок
  document.querySelectorAll('.weapon-button').forEach(btn => {
    btn.classList.remove('selected');
  });
}

async function handleMove(x, y) {
  // Обычное перемещение кораблей
  if(!App.game.selectedCells.length) {
    // Выбираем корабль для перемещения
    const cell = getCellElement(x, y);
    if(cell && cell.querySelector('.piece')) {
      App.game.selectedCells.push({x, y});
      highlightCell(x, y, 'selected');
      showValidMoves(x, y);
    }
  } else {
    // Перемещаем корабль
    const from = App.game.selectedCells[0];
    try {
      const res = await api(`/game/move/${App.game.id}/`, 'POST', {
        src: [from.x, from.y],
        dst: [x, y]
      });
      
      if(res.state) {
        App.game.state = res.state;
        renderGame();
        clearSelection();
        showNotification('Ход выполнен', 'Корабль перемещен', 'success');
      }
    } catch(err) {
      showNotification('Ошибка', 'Не удалось переместить корабль', 'error');
      clearSelection();
    }
  }
}

function showValidMoves(x, y) {
  // Показываем возможные ходы (соседние клетки)
  const directions = [{dx:1,dy:0}, {dx:-1,dy:0}, {dx:0,dy:1}, {dx:0,dy:-1}];
  
  directions.forEach(dir => {
    const newX = x + dir.dx;
    const newY = y + dir.dy;
    
    if(newX >= 0 && newX < 14 && newY >= 0 && newY < 15) {
      highlightCell(newX, newY, 'valid-move');
    }
  });
}

function labelKind(kind){
  const map = {
    "BDK":"БДК","KR":"КР","A":"А","S":"С","TN":"ТН","L":"Л","ES":"ЭС","M":"М","SM":"СМ","F":"Ф",
    "TK":"ТК","T":"Т","TR":"ТР","ST":"СТ","PL":"ПЛ","KRPL":"КРПЛ","AB":"АБ","VMB":"ВМБ"
  };
  return map[kind] || kind;
}

function classKind(kind){
  return 'kind' + labelKind(kind);
}

async function startGameByRoomUrl(url){
  const code = url.split('/').filter(Boolean).pop();
  try{
    const d = await api(`/game/by-code/${code}/`);
    App.game.id = d.id;
    App.game.state = d.state;
    App.game.myPlayer = d.my_player;
    App.game.setupPhase = d.state.phase === 'SETUP';
    
    initializeShipCounts();
    startGamePolling();
    
    showContent('game');
    renderGame();
    createShipButtons();
    
    // Инициализируем обработчики оружия
    document.querySelectorAll('.weapon-button').forEach(btn => {
      btn.addEventListener('click', () => selectWeapon(btn.dataset.weapon));
    });
    
  }catch(err){ 
    showNotification('Ошибка', 'Не удалось открыть игру', 'error');
  }
}

function startGamePolling(){
  if(App.game.pollTimer) clearInterval(App.game.pollTimer);
  
  App.game.pollTimer = setInterval(async () => {
    if(!App.game.id) return;
    
    try{
      const d = await api(`/game/state/${App.game.id}/`);
      if(d.state){
        const oldPhase = App.game.state?.phase;
        App.game.state = d.state;
        
        // Проверяем смену фазы
        if(oldPhase === 'SETUP' && d.state.phase !== 'SETUP') {
          App.game.setupPhase = false;
          showNotification('Игра началась!', 'Фаза расстановки завершена', 'success');
        }
        
        renderGame();
        
        // Проверяем окончание игры
        if(d.state.winner) {
          showGameResult(d.state.winner, d.state.win_reason);
        }
      }
      
      updateTimers({
        turn_left: 30,
        bank_left: 900
      });
      
    }catch(err){
      console.error('Ошибка поллинга игры:', err);
    }
  }, 2000);
}

function updateTimers(data){
  if(hudTimer && data.turn_left !== undefined){
    hudTimer.textContent = data.turn_left + 's';
  }
  if(hudBank && data.bank_left !== undefined){
    const minutes = Math.floor(data.bank_left / 60);
    const seconds = data.bank_left % 60;
    hudBank.textContent = minutes + ':' + String(seconds).padStart(2, '0');
  }
}

function renderGame(){
  const st = App.game.state || {};
  
  // Обновляем индикатор хода
  if(turnIndicator) {
    const isMyTurn = st.turn === App.game.myPlayer;
    turnIndicator.textContent = isMyTurn ? 'Ваш ход' : 'Ход соперника';
    turnIndicator.style.color = isMyTurn ? '#27e881' : '#ff5e2c';
  }
  
  clearBoard();
  
  const board = st.board || {};
  Object.keys(board).forEach(k => {
    const [x, y] = k.split(',').map(Number);
    const cell = getCellElement(x, y);
    const pieces = board[k];
    
    if(cell && pieces && pieces.length > 0){
      const p = pieces[0];
      const span = document.createElement('span');
      span.textContent = labelKind(p.kind);
            span.className = `piece owner${p.owner} ${classKind(p.kind)}`;
      span.draggable = (!App.game.setupPhase && p.owner === App.game.myPlayer);
      span.addEventListener('dragstart', handleDragStart);
      span.dataset.kind = p.kind;
      span.dataset.owner = p.owner;
      
      // Добавляем крестик для уничтоженных кораблей
      if(p.destroyed) {
        span.classList.add('destroyed');
      }
      
      cell.appendChild(span);
    }
  });
}

function showGameResult(winner, reason) {
  if(App.game.pollTimer) {
    clearInterval(App.game.pollTimer);
    App.game.pollTimer = null;
  }
  
  const isWinner = winner === App.game.myPlayer;
  const ratingChange = isWinner ? 100 : -100;
  
  resultTitle.textContent = isWinner ? 'Победа!' : 'Поражение';
  resultTitle.className = `result-title ${isWinner ? 'victory' : 'defeat'}`;
  
  let reasonText = '';
  switch(reason) {
    case 'bases': reasonText = 'Уничтожены военно-морские базы'; break;
    case 'moves': reasonText = 'Уничтожены все движущиеся корабли'; break;
    case 'time': reasonText = 'Закончилось время'; break;
    case 'resign': reasonText = 'Противник сдался'; break;
    default: reasonText = 'Игра завершена';
  }
  
  resultDetails.innerHTML = `<p>${reasonText}</p>`;
  
  ratingChange.textContent = `Рейтинг: ${ratingChange > 0 ? '+' : ''}${ratingChange} очков`;
  ratingChange.className = `rating-change ${ratingChange > 0 ? 'positive' : 'negative'}`;
  
  gameResultModal.style.display = 'flex';
}

// ===== Drag & Drop =====
function handleDragStart(e){
  if(App.game.setupPhase) return;
  
  App.draggedPiece = {
    element: e.target,
    fromX: parseInt(e.target.parentElement.dataset.x),
    fromY: parseInt(e.target.parentElement.dataset.y),
    kind: e.target.dataset.kind,
    owner: parseInt(e.target.dataset.owner)
  };
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e){
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

async function handleDrop(e){
  e.preventDefault();
  if(!App.draggedPiece) return;
  
  const toX = parseInt(e.target.dataset.x);
  const toY = parseInt(e.target.dataset.y);
  
  try{
    const res = await api(`/game/move/${App.game.id}/`, 'POST', {
      src: [App.draggedPiece.fromX, App.draggedPiece.fromY],
      dst: [toX, toY]
    });
    
    if(res.state){
      App.game.state = res.state;
      renderGame();
      if(res.res && res.res.event){
        showNotification('Ход выполнен', `Результат: ${res.res.event}`, 'success');
      }
    }
  }catch(err){
    showNotification('Ошибка', 'Ошибка хода: ' + err.message, 'error');
  }
  
  App.draggedPiece = null;
}

// ===== Game controls =====
if(pauseBtn) {
  pauseBtn.addEventListener('click', () => {
    pauseModal.style.display = 'flex';
  });
}

if(shortPauseBtn) {
  shortPauseBtn.addEventListener('click', async () => {
    try {
      await api(`/game/pause/${App.game.id}/`, 'POST', { type: 'short' });
      pauseModal.style.display = 'none';
      showNotification('Пауза', 'Короткая пауза активирована (1 минута)', 'info');
    } catch(err) {
      showNotification('Ошибка', 'Не удалось активировать паузу', 'error');
    }
  });
}

if(longPauseBtn) {
  longPauseBtn.addEventListener('click', async () => {
    try {
      await api(`/game/pause/${App.game.id}/`, 'POST', { type: 'long' });
      pauseModal.style.display = 'none';
      showNotification('Пауза', 'Длинная пауза активирована (3 минуты)', 'info');
    } catch(err) {
      showNotification('Ошибка', 'Не удалось активировать паузу', 'error');
    }
  });
}

if(cancelPauseBtn) {
  cancelPauseBtn.addEventListener('click', () => {
    pauseModal.style.display = 'none';
  });
}

if(resignBtn) {
  resignBtn.addEventListener('click', async () => {
    const confirmResign = () => {
      return new Promise((resolve) => {
        const notification = document.createElement('div');
        notification.className = 'notification warning';
        notification.innerHTML = `
          <div class="notification-title">Подтверждение</div>
          <div class="notification-message">Вы уверены, что хотите сдаться?</div>
          <div style="margin-top: 1rem; display: flex; gap: 0.5rem; justify-content: center;">
            <button class="menuButs xs">Да</button>
            <button class="menuButs xs">Нет</button>
          </div>
        `;
        
        document.body.appendChild(notification);
        setTimeout(() => notification.classList.add('show'), 100);
        
        const buttons = notification.querySelectorAll('button');
        buttons[0].addEventListener('click', () => { notification.remove(); resolve(true); });
        buttons[1].addEventListener('click', () => { notification.remove(); resolve(false); });
      });
    };
    
    const confirmed = await confirmResign();
    if(!confirmed) return;
    
    try{
      await api(`/game/resign/${App.game.id}/`, 'POST', {});
      showNotification('Игра окончена', 'Вы сдались', 'info');
    }catch(err){
      showNotification('Ошибка', 'Ошибка сдачи', 'error');
    }
  });
}

// ===== Game result modal =====
if(gameResultExit) {
  gameResultExit.addEventListener('click', () => {
    gameResultModal.style.display = 'none';
    showContent('lobby');
    setTimeout(() => {
      loadUsers('');
      loadFriends();
    }, 100);
  });
}

// ===== History =====
async function loadHistory(){
  try{
    const d = await api('/game/my/');
    const items = d.items || [];
    const historyList = document.getElementById('historyList');
    if(!historyList) return;
    
    historyList.innerHTML = '';
    
    if(items.length === 0){
      historyList.innerHTML = '<li>История пуста</li>';
      return;
    }
    
    items.forEach(g => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div>
          <strong>Игра с ${g.opponent}</strong><br>
          <span class="muted">${g.created_at} • ${g.result}</span>
        </div>
        <div class="tag">${g.status}</div>
      `;
      historyList.appendChild(li);
    });
  }catch(err){
    const historyList = document.getElementById('historyList');
    if(historyList) historyList.innerHTML = '<li>Ошибка загрузки</li>';
  }
}

// ===== Auto setup for testing =====
async function autoSetup() {
  if(!App.game.id || !App.game.setupPhase) return;
  
  try {
    const res = await api(`/game/autosetup/${App.game.id}/`, 'POST', {});
    if(res.state) {
      App.game.state = res.state;
      
      // Обнуляем счетчики кораблей
      Object.keys(App.game.shipCounts).forEach(type => {
        App.game.shipCounts[type] = 0;
      });
      
      updateShipCounts();
      renderGame();
      showNotification('Успех', 'Автоматическая расстановка завершена', 'success');
      
      // Автоматически подтверждаем готовность
      setTimeout(async () => {
        try {
          await api(`/game/submit_setup/${App.game.id}/`, 'POST', {});
          showNotification('Готовность', 'Готовность подтверждена', 'success');
        } catch(err) {
          showNotification('Ошибка', 'Не удалось подтвердить готовность', 'error');
        }
      }, 1000);
    }
  } catch(err) {
    showNotification('Ошибка', 'Ошибка автоматической расстановки', 'error');
  }
}

// ===== Initialization =====
function init(){
  renderTopRight();
  initTabs();
  
  // Добавляем кнопку автоматической расстановки для тестирования
  if(shipsContainer) {
    const autoButton = document.createElement('button');
    autoButton.className = 'menuButs xs';
    autoButton.textContent = 'Авто';
    autoButton.style.margin = '1rem auto';
    autoButton.addEventListener('click', autoSetup);
    shipsContainer.parentElement.appendChild(autoButton);
  }
}

// Запускаем инициализацию когда DOM готов
if(document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}