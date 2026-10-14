/**
 * 初始化数据（本地 & 线上 D1 都能用）
 * ─────────────────────────────────────────────────────────────
 * 做四件事：
 *   ① 建表（借 /api/health 触发 ensureSchema，不用手写迁移）
 *   ② 建管理员账号（默认 admin / yisheng2026，首次登录后请改密）
 *   ③ 灌入示范文章（5 篇，覆盖全部五个分类）
 *   ④ 写站点设置与默认敏感词
 *
 * 用法：
 *   npm run seed                     本地库（.data/yisheng.db）
 *   npm run seed -- --force          已存在也重建（会清掉旧管理员与同别名文章）
 *   npm run seed -- --admin=me --pwd=xxxx
 *
 * 线上 D1 请用 wrangler：
 *   wrangler d1 execute yisheng --remote --file=./schema/schema.console.sql
 * 然后到控制台插入管理员（password_hash 需先在本地生成，见 README）。
 */

import { handleApi, hashPassword } from '../shared/api-handler.js'
import { createLocalEnv } from '../server/d1-adapter.mjs'

const args = process.argv.slice(2)
const FORCE = args.includes('--force')
const arg = (k, d) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.split('=').slice(1).join('=') : d
}

const ADMIN_USER = arg('admin', 'admin')
const ADMIN_PWD = arg('pwd', 'yisheng2026')

const env = createLocalEnv()

// ── 示范文章 ──────────────────────────────────────────────
const POSTS = [
  {
    title: '平仄其实很好懂：从「一三五不论」说起',
    slug: 'ping-ze-ru-men',
    category: '格律知识',
    tags: ['平仄', '入门', '词谱'],
    excerpt: '很多人学填词卡在第一关：平仄。其实只要抓住「二四六分明」，剩下的大半可以放宽。',
    content_md: `## 先说结论

平仄是字的**声调分类**，不是玄学：

- **平声** = 阴平、阳平（今天的一声、二声）
- **仄声** = 上声、去声、入声（三声、四声，以及已经消失的入声）

现代普通话里「入声」已经并入其他声调，这是新手最容易踩的坑。例如「白」「竹」「石」在普通话里是二声（平），但古音是入声（仄）。

## 词谱上的三种符号

| 符号 | 含义 | 能用的字 |
| --- | --- | --- |
| ○ | 平 | 只能是平声字 |
| ● | 仄 | 只能是仄声字 |
| ◐ | 可平可仄 | 平仄都行 |

## 「一三五不论，二四六分明」

这是最实用的一条口诀。一句话七个字，位置如下：

\`\`\`
位次：  1  2  3  4  5  6  7
口决：  一  二  三  四  五  六  七
松紧：  松  紧  松  紧  松  紧  紧
\`\`\`

奇数位（第 1、3、5 字）可以通融，偶数位（第 2、4、6 字）和**句末字**必须严守。

为什么？因为偶数位决定这句话的「节奏骨架」，句末字决定它落在哪个韵上。骨架一散，念起来就不像词了。

## 用工具验证

在倚声的填词工作台生成一首，字旁会显示小圆点：

- <span>○</span> 平
- <span>●</span> 仄
- 点色发**红**的，就是用了通融位的地方

点色发红不丢人——苏轼、辛弃疾也常用通融位。关键在于偶数位和句末不能失守。

## 一句话记住

> 先背词谱的死规矩（字数、韵脚位置），再理解平仄的活规矩（一三五不论）。

顺序反了会很痛苦。`,
  },
  {
    title: '《浣溪沙》怎么填：42 个字的完整拆解',
    slug: 'huanxisha-jiaocheng',
    category: '填词教程',
    tags: ['浣溪沙', '小令', '实操'],
    excerpt: '拿最常用的《浣溪沙》当例子，把「词谱怎么读 → 韵脚怎么定 → 句子怎么排」走一遍。',
    content_md: `## 为什么从《浣溪沙》开始

它是**小令**里最好上手的：

- 42 字，6 句，篇幅刚好
- **平声韵**，一韵到底，押第 2、3、5、6 句
- 句子都是七言，节奏稳定

## 词谱长这样

\`\`\`
◐●◐○○●●○　（韵）
◐○◐●●○○　（韵）
◐○◐●●○○　（韵）
◐●◐○○●●
◐○◐●●○○　（韵）
◐○◐●●○○　（韵）
\`\`\`

读法：**○ = 平，● = 仄，◐ = 随便**。标了「韵」的就是韵脚句。

## 三个实操要点

### 一、先把韵脚定下来

韵脚是骨架，骨架定了再填肉。假设选「东」部（平声），那么韵脚字的候选就是：风、空、中、同、红、浓、东、重、逢……

先想好第 2、3、5、6 句各用一个什么字收尾：

\`\`\`
小院深秋一径（风）
疏帘不卷夜灯（红）
……
\`\`\`

**六个韵脚字不能重复**，这是硬规矩（重韵）。

### 二、注意第 4 句不押韵

很多人第一次填会把第 4 句也押上，读起来就"断"了。《浣溪沙》第 4 句是**仄收**的过片，故意不押韵，就是为了制造一个喘息。

### 三、七言句的节奏是 2-2-2-1 或 4-3

\`\`\`
小院 / 深秋 / 一径 / 风
小院深秋 / 一径风
\`\`\`

两种切法都行，但整首最好统一，别一句用 4-3、下一句用 2-2-2-1，会显得散。

## 常见错误清单

- ❌ 字数对不上（最容易，多数是第 4 句少了一个字）
- ❌ 第 4 句也押韵
- ❌ 两个韵脚用了同一个字
- ❌ 韵脚用了仄声字（《浣溪沙》只能押平）

用倚声生成后，逐句看「正格 / 变体 / 破格」标签，再点「换一句」微调，基本不会出律。`,
  },
  {
    title: '李煜《虞美人》为什么必须换韵',
    slug: 'liyu-yumeiren-fenxi',
    category: '名作赏析',
    tags: ['李煜', '虞美人', '换韵'],
    excerpt: '「春花秋月何时了，往事知多少」——两句话换了两次韵，这不是随意，是《虞美人》的格律要求。',
    content_md: `## 先把词摆出来

> 春花秋月何时了，往事知多少。
> 小楼昨夜又东风，故国不堪回首月明中。
>
> 雕栏玉砌应犹在，只是朱颜改。
> 问君能有几多愁，恰似一江春水向东流。

## 换韵在哪

| 句 | 末字 | 韵部 | 平仄 |
| --- | --- | --- | --- |
| 1 | 了 | 仄 | 仄 |
| 2 | 少 | 仄 | 仄 |
| 3 | 风 | 东 | 平 |
| 4 | 中 | 东 | 平 |
| 5 | 在 | 仄（换部） | 仄 |
| 6 | 改 | 同上 | 仄 |
| 7 | 愁 | 尤（换部） | 平 |
| 8 | 流 | 尤 | 平 |

看出来了吗：**仄 → 平 → 仄 → 平**，每两句换一次，而且平仄交替。

这是《虞美人》的固定格律，不是李煜的自由发挥。56 字，8 句，四组韵。

## 为什么这样设计

风格上，换韵制造了「情绪转折点」：

1. 前两句仄韵收束，是**压抑的回忆**（春花秋月何时了）
2. 三四句转平韵，语气**放开**（小楼昨夜又东风）
3. 五六句再转仄韵，**收紧**（雕栏玉砌应犹在）
4. 最后两句转平韵，**一泄而出**（问君能有几多愁）

如果你只押一个韵，这首词的情绪层次就没了。

## 用工具怎么处理

在倚声选《虞美人》时，词牌卡片会标「换韵」。生成后注意看韵脚标签：

\`\`\`
押 仄（第 1 组）：了 少
押 东（第 2 组）：风 中
押 仄（第 3 组）：在 改
押 尤（第 4 组）：愁 流
\`\`\`

四组各押各的，**组内不能重字**，组间可以照应但不必。

## 一句题外话

写这首词的时候，李煜已经是北宋的阶下囚。「故国不堪回首月明中」不是文学修辞，是他当晚真实的处境。

格律是骨架，但让这首词活到今天的，是骨头里的东西。`,
  },
  {
    title: '写不出词的时候，我做了三件事',
    slug: 'chuangzuo-xinde',
    category: '创作心得',
    tags: ['创作谈', '灵感', '习惯'],
    excerpt: '灵感不是等来的。分享三个我实际在用、确实管用的办法。',
    content_md: `## 一、写"具体的景"，不写"抽象的情"

对比一下：

- ❌ 「我很孤独」
- ✅ 「孤舟一叶听秋雨」

第二种为什么好写？因为它有**可替换的零件**：孤舟 / 一叶 / 秋雨，每个零件都能换成平仄合适的近义词，而"孤独"这个词只有一个，卡住了就没退路。

推荐做法：先写三到五个**具体的物件**，再挑。

\`\`\`
残烛　空阶　寒蛩　半窗月　一径苔
\`\`\`

这些词本身就带着情绪，不需要你再解释。

## 二、先定韵脚，再写句子

这是我受益最大的一条。

韵脚是骨架。你先想好四个韵脚字：

\`\`\`
韵脚：风 / 空 / 中 / 红
\`\`\`

然后每一句都朝这四个字去写，就不会出现"写到一半发现没韵可用"的窘境。

反过来做——先写句子再找韵——十有八九要推翻重来。

## 三、允许写出烂稿

我早期的做法是：**一首词必须一遍写好**。结果是一个月写不出三句。

后来改了：先允许自己占位。

\`\`\`
小院深秋一径风
疏帘不卷夜灯红
【这句先空着，想到再补】
\`\`\`

空着的那句可以用工具生成一个候选垫上（倚声的「换一句」就是干这个的），有感觉了再换。

> 完成比完美重要。烂稿可以改，空白改不了。

## 附：我的十分钟流程

1. 拿张纸，写 5 个具体的景物词（2 分钟）
2. 选词牌，确定韵部和韵脚字（3 分钟）
3. 把景物词按句序排列，补虚词成句（3 分钟）
4. 逐句检查平仄与韵脚（2 分钟）

十分钟一首，不算好，但比"等灵感"强得多。`,
  },
  {
    title: '苏轼写《蝶恋花》时，用了多少通融位',
    slug: 'sushi-dielianhua',
    category: '词人轶事',
    tags: ['苏轼', '蝶恋花', '一三五不论'],
    excerpt: '拿苏轼的名作对照词谱逐字核一遍，看看大家到底有多"守规矩"。',
    content_md: `## 先看词

> 花褪残红青杏小。燕子飞时，绿水人家绕。
> 枝上柳绵吹又少，天涯何处无芳草。
>
> 墙里秋千墙外道。墙外行人，墙里佳人笑。
> 笑渐不闻声渐悄，多情却被无情恼。

《蝶恋花》60 字，上下两片各四句，押**仄声韵**。

## 逐句核一遍

以第一句「花褪残红青杏小」为例，词谱是：

\`\`\`
◐●◐○○●●
\`\`\`

对一遍：

| 位 | 字 | 应有的 | 实际的 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | 花 | ◐ | 平 | 通融位 |
| 2 | 褪 | ● | 仄 | 合 |
| 3 | 残 | ◐ | 平 | 通融位 |
| 4 | 红 | ○ | 平 | 合 |
| 5 | 青 | ◐ | 平 | 通融位 |
| 6 | 杏 | ● | 仄 | 合 |
| 7 | 小 | ● | 仄 | 合 |

**三个通融位全用满了**——都在奇数位（1、3、5）。

## 这说明什么

说明「一三五不论」不是给新手开的后门，而是**词体本身的弹性**。苏轼这种级别的作者，照样把奇数位用满。

再看第二句「燕子飞时」：

\`\`\`
◐○◐●
\`\`\`

燕子飞时 → 仄仄平平。第 1 位「燕」是仄，谱上是 ◐，通融；第 3 位「飞」是平，谱上 ◐，也通融。

四字句里两个通融位，同样全在奇数位。

## 真正不能动的是什么

来看句末：

- 小（仄）✔
- 绕（仄）✔
- 少（仄）✔ 韵脚
- 草（仄）✔ 韵脚
- 道（仄）✔ 韵脚
- 笑（仄）✔ 韵脚
- 悄（仄）✔ 韵脚
- 恼（仄）✔ 韵脚

**八个句末，一个都没松。** 而且六个韵脚字（少、草、道、笑、悄、恼）互不重复。

这就是规律：**奇数位随便，偶数位规矩，句末和韵脚死守。**

## 自己核对的办法

把任何一首古人的词丢进倚声的格律解析里逐句对照，比读十遍理论管用。看多了你会发现，真正出律的词其实很少——大家守的都是偶数位和句末。

## 顺便说个细节

「笑渐不闻声渐悄」的「渐」读 jiān（平），不是 jiàn（仄）。古音里"渐"作"浸润、渐进"讲时常读平声。

这种地方，韵书比字典可靠。`,
  }
]

const BANNED = ['加微信', '加群', '代写', '办证', '发票', '博彩', '赌博', '走私', '枪支', '迷药']

// ── 执行 ──────────────────────────────────────────────────
async function main() {
  console.log('\n  倚声 · 数据初始化\n  ──────────────────────────────')

  // ① 建表：打一次 /api/cipai 触发 ensureSchema
  //    注意别用 /api/health——那个分支在 ensureSchema 之前就 return 了，
  //    打完仍然是空库（这里是踩过的坑）。
  const res = await handleApi({
    request: new Request('http://127.0.0.1/api/cipai'),
    env
  })
  if (!res.ok) throw new Error('建表失败，状态 ' + res.status)
  const probe = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`).first()
  if (!probe) throw new Error('建表未生效：找不到 users 表')
  console.log('  ✓ 数据表已就绪')

  // ② 管理员
  const exists = await env.DB.prepare(`SELECT id FROM users WHERE username = ?`).bind(ADMIN_USER).first()
  if (exists && !FORCE) {
    console.log(`  · 管理员「${ADMIN_USER}」已存在，跳过（要重建请加 --force）`)
  } else {
    if (exists) {
      await env.DB.prepare(`DELETE FROM users WHERE username = ?`).bind(ADMIN_USER).run()
    }
    const hash = await hashPassword(ADMIN_PWD)
    await env.DB.prepare(
      `INSERT INTO users (username, password_hash, display_name, role, must_change_pwd)
       VALUES (?, ?, ?, 'admin', 1)`
    )
      .bind(ADMIN_USER, hash, '王老师')
      .run()
    console.log(`  ✓ 管理员已创建：${ADMIN_USER} / ${ADMIN_PWD}（首次登录请改密）`)
  }

  // ③ 示范文章
  let added = 0
  let skipped = 0
  for (const p of POSTS) {
    const hit = await env.DB.prepare(`SELECT id FROM blog_posts WHERE slug = ?`).bind(p.slug).first()
    if (hit && !FORCE) {
      skipped++
      continue
    }
    if (hit) {
      await env.DB.prepare(`DELETE FROM blog_comments WHERE post_id = ?`).bind(hit.id).run()
      await env.DB.prepare(`DELETE FROM blog_posts WHERE id = ?`).bind(hit.id).run()
    }
    await env.DB.prepare(
      `INSERT INTO blog_posts (title, slug, content_md, excerpt, cover_image, category, tags, status, author, published_at, view_count)
       VALUES (?, ?, ?, ?, '', ?, ?, 'published', '王老师', datetime('now'), ?)`
    )
      .bind(
        p.title,
        p.slug,
        p.content_md,
        p.excerpt,
        p.category,
        JSON.stringify(p.tags),
        Math.floor(Math.random() * 60) + 12
      )
      .run()
    added++
  }
  console.log(`  ✓ 示范文章：新增 ${added} 篇${skipped ? `，跳过 ${skipped} 篇（已存在）` : ''}`)

  // ④ 站点设置
  const SETTINGS = {
    site_name: '倚声 · AI填词工坊',
    site_desc: '输入一段意境，选一个词牌，得一首合律的词。',
    logo: '🏮',
    footer_note: '倚声填词，以韵为骨。',
    comment_moderation: 'auto',
    show_engine_badge: '1'
  }
  for (const [k, v] of Object.entries(SETTINGS)) {
    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
      .bind(k, v)
      .run()
  }
  console.log(`  ✓ 站点设置：${Object.keys(SETTINGS).length} 项`)

  // ⑤ 敏感词
  const cnt = await env.DB.prepare(`SELECT COUNT(*) AS n FROM banned_words`).first()
  if (!cnt?.n || FORCE) {
    await env.DB.prepare(`DELETE FROM banned_words`).run()
    for (const w of BANNED) {
      await env.DB.prepare(`INSERT OR REPLACE INTO banned_words (word) VALUES (?)`).bind(w).run()
    }
    console.log(`  ✓ 敏感词：${BANNED.length} 个`)
  } else {
    console.log(`  · 敏感词已有 ${cnt.n} 个，跳过`)
  }

  // 汇总
  const posts = await env.DB.prepare(`SELECT COUNT(*) AS n FROM blog_posts`).first()
  const users = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first()
  console.log('\n  完成。现在可以 npm run dev')
  console.log(`  文章 ${posts.n} 篇 · 管理员 ${users.n} 个`)
  console.log(`  数据库 → .data/yisheng.db\n`)
}

main().catch((e) => {
  console.error('\n  ✗ 初始化失败：', e?.message || e)
  process.exit(1)
})
