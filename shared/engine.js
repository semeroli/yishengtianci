/**
 * 本地填词引擎（合律生成）
 * ─────────────────────────────────────────────────────────────
 * 思路：
 *  1. 按词牌的「句读」（如 2,2,3）把每句拆成若干词块；
 *     词牌的节奏是权威的，不会为了凑字乱拆（仅在完全无解时才放宽）；
 *  2. 每个词块从词库中选。判定用传统诗律的「一三五不论、二四六分明」：
 *     偶数位与句末为严格位，奇数位允许通融（记为「变体」，扣分不否决）；
 *  3. 韵脚位置的最后一个词块，只从该韵部的「韵脚词尾库」中取，
 *     所以押韵是硬的，不是碰运气；
 *  4. 逐字去重：同一个字在一句内第二次出现要重罚，在全篇内重复也要扣分，
 *     这样才不会出现「春将暮暮秋秋色」这种堆叠；
 *  5. 集束搜索（beam search）在词块组合里挑总分最高的一条。
 *
 * 本引擎纯本地运行、不联网、零成本；接入大模型后以 `engine` 字段区分。
 */

import { getCipai, isGeneratable, rhymeGroupsOf } from './cipai.js'
import { RHYME_BU, BU_BY_ID, RHYME_TAILS, charsOf, tailEntriesAt } from './rhyme.js'
import { BY_LEN, LEAD_SET, tagsForText, MOOD_BU } from './lexicon.js'

// ────────────────────────────────────────── 基础工具

/** 节奏分解表（只使用 2 字与 3 字词块，与词库一致） */
const DECOMP = {
  1: [[1]],
  2: [[2]],
  3: [[3]],
  4: [[2, 2]],
  5: [[2, 3], [3, 2]],
  6: [[2, 2, 2], [3, 3]],
  7: [[2, 2, 3], [2, 3, 2], [3, 2, 2]],
  8: [[2, 3, 3], [3, 2, 3], [3, 3, 2], [2, 2, 2, 2]],
  9: [[3, 3, 3], [2, 2, 2, 3], [2, 3, 2, 2], [2, 2, 3, 2], [3, 2, 2, 2]]
}

/**
 * 词牌写明的节奏优先（保证句读地道）；
 * 只有在该节奏下完全无解时，才退回通用拆法兜底。
 */
export function rhythmOptions(len, rhythmStr) {
  const out = []
  if (rhythmStr) {
    const parts = String(rhythmStr)
      .split(',')
      .map((x) => parseInt(x, 10))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (parts.length && parts.reduce((a, b) => a + b, 0) === len) out.push(parts)
  }
  for (const d of DECOMP[len] || []) {
    if (!out.some((o) => o.join() === d.join())) out.push(d)
  }
  return out.length ? out : [[len]]
}

function makeRnd(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(str) {
  let h = 2166136261
  const s = String(str ?? '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ────────────────────────────────────────── 平仄字典（由词库自动构建）

const TONE_DICT = (() => {
  const d = new Map()
  const feed = (word, tones) => {
    for (let i = 0; i < word.length && i < tones.length; i++) {
      const ch = word[i]
      const t = tones[i]
      const prev = d.get(ch)
      if (!prev) d.set(ch, t)
      else if (prev !== t) d.set(ch, '◐')
    }
  }
  for (const len of Object.keys(BY_LEN)) for (const p of BY_LEN[len]) feed(p.w, p.t)
  for (const bu of Object.keys(RHYME_TAILS)) {
    for (const len of Object.keys(RHYME_TAILS[bu])) {
      for (const [w, t] of RHYME_TAILS[bu][len]) feed(w, t)
    }
  }
  return d
})()

/** 查字的平仄：'○' 平 / '●' 仄 / '◐' 未知或两读 */
export function toneOfChar(ch) {
  return TONE_DICT.get(ch) || '◐'
}

export function annotate(text) {
  return [...String(text || '')].map((ch) => ({ ch, tone: toneOfChar(ch) }))
}

/** 校验一句与谱式的吻合度 */
export function checkLine(pattern, text) {
  const chars = [...String(text || '')]
  const res = { hard: 0, soft: 0, deviations: [], lengthOk: chars.length === pattern.length }
  const n = pattern.length
  for (let i = 0; i < Math.min(chars.length, n); i++) {
    const pc = pattern[i]
    if (pc === '◐') continue
    const got = toneOfChar(chars[i])
    if (got === '◐') continue
    const linePos = i + 1
    const strict = linePos % 2 === 0 || linePos === n
    if (pc !== got) {
      if (strict) res.hard++
      else res.soft++
      res.deviations.push({ pos: linePos, need: pc, got, strict })
    }
  }
  return res
}

/** 逐字带上谱式标记，供界面渲染 ○● 小圆点 */
export function annotateWithPattern(pattern, text) {
  const chars = [...String(text || '')]
  return chars.map((ch, i) => {
    const pc = pattern[i] || '◐'
    const actual = toneOfChar(ch)
    return {
      ch,
      spec: pc,
      actual,
      strict: (i + 1) % 2 === 0 || i + 1 === pattern.length,
      hit: pc === '◐' || actual === '◐' ? null : pc === actual,
      isLast: i === chars.length - 1
    }
  })
}

// ────────────────────────────────────────── 韵部选择

function buPool(tone) {
  return RHYME_BU.filter((b) => b.tone === tone)
}

/** 韵部与「意境主题」的贴合分（不含随机项之外的任何状态） */
function buScore(b, tagMap, preferred, rnd = Math.random) {
  let s = 0
  for (const [tag, w] of tagMap) {
    const moods = MOOD_BU[tag] || []
    const idx = moods.indexOf(b.id)
    if (idx === 0) s += 3 * w
    else if (idx > 0) s += Math.max(0, 2 - idx * 0.4) * w
  }
  if (b.id === preferred) s += 2.5
  s += rnd() * 1.8
  return s
}

export function pickBu(tagMap, tone, preferred, exclude = [], rnd = Math.random) {
  const pool = buPool(tone).filter((b) => !exclude.includes(b.id))
  if (!pool.length) return buPool(tone)[0] || RHYME_BU[0]

  const scored = pool.map((b) => ({ b, s: buScore(b, tagMap, preferred, rnd) }))
  scored.sort((x, y) => y.s - x.s)
  const top = scored.slice(0, 3)
  const total = top.reduce((a, x) => a + Math.max(x.s, 0.2), 0)
  let r = rnd() * total
  for (const x of top) {
    r -= Math.max(x.s, 0.2)
    if (r <= 0) return x.b
  }
  return top[0].b
}

// ────────────────────────────────────────── 韵脚编排（从结构上消灭重韵）

/**
 * 一句「尾块」在谱式里的位置。
 *
 * 引擎优先采用词牌写明的节奏（`rhythmOptions` 的第一项），这里与它保持一致；
 * 只有在首选项完全无解时引擎才会退到别的拆法，那种少数情况由
 * 「生成时的兜底 + 事后修补」兜住。
 */
function tailSlot(line) {
  const N = line.p.length
  const options = rhythmOptions(N, line.rhythm)
  const primary = options[0]
  const len = primary[primary.length - 1]
  return { len, offset: N - len }
}

/**
 * 形近字组：同一首词里不并押。
 * 字理上它们是不同的字（不算重韵），但读者读到「心未已」又读到「谁知己」，
 * 直观感受就是重韵——甚至比真重韵更像疏漏。
 */
const CONFUSABLE = [
  ['已', '己', '巳'],
  ['未', '末'],
  ['士', '土'],
  ['日', '曰'],
  ['戌', '戍', '戊'],
  ['干', '千', '于'],
  ['万', '方', '斿']
]

/**
 * 给一个韵组预先分配「每一句押哪个字」。
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它：
 * 逐句贪心生成有一个死结——写第 1 句时不知道后面还需要哪些字，
 * 于是可能把窄韵部里唯一合用的字提前用掉，到第 8 句就只剩「重复」一条路。
 * 靠「生成时排除已用字」只能缓解，不能根治：排除之后可能**无解**，
 * 而无解时引擎只好放行重韵。
 *
 * 做法是把「哪句押哪个字」变成一次**二部图最大匹配**：
 *   左边 = 该韵组的每一句（叠句不占额度，它照抄上一句）；
 *   右边 = 该韵部里**这一句的谱式形状真正能用**的韵脚字；
 *   连线 = 该字能落在该句末尾（平仄硬判）；一个「字」只能被一句占用。
 * 匹配不满 = 这个韵部撑不住这个词牌 → 返回 null，让上层换韵部。
 * 匹配满了，就把结果当成**硬约束**交给生成器：每一句只许用分配给它的那个字。
 *
 * 偏好：同一句可用的几个字里，主题贴合度高的排前面，
 * 于是匹配合法解会在「不重韵」的前提下尽量往意境上靠。
 */
function planRhymeChars(cipai, group, buId, tagMap, rnd = Math.random) {
  const targets = []
  cipai.lines.forEach((l, i) => {
    if (!l.r || String(l.r) !== String(group.key)) return
    if (l.dup) return // 叠句照抄上一句，不占韵脚字额度
    targets.push(i)
  })
  if (!targets.length) return new Map()

  const pref = targets.map((i) => {
    const line = cipai.lines[i]
    const { offset } = tailSlot(line)
    const raw = new Map()
    for (const it of tailEntriesAt(buId, line.p, offset)) {
      const ch = [...it[0]].pop()
      let th = 0
      for (const tg of it.slice(2)) th += tagMap.get(tg) || 0
      if (!raw.has(ch) || th > raw.get(ch)) raw.set(ch, th)
    }
    /*
     * 加一点随机抖动（而不是只按主题分排序）：
     * 最大匹配本身是确定性的，若只按分数排，同一个词牌换个种子
     * 会得到**一模一样的韵脚字**——「换整首」时读者会觉得没换。
     * 抖动幅度小于主题分的量级，只用来打散"分不出高下"的那些字。
     */
    const m = new Map()
    for (const [ch, th] of raw) m.set(ch, th + rnd() * 2.4)
    return m
  })

  // 可选项按贴合度降序排；Kuhn 增广路会自然把「稀缺字」让给后面没得选的句子
  const allowed = pref.map((m) => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map((x) => x[0]))

  /** 跑一次最大匹配；banned 里的字一律不给用（用于规避形近字） */
  const matchWith = (banned) => {
    const charOwner = new Map() // 字 → 句子下标（在 targets 里的序号）
    const augment = (t, visited) => {
      for (const ch of allowed[t]) {
        if (banned.has(ch)) continue
        if (visited.has(ch)) continue
        visited.add(ch)
        const owner = charOwner.get(ch)
        if (owner === undefined || augment(owner, visited)) {
          charOwner.set(ch, t)
          return true
        }
      }
      return false
    }
    let matched = 0
    for (let t = 0; t < targets.length; t++) if (augment(t, new Set())) matched++
    if (matched < targets.length) return null
    const plan = new Map()
    for (const [ch, t] of charOwner) plan.set(targets[t], ch)
    return plan
  }

  let plan = matchWith(new Set())

  /*
   * 形近字不并押。
   * 「已 / 己」「未 / 末」这类字肉眼几乎分不出——同一首词里既押「已」又押「己」，
   * 字理上不算重韵（是两个字），但读感上就是重韵，比真重韵还刺眼。
   * 所以匹配成功后再查一遍：撞上形近组就禁用其中较弱的一个重算；
   * 重算失败（窄韵部经不起再砍一个字）就保留原样——格律合格优先于观感。
   */
  if (plan) {
    const used = new Set(plan.values())
    const clash = CONFUSABLE.find((g) => g.filter((c) => used.has(c)).length > 1)
    if (clash) {
      // 谁的分更高就留谁（分数 = 各句上该字偏好分之和）
      const strength = new Map()
      pref.forEach((m) => {
        for (const [ch, v] of m) strength.set(ch, (strength.get(ch) || 0) + v)
      })
      const present = clash.filter((c) => used.has(c))
      present.sort((a, b) => (strength.get(b) || 0) - (strength.get(a) || 0))
      const retry = matchWith(new Set(present.slice(1)))
      if (retry) plan = retry
    }
  }

  return plan
}

/**
 * 选韵部 + 出韵脚编排。返回 { bu, plan }，plan 为 null 表示该韵部硬撑不住
 * （此时由上层决定是换部还是降级）。
 */
function chooseBuWithPlan(cipai, group, tagMap, preferred, rnd, exclude = [], forced = null) {
  if (forced) {
    const plan = planRhymeChars(cipai, group, forced.id, tagMap, rnd)
    return { bu: forced, plan }
  }
  const ranked = buPool(group.type)
    .filter((b) => !exclude.includes(b.id))
    .map((b) => ({ b, s: buScore(b, tagMap, preferred, rnd) }))
    .sort((x, y) => y.s - x.s)

  for (const { b } of ranked) {
    const plan = planRhymeChars(cipai, group, b.id, tagMap, rnd)
    if (plan) return { bu: b, plan }
  }
  const fallback = ranked[0]?.b || buPool(group.type)[0] || RHYME_BU[0]
  return { bu: fallback, plan: null }
}

/**
 * 体检用：某词牌的每个韵组，哪些韵部**真的撑得住**（韵脚字够分配到每一句）。
 * ─────────────────────────────────────────────────────────────
 * 界面上的「韵部建议」可以据此把窄韵部标灰——把一个撑不住的韵部推荐给用户，
 * 结果只能是重韵或生成失败，不如不说。
 * @returns [{ key, type, feasible: [buId...], capacity: { buId: 可用字数 } }]
 */
export function rhymeFeasibility(cipaiId) {
  const cipai = getCipai(cipaiId)
  if (!cipai) return []
  const emptyTags = new Map()
  return rhymeGroupsOf(cipai).map((g) => {
    const plan = {}
    const feasible = []
    for (const b of buPool(g.type)) {
      const p = planRhymeChars(cipai, g, b.id, emptyTags)
      const need = cipai.lines.filter((l) => l.r && String(l.r) === String(g.key) && !l.dup).length
      plan[b.id] = p ? need : 0
      if (p) feasible.push(b.id)
    }
    return { key: g.key, type: g.type, feasible, capacity: plan }
  })
}

// ────────────────────────────────────────── 单句生成

const BEAM = 16

function candidatesFor(pattern, offset, len, ctx, isRhymeEnd, nodeChars) {
  const pool = isRhymeEnd ? RHYME_TAILS[ctx.buId]?.[len] || [] : BY_LEN[len] || []
  const out = []
  const lineLen = pattern.length

  for (const item of pool) {
    const w = isRhymeEnd ? item[0] : item.w
    const t = isRhymeEnd ? item[1] : item.t
    const tags = isRhymeEnd ? item.slice(2) : item.tags
    if (t.length !== len || w.length !== len) continue

    // ① 平仄硬判
    let hard = 0
    let soft = 0
    for (let i = 0; i < t.length; i++) {
      const pc = pattern[offset + i]
      if (pc === '◐') continue
      const linePos = offset + i + 1
      const strict = linePos % 2 === 0 || linePos === lineLen
      if (pc !== t[i]) {
        if (strict) {
          hard++
          break
        } else soft++
      }
    }
    if (hard) continue

    // ② 韵脚必须是该韵部内的字
    if (isRhymeEnd && !charsOf(ctx.buId).includes(w[w.length - 1])) continue

    let score = -soft * 1.7

    // ③ 主题贴合
    let th = 0
    for (const tag of tags) th += ctx.tagMap.get(tag) || 0
    score += Math.min(th, 4) * 1.15

    // ④ 整词重复（全篇内）
    if (ctx.used.has(w)) score -= 3.6

    // ⑤ 逐字去重：句内重复重罚，全篇重复按次数递增
    //    注意曲线要在第 4 次之后**陡然变贵**：线性扣分（每次 0.95）挡不住
    //    主题贴合带来的加分，会出现一首词里「月」出现五次这种堆叠。
    const charsArr = [...w]
    const localSeen = new Set()
    for (const ch of charsArr) {
      if (nodeChars.has(ch)) score -= 2.5
      if (localSeen.has(ch)) score -= 2.0
      localSeen.add(ch)
      const g = ctx.charCount.get(ch) || 0
      if (g >= 3) score -= 4.5 + (g - 2) * 2.2
      else if (g > 0) score -= g * 0.95
    }

    out.push({ w, t, tags, score, soft })
  }

  /*
   * ⑤b 明确回避某些字（堆叠修补专用）
   * 与「扣分」不同，这里是**整词排除**：一次全篇复查发现某字用得太滥时，
   * 需要的是「这句别再出现它」，而不是「出现它稍微亏一点」。
   * 若排除后一个候选都不剩，就退回完整池子（宁可堆叠，也不能让句子空着）。
   */
  let usable = out
  if (ctx.avoidChars && ctx.avoidChars.size) {
    const clean = out.filter((c) => ![...c.w].some((x) => ctx.avoidChars.has(x)))
    if (clean.length) usable = clean
  }

  /*
   * ⑥ 重韵硬约束
   * ─────────────────────────────────────────────────────────────
   * 两级处理，由强到弱：
   *   ① 预先编排（最强）：上层已经算好「这一句押哪个字」，这里只放它进来。
   *      这是唯一能保证不重韵的做法——因为它知道全篇的安排，
   *      而单句生成只知道自己。编排用的字一定能在本句末位落定
   *      （planRhymeChars 用同一个平仄硬判筛过），所以不会把句子逼死。
   *   ② 排除已用字（次强）：编排缺位时（韵部太窄、用户强制指定等），
   *      退而求其次，只从「本韵组还没用过的韵脚字」里挑。
   *      真挑不出来才允许重复，但重罚 9 分，保证它是最后的选择。
   */
  if (isRhymeEnd && ctx.rhymeChar) {
    const exact = usable.filter((c) => c.w[c.w.length - 1] === ctx.rhymeChar)
    if (exact.length) return exact
  }
  if (isRhymeEnd && ctx.rhymeChars && ctx.rhymeChars.size) {
    const fresh = usable.filter((c) => !ctx.rhymeChars.has(c.w[c.w.length - 1]))
    if (fresh.length) return fresh
    for (const c of usable) c.score -= 9
    for (const c of usable) c.repeatRhyme = true
  }
  return usable
}

function scoreAtStart(cand, slotIdx, ctx) {
  if (slotIdx !== 0) return 0
  if (LEAD_SET.has(cand.w)) return 1.2
  if (ctx.wantLead) return -0.5
  return 0
}

const keyOf = (picks) => picks.map((p) => p.w).join('')

/** 生成一整句 */
function genLine(line, ctx, avoidKeys = null) {
  const pattern = line.p
  const N = pattern.length
  const options = rhythmOptions(N, line.rhythm)
  let best = null

  for (const rhythm of options) {
    let beam = [{ picks: [], score: 0, offset: 0, chars: new Set() }]
    let dead = false

    for (let s = 0; s < rhythm.length; s++) {
      const len = rhythm[s]
      const isLast = s === rhythm.length - 1
      const isRhymeEnd = isLast && !!line.r
      const next = []

      for (const node of beam) {
        const pool = candidatesFor(pattern, node.offset, len, ctx, isRhymeEnd, node.chars)
        if (!pool.length) continue
        const k = isRhymeEnd ? 8 : 10
        const top = pool
          .map((c) => ({ c, s: c.score + scoreAtStart(c, s, ctx) + ctx.rnd() * 1.6 }))
          .sort((a, b) => b.s - a.s)
          .slice(0, k)
        for (const { c, s: sc } of top) {
          const chars = new Set(node.chars)
          for (const ch of c.w) chars.add(ch)
          next.push({
            picks: [...node.picks, c],
            score: node.score + sc,
            offset: node.offset + len,
            chars
          })
        }
      }

      if (!next.length) {
        dead = true
        break
      }
      next.sort((a, b) => b.score - a.score)
      const seen = new Set()
      beam = []
      for (const n of next) {
        const key = keyOf(n.picks)
        if (seen.has(key)) continue
        seen.add(key)
        beam.push(n)
        if (beam.length >= BEAM) break
      }
    }

    if (dead || !beam.length) continue
    let cand = beam[0]
    if (avoidKeys && avoidKeys.size) {
      cand = beam.find((b) => !avoidKeys.has(keyOf(b.picks))) || beam[0]
    }
    if (!best || cand.score > best.score) best = cand
    // 词牌写明的节奏若已出解，就采用它，不再尝试备选拆法
    if (options.length === 1 || rhythm.join() === options[0].join()) break
  }

  if (!best) return { text: '', picks: [], soft: 0, failed: true }
  const soft = best.picks.reduce((a, p) => a + (p.soft || 0), 0)
  return {
    text: best.picks.map((p) => p.w).join(''),
    picks: best.picks,
    soft,
    score: best.score
  }
}

// ────────────────────────────────────────── 意象赏析（本地模板）

const TAG_PHRASE = {
  秋: '秋声',
  伤逝: '流年之感',
  冬: '寒色',
  雪: '雪意',
  春: '春信',
  花: '花事',
  夏: '荷气',
  夜: '夜色',
  月: '月色',
  黄昏: '斜阳',
  雨: '雨声',
  风: '风致',
  苍茫: '苍茫气象',
  离别: '别情',
  相思: '相思',
  思念: '忆念',
  思乡: '乡关之思',
  羁旅: '羁旅',
  孤寂: '孤怀',
  豪放: '豪宕之气',
  壮志: '壮怀',
  边塞: '关塞',
  闲适: '闲适',
  隐逸: '隐逸之趣',
  田园: '田家风味',
  怀旧: '旧游之忆',
  赠友: '故人之谊',
  登临: '登临意',
  闺阁: '闺中',
  酒: '酒兴',
  音乐: '弦管',
  寺: '禅意',
  人生: '身世',
  尘世: '尘世',
  情怀: '襟抱',
  时序: '时序推移',
  竹: '竹',
  梅: '梅',
  菊: '菊',
  松: '松',
  清朗: '清朗',
  白日: '白日',
  愁: '愁绪'
}

function buildAppreciation(cipai, lines, tagMap, usedTags) {
  const names = usedTags
    .map((t) => TAG_PHRASE[t] || t)
    .filter(Boolean)
    .slice(0, 5)
  const opening = lines[0]?.text || ''
  const closing = lines[lines.length - 1]?.text || ''
  const middle = lines[Math.floor(lines.length / 2)]?.text || ''
  const parts = []
  parts.push(
    `全篇以${names.length ? names.join('、') : '寻常景物'}为骨，取《${cipai.name}》${cipai.syllables}字体。`
  )
  parts.push(`起句「${opening}」先立景象，把一个具体的时空放在读者眼前。`)
  if (middle && middle !== opening) {
    parts.push(`过片「${middle}」景语换作情语，是全篇换气的地方；`)
  }
  parts.push(`结句「${closing}」收得克制——情不外露，剩下的留给读的人自己走完。`)
  const moodNote = {
    婉约: '全调声情偏婉，宜低回，不宜直说。',
    豪放: '全调声情开阔，句中留白处即是气象所在。',
    清丽: '全调声情清丽，宜以浅语写深致。',
    疏朗: '全调声情疏朗，最忌堆砌。',
    沉郁: '全调声情沉郁，句断而气不断。'
  }[cipai.styleTag]
  if (moodNote) parts.push(moodNote)
  return parts.join('')
}

// ────────────────────────────────────────── 主入口

export function compose({ cipaiId, prompt = '', seed, buId }) {
  const cipai = getCipai(cipaiId)
  if (!cipai) throw new Error('未找到该词牌')
  if (!isGeneratable(cipai)) throw new Error(`《${cipai.name}》的格律谱尚未整理，暂不支持自动填词`)

  const tagMap = tagsForText(prompt)
  const seed0 = (seed ?? ((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0)) >>> 0
  const rnd = makeRnd(seed0)
  const groups = rhymeGroupsOf(cipai)

  const buByGroup = new Map()
  const planByGroup = new Map()
  const usedBu = []
  for (const g of groups) {
    const forced =
      buId && g.type === '平' && !usedBu.includes(buId) && BU_BY_ID[buId] ? BU_BY_ID[buId] : null
    const { bu, plan } = chooseBuWithPlan(
      cipai,
      g,
      tagMap,
      cipai.defaultBu,
      rnd,
      usedBu,
      forced
    )
    buByGroup.set(String(g.key), bu)
    planByGroup.set(String(g.key), plan)
    usedBu.push(bu.id)
  }

  const poemLines = []
  const usedWords = new Set()
  const usedTexts = new Set()
  const charCount = new Map()
  const tagCounter = new Map()
  /** 每个韵组已经用掉的韵脚字 —— 重韵判定按「组」算（换韵词牌组与组之间互不影响）*/
  const rhymeCharsByGroup = new Map()

  for (let i = 0; i < cipai.lines.length; i++) {
    const line = cipai.lines[i]
    const bu = line.r ? buByGroup.get(String(line.r)) : buByGroup.get(String(groups[0].key))
    const gKey = line.r ? String(line.r) : ''
    if (line.r && !rhymeCharsByGroup.has(gKey)) rhymeCharsByGroup.set(gKey, new Set())

    // ── 叠句：词牌自己写明「同字重复」的句子（如梦令「知否，知否」），
    //    直接沿用上一句，不再独立生成。这既是格律要求，也顺带解决
    //    「叠句与前面某句撞韵」的问题——它本来就该跟上一句同字。
    if (line.dup && poemLines.length) {
      const prev = poemLines[poemLines.length - 1]
      const checkDup = checkLine(line.p, prev.text)
      poemLines.push({
        index: i,
        text: prev.text,
        pattern: line.p,
        rhythm: line.rhythm,
        note: line.note,
        rhyme: !!line.r,
        rhymeGroup: line.r ? String(line.r) : null,
        buId: line.r ? bu.id : null,
        soft: prev.soft || 0,
        chars: annotateWithPattern(line.p, prev.text),
        verdict: checkDup.hard > 0 ? '破格' : checkDup.soft > 0 ? '变体' : '正格',
        deviations: checkDup.deviations,
        duplicated: true,
        failed: false
      })
      continue
    }

    const ctx = {
      buId: bu.id,
      tagMap,
      used: usedWords,
      charCount,
      rnd,
      rhymeChars: line.r ? rhymeCharsByGroup.get(gKey) : null,
      /** 预先编排给这一句的韵脚字（硬约束，见 planRhymeChars） */
      rhymeChar: line.r ? planByGroup.get(gKey)?.get(i) || null : null,
      wantLead: line.p.length >= 5
    }

    let out = genLine(line, ctx)
    if (out.text && usedTexts.has(out.text)) {
      for (let attempt = 0; attempt < 10 && out.text && usedTexts.has(out.text); attempt++) {
        out = genLine(line, { ...ctx, rnd: makeRnd(Math.floor(rnd() * 1e9)) })
      }
    }

    for (const p of out.picks || []) {
      usedWords.add(p.w)
      for (const ch of p.w) charCount.set(ch, (charCount.get(ch) || 0) + 1)
      for (const tg of p.tags || []) tagCounter.set(tg, (tagCounter.get(tg) || 0) + 1)
    }
    if (out.text) usedTexts.add(out.text)
    if (line.r && out.text) {
      rhymeCharsByGroup.get(gKey).add([...out.text].pop())
    }

    const check = checkLine(line.p, out.text)
    poemLines.push({
      index: i,
      text: out.text,
      pattern: line.p,
      rhythm: line.rhythm,
      note: line.note,
      rhyme: !!line.r,
      rhymeGroup: line.r ? String(line.r) : null,
      buId: line.r ? bu.id : null,
      soft: out.soft || 0,
      chars: annotateWithPattern(line.p, out.text),
      verdict: check.hard > 0 ? '破格' : check.soft > 0 ? '变体' : '正格',
      deviations: check.deviations,
      failed: !!out.failed
    })
  }

  /*
   * ── 韵脚查重与修补（第二道防线）──
   * 逐句生成有一个先天局限：写前面那句时，并不知道后面还会需要哪些韵脚字。
   * 前面随手用掉一个字，后面那句可能就只剩「重复」可选——于是出现重韵。
   * 前一层的「硬排除」只能挡住「当下还有更好选择」的情况；
   * 这里在全篇生成完之后再查一遍，发现重韵就把**后出现的那一句**重写，
   * 约束条件设为「同韵组其它韵脚字一概避开」。最多修 6 轮。
   */
  for (const g of groups) {
    const key = String(g.key)
    const bu = buByGroup.get(key)
    const idxs = poemLines
      .filter((l) => l.rhyme && l.rhymeGroup === key && !l.duplicated && l.text)
      .map((l) => l.index)
    if (idxs.length < 2) continue

    for (let round = 0; round < 6; round++) {
      const seen = new Map()
      let target = -1
      for (const i of idxs) {
        const ch = [...poemLines[i].text].pop()
        if (seen.has(ch)) {
          target = i
          break
        }
        seen.set(ch, i)
      }
      if (target < 0) break

      const others = idxs.filter((i) => i !== target).map((i) => [...poemLines[i].text].pop())
      const line = cipai.lines[target]
      const prevText = poemLines[target].text
      const avoidAll = new Set([...others, ...usedTexts])
      let fixed = null
      for (let attempt = 0; attempt < 24; attempt++) {
        const cand = genLine(line, {
          buId: bu.id,
          tagMap,
          used: usedWords,
          charCount,
          rnd: makeRnd((seed0 + round * 2654435761 + attempt * 40503) >>> 0),
          rhymeChars: new Set(others),
          wantLead: line.p.length >= 5
        })
        if (!cand.text) continue
        const ch = [...cand.text].pop()
        if (others.includes(ch)) continue
        if (cand.text === prevText) continue
        if (avoidAll.has(cand.text)) continue
        if (cand.verdict === '破格') continue
        fixed = cand
        break
      }
      if (!fixed) break

      usedTexts.delete(prevText)
      usedTexts.add(fixed.text)
      const check = checkLine(line.p, fixed.text)
      poemLines[target] = {
        ...poemLines[target],
        text: fixed.text,
        soft: fixed.soft || 0,
        chars: annotateWithPattern(line.p, fixed.text),
        verdict: check.hard > 0 ? '破格' : check.soft > 0 ? '变体' : '正格',
        deviations: check.deviations,
        failed: !!fixed.failed,
        repaired: true
      }
    }
  }

  /*
   * ── 同字堆叠修补（第三道防线）──
   * 逐句生成只知道自己用字的历史，而韵脚编排又可能把某个字指给最后一句——
   * 于是出现「月影 / 月华 / 月色 / 明月」这种堆叠（字单看都对，连读就贫）。
   * 这里在全篇生成完之后复查一次：某个字出现到 5 次，就挑一句重写，
   * 重写时**明确禁用这个字**，并且**优先挑不押韵的句子**——
   * 押韵句已经被编排指定了韵脚字，动它容易把重韵约束解掉。
   * 最多 5 轮，仍然修不好就作罢（宁可有堆叠，也不能改出格律错误）。
   */
  for (let round = 0; round < 5; round++) {
    const cnt = new Map()
    for (const l of poemLines) {
      if (l.duplicated) continue // 词牌写明的叠句，重复是格律要求，不计
      for (const ch of l.text) cnt.set(ch, (cnt.get(ch) || 0) + 1)
    }
    const worst = [...cnt.entries()].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1])[0]
    if (!worst) break
    const [ch] = worst

    const hit = poemLines.filter((l) => !l.duplicated && l.text.includes(ch))
    const target = hit.find((l) => !l.rhyme) || hit[0]
    if (!target) break
    const line = cipai.lines[target.index]
    const prevText = target.text
    const gKey = target.rhyme ? String(target.rhymeGroup) : ''
    let fixed = null
    for (let attempt = 0; attempt < 30; attempt++) {
      const cand = genLine(line, {
        buId: target.buId || buByGroup.get(String(groups[0].key)).id,
        tagMap,
        used: usedWords,
        charCount,
        rnd: makeRnd((seed0 + 7919 * (round + 1) + attempt * 40009) >>> 0),
        rhymeChars: target.rhyme ? rhymeCharsByGroup.get(gKey) : null,
        rhymeChar: target.rhyme ? planByGroup.get(gKey)?.get(target.index) || null : null,
        avoidChars: new Set([ch]),
        wantLead: line.p.length >= 5
      })
      if (!cand.text || cand.text === prevText) continue
      if (usedTexts.has(cand.text)) continue
      if (checkLine(line.p, cand.text).hard > 0) continue
      fixed = cand
      break
    }
    if (!fixed) break

    usedTexts.delete(prevText)
    usedTexts.add(fixed.text)
    for (const c of prevText) charCount.set(c, Math.max(0, (charCount.get(c) || 0) - 1))
    for (const c of fixed.text) charCount.set(c, (charCount.get(c) || 0) + 1)
    const check = checkLine(line.p, fixed.text)
    poemLines[target.index] = {
      ...poemLines[target.index],
      text: fixed.text,
      soft: fixed.soft || 0,
      chars: annotateWithPattern(line.p, fixed.text),
      verdict: check.hard > 0 ? '破格' : check.soft > 0 ? '变体' : '正格',
      deviations: check.deviations,
      failed: !!fixed.failed,
      deduped: true
    }
  }

  const rhymeSummary = []
  const seenBu = new Set()
  for (const g of groups) {
    const b = buByGroup.get(String(g.key))
    if (seenBu.has(b.id)) continue
    seenBu.add(b.id)
    const chars = poemLines
      .filter((l) => l.rhyme && l.buId === b.id)
      .map((l) => [...l.text].pop())
      .filter(Boolean)
    rhymeSummary.push({
      buId: b.id,
      buName: b.name,
      short: b.short,
      tone: b.tone,
      chars,
      sameRhyme: new Set(chars).size === chars.length,
      /** 这一组是否成功做了「韵脚编排」（false = 韵部太窄，已降级） */
      planned: !!planByGroup.get(String(g.key))
    })
  }

  const usedTags = [...tagCounter.entries()]
    .sort((a, b) => b[1] - a[1] || (tagMap.get(b[0]) || 0) - (tagMap.get(a[0]) || 0))
    .map((x) => x[0])
    .slice(0, 8)

  return {
    cipaiId: cipai.id,
    cipaiName: cipai.name,
    syllables: cipai.syllables,
    generatedSyllables: poemLines.reduce((a, l) => a + l.text.length, 0),
    styleTag: cipai.styleTag,
    prompt,
    engine: 'local',
    seed: seed ?? null,
    lines: poemLines,
    rhyme: rhymeSummary,
    /** 所有韵组都成功编排了韵脚（无重韵的结构性保证） */
    rhymePlanOk: groups.every((g) => planByGroup.get(String(g.key)) != null),
    tags: usedTags,
    appreciation: buildAppreciation(cipai, poemLines, tagMap, usedTags),
    createdAt: new Date().toISOString()
  }
}

/** 重写单句（「换一句」） */
/**
 * 只重写某一句话（「换一句」）
 *
 * ⚠️ 两个必须由调用方传进来的东西，否则会出格律错误：
 *   · buId        —— 这一句要押哪个韵部。**不能在这里现挑**：
 *                    现挑的话，换一句会换到别的韵部去，整首词就散了。
 *   · rhymeChars  —— 同一韵组里其它句子已经用掉的韵脚字，避免换出重韵。
 */
export function recomposeLine({ cipaiId, lineIndex, prompt = '', avoid = [], seed, buId, rhymeChars = [] }) {
  const cipai = getCipai(cipaiId)
  if (!cipai || !isGeneratable(cipai)) throw new Error('该词牌不支持自动填词')
  const line = cipai.lines[lineIndex]
  if (!line) throw new Error('句序超出范围')

  const tagMap = tagsForText(prompt)
  const groups = rhymeGroupsOf(cipai)
  const group = groups.find((g) => String(g.key) === String(line.r)) || groups[0]

  // 优先用调用方指定的韵部，并校验它的声调与韵组一致
  let bu = null
  if (buId && BU_BY_ID[buId] && BU_BY_ID[buId].tone === group.type) bu = BU_BY_ID[buId]
  if (!bu) bu = line.r ? pickBu(tagMap, group.type, cipai.defaultBu, [], Math.random) : BU_BY_ID[cipai.defaultBu] || RHYME_BU[0]

  const usedRhyme = new Set((rhymeChars || []).map(String).filter(Boolean))

  const makeCtx = (rnd) => ({
    buId: bu.id,
    tagMap,
    used: new Set(),
    charCount: new Map(),
    rnd,
    rhymeChars: line.r ? usedRhyme : null,
    wantLead: line.p.length >= 5
  })

  const avoidSet = new Set(avoid.filter(Boolean))
  let out = null
  for (let i = 0; i < 60; i++) {
    const rnd = makeRnd(((seed ?? Date.now()) + i * 7919 + i * i * 31) >>> 0)
    const cand = genLine(line, makeCtx(rnd))
    if (!cand.text || avoidSet.has(cand.text)) continue
    out = cand
    break
  }
  if (!out || !out.text) {
    out = genLine(line, makeCtx(Math.random))
  }

  const check = checkLine(line.p, out.text)
  return {
    index: lineIndex,
    text: out.text,
    pattern: line.p,
    rhythm: line.rhythm,
    note: line.note,
    rhyme: !!line.r,
    rhymeGroup: line.r ? String(line.r) : null,
    buId: line.r ? bu.id : null,
    soft: out.soft || 0,
    chars: annotateWithPattern(line.p, out.text),
    verdict: check.hard > 0 ? '破格' : check.soft > 0 ? '变体' : '正格',
    deviations: check.deviations
  }
}

/** 排成纯文本（复制用） */
export function toPlainText(poem, { punctuation = true } = {}) {
  const name = `《${poem.cipaiName}》`
  const body = poem.lines.map((l) => l.text)
  if (!punctuation) return name + '\n' + body.join('')
  const half = Math.ceil(body.length / 2)
  const groups = new Set(poem.lines.map((l) => l.rhymeGroup).filter(Boolean))
  const parts = []
  if (groups.size > 1 || body.length >= 10) {
    parts.push(body.slice(0, half).join('，') + '。')
    parts.push(body.slice(half).join('，') + '。')
  } else {
    parts.push(body.join('，') + '。')
  }
  return name + '\n' + parts.join('\n\n')
}

export function rhymeChars(poem) {
  return poem.rhyme.flatMap((r) => r.chars)
}

export { RHYME_BU, BY_LEN, charsOf, toneOfChar as toneOf, CONFUSABLE }
