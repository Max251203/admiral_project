from dataclasses import dataclass, field, asdict
from typing import Dict, Tuple, List, Optional, Set
from .rules import *

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
    board: Dict[Coord, Piece] = field(default_factory=dict)
    winner: Optional[int] = None
    win_reason: str = ""
    setup_counts: Dict[int, Dict[str, int]] = field(default_factory=lambda: {1: {}, 2: {}})
    last_move: Optional[Dict] = None

class Engine:
    def __init__(self, data: dict = None):
        if data:
            board = {}
            for k, v in data.get("board", {}).items():
                if isinstance(k, str) and "," in k:
                    x, y = map(int, k.split(","))
                    board[(x, y)] = Piece(**v) if isinstance(v, dict) else Piece(owner=v.get("owner", 1), kind=v.get("kind", "ST"))
                
            self.gd = GameData(
                turn=data.get("turn", 1),
                phase=data.get("phase", "SETUP"),
                board=board,
                winner=data.get("winner"),
                win_reason=data.get("win_reason", ""),
                setup_counts=data.get("setup_counts", {1: {}, 2: {}}),
                last_move=data.get("last_move")
            )
        else:
            self.gd = GameData()

    def to_json(self) -> dict:
        return {
            "turn": self.gd.turn,
            "phase": self.gd.phase,
            "winner": self.gd.winner,
            "win_reason": self.gd.win_reason,
            "setup_counts": self.gd.setup_counts,
            "last_move": self.gd.last_move,
            "board": {
                f"{x},{y}": asdict(piece) for (x, y), piece in self.gd.board.items()
            }
        }

    def _in_bounds(self, coord: Coord) -> bool:
        x, y = coord
        return 0 <= x < BOARD_W and 0 <= y < BOARD_H

    def _get_piece(self, coord: Coord) -> Optional[Piece]:
        return self.gd.board.get(coord)

    def _set_piece(self, coord: Coord, piece: Optional[Piece]):
        if piece:
            self.gd.board[coord] = piece
        elif coord in self.gd.board:
            del self.gd.board[coord]

    def _is_valid_setup_zone(self, coord: Coord, owner: int) -> bool:
        _, y = coord
        if owner == 1:
            return 10 <= y <= 14
        else:
            return 0 <= y <= 4

    def _get_adjacent_coords(self, coord: Coord) -> List[Coord]:
        x, y = coord
        return [(x+1, y), (x-1, y), (x, y+1), (x, y-1)]

    def _find_group(self, coord: Coord, ship_type: str, owner: int) -> List[Coord]:
        visited = set()
        group = []
        stack = [coord]
        
        while stack and len(group) < 3:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            
            piece = self._get_piece(current)
            if piece and piece.owner == owner and piece.kind == ship_type and piece.alive:
                group.append(current)
                for adj in self._get_adjacent_coords(current):
                    if adj not in visited:
                        stack.append(adj)
        
        return group[:3]

    def _calculate_group_strength(self, coords: List[Coord]) -> int:
        total = 0
        for coord in coords:
            piece = self._get_piece(coord)
            if piece and piece.alive:
                total += get_ship_rank(piece.kind)
        return total

    def _resolve_combat(self, attacker_coords: List[Coord], defender_coords: List[Coord]) -> str:
        if not attacker_coords or not defender_coords:
            return "invalid"
        
        attacker_piece = self._get_piece(attacker_coords[0])
        defender_piece = self._get_piece(defender_coords[0])
        
        if not attacker_piece or not defender_piece:
            return "invalid"

        if len(attacker_coords) == 1 and len(defender_coords) == 1:
            if is_special_kill(attacker_piece.kind, defender_piece.kind):
                return "attacker_wins"
            if is_special_kill(defender_piece.kind, attacker_piece.kind):
                return "mutual_destruction"

        attacker_strength = self._calculate_group_strength(attacker_coords)
        defender_strength = self._calculate_group_strength(defender_coords)

        if attacker_strength > defender_strength:
            return "attacker_wins"
        elif defender_strength > attacker_strength:
            return "defender_wins"
        else:
            return "draw"

    def _remove_pieces(self, coords: List[Coord]) -> List[str]:
        removed = []
        for coord in coords:
            piece = self._get_piece(coord)
            if piece:
                removed.append(piece.kind)
                self._set_piece(coord, None)
        return removed

    def _explode_ab(self, center: Coord) -> List[str]:
        destroyed = []
        cx, cy = center
        
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                coord = (cx + dx, cy + dy)
                if self._in_bounds(coord):
                    piece = self._get_piece(coord)
                    if piece:
                        destroyed.append(piece.kind)
                        if piece.kind == "AB" and coord != center:
                            destroyed.extend(self._explode_ab(coord))
                        self._set_piece(coord, None)
        
        return destroyed

    def _check_victory_conditions(self):
        vmb_count = {1: 0, 2: 0}
        mobile_count = {1: 0, 2: 0}
        
        for piece in self.gd.board.values():
            if piece.alive:
                if piece.kind == "VMB":
                    vmb_count[piece.owner] += 1
                elif not is_immobile(piece.kind):
                    mobile_count[piece.owner] += 1
        
        for player in [1, 2]:
            opponent = 3 - player
            if vmb_count[opponent] < 2:
                self.gd.winner = player
                self.gd.win_reason = "bases_destroyed"
                self.gd.phase = "FINISHED"
                return
            if mobile_count[opponent] == 0:
                self.gd.winner = player
                self.gd.win_reason = "no_mobile_pieces"
                self.gd.phase = "FINISHED"
                return

    def _advance_turn(self):
        self.gd.turn = 3 - self.gd.turn
        if self.gd.phase in ("TURN_P1", "TURN_P2"):
            self.gd.phase = f"TURN_P{self.gd.turn}"

    def place_ship(self, owner: int, coord: Coord, ship_type: str):
        if self.gd.phase != "SETUP":
            raise ValueError("Not in setup phase")
        
        if not self._in_bounds(coord):
            raise ValueError("Coordinate out of bounds")
        
        if not self._is_valid_setup_zone(coord, owner):
            raise ValueError("Invalid setup zone")
        
        if self._get_piece(coord):
            raise ValueError("Cell already occupied")
        
        if owner not in self.gd.setup_counts:
            self.gd.setup_counts[owner] = {}
        
        current_count = self.gd.setup_counts[owner].get(ship_type, 0)
        max_count = SHIP_TYPES.get(ship_type, {}).get("count", 0)
        
        if current_count >= max_count:
            raise ValueError(f"Maximum {ship_type} ships already placed")
        
        self._set_piece(coord, Piece(owner=owner, kind=ship_type))
        self.gd.setup_counts[owner][ship_type] = current_count + 1

    def move_piece(self, owner: int, src: Coord, dst: Coord, followers: List[Tuple[Coord, Coord]] = None) -> dict:
        if self.gd.phase not in ("TURN_P1", "TURN_P2"):
            raise ValueError("Not in game phase")
        
        if self.gd.turn != owner:
            raise ValueError("Not your turn")
        
        if not self._in_bounds(src) or not self._in_bounds(dst):
            raise ValueError("Coordinates out of bounds")
        
        piece = self._get_piece(src)
        if not piece or piece.owner != owner or not piece.alive:
            raise ValueError("Invalid piece to move")
        
        if is_immobile(piece.kind):
            raise ValueError("Piece cannot move")
        
        dx, dy = dst[0] - src[0], dst[1] - src[1]
        distance = abs(dx) + abs(dy)
        
        if piece.kind == "TK":
            if distance not in [1, 2] or (distance == 2 and dx != 0 and dy != 0):
                raise ValueError("Invalid TK movement")
        else:
            if distance != 1:
                raise ValueError("Invalid movement distance")
        
        result = {"event": "move", "captures": [], "destroyed_own": []}
        target_piece = self._get_piece(dst)
        
        if target_piece:
            if target_piece.owner == owner:
                raise ValueError("Cannot move to occupied friendly cell")
            
            result.update(self._handle_combat(src, dst))
        else:
            self._set_piece(dst, piece)
            self._set_piece(src, None)
            
            if followers:
                self._move_followers(dst, followers, owner)
        
        self._check_victory_conditions()
        if self.gd.winner is None:
            self._advance_turn()
        
        self.gd.last_move = {"type": "move", "src": src, "dst": dst, "result": result}
        return result

    def _handle_combat(self, attacker_coord: Coord, defender_coord: Coord) -> dict:
        attacker_piece = self._get_piece(attacker_coord)
        defender_piece = self._get_piece(defender_coord)
        
        result = {"event": "combat", "captures": [], "destroyed_own": []}
        
        if attacker_piece.kind == "AB" or defender_piece.kind == "AB":
            explosion_center = defender_coord if defender_piece.kind == "AB" else attacker_coord
            destroyed = self._explode_ab(explosion_center)
            result["event"] = "explosion"
            result["captures"] = destroyed
            return result
        
        if defender_piece.kind == "TN" or attacker_piece.kind == "TN":
            result["event"] = "tanker_explosion"
            result["captures"] = [defender_piece.kind]
            result["destroyed_own"] = [attacker_piece.kind]
            self._set_piece(attacker_coord, None)
            self._set_piece(defender_coord, None)
            return result
        
        if defender_piece.kind == "M":
            if attacker_piece.kind == "TR":
                result["event"] = "mine_cleared"
                result["captures"] = [defender_piece.kind]
                self._set_piece(defender_coord, None)
                return result
            else:
                result["event"] = "mine_explosion"
                result["destroyed_own"] = [attacker_piece.kind]
                self._set_piece(attacker_coord, None)
                return result
        
        if defender_piece.kind == "SM":
            result["event"] = "static_mine_explosion"
            result["destroyed_own"] = [attacker_piece.kind]
            self._set_piece(attacker_coord, None)
            return result
        
        attacker_group = self._find_group(attacker_coord, attacker_piece.kind, attacker_piece.owner)
        defender_group = self._find_group(defender_coord, defender_piece.kind, defender_piece.owner)
        
        combat_result = self._resolve_combat(attacker_group, defender_group)
        
        if combat_result == "attacker_wins":
            result["captures"] = self._remove_pieces(defender_group)
            self._set_piece(defender_coord, attacker_piece)
            self._set_piece(attacker_coord, None)
        elif combat_result == "defender_wins":
            result["destroyed_own"] = self._remove_pieces(attacker_group)
        elif combat_result == "draw":
            result["event"] = "draw"
            result["captures"] = self._remove_pieces(defender_group)
            result["destroyed_own"] = self._remove_pieces(attacker_group)
        elif combat_result == "mutual_destruction":
            result["event"] = "mutual_destruction"
            result["captures"] = [defender_piece.kind]
            result["destroyed_own"] = [attacker_piece.kind]
            self._set_piece(attacker_coord, None)
            self._set_piece(defender_coord, None)
        
        return result

    def _move_followers(self, leader_pos: Coord, followers: List[Tuple[Coord, Coord]], owner: int):
        for src, dst in followers:
            if not self._in_bounds(src) or not self._in_bounds(dst):
                continue
            
            piece = self._get_piece(src)
            if not piece or piece.owner != owner:
                continue
            
            distance_to_leader = abs(dst[0] - leader_pos[0]) + abs(dst[1] - leader_pos[1])
            if distance_to_leader != 1:
                continue
            
            if not self._get_piece(dst):
                self._set_piece(dst, piece)
                self._set_piece(src, None)

    def torpedo_attack(self, owner: int, torpedo_coord: Coord, tk_coord: Coord, direction: Coord) -> dict:
        if self.gd.phase not in ("TURN_P1", "TURN_P2"):
            raise ValueError("Not in game phase")
        
        if self.gd.turn != owner:
            raise ValueError("Not your turn")
        
        torpedo = self._get_piece(torpedo_coord)
        tk = self._get_piece(tk_coord)
        
        if not torpedo or not tk or torpedo.owner != owner or tk.owner != owner:
            raise ValueError("Invalid torpedo or TK")
        
        if torpedo.kind != "T" or tk.kind != "TK":
            raise ValueError("Wrong piece types")
        
        distance = abs(torpedo_coord[0] - tk_coord[0]) + abs(torpedo_coord[1] - tk_coord[1])
        if distance != 1:
            raise ValueError("Torpedo must be adjacent to TK")
        
        dx, dy = direction
        if abs(dx) + abs(dy) != 1:
            raise ValueError("Invalid direction")
        
        back_direction = (tk_coord[0] - torpedo_coord[0], tk_coord[1] - torpedo_coord[1])
        if (dx, dy) == back_direction:
            raise ValueError("Cannot shoot backwards")
        
        result = {"event": "torpedo_attack", "captures": []}
        
        x, y = torpedo_coord
        while True:
            x += dx
            y += dy
            coord = (x, y)
            
            if not self._in_bounds(coord):
                break
            
            piece = self._get_piece(coord)
            if piece:
                result["captures"].append(piece.kind)
                self._set_piece(coord, None)
                break
        
        self._set_piece(torpedo_coord, None)
        
        self._check_victory_conditions()
        if self.gd.winner is None:
            self._advance_turn()
        
        self.gd.last_move = {"type": "torpedo", "torpedo": torpedo_coord, "tk": tk_coord, "direction": direction, "result": result}
        return result

    def air_attack(self, owner: int, carrier_coord: Coord, plane_coord: Coord) -> dict:
        if self.gd.phase not in ("TURN_P1", "TURN_P2"):
            raise ValueError("Not in game phase")
        
        if self.gd.turn != owner:
            raise ValueError("Not your turn")
        
        carrier = self._get_piece(carrier_coord)
        plane = self._get_piece(plane_coord)
        
        if not carrier or not plane or carrier.owner != owner or plane.owner != owner:
            raise ValueError("Invalid carrier or plane")
        
        if carrier.kind != "A" or plane.kind != "S":
            raise ValueError("Wrong piece types")
        
        direction = 1 if owner == 2 else -1
        expected_plane_pos = (carrier_coord[0], carrier_coord[1] + direction)
        
        if plane_coord != expected_plane_pos:
            raise ValueError("Plane must be in front of carrier")
        
        result = {"event": "air_attack", "captures": []}
        
        x, y = plane_coord
        for _ in range(5):
            y += direction
            coord = (x, y)
            
            if not self._in_bounds(coord):
                break
            
            piece = self._get_piece(coord)
            if piece:
                result["captures"].append(piece.kind)
                self._set_piece(coord, None)
        
        self._set_piece(plane_coord, None)
        
        self._check_victory_conditions()
        if self.gd.winner is None:
            self._advance_turn()
        
        self.gd.last_move = {"type": "air_attack", "carrier": carrier_coord, "plane": plane_coord, "result": result}
        return result

    def detonate_bomb(self, owner: int, bomb_coord: Coord) -> dict:
        if self.gd.phase not in ("TURN_P1", "TURN_P2"):
            raise ValueError("Not in game phase")
        
        if self.gd.turn != owner:
            raise ValueError("Not your turn")
        
        bomb = self._get_piece(bomb_coord)
        if not bomb or bomb.owner != owner or bomb.kind != "AB":
            raise ValueError("Invalid atomic bomb")
        
        result = {"event": "atomic_explosion", "captures": []}
        destroyed = self._explode_ab(bomb_coord)
        result["captures"] = destroyed
        
        self._check_victory_conditions()
        if self.gd.winner is None:
            self._advance_turn()
        
        self.gd.last_move = {"type": "atomic_bomb", "bomb": bomb_coord, "result": result}
        return result

    def auto_setup(self, owner: int) -> int:
        import random
        
        if self.gd.phase != "SETUP":
            raise ValueError("Not in setup phase")
        
        for coord in list(self.gd.board.keys()):
            piece = self.gd.board[coord]
            if piece.owner == owner:
                del self.gd.board[coord]
        
        if owner not in self.gd.setup_counts:
            self.gd.setup_counts[owner] = {}
        self.gd.setup_counts[owner] = {}
        
        rows = list(range(10, 15)) if owner == 1 else list(range(0, 5))
        cols = list(range(0, 14))
        available_cells = [(x, y) for y in rows for x in cols]
        random.shuffle(available_cells)
        
        placed_count = 0
        
        for ship_type, ship_data in SHIP_TYPES.items():
            count = ship_data["count"]
            for _ in range(count):
                if available_cells:
                    coord = available_cells.pop()
                    try:
                        self.place_ship(owner, coord, ship_type)
                        placed_count += 1
                    except ValueError:
                        continue
        
        return placed_count

    def clear_setup(self, owner: int):
        if self.gd.phase != "SETUP":
            raise ValueError("Not in setup phase")
        
        coords_to_remove = []
        for coord, piece in self.gd.board.items():
            if piece.owner == owner:
                coords_to_remove.append(coord)
        
        for coord in coords_to_remove:
            del self.gd.board[coord]
        
        if owner in self.gd.setup_counts:
            self.gd.setup_counts[owner] = {}