from dataclasses import dataclass, field, asdict
from typing import Dict, Tuple, List, Optional
from .rules import BOARD_W, BOARD_H, RANK, IMMOBILE, CARRIER_OF, SPECIAL_KILLS, SPECIAL_REVERSE

Coord = Tuple[int, int]


@dataclass
class Piece:
    owner: int
    kind: str
    alive: bool = True


@dataclass
class GameData:
    turn: int = 1
    phase: str = "SETUP"
    board: Dict[Coord, List[Piece]] = field(default_factory=dict)
    winner: Optional[int] = None
    win_reason: str = ""
    setup_counts: Dict[int, Dict[str, int]] = field(default_factory=lambda: {1: {}, 2: {}})


class Engine:
    def __init__(self, data: dict | None = None):
        if data:
            board: Dict[Coord, List[Piece]] = {}
            for k, v in data.get("board", {}).items():
                x, y = map(int, k.split(","))
                board[(x, y)] = [Piece(**p) for p in v]

            raw_counts = data.get("setup_counts", {1: {}, 2: {}})
            norm_counts: Dict[int, Dict[str, int]] = {}
            for k, v in raw_counts.items():
                try:
                    ik = int(k)
                except (TypeError, ValueError):
                    ik = k  # хотя ожидаем int, на всякий случай
                norm_counts[ik] = v or {}

            self.gd = GameData(
                turn=int(data.get("turn", 1)),
                phase=data.get("phase", "SETUP"),
                board=board,
                winner=data.get("winner"),
                win_reason=data.get("win_reason", ""),
                setup_counts=norm_counts if norm_counts else {1: {}, 2: {}},
            )
        else:
            self.gd = GameData()

    def to_json(self) -> dict:
        # ключи координат сериализуем в "x,y"
        return {
            "turn": self.gd.turn,
            "phase": self.gd.phase,
            "winner": self.gd.winner,
            "win_reason": self.gd.win_reason,
            "setup_counts": {int(k): v for k, v in self.gd.setup_counts.items()},
            "board": {
                f"{x},{y}": [asdict(p) for p in arr]
                for (x, y), arr in self.gd.board.items()
            },
        }

    def _in_bounds(self, c: Coord) -> bool:
        return 0 <= c[0] < BOARD_W and 0 <= c[1] < BOARD_H

    def _get(self, c: Coord) -> List[Piece]:
        return self.gd.board.get(c, [])

    def _set(self, c: Coord, arr: List[Piece]):
        if arr:
            self.gd.board[c] = arr
        else:
            if c in self.gd.board:
                del self.gd.board[c]

    def _neighbors4(self, c: Coord) -> List[Coord]:
        x, y = c
        return [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]

    def _is_valid_setup_zone(self, coord: Coord, owner: int) -> bool:
        _, y = coord
        if owner == 1:
            return 10 <= y <= 14
        else:
            return 0 <= y <= 4

    def place(self, owner: int, coord: Coord, kind: str):
        if self.gd.phase != "SETUP":
            raise ValueError("not setup phase")
        if not self._in_bounds(coord):
            raise ValueError("out of bounds")
        if not self._is_valid_setup_zone(coord, owner):
            raise ValueError("invalid setup zone")
        if self._get(coord):
            raise ValueError("cell occupied")

        current_count = self.gd.setup_counts.get(owner, {}).get(kind, 0)
        max_counts = {
            "BDK": 2, "KR": 6, "A": 1, "S": 1, "TN": 1, "L": 2, "ES": 6,
            "M": 6, "SM": 1, "F": 6, "TK": 6, "T": 6, "TR": 6, "ST": 6,
            "PL": 1, "KRPL": 1, "AB": 1, "VMB": 2
        }
        if current_count >= max_counts.get(kind, 0):
            raise ValueError(f"too many {kind}")

        self._set(coord, [Piece(owner=owner, kind=kind)])

        if owner not in self.gd.setup_counts:
            self.gd.setup_counts[owner] = {}
        self.gd.setup_counts[owner][kind] = current_count + 1

    def _collect_group(self, origin: Coord, owner: int, kind: str) -> List[Tuple[Coord, Piece]]:
        seen = set()
        out: List[Tuple[Coord, Piece]] = []
        stack = [origin]

        while stack and len(out) < 3:
            c = stack.pop()
            if c in seen:
                continue
            seen.add(c)

            arr = self._get(c)
            if arr and arr[0].owner == owner and arr[0].kind == kind and arr[0].alive:
                out.append((c, arr[0]))
                for n in self._neighbors4(c):
                    if n not in seen:
                        na = self._get(n)
                        if na and na[0].owner == owner and na[0].kind == kind and na[0].alive:
                            stack.append(n)

        return out[:3]

    def _compare(self, atk: List[Piece], dfn: List[Piece]) -> int:
        if len(atk) == 1 and len(dfn) == 1:
            a, d = atk[0], dfn[0]
            if (a.kind, d.kind) in SPECIAL_KILLS:
                return 1
            if (d.kind, a.kind) in SPECIAL_KILLS:
                return -1
            if (a.kind, d.kind) in SPECIAL_REVERSE:
                return 1
            if (d.kind, a.kind) in SPECIAL_REVERSE:
                return -1

        sa = sum(RANK[p.kind] for p in atk)
        sd = sum(RANK[p.kind] for p in dfn)
        return (sa > sd) - (sa < sd)

    def _kill(self, c: Coord, res: dict):
        arr = self._get(c)
        if arr:
            res["captures"].append(arr[0].kind)
            self._set(c, [])

    def _ab_explode(self, center: Coord, res: dict):
        cx, cy = center
        for y in range(cy - 2, cy + 3):
            for x in range(cx - 2, cx + 3):
                c = (x, y)
                if not self._in_bounds(c):
                    continue
                if self._get(c) and c != center:
                    if self._get(c)[0].kind == "AB":
                        self._ab_explode(c, res)
                    self._kill(c, res)
        self._set(center, [])

    def _check_victory(self):
        bases = {1: 0, 2: 0}
        mov = {1: 0, 2: 0}

        for arr in self.gd.board.values():
            if arr and arr[0].alive:
                if arr[0].kind == "VMB":
                    bases[arr[0].owner] += 1
                if arr[0].kind not in IMMOBILE:
                    mov[arr[0].owner] += 1

        if bases[1] < 2:
            self.gd.winner = 2
            self.gd.win_reason = "bases"
            self.gd.phase = "FINISHED"
            return
        if bases[2] < 2:
            self.gd.winner = 1
            self.gd.win_reason = "bases"
            self.gd.phase = "FINISHED"
            return
        if mov[1] == 0:
            self.gd.winner = 2
            self.gd.win_reason = "moves"
            self.gd.phase = "FINISHED"
            return
        if mov[2] == 0:
            self.gd.winner = 1
            self.gd.win_reason = "moves"
            self.gd.phase = "FINISHED"
            return

    def _advance_turn(self):
        self.gd.turn = 2 if self.gd.turn == 1 else 1
        if self.gd.phase in ("TURN_P1", "TURN_P2"):
            self.gd.phase = f"TURN_P{self.gd.turn}"

    def move(
        self,
        actor: int,
        src: Coord,
        dst: Coord,
        followers: Optional[List[List[int]]] = None
    ) -> dict:
        if self.gd.phase not in ("TURN_P1", "TURN_P2"):
            raise ValueError("bad phase")
        if self.gd.turn != actor:
            raise ValueError("not your turn")
        if not self._in_bounds(src) or not self._in_bounds(dst):
            raise ValueError("out of bounds")

        sarr = self._get(src)
        if not sarr:
            raise ValueError("empty source")

        u = sarr[0]
        if u.owner != actor:
            raise ValueError("not your piece")
        if u.kind in IMMOBILE:
            raise ValueError("immobile piece")

        dx, dy = dst[0] - src[0], dst[1] - src[1]
        man = abs(dx) + abs(dy)
        legal = (man == 1) or (u.kind == "TK" and ((abs(dx) == 2 and dy == 0) or (abs(dy) == 2 and dx == 0)))

        if not legal:
            raise ValueError("illegal move")

        result = {"event": "move", "captures": [], "exchange": False}
        darr = self._get(dst)

        if darr:
            v = darr[0]

            if v.kind == "AB" or u.kind == "AB":
                to_explode = dst if v.kind == "AB" else src
                self._ab_explode(to_explode, result)
                if u.kind == "AB":
                    self._set(src, [])
                self._check_victory()
                self._advance_turn()
                return {"event": "ab_explode", "captures": result["captures"]}

            if v.kind == "M":
                if u.kind == "TR":
                    self._set(dst, [])
                    self._advance_turn()
                    return {"event": "mine_swept", "captures": ["M"], "extra_turn": True}
                else:
                    self._set(src, [])
                    self._advance_turn()
                    return {"event": "mine_boom", "captures_self": [u.kind]}

            if v.kind == "SM":
                self._set(src, [])
                self._advance_turn()
                return {"event": "s_mine_boom", "captures_self": [u.kind]}

            if v.kind == "TN" or u.kind == "TN":
                self._set(dst, [])
                self._set(src, [])
                self._advance_turn()
                return {"event": "tanker_boom", "captures": [v.kind, u.kind]}

            atk = [u]
            defn = [v]

            for c, p in self._collect_group(src, u.owner, u.kind):
                if c != src and len(atk) < 3:
                    atk.append(p)

            for c, p in self._collect_group(dst, v.owner, v.kind):
                if c != dst and len(defn) < 3:
                    defn.append(p)

            cmp = self._compare(atk, defn)
            if cmp > 0:
                result["captures"].append(v.kind)
                self._set(dst, [u])
                self._set(src, [])
            elif cmp < 0:
                self._set(src, [])
                self._advance_turn()
                return {"event": "def_win", "captures_self": [u.kind]}
            else:
                self._set(src, [])
                self._set(dst, [])
                self._advance_turn()
                return {"event": "exchange", "exchange": True}
        else:
            self._set(dst, [u])
            self._set(src, [])

        # подвижка "прицепов" (носителей)
        if u.kind in CARRIER_OF and followers:
            for fx, fy, tx, ty in followers:
                fsrc = (fx, fy)
                fdst = (tx, ty)
                parr = self._get(fsrc)
                if (
                    parr
                    and parr[0].owner == actor
                    and parr[0].kind == CARRIER_OF[u.kind]
                ):
                    near_dst = abs(fdst[0] - dst[0]) + abs(fdst[1] - dst[1]) == 1
                    if near_dst and self._in_bounds(fdst) and (not self._get(fdst) or fdst == fsrc):
                        self._set(fdst, [parr[0]])
                        if fsrc != fdst:
                            self._set(fsrc, [])

        self._advance_turn()
        self._check_victory()
        return result

    def torpedo(self, actor: int, t_coord: Coord, tk_coord: Coord, direction: Tuple[int, int]) -> dict:
        if self.gd.phase not in ("TURN_P1", "TURN_P2"):
            raise ValueError("bad phase")
        if self.gd.turn != actor:
            raise ValueError("not your turn")

        t_arr = self._get(t_coord)
        tk_arr = self._get(tk_coord)
        if not t_arr or not tk_arr:
            raise ValueError("T/TK missing")

        t = t_arr[0]
        tk = tk_arr[0]
        if t.owner != actor or tk.owner != actor or t.kind != "T" or tk.kind != "TK":
            raise ValueError("ownership/type error")

        adjacent = (
            (t_coord[0] == tk_coord[0] and abs(t_coord[1] - tk_coord[1]) == 1) or
            (t_coord[1] == tk_coord[1] and abs(t_coord[0] - tk_coord[0]) == 1)
        )
        if not adjacent:
            raise ValueError("T must be adjacent to TK")

        dx, dy = direction
        back = (tk_coord[0] - t_coord[0], tk_coord[1] - t_coord[1])
        if (dx, dy) == back:
            raise ValueError("cannot shoot backward")

        x, y = t_coord
        res = {"event": "torpedo", "captures": []}

        while True:
            x += dx
            y += dy
            c = (x, y)
            if not self._in_bounds(c):
                break
            if self._get(c):
                self._kill(c, res)
                break

        self._set(t_coord, [])
        self._advance_turn()
        self._check_victory()
        return res

    def airstrike(self, actor: int, a_coord: Coord, s_coord: Coord) -> dict:
        if self.gd.phase not in ("TURN_P1", "TURN_P2"):
            raise ValueError("bad phase")
        if self.gd.turn != actor:
            raise ValueError("not your turn")

        a_arr = self._get(a_coord)
        s_arr = self._get(s_coord)
        if not a_arr or not s_arr:
            raise ValueError("A/S missing")

        a = a_arr[0]
        s = s_arr[0]
        if a.owner != actor or s.owner != actor or a.kind != "A" or s.kind != "S":
            raise ValueError("ownership/type error")

        dy = -1 if actor == 1 else 1
        in_front = (s_coord[0] == a_coord[0] and s_coord[1] == a_coord[1] + dy)
        if not in_front:
            raise ValueError("S must be in front of A")

        res = {"event": "air", "captures": []}
        x, y = s_coord

        for _ in range(5):
            y += dy
            if not self._in_bounds((x, y)):
                break
            if self._get((x, y)):
                self._kill((x, y), res)

        self._set(s_coord, [])
        self._advance_turn()
        self._check_victory()
        return res

    def bomb(self, actor: int, ab_coord: Coord) -> dict:
        arr = self._get(ab_coord)
        if not arr or arr[0].owner != actor or arr[0].kind != "AB":
            raise ValueError("not your AB")

        res = {"event": "ab_explode", "captures": []}
        self._ab_explode(ab_coord, res)
        self._advance_turn()
        self._check_victory()
        return res