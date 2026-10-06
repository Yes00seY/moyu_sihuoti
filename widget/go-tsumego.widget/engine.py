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

所有状态都存在这个脚本自己所在的文件夹里（config.json / state.json /
history.json / pos.json），不碰系统其它地方，卸载组件时把整个文件夹删掉就是干净卸载。
"""
import json
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
CONFIG_PATH = HERE / "config.json"
STATE_PATH = HERE / "state.json"
HISTORY_PATH = HERE / "history.json"
POS_PATH = HERE / "pos.json"

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
    return {
        "index": idx,
        "id": entry["id"],
        "done": entry["done"],
        "correct": entry["correct"],
        "tier": tier,
        "book": book,
        "black": prob["black"],
        "white": prob["white"],
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
    elif cmd == "setpos" and len(args) >= 2:
        cmd_setpos(args[0], args[1])
    else:
        print(json.dumps({"error": f"unknown command: {cmd}"}))


if __name__ == "__main__":
    main()
