Admiral — Django + Channels. Поле 15x14, WebSocket, REST.
Старт: py -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
py manage.py migrate && py manage.py createsuperuser && py manage.py runserver