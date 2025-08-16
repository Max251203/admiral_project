from game.engine.board import Engine

def test_simple_move_and_combat():
    eng = Engine({"turn":1,"phase":"TURN_P1","board":{}})
    eng.place(1,(0,0),"KR")
    eng.place(2,(1,0),"ES")
    eng.gd.phase = "TURN_P1"
    res = eng.move(1,(0,0),(1,0))
    assert res.get("captures")==["ES"]