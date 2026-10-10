#!/usr/bin/env python3
"""
摸鱼死活题 (moyu_sihuoti) 的后端逻辑。

不依赖任何第三方库，只用 Python 标准库——这样用户的 Mac 只要有
系统自带的 python3（macOS 自带，或 `brew install python3`）就能跑，
不需要额外装 pip 包。

这个脚本被桌面组件（Übersicht widget 的 index.jsx）通过 shell 调用，
每次调用做一件小事、输出一段 JSON，职责和一个小小的本地 API 差不多：

    python3 engine.py state                   查询/确保今天的题目集合已生成
    python3 engine.py problem <id>             取某一题完整数据（画棋盘用）
    python3 engine.py answer <id> <x> <y>      提交一次作答，返回对错+正解
    python3 engine.py next                     切到下一题（今日题目间循环）
    python3 engine.py prev                     切到上一题
    python3 engine.py config                   取当前设置 + 所有可选题库列表
    python3 engine.py setconfig '<json>'       保存设置，并立刻按新设置重抽今日题目
    python3 engine.py setpos <x> <y>           记住组件在屏幕上的位置（拖动后调用）
    python3 engine.py play <id> <x> <y>        在棋盘上落一手：判规则、提子、对手（KataGo）应一手
    python3 engine.py reset <id>               这道题的棋盘摆回初始局面
    python3 engine.py katago-status            检查本机有没有可用的 KataGo（排查用）

所有状态都存在这个脚本自己所在的文件夹里（config.json / state.json /
history.json / pos.json），不碰系统其它地方，卸载组件时把整个文件夹删掉就是干净卸载。
"""
import json
import os
import random
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
CONFIG_PATH = HERE / "config.json"
STATE_PATH = HERE / "state.json"
HISTORY_PATH = HERE / "history.json"
POS_PATH = HERE / "pos.json"
ATTEMPT_PATH = HERE / "attempt.json"   # 当前正在摆的变化（只保存今天、各题的落子序列）
KATAGO_CFG_PATH = HERE / "katago.cfg"

DAILY_RESET_HOUR = 8  # 每天几点刷新一批新题（本地时间）
HISTORY_LIMIT = 2000  # 最近做过的题里，记多少道用来避免短期内重复
DEFAULT_DAILY_COUNT = 8


# ---------------------------------------------------------------- 基础工具

def load_json(path, default):
    if not path.exists():
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def load_index():
    return load_json(DATA_DIR / "index.json", [])


def load_collection_file(fname):
    return load_json(DATA_DIR / fname, [])


def effective_date(now=None):
    """早上 8 点是今天题目集合的分界线：8 点之前仍算"昨天"那一批。"""
    now = now or datetime.now()
    if now.hour < DAILY_RESET_HOUR:
        now = now - timedelta(days=1)
    return now.strftime("%Y-%m-%d")


# ---------------------------------------------------------------- 设置

def default_config():
    index = load_index()
    return {
        "collections": [c["file"] for c in index],  # 默认全选
        "dailyCount": DEFAULT_DAILY_COUNT,
    }


def load_config():
    cfg = load_json(CONFIG_PATH, None)
    if cfg is None:
        cfg = default_config()
        save_json(CONFIG_PATH, cfg)
    # 防止用户手改坏了配置文件（比如选中的题库数为 0）
    index = load_index()
    valid_files = {c["file"] for c in index}
    cfg["collections"] = [c for c in cfg.get("collections", []) if c in valid_files]
    if not cfg["collections"]:
        cfg["collections"] = [c["file"] for c in index]
    if not isinstance(cfg.get("dailyCount"), int) or cfg["dailyCount"] <= 0:
        cfg["dailyCount"] = DEFAULT_DAILY_COUNT
    return cfg


# ---------------------------------------------------------------- 选题

def pick_daily_problems(cfg, count):
    """从勾选的题库里随机抽 count 道题，尽量避开最近做过的。"""
    pool = []
    for fname in cfg["collections"]:
        for prob in load_collection_file(fname):
            pool.append((fname, prob["id"]))

    if not pool:
        return []

    history = set(load_json(HISTORY_PATH, []))
    fresh_pool = [p for p in pool if p[1] not in history]
    # 如果题库太小、新题不够，就退回到允许重复，不然会抽不出来
    chosen_pool = fresh_pool if len(fresh_pool) >= count else pool

    n = min(count, len(chosen_pool))
    chosen = random.sample(chosen_pool, n)
    return [{"file": f, "id": pid} for f, pid in chosen]


def record_history(ids):
    history = load_json(HISTORY_PATH, [])
    history.extend(ids)
    if len(history) > HISTORY_LIMIT:
        history = history[-HISTORY_LIMIT:]
    save_json(HISTORY_PATH, history)


def ensure_today_state(force=False):
    cfg = load_config()
    state = load_json(STATE_PATH, None)
    today = effective_date()

    if force or state is None or state.get("date") != today:
        picks = pick_daily_problems(cfg, cfg["dailyCount"])
        state = {
            "date": today,
            "problems": [
                {"file": p["file"], "id": p["id"], "done": False, "correct": None}
                for p in picks
            ],
            "currentIndex": 0,
        }
        save_json(STATE_PATH, state)
        record_history([p["id"] for p in picks])

    return state


# ---------------------------------------------------------------- 题目查找

def find_problem(file_name, prob_id):
    for prob in load_collection_file(file_name):
        if prob["id"] == prob_id:
            return prob
    return None


def tier_book_label(file_name):
    for c in load_index():
        if c["file"] == file_name:
            return c["tier"], c["book"]
    return "", ""


# ---------------------------------------------------------------- 输出组装

def summarize_state(state):
    done = sum(1 for p in state["problems"] if p["done"])
    correct = sum(1 for p in state["problems"] if p["correct"])
    return {
        "date": state["date"],
        "currentIndex": state["currentIndex"],
        "total": len(state["problems"]),
        "done": done,
        "correct": correct,
        "problems": state["problems"],
    }


def current_problem_payload(state):
    if not state["problems"]:
        return None
    idx = state["currentIndex"] % len(state["problems"])
    entry = state["problems"][idx]
    prob = find_problem(entry["file"], entry["id"])
    if prob is None:
        return None
    tier, book = tier_book_label(entry["file"])
    moves = load_attempts()["problems"].get(entry["id"], [])
    board = board_payload(prob, moves)
    return {
        "index": idx,
        "id": entry["id"],
        "done": entry["done"],
        "correct": entry["correct"],
        "tier": tier,
        "book": book,
        "black": board["black"],
        "white": board["white"],
        "lastMove": board["lastMove"],
        "moveCount": board["moveCount"],
        "turn": prob["turn"],
        "w": prob["w"],
        "h": prob["h"],
        # 没做完之前不要把正解一起发给前端，免得被人从组件数据里偷看答案
        "solution": prob["solution"] if entry["done"] else None,
    }


# ---------------------------------------------------------------- 命令

def cmd_state():
    state = ensure_today_state()
    out = summarize_state(state)
    out["problem"] = current_problem_payload(state)
    out["pos"] = load_json(POS_PATH, None)
    print(json.dumps(out, ensure_ascii=False))


def cmd_answer(prob_id, x, y):
    state = ensure_today_state()
    entry = next((p for p in state["problems"] if p["id"] == prob_id), None)
    if entry is None:
        print(json.dumps({"error": "problem not in today's set"}))
        return

    prob = find_problem(entry["file"], entry["id"])
    sol_points = {(s["x"], s["y"]) for s in prob["solution"]}
    is_correct = (int(x), int(y)) in sol_points

    entry["done"] = True
    entry["correct"] = is_correct
    save_json(STATE_PATH, state)

    print(json.dumps({
        "correct": is_correct,
        "solution": prob["solution"],
    }, ensure_ascii=False))


def cmd_next():
    state = ensure_today_state()
    if state["problems"]:
        state["currentIndex"] = (state["currentIndex"] + 1) % len(state["problems"])
        save_json(STATE_PATH, state)
    cmd_state()


def cmd_prev():
    state = ensure_today_state()
    if state["problems"]:
        state["currentIndex"] = (state["currentIndex"] - 1) % len(state["problems"])
        save_json(STATE_PATH, state)
    cmd_state()


def cmd_config():
    cfg = load_config()
    index = load_index()
    print(json.dumps({"config": cfg, "collections": index}, ensure_ascii=False))


def cmd_setconfig(raw_json):
    new_cfg = json.loads(raw_json)
    index = load_index()
    valid_files = {c["file"] for c in index}
    collections = [f for f in new_cfg.get("collections", []) if f in valid_files]
    if not collections:
        collections = [c["file"] for c in index]
    daily_count = new_cfg.get("dailyCount", DEFAULT_DAILY_COUNT)
    if not isinstance(daily_count, int) or daily_count <= 0:
        daily_count = DEFAULT_DAILY_COUNT

    save_json(CONFIG_PATH, {"collections": collections, "dailyCount": daily_count})
    ensure_today_state(force=True)  # 设置一变，立刻按新偏好重新抽题
    cmd_state()


# ---------------------------------------------------------------- 围棋规则（落子、提子、禁入点）

NEIGHBORS = ((1, 0), (-1, 0), (0, 1), (0, -1))


def board_from_problem(prob):
    """题目局面 -> {(x, y): 'B'|'W'}。坐标换算成整盘坐标，这样棋盘边界、气、提子都按真实 19 路棋盘算。"""
    ox, oy = prob.get("ox", 0), prob.get("oy", 0)
    board = {}
    for x, y in prob["black"]:
        board[(x + ox, y + oy)] = "B"
    for x, y in prob["white"]:
        board[(x + ox, y + oy)] = "W"
    return board


def to_global(prob, x, y):
    return x + prob.get("ox", 0), y + prob.get("oy", 0)


def to_local(prob, x, y):
    return x - prob.get("ox", 0), y - prob.get("oy", 0)


def in_crop(prob, x, y):
    return 0 <= x < prob["w"] and 0 <= y < prob["h"]


def group_and_liberties(board, pt, w, h):
    color = board[pt]
    group, libs, stack = {pt}, set(), [pt]
    while stack:
        x, y = stack.pop()
        for dx, dy in NEIGHBORS:
            q = (x + dx, y + dy)
            if not (0 <= q[0] < w and 0 <= q[1] < h):
                continue  # 局部坐标的边界不一定是棋盘边；真实边界交给 KataGo 判断
            if q not in board:
                libs.add(q)
            elif board[q] == color and q not in group:
                group.add(q)
                stack.append(q)
    return group, libs


def try_play(board, pt, color, w, h, ko_ban=None):
    """
    在 board 上落子。返回 (新棋盘, 被提掉的点列表) 或 (None, 原因)。
    原因：occupied 已有子 / suicide 自杀 / ko 打劫不能立刻提回。
    """
    if pt in board:
        return None, "occupied"
    if ko_ban is not None and pt == ko_ban:
        return None, "ko"
    nb = dict(board)
    nb[pt] = color
    enemy = "W" if color == "B" else "B"
    captured = []
    for dx, dy in NEIGHBORS:
        q = (pt[0] + dx, pt[1] + dy)
        if nb.get(q) == enemy:
            grp, libs = group_and_liberties(nb, q, w, h)
            if not libs:
                for g in grp:
                    captured.append(g)
                    del nb[g]
    _, libs = group_and_liberties(nb, pt, w, h)
    if not libs:
        return None, "suicide"
    return nb, captured


# ---------------------------------------------------------------- KataGo（可选的 AI 对手）

GTP_COLS = "ABCDEFGHJKLMNOPQRST"  # 围棋 GTP 坐标没有字母 I


def to_gtp(x, y, sz):
    return f"{GTP_COLS[x]}{sz - y}"


def from_gtp(text, sz):
    text = text.strip().upper()
    if text in ("PASS", "RESIGN") or not text:
        return None
    return GTP_COLS.index(text[0]), sz - int(text[1:])


def find_katago():
    """返回 (可执行文件, 模型文件) 或 (None, 原因)。config.json 里的 katago 字段优先。"""
    cfg = load_json(CONFIG_PATH, {}) or {}
    user = cfg.get("katago") or {}
    binary = user.get("binary") or shutil.which("katago")
    if not binary:
        for cand in ("/opt/homebrew/bin/katago", "/usr/local/bin/katago"):
            if os.path.exists(cand):
                binary = cand
                break
    if not binary:
        return None, "没找到 katago 程序（可以用 brew install katago 安装）"

    model = user.get("model")
    if not model:
        roots = []
        prefix = os.path.dirname(os.path.dirname(os.path.realpath(binary)))
        roots += [prefix + "/share/katago", "/opt/homebrew/share/katago",
                  "/usr/local/share/katago", os.path.expanduser("~/.katago")]
        for root in roots:
            if os.path.isdir(root):
                for name in sorted(os.listdir(root)):
                    if name.endswith(".bin.gz") or name.endswith(".bin"):
                        model = os.path.join(root, name)
                        break
            if model:
                break
    if not model or not os.path.exists(model):
        return None, "找到了 katago，但没找到模型文件（.bin.gz），请在 config.json 的 katago.model 里填路径"
    return (binary, model), None


KATAGO_MIN_CFG = """\
# 摸鱼死活题自动生成的最小 KataGo 配置：只下局部小棋，不吃满 CPU
logSearchInfo = false
logToStderr = false
numSearchThreads = 4
maxVisits = 150
nnCacheSizePowerOfTwo = 18
nnMutexPoolSizePowerOfTwo = 14
"""


class Gtp:
    """极简 GTP 客户端：开一个 katago gtp 子进程，发命令、读回应。"""

    def __init__(self, cmd):
        self.p = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1,
        )

    def send(self, line):
        self.p.stdin.write(line + "\n")
        self.p.stdin.flush()
        out = []
        while True:
            row = self.p.stdout.readline()
            if row == "":
                raise RuntimeError("katago 意外退出")
            row = row.rstrip("\n")
            if row == "" and out:
                break
            if row != "":
                out.append(row)
        head = out[0]
        if not head.startswith("="):
            raise RuntimeError(head)
        return head[1:].strip()

    def close(self):
        try:
            self.p.stdin.write("quit\n")
            self.p.stdin.flush()
            self.p.wait(timeout=3)
        except Exception:
            self.p.kill()


def katago_reply(moves, sz, ox, oy, black_stones, white_stones, ai_color):
    """
    把"题目初始局面 + 已下的着手"交给 KataGo，让它给 ai_color 走一手。
    返回 (x, y) 局部坐标，或 None 表示对手选择停一手/认输，或抛异常表示 AI 不可用。
    """
    override = os.environ.get("MOYU_GTP_CMD")  # 测试用：换成任意 GTP 引擎
    if override:
        cmd = override.split()
    else:
        found, why = find_katago()
        if found is None:
            raise RuntimeError(why)
        binary, model = found
        if not KATAGO_CFG_PATH.exists():
            KATAGO_CFG_PATH.write_text(KATAGO_MIN_CFG, encoding="utf-8")
        cmd = [binary, "gtp", "-model", model, "-config", str(KATAGO_CFG_PATH)]
    g = Gtp(cmd)
    try:
        g.send(f"boardsize {sz}")
        g.send("clear_board")
        g.send("komi 0")
        for x, y in black_stones:
            g.send(f"play B {to_gtp(x + ox, y + oy, sz)}")
        for x, y in white_stones:
            g.send(f"play W {to_gtp(x + ox, y + oy, sz)}")
        for color, x, y in moves:
            g.send(f"play {color} {to_gtp(x + ox, y + oy, sz)}")
        res = g.send(f"genmove {ai_color}")
        pt = from_gtp(res, sz)
        if pt is None:
            return None
        return pt[0] - ox, pt[1] - oy
    finally:
        g.close()


# ---------------------------------------------------------------- 对局状态（每题一份）

def load_attempts():
    data = load_json(ATTEMPT_PATH, {})
    if data.get("date") != effective_date():
        data = {"date": effective_date(), "problems": {}}
    return data


def save_attempts(data):
    save_json(ATTEMPT_PATH, data)


def replay(prob, moves):
    """从初始局面重放 moves，返回 (棋盘, 最后一手, 刚被提掉的点, 打劫禁点)。moves 里每个是 [color, x, y]。"""
    board = board_from_problem(prob)
    sz = prob.get("sz", 19)
    last, last_captured, ko_ban = None, [], None
    for color, lx, ly in moves:
        gx, gy = to_global(prob, lx, ly)
        nb, cap = try_play(board, (gx, gy), color, sz, sz, ko_ban)
        if nb is None:
            break
        # 简单打劫：恰好提掉 1 子、且落子后自己只有 1 口气 -> 对方不能马上提回那一点
        ko_ban = None
        if len(cap) == 1:
            _, libs = group_and_liberties(nb, (gx, gy), sz, sz)
            if len(libs) == 1:
                ko_ban = cap[0]
        board, last, last_captured = nb, (gx, gy), cap
    return board, last, last_captured, ko_ban


def board_payload(prob, moves, extra=None):
    board, last, captured, _ = replay(prob, moves)
    out = {
        "black": [list(to_local(prob, x, y)) for (x, y), c in board.items() if c == "B"],
        "white": [list(to_local(prob, x, y)) for (x, y), c in board.items() if c == "W"],
        "lastMove": list(to_local(prob, *last)) if last else None,
        "moveCount": len(moves),
    }
    if extra:
        out.update(extra)
    return out


def cmd_play(prob_id, x, y):
    state = ensure_today_state()
    entry = next((p for p in state["problems"] if p["id"] == prob_id), None)
    if entry is None:
        print(json.dumps({"error": "problem not in today's set"}))
        return
    prob = find_problem(entry["file"], entry["id"])
    x, y = int(x), int(y)

    attempts = load_attempts()
    moves = attempts["problems"].get(prob_id, [])
    me = prob["turn"]
    enemy = "W" if me == "B" else "B"
    sz = prob.get("sz", 19)

    board, _, _, ko_ban = replay(prob, moves)
    gx, gy = to_global(prob, x, y)
    nb, why = try_play(board, (gx, gy), me, sz, sz, ko_ban)
    if nb is None:
        print(json.dumps(board_payload(prob, moves, {"illegal": why}), ensure_ascii=False))
        return
    moves = moves + [[me, x, y]]

    graded = None
    if len(moves) == 1 and not entry["done"]:
        sol_points = {(s["x"], s["y"]) for s in prob["solution"]}
        is_correct = (x, y) in sol_points
        entry["done"] = True
        entry["correct"] = is_correct
        save_json(STATE_PATH, state)
        graded = {"correct": is_correct, "solution": prob["solution"]}

    # 对手应一手
    ai = {"status": "unavailable", "reason": ""}
    try:
        reply = katago_reply(
            moves, sz, prob.get("ox", 0), prob.get("oy", 0),
            prob["black"], prob["white"], enemy,
        )
        if reply is None:
            ai = {"status": "pass"}
        else:
            rx, ry = reply  # 局部坐标，可能落在裁剪框外（对手脱先）
            gr = to_global(prob, rx, ry)
            cur_board, _, _, cur_ko = replay(prob, moves)
            nb2, _ = try_play(cur_board, gr, enemy, sz, sz, cur_ko)
            if nb2 is None:
                ai = {"status": "pass"}
            elif not in_crop(prob, rx, ry):
                ai = {"status": "tenuki"}  # 对手没应这里，去别处了——局部已经没有后续变化
            else:
                moves = moves + [[enemy, rx, ry]]
                ai = {"status": "moved", "move": [rx, ry]}
    except Exception as e:  # 没装 KataGo、模型缺失、进程出错……都不应该让组件崩掉
        ai = {"status": "unavailable", "reason": str(e)[:200]}

    attempts["problems"][prob_id] = moves
    save_attempts(attempts)

    extra = {"ai": ai}
    if graded:
        extra["graded"] = graded
    print(json.dumps(board_payload(prob, moves, extra), ensure_ascii=False))


def cmd_reset(prob_id):
    state = ensure_today_state()
    entry = next((p for p in state["problems"] if p["id"] == prob_id), None)
    if entry is None:
        print(json.dumps({"error": "problem not in today's set"}))
        return
    prob = find_problem(entry["file"], entry["id"])
    attempts = load_attempts()
    attempts["problems"].pop(prob_id, None)
    save_attempts(attempts)
    print(json.dumps(board_payload(prob, []), ensure_ascii=False))


def cmd_katago_status():
    found, why = find_katago()
    if found is None:
        print(json.dumps({"ok": False, "reason": why}, ensure_ascii=False))
    else:
        print(json.dumps({"ok": True, "binary": found[0], "model": found[1]}, ensure_ascii=False))


def cmd_setpos(x, y):
    save_json(POS_PATH, {"x": int(x), "y": int(y)})
    print(json.dumps({"ok": True}))


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no command"}))
        return

    cmd = sys.argv[1]
    args = sys.argv[2:]

    if cmd == "state":
        cmd_state()
    elif cmd == "answer" and len(args) >= 3:
        cmd_answer(args[0], args[1], args[2])
    elif cmd == "next":
        cmd_next()
    elif cmd == "prev":
        cmd_prev()
    elif cmd == "config":
        cmd_config()
    elif cmd == "setconfig" and len(args) >= 1:
        cmd_setconfig(args[0])
    elif cmd == "play" and len(args) >= 3:
        cmd_play(args[0], args[1], args[2])
    elif cmd == "reset" and len(args) >= 1:
        cmd_reset(args[0])
    elif cmd == "katago-status":
        cmd_katago_status()
    elif cmd == "setpos" and len(args) >= 2:
        cmd_setpos(args[0], args[1])
    else:
        print(json.dumps({"error": f"unknown command: {cmd}"}))


if __name__ == "__main__":
    main()
