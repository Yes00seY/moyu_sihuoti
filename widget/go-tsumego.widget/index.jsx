import { css, run } from "uebersicht"

/* ------------------------------------------------------------------ *
 * 摸鱼死活题 (moyu_sihuoti)
 * 桌面围棋死活题/手筋题练习组件 —— 每天早上 8 点刷新一批题，
 * 点棋盘作答，立刻看对错，适合上班间隙随手做一道。
 *
 * 所有数据、设置、历史记录都在这个 .widget 文件夹自己里面，
 * 具体逻辑由同目录下的 engine.py 负责（见该文件开头的说明）。
 * ------------------------------------------------------------------ */

// 注意：这里假设你把本文件夹原样放在了
// ~/Library/Application Support/Übersicht/widgets/go-tsumego.widget
// 如果你改了文件夹名字，下面这行也要跟着改。
const WIDGET_DIR =
  '"$HOME/Library/Application Support/Übersicht/widgets/go-tsumego.widget"'

const engine = (...args) => {
  const quoted = args.map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(" ")
  return run(`python3 ${WIDGET_DIR}/engine.py ${quoted}`)
}

export const initialState = {
  loading: true,
  error: null,
  summary: null, // {date, total, done, correct}
  problem: null, // 当前题目完整数据；done/correct/solution 也在这里面
  settingsOpen: false,
  settingsDraft: null, // {config, collections} —— 设置面板草稿
  settingsSaving: false,
  thinking: false, // 正在等对手（KataGo）应手
  notice: null, // 一次性提示：illegal / ai 状态 {kind, text}
  pos: null, // {x, y} 组件在屏幕上的位置；null 表示用默认位置（右上角）
}

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch (e) {
    return null
  }
}

export const updateState = (event, prev) => {
  switch (event.type) {
    case "MOVE":
      return { ...prev, pos: { x: event.x, y: event.y } }
    case "LOADED": {
      const d = event.data
      if (!d || d.error) {
        return { ...prev, loading: false, error: (d && d.error) || "读取失败" }
      }
      return {
        ...prev,
        loading: false,
        error: null,
        // 后台定时刷新不要把对手正在思考的状态或提示冲掉
        thinking: event.background ? prev.thinking : false,
        notice: event.background ? prev.notice : null,
        summary: { date: d.date, total: d.total, done: d.done, correct: d.correct },
        problem: d.problem,
        pos: prev.pos || d.pos || null,
      }
    }
    case "PLAYING":
      return { ...prev, thinking: true, notice: null }
    case "PLAYED": {
      const d = event.data
      if (!d || d.error || !prev.problem) return { ...prev, thinking: false }
      const g = d.graded
      const alreadyDone = prev.problem.done
      let notice = null
      if (d.illegal) {
        const why = { occupied: "这里已经有子了", suicide: "这里是禁入点（自杀）", ko: "打劫，不能马上提回" }
        notice = { kind: "illegal", text: why[d.illegal] || "这里不能下" }
      } else if (d.ai) {
        if (d.ai.status === "unavailable") {
          notice = { kind: "noai", text: "没检测到 KataGo，对手不会应手（见 README）" }
        } else if (d.ai.status === "tenuki") {
          notice = { kind: "info", text: "对手没有在这一带应，局部到此为止" }
        } else if (d.ai.status === "pass") {
          notice = { kind: "info", text: "对手停手了" }
        }
      }
      return {
        ...prev,
        thinking: false,
        notice,
        problem: {
          ...prev.problem,
          black: d.black,
          white: d.white,
          lastMove: d.lastMove,
          moveCount: d.moveCount,
          ...(g ? { done: true, correct: g.correct, solution: g.solution } : {}),
        },
        summary:
          g && prev.summary
            ? {
                ...prev.summary,
                done: prev.summary.done + (alreadyDone ? 0 : 1),
                correct: prev.summary.correct + (!alreadyDone && g.correct ? 1 : 0),
              }
            : prev.summary,
      }
    }
    case "RESET": {
      const d = event.data
      if (!d || d.error || !prev.problem) return prev
      return {
        ...prev,
        notice: null,
        problem: { ...prev.problem, black: d.black, white: d.white, lastMove: null, moveCount: 0 },
      }
    }
    case "OPEN_SETTINGS":
      return { ...prev, settingsOpen: true, settingsDraft: event.data }
    case "TOGGLE_COLLECTION": {
      if (!prev.settingsDraft) return prev
      const sel = new Set(prev.settingsDraft.config.collections)
      if (sel.has(event.file)) sel.delete(event.file)
      else sel.add(event.file)
      return {
        ...prev,
        settingsDraft: {
          ...prev.settingsDraft,
          config: { ...prev.settingsDraft.config, collections: Array.from(sel) },
        },
      }
    }
    case "TOGGLE_TIER": {
      if (!prev.settingsDraft) return prev
      const tierFiles = prev.settingsDraft.collections
        .filter((c) => c.tier === event.tier)
        .map((c) => c.file)
      const sel = new Set(prev.settingsDraft.config.collections)
      const allSelected = tierFiles.every((f) => sel.has(f))
      tierFiles.forEach((f) => (allSelected ? sel.delete(f) : sel.add(f)))
      return {
        ...prev,
        settingsDraft: {
          ...prev.settingsDraft,
          config: { ...prev.settingsDraft.config, collections: Array.from(sel) },
        },
      }
    }
    case "SET_DAILY_COUNT": {
      if (!prev.settingsDraft) return prev
      return {
        ...prev,
        settingsDraft: {
          ...prev.settingsDraft,
          config: { ...prev.settingsDraft.config, dailyCount: event.value },
        },
      }
    }
    case "CLOSE_SETTINGS":
      return { ...prev, settingsOpen: false, settingsDraft: null }
    case "SAVING":
      return { ...prev, settingsSaving: true }
    case "SAVED": {
      const d = event.data
      if (!d || d.error) return { ...prev, settingsSaving: false }
      return {
        ...prev,
        settingsSaving: false,
        settingsOpen: false,
        settingsDraft: null,
        summary: { date: d.date, total: d.total, done: d.done, correct: d.correct },
        problem: d.problem,
      }
    }
    default:
      return prev
  }
}

function refresh(dispatch) {
  engine("state").then((out) =>
    dispatch({ type: "LOADED", data: safeParse(out), background: true })
  )
}

// 不用 Übersicht 的 command/refreshFrequency 轮询机制（那套是给"跑一条
// shell 命令、把 stdout 塞进 render"这种简单场景用的，跟我们这种"按用户
// 点击动作去调用不同子命令"的交互模式不太配）。
// 改为自己在 init 里按固定间隔调用 run()，主要是为了在组件开着不关的情况下，
// 能接住每天早上 8 点的换题时刻。
export const init = (dispatch) => {
  refresh(dispatch)
  setInterval(() => refresh(dispatch), 5 * 60 * 1000) // 5 分钟检查一次
}

// ------------------------------------------------------------------ 棋盘渲染

function cellSizeFor(w, h) {
  const m = Math.max(w, h)
  if (m <= 9) return 30
  if (m <= 13) return 24
  return 18
}

function Board({ problem, onPick, disabled }) {
  const { w, h, black, white, solution, lastMove } = problem
  const CELL = cellSizeFor(w, h)
  const PAD = CELL
  const pxW = PAD * 2 + (w - 1) * CELL
  const pxH = PAD * 2 + (h - 1) * CELL
  // 组件内容区宽 272px；棋盘太宽（如 19 路整行）就整体等比缩小，避免右侧被裁掉
  const scale = Math.min(1, 272 / pxW)

  const solutionSet = new Set((solution || []).map((s) => `${s.x},${s.y}`))

  const handleClick = (e) => {
    if (disabled) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - rect.left) / scale
    const py = (e.clientY - rect.top) / scale
    let x = Math.round((px - PAD) / CELL)
    let y = Math.round((py - PAD) / CELL)
    x = Math.max(0, Math.min(w - 1, x))
    y = Math.max(0, Math.min(h - 1, y))
    onPick(x, y)
  }

  const lines = []
  for (let x = 0; x < w; x++) {
    lines.push(
      <line
        key={`v${x}`}
        x1={PAD + x * CELL}
        y1={PAD}
        x2={PAD + x * CELL}
        y2={PAD + (h - 1) * CELL}
        stroke="rgba(0,0,0,0.35)"
        strokeWidth="1"
      />
    )
  }
  for (let y = 0; y < h; y++) {
    lines.push(
      <line
        key={`h${y}`}
        x1={PAD}
        y1={PAD + y * CELL}
        x2={PAD + (w - 1) * CELL}
        y2={PAD + y * CELL}
        stroke="rgba(0,0,0,0.35)"
        strokeWidth="1"
      />
    )
  }

  const stoneR = CELL * 0.44

  const stones = []
  black.forEach(([x, y], i) => {
    stones.push(
      <circle
        key={`b${i}`}
        cx={PAD + x * CELL}
        cy={PAD + y * CELL}
        r={stoneR}
        fill="#2b2b2b"
        stroke="#111"
        strokeWidth="0.5"
      />
    )
  })
  white.forEach(([x, y], i) => {
    stones.push(
      <circle
        key={`w${i}`}
        cx={PAD + x * CELL}
        cy={PAD + y * CELL}
        r={stoneR}
        fill="#f3f1e9"
        stroke="#555"
        strokeWidth="0.5"
      />
    )
  })

  const marks = []
  const occupied = new Set([...black, ...white].map(([x, y]) => `${x},${y}`))
  if (lastMove) {
    const onBlack = black.some(([x, y]) => x === lastMove[0] && y === lastMove[1])
    marks.push(
      <circle
        key="last"
        cx={PAD + lastMove[0] * CELL}
        cy={PAD + lastMove[1] * CELL}
        r={stoneR * 0.4}
        fill="none"
        stroke={onBlack ? "#f3f1e9" : "#2b2b2b"}
        strokeWidth="1.5"
      />
    )
  }
  if (solution) {
    solution.forEach((s, i) => {
      if (occupied.has(`${s.x},${s.y}`)) return
      const correct = solutionSet.has(`${s.x},${s.y}`)
      marks.push(
        <circle
          key={`sol${i}`}
          cx={PAD + s.x * CELL}
          cy={PAD + s.y * CELL}
          r={stoneR * 0.45}
          fill="#e0483e"
        />
      )
    })
  }

  return (
    <svg
      width={pxW * scale}
      height={pxH * scale}
      viewBox={`0 0 ${pxW} ${pxH}`}
      onClick={handleClick}
      style={{ cursor: disabled ? "default" : "pointer", display: "block" }}
    >
      <rect x={0} y={0} width={pxW} height={pxH} fill="#dcb35c" rx={6} />
      {lines}
      {stones}
      {marks}
    </svg>
  )
}

// ------------------------------------------------------------------ 设置面板

function SettingsPanel({ startDrag, draft, saving, dispatch, onSave }) {
  const byTier = {}
  draft.collections.forEach((c) => {
    byTier[c.tier] = byTier[c.tier] || []
    byTier[c.tier].push(c)
  })
  const selected = new Set(draft.config.collections)

  return (
    <div className={styles.settingsWrap}>
      <div className={styles.settingsHeader} onMouseDown={startDrag}>
        <span>选择题库</span>
        <span
          className={styles.closeBtn}
          onClick={() => dispatch({ type: "CLOSE_SETTINGS" })}
        >
          ✕
        </span>
      </div>

      <div className={styles.dailyCountRow}>
        <span>每日题量</span>
        <input
          type="number"
          min="1"
          max="50"
          value={draft.config.dailyCount}
          onChange={(e) =>
            dispatch({
              type: "SET_DAILY_COUNT",
              value: Math.max(1, parseInt(e.target.value || "1", 10)),
            })
          }
          className={styles.numberInput}
        />
      </div>

      <div className={styles.collectionList}>
        {Object.keys(byTier).map((tier) => {
          const files = byTier[tier]
          const allOn = files.every((c) => selected.has(c.file))
          const tierCount = files.reduce((s, c) => s + c.count, 0)
          return (
            <div key={tier} className={styles.tierGroup}>
              <div
                className={styles.tierHeader}
                onClick={() => dispatch({ type: "TOGGLE_TIER", tier })}
              >
                <input type="checkbox" checked={allOn} readOnly />
                <span>{tier}</span>
                <span className={styles.tierCount}>{tierCount}</span>
              </div>
              {files.map((c) => (
                <label key={c.file} className={styles.bookRow}>
                  <input
                    type="checkbox"
                    checked={selected.has(c.file)}
                    onChange={() =>
                      dispatch({ type: "TOGGLE_COLLECTION", file: c.file })
                    }
                  />
                  <span className={styles.bookName}>{c.book}</span>
                  <span className={styles.bookCount}>{c.count}</span>
                </label>
              ))}
            </div>
          )
        })}
      </div>

      <div className={styles.settingsFooter}>
        <button className={styles.saveBtn} disabled={saving} onClick={onSave}>
          {saving ? "保存中…" : "保存并重新抽题"}
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ 主渲染

const renderInner = (state, dispatch, startDrag) => {
  const {
    loading,
    error,
    summary,
    problem,
    settingsOpen,
    settingsDraft,
    settingsSaving,
    thinking,
    notice,
  } = state

  const openSettings = () => {
    engine("config").then((out) => {
      const data = safeParse(out)
      if (data) dispatch({ type: "OPEN_SETTINGS", data })
    })
  }

  const saveSettings = () => {
    dispatch({ type: "SAVING" })
    engine("setconfig", JSON.stringify(settingsDraft.config)).then((out) =>
      dispatch({ type: "SAVED", data: safeParse(out) })
    )
  }

  const pick = (x, y) => {
    if (!problem || thinking) return
    dispatch({ type: "PLAYING" })
    engine("play", problem.id, x, y).then((out) => {
      dispatch({ type: "PLAYED", data: safeParse(out) })
    })
  }

  const resetBoard = () => {
    if (!problem || thinking) return
    engine("reset", problem.id).then((out) => dispatch({ type: "RESET", data: safeParse(out) }))
  }

  const goNext = () => engine("next").then((out) => dispatch({ type: "LOADED", data: safeParse(out) }))
  const goPrev = () => engine("prev").then((out) => dispatch({ type: "LOADED", data: safeParse(out) }))

  if (settingsOpen && settingsDraft) {
    return (
      <div className={styles.wrap}>
        <SettingsPanel
          startDrag={startDrag}
          draft={settingsDraft}
          saving={settingsSaving}
          dispatch={dispatch}
          onSave={saveSettings}
        />
      </div>
    )
  }

  if (loading) {
    return <div className={styles.wrap}>加载中…</div>
  }

  if (error || !problem) {
    return (
      <div className={styles.wrap}>
        <div>没能读到题目（{error || "未知错误"}）</div>
        <div className={styles.hintSmall}>
          确认 python3 可用，且组件文件夹名字是 go-tsumego.widget
        </div>
      </div>
    )
  }

  const answered = problem.done
  const correct = problem.correct

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.bookLabel} onMouseDown={startDrag} title="按住拖动位置">
          {problem.tier.replace(/^\d[a-z]\.\s*/, "")} · {problem.book}
        </span>
        <span className={styles.gear} onClick={openSettings}>
          ⚙
        </span>
      </div>

      <div className={styles.progress}>
        今日 {summary.done}/{summary.total} · 对 {summary.correct}
      </div>

      <div className={styles.boardArea}>
        <Board problem={problem} onPick={pick} disabled={thinking || (problem.moveCount > 0 && notice && notice.kind === "noai")} />
      </div>

      <div className={styles.feedback}>
        {answered && correct && <span className={styles.correct}>✓ 正确</span>}
        {answered && !correct && <span className={styles.wrong}>✗ 差一点，红点是正解</span>}
        {!answered && !thinking && <span className={styles.hint}>{problem.turn === "B" ? "黑先" : "白先"}，点棋盘落子</span>}
        {thinking && <span className={styles.hint}>对手思考中…</span>}
        {!thinking && notice && <div className={styles.notice}>{notice.text}</div>}
      </div>

      <div className={styles.controls}>
        <button className={styles.navBtn} onClick={goPrev}>
          上一题
        </button>
        <button className={styles.navBtn} onClick={resetBoard} disabled={!problem.moveCount}>
          重摆
        </button>
        <button className={styles.navBtn} onClick={goNext}>
          下一题
        </button>
      </div>
    </div>
  )
}


// ------------------------------------------------------------------ 位置与拖动

const DEFAULT_TOP = 50
const DEFAULT_RIGHT = 30
const WIDGET_WIDTH = 328

const defaultPos = () => ({
  x: Math.max(0, window.innerWidth - WIDGET_WIDTH - DEFAULT_RIGHT),
  y: DEFAULT_TOP,
})

export const render = (state, dispatch) => {
  const pos = state.pos || defaultPos()

  const startDrag = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const origin = pos
    let last = origin
    const onMove = (ev) => {
      last = {
        x: Math.max(0, origin.x + ev.clientX - startX),
        y: Math.max(0, origin.y + ev.clientY - startY),
      }
      dispatch({ type: "MOVE", x: last.x, y: last.y })
    }
    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      engine("setpos", Math.round(last.x), Math.round(last.y))
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  return (
    <div style={{ position: "absolute", left: pos.x, top: pos.y }}>
      {renderInner(state, dispatch, startDrag)}
    </div>
  )
}

// ------------------------------------------------------------------ 样式

const styles = {
  wrap: css`
    width: 300px;
    padding: 14px;
    background: rgba(20, 20, 24, 0.85);
    border-radius: 14px;
    color: #eee;
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    -webkit-backdrop-filter: blur(14px);
  `,
  header: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  `,
  bookLabel: css`
    cursor: grab;
    font-size: 11.5px;
    opacity: 0.6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 240px;
  `,
  gear: css`
    cursor: pointer;
    opacity: 0.6;
    font-size: 14px;
  `,
  progress: css`
    font-size: 12px;
    opacity: 0.55;
    margin-bottom: 8px;
  `,
  boardArea: css`
    display: flex;
    justify-content: center;
    margin: 4px 0;
  `,
  notice: css`
    margin-top: 2px;
    font-size: 11.5px;
    opacity: 0.7;
  `,
  feedback: css`
    min-height: 38px;
    text-align: center;
    font-size: 13px;
    margin-top: 6px;
  `,
  hint: css`
    opacity: 0.6;
  `,
  correct: css`
    color: #6fd17a;
    font-weight: 600;
  `,
  wrong: css`
    color: #e0756d;
    font-weight: 600;
  `,
  controls: css`
    display: flex;
    gap: 8px;
    margin-top: 10px;
  `,
  navBtn: css`
    flex: 1;
    padding: 6px 0;
    border-radius: 8px;
    border: none;
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    font-size: 12.5px;
    cursor: pointer;
    text-align: center;
    &:disabled {
      opacity: 0.35;
      cursor: default;
    }
  `,
  hintSmall: css`
    font-size: 11px;
    opacity: 0.5;
    margin-top: 6px;
  `,
  // 设置面板
  settingsWrap: css`
    display: flex;
    flex-direction: column;
    max-height: 420px;
  `,
  settingsHeader: css`
    cursor: grab;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 10px;
  `,
  closeBtn: css`
    cursor: pointer;
    opacity: 0.6;
  `,
  dailyCountRow: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12.5px;
    margin-bottom: 10px;
  `,
  numberInput: css`
    width: 50px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 6px;
    color: #fff;
    padding: 3px 6px;
    text-align: center;
  `,
  collectionList: css`
    overflow-y: auto;
    max-height: 280px;
    padding-right: 4px;
  `,
  tierGroup: css`
    margin-bottom: 6px;
  `,
  tierHeader: css`
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    padding: 3px 0;
  `,
  tierCount: css`
    margin-left: auto;
    opacity: 0.5;
    font-weight: 400;
  `,
  bookRow: css`
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    opacity: 0.85;
    padding: 2px 0 2px 18px;
    cursor: pointer;
  `,
  bookName: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  bookCount: css`
    margin-left: auto;
    opacity: 0.5;
  `,
  settingsFooter: css`
    margin-top: 10px;
  `,
  saveBtn: css`
    width: 100%;
    padding: 7px 0;
    border-radius: 8px;
    border: none;
    background: #3a7bd5;
    color: #fff;
    font-size: 12.5px;
    cursor: pointer;
  `,
}

// 位置由组件内部管理：鼠标按住顶部标题栏拖动即可，松手后会记住位置
export const className = `
  top: 0
  left: 0
`
