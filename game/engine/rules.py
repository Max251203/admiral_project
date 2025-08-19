BOARD_W, BOARD_H = 14, 15

SHIP_TYPES = {
    "BDK": {"count": 2, "rank": 18, "name": "БДК"},
    "L": {"count": 2, "rank": 17, "name": "Л"},
    "A": {"count": 1, "rank": 16, "name": "А"},
    "KR": {"count": 6, "rank": 15, "name": "КР"},
    "F": {"count": 6, "rank": 14, "name": "Ф"},
    "ES": {"count": 6, "rank": 13, "name": "ЭС"},
    "ST": {"count": 6, "rank": 12, "name": "СТ"},
    "TR": {"count": 6, "rank": 11, "name": "ТР"},
    "TK": {"count": 6, "rank": 10, "name": "ТК"},
    "T": {"count": 6, "rank": 9, "name": "Т"},
    "TN": {"count": 1, "rank": 8, "name": "ТН"},
    "S": {"count": 1, "rank": 7, "name": "С"},
    "PL": {"count": 1, "rank": 6, "name": "ПЛ"},
    "KRPL": {"count": 1, "rank": 5, "name": "КРПЛ"},
    "M": {"count": 6, "rank": 4, "name": "М"},
    "SM": {"count": 1, "rank": 3, "name": "СМ"},
    "AB": {"count": 1, "rank": 2, "name": "АБ"},
    "VMB": {"count": 2, "rank": 1, "name": "ВМБ"},
}

IMMOBILE_TYPES = {"VMB", "SM"}
CARRIER_TYPES = {"ES": "M", "TK": "T", "A": "S"}
SPECIAL_KILLS = {("PL", "BDK"), ("PL", "A"), ("KRPL", "KR")}
EXPLOSIVE_TYPES = {"AB", "TN", "M", "SM"}

def get_ship_rank(ship_type):
    return SHIP_TYPES.get(ship_type, {}).get("rank", 0)

def is_immobile(ship_type):
    return ship_type in IMMOBILE_TYPES

def can_carry(carrier_type):
    return CARRIER_TYPES.get(carrier_type)

def is_special_kill(attacker, defender):
    return (attacker, defender) in SPECIAL_KILLS

def is_explosive(ship_type):
    return ship_type in EXPLOSIVE_TYPES