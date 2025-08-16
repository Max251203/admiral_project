// ===== helpers =====
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

// ===== global state =====
const App = {
  isAuth: document.body.dataset.auth === '1',
  meLogin: document.body.dataset.login || '',
  meAvatar: document.body.dataset.avatar || '/static/img/avatar_stub.png',
  waitCtx: { active:false, token:null, canceler:null },
  mode: 'move',
  game: { id:null, state:null, myPlayer:null, pollTimer:null },
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
const lobbyStatus = document.getElementById('lobbyStatus');

const userSearch = document.getElementById('userSearch');
const searchBtn = document.getElementById('searchBtn');
const usersList = document.getElementById('usersList');
const friendsList = document.getElementById('friendsList');

// game
const boardEl = document.getElementById('board');
const hudTurn = document.getElementById('hudTurn');
const hudTimer = document.getElementById('hudTimer');
const hudBank = document.getElementById('hudBank');
const setupBar = document.getElementById('setupBar');
const autoSetupBtn = document.getElementById('autoSetupBtn');
const readyBtn = document.getElementById('readyBtn');
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

// ===== UI helpers - система переворачивания как в примере =====
function showContent(contentType){
  // Скрываем все панели контента
  [rulesContent, lobbyContent, gameContent].forEach(pane => {
    pane.style.display = 'none';
  });
  
  // Показываем нужную панель
  if(contentType === 'rules'){
    rulesContent.style.display = 'block';
  } else if(contentType === 'lobby'){
    lobbyContent.style.display = 'block';
  } else if(contentType === 'game'){
    gameContent.style.display = 'block';
  }
  
  // Переворачиваем карточку
  msContainer.classList.add('flip');
}

function showMenu(){
  msContainer.classList.remove('flip');
  
  // Останавливаем поллинг игры если был активен
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

// ===== Tab system - ИСПРАВЛЕННАЯ =====
function initTabs(){
  document.querySelectorAll('.tabbar').forEach(tabbar => {
    const tabs = tabbar.querySelectorAll('.tab');
    const container = tabbar.closest('.modal, .content-pane, #lobbyContent');
    
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Убираем активность со всех табов в этом контейнере
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Показываем соответствующую панель
        const paneId = tab.dataset.pane;
        const panes = container.querySelectorAll('.pane');
        panes.forEach(pane => {
          pane.classList.remove('active');
        });
        
        const targetPane = container.querySelector(`#${paneId}`);
        if(targetPane) {
          targetPane.classList.add('active');
          
          // Если это история игр, загружаем данные
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

// Profile avatar preview
if(pAvatar) {
  pAvatar.addEventListener('change', (e) => {
    const f = pAvatar.files && pAvatar.files[0];
    if(!f) return;
    const reader = new FileReader();
    reader.onload = ev => { pAvatarPreview.src = ev.target.result; };
    reader.readAsDataURL(f);
  });
}

// Profile save
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

// Auth
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
  usersList.innerHTML='';
  if(arr.length===0){ 
    usersList.innerHTML='<li>Пусто</li>'; 
    return; 
  }
  
  arr.forEach(u=>{
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <strong>${u.login}</strong><br>
        <span class="muted">Рейтинг: ${u.rating} • Побед: ${u.wins} • Поражений: ${u.losses}</span>
      </div>
      <div style="display:flex;gap:.4rem">
        <button class="menuButs xs" data-invite="${u.id}">Пригласить</button>
        <button class="menuButs xs" data-add="${u.id}" data-login="${u.login}">Добавить</button>
      </div>`;
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
    if(lobbyStatus) lobbyStatus.textContent = '';
    
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
      if(lobbyStatus) lobbyStatus.textContent = 'Не удалось начать поиск';
      showNotification('Ошибка', 'Не удалось начать поиск соперника', 'error');
    }
  });
}

// ===== GAME - без WebSocket, только AJAX =====
function clearBoard(){
  if(!boardEl) return;
  boardEl.innerHTML = '';
  for(let r = 0; r < 15; r++){
    for(let c = 0; c < 14; c++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = c;
      cell.dataset.y = r;
      cell.addEventListener('dragover', handleDragOver);
      cell.addEventListener('drop', handleDrop);
      boardEl.appendChild(cell);
    }
  }
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
    
    // Запускаем поллинг состояния игры вместо WebSocket
    startGamePolling();
    
    showContent('game');
    renderGame();
  }catch(err){ 
    showNotification('Ошибка', 'Не удалось открыть игру', 'error');
  }
}

// Поллинг состояния игры вместо WebSocket
function startGamePolling(){
  if(App.game.pollTimer) clearInterval(App.game.pollTimer);
  
  App.game.pollTimer = setInterval(async () => {
    if(!App.game.id) return;
    
    try{
      const d = await api(`/game/state/${App.game.id}/`);
      if(d.state){
        App.game.state = d.state;
        renderGame();
      }
      
      // Обновляем таймеры (можно добавить в API)
      updateTimers({
        turn_left: 30, // Заглушка, можно добавить в API
        bank_left: 900 // Заглушка
      });
      
    }catch(err){
      console.error('Ошибка поллинга игры:', err);
    }
  }, 2000); // Обновляем каждые 2 секунды
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
  if(data.finished && data.winner){
    const isWinner = data.winner === App.game.myPlayer;
    showNotification(
      'Игра окончена!', 
      isWinner ? 'Поздравляем с победой!' : 'Вы проиграли', 
      isWinner ? 'success' : 'error'
    );
    
    // Останавливаем поллинг
    if(App.game.pollTimer){
      clearInterval(App.game.pollTimer);
      App.game.pollTimer = null;
    }
  }
}

async function refreshGame(){
  if(!App.game.id) return;
  try{
    const d = await api(`/game/state/${App.game.id}/`);
    App.game.state = d.state;
    renderGame();
  }catch(err){}
}

function renderGame(){
  const st = App.game.state || {};
  if(hudTurn) hudTurn.textContent = st.turn === 1 ? 'Игрок 1' : 'Игрок 2';
  
  // Показываем/скрываем панель расстановки
  if(setupBar) setupBar.style.display = (st.phase === 'SETUP') ? 'flex' : 'none';
  
  clearBoard();
  
  const board = st.board || {};
  Object.keys(board).forEach(k => {
    const [x, y] = k.split(',').map(Number);
    const idx = y * 14 + x;
    const cell = boardEl.children[idx];
    const pieces = board[k];
    
    if(cell && pieces && pieces.length > 0){
      const p = pieces[0]; // Берем первую фишку
      const span = document.createElement('span');
      span.textContent = labelKind(p.kind);
      span.className = `piece owner${p.owner} ${classKind(p.kind)}`;
      span.draggable = (st.phase === 'SETUP' || (st.phase.includes('TURN') && p.owner === App.game.myPlayer));
      span.addEventListener('dragstart', handleDragStart);
      span.dataset.kind = p.kind;
      span.dataset.owner = p.owner;
      cell.appendChild(span);
    }
  });
}

// ===== Drag & Drop =====
function handleDragStart(e){
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
  
  if(App.game.state && App.game.state.phase === 'SETUP'){
    // Режим расстановки - просто перемещаем
    try{
      const res = await api(`/game/setup/${App.game.id}/`, 'POST', {
        placements: [{
          x: toX,
          y: toY,
          kind: App.draggedPiece.kind
        }]
      });
      if(res.state){
        App.game.state = res.state;
        renderGame();
      }
    }catch(err){
      showNotification('Ошибка', 'Ошибка расстановки: ' + err.message, 'error');
    }
  } else {
    // Режим игры - делаем ход
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
      await refreshGame();
    }
  }
  
  App.draggedPiece = null;
}

// ===== Game controls =====
document.querySelectorAll('[data-mode]').forEach(btn => {
  btn.addEventListener('click', () => {
    App.mode = btn.dataset.mode;
    // Визуально выделяем активный режим
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

if(autoSetupBtn) {
  autoSetupBtn.addEventListener('click', async () => {
    if(!App.game.id) return;
    try{
      const res = await api(`/game/autosetup/${App.game.id}/`, 'POST', {});
      if(res.state){
        App.game.state = res.state;
        renderGame();
        showNotification('Успех', `Автоматически расставлено ${res.placed} фишек`, 'success');
      }
    }catch(err){
      showNotification('Ошибка', 'Ошибка автоматической расстановки', 'error');
    }
  });
}

if(readyBtn) {
  readyBtn.addEventListener('click', async () => {
    if(!App.game.id) return;
    try{
      const res = await api(`/game/submit_setup/${App.game.id}/`, 'POST', {});
      if(res.ok){
        await refreshGame();
        showNotification('Успех', 'Готовность подтверждена', 'success');
      }
    }catch(err){
      showNotification('Ошибка', 'Ошибка подтверждения готовности', 'error');
    }
  });
}

if(resignBtn) {
  resignBtn.addEventListener('click', async () => {
    if(!App.game.id) return;
    
    // Создаем кастомное подтверждение вместо confirm
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
        
        // Добавляем обработчики для кнопок
        const buttons = notification.querySelectorAll('button');
        buttons[0].addEventListener('click', () => { notification.remove(); resolve(true); });
        buttons[1].addEventListener('click', () => { notification.remove(); resolve(false); });
      });
    };
    
    const confirmed = await confirmResign();
    if(!confirmed) return;
    
    try{
      await api(`/game/resign/${App.game.id}/`, 'POST', {});
      await refreshGame();
      showNotification('Игра окончена', 'Вы сдались', 'info');
    }catch(err){
      showNotification('Ошибка', 'Ошибка сдачи', 'error');
    }
  });
}

// ===== Board click handling for special attacks =====
if(boardEl) {
  boardEl.addEventListener('click', async (e) => {
    const cell = e.target.closest('.cell');
    if(!cell || !App.game.id) return;
    
    const x = parseInt(cell.dataset.x);
    const y = parseInt(cell.dataset.y);
    
    if(App.game.state && App.game.state.phase === 'SETUP') return;
    
    try{
      if(App.mode === 'torpedo'){
        if(!App.selectedCell){
          App.selectedCell = {x, y, type: 'torpedo'};
          cell.classList.add('selected');
          showNotification('Торпедная атака', 'Выберите торпедный катер', 'info');
          return;
        }
        
        if(!App.selectedCell.tk){
          App.selectedCell.tk = {x, y};
          cell.classList.add('selected');
          
          // Создаем кастомный промпт для направления
          const getDirection = () => {
            return new Promise((resolve) => {
              const notification = document.createElement('div');
              notification.className = 'notification info';
              notification.innerHTML = `
                <div class="notification-title">Направление торпеды</div>
                <div class="notification-message">Введите направление (dx,dy):</div>
                <div style="margin-top: 1rem;">
                  <input type="text" placeholder="Например: 1,0 или 0,-1" style="padding: 0.5rem; border: 1px solid #fff; border-radius: 0.5rem; background: rgba(0,0,0,0.5); color: #fff; width: 100%;">
                  <div style="margin-top: 0.5rem; display: flex; gap: 0.5rem; justify-content: center;">
                    <button class="menuButs xs">OK</button>
                    <button class="menuButs xs danger">Отмена</button>
                  </div>
                </div>
              `;
              
              document.body.appendChild(notification);
              setTimeout(() => notification.classList.add('show'), 100);
              
              const input = notification.querySelector('input');
              const buttons = notification.querySelectorAll('button');
              
              buttons[0].addEventListener('click', () => {
                const value = input.value.trim();
                notification.remove();
                resolve(value || null);
              });
              
              buttons[1].addEventListener('click', () => {
                notification.remove();
                resolve(null);
              });
              
              input.focus();
              input.addEventListener('keypress', (e) => {
                if(e.key === 'Enter') buttons[0].click();
              });
            });
          };
          
          const direction = await getDirection();
          if(!direction){
            clearSelection();
            return;
          }
          
          const [dx, dy] = direction.split(',').map(Number);
          if(isNaN(dx) || isNaN(dy)){
            showNotification('Ошибка', 'Неверный формат направления', 'error');
            clearSelection();
            return;
          }
          
          const res = await api(`/game/torpedo/${App.game.id}/`, 'POST', {
            t: [App.selectedCell.x, App.selectedCell.y],
            tk: [App.selectedCell.tk.x, App.selectedCell.tk.y],
            dir: [dx, dy]
          });
          
          if(res.state){
            App.game.state = res.state;
            renderGame();
            showNotification('Торпедная атака', 'Торпеда выпущена!', 'success');
          }
          clearSelection();
        }
      } else if(App.mode === 'air'){
        if(!App.selectedCell){
          App.selectedCell = {x, y, type: 'air'};
          cell.classList.add('selected');
          showNotification('Воздушная атака', 'Выберите самолет', 'info');
          return;
        }
        
        const res = await api(`/game/air/${App.game.id}/`, 'POST', {
          a: [App.selectedCell.x, App.selectedCell.y],
          s: [x, y]
        });
        
        if(res.state){
          App.game.state = res.state;
          renderGame();
          showNotification('Воздушная атака', 'Самолет атаковал!', 'success');
        }
        clearSelection();
      } else if(App.mode === 'bomb'){
        const res = await api(`/game/bomb/${App.game.id}/`, 'POST', {
          ab: [x, y]
        });
        
        if(res.state){
          App.game.state = res.state;
          renderGame();
          showNotification('Атомная бомба', 'Бомба взорвана!', 'success');
        }
      }
    }catch(err){
      showNotification('Ошибка', 'Ошибка специальной атаки: ' + err.message, 'error');
      await refreshGame();
      clearSelection();
    }
  });
}

function clearSelection(){
  App.selectedCell = null;
  document.querySelectorAll('.cell.selected').forEach(cell => {
    cell.classList.remove('selected');
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
  
  // Инициализируем режим по умолчанию
  const moveBtn = document.querySelector('[data-mode="move"]');
  if(moveBtn) moveBtn.classList.add('active');
}

// Запускаем инициализацию когда DOM готов
if(document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}