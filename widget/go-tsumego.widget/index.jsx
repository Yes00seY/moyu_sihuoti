import { css, run } from "uebersicht"

/* ------------------------------------------------------------------ *
 * go-tsumego-badge
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
    case "LOADED": {
      const d = event.data
      if (!d || d.error) {
        return { ...prev, loading: false, error: (d && d.error) || "读取失败" }
      }
      return {
        ...prev,
        loading: false,
        error: null,
        summary: { date: d.date, total: d.total, done: d.done, correct: d.correct },
        problem: d.problem,
      }
    }
    case "ANSWERED": {
      const d = event.data
      if (!d || d.error || !prev.problem) return prev
      const alreadyDone = prev.problem.done
      return {
        ...prev,
        problem: { ...prev.problem, done: true, correct: d.correct, solution: d.solution },
        summary: prev.summary && {
          ...prev.summary,
          done: prev.summary.done + (alreadyDone ? 0 : 1),
          correct: prev.summary.correct + (!alreadyDone && d.correct ? 1 : 0),
        },
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
  engine("state").then((out) => dispatch({ type: "LOADED", data: safeParse(out) }))
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
  const { w, h, black, white, solution } = problem
  const CELL = cellSizeFor(w, h)
  const PAD = CELL
  const pxW = PAD * 2 + (w - 1) * CELL
  const pxH = PAD * 2 + (h - 1) * CELL

  const solutionSet = new Set((solution || []).map((s) => `${s.x},${s.y}`))

  const handleClick = (e) => {
    if (disabled) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
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
  if (solution) {
    solution.forEach((s, i) => {
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
      width={pxW}
      height={pxH}
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

function SettingsPanel({ draft, saving, dispatch, onSave }) {
  const byTier = {}
  draft.collections.forEach((c) => {
    byTier[c.tier] = byTier[c.tier] || []
    byTier[c.tier].push(c)
  })
  const selected = new Set(draft.config.collections)

  return (
    <div className={styles.settingsWrap}>
      <div className={styles.settingsHeader}>
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

export const render = (state, dispatch) => {
  const {
    loading,
    error,
    summary,
    problem,
    settingsOpen,
    settingsDraft,
    settingsSaving,
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
    if (!problem || problem.done) return
    engine("answer", problem.id, x, y).then((out) => {
      dispatch({ type: "ANSWERED", data: safeParse(out) })
    })
  }

  const goNext = () => engine("next").then((out) => dispatch({ type: "LOADED", data: safeParse(out) }))
  const goPrev = () => engine("prev").then((out) => dispatch({ type: "LOADED", data: safeParse(out) }))

  if (settingsOpen && settingsDraft) {
    return (
      <div className={styles.wrap}>
        <SettingsPanel
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
        <span className={styles.bookLabel}>
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
        <Board problem={problem} onPick={pick} disabled={answered} />
      </div>

      <div className={styles.feedback}>
        {!answered && <span className={styles.hint}>{problem.turn === "B" ? "黑先" : "白先"}，点棋盘落子</span>}
        {answered && correct && <span className={styles.correct}>✓ 正确</span>}
        {answered && !correct && <span className={styles.wrong}>✗ 差一点，红点是正解</span>}
      </div>

      <div className={styles.controls}>
        <button className={styles.navBtn} onClick={goPrev}>
          上一题
        </button>
        <button className={styles.navBtn} onClick={goNext}>
          下一题
        </button>
      </div>
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
  feedback: css`
    min-height: 20px;
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

// 组件在屏幕上的位置——改这里的 top / right 挪到你想要的地方
export const className = `
  top: 50px
  right: 30px
`
