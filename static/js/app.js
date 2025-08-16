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

// ===== global state =====
const App = {
  isAuth: document.body.dataset.auth === '1',
  meLogin: document.body.dataset.login || '',
  meAvatar: document.body.dataset.avatar || '/static/img/avatar_stub.png',
  waitCtx: { active:false, token:null, canceler:null },
  mode: 'move',
  game: { id:null, state:null },
};

// ===== DOM refs =====
const msContainer = document.getElementById('msContainer');
const startBut = document.getElementById('startBut');
const rulesBut = document.getElementById('rulesBut');
const panelExit = document.getElementById('panelExit');

const profileBtn = document.getElementById('profileBtn');
const profileAvatar = document.getElementById('profileAvatar');
const profileName = document.getElementById('profileName');

const tabButtons = document.querySelectorAll('.tabbar .tab');
const paneLobby = document.getElementById('pane-lobby');
const paneRules = document.getElementById('pane-rules');

const quickBtn = document.getElementById('quickBtn');
const lobbyStatus = document.getElementById('lobbyStatus');

const userSearch = document.getElementById('userSearch');
const searchBtn = document.getElementById('searchBtn');
const subTabs = document.querySelectorAll('.tabbar.sub .tab');
const usersList = document.getElementById('usersList');
const friendsList = document.getElementById('friendsList');

// game
const gameWrap = document.getElementById('gameWrap');
const gameExit = document.getElementById('gameExit');
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

const waitModal = document.getElementById('wait');
const waitText = document.getElementById('waitText');
const waitCancel = document.getElementById('waitCancel');

// ===== UI helpers =====
function flipMain(showPanel){
  if(showPanel) msContainer.classList.add('flip');
  else msContainer.classList.remove('flip');
}
function renderTopRight(){
  profileAvatar.src = App.meAvatar || '/static/img/avatar_stub.png';
  profileName.textContent = App.isAuth ? (App.meLogin || 'Профиль') : 'Войти';
}
function openProfile(){
  if(!App.isAuth){ openAuth(); return; }
  pLogin.value = App.meLogin || '';
  api('/accounts/api/me/').then(me=>{
    pUsername.value = me.username || '';
    pEmail.value = me.email || '';
    if(me.avatar) pAvatarPreview.src = me.avatar;
  }).catch(()=>{});
  profileModal.style.display='flex';
}
function openAuth(){ authModal.style.display='flex'; }
function closeModal(id){ document.getElementById(id).style.display='none'; }

// tab widgets (панель)
tabButtons.forEach(b=>{
  b.onclick=()=>{
    // внешние табы панели
    b.parentElement.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const pane = b.dataset.pane;
    paneLobby.style.display = (pane==='pane-lobby')?'block':'none';
    paneRules.style.display = (pane==='pane-rules')?'block':'none';
  };
});

// субтабы (в лобби)
subTabs.forEach(b=>{
  b.onclick=()=>{
    b.parentElement.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const sub = b.dataset.sub;
    if(sub==='users'){ usersList.style.display='block'; friendsList.style.display='none'; }
    else { usersList.style.display='none'; friendsList.style.display='block'; }
  };
});

// menu
startBut.onclick = ()=>{ flipMain(true); showLobby(); loadUsers(''); loadFriends(); };
rulesBut.onclick = ()=>{ flipMain(true); showRules(); };
panelExit.onclick = ()=> flipMain(false);

function showLobby(){
  document.querySelector('.tabbar .tab[data-pane="pane-lobby"]').click();
}
function showRules(){
  document.querySelector('.tabbar .tab[data-pane="pane-rules"]').click();
}

// profile/auth buttons
profileBtn.onclick = ()=> App.isAuth ? openProfile() : openAuth();

// modal close buttons
document.querySelectorAll('.modal-close').forEach(x=>{
  x.onclick=()=> closeModal(x.dataset.target);
});

// profile: avatar preview
pAvatar.onchange = (e)=>{
  const f = pAvatar.files && pAvatar.files[0];
  if(!f) return;
  const reader = new FileReader();
  reader.onload = ev => { pAvatarPreview.src = ev.target.result; };
  reader.readAsDataURL(f);
};

// profile save
profileForm.onsubmit = async (e)=>{
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
      alert('Сохранено');
    }
  }catch(err){ alert('Ошибка сохранения'); }
};

// auth
loginForm.onsubmit = async (e)=>{
  e.preventDefault();
  const d = Object.fromEntries(new FormData(loginForm).entries());
  try{
    const r = await api('/accounts/api/login/','POST', d);
    if(r.ok){
      App.isAuth=true; App.meLogin=r.login||d.username; if(r.avatar) App.meAvatar=r.avatar;
      renderTopRight(); authModal.style.display='none';
    }else alert('Неверный логин/пароль');
  }catch(err){ alert('Ошибка входа'); }
};
registerForm.onsubmit = async (e)=>{
  e.preventDefault();
  const d = Object.fromEntries(new FormData(registerForm).entries());
  try{
    const r = await api('/accounts/api/register/','POST', d);
    if(r.ok){
      const r2 = await api('/accounts/api/login/','POST',{username:d.username,password:d.password});
      if(r2.ok){
        App.isAuth=true; App.meLogin=d.login; if(r2.avatar) App.meAvatar=r2.avatar;
        renderTopRight(); authModal.style.display='none';
      }
    }else alert('Ошибка регистрации');
  }catch(err){ alert('Ошибка регистрации'); }
};

// ===== users/friends =====
searchBtn.onclick = ()=> loadUsers(userSearch.value.trim());
userSearch.addEventListener('input', ()=> loadUsers(userSearch.value.trim()));

async function loadUsers(q){
  try{
    const data = await api('/accounts/api/users/?q='+encodeURIComponent(q||''));
    renderUsers(data.items||[]);
  }catch(err){ usersList.innerHTML='<li>Ошибка загрузки</li>'; }
}
function renderUsers(arr){
  usersList.innerHTML='';
  if(arr.length===0){ usersList.innerHTML='<li>Пусто</li>'; return; }
  arr.forEach(u=>{
    const li = document.createElement('li');
    li.innerHTML = `<div style="text-align:left"><b>${u.login}</b> <span class="muted"> (рейт: ${u.rating} • W:${u.wins}/L:${u.losses})</span></div>
      <div style="display:flex;gap:.4rem">
        <button class="menuButs xs" data-invite="${u.id}">Пригласить</button>
        <button class="menuButs xs" data-add="${u.id}" data-login="${u.login}">Добавить</button>
      </div>`;
    usersList.appendChild(li);
  });
  usersList.querySelectorAll('[data-invite]').forEach(btn=>{
    btn.onclick = async ()=> inviteUser(btn.dataset.invite);
  });
  usersList.querySelectorAll('[data-add]').forEach(btn=>{
    btn.onclick = async ()=>{
      const login = btn.dataset.login;
      try{ await api('/accounts/api/friends/add/','POST',{login}); loadFriends(); }catch(e){ alert('Не удалось добавить'); }
    };
  });
}
async function loadFriends(){
  try{
    const data = await api('/accounts/api/friends/');
    const items = data.items || [];
    friendsList.innerHTML='';
    if(items.length===0){ friendsList.innerHTML='<li>Нет друзей</li>'; return; }
    items.forEach(u=>{
      const li=document.createElement('li');
      li.innerHTML = `<div style="text-align:left"><b>${u.login}</b></div>
        <div style="display:flex;gap:.4rem">
          <button class="menuButs xs" data-invite="${u.id}">Пригласить</button>
          <button class="menuButs xs danger" data-remove="${u.id}">Удалить</button>
        </div>`;
      friendsList.appendChild(li);
    });
    friendsList.querySelectorAll('[data-invite]').forEach(btn=> btn.onclick = ()=> inviteUser(btn.dataset.invite) );
    friendsList.querySelectorAll('[data-remove]').forEach(btn=>{
      btn.onclick = async ()=>{
        try{ await api(`/accounts/api/friends/remove/${btn.dataset.remove}/`,'POST',{}); loadFriends(); }catch(e){ alert('Не удалось удалить'); }
      };
    });
  }catch(err){ friendsList.innerHTML='<li>Ошибка загрузки</li>'; }
}
async function inviteUser(uid){
  if(!App.isAuth){ openAuth(); return; }
  try{
    const r = await api(`/match/invite_ajax/${uid}/`);
    if(r.ok){
      showWaiting('Ожидаем ответ соперника...', async ()=>{ await api(`/match/invite/${r.token}/cancel/`); }, r.token);
    }
  }catch(err){ alert('Не удалось отправить приглашение'); }
}

// ===== waiting / invite modals =====
function showWaiting(text,onCancel,token=null){
  waitText.textContent = text || 'Ожидание...';
  App.waitCtx={active:true,token,canceler:onCancel};
  waitModal.style.display='flex';
}
function hideWaiting(){ waitModal.style.display='none'; App.waitCtx={active:false,token:null,canceler:null}; }
waitCancel.onclick = async ()=>{ try{ if(App.waitCtx.canceler) await App.waitCtx.canceler(); } finally{ hideWaiting(); } };

let currentInviteToken=null;
function showInviteModal(fromLogin, token){
  currentInviteToken = token;
  inviteText.textContent = `Приглашение в игру от ${fromLogin}`;
  inviteModal.style.display='flex';
}
document.getElementById('inviteModal').querySelector('.modal-close').onclick=()=>{ inviteModal.style.display='none'; currentInviteToken=null; };
inviteAccept.onclick = ()=>{ if(currentInviteToken) location.href = '/match/invite/'+currentInviteToken+'/accept/'; };
inviteDecline.onclick = ()=>{ if(currentInviteToken) location.href = '/match/invite/'+currentInviteToken+'/decline/'; inviteModal.style.display='none'; };

// ===== notifications polling =====
function handleEvent(m){
  if(!m||!m.type) return;
  if(m.type==='friend_invite'){ showInviteModal(m.from, m.token); }
  if(m.type==='invite_accepted'){ hideWaiting(); if(m.url) startGameByRoomUrl(m.url); }
  if(m.type==='invite_declined'){ hideWaiting(); alert('Ваше приглашение отклонено.'); }
  if(m.type==='match_found'){ hideWaiting(); if(m.url) startGameByRoomUrl(m.url); }
}
async function poll(){
  if(!App.isAuth) return;
  try{
    const data = await api('/match/notify/poll/');
    (data.items||[]).forEach(handleEvent);
  }catch(err){}
}
setInterval(poll, 1200);

// ===== quick match =====
let quickTimer=null;
quickBtn.onclick = async ()=>{
  if(!App.isAuth){ openAuth(); return; }
  lobbyStatus.textContent='';
  try{
    const r = await api('/match/quick/');
    if(r.url){ startGameByRoomUrl(r.url); return; }
    if(r.queued){
      showWaiting('Ищем соперника...', async ()=>{ await api('/match/cancel/'); });
      if(quickTimer) clearInterval(quickTimer);
      quickTimer = setInterval(async ()=>{
        const s = await api('/match/status/');
        if(s.url){ clearInterval(quickTimer); hideWaiting(); startGameByRoomUrl(s.url); }
      }, 1200);
    }
  }catch(err){ lobbyStatus.textContent='Не удалось начать поиск'; }
};

// ===== GAME =====
function clearBoard(){
  boardEl.innerHTML='';
  for(let r=0;r<15;r++){
    for(let c=0;c<14;c++){
      const cell=document.createElement('div');
      cell.className='cell'; cell.dataset.x=c; cell.dataset.y=r;
      boardEl.appendChild(cell);
    }
  }
}
function labelKind(kind){
  const map = {
    "BDK":"БДК","KR":"КР","A":"А","S":"С","TN":"ТН","L":"Л","ES":"ЭС","M":"М","SM":"СМ","F":"Ф",
    "TK":"ТК","T":"Т","TR":"ТР","ST":"СТ","PL":"ПЛ","KRPL":"КРПЛ","AB":"АБ","VMB":"ВМБ"
  };
  return map[kind]||kind;
}
function classKind(kind){
  return 'kind'+labelKind(kind);
}
async function startGameByRoomUrl(url){
  const code = url.split('/').filter(Boolean).pop();
  try{
    const d = await api(`/game/by-code/${code}/`);
    App.game.id = d.id; App.game.state = d.state;
    renderGame(); // показываем оверлей fade
    gameWrap.classList.remove('hide');
  }catch(err){ alert('Не удалось открыть игру'); }
}
async function refreshGame(){
  if(!App.game.id) return;
  try{
    const d = await api(`/game/state/${App.game.id}/`);
    App.game.state = d.state; renderGame();
  }catch(err){}
}
function renderGame(){
  const st = App.game.state || {};
  hudTurn.textContent = st.turn===1?'Игрок 1':'Игрок 2';
  hudTimer.textContent='--'; hudBank.textContent='--';
  setupBar.style.display = (st.phase==='SETUP')?'flex':'none';
  clearBoard();
  const board = st.board || {};
  Object.keys(board).forEach(k=>{
    const [x,y]=k.split(',').map(Number);
    const idx = y*14 + x;
    const cell = boardEl.children[idx];
    const p = board[k][0];
    if(cell && p){
      const span=document.createElement('span');
      span.textContent = labelKind(p.kind);
      span.className = `piece owner${p.owner} ${classKind(p.kind)}`;
      cell.appendChild(span);
    }
  });
}
boardEl.onclick = async (e)=>{
  const cell = e.target.closest('.cell'); if(!cell || !App.game.id) return;
  const x = parseInt(cell.dataset.x), y = parseInt(cell.dataset.y);
  if(App.game.state && App.game.state.phase==='SETUP') return;
  try{
    if(App.mode==='move'){
      if(!boardEl.dataset.sel){ boardEl.dataset.sel=`${x},${y}`; cell.classList.add('sel'); return; }
      const [sx,sy]=boardEl.dataset.sel.split(',').map(Number); delete boardEl.dataset.sel;
      const res = await api(`/game/move/${App.game.id}/`,'POST',{src:[sx,sy],dst:[x,y]});
      if(res.state){ App.game.state=res.state; renderGame(); } else { await refreshGame(); }
    }else if(App.mode==='torpedo'){
      if(!boardEl.dataset.sel){ boardEl.dataset.sel=`${x},${y}`; cell.classList.add('sel'); return; }
      if(!boardEl.dataset.sel2){
        boardEl.dataset.sel2=`${x},${y}`; cell.classList.add('sel');
        const d = prompt('Направление: dx,dy (например 1,0; 0,-1; -1,0; 1,1)');
        if(!d){ delete boardEl.dataset.sel; delete boardEl.dataset.sel2; await refreshGame(); return; }
        const [dx,dy]=d.split(',').map(Number);
        const [tx,ty]=boardEl.dataset.sel.split(',').map(Number);
        const [tkx,tky]=boardEl.dataset.sel2.split(',').map(Number);
        delete boardEl.dataset.sel; delete boardEl.dataset.sel2;
        const res = await api(`/game/torpedo/${App.game.id}/`,'POST',{t:[tx,ty],tk:[tkx,tky],dir:[dx,dy]});
        if(res.state){ App.game.state=res.state; renderGame(); } else { await refreshGame(); }
      }
    }else if(App.mode==='air'){
      if(!boardEl.dataset.sel){ boardEl.dataset.sel=`${x},${y}`; cell.classList.add('sel'); return; }
      const [ax,ay]=boardEl.dataset.sel.split(',').map(Number); delete boardEl.dataset.sel;
      const res = await api(`/game/air/${App.game.id}/`,'POST',{a:[ax,ay],s:[x,y]});
      if(res.state){ App.game.state=res.state; renderGame(); } else { await refreshGame(); }
    }else if(App.mode==='bomb'){
      const res = await api(`/game/bomb/${App.game.id}/`,'POST',{ab:[x,y]});
      if(res.state){ App.game.state=res.state; renderGame(); } else { await refreshGame(); }
    }
  }catch(err){ await refreshGame(); }
};
document.querySelectorAll('[data-mode]').forEach(b=> b.onclick=()=> App.mode=b.dataset.mode );
autoSetupBtn.onclick = async ()=>{ if(App.game.id){ await api(`/game/autosetup/${App.game.id}/`,'POST',{}); await refreshGame(); } };
readyBtn.onclick = async ()=>{ if(App.game.id){ await api(`/game/submit_setup/${App.game.id}/`,'POST',{}); await refreshGame(); } };
resignBtn.onclick = async ()=>{ if(App.game.id){ await api(`/game/resign/${App.game.id}/`,'POST',{}); await refreshGame(); } };
gameExit.onclick = ()=>{ App.game={id:null,state:null}; gameWrap.classList.add('hide'); };

// history
async function loadHistory(){
  try{
    const d = await api('/game/my/');
    const items = d.items || [];
    historyList.innerHTML='';
    if(items.length===0){ historyList.innerHTML='<li>История пуста</li>'; return; }
    items.forEach(g=>{
      const li=document.createElement('li');
      li.innerHTML = `<div style="text-align:left">Игра с <b>${g.opponent}</b> • ${g.status}</div>`;
      historyList.appendChild(li);
    });
  }catch(err){ historyList.innerHTML='<li>Ошибка загрузки</li>'; }
}

// init
function init(){ renderTopRight(); }
init();