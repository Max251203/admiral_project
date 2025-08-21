from dataclasses import dataclass, field, asdict
from typing import Dict, Tuple, List, Optional, Set
from .rules import *
import random

Coord = Tuple[int, int]

@dataclass
class Piece:
    owner: int
    kind: str
    alive: bool = True
    visible_to: Set[int] = field(default_factory=set)

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
                    visible_to = set(v.get("visible_to", []))
                    board[(x, y)] = Piece(
                        owner=v.get("owner", 1), 
                        kind=v.get("kind", "ST"),
                        alive=v.get("alive", True),
                        visible_to=visible_to
                    )
                
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
        board_data = {}
        for (x, y), piece in self.gd.board.items():
            board_data[f"{x},{y}"] = {
                "owner": piece.owner,
                "kind": piece.kind,
                "alive": piece.alive,
                "visible_to": list(piece.visible_to)
            }
        
        return {
            "turn": self.gd.turn,
            "phase": self.gd.phase,
            "winner": self.gd.winner,
            "win_reason": self.gd.win_reason,
            "setup_counts": self.gd.setup_counts,
            "last_move": self.gd.last_move,
            "board": board_data
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
        """Находит группу из одинаковых фишек, стоящих рядом"""
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
                # Добавляем соседние клетки для поиска
                for adj in self._get_adjacent_coords(current):
                    if adj not in visited and self._in_bounds(adj):
                        stack.append(adj)
        
        return group[:3]  # Максимум 3 фишки в группе

    def _calculate_group_strength(self, coords: List[Coord]) -> int:
        """Вычисляет общую силу группы"""
        total = 0
        for  coord in coords:
            piece = self._get_piece(coord)
            if piece and piece.alive:
                total += get_ship_rank(piece.kind)
        return total

    def _resolve_combat(self, attacker_coords: List[Coord], defender_coords: List[Coord]) -> str:
        """Разрешает бой между группами согласно правилам"""
        if not attacker_coords or not defender_coords:
            return "invalid"
        
        attacker_piece = self._get_piece(attacker_coords[0])
        defender_piece = self._get_piece(defender_coords[0])
        
        if not attacker_piece or not defender_piece:
            return "invalid"

        # Специальные правила уничтожения (ПЛ vs БДК/А, КРПЛ vs КР)
        if len(attacker_coords) == 1 and len(defender_coords) == 1:
            if is_special_kill(attacker_piece.kind, defender_piece.kind):
                return "attacker_wins"
            if is_special_kill(defender_piece.kind, attacker_piece.kind):
                return "defender_wins"

        # Сравнение сил групп
        attacker_strength = self._calculate_group_strength(attacker_coords)
        defender_strength = self._calculate_group_strength(defender_coords)

        if attacker_strength > defender_strength:
            return "attacker_wins"
        elif defender_strength > attacker_strength:
            return "defender_wins"
        else:
            return "draw"

    def _remove_pieces(self, coords: List[Coord]) -> List[str]:
        """Удаляет фишки с поля и возвращает их типы"""
        removed = []
        for coord in coords:
            piece = self._get_piece(coord)
            if piece:
                removed.append(piece.kind)
                self._set_piece(coord, None)
        return removed

    def _explode_ab(self, center: Coord) -> List[str]:
        """Взрыв атомной бомбы в радиусе 5x5"""
        destroyed = []
        cx, cy = center
        
        # Взрыв 5x5 вокруг центра
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                coord = (cx + dx, cy + dy)
                if self._in_bounds(coord):
                    piece = self._get_piece(coord)
                    if piece:
                        destroyed.append(piece.kind)
                        # Цепная реакция АБ
                        if piece.kind == "AB" and coord != center:
                            destroyed.extend(self._explode_ab(coord))
                        self._set_piece(coord, None)
        
        return destroyed

    def _check_victory_conditions(self):
        """Проверяет условия победы"""
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
            # Победа при уничтожении 2 ВМБ
            if vmb_count[opponent] < 2:
                self.gd.winner = player
                self.gd.win_reason = "bases_destroyed"
                self.gd.phase = "FINISHED"
                return
            # Победа при уничтожении всех подвижных фишек
            if mobile_count[opponent] == 0:
                self.gd.winner = player
                self.gd.win_reason = "no_mobile_pieces"
                self.gd.phase = "FINISHED"
                return

    def _advance_turn(self):
        """Переход хода к следующему игроку"""
        self.gd.turn = 3 - self.gd.turn
        if self.gd.phase in ("TURN_P1", "TURN_P2"):
            self.gd.phase = f"TURN_P{self.gd.turn}"

    def _make_pieces_visible(self, coords: List[Coord], to_player: int):
        """Делает фишки видимыми для указанного игрока"""
        for coord in coords:
            piece = self._get_piece(coord)
            if piece:
                piece.visible_to.add(to_player)

    def _move_carried_pieces(self, carrier_coord: Coord, new_carrier_coord: Coord, carried_type: str, owner: int):
        """Перемещает переносимые фишки вслед за носителем"""
        carried_pieces = []
        for adj_coord in self._get_adjacent_coords(carrier_coord):
            piece = self._get_piece(adj_coord)
            if piece and piece.owner == owner and piece.kind == carried_type:
                carried_pieces.append(adj_coord)
        
        # Размещаем переносимые фишки вокруг новой позиции носителя
        new_positions = self._get_adjacent_coords(new_carrier_coord)
        for i, old_coord in enumerate(carried_pieces):
            if i < len(new_positions):
                new_coord = new_positions[i]
                if not self._get_piece(new_coord) and self._in_bounds(new_coord):
                    piece = self._get_piece(old_coord)
                    self._set_piece(old_coord, None)
                    self._set_piece(new_coord, piece)

    def place_ship(self, owner: int, coord: Coord, ship_type: str):
        """Размещение фишки в фазе расстановки"""
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
        
        piece = Piece(owner=owner, kind=ship_type)
        piece.visible_to.add(owner)  # Игрок видит свои фишки
        self._set_piece(coord, piece)
        self.gd.setup_counts[owner][ship_type] = current_count + 1

    def move_piece(self, owner: int, src: Coord, dst: Coord, followers: List[Tuple[Coord, Coord]] = None) -> dict:
        """Основная функция хода с полной логикой атак и групп"""
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
        
        # Проверка дистанции движения
        dx, dy = dst[0] - src[0], dst[1] - src[1]
        distance = abs(dx) + abs(dy)
        
        if piece.kind == "TK":
            # ТК может ходить на 1-2 клетки прямо
            if distance not in [1, 2] or (distance == 2 and dx != 0 and dy != 0):
                raise ValueError("Invalid TK movement")
        else:
            # Остальные фишки ходят на 1 клетку
            if distance != 1:
                raise ValueError("Invalid movement distance")
        
        result = {"event": "move", "captures": [], "destroyed_own": []}
        target_piece = self._get_piece(dst)
        
        if target_piece:
            if target_piece.owner == owner:
                raise ValueError("Cannot move to occupied friendly cell")
            
            # СТОЛКНОВЕНИЕ - НАЧИНАЕТСЯ АТАКА
            # Делаем фишки видимыми друг для друга
            self._make_pieces_visible([src], 3 - owner)
            self._make_pieces_visible([dst], owner)
            
            result.update(self._handle_combat(src, dst))
        else:
            # Обычное перемещение без столкновения
            self._set_piece(dst, piece)
            self._set_piece(src, None)
            
            # Перемещение переносимых фишек
            carried_type = can_carry(piece.kind)
            if carried_type:
                self._move_carried_pieces(src, dst, carried_type, owner)
            
            # Обработка followers (для групп)
            if followers:
                self._move_followers(dst, followers, owner)
        
        # Проверяем условия победы
        self._check_victory_conditions()
        
        # Переходим к следующему ходу если игра не закончена
        if self.gd.winner is None:
            self._advance_turn()
        
        self.gd.last_move = {"type": "move", "src": src, "dst": dst, "result": result}
        return result

    def _handle_combat(self, attacker_coord: Coord, defender_coord: Coord) -> dict:
        """Обработка всех видов боя согласно правилам"""
        attacker_piece = self._get_piece(attacker_coord)
        defender_piece = self._get_piece(defender_coord)
        
        result = {"event": "combat", "captures": [], "destroyed_own": []}
        
        # ВЗРЫВЧАТЫЕ ВЕЩЕСТВА
        
        # Атомная бомба - взрывается при любом контакте
        if attacker_piece.kind == "AB" or defender_piece.kind == "AB":
            explosion_center = defender_coord if defender_piece.kind == "AB" else attacker_coord
            destroyed = self._explode_ab(explosion_center)
            result["event"] = "atomic_explosion"
            result["captures"] = destroyed
            return result
        
        # Танкер - взрывается при любом контакте
        if defender_piece.kind == "TN" or attacker_piece.kind == "TN":
            result["event"] = "tanker_explosion"
            result["captures"] = [defender_piece.kind]
            result["destroyed_own"] = [attacker_piece.kind]
            self._set_piece(attacker_coord, None)
            self._set_piece(defender_coord, None)
            return result
        
        # Мина - взрывается при атаке (кроме тральщика)
        if defender_piece.kind == "M":
            if attacker_piece.kind == "TR":
                # Тральщик обезвреживает мину
                result["event"] = "mine_cleared"
                result["captures"] = [defender_piece.kind]
                self._set_piece(defender_coord, attacker_piece)
                self._set_piece(attacker_coord, None)
                return result
            else:
                # Мина взрывается, уничтожая атакующего
                result["event"] = "mine_explosion"
                result["destroyed_own"] = [attacker_piece.kind]
                self._set_piece(attacker_coord, None)
                return result
        
        # Стационарная мина - уничтожает любого атакующего
        if defender_piece.kind == "SM":
            result["event"] = "static_mine_explosion"
            result["destroyed_own"] = [attacker_piece.kind]
            self._set_piece(attacker_coord, None)
            return result
        
        # ОБЫЧНЫЙ БОЙ МЕЖДУ ГРУППАМИ
        
        # Находим группы атакующего и защищающегося
        attacker_group = self._find_group(attacker_coord, attacker_piece.kind, attacker_piece.owner)
        defender_group = self._find_group(defender_coord, defender_piece.kind, defender_piece.owner)
        
        # Делаем все фишки в группах видимыми для противников
        self._make_pieces_visible(attacker_group, 3 - attacker_piece.owner)
        self._make_pieces_visible(defender_group, attacker_piece.owner)
        
        # Разрешаем бой
        combat_result = self._resolve_combat(attacker_group, defender_group)
        
        if combat_result == "attacker_wins":
            # Атакующий побеждает
            result["captures"] = self._remove_pieces(defender_group)
            # Перемещаем атакующую фишку на место защищающегося
            self._set_piece(defender_coord, attacker_piece)
            self._set_piece(attacker_coord, None)
            
        elif combat_result == "defender_wins":
            # Защищающийся побеждает
            result["destroyed_own"] = self._remove_pieces(attacker_group)
            
        elif combat_result == "draw":
            # Ничья - обе группы уничтожаются
            result["event"] = "draw"
            result["captures"] = self._remove_pieces(defender_group)
            result["destroyed_own"] = self._remove_pieces(attacker_group)
        
        return result

    def _move_followers(self, leader_pos: Coord, followers: List[Tuple[Coord, Coord]], owner: int):
        """Перемещение фишек-последователей в группе"""
        for src, dst in followers:
            if not self._in_bounds(src) or not self._in_bounds(dst):
                continue
            
            piece = self._get_piece(src)
            if not piece or piece.owner != owner:
                continue
            
            # Проверяем, что новая позиция рядом с лидером
            distance_to_leader = abs(dst[0] - leader_pos[0]) + abs(dst[1] - leader_pos[1])
            if distance_to_leader != 1:
                continue
            
            # Перемещаем если клетка свободна
            if not self._get_piece(dst):
                self._set_piece(dst, piece)
                self._set_piece(src, None)

    def torpedo_attack(self, owner: int, torpedo_coord: Coord, tk_coord: Coord, direction: Coord) -> dict:
        """Торпедная атака"""
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
        
        # Торпеда должна быть рядом с ТК
        distance = abs(torpedo_coord[0] - tk_coord[0]) + abs(torpedo_coord[1] - tk_coord[1])
        if distance != 1:
            raise ValueError("Torpedo must be adjacent to TK")
        
        dx, dy = direction
        if abs(dx) + abs(dy) != 1:
            raise ValueError("Invalid direction")
        
        # Нельзя стрелять назад (в сторону ТК)
        back_direction = (tk_coord[0] - torpedo_coord[0], tk_coord[1] - torpedo_coord[1])
        if (dx, dy) == back_direction:
            raise ValueError("Cannot shoot backwards")
        
        result = {"event": "torpedo_attack", "captures": []}
        
        # Стреляем до первого препятствия (максимум 7 клеток)
        x, y = torpedo_coord
        for _ in range(7):
            x += dx
            y += dy
            coord = (x, y)
            
            if not self._in_bounds(coord):
                break
            
            piece = self._get_piece(coord)
            if piece:
                # Попадание - делаем цель видимой и уничтожаем
                self._make_pieces_visible([coord], owner)
                result["captures"].append(piece.kind)
                self._set_piece(coord, None)
                break
        
        # Торпеда расходуется
        self._set_piece(torpedo_coord, None)
        
        self._check_victory_conditions()
        if self.gd.winner is None:
            self._advance_turn()
        
        self.gd.last_move = {"type": "torpedo", "torpedo": torpedo_coord, "tk": tk_coord, "direction": direction, "result": result}
        return result

    def air_attack(self, owner: int, carrier_coord: Coord, plane_coord: Coord) -> dict:
        """Воздушная атака"""
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
        
        # Самолет должен быть впереди авианосца
        direction = 1 if owner == 2 else -1  # Игрок 2 атакует вверх, игрок 1 - вниз
        expected_plane_pos = (carrier_coord[0], carrier_coord[1] + direction)
        
        if plane_coord != expected_plane_pos:
            raise ValueError("Plane must be in front of carrier")
        
        result = {"event": "air_attack", "captures": []}
        
        # Атакуем 5 клеток вперед от самолета
        x, y = plane_coord
        for _ in range(5):
            y += direction
            coord = (x, y)
            
            if not self._in_bounds(coord):
                break
            
            piece = self._get_piece(coord)
            if piece:
                # Уничтожаем все на пути (включая свои фишки)
                self._make_pieces_visible([coord], owner)
                result["captures"].append(piece.kind)
                self._set_piece(coord, None)
        
        # Самолет расходуется
        self._set_piece(plane_coord, None)
        
        self._check_victory_conditions()
        if self.gd.winner is None:
            self._advance_turn()
        
        self.gd.last_move = {"type": "air_attack", "carrier": carrier_coord, "plane": plane_coord, "result": result}
        return result

    def detonate_bomb(self, owner: int, bomb_coord: Coord) -> dict:
        """Подрыв атомной бомбы"""
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
        """Автоматическая расстановка флота"""
        if self.gd.phase != "SETUP":
            raise ValueError("Not in setup phase")
        
        # Очищаем старую расстановку
        coords_to_remove = []
        for coord, piece in self.gd.board.items():
            if piece.owner == owner:
                coords_to_remove.append(coord)
        
        for coord in coords_to_remove:
            del self.gd.board[coord]
        
        if owner not in self.gd.setup_counts:
            self.gd.setup_counts[owner] = {}
        self.gd.setup_counts[owner] = {}
        
        # Определяем зону расстановки
        rows = list(range(10, 15)) if owner == 1 else list(range(0, 5))
        cols = list(range(0, 14))
        
        placed_count = 0
        used_positions = set()
        
        def place_ship_at(x, y, ship_type):
            nonlocal placed_count
            if (x, y) not in used_positions and 0 <= x < 14 and y in rows:
                try:
                    self.place_ship(owner, (x, y), ship_type)
                    used_positions.add((x, y))
                    placed_count += 1
                    return True
                except ValueError:
                    pass
            return False
        
        # 1. Размещаем ВМБ в углах
        vmb_positions = [(0, rows[0]), (13, rows[0]), (0, rows[-1]), (13, rows[-1])]
        for i, pos in enumerate(vmb_positions[:2]):
            place_ship_at(pos[0], pos[1], "VMB")
        
        # 2. Размещаем АБ и СМ в защищенных позициях
        protected_positions = [(6, rows[1]), (7, rows[1])]
        place_ship_at(protected_positions[0][0], protected_positions[0][1], "AB")
        place_ship_at(protected_positions[1][0], protected_positions[1][1], "SM")
        
        # 3. Размещаем носители с переносимыми фишками
        # ЭС + М
        es_positions = [(2, rows[2]), (4, rows[2]), (6, rows[2]), (8, rows[2]), (10, rows[2]), (12, rows[2])]
        for i, pos in enumerate(es_positions):
            if place_ship_at(pos[0], pos[1], "ES"):
                # Размещаем мину рядом
                for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
                    if place_ship_at(pos[0] + dx, pos[1] + dy, "M"):
                        break
        
        # ТК + Т
        tk_positions = [(1, rows[3]), (3, rows[3]), (5, rows[3]), (7, rows[3]), (9, rows[3]), (11, rows[3])]
        for i, pos in enumerate(tk_positions):
            if place_ship_at(pos[0], pos[1], "TK"):
                # Размещаем торпеду рядом
                for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
                    if place_ship_at(pos[0] + dx, pos[1] + dy, "T"):
                        break
        
        # А + С
        a_pos = (6, rows[3])
        if place_ship_at(a_pos[0], a_pos[1], "A"):
            # Самолет впереди авианосца
            s_y = a_pos[1] + (1 if owner == 2 else -1)
            if s_y in rows:
                place_ship_at(a_pos[0], s_y, "S")
        
        # 4. Размещаем остальные фишки случайно
        remaining_ships = []
        for ship_type, data in SHIP_TYPES.items():
            if ship_type not in ["VMB", "AB", "SM", "ES", "M", "TK", "T", "A", "S"]:
                for _ in range(data["count"]):
                    remaining_ships.append(ship_type)
        
        random.shuffle(remaining_ships)
        available_positions = [(x, y) for x in cols for y in rows if (x, y) not in used_positions]
        random.shuffle(available_positions)
        
        for ship_type in remaining_ships:
            for pos in available_positions:
                if place_ship_at(pos[0], pos[1], ship_type):
                    available_positions.remove(pos)
                    break
        
        return placed_count

    def clear_setup(self, owner: int):
        """Очистка расстановки"""
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

    def get_visible_board_for_player(self, player: int) -> dict:
        """Возвращает доску с фишками, видимыми для указанного игрока"""
        visible_board = {}
        for coord, piece in self.gd.board.items():
            if player in piece.visible_to:
                coord_str = f"{coord[0]},{coord[1]}"
                visible_board[coord_str] = {
                    "owner": piece.owner,
                    "kind": piece.kind,
                    "alive": piece.alive
                }
        return visible_board

    def get_group_candidates(self, coord: Coord, owner: int) -> List[Coord]:
        """Возвращает список координат фишек, которые могут быть добавлены в группу"""
        piece = self._get_piece(coord)
        if not piece or piece.owner != owner:
            return []
        
        candidates = []
        visited = set([coord])
        
        # Ищем соседние фишки того же типа
        for adj_coord in self._get_adjacent_coords(coord):
            if adj_coord in visited or not self._in_bounds(adj_coord):
                continue
                
            adj_piece = self._get_piece(adj_coord)
            if (adj_piece and adj_piece.owner == owner and 
                adj_piece.kind == piece.kind and adj_piece.alive):
                candidates.append(adj_coord)
                visited.add(adj_coord)
                
                # Ищем фишки рядом с найденными (для группы из 3)
                if len(candidates) < 2:
                    for adj2_coord in self._get_adjacent_coords(adj_coord):
                        if (adj2_coord in visited or not self._in_bounds(adj2_coord) or 
                            len(candidates) >= 2):
                            continue
                            
                        adj2_piece = self._get_piece(adj2_coord)
                        if (adj2_piece and adj2_piece.owner == owner and 
                            adj2_piece.kind == piece.kind and adj2_piece.alive):
                            candidates.append(adj2_coord)
                            visited.add(adj2_coord)
        
        return candidates[:2]  # Максимум 2 дополнительные фишки

    def get_special_attack_options(self, owner: int) -> dict:
        """Возвращает доступные специальные атаки"""
        options = {
            "torpedo": [],
            "air": []
        }
        
        for coord, piece in self.gd.board.items():
            if piece.owner != owner or not piece.alive:
                continue
            
            # Торпедная атака
            if piece.kind == "TK":
                for adj_coord in self._get_adjacent_coords(coord):
                    adj_piece = self._get_piece(adj_coord)
                    if (adj_piece and adj_piece.owner == owner and 
                        adj_piece.kind == "T" and adj_piece.alive):
                        # Определяем возможные направления стрельбы
                        directions = []
                        for dx, dy in [(1,0), (-1,0), (0,1), (0,-1)]:
                            # Проверяем, что направление не назад от торпеды к ТК
                            torpedo_to_tk = (coord[0] - adj_coord[0], coord[1] - adj_coord[1])
                            if (dx, dy) != torpedo_to_tk:
                                directions.append((dx, dy))
                        
                        options["torpedo"].append({
                            "tk": coord,
                            "torpedo": adj_coord,
                            "directions": directions
                        })
            
            # Воздушная атака
            elif piece.kind == "A":
                direction = 1 if owner == 2 else -1
                plane_coord = (coord[0], coord[1] + direction)
                plane_piece = self._get_piece(plane_coord)
                if (plane_piece and plane_piece.owner == owner and 
                    plane_piece.kind == "S" and plane_piece.alive):
                    options["air"].append({
                        "carrier": coord,
                        "plane": plane_coord,
                        "direction": direction
                    })
        
        return options

    def get_carried_pieces(self, carrier_coord: Coord) -> List[Coord]:
        """Возвращает список переносимых фишек для данного носителя"""
        carrier_piece = self._get_piece(carrier_coord)
        if not carrier_piece:
            return []
        
        carried_type = can_carry(carrier_piece.kind)
        if not carried_type:
            return []
        
        carried = []
        for adj_coord in self._get_adjacent_coords(carrier_coord):
            adj_piece = self._get_piece(adj_coord)
            if (adj_piece and adj_piece.owner == carrier_piece.owner and 
                adj_piece.kind == carried_type and adj_piece.alive):
                carried.append(adj_coord)
        
        return carried