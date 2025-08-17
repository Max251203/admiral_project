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

// Специальные правила
const SPECIAL_KILLS = {
  'ПЛ': ['БДК', 'А'],
  'КРПЛ': ['КР'],
  'ТР': ['М'] // ТР обезвреживает мины
};

// Неподвижные фишки
const IMMOBILE_TYPES = ['ВМБ', 'СМ'];

// Особые перемещения
const SPECIAL_MOVES = {
  'ТК': 2, // ТК может двигаться на 2 клетки
  'М': { carrier: 'ЭС', range: 1 }, // М может двигаться только вокруг ЭС
  'Т': { carrier: 'ТК', range: 1 }, // Т может двигаться только вокруг ТК
  'С': { carrier: 'А', range: 1 }  // С может двигаться только вокруг А
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
    selectedPiece: null,
    selectedCells: [],
    groupMode: false,
    attackMode: false,
    setupPhase: true,
    shipCounts: {},
    pausesUsed: { short: false, long: false },
    selectedGroup: [] // Для выбора групп кораблей
  },
  selectedCell: null,
  pauseTimer: null
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

const gameResultModal = document.getElementById('gameResultModal');
const gameResultExit = document.getElementById('gameResultExit');
const resultTitle = document.getElementById('resultTitle');
const resultDetails = document.getElementById('resultDetails');
const ratingChange = document.getElementById('ratingChange');

const pauseModal = document.getElementById('pauseModal');
const shortPauseBtn = document.getElementById('shortPauseBtn');
const longPauseBtn = document.getElementById('longPauseBtn');
const cancelPauseBtn = document.getElementById('cancelPauseBtn');

// Новый оверлей паузы
const pauseModalOverlay = document.getElementById('pauseModalOverlay');
const pauseTimer = document.getElementById('pauseTimer');
const pauseInfo = document.getElementById('pauseInfo');
const pauseControls = document.getElementById('pauseControls');
const cancelPauseBtn2 = document.getElementById('cancelPauseBtn2');

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
if(userSearch) {
  userSearch.addEventListener('input', () => loadUsers(userSearch.value.trim()));
}

if(showMeBtn) {
  showMeBtn.addEventListener('click', () => {
    if(!App.isAuth) return;
    
    // Находим себя в списке
    const myItem = usersList.querySelector(`[data-login="${App.meLogin}"]`);
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
  return wins * 100 - losses * 100; // Начальный рейтинг 0
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
  
  // Получаем данные о себе
  let meData = null;
  if(App.isAuth) {
    api('/accounts/api/me/').then(me => {
      meData = {
        id: me.id,
        login: App.meLogin,
        username: me.username,
        rating: me.rating_elo || 0,
        wins: me.wins || 0,
        losses: me.losses || 0
      };
      
      // Добавляем себя в список
      const allUsers = [...arr];
      if(meData) {
        allUsers.push(meData);
      }
      
      // Сортируем по рейтингу
      allUsers.sort((a, b) => {
        const ratingA = calculateRating(a.wins || 0, a.losses || 0);
        const ratingB = calculateRating(b.wins || 0, b.losses || 0);
        return ratingB - ratingA;
      });
      
      renderUsersList(allUsers);
    }).catch(() => {
      // Если не удалось получить данные о себе, просто отображаем список
      renderUsersList(arr);
    });
  } else {
    // Сортируем по рейтингу
    arr.sort((a, b) => {
      const ratingA = calculateRating(a.wins || 0, a.losses || 0);
      const ratingB = calculateRating(b.wins || 0, b.losses || 0);
      return ratingB - ratingA;
    });
    
    renderUsersList(arr);
  }
}

function renderUsersList(arr) {
  usersList.innerHTML = '';
  
  if(arr.length === 0){ 
    usersList.innerHTML = '<li>Пусто</li>'; 
    return; 
  }
  
  arr.forEach((u, index) => {
    const rating = calculateRating(u.wins || 0, u.losses || 0);
    const isMe = App.isAuth && u.login === App.meLogin;
    
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

// Исправление в app.js - функция loadFriends
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

// Создаем список фишек для расстановки
function createShipsList() {
  if(!shipsContainer) return;
  shipsContainer.innerHTML = '';
  
  Object.keys(SHIP_TYPES).forEach(type => {
    const shipData = SHIP_TYPES[type];
    const count = App.game.shipCounts[type] || 0;
    
    const item = document.createElement('div');
    item.className = 'ship-item';
    item.dataset.ship = type;
    item.innerHTML = `${type} <span class="ship-count">${count}</span>`;
    
    item.addEventListener('click', () => selectShip(type));
    shipsContainer.appendChild(item);
  });
}

// Создаем панель управления
function createControlsPanel() {
  const controlsContainer = document.getElementById('controlsContainer');
  if(!controlsContainer) return;
  
  controlsContainer.innerHTML = '';
  
  // Кнопка группы
  const groupBtn = document.createElement('div');
  groupBtn.className = 'control-button';
  groupBtn.id = 'groupBtn';
  groupBtn.innerHTML = `Группа <div class="tooltip">Выбор группы кораблей для совместного хода</div>`;
  groupBtn.addEventListener('click', toggleGroupMode);
  
  // Кнопка атаки
  const attackBtn = document.createElement('div');
  attackBtn.className = 'control-button';
  attackBtn.id = 'attackBtn';
  attackBtn.innerHTML = `Атака <div class="tooltip">Режим атаки вражеских кораблей</div>`;
  attackBtn.addEventListener('click', toggleAttackMode);
  
  // Кнопка авторазмещения
  const autoPlaceBtn = document.createElement('div');
  autoPlaceBtn.className = 'control-button';
  autoPlaceBtn.id = 'autoPlaceBtn';
  autoPlaceBtn.innerHTML = `Авто <div class="tooltip">Автоматическое размещение всех кораблей</div>`;
  autoPlaceBtn.addEventListener('click', autoSetup);
  
  // Кнопка готовности
  const readyBtn = document.createElement('div');
  readyBtn.className = 'control-button';
  readyBtn.id = 'readyBtn';
  readyBtn.innerHTML = `Готов <div class="tooltip">Подтвердить готовность к игре</div>`;
  readyBtn.addEventListener('click', submitSetup);
  
  // Добавляем кнопки в контейнер
  controlsContainer.appendChild(groupBtn);
  controlsContainer.appendChild(attackBtn);
  controlsContainer.appendChild(autoPlaceBtn);
  
  // Если фаза расстановки, показываем кнопку готовности
  if(App.game.setupPhase) {
    controlsContainer.appendChild(readyBtn);
  }
}

// Переключение режима группы
function toggleGroupMode() {
  const groupBtn = document.getElementById('groupBtn');
  
  // Если режим группы уже активен, отключаем его
  if(App.game.groupMode) {
    App.game.groupMode = false;
    groupBtn.classList.remove('selected');
    clearGroupSelection();
  } else {
    // Включаем режим группы
    App.game.groupMode = true;
    App.game.attackMode = false;
    App.game.selectedShip = null;
    App.game.selectedPiece = null;
    
    // Выделяем кнопку группы
    groupBtn.classList.add('selected');
    
    // Снимаем выделение с других кнопок
    document.getElementById('attackBtn')?.classList.remove('selected');
    document.querySelectorAll('.ship-item').forEach(item => {
      item.classList.remove('selected');
    });
    
    // Очищаем выделение клеток
    clearSelection();
  }
}

// Переключение режима атаки
function toggleAttackMode() {
  const attackBtn = document.getElementById('attackBtn');
  
  // Если режим атаки уже активен, отключаем его
  if(App.game.attackMode) {
    App.game.attackMode = false;
    attackBtn.classList.remove('selected');
  } else {
    // Включаем режим атаки
    App.game.attackMode = true;
    App.game.groupMode = false;
    App.game.selectedShip = null;
    App.game.selectedPiece = null;
    
    // Выделяем кнопку атаки
    attackBtn.classList.add('selected');
    
    // Снимаем выделение с других кнопок
    document.getElementById('groupBtn')?.classList.remove('selected');
    document.querySelectorAll('.ship-item').forEach(item => {
      item.classList.remove('selected');
    });
    
    // Очищаем выделение клеток и групп
    clearSelection();
    clearGroupSelection();
  }
}

function selectShip(type) {
  if(App.game.shipCounts[type] <= 0) return;
  
  // Убираем выделение с других фишек
  document.querySelectorAll('.ship-item').forEach(item => {
    item.classList.remove('selected');
  });
  
  // Выделяем выбранную фишку
  const item = document.querySelector(`[data-ship="${type}"]`);
  if(item) {
    item.classList.add('selected');
    App.game.selectedShip = type;
    App.game.selectedPiece = null;
    App.game.groupMode = false;
    App.game.attackMode = false;
    
    // Убираем выделение с кнопок управления
    document.querySelectorAll('.control-button').forEach(btn => {
      btn.classList.remove('selected');
    });
    
    // Очищаем выделение клеток и групп
    clearSelection();
    clearGroupSelection();
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
      if(App.game.myPlayer === 1) {
        if(r >= 10) cell.classList.add('my-zone');
        else if(r < 5) cell.classList.add('enemy-zone');
      } else {
        if(r < 5) cell.classList.add('my-zone');
        else if(r >= 10) cell.classList.add('enemy-zone');
      }
      
      cell.addEventListener('click', handleCellClick);
      boardEl.appendChild(cell);
    }
  }
}

function handleCellClick(e) {
  const cell = e.currentTarget;
  const x = parseInt(cell.dataset.x);
  const y = parseInt(cell.dataset.y);
  
  if(App.game.setupPhase && App.game.selectedShip) {
    // Режим расстановки
    placeShip(x, y, App.game.selectedShip);
  } else if(!App.game.setupPhase) {
    // Проверяем, чей сейчас ход
    if(App.game.state.turn !== App.game.myPlayer) {
      showNotification('Ошибка', 'Сейчас не ваш ход', 'error');
      return;
    }
    
    // Проверяем режим
    if(App.game.groupMode) {
      // Режим группы
      handleGroupSelection(x, y);
    } else if(App.game.attackMode) {
      // Режим атаки
      handleAttack(x, y);
    } else {
      // Обычный режим - выбор фишки для перемещения
      handlePieceSelection(x, y);
    }
  }
}

// Обработка выбора фишки для группы
function handleGroupSelection(x, y) {
  const cell = getCellElement(x, y);
  const piece = cell.querySelector('.piece');
  
  if(!piece || parseInt(piece.dataset.owner) !== App.game.myPlayer) {
    showNotification('Ошибка', 'Выберите свою фишку', 'error');
    return;
  }
  
  // Проверяем, что фишка не неподвижная
  if(IMMOBILE_TYPES.includes(piece.dataset.kind)) {
    showNotification('Ошибка', 'Этот корабль неподвижен', 'error');
    return;
  }
  
  // Если группа пуста, начинаем новую группу
  if(App.game.selectedGroup.length === 0) {
    App.game.selectedGroup.push({x, y, kind: piece.dataset.kind});
    cell.classList.add('group-selected');
    
    // Добавляем индикатор группы
    const indicator = document.createElement('div');
    indicator.className = 'group-indicator';
    cell.appendChild(indicator);
    
  // Если это не первая фишка в группе, проверяем, что она того же типа
  } else if(App.game.selectedGroup.length < 3) {
    const firstPiece = App.game.selectedGroup[0];
    
    // Проверяем, что фишка того же типа
    if(piece.dataset.kind !== firstPiece.kind) {
      showNotification('Ошибка', 'В группу можно добавлять только фишки одного типа', 'error');
      return;
    }
    
    // Проверяем, что фишка находится рядом с другой фишкой группы
    let isAdjacent = false;
    for(const groupPiece of App.game.selectedGroup) {
      const dx = Math.abs(x - groupPiece.x);
      const dy = Math.abs(y - groupPiece.y);
      if(dx + dy === 1) {
        isAdjacent = true;
        break;
      }
    }
    
    if(!isAdjacent) {
      showNotification('Ошибка', 'Фишка должна быть рядом с другой фишкой группы', 'error');
      return;
    }
    
    // Проверяем, что фишка еще не в группе
    const alreadyInGroup = App.game.selectedGroup.some(p => p.x === x && p.y === y);
    if(alreadyInGroup) {
      showNotification('Ошибка', 'Эта фишка уже в группе', 'error');
      return;
    }
    
    // Добавляем фишку в группу
    App.game.selectedGroup.push({x, y, kind: piece.dataset.kind});
    cell.classList.add('group-selected');
    
    // Добавляем индикатор группы
    const indicator = document.createElement('div');
    indicator.className = 'group-indicator';
    cell.appendChild(indicator);
  } else {
    showNotification('Информация', 'Группа может содержать максимум 3 фишки', 'info');
  }
}

// Обработка атаки
function handleAttack(x, y) {
  // Если у нас уже есть выбранная фишка, пытаемся атаковать
  if(App.game.selectedPiece) {
    const fromX = App.game.selectedPiece.x;
    const fromY = App.game.selectedPiece.y;
    
    // Проверяем, что клетка находится рядом
    const dx = Math.abs(x - fromX);
    const dy = Math.abs(y - fromY);
    
    if(dx + dy !== 1) {
      showNotification('Ошибка', 'Можно атаковать только соседнюю клетку', 'error');
      return;
    }
    
    // Выполняем атаку
    moveAndAttack(fromX, fromY, x, y);
  } else {
    // Выбираем фишку для атаки
    const cell = getCellElement(x, y);
    const piece = cell.querySelector('.piece');
    
    if(!piece || parseInt(piece.dataset.owner) !== App.game.myPlayer) {
      showNotification('Ошибка', 'Выберите свою фишку для атаки', 'error');
      return;
    }
    
    // Проверяем, что фишка не неподвижная
    if(IMMOBILE_TYPES.includes(piece.dataset.kind)) {
      showNotification('Ошибка', 'Этот корабль неподвижен', 'error');
      return;
    }
    
    // Выбираем фишку
    App.game.selectedPiece = {x, y, kind: piece.dataset.kind};
    highlightCell(x, y, 'selected');
    
    // Показываем доступные клетки для атаки
    showAttackZones(x, y);
  }
}

// Показываем зоны атаки
function showAttackZones(x, y) {
  // Очищаем предыдущие подсветки
  document.querySelectorAll('.cell.attack-zone').forEach(cell => {
    cell.classList.remove('attack-zone');
  });
  
  // Подсвечиваем соседние клетки
  const directions = [{dx:1,dy:0}, {dx:-1,dy:0}, {dx:0,dy:1}, {dx:0,dy:-1}];
  
    directions.forEach(dir => {
    const newX = x + dir.dx;
    const newY = y + dir.dy;
    
    if(newX >= 0 && newX < 14 && newY >= 0 && newY < 15) {
      highlightCell(newX, newY, 'attack-zone');
    }
  });
}

// Выполняем атаку
async function moveAndAttack(fromX, fromY, toX, toY) {
  try {
    const res = await api(`/game/move/${App.game.id}/`, 'POST', {
      src: [fromX, fromY],
      dst: [toX, toY]
    });
    
    if(res.state) {
      App.game.state = res.state;
      renderGame();
      clearSelection();
      
      // Показываем результат атаки
      if(res.res && res.res.event) {
        let message = 'Атака выполнена';
        switch(res.res.event) {
          case 'move': message = 'Перемещение выполнено'; break;
          case 'def_win': message = 'Ваша фишка уничтожена'; break;
          case 'exchange': message = 'Обмен ударами, обе фишки уничтожены'; break;
          case 'mine_boom': message = 'Ваша фишка подорвалась на мине'; break;
          case 'mine_swept': message = 'Мина обезврежена тральщиком'; break;
          case 'tanker_boom': message = 'Танкер взорвался'; break;
          case 'ab_explode': message = 'Атомный взрыв!'; break;
        }
        showNotification('Результат', message, 'success');
      }
      
      // Обновляем таблицу убитых фишек
      updateKilledTable();
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось выполнить атаку: ' + err.message, 'error');
    clearSelection();
  }
}

// Обработка выбора фишки для перемещения
function handlePieceSelection(x, y) {
  const cell = getCellElement(x, y);
  const piece = cell.querySelector('.piece');
  
  // Если у нас уже есть выбранная фишка, пытаемся переместить её
  if(App.game.selectedPiece) {
    const fromX = App.game.selectedPiece.x;
    const fromY = App.game.selectedPiece.y;
    
    // Проверяем, что выбрана допустимая клетка для хода
    if(!cell.classList.contains('valid-move')) {
      showNotification('Ошибка', 'Недопустимый ход', 'error');
      clearSelection();
      return;
    }
    
    // Перемещаем фишку
    movePiece(fromX, fromY, x, y);
  } else if(App.game.selectedGroup.length > 0) {
    // Если у нас выбрана группа, пытаемся переместить её
    moveGroup(x, y);
  } else {
    // Выбираем фишку для перемещения
    if(!piece || parseInt(piece.dataset.owner) !== App.game.myPlayer) {
      showNotification('Ошибка', 'Выберите свою фишку', 'error');
      return;
    }
    
    // Проверяем, что фишка не неподвижная
    if(IMMOBILE_TYPES.includes(piece.dataset.kind)) {
      showNotification('Ошибка', 'Этот корабль неподвижен', 'error');
      return;
    }
    
    // Выбираем фишку
    App.game.selectedPiece = {x, y, kind: piece.dataset.kind};
    highlightCell(x, y, 'selected');
    
    // Показываем доступные ходы
    showValidMoves(x, y, piece.dataset.kind);
  }
}

// Перемещение фишки
async function movePiece(fromX, fromY, toX, toY) {
  try {
    const res = await api(`/game/move/${App.game.id}/`, 'POST', {
      src: [fromX, fromY],
      dst: [toX, toY]
    });
    
    if(res.state) {
      App.game.state = res.state;
      renderGame();
      clearSelection();
      
      // Показываем результат хода
      if(res.res && res.res.event) {
        let message = 'Ход выполнен';
        switch(res.res.event) {
          case 'move': message = 'Перемещение выполнено'; break;
          case 'def_win': message = 'Ваша фишка уничтожена'; break;
          case 'exchange': message = 'Обмен ударами, обе фишки уничтожены'; break;
          case 'mine_boom': message = 'Ваша фишка подорвалась на мине'; break;
          case 'mine_swept': message = 'Мина обезврежена тральщиком'; break;
          case 'tanker_boom': message = 'Танкер взорвался'; break;
          case 'ab_explode': message = 'Атомный взрыв!'; break;
        }
        showNotification('Результат', message, 'success');
      }
      
      // Обновляем таблицу убитых фишек
      updateKilledTable();
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось переместить фишку: ' + err.message, 'error');
    clearSelection();
  }
}

// Перемещение группы
async function moveGroup(toX, toY) {
  if(App.game.selectedGroup.length === 0) return;
  
  // Проверяем, что клетка находится рядом с одной из фишек группы
  let isAdjacent = false;
  for(const groupPiece of App.game.selectedGroup) {
    const dx = Math.abs(toX - groupPiece.x);
    const dy = Math.abs(toY - groupPiece.y);
    if(dx + dy === 1) {
      isAdjacent = true;
      break;
    }
  }
  
  if(!isAdjacent) {
    showNotification('Ошибка', 'Группа может двигаться только на соседнюю клетку', 'error');
    return;
  }
  
  try {
    // Подготавливаем данные для API
    const firstPiece = App.game.selectedGroup[0];
    const followers = App.game.selectedGroup.slice(1).map(p => [p.x, p.y, toX, toY]);
    
    const res = await api(`/game/move/${App.game.id}/`, 'POST', {
      src: [firstPiece.x, firstPiece.y],
      dst: [toX, toY],
      followers: followers
    });
    
    if(res.state) {
      App.game.state = res.state;
      renderGame();
      clearGroupSelection();
      
      // Показываем результат хода
      if(res.res && res.res.event) {
        let message = 'Группа перемещена';
        switch(res.res.event) {
          case 'move': message = 'Группа перемещена'; break;
          case 'def_win': message = 'Ваша группа уничтожена'; break;
          case 'exchange': message = 'Обмен ударами, обе группы уничтожены'; break;
          case 'mine_boom': message = 'Ваша группа подорвалась на мине'; break;
          case 'mine_swept': message = 'Мина обезврежена тральщиком'; break;
          case 'tanker_boom': message = 'Танкер взорвался'; break;
          case 'ab_explode': message = 'Атомный взрыв!'; break;
        }
        showNotification('Результат', message, 'success');
      }
      
      // Обновляем таблицу убитых фишек
      updateKilledTable();
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось переместить группу: ' + err.message, 'error');
    clearGroupSelection();
  }
}

// Функция для показа доступных ходов
function showValidMoves(x, y, pieceKind) {
  // Очищаем предыдущие подсветки
  document.querySelectorAll('.cell.valid-move').forEach(cell => {
    cell.classList.remove('valid-move');
  });
  
  // Проверяем особые правила перемещения
  const specialMove = SPECIAL_MOVES[pieceKind];
  
  if(specialMove) {
    if(typeof specialMove === 'number') {
      // Фишка с увеличенной дальностью хода (например, ТК)
      const range = specialMove;
      const directions = [{dx:1,dy:0}, {dx:-1,dy:0}, {dx:0,dy:1}, {dx:0,dy:-1}];
      
      directions.forEach(dir => {
        for(let i = 1; i <= range; i++) {
          const newX = x + dir.dx * i;
          const newY = y + dir.dy * i;
          
          if(newX >= 0 && newX < 14 && newY >= 0 && newY < 15) {
            const cell = getCellElement(newX, newY);
            const piece = cell.querySelector('.piece');
            
            // Если клетка занята, останавливаемся
            if(piece) break;
            
            highlightCell(newX, newY, 'valid-move');
          }
        }
      });
    } else {
      // Фишка, которая может двигаться только вокруг носителя (например, М вокруг ЭС)
      const carrier = specialMove.carrier;
      const range = specialMove.range;
      
      // Ищем носителя рядом
      const directions = [{dx:1,dy:0}, {dx:-1,dy:0}, {dx:0,dy:1}, {dx:0,dy:-1}];
      
      directions.forEach(dir => {
        const carrierX = x + dir.dx;
        const carrierY = y + dir.dy;
        
        if(carrierX >= 0 && carrierX < 14 && carrierY >= 0 && carrierY < 15) {
          const carrierCell = getCellElement(carrierX, carrierY);
          const carrierPiece = carrierCell.querySelector('.piece');
          
          // Если нашли носителя
          if(carrierPiece && carrierPiece.dataset.kind === carrier && parseInt(carrierPiece.dataset.owner) === App.game.myPlayer) {
            // Показываем доступные ходы вокруг носителя
            directions.forEach(moveDir => {
              const newX = carrierX + moveDir.dx;
              const newY = carrierY + moveDir.dy;
              
              // Не показываем текущую позицию
              if(newX === x && newY === y) return;
              
              if(newX >= 0 && newX < 14 && newY >= 0 && newY < 15) {
                const cell = getCellElement(newX, newY);
                const piece = cell.querySelector('.piece');
                
                // Если клетка свободна
                if(!piece) {
                  highlightCell(newX, newY, 'valid-move');
                }
              }
            });
          }
        }
      });
    }
  } else {
    // Обычная фишка - ход на 1 клетку
    const directions = [{dx:1,dy:0}, {dx:-1,dy:0}, {dx:0,dy:1}, {dx:0,dy:-1}];
    
    directions.forEach(dir => {
      const newX = x + dir.dx;
      const newY = y + dir.dy;
      
      if(newX >= 0 && newX < 14 && newY >= 0 && newY < 15) {
        const cell = getCellElement(newX, newY);
        const piece = cell.querySelector('.piece');
        
        // Если клетка свободна или занята противником
        if(!piece || parseInt(piece.dataset.owner) !== App.game.myPlayer) {
          highlightCell(newX, newY, 'valid-move');
        }
      }
    });
  }
}

async function placeShip(x, y, shipType) {
  // Проверяем зону расстановки
  let validZone = false;
  if(App.game.myPlayer === 1 && y >= 10) {
    validZone = true;
  } else if(App.game.myPlayer === 2 && y < 5) {
    validZone = true;
  }
  
  if(!validZone) {
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
        kind: convertToApiShipType(shipType)
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
    showNotification('Ошибка', 'Не удалось разместить корабль: ' + err.message, 'error');
  }
}

// Конвертирует русские обозначения кораблей в английские для API
function convertToApiShipType(shipType) {
    const map = {
    'БДК': 'BDK', 'КР': 'KR', 'А': 'A', 'С': 'S', 'ТН': 'TN', 'Л': 'L', 'ЭС': 'ES',
    'М': 'M', 'СМ': 'SM', 'Ф': 'F', 'ТК': 'TK', 'Т': 'T', 'ТР': 'TR', 'СТ': 'ST',
    'ПЛ': 'PL', 'КРПЛ': 'KRPL', 'АБ': 'AB', 'ВМБ': 'VMB'
  };
  return map[shipType] || shipType;
}

// Конвертирует английские обозначения кораблей в русские для отображения
function convertFromApiShipType(shipType) {
  const map = {
    'BDK': 'БДК', 'KR': 'КР', 'A': 'А', 'S': 'С', 'TN': 'ТН', 'L': 'Л', 'ES': 'ЭС',
    'M': 'М', 'SM': 'СМ', 'F': 'Ф', 'TK': 'ТК', 'T': 'Т', 'TR': 'ТР', 'ST': 'СТ',
    'PL': 'ПЛ', 'KRPL': 'КРПЛ', 'AB': 'АБ', 'VMB': 'ВМБ'
  };
  return map[shipType] || shipType;
}

function updateShipCounts() {
  Object.keys(SHIP_TYPES).forEach(type => {
    const countSpan = document.querySelector(`[data-ship="${type}"] .ship-count`);
    if(countSpan) {
      countSpan.textContent = App.game.shipCounts[type] || 0;
    }
  });
}

function getCellElement(x, y) {
  return document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
}

function highlightCell(x, y, className) {
  const cell = getCellElement(x, y);
  if(cell) cell.classList.add(className);
}

function clearSelection() {
  App.game.selectedPiece = null;
  App.game.selectedCells = [];
  
  // Убираем все выделения
  document.querySelectorAll('.cell').forEach(cell => {
    cell.classList.remove('selected', 'valid-move', 'attack-zone');
  });
  
  // Убираем стрелки
  document.querySelectorAll('.attack-arrow').forEach(arrow => arrow.remove());
}

function clearGroupSelection() {
  // Убираем выделение с клеток группы
  document.querySelectorAll('.cell.group-selected').forEach(cell => {
    cell.classList.remove('group-selected');
  });
  
  // Убираем индикаторы группы
  document.querySelectorAll('.group-indicator').forEach(indicator => {
    indicator.remove();
  });
  
  App.game.selectedGroup = [];
}

// Функция для обновления таблицы убитых фишек
function updateKilledTable() {
  const killedTableBody = document.getElementById('killedTableBody');
  if(!killedTableBody) return;
  
  // Получаем данные о убитых фишках
  api(`/game/killed/${App.game.id}/`).then(data => {
    const items = data.items || [];
    
    killedTableBody.innerHTML = '';
    
    if(items.length === 0) {
      killedTableBody.innerHTML = '<tr><td colspan="3">Нет данных</td></tr>';
      return;
    }
    
    items.forEach(item => {
      const tr = document.createElement('tr');
      const russianType = convertFromApiShipType(item.piece);
      tr.innerHTML = `
        <td>${russianType}</td>
        <td>${item.killed}</td>
        <td>${SHIP_TYPES[russianType]?.count || '-'}</td>
      `;
      killedTableBody.appendChild(tr);
    });
  }).catch(err => {
    killedTableBody.innerHTML = '<tr><td colspan="3">Ошибка загрузки</td></tr>';
  });
}

// Функция для обновления состояния игры через AJAX вместо WebSockets
function startGamePolling() {
  if(App.game.pollTimer) clearInterval(App.game.pollTimer);
  
  App.game.pollTimer = setInterval(async () => {
    if(!App.game.id) return;
    
    try {
      // Получаем состояние игры
      const d = await api(`/game/state/${App.game.id}/`);
      if(d.state) {
        const oldPhase = App.game.state?.phase;
        const oldTurn = App.game.state?.turn;
        App.game.state = d.state;
        
        // Проверяем смену фазы
        if(oldPhase === 'SETUP' && d.state.phase !== 'SETUP') {
          App.game.setupPhase = false;
          showNotification('Игра началась!', 'Фаза расстановки завершена', 'success');
          
          // Обновляем панель управления
          createControlsPanel();
        }
        
        // Проверяем смену хода
        if(oldTurn !== d.state.turn && d.state.turn === App.game.myPlayer) {
          showNotification('Ваш ход', 'Сейчас ваша очередь ходить', 'info');
        }
        
        renderGame();
        
        // Проверяем окончание игры
        if(d.state.winner) {
          showGameResult(d.state.winner, d.state.win_reason);
        }
      }
      
      // Получаем информацию о таймерах
      const timerData = await api(`/game/timers/${App.game.id}/`);
      if(timerData) {
        updateTimers(timerData);
        
        // Обновляем информацию о доступных паузах
        App.game.pausesUsed.short = !timerData.short_available;
        App.game.pausesUsed.long = !timerData.long_available;
        
        // Проверяем, не на паузе ли игра
        if(timerData.paused && timerData.pause_left) {
          showPauseOverlay(timerData.pause_left, timerData.initiator === App.game.myPlayer);
        } else {
          hidePauseOverlay();
        }
        
        // Проверяем окончание игры
        if(timerData.finished && timerData.winner) {
          showGameResult(timerData.winner, timerData.reason);
        }
      }
      
    } catch(err) {
      console.error('Ошибка поллинга игры:', err);
    }
  }, 1000); // Обновляем каждую секунду
}

function updateTimers(data){
  if(hudTimer && data.turn_left !== undefined){
    hudTimer.textContent = data.turn_left + 's';
    
    // Добавляем визуальное предупреждение при малом времени
    if(data.turn_left <= 10) {
      hudTimer.style.color = '#ff5e2c';
    } else {
      hudTimer.style.color = '';
    }
  }
  
  if(hudBank && data.bank_left !== undefined){
    const minutes = Math.floor(data.bank_left / 60);
    const seconds = data.bank_left % 60;
    hudBank.textContent = minutes + ':' + String(seconds).padStart(2, '0');
    
    // Добавляем визуальное предупреждение при малом времени
    if(data.bank_left <= 60) {
      hudBank.style.color = '#ff5e2c';
    } else {
      hudBank.style.color = '';
    }
  }
  
  // Обновляем индикатор хода
  if(turnIndicator && data.turn !== undefined) {
    const isMyTurn = data.turn === App.game.myPlayer;
    turnIndicator.textContent = isMyTurn ? 'Ваш ход' : 'Ход соперника';
    turnIndicator.style.color = isMyTurn ? '#27e881' : '#ff5e2c';
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
      
      // В фазе расстановки показываем только свои фишки
      if(App.game.setupPhase && p.owner !== App.game.myPlayer) {
        return;
      }
      
      // В фазе игры показываем только свои фишки и уничтоженные фишки противника
      if(!App.game.setupPhase && p.owner !== App.game.myPlayer && p.alive) {
        return;
      }
      
      const span = document.createElement('span');
      span.className = `piece owner${p.owner} ${classKind(p.kind)}`;
      span.textContent = labelKind(p.kind);
      span.dataset.kind = p.kind;
      span.dataset.owner = p.owner;
      
      // Добавляем крестик для уничтоженных кораблей
      if(!p.alive) {
        span.classList.add('destroyed');
      }
      
      cell.appendChild(span);
    }
  });
  
  // Обновляем таблицу убитых фишек
  updateKilledTable();
}

function labelKind(kind){
  return convertFromApiShipType(kind);
}

function classKind(kind){
  return 'kind' + convertFromApiShipType(kind);
}

// Исправление в app.js - функция startGameByRoomUrl
async function startGameByRoomUrl(url){
  const code = url.split('/').filter(Boolean).pop();
  try{
    const d = await api(`/game/by-code/${code}/`);
    App.game.id = d.id;
    App.game.state = d.state;
    App.game.myPlayer = d.my_player;
    App.game.setupPhase = d.state.phase === 'SETUP';
    App.game.pausesUsed = { short: false, long: false };
    App.game.selectedGroup = [];
    
    initializeShipCounts();
    startGamePolling();
    
    showContent('game');
    
    // Создаем новый элемент доски вместо замены
    const boardContainer = document.querySelector('.board-container');
    if(boardContainer) {
      // Очищаем контейнер
      boardContainer.innerHTML = '';
      
      // Создаем новую доску
      const newBoard = document.createElement('div');
      newBoard.id = 'board';
      newBoard.className = 'board';
      
      // Добавляем новую доску в контейнер
      boardContainer.appendChild(newBoard);
      
      // Обновляем ссылку на доску
      boardEl = newBoard;
    }
    
    renderGame();
    
    // Создаем список фишек и панель управления
    createShipsList();
    createControlsPanel();
    
    // Добавляем таблицу убитых фишек в правую панель
    const controlsPanel = document.querySelector('.controls-panel');
    if(controlsPanel) {
      const killedTable = document.createElement('div');
      killedTable.innerHTML = `
        <h3 style="margin-top:2rem">Убитые фишки</h3>
        <table class="killed-table">
          <thead>
            <tr>
              <th>Тип</th>
              <th>Убито</th>
              <th>Всего</th>
            </tr>
          </thead>
          <tbody id="killedTableBody">
            <!-- Будет заполнено через JS -->
          </tbody>
        </table>
      `;
      controlsPanel.appendChild(killedTable);
    }
    
  }catch(err){ 
    showNotification('Ошибка', 'Не удалось открыть игру: ' + err.message, 'error');
  }
}

async function submitSetup() {
  // Проверяем, что все фишки размещены
  let allPlaced = true;
  Object.keys(SHIP_TYPES).forEach(type => {
    if(App.game.shipCounts[type] > 0) {
      allPlaced = false;
    }
  });
  
  if(!allPlaced) {
    showNotification('Ошибка', 'Сначала нужно разместить все фишки', 'error');
    return;
  }
  
  try {
    const res = await api(`/game/submit_setup/${App.game.id}/`, 'POST', {});
    if(res.ok) {
      showNotification('Готово', 'Расстановка подтверждена. Ожидаем соперника...', 'success');
      
      // Если оба игрока готовы, игра начинается
      if(res.status !== 'SETUP') {
        App.game.setupPhase = false;
        App.game.state.phase = res.status;
        App.game.state.turn = res.turn;
        
        // Обновляем панель управления
        createControlsPanel();
        
        renderGame();
      }
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось подтвердить расстановку: ' + err.message, 'error');
  }
}

// Авторазмещение
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
    }
  } catch(err) {
    showNotification('Ошибка', 'Ошибка автоматической расстановки: ' + err.message, 'error');
  }
}

function showGameResult(winner, reason) {
  if(App.game.pollTimer) {
    clearInterval(App.game.pollTimer);
    App.game.pollTimer = null;
  }
  
  const isWinner = winner === App.game.myPlayer;
  
  // Получаем текущий рейтинг пользователя
  api('/accounts/api/me/').then(me => {
    const currentRating = me.rating_elo || 0;
    const ratingChange = isWinner ? 100 : -100;
    const newRating = currentRating + ratingChange;
    
    resultTitle.textContent = isWinner ? 'Победа!' : 'Поражение';
    resultTitle.className = `result-title ${isWinner ? 'victory' : 'defeat'}`;
    
    let reasonText = '';
    switch(reason) {
      case 'bases': reasonText = 'Уничтожены военно-морские базы'; break;
      case 'moves': reasonText = 'Уничтожены все движущиеся корабли'; break;
      case 'time': reasonText = 'Закончилось время'; break;
      case 'resign': reasonText = isWinner ? 'Противник сдался' : 'Вы сдались'; break;
      default: reasonText = 'Игра завершена';
    }
    
    resultDetails.innerHTML = `<p>${reasonText}</p>`;
    
    if(currentRating > 0 || ratingChange > 0) {
      ratingChange.textContent = `Рейтинг: ${ratingChange > 0 ? '+' : ''}${ratingChange} очков (${newRating})`;
      ratingChange.className = `rating-change ${ratingChange > 0 ? 'positive' : 'negative'}`;
    } else {
      ratingChange.textContent = '';
    }
    
    // Обновляем статистику игрока
    updatePlayerStats(isWinner);
    
    gameResultModal.style.display = 'flex';
  }).catch(err => {
    // Если не удалось получить данные о рейтинге, просто показываем результат
    resultTitle.textContent = isWinner ? 'Победа!' : 'Поражение';
    resultTitle.className = `result-title ${isWinner ? 'victory' : 'defeat'}`;
    
    let reasonText = '';
    switch(reason) {
      case 'bases': reasonText = 'Уничтожены военно-морские базы'; break;
      case 'moves': reasonText = 'Уничтожены все движущиеся корабли'; break;
      case 'time': reasonText = 'Закончилось время'; break;
      case 'resign': reasonText = isWinner ? 'Противник сдался' : 'Вы сдались'; break;
      default: reasonText = 'Игра завершена';
    }
    
    resultDetails.innerHTML = `<p>${reasonText}</p>`;
    ratingChange.textContent = '';
    
    // Обновляем статистику игрока
    updatePlayerStats(isWinner);
    
    gameResultModal.style.display = 'flex';
  });
}

async function updatePlayerStats(isWinner) {
  try {
    // Здесь можно добавить API для обновления статистики
    // Например, отправить запрос на сервер с результатом игры
    await api('/accounts/api/update_stats/', 'POST', { 
      win: isWinner 
    });
  } catch(err) {
    console.error('Ошибка обновления статистики:', err);
  }
}

// ===== Game controls =====
if(pauseBtn) {
  pauseBtn.addEventListener('click', () => {
    // Проверяем, чей сейчас ход
    if(App.game.state.turn !== App.game.myPlayer) {
      showNotification('Ошибка', 'Пауза доступна только в свой ход', 'error');
      return;
    }
    
    // Проверяем, использованы ли уже паузы
    if(App.game.pausesUsed.short && App.game.pausesUsed.long) {
      showNotification('Ошибка', 'Вы уже использовали все доступные паузы', 'error');
      return;
    }
    
    // Если доступна только одна пауза, используем её сразу
    if(App.game.pausesUsed.short && !App.game.pausesUsed.long) {
      activatePause('long');
      return;
    }
    
    if(!App.game.pausesUsed.short && App.game.pausesUsed.long) {
      activatePause('short');
      return;
    }
    
    // Если доступны обе паузы, показываем модальное окно выбора
    pauseModal.style.display = 'flex';
    
    // Обновляем информацию о доступных паузах
    const pauseInfo = document.querySelector('.pause-info');
    if(pauseInfo) {
      pauseInfo.innerHTML = `
        Доступные паузы:
        <div>Короткая (1 мин): ${App.game.pausesUsed.short ? 'Использована' : 'Доступна'}</div>
        <div>Длинная (3 мин): ${App.game.pausesUsed.long ? 'Использована' : 'Доступна'}</div>
      `;
    }
  });
}

async function activatePause(type) {
  try {
    const res = await api(`/game/pause/${App.game.id}/`, 'POST', { type });
    
    if(res.ok) {
      if(type === 'short') {
        App.game.pausesUsed.short = true;
        showPauseOverlay(60, true); // 1 минута
      } else {
        App.game.pausesUsed.long = true;
        showPauseOverlay(180, true); // 3 минуты
      }
      
      pauseModal.style.display = 'none';
    }
  } catch(err) {
    showNotification('Ошибка', 'Не удалось активировать паузу: ' + err.message, 'error');
  }
}

// Исправление в app.js - функция showPauseOverlay
function showPauseOverlay(seconds, isMyPause) {
  // Останавливаем предыдущий таймер, если он был
  if(App.pauseTimer) {
    clearInterval(App.pauseTimer);
    App.pauseTimer = null;
  }
  
  // Показываем оверлей
  pauseModalOverlay.style.display = 'flex';
  
  // Устанавливаем начальное время
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  pauseTimer.textContent = `${minutes}:${String(secs).padStart(2, '0')}`;
  
  // Устанавливаем информацию
  pauseInfo.textContent = isMyPause ? 'Вы поставили паузу' : 'Соперник поставил паузу';
  
  // Показываем кнопку отмены паузы только тому, кто её поставил
  if(pauseControls) {
    pauseControls.style.display = isMyPause ? 'block' : 'none';
  }
  
  // Запускаем таймер обратного отсчета
  let timeLeft = seconds;
  App.pauseTimer = setInterval(() => {
    timeLeft--;
    if(timeLeft <= 0) {
      clearInterval(App.pauseTimer);
      App.pauseTimer = null;
      hidePauseOverlay();
      return;
    }
    
    const min = Math.floor(timeLeft / 60);
    const sec = timeLeft % 60;
    pauseTimer.textContent = `${min}:${String(sec).padStart(2, '0')}`;
  }, 1000);
}

// Функция для скрытия оверлея паузы
function hidePauseOverlay() {
  pauseModalOverlay.style.display = 'none';
  
  if(App.pauseTimer) {
    clearInterval(App.pauseTimer);
    App.pauseTimer = null;
  }
}

// Обработчик для кнопки отмены паузы
if(cancelPauseBtn2) {
  cancelPauseBtn2.addEventListener('click', async () => {
    try {
      await api(`/game/cancel_pause/${App.game.id}/`, 'POST');
      hidePauseOverlay();
    } catch(err) {
      showNotification('Ошибка', 'Не удалось отменить паузу: ' + err.message, 'error');
    }
  });
}

if(shortPauseBtn) {
  shortPauseBtn.addEventListener('click', () => {
    if(App.game.pausesUsed.short) {
      showNotification('Ошибка', 'Вы уже использовали короткую паузу', 'error');
      pauseModal.style.display = 'none';
      return;
    }
    
    activatePause('short');
  });
}

if(longPauseBtn) {
  longPauseBtn.addEventListener('click', () => {
    if(App.game.pausesUsed.long) {
      showNotification('Ошибка', 'Вы уже использовали длинную паузу', 'error');
      pauseModal.style.display = 'none';
      return;
    }
    
    activatePause('long');
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
      showNotification('Ошибка', 'Ошибка сдачи: ' + err.message, 'error');
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

// ===== Initialization =====
function init(){
  renderTopRight();
  initTabs();
  
  // Создаем оверлей паузы, если его еще нет
  if(!pauseModalOverlay) {
    const overlay = document.createElement('div');
    overlay.id = 'pauseModalOverlay';
    overlay.className = 'pause-modal-overlay';
    overlay.innerHTML = `
      <div class="pause-modal-content">
        <h2>ПАУЗА</h2>
        <div id="pauseTimer" class="pause-timer">0:00</div>
        <div id="pauseInfo" class="pause-info">Игра приостановлена</div>
        <div id="pauseControls" style="display: none;">
          <button id="cancelPauseBtn2" class="menuButs xs">Снять паузу</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    // Добавляем обработчик для кнопки отмены паузы
    const cancelPauseBtn2 = document.getElementById('cancelPauseBtn2');
    if(cancelPauseBtn2) {
      cancelPauseBtn2.addEventListener('click', async () => {
        try {
          await api(`/game/cancel_pause/${App.game.id}/`, 'POST');
          hidePauseOverlay();
        } catch(err) {
          showNotification('Ошибка', 'Не удалось отменить паузу: ' + err.message, 'error');
        }
      });
    }
  }
}

// Запускаем инициализацию когда DOM готов
if(document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}