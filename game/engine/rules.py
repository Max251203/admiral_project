BOARD_W, BOARD_H = 14, 15
RED_LINES = [5, 10]

TYPES = ["BDK","KR","A","S","TN","L","ES","M","SM","F","TK","T","TR","ST","PL","KRPL","AB","VMB"]

RANK = {"BDK":18,"L":17,"A":16,"KR":15,"F":14,"ES":13,"ST":12,"TR":11,"TK":10,"T":9,"TN":8,"S":7,"PL":6,"KRPL":5,"M":4,"SM":3,"AB":2,"VMB":1}

IMMOBILE = {"VMB","SM"}
CARRIER_OF = {"ES":"M","TK":"T","A":"S"}
SPECIAL_KILLS = {("PL","BDK"),("PL","A"),("KRPL","KR")}
SPECIAL_REVERSE = {("BDK","PL"),("A","PL"),("KR","KRPL")}
COLORS = {"BDK":"#e74c3c","A":"#e74c3c","AB":"#c0392b","TK":"#27ae60","T":"#2ecc71","TR":"#1abc9c","KR":"#3498db","L":"#2980b9","F":"#1f8edb","ES":"#2ea2f2","ST":"#2c89c6","PL":"#0b4f6c","KRPL":"#07364b","M":"#95a5a6","SM":"#7f8c8d","TN":"#d35400","VMB":"#bdc3c7"}