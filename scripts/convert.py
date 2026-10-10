#!/usr/bin/env python3
"""
把 sanderland/tsumego 仓库里的原始题目数据（近似 SGF 的 JSON 格式）
转换成本项目组件使用的紧凑格式，输出到 widget/go-tsumego.widget/data/。

用法：
    1. 先把上游仓库 clone 下来：
       git clone https://github.com/sanderland/tsumego.git /tmp/tsumego-src
    2. 在本仓库根目录运行：
       python3 scripts/convert.py /tmp/tsumego-src/problems

不传参数时默认去找 ../tsumego-upstream/problems（约定的本地临时目录），
方便重复跑这个脚本时不用每次都打一遍路径。

转换规则：
- SGF 坐标两个字符：第一个字符=列(a=0..s=18)，第二个字符=从上往下数的
  行(a=0..s=18)。这正好符合用 SVG 从上往下画棋盘的习惯，不需要像原 app
  那样为了 GTP 坐标显示再翻转一次。
- 过滤掉原作者自己标注了 "Backup solution detector used, solution may
  be incorrect." 的题（程序自动算出来、不保证正确的答案），不进题库。
- 每道题的 SOL 列表里，所有着子颜色都一致——它不是一串连续的对杀过程，
  而是"所有被认可的正解点"（允许多解/对称解），我们原样保留这个语义。
- 自动裁剪出棋子所在的局部区域（留白 2 路），避免每道小题都画一张
  19x19 大棋盘；小组件里会再按裁剪后的尺寸自适应缩放显示。
"""
import json
import glob
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
DEFAULT_SRC = os.path.join(REPO_ROOT, "tsumego-upstream", "problems")
OUT_DIR = os.path.join(REPO_ROOT, "widget", "go-tsumego.widget", "data")

LETTERS = "abcdefghijklmnopqrs"  # a..s -> 0..18（19路棋盘坐标字母表）


def sgf_to_colrow(code):
    """'pd' -> (col, row)；空字符串或旧式 pass 记法 'zz' 等非法坐标返回 None"""
    if not code or len(code) != 2:
        return None
    if code[0] not in LETTERS or code[1] not in LETTERS:
        return None  # 比如旧版 SGF 用 'zz' 表示 pass
    col = LETTERS.index(code[0])
    row = LETTERS.index(code[1])
    return [col, row]


def has_zero_liberty_group(black, white, sz):
    """局面里只要有一块棋没有气，就是围棋规则下不可能出现的局面（数据有误），整题剔除。"""
    st = {}
    for p in black:
        if p:
            st[tuple(p)] = "B"
    for p in white:
        if p:
            st[tuple(p)] = "W"
    seen = set()
    for pt, color in st.items():
        if pt in seen:
            continue
        seen.add(pt)
        stack = [pt]
        has_lib = False
        while stack:
            x, y = stack.pop()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                q = (x + dx, y + dy)
                if not (0 <= q[0] < sz and 0 <= q[1] < sz):
                    continue
                if q not in st:
                    has_lib = True
                elif st[q] == color and q not in seen:
                    seen.add(q)
                    stack.append(q)
        if not has_lib:
            return True
    return False


def convert_one(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    sol_raw = data.get("SOL", [])

    for mv in sol_raw:
        comment = (mv[3] or "") if len(mv) > 3 else ""
        if "Backup solution detector" in comment:
            return None  # 作者自己标注不保证正确，剔除

    sz = int(data.get("SZ", 19))
    black = [sgf_to_colrow(c) for c in data.get("AB", [])]
    white = [sgf_to_colrow(c) for c in data.get("AW", [])]

    if has_zero_liberty_group(black, white, sz):
        return None  # 局面本身不合法（有无气的棋子），剔除

    turn = "W" if str(data.get("C", "")).startswith("White") else "B"

    solution = []
    for mv in sol_raw:
        color = mv[0]
        coord = sgf_to_colrow(mv[1]) if len(mv) > 1 else None
        comment = mv[3] if len(mv) > 3 and mv[3] else ""
        if coord is None:
            continue  # pass 着法，罕见，跳过
        solution.append({"c": color, "x": coord[0], "y": coord[1], "note": comment})

    if not solution:
        return None

    all_pts = [p for p in black + white if p] + [[s["x"], s["y"]] for s in solution]
    if not all_pts:
        return None

    xs = [p[0] for p in all_pts]
    ys = [p[1] for p in all_pts]
    margin = 2
    x0 = max(0, min(xs) - margin)
    x1 = min(sz - 1, max(xs) + margin)
    y0 = max(0, min(ys) - margin)
    y1 = min(sz - 1, max(ys) + margin)

    def shift(p):
        return [p[0] - x0, p[1] - y0]

    return {
        "black": [shift(p) for p in black if p],
        "white": [shift(p) for p in white if p],
        "turn": turn,
        "solution": [
            {"c": s["c"], "x": s["x"] - x0, "y": s["y"] - y0, "note": s["note"]}
            for s in solution
        ],
        "w": x1 - x0 + 1,
        "h": y1 - y0 + 1,
        # 裁剪区域左上角在原棋盘上的位置、原棋盘路数——对局时要还原成整盘坐标
        "ox": x0,
        "oy": y0,
        "sz": sz,
    }


def main():
    src_root = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.isdir(src_root):
        print(f"找不到源数据目录: {src_root}")
        print("用法: python3 scripts/convert.py <sanderland/tsumego 仓库里 problems/ 的路径>")
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)

    total = 0
    kept = 0
    skipped = 0
    by_collection = {}

    for path in glob.glob(os.path.join(src_root, "**", "*.json"), recursive=True):
        total += 1
        rel = os.path.relpath(path, src_root)
        parts = rel.split(os.sep)
        tier = parts[0]
        book = parts[1] if len(parts) > 2 else tier
        try:
            conv = convert_one(path)
        except Exception as e:
            print("解析失败", path, e)
            continue
        if conv is None:
            skipped += 1
            continue
        conv["id"] = rel.replace(os.sep, "/")
        by_collection.setdefault((tier, book), []).append(conv)
        kept += 1

    index = []
    for (tier, book), probs in by_collection.items():
        safe_tier = re.sub(r"[^\w.\-]+", "_", tier).strip("_")
        safe_book = re.sub(r"[^\w.\-]+", "_", book).strip("_")
        fname = f"{safe_tier}__{safe_book}.json"
        with open(os.path.join(OUT_DIR, fname), "w", encoding="utf-8") as f:
            json.dump(probs, f, ensure_ascii=False)
        index.append({"tier": tier, "book": book, "file": fname, "count": len(probs)})

    with open(os.path.join(OUT_DIR, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f"总文件数: {total}")
    print(f"剔除(质量警告/无有效正解): {skipped}")
    print(f"保留: {kept}")
    print(f"分类数: {len(by_collection)}")
    print(f"已写入: {OUT_DIR}")


if __name__ == "__main__":
    main()
