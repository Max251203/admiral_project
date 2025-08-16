from flask import Flask, render_template, request, redirect, url_for, session, g, jsonify
import sqlite3
import os
import random as pyrandom
import json
import time

app = Flask(__name__)
app.secret_key = 'your_secret_key'  # Замени на свой ключ безопасности
DATABASE = 'users.db'

# --- Вспомогательные функции ---
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

# --- Инициализация БД ---
def init_db():
    with app.app_context():
        db = get_db()
        cursor = db.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                nickname TEXT NOT NULL
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS queue (
                user_id INTEGER UNIQUE,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player1_id INTEGER,
                player2_id INTEGER,
                status TEXT,
                invite_code TEXT
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS stats (
                user_id INTEGER PRIMARY KEY,
                games_played INTEGER DEFAULT 0,
                games_won INTEGER DEFAULT 0,
                total_time_played INTEGER DEFAULT 0
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS setup_status (
                game_id INTEGER,
                user_id INTEGER,
                done INTEGER DEFAULT 0,
                PRIMARY KEY (game_id, user_id)
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS battle_state (
                game_id INTEGER PRIMARY KEY,
                positions TEXT,
                current_turn_player_id INTEGER,
                move_start_time INTEGER,
                total_time_p1 INTEGER,
                total_time_p2 INTEGER,
                status TEXT
            )
        ''')
        # --- Добавляем недостающие столбцы, если их нет ---
        columns = [row[1] for row in cursor.execute('PRAGMA table_info(stats)')]
        alter_statements = []
        if 'games_vs_friends' not in columns:
            alter_statements.append("ALTER TABLE stats ADD COLUMN games_vs_friends INTEGER DEFAULT 0")
        if 'games_vs_random' not in columns:
            alter_statements.append("ALTER TABLE stats ADD COLUMN games_vs_random INTEGER DEFAULT 0")
        if 'wins_vs_friends' not in columns:
            alter_statements.append("ALTER TABLE stats ADD COLUMN wins_vs_friends INTEGER DEFAULT 0")
        if 'wins_vs_random' not in columns:
            alter_statements.append("ALTER TABLE stats ADD COLUMN wins_vs_random INTEGER DEFAULT 0")
        for stmt in alter_statements:
            try:
                cursor.execute(stmt)
            except Exception:
                pass
        db.commit()

# --- Роуты ---
@app.route('/')
def index():
    if 'user_id' in session:
        return redirect(url_for('menu'))
    return "<a href='/register'>Регистрация</a> | <a href='/login'>Вход</a>"

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        email = request.form['email']
        password = request.form['password']
        nickname = request.form['nickname']
        db = get_db()
        cursor = db.cursor()
        try:
            cursor.execute('INSERT INTO users (email, password, nickname) VALUES (?, ?, ?)', (email, password, nickname))
            db.commit()
            user_id = cursor.lastrowid
            cursor.execute('INSERT INTO stats (user_id) VALUES (?)', (user_id,))
            db.commit()
            return redirect(url_for('login'))
        except sqlite3.IntegrityError:
            return '''
                <style>
                    body { background: #fff; color: #000; font-family: sans-serif; }
                    .error-box { background: #fff; border: 2px solid #000; padding: 24px 32px; width: 340px; margin: 60px auto; box-shadow: 0 2px 8px #aaa2; text-align: center; }
                    .error-msg { color: #fff; background: #f33; border-radius: 0; padding: 10px 0; margin-bottom: 18px; font-weight: bold; }
                    a { color: rgb(0,0,255); text-decoration: underline; display: block; margin-top: 18px; }
                </style>
                <div class="error-box">
                    <div class="error-msg">Пользователь с такой почтой уже существует!</div>
                    <a href='/register'>Попробовать снова</a>
                    <a href='/login'>Вход</a>
                </div>
            '''
    return '''
        <style>
            body { background: #fff; color: #000; font-family: sans-serif; }
            form { background: #fff; border: 2px solid #000; padding: 24px 32px; width: 320px; margin: 40px auto; box-shadow: 0 2px 8px #aaa2; }
            h2 { text-align: center; }
            input[type="email"], input[type="password"], input[type="text"] {
                width: 100%; padding: 8px; margin: 8px 0 16px 0; border: 1px solid #aaa; border-radius: 0; background: #f8f8f8;
            }
            input[type="submit"] {
                background: rgb(173,216,230); color: #000; border: 2px solid #000; padding: 8px 24px; font-weight: bold; cursor: pointer; transition: background 0.2s;
            }
            input[type="submit"]:hover {
                background: rgb(0,255,0); color: #000;
            }
            a { color: rgb(0,0,255); text-decoration: underline; display: block; text-align: center; margin-top: 12px; }
        </style>
        <h2>Регистрация</h2>
        <form method="post">
            Почта: <input type="email" name="email" required><br>
            Пароль: <input type="password" name="password" required><br>
            Никнейм: <input type="text" name="nickname" required><br>
            <input type="submit" value="Зарегистрироваться">
        </form>
        <a href="/login">Вход</a>
    '''

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form['email']
        password = request.form['password']
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT id, nickname FROM users WHERE email=? AND password=?', (email, password))
        user = cursor.fetchone()
        if user:
            session['user_id'] = user[0]
            session['nickname'] = user[1]
            return redirect(url_for('menu'))
        else:
            return '''
                <style>
                    body { background: #fff; color: #000; font-family: sans-serif; }
                    .error-box { background: #fff; border: 2px solid #000; padding: 24px 32px; width: 340px; margin: 60px auto; box-shadow: 0 2px 8px #aaa2; text-align: center; }
                    .error-msg { color: #fff; background: #f33; border-radius: 0; padding: 10px 0; margin-bottom: 18px; font-weight: bold; }
                    a { color: rgb(0,0,255); text-decoration: underline; display: block; margin-top: 18px; }
                </style>
                <div class="error-box">
                    <div class="error-msg">Неверная почта или пароль!</div>
                    <a href='/login'>Попробовать снова</a>
                    <a href='/register'>Регистрация</a>
                </div>
            '''
    return '''
        <style>
            body { background: #fff; color: #000; font-family: sans-serif; }
            form { background: #fff; border: 2px solid #000; padding: 24px 32px; width: 320px; margin: 40px auto; box-shadow: 0 2px 8px #aaa2; }
            h2 { text-align: center; }
            input[type="email"], input[type="password"] {
                width: 100%; padding: 8px; margin: 8px 0 16px 0; border: 1px solid #aaa; border-radius: 0; background: #f8f8f8;
            }
            input[type="submit"] {
                background: rgb(173,216,230); color: #000; border: 2px solid #000; padding: 8px 24px; font-weight: bold; cursor: pointer; transition: background 0.2s;
            }
            input[type="submit"]:hover {
                background: rgb(0,255,0); color: #000;
            }
            a { color: rgb(0,0,255); text-decoration: underline; display: block; text-align: center; margin-top: 12px; }
        </style>
        <h2>Вход</h2>
        <form method="post">
            Почта: <input type="email" name="email" required><br>
            Пароль: <input type="password" name="password" required><br>
            <input type="submit" value="Войти">
        </form>
        <a href="/register">Регистрация</a>
    '''

@app.route('/menu')
def menu():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return '''
        <style>
            body { background: #fff; color: #000; font-family: sans-serif; }
            .menu-container { background: #fff; border: 2px solid #000; padding: 32px 40px; width: 340px; margin: 60px auto; box-shadow: 0 2px 8px #aaa2; text-align: center; }
            h2 { margin-bottom: 32px; }
            .menu-btn {
                display: block;
                width: 100%;
                margin: 18px 0;
                padding: 16px 0;
                font-size: 1.1em;
                font-weight: bold;
                background: rgb(173,216,230);
                color: #000;
                border: 2px solid #000;
                cursor: pointer;
                transition: background 0.2s;
                border-radius: 0;
            }
            .menu-btn:hover {
                background: rgb(0,255,0);
            }
            .logout-link { color: rgb(255,0,0); text-decoration: underline; margin-top: 24px; display: block; }
        </style>
        <div class="menu-container">
            <h2>Главное меню</h2>
            <form action="/find_random" method="get">
                <button class="menu-btn" type="submit">🔍 Найти случайного соперника</button>
            </form>
            <form action="/play_friend" method="get">
                <button class="menu-btn" type="submit">🤝 Сразиться с другом</button>
            </form>
            <form action="/stats" method="get">
                <button class="menu-btn" type="submit">📊 Статистика</button>
            </form>
            <a class="logout-link" href="/logout">Выйти</a>
        </div>
    '''

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

# --- Генерация поля для морского боя ---
def generate_battleship_field():
    size = 10
    field = [[0 for _ in range(size)] for _ in range(size)]
    ships = [(4, 1), (3, 2), (2, 3), (1, 4)]  # (размер, количество)
    ship_id = 1
    for ship_len, count in ships:
        for _ in range(count):
            placed = False
            while not placed:
                orientation = pyrandom.choice(['h', 'v'])
                if orientation == 'h':
                    x = pyrandom.randint(0, size - ship_len)
                    y = pyrandom.randint(0, size - 1)
                    coords = [(y, x + i) for i in range(ship_len)]
                else:
                    x = pyrandom.randint(0, size - 1)
                    y = pyrandom.randint(0, size - ship_len)
                    coords = [(y + i, x) for i in range(ship_len)]
                # Проверка на касание
                ok = True
                for cy, cx in coords:
                    for dy in [-1, 0, 1]:
                        for dx in [-1, 0, 1]:
                            ny, nx = cy + dy, cx + dx
                            if 0 <= ny < size and 0 <= nx < size:
                                if field[ny][nx] != 0:
                                    ok = False
                if ok:
                    for cy, cx in coords:
                        field[cy][cx] = ship_id
                    ship_id += 1
                    placed = True
    return field

# --- Сохраняем состояние игры в базе ---
def save_game_state(game_id, player, my_field, opp_field):
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''CREATE TABLE IF NOT EXISTS battleship (
        game_id INTEGER,
        player INTEGER,
        my_field TEXT,
        opp_field TEXT,
        turn INTEGER,
        winner INTEGER DEFAULT 0,
        PRIMARY KEY (game_id, player)
    )''')
    cursor.execute('''REPLACE INTO battleship (game_id, player, my_field, opp_field, turn, winner) VALUES (?, ?, ?, ?, ?, 0)''',
                   (game_id, player, json.dumps(my_field), json.dumps(opp_field), 1))
    db.commit()

def load_game_state(game_id, player):
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''SELECT my_field, opp_field, turn, winner FROM battleship WHERE game_id=? AND player=?''', (game_id, player))
    row = cursor.fetchone()
    if row:
        return json.loads(row[0]), json.loads(row[1]), row[2], row[3]
    return None, None, 1, 0

# --- API: получить состояние игры ---
@app.route('/battleship/state/<int:game_id>')
def battleship_state(game_id):
    if 'user_id' not in session:
        return {'error': 'not logged in'}
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT player1_id, player2_id FROM games WHERE id=?', (game_id,))
    game = cursor.fetchone()
    if not game:
        return {'error': 'no game'}
    user_id = session['user_id']
    if user_id == game[0]:
        player = 1
    elif user_id == game[1]:
        player = 2
    else:
        return {'error': 'not your game'}
    my_field, opp_field, turn, winner = load_game_state(game_id, player)
    if my_field is None:
        # Первая инициализация
        my_field = generate_battleship_field()
        opp_field = [[0]*10 for _ in range(10)]
        save_game_state(game_id, player, my_field, opp_field)
    return {'my_field': my_field, 'opp_field': opp_field, 'turn': turn, 'winner': winner}

# --- API: сделать ход ---
@app.route('/battleship/shoot/<int:game_id>', methods=['POST'])
def battleship_shoot(game_id):
    if 'user_id' not in session:
        return {'error': 'not logged in'}
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT player1_id, player2_id FROM games WHERE id=?', (game_id,))
    game = cursor.fetchone()
    if not game:
        return {'error': 'no game'}
    user_id = session['user_id']
    if user_id == game[0]:
        player = 1
        opp_player = 2
    elif user_id == game[1]:
        player = 2
        opp_player = 1
    else:
        return {'error': 'not your game'}
    my_field, opp_field, turn, winner = load_game_state(game_id, player)
    if winner:
        return {'error': 'game over'}
    data = request.get_json()
    x, y = data.get('x'), data.get('y')
    # Проверяем чей ход
    cursor.execute('SELECT turn FROM battleship WHERE game_id=? AND player=?', (game_id, player))
    my_turn = cursor.fetchone()
    cursor.execute('SELECT turn FROM battleship WHERE game_id=? AND player=?', (game_id, opp_player))
    opp_turn = cursor.fetchone()
    if not my_turn or not opp_turn or my_turn[0] != 1 or opp_turn[0] != 0:
        return {'error': 'not your turn'}
    # Загружаем поле противника
    opp_my_field, _, _, _ = load_game_state(game_id, opp_player)
    if opp_my_field[y][x] > 0:
        opp_my_field[y][x] = -1  # Попадание
        opp_field[y][x] = 2
    else:
        opp_field[y][x] = 1  # Промах
    # Проверяем победу
    win = all(cell <= 0 for row in opp_my_field for cell in row)
    # Сохраняем
    save_game_state(game_id, player, my_field, opp_field)
    save_game_state(game_id, opp_player, opp_my_field, [[0]*10 for _ in range(10)])
    # Меняем ход
    cursor.execute('UPDATE battleship SET turn=? WHERE game_id=? AND player=?', (0, game_id, player))
    cursor.execute('UPDATE battleship SET turn=? WHERE game_id=? AND player=?', (1, game_id, opp_player))
    if win:
        cursor.execute('UPDATE battleship SET winner=? WHERE game_id=?', (player, game_id))
    db.commit()
    return {'result': 'hit' if opp_field[y][x]==2 else 'miss', 'win': win}

# --- Страница игры ---
@app.route('/battleship/<int:game_id>')
def battleship_page(game_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return f'''
        <style>
            body {{ background: #fff; color: #000; font-family: sans-serif; }}
            .btl-wrap {{ display: flex; justify-content: center; gap: 40px; margin-top: 40px; }}
            .btl-board {{ border: 2px solid #000; display: grid; grid-template-columns: repeat(10, 32px); grid-template-rows: repeat(10, 32px); }}
            .btl-cell {{ width: 32px; height: 32px; border: 1px solid #aaa; box-sizing: border-box; background: #f8f8f8; cursor: pointer; }}
            .btl-cell.ship {{ background: #b0e0e6; }}
            .btl-cell.hit {{ background: #f33; }}
            .btl-cell.miss {{ background: #bbb; }}
            .btl-cell.unknown {{ background: #f8f8f8; }}
            .btl-title {{ text-align: center; font-weight: bold; margin-bottom: 8px; }}
        </style>
        <div class="btl-wrap">
            <div>
                <div class="btl-title">Ваше поле</div>
                <div id="my_board" class="btl-board"></div>
            </div>
            <div>
                <div class="btl-title">Поле противника</div>
                <div id="opp_board" class="btl-board"></div>
            </div>
        </div>
        <div id="btl_status" style="text-align:center;margin-top:24px;font-size:1.2em;"></div>
        <script>
        let myField = [], oppField = [], turn = 1, winner = 0;
        let gameId = {game_id};
        function renderBoards() {{
            let my = document.getElementById('my_board');
            let opp = document.getElementById('opp_board');
            my.innerHTML = '';
            opp.innerHTML = '';
            for(let y=0; y<10; y>{{
                    let c = document.createElement('div');
                    c.className = 'btl-cell';
                    if(myField[y][x]>0) c.classList.add('ship');
                    if(myField[y][x]==-1) c.classList.add('hit');
                    my.appendChild(c);
                    let c2 = document.createElement('div');
                    c2.className = 'btl-cell';
                    if(oppField[y][x]==1) c2.classList.add('miss');
                    if(oppField[y][x]==2) c2.classList.add('hit');
                    c2.classList.add('unknown');
                    c2.onclick = function(){{
                        if(turn==1 && winner==0 && oppField[y][x]==0) shoot(x,y);
                    }};
                    opp.appendChild(c2);
                }}
            }}
        }}
        function updateState(){{
            fetch(/battleship/state/${{gameId}}).then(r=>r.json()).then(data=>{{
                myField = data.my_field;
                oppField = data.opp_field;
                turn = data.turn;
                winner = data.winner;
                renderBoards();
                let st = document.getElementById('btl_status');
                if(winner){{
                    st.innerHTML = winner==1 ? 'Вы победили!' : 'Вы проиграли!';
                }} else if(turn==1){{
                    st.innerHTML = 'Ваш ход!';
                }} else {{
                    st.innerHTML = 'Ход соперника...';
                }}
            }});
        }}
        function shoot(x,y){{
            fetch(/battleship/shoot/${{gameId}},{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{x:x,y:y}})}})
            .then(r=>r.json()).then(data=>{{
                updateState();
            }});
        }}
        updateState();
        setInterval(updateState, 2000);
        </script>
    '''

@app.route('/find_random')
def find_random():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    db = get_db()
    cursor = db.cursor()
    user_id = session['user_id']
    # Проверяем, не в очереди ли уже
    cursor.execute('SELECT * FROM queue WHERE user_id=?', (user_id,))
    if cursor.fetchone() is None:
        cursor.execute('INSERT INTO queue (user_id) VALUES (?)', (user_id,))
        db.commit()
    # Ищем второго игрока
    cursor.execute('SELECT user_id FROM queue WHERE user_id != ? ORDER BY timestamp LIMIT 1', (user_id,))
    opponent = cursor.fetchone()
    if opponent:
        opponent_id = opponent[0]
        # Создаём игру
        cursor.execute('INSERT INTO games (player1_id, player2_id, status) VALUES (?, ?, ?)', (user_id, opponent_id, 'active'))
        game_id = cursor.lastrowid
        # Удаляем обоих из очереди
        cursor.execute('DELETE FROM queue WHERE user_id IN (?, ?)', (user_id, opponent_id))
        db.commit()
        return redirect(url_for('game_room', game_id=game_id))
    else:
        # Проверяем, есть ли уже активная игра с этим пользователем и двумя игроками
        cursor.execute('SELECT id, player1_id, player2_id FROM games WHERE (player1_id=? OR player2_id=?) AND status="active" ORDER BY id DESC LIMIT 1', (user_id, user_id))
        game = cursor.fetchone()
        if game and game[1] and game[2]:
            game_id = game[0]
            return f'''<script>window.location.href='/game_room/{game_id}';</script>'''
        # Если нет активной игры с двумя игроками — просто ждем соперника
        return '''
            <style>
                body { background: #fff; color: #000; font-family: sans-serif; }
                .wait-box { background: #fff; border: 2px solid #000; padding: 24px 32px; width: 340px; margin: 60px auto; box-shadow: 0 2px 8px #aaa2; text-align: center; }
                .wait-msg { color: #000; background: rgb(173,216,230); border-radius: 0; padding: 10px 0; margin-bottom: 18px; font-weight: bold; }
                a { color: rgb(0,0,255); text-decoration: underline; display: block; margin-top: 18px; }
            </style>
            <div class="wait-box">
                <div class="wait-msg">Ожидание соперника...</div>
                <a href='/menu'>Вернуться в меню</a>
            </div>
            <script>
                setInterval(function() {
                    fetch('/check_game')
                        .then(r => r.json())
                        .then(data => {
                            if (data.game_id) window.location.href = '/game_room/' + data.game_id;
                        });
                }, 2000);
            </script>
        '''

@app.route('/check_game')
def check_game():
    if 'user_id' not in session:
        return {'game_id': None}
    db = get_db()
    cursor = db.cursor()
    user_id = session['user_id']
    cursor.execute('SELECT id FROM games WHERE (player1_id=? OR player2_id=?) AND status="active" ORDER BY id DESC LIMIT 1', (user_id, user_id))
    game = cursor.fetchone()
    if game:
        return {'game_id': game[0]}
    return {'game_id': None}

@app.route('/play_friend')
def play_friend():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    db = get_db()
    cursor = db.cursor()
    # Генерируем уникальный invite_code
    invite_code = str(pyrandom.randint(10000, 99999))
    cursor.execute('INSERT INTO games (player1_id, status, invite_code) VALUES (?, ?, ?)', (session['user_id'], 'waiting', invite_code))
    db.commit()
    return f'''
        <style>
            body {{ background: #fff; color: #000; font-family: sans-serif; }}
            .invite-box {{ background: #fff; border: 2px solid #000; padding: 24px 32px; width: 340px; margin: 60px auto; box-shadow: 0 2px 8px #aaa2; text-align: center; }}
            .invite-msg {{ color: #000; background: rgb(173,216,230); border-radius: 0; padding: 10px 0; margin-bottom: 18px; font-weight: bold; }}
            input[type=text] {{ width: 80%; padding: 8px; margin: 8px 0; border: 1px solid #aaa; background: #f8f8f8; }}
            a {{ color: rgb(0,0,255); text-decoration: underline; display: block; margin-top: 18px; }}
        </style>
        <div class="invite-box">
            <div class="invite-msg">Ссылка для друга:</div>
            <input type="text" readonly value="http://127.0.0.1:5000/game/{invite_code}" onclick="this.select()">
            <a href='/menu'>Вернуться в меню</a>
        </div>
    '''

@app.route('/game/<invite_code>', methods=['GET', 'POST'])
def game_invite(invite_code):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT id, player1_id, player2_id, status FROM games WHERE invite_code=?', (invite_code,))
    game = cursor.fetchone()
    if not game:
        return 'Игра не найдена!'
    game_id, player1_id, player2_id, status = game
    user_id = session['user_id']
    if status == 'waiting' and user_id != player1_id:
        if request.method == 'POST':
            cursor.execute('UPDATE games SET player2_id=?, status=? WHERE id=?', (user_id, 'active', game_id))
            db.commit()
            return redirect(url_for('game_room', game_id=game_id))
        return f'''
            <style>
                body {{ background: #fff; color: #000; font-family: sans-serif; }}
                .accept-box {{ background: #fff; border: 2px solid #000; padding: 24px 32px; width: 340px; margin: 60px auto; box-shadow: 0 2px 8px #aaa2; text-align: center; }}
                .accept-msg {{ color: #000; background: rgb(173,216,230); border-radius: 0; padding: 10px 0; margin-bottom: 18px; font-weight: bold; }}
                form {{ margin-top: 18px; }}
                button {{ background: rgb(0,255,0); color: #000; border: 2px solid #000; padding: 8px 24px; font-weight: bold; cursor: pointer; }}
            </style>
            <div class="accept-box">
                <div class="accept-msg">Вас пригласили в игру!</div>
                <form method="post">
                    <button type="submit">Принять</button>
                </form>
                <a href='/menu'>Вернуться в меню</a>
            </div>
        '''
    elif status == 'active' and (user_id == player1_id or user_id == player2_id):
        return redirect(url_for('game_room', game_id=game_id))
    elif user_id == player1_id:
        # Первый игрок ждёт друга — показываем анимацию и polling
        return f'''
            <style>
                body {{ background: #fff; color: #000; font-family: sans-serif; }}
                .wait-box {{ background: #fff; border: 2px solid #000; padding: 32px 40px; width: 360px; margin: 80px auto; box-shadow: 0 2px 8px #aaa2; text-align: center; }}
                .wait-msg {{ color: #000; background: rgb(173,216,230); border-radius: 0; padding: 14px 0; margin-bottom: 24px; font-weight: bold; font-size: 1.2em; }}
                a {{ color: rgb(0,0,255); text-decoration: underline; display: block; margin-top: 24px; }}
            </style>
            <div class="wait-box">
                <div class="wait-msg">Вы создали комнату, ждём друга...</div>
                {LOADER_HTML}
                <a href='/menu' onclick="fetch('/leave_game/{game_id}', {{method: 'POST'}}).then(()=>{{}})">Выйти в меню</a>
            </div>
            <script>
                setInterval(function() {{
                    fetch('/check_opponent/{game_id}')
                        .then(r => r.json())
                        .then(data => {{
                            if (data.ready) window.location.href = '/game_room/{game_id}';
                        }});
                }}, 2000);
            </script>
        '''
    else:
        return 'Вы не участник этой игры.'

# --- Новый loader ---
LOADER_HTML = '''
<div class="loader"></div>
<style>
.loader {
  margin: 24px auto 18px auto;
  border: 8px solid #f3f3f3;
  border-top: 8px solid #3498db;
  border-radius: 50%;
  width: 56px;
  height: 56px;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
'''

@app.route('/game_room/<int:game_id>')
def game_room(game_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT player1_id, player2_id FROM games WHERE id=?', (game_id,))
    game = cursor.fetchone()
    if not game:
        return 'Игра не найдена!'
    player1_id, player2_id = game
    user_id = session['user_id']
    if user_id != player1_id and user_id != player2_id:
        return 'У вас нет доступа к этой комнате.'
    def get_nick(uid):
        cursor.execute('SELECT nickname FROM users WHERE id=?', (uid,))
        row = cursor.fetchone()
        return row[0] if row else 'Игрок'
    nick1 = get_nick(player1_id)
    nick2 = get_nick(player2_id) if player2_id else '...'
    # Если второй игрок не присоединился — всегда показываем ожидание
    if not player2_id:
        return f'''
            <style>
                body {{ background: #fff; color: #000; font-family: sans-serif; }}
                .wait-box {{ background: #fff; border: 2px solid #000; padding: 32px 40px; width: 360px; margin: 80px auto; box-shadow: 0 2px 8px #aaa2; text-align: center; }}
                .wait-msg {{ color: #000; background: rgb(173,216,230); border-radius: 0; padding: 14px 0; margin-bottom: 24px; font-weight: bold; font-size: 1.2em; }}
                a {{ color: rgb(0,0,255); text-decoration: underline; display: block; margin-top: 24px; }}
            </style>
            <div class="wait-box">
                <div class="wait-msg">Вы создали комнату, ждём соперника...</div>
                {LOADER_HTML}
                <a href='/menu' onclick="fetch('/leave_game/{game_id}', {{method: 'POST'}}).then(()=>{{}})">Выйти в меню</a>
            </div>
            <script>
                setInterval(function() {{
                    fetch('/check_opponent/{game_id}')
                        .then(r => r.json())
                        .then(data => {{
                            if (data.ready) window.location.reload();
                        }});
                }}, 2000);
            </script>
        '''
    # Оба игрока есть!
    # Проверяем, завершил ли текущий игрок расстановку
    cursor.execute('SELECT done FROM setup_status WHERE game_id=? AND user_id=?', (game_id, user_id))
    my_setup = cursor.fetchone()
    if not my_setup or not my_setup[0]:
        # Показываем интерфейс расстановки (НЕ важно, расставил ли второй!)
        ship_types = [
            {'code': 'БДК', 'count': 2},
            {'code': 'КР', 'count': 6},
            {'code': 'А', 'count': 1},
            {'code': 'С', 'count': 1},
            {'code': 'ТН', 'count': 1},
            {'code': 'Л', 'count': 2},
            {'code': 'ЭС', 'count': 6},
            {'code': 'М', 'count': 6},
            {'code': 'СМ', 'count': 1},
            {'code': 'Ф', 'count': 6},
            {'code': 'ТК', 'count': 6},
            {'code': 'Т', 'count': 6},
            {'code': 'ТР', 'count': 6},
            {'code': 'СТ', 'count': 6},
            {'code': 'ПЛ', 'count': 1},
            {'code': 'КРПЛ', 'count': 1},
            {'code': 'АБ', 'count': 1},
            {'code': 'ВМБ', 'count': 2},
        ]
        ship_types_js = str(ship_types).replace("'", "\"")
        return f'''
            <style>
                body {{ background: #fff; color: #000; font-family: sans-serif; }}
                .game-box {{ background: #fff; border: 2px solid #000; padding: 32px 40px; width: 900px; margin: 80px auto; box-shadow: 0 2px 8px #aaa2; text-align: center; display: flex; gap: 32px; }}
                .side-panel {{ min-width: 180px; text-align: left; }}
                .ship-list {{ margin-bottom: 18px; }}
                .ship-list-row {{ display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; font-size: 1.1em; cursor:pointer; }}
                .ship-code {{ font-weight: bold; border:1px solid #000; background:#b0e0e6; padding:2px 8px; border-radius:4px; min-width:38px; text-align:center; display:inline-block; }}
                .ship-count {{ font-family: monospace; margin-left:8px; }}
                .ship-list-row.selected .ship-code {{ background: #90ee90; }}
                .inactive-cell {{ background: #eee !important; cursor: not-allowed !important; }}
                .ready-btn:disabled {{ background: #ccc; color: #888; border: 2px solid #888; }}
            </style>
            <div class="game-box">
                <div class="side-panel">
                    <div id="setup_status" style="color:#888;margin-bottom:12px;">Расставьте свой флот (только в нижних 5 рядах)</div>
                    <div class="ship-list" id="ship_list"></div>
                    <div style="margin-top:18px;">
                        <button id="random_btn" style="padding:8px 18px;font-weight:bold;">Рандом</button>
                        <button id="ready_btn" class="ready-btn" style="padding:8px 18px;font-weight:bold;">Готово</button>
                    </div>
                    <a href='/menu' onclick="fetch('/leave_game/{game_id}', {{method: 'POST'}}).then(()=>{{}})" style="display:block;margin-top:24px;">Выйти в меню</a>
                </div>
                <div style="flex:1;">
                    <canvas id="battlefield" width="448" height="480" style="display:block;margin:0 auto;border:2px solid #000;background:#fff;"></canvas>
                </div>
            </div>
            <script>
            // --- JS для расстановки ---
            const COLS = 14;
            const ROWS = 15;
            const CELL_SIZE = 32;
            const canvas = document.getElementById('battlefield');
            const ctx = canvas.getContext('2d');
            canvas.width = COLS * CELL_SIZE;
            canvas.height = ROWS * CELL_SIZE;
            const COLORS = {{
                grid: '#000', cell: '#f8f8f8', ship: '#b0e0e6', text: '#000', inactive: '#eee', selected: '#90ee90',
            }};
            const shipTypes = {ship_types_js};
            let ships = [];
            let shipCount = {{}};
            for (let s of shipTypes) shipCount[s.code] = 0;
            let selectedType = null;
            function updateShipList() {{
                let html = '';
                for (let s of shipTypes) {{
                    let selected = (selectedType === s.code) ? 'selected' : '';
                    html += `<div class='ship-list-row ${{selected}}' data-code='${{s.code}}'><span class='ship-code'>${{s.code}}</span><span class='ship-count'>${{shipCount[s.code]}} / ${{s.count}}</span></div>`;
                }}
                document.getElementById('ship_list').innerHTML = html;
                // Навешиваем обработчик выбора типа
                for (let el of document.querySelectorAll('.ship-list-row')) {{
                    el.onclick = function() {{
                        selectedType = this.getAttribute('data-code');
                        updateShipList();
                    }}
                }}
            }}
            function canPlace(x, y, code) {{
                if (y < 10 || y > 14) return false;
                let max = shipTypes.find(s=>s.code===code).count;
                if (shipCount[code] >= max) return false;
                for (let ship of ships) if (ship.x===x && ship.y===y) return false;
                return true;
            }}
            function randomPlacement() {{
                ships = [];
                for (let s of shipTypes) shipCount[s.code] = 0;
                let attempts = 0;
                for (let s of shipTypes) {{
                    let placed = 0;
                    while (placed < s.count && attempts < 10000) {{
                        let x = Math.floor(Math.random()*COLS);
                        let y = 10 + Math.floor(Math.random()*5);
                        if (canPlace(x, y, s.code)) {{
                            ships.push({{type: s.code, x, y}});
                            shipCount[s.code]++;
                            placed++;
                        }}
                        attempts++;
                    }}
                }}
                updateShipList();
                drawField();
                checkReady();
            }}
            function drawField() {{
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                for (let y = 0; y < ROWS; y++) {{
                    for (let x = 0; x < COLS; x++) {{
                        ctx.fillStyle = (y < 10 || y > 14) ? COLORS.inactive : COLORS.cell;
                        ctx.fillRect(x*CELL_SIZE, y*CELL_SIZE, CELL_SIZE, CELL_SIZE);
                        ctx.strokeStyle = COLORS.grid;
                        ctx.strokeRect(x*CELL_SIZE, y*CELL_SIZE, CELL_SIZE, CELL_SIZE);
                    }}
                }}
                for (let ship of ships) {{
                    ctx.fillStyle = (selectedType && ship.type === selectedType) ? COLORS.selected : COLORS.ship;
                    ctx.fillRect(ship.x*CELL_SIZE+2, ship.y*CELL_SIZE+2, CELL_SIZE-4, CELL_SIZE-4);
                    ctx.fillStyle = COLORS.text;
                    ctx.font = 'bold 16px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(ship.type, ship.x*CELL_SIZE+CELL_SIZE/2, ship.y*CELL_SIZE+CELL_SIZE/2);
                }}
            }}
            function checkReady() {{
                let ready = true;
                for (let s of shipTypes) if (shipCount[s.code] !== s.count) ready = false;
                document.getElementById('ready_btn').disabled = !ready;
            }}
            // --- Клик по полю ---
            canvas.addEventListener('click', function(e) {{
                const rect = canvas.getBoundingClientRect();
                const x = Math.floor((e.clientX - rect.left) / CELL_SIZE);
                const y = Math.floor((e.clientY - rect.top) / CELL_SIZE);
                // Если клик по своей зоне
                if (y < 10 || y > 14) return;
                // Если уже стоит фишка — снимаем её
                let idx = ships.findIndex(s=>s.x===x && s.y===y);
                if (idx !== -1) {{
                    let code = ships[idx].type;
                    ships.splice(idx,1);
                    shipCount[code]--;
                    updateShipList();
                    drawField();
                    checkReady();
                    return;
                }}
                // Если выбран тип и можно поставить
                if (selectedType && canPlace(x, y, selectedType)) {{
                    ships.push({{type: selectedType, x, y}});
                    shipCount[selectedType]++;
                    updateShipList();
                    drawField();
                    checkReady();
                }}
            }});
            document.getElementById('random_btn').onclick = function() {{
                selectedType = null;
                randomPlacement();
            }};
            document.getElementById('ready_btn').onclick = function() {{
                if (this.disabled) return;
                fetch('/setup_done/{game_id}', {{method:'POST'}}).then(()=>{{
                    document.getElementById('setup_status').innerText = 'Ожидание соперника...';
                    document.getElementById('random_btn').disabled = true;
                    document.getElementById('ready_btn').disabled = true;
                    setInterval(()=>location.reload(), 2000);
                }});
            }};
            // Инициализация
            updateShipList();
            drawField();
            </script>
        '''
    # Проверяем, завершил ли второй игрок расстановку
    opponent_id = player2_id if user_id == player1_id else player1_id
    cursor.execute('SELECT done FROM setup_status WHERE game_id=? AND user_id=?', (game_id, opponent_id))
    opp_setup = cursor.fetchone()
    if not opp_setup or not opp_setup[0]:
        # Я уже расставил, соперник ещё нет — показываем "Ожидание соперника"
        return f'''
            <style>
                body {{ background: #fff; color: #000; font-family: sans-serif; }}
                .game-box {{ background: #fff; border: 2px solid #000; padding: 32px 40px; width: 400px; margin: 80px auto; box-shadow: 0 2px 8px #aaa2; text-align: center; }}
                .players {{ font-size: 1.2em; margin-bottom: 24px; }}
                .nickname {{ display: inline-block; background: rgb(173,216,230); border: 2px solid #000; border-radius: 8px; padding: 8px 18px; margin: 0 10px; font-weight: bold; }}
                a {{ color: rgb(0,0,255); text-decoration: underline; display: block; margin-top: 24px; }}
            </style>
            <div class="game-box">
                <div class="players">
                    <span class="nickname">{nick1}</span>  VS  <span class="nickname">{nick2}</span>
                </div>
                <div style="color:#888;">Ожидание расстановки соперника...</div>
                <a href='/menu' onclick="fetch('/leave_game/{game_id}', {{method: 'POST'}}).then(()=>{{}})">Выйти в меню</a>
            </div>
            <script>
                setInterval(function() {{
                    fetch('/check_setup_done/{game_id}')
                        .then(r => r.json())
                        .then(data => {{
                            if (data.ready) window.location.reload();
                        }});
                }}, 2000);
            </script>
        '''
    # Оба расставили — показываем VS и ожидание боя
    # Проверяем, инициализировано ли состояние боя
    cursor.execute('SELECT 1 FROM battle_state WHERE game_id=?', (game_id,))
    if not cursor.fetchone():
        init_battle_state(game_id, player1_id, player2_id)
    # После инициализации — редирект на страницу боя
    return redirect(url_for('battle_page', game_id=game_id))

@app.route('/check_opponent/<int:game_id>')
def check_opponent(game_id):
    if 'user_id' not in session:
        return {'ready': False}
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT player2_id FROM games WHERE id=?', (game_id,))
    row = cursor.fetchone()
    if row and row[0]:
        return {'ready': True}
    return {'ready': False}

@app.route('/leave_game/<int:game_id>', methods=['POST'])
def leave_game(game_id):
    if 'user_id' not in session:
        return jsonify({'ok': True})
    db = get_db()
    cursor = db.cursor()
    user_id = session['user_id']
    cursor.execute('SELECT player1_id, player2_id FROM games WHERE id=?', (game_id,))
    game = cursor.fetchone()
    if not game:
        return jsonify({'ok': True})
    player1_id, player2_id = game
    # Обнуляем поле игрока, который вышел
    if user_id == player1_id:
        cursor.execute('UPDATE games SET player1_id=NULL WHERE id=?', (game_id,))
    elif user_id == player2_id:
        cursor.execute('UPDATE games SET player2_id=NULL WHERE id=?', (game_id,))
    db.commit()
    # Если оба игрока вышли — удаляем комнату
    cursor.execute('SELECT player1_id, player2_id FROM games WHERE id=?', (game_id,))
    game = cursor.fetchone()
    if game and game[0] is None and game[1] is None:
        cursor.execute('DELETE FROM games WHERE id=?', (game_id,))
        db.commit()
    return jsonify({'ok': True})

@app.route('/stats')
def stats():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    db = get_db()
    cursor = db.cursor()
    user_id = session['user_id']
    cursor.execute('SELECT nickname FROM users WHERE id=?', (user_id,))
    nickname = cursor.fetchone()[0]
    cursor.execute('''SELECT games_played, games_won, total_time_played, games_vs_friends, games_vs_random, wins_vs_friends, wins_vs_random FROM stats WHERE user_id=?''', (user_id,))
    row = cursor.fetchone()
    if not row:
        stats = [0]*7
    else:
        stats = row
    return f'''
        <style>
            body {{ background: #fff; color: #000; font-family: sans-serif; }}
            .stats-box {{ background: #fff; border: 2px solid #000; padding: 32px 40px; width: 400px; margin: 80px auto; box-shadow: 0 2px 8px #aaa2; text-align: center; }}
            h2 {{ margin-bottom: 24px; }}
            table {{ width: 100%; border-collapse: collapse; margin: 0 auto 18px auto; }}
            th, td {{ border: 1px solid #000; padding: 8px; }}
            th {{ background: rgb(173,216,230); }}
            td {{ background: #fff; }}
            .back-link {{ color: rgb(0,0,255); text-decoration: underline; display: block; margin-top: 24px; }}
        </style>
        <div class="stats-box">
            <h2>Статистика игрока: {nickname}</h2>
            <table>
                <tr><th>Параметр</th><th>Значение</th></tr>
                <tr><td>Всего игр</td><td>{stats[0]}</td></tr>
                <tr><td>Побед</td><td>{stats[1]}</td></tr>
                <tr><td>Поражений</td><td>{stats[0] - stats[1]}</td></tr>
                <tr><td>Побед с другом</td><td>{stats[5]}</td></tr>
                <tr><td>Побед со случайными</td><td>{stats[6]}</td></tr>
                <tr><td>Игр с друзьями</td><td>{stats[3]}</td></tr>
                <tr><td>Игр со случайными</td><td>{stats[4]}</td></tr>
                <tr><td>Время в игре (мин)</td><td>{stats[2]//60}</td></tr>
            </table>
            <a class="back-link" href="/menu">В меню</a>
        </div>
    '''

# Новый роут для отметки завершения расстановки
@app.route('/setup_done/<int:game_id>', methods=['POST'])
def setup_done(game_id):
    if 'user_id' not in session:
        return jsonify({'ok': False, 'error': 'not logged in'})
    db = get_db()
    cursor = db.cursor()
    user_id = session['user_id']
    cursor.execute('REPLACE INTO setup_status (game_id, user_id, done) VALUES (?, ?, 1)', (game_id, user_id))
    db.commit()
    return jsonify({'ok': True})

@app.route('/check_setup_done/<int:game_id>')
def check_setup_done(game_id):
    if 'user_id' not in session:
        return jsonify({'ready': False})
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT player1_id, player2_id FROM games WHERE id=?', (game_id,))
    game = cursor.fetchone()
    if not game:
        return jsonify({'ready': False})
    player1_id, player2_id = game
    if not player1_id or not player2_id:
        return jsonify({'ready': False})
    cursor.execute('SELECT done FROM setup_status WHERE game_id=? AND user_id=?', (game_id, player1_id))
    p1 = cursor.fetchone()
    cursor.execute('SELECT done FROM setup_status WHERE game_id=? AND user_id=?', (game_id, player2_id))
    p2 = cursor.fetchone()
    if p1 and p1[0] and p2 and p2[0]:
        return jsonify({'ready': True})
    return jsonify({'ready': False})

# --- Вспомогательная функция для инициализации состояния боя ---
def init_battle_state(game_id, player1_id, player2_id):
    db = get_db()
    cursor = db.cursor()
    # Стартовые позиции: только свои корабли видны (пока просто пустой шаблон)
    # TODO: получить реальные позиции с расстановки
    positions = {
        str(player1_id): [],  # список фишек игрока 1
        str(player2_id): []   # список фишек игрока 2
    }
    # Кто ходит первым — кто быстрее расставил (пока player1_id)
    current_turn = player1_id
    now = int(time.time())
    total_time = 15 * 60  # 15 минут в секундах
    cursor.execute('REPLACE INTO battle_state (game_id, positions, current_turn_player_id, move_start_time, total_time_p1, total_time_p2, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
                   (game_id, json.dumps(positions), current_turn, now, total_time, total_time, 'active'))
    db.commit()

# --- API: получить состояние боя ---
@app.route('/battle/state/<int:game_id>')
def battle_state(game_id):
    if 'user_id' not in session:
        return jsonify({'error': 'not logged in'})
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT positions, current_turn_player_id, move_start_time, total_time_p1, total_time_p2, status FROM battle_state WHERE game_id=?', (game_id,))
    row = cursor.fetchone()
    if not row:
        return jsonify({'error': 'no battle'})
    positions, current_turn, move_start_time, total_time_p1, total_time_p2, status = row
    return jsonify({
        'positions': json.loads(positions),
        'current_turn': current_turn,
        'move_start_time': move_start_time,
        'total_time_p1': total_time_p1,
        'total_time_p2': total_time_p2,
        'status': status
    })

# --- API: совершить ход (заглушка) ---
@app.route('/battle/move/<int:game_id>', methods=['POST'])
def battle_move(game_id):
    if 'user_id' not in session:
        return jsonify({'error': 'not logged in'})
    user_id = session['user_id']
    db = get_db()
    cursor = db.cursor()
    # Получаем текущее состояние боя
    cursor.execute('SELECT positions, current_turn_player_id, move_start_time, total_time_p1, total_time_p2, status FROM battle_state WHERE game_id=?', (game_id,))
    row = cursor.fetchone()
    if not row:
        return jsonify({'error': 'no battle'})
    positions, current_turn, move_start_time, total_time_p1, total_time_p2, status = row
    if status != 'active':
        return jsonify({'error': 'battle finished'})
    if user_id != current_turn:
        return jsonify({'error': 'not your turn'})
    # Время на ход
    now = int(time.time())
    move_time = now - move_start_time
    if move_time > 30:
        move_time = 30
    # Определяем id обоих игроков
    cursor.execute('SELECT player1_id, player2_id FROM games WHERE id=?', (game_id,))
    g = cursor.fetchone()
    if not g:
        return jsonify({'error': 'no game'})
    player1_id, player2_id = g
    # Уменьшаем время у текущего игрока
    if user_id == player1_id:
        total_time_p1 = max(0, total_time_p1 - move_time)
    else:
        total_time_p2 = max(0, total_time_p2 - move_time)
    if (user_id == player1_id and total_time_p1 == 0) or (user_id == player2_id and total_time_p2 == 0):
        cursor.execute('UPDATE battle_state SET status=? WHERE game_id=?', ('finished', game_id))
        db.commit()
        return jsonify({'ok': False, 'msg': 'Время вышло, вы проиграли', 'status': 'finished'})
    # Получаем данные хода
    data = request.get_json()
    # Ожидаем data = {'move': {'idx': int, 'to': [x, y]}, 'attack': {'target_idx': int} (опционально)}
    move = data.get('move')
    attack = data.get('attack')
    positions = json.loads(positions)
    my_key = str(user_id)
    opp_key = str(player2_id if user_id == player1_id else player1_id)
    my_ships = positions.get(my_key, [])
    opp_ships = positions.get(opp_key, [])
    # Проверка движения
    if move:
        idx = move.get('idx')
        to = move.get('to')
        if idx is None or to is None or idx < 0 or idx >= len(my_ships):
            return jsonify({'error': 'invalid move'})
        ship = my_ships[idx]
        if not ship.get('alive', True):
            return jsonify({'error': 'ship is dead'})
        from_x, from_y = ship['x'], ship['y']
        to_x, to_y = to
        # Проверка: движение на 1 клетку по горизонтали/вертикали
        if abs(to_x - from_x) + abs(to_y - from_y) != 1:
            return jsonify({'error': 'move must be by 1 cell'})
        # Проверка: в пределах поля 0<=x<14, 0<=y<15
        if not (0 <= to_x < 14 and 0 <= to_y < 15):
            return jsonify({'error': 'out of bounds'})
        # Проверка: клетка не занята другой своей фишкой
        for s in my_ships:
            if s.get('alive', True) and s['x'] == to_x and s['y'] == to_y:
                return jsonify({'error': 'cell occupied'})
        # Проверка: клетка не занята живой фишкой противника (если не атака)
        for s in opp_ships:
            if s.get('alive', True) and s['x'] == to_x and s['y'] == to_y:
                return jsonify({'error': 'cell occupied by enemy'})
        # Двигаем фишку
        ship['x'], ship['y'] = to_x, to_y
    # Проверка атаки (упрощённо: если есть атака, убиваем цель)
    if attack:
        target_idx = attack.get('target_idx')
        if target_idx is None or target_idx < 0 or target_idx >= len(opp_ships):
            return jsonify({'error': 'invalid attack'})
        target = opp_ships[target_idx]
        if not target.get('alive', True):
            return jsonify({'error': 'target already dead'})
        # Проверка: фишки должны быть лицом к лицу (соседние клетки)
        # (упрощённо: просто соседние)
        my_attackers = []
        if move:
            my_attackers.append(my_ships[move['idx']])
        else:
            # Если атака без движения — ищем любую свою фишку рядом
            for s in my_ships:
                if s.get('alive', True) and abs(s['x'] - target['x']) + abs(s['y'] - target['y']) == 1:
                    my_attackers.append(s)
        if not my_attackers:
            return jsonify({'error': 'no attacker in position'})
        # Побеждает атакующий (упрощённо)
        target['alive'] = False
    # Проверка победы
    def is_alive(s):
        return s.get('alive', True)
    def is_movable(s):
        # ВМБ и СМ не двигаются
        return s.get('alive', True) and s['type'] not in ('ВМБ', 'СМ')
    opp_vmb = [s for s in opp_ships if s.get('alive', True) and s['type'] == 'ВМБ']
    opp_movable = [s for s in opp_ships if is_movable(s)]
    winner = None
    if len(opp_vmb) < 2 or not opp_movable:
        winner = user_id
    # Переключаем ход
    next_turn = player2_id if user_id == player1_id else player1_id
    move_start_time = now
    # Если победа — статус finished
    if winner:
        cursor.execute('UPDATE battle_state SET positions=?, current_turn_player_id=?, move_start_time=?, total_time_p1=?, total_time_p2=?, status=? WHERE game_id=?',
                       (json.dumps({my_key: my_ships, opp_key: opp_ships}), next_turn, move_start_time, total_time_p1, total_time_p2, 'finished', game_id))
        db.commit()
        return jsonify({'ok': True, 'msg': 'Победа!', 'winner': winner, 'positions': {my_key: my_ships, opp_key: opp_ships}})
    # Сохраняем новое состояние
    cursor.execute('UPDATE battle_state SET positions=?, current_turn_player_id=?, move_start_time=?, total_time_p1=?, total_time_p2=? WHERE game_id=?',
                   (json.dumps({my_key: my_ships, opp_key: opp_ships}), next_turn, move_start_time, total_time_p1, total_time_p2, game_id))
    db.commit()
    return jsonify({'ok': True, 'msg': 'Ход принят', 'next_turn': next_turn, 'positions': {my_key: my_ships, opp_key: opp_ships}, 'total_time_p1': total_time_p1, 'total_time_p2': total_time_p2})

@app.route('/battle/<int:game_id>')
def battle_page(game_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))
    user_id = session['user_id']
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT player1_id, player2_id FROM games WHERE id=?', (game_id,))
    game = cursor.fetchone()
    if not game:
        return 'Игра не найдена!'
    player1_id, player2_id = game
    if user_id != player1_id and user_id != player2_id:
        return 'У вас нет доступа к этой игре.'
    return f'''
        <style>
            body {{ background: #fff; color: #000; font-family: sans-serif; }}
            .battle-box {{ background: #fff; border: 2px solid #000; padding: 32px 40px; width: 700px; margin: 40px auto; box-shadow: 0 2px 8px #aaa2; text-align: center; }}
            .battle-board {{ display: grid; grid-template-columns: repeat(14, 32px); grid-template-rows: repeat(15, 32px); margin: 0 auto; }}
            .battle-cell {{ width: 32px; height: 32px; border: 1px solid #aaa; box-sizing: border-box; background: #f8f8f8; cursor: pointer; position: relative; }}
            .battle-cell.mine {{ background: #b0e0e6; }}
            .battle-cell.selected {{ outline: 2px solid #00f; }}
            .battle-cell.enemy {{ background: #bbb; }}
            .battle-cell.dead {{ background: #333; }}
            .battle-cell.vmb {{ background: #000; color: #fff; }}
            .battle-cell.sm {{ background: #00f; color: #fff; }}
        </style>
        <div class="battle-box">
            <div id="battle_status" style="margin-bottom:18px;font-size:1.1em;"></div>
            <div id="battle_timers" style="margin-bottom:18px;font-size:1em;"></div>
            <div id="battle_board" class="battle-board"></div>
            <div style="margin-top:18px;">
                <button id="move_btn" disabled>Сделать ход</button>
                <button id="attack_btn" disabled>Атаковать</button>
            </div>
        </div>
        <script>
        const userId = {user_id};
        const game_id = {game_id};
        let state = null;
        let selectedIdx = null;
        let selectedTarget = null;
        function fetchState() {{
            fetch(`/battle/state/${{game_id}}`).then(r=>r.json()).then(data=>{{
                state = data;
                renderBoard();
                updateStatus();
            }});
        }}
        function renderBoard() {{
            const board = document.getElementById('battle_board');
            board.innerHTML = '';
            if (!state || !state.positions) return;
            let myKey = String(userId);
            let oppKey = null;
            for (let k in state.positions) if (k !== myKey) oppKey = k;
            let myShips = state.positions[myKey] || [];
            let oppShips = state.positions[oppKey] || [];
            // Собираем карту: [y][x] = {{ship, mine}}
            let map = Array.from(new Array(15),()=>new Array(14).fill(null));
            myShips.forEach((s,i)=>{{if(s.alive!==false) map[s.y][s.x] = Object.assign({{}},s,{{mine:true, idx:i}});}});
            oppShips.forEach((s,i)=>{{if(s.alive!==false) map[s.y][s.x] = Object.assign({{}},s,{{mine:false, idx:i}});}});
            for(let y=0;y<15;y>{{
                for(let x=0;x<14;x>{{
                    let cell = document.createElement('div');
                    cell.className = 'battle-cell';
                    let s = map[y][x];
                    if(s){{
                        if(s.mine){{
                            cell.classList.add('mine');
                            cell.innerText = s.type;
                            if(selectedIdx===s.idx) cell.classList.add('selected');
                            cell.onclick = function(){{selectedIdx=s.idx;selectedTarget=null;updateBtns();renderBoard();}};
                        }}else{{
                            // Вражеские фишки не показываем, только если мертва
                            if(s.alive===false){{cell.classList.add('dead');cell.innerText='✖';}}
                            else cell.classList.add('enemy');
                            cell.onclick = function(){{if(selectedIdx!==null){{selectedTarget=s.idx;updateBtns();}}}};
                        }}
                        if(s.type==='ВМБ') cell.classList.add('vmb');
                        if(s.type==='СМ') cell.classList.add('sm');
                    }} else {{
                        cell.onclick = function(){{selectedTarget=null;}};
                    }}
                    board.appendChild(cell);
                }}
            }}
        }}
        function updateStatus() {{
            let st = document.getElementById('battle_status');
            let timers = document.getElementById('battle_timers');
            if(!state) return;
            let turn = state.current_turn;
            let status = state.status;
            let myMove = (turn==userId && status==='active');
            st.innerHTML = status==='finished' ? 'Игра окончена!' : (myMove ? 'Ваш ход!' : 'Ход соперника...');
            let t1 = state.total_time_p1, t2 = state.total_time_p2;
            timers.innerHTML = `Ваше время: ${{t1}} сек | Время соперника: ${{t2}} сек`;
            updateBtns();
        }}
        function updateBtns() {{
            let myMove = state && state.current_turn==userId && state.status==='active';
            document.getElementById('move_btn').disabled = !(myMove && selectedIdx!==null && selectedTarget===null);
            document.getElementById('attack_btn').disabled = !(myMove && selectedIdx!==null && selectedTarget!==null);
        }}
        document.getElementById('move_btn').onclick = function(){{
            if(selectedIdx===null) return;
            // Движение: ищем куда можно пойти (1 клетка)
            let myShips = state.positions[String(userId)]||[];
            let ship = myShips[selectedIdx];
            if(!ship) return;
            let moves = [[ship.x+1,ship.y],[ship.x-1,ship.y],[ship.x,ship.y+1],[ship.x,ship.y-1]];
            let to = prompt('Введите координаты x y для хода (например: 5 10):');
            if(!to) return;
            let [x,y] = to.split(/\s+/).map(Number);
            if(!moves.some(function(m){{return m[0]===x&&m[1]===y;}})){{alert('Можно ходить только на 1 клетку!');return;}}
            fetch(`/battle/move/${{game_id}}`,{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{move:{{idx:selectedIdx,to:[x,y]}}}})}})
            .then(r=>r.json()).then(data=>{{if(data.ok){{selectedIdx=null;selectedTarget=null;fetchState();}}else alert(data.error||data.msg);}});
        }};
        document.getElementById('attack_btn').onclick = function(){{
            if(selectedIdx===null||selectedTarget===null) return;
            fetch(`/battle/move/${{game_id}}`,{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{move:{{idx:selectedIdx,to:[state.positions[String(userId)][selectedIdx].x,state.positions[String(userId)][selectedIdx].y]}},attack:{{target_idx:selectedTarget}}}})}})
            .then(r=>r.json()).then(data=>{{if(data.ok){{selectedIdx=null;selectedTarget=null;fetchState();}}else alert(data.error||data.msg);}});
        }};
        fetchState();
        setInterval(fetchState, 2000);
        </script>
    '''

if __name__ == '__main__':
    init_db()
    app.run(debug=True) 
