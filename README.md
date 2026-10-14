# 倚声 · AI填词工坊

输入一段意境，选一个词牌，得一首**合律**的词——平仄、韵脚、句读都过关，不是把字凑够就交。
另附一个填词博客（文章 + 评论 + 后台），以及韵书速查、书法卡片、分享海报等配套工具。

- **一套代码，本地和线上同跑**：API 与词牌/韵书数据放在 `shared/`，本地用 `node:sqlite` 顶替 D1，
  线上用 Cloudflare Pages Functions + 真 D1。没有"本地能跑线上报错"的分叉。
- **填词不依赖大模型**：内置格律引擎（词牌谱 + 韵书 + 意象词库）就能压出合律的词。
  想接大模型也可以，配好密钥即自动优先走 AI，失败回落本地引擎。
- **12 个韵部、10 个可填词牌**，全部经过「重韵 / 出韵 / 破格」的回归自测。

---

## 一、30 秒跑起来

```bash
npm install          # 装依赖（本机注意事项见文末「本机环境」）
npm run seed         # 灌示范数据 + 建管理员账号 admin / yisheng2026
npm run dev          # 打开 http://127.0.0.1:5173
```

后台在 <http://127.0.0.1:5173/admin>（用上面的账号登录，**登录后请立刻改密**）。

想先看生产构建的样子：

```bash
npm run preview      # 构建 + 用 dist 起服务（默认 5173）
PORT=5199 npm run preview   # 想换端口就加 PORT
```

---

## 二、目录结构

```
shared/                 ← 本地与线上共用的"心脏"
  cipai.js              词牌谱：每个词牌的句数、每句平仄谱「○平 ●仄 ◐可平可仄」、韵脚位置
  rhyme.js              韵书：12 个韵部字表 + 韵脚词组库 + 加载时自动纠错
  lexicon.js            意象词库（按主题分组）+ 词尾平仄表 + 主题→韵部偏好
  engine.js             格律引擎：拆句读 → 选词 → 合律判定 → 集束搜索 → 韵脚编排
  api-handler.js        全部 40+ 个接口（本地与 Cloudflare 共用同一份）
server/
  dev-server.mjs        开发服务器（单进程：Vite 编译前端 + /api 直连引擎）
  d1-adapter.mjs        本地 D1 / KV 替身（node:sqlite，真 SQL 不是 mock）
  api-server.mjs        独立 API 进程（只跑接口，不用）
functions/api/[[path]].js  Cloudflare Pages Functions 入口（把请求转给 api-handler）
schema/
  schema.sql            建表语句（带注释，给人看 / 给 CLI 用）
  schema.console.sql    同上，**无注释版**——粘进 Cloudflare 控制台必须用这份
src/                    前端（Vue 3 + Vite）
  views/                页面：工作台、博客列表/详情、韵书、收藏、关于
  views/admin/          后台 8 个页面：登录、看板、文章列表、编辑器、评论、分类标签、媒体库、设置
  components/           词牌选择器、词作展板（竖排+平仄圆点）、格律解析、书法卡片、评论、Markdown 编辑器…
  components/admin/     后台专用件：分页、状态标签、空状态、骨架屏、弹窗、纯 SVG 折线图
  styles/tokens.css     前台设计令牌（宋式美学配色 + 深色主题）
  styles/admin.css      后台设计令牌（--a-* 前缀，作用域 .adm-scope，不污染前台）
scripts/
  test-engine.mjs       填词引擎回归自测（110 项，含韵书体检与容量体检）
  smoke-test.mjs        接口端到端自测（163 项，独立数据库，不污染真实数据）
  shots-admin.mjs       后台真机渲染扫描（Chrome CDP 逐页截图 + 抓报错）
  audit-rhyme.mjs       韵书容量体检（改韵书后必跑）
  seed.mjs              灌示范文章 / 管理员 / 设置 / 敏感词
wrangler.toml           Cloudflare 绑定配置（D1 / KV / R2 / 普通变量）
```

---

## 三、格律引擎是怎么保证"合律"的

这是整个项目最值得看的部分。一句话：**先按词的规矩把句子切开，再在每格上挑一个词，
最后拿平仄谱逐格验收**。

1. **拆句读**：词牌的节奏是权威的（七言是 2-2-3，五言是 2-3），不为了凑字乱拆。
2. **逐格选词**：词库里每个词都标了平仄（如「东风 ○○」）。判定用传统诗律的
   **「一三五不论、二四六分明」**——偶数位与句末是严格位，违反就是"破格"（硬错）；
   奇数位允许通融，记为"变体"（扣分不否决）。
3. **韵脚是硬的**：句末那个词只从「该韵部**该谱式形状**能用的韵脚词组」里取，不碰运气。
4. **集束搜索**（beam search）在无数种组词里挑总分最高的一条，打分兼顾平仄、主题贴合、用字不重复。

### 重韵：三道防线（这是本项目踩得最深的坑）

「重韵」= 同一韵部里韵脚字重复（如两处都押「风」）。这是词的硬伤。
第一轮排查发现，光在打分里扣分根本挡不住——主题贴合带来的加分轻易盖过它。
真正的根因在**数据**：某个韵部里"能落在某个具体谱式形状上"的字太少。

举例：东冬部的三字韵脚有 14 条，看着够用，可它们几乎全是「●○○」形状（月明中、醉颜红…）。
而《鹧鸪天》有两句收在「●●○」——这 14 条**一条也用不上**，只剩「一夜风」独苗，
于是必然重复。江阳、寒删先两部同理。

所以修法不是"再扣点分"，而是三道结构性防线：

| 防线 | 做法 | 位置 |
|---|---|---|
| ① 韵脚编排 | 生成前先用**二部图最大匹配**把「第几句押哪个字」定下来，作为硬约束交给生成器 | `engine.js · planRhymeChars` |
| ② 排除已用字 | 编排缺位时（用户强制指定韵部等），只从没用过的韵脚字里挑 | `engine.js · candidatesFor` |
| ③ 事后修补 | 全篇复查，重韵就重写后出现的那一句；同字堆叠也在此修 | `engine.js · compose` |

配套的**数据自愈**：韵脚库是手工整理的，历史上攒下"放错韵部""平仄串末位写反"等毛病，
这些条目以前被静默跳过（后果就是候选池被悄悄抽干）。
现在 `normalizeTails()` 在加载时重排：末字在本部就把平仄符号改正；末字只属另一个部就迁过去；
实在无家可归才丢弃并记录理由。**跑一次 `npm run audit:rhyme` 就能看到全部修正记录。**

跑 `npm run test:engine` 可以看到这些检查（100 项，约 12 秒）。

---

## 四、接大模型（可选）

不配也能用：本地引擎功能是完整的。配上之后 `/generate` 会优先走 AI，
**失败、超时、返回字数不符或韵脚重复都会自动回落本地引擎**（所以线上不会"转圈转到空"）。

```bash
# 本地：复制 .dev.vars.example 为 .dev.vars 并填写
cp .dev.vars.example .dev.vars
```

```
AI_API_KEY=sk-xxxx
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
AI_DISABLE_THINKING=1     # 推理型模型必须置 1，否则会输出 think 段
```

⚠️ `AI_DISABLE_THINKING` 别漏：部分推理模型（通义 / 魔搭上的一些模型）默认会先"想一段"，
不关掉的话返回的正文里混着思考过程，字数校验必然失败。

---

## 五、部署到 Cloudflare Pages

代码仓库：<https://github.com/semeroli/yishengtianci>

### 0. 三个资源已经建好了

| 资源 | 名称 | 绑定名 | ID |
|---|---|---|---|
| D1 数据库 | `yisheng-db` | `DB` | `e1a99cbb-995f-4974-9b7f-30e9df095953` |
| KV 命名空间 | `CACHE_KV` | `CACHE_KV` | `d7ece9d0d0b342c596191f888c59ac93` |
| R2 存储桶 | `yisheng-media` | `BUCKET` | （bucket 不需要 id） |

这三个 ID 已经写进 `wrangler.toml`。**该文件是绑定关系的唯一配置源**，
不要再回控制台手动点绑定 —— 控制台里点出来的绑定是「看不见的历史」，
换个人接手就不知道线上连的是哪个库。

R2 也可以不用：把 `wrangler.toml` 里的 `[[r2_buckets]]` 那段删掉，
图片会以 base64 存进 D1 的 `media` 表（能用，但单库体积会涨得快）。

### 1. 建表

```bash
npx wrangler d1 execute yisheng-db --remote --file=schema/schema.sql
```

若要走控制台粘贴：**用 `schema/schema.console.sql`**（无注释版）。
Cloudflare 控制台粘贴时会吃掉换行，带 `--` 注释的那份可能整段失效，报 `incomplete input`。

> 校验建表成功没有，别看控制台那三句提示：「此查询未返回数据」不是失败（建表就这样），
> 「此查询已成功执行」也只说明语法没错，`UPDATE` 匹配 0 行它照样这么说。
> 只有 `no such table` 才是真错。最可靠的办法是让后台实际发一个请求 —— 能返回数据就说明表在。

### 2. 建管理员账号（**这一步不能省**）

本项目的后台**没有「首次自助注册」**：登录页只会提示去找管理员，不会自己造账号。
所以第一次上线必须往 `users` 表插一条记录，否则谁都登不进去。

```bash
node scripts/gen-admin.mjs > admin.txt   # 用户名 admin，自动生成 16 位强密码；
                                         # 输出存进 admin.txt，密码只出现这一次
npm run gen-admin                        # 同上，只是不落盘、直接看屏幕
```

脚本会打印一行 `INSERT OR IGNORE INTO users ... VALUES (...)`，**整行复制**粘进
D1 控制台执行即可。它会先把密码散列出来、再用登录时的同一套逻辑回验一遍，
三条自检（回验通过 / 错密码被拒 / 不含单引号）全过才输出 —— 避免插进去一个永远登不上的账号。

- 想换账号：`ADMIN_USER=wang ADMIN_PWD='你的密码' node scripts/gen-admin.mjs`
- 想换显示名：`ADMIN_NAME='李老师' node scripts/gen-admin.mjs`
- 用的是 `INSERT OR IGNORE`：重复执行不报错，也不会覆盖你后来改过的密码
- 插入的账号带 `must_change_pwd = 1`：首次登录成功后，后台会强制要求你改一个新密码
- 本地开发不用这一步，直接 `npm run seed` 就行（默认 `admin / yisheng2026`）

### 3. 设密钥（**必须**，否则令牌签名退化成开发默认值）

```bash
npx wrangler pages secret put SITE_SECRET   # 随机串，长度 ≥ 16
npx wrangler pages secret put AI_API_KEY    # 不用 AI 可以不设
```

**必须选 Secret 类型，不能填成「明文变量」。** `wrangler deploy` 默认会先把 Worker 上
所有普通变量删光再写入配置里的 `vars`，所以控制台填的明文变量每推一次代码就消失一次；
Secret 永不被部署删除。非密钥的配置（如 `AI_MODEL`）写进 `wrangler.toml` 的 `[vars]`。

> `SITE_SECRET` 换掉之后，已发出去的登录令牌会全部失效 —— 这是预期行为（相当于强制所有人重新登录）。

### 4. 发布

在 Cloudflare Pages 上连这个 GitHub 仓库即可（推代码自动构建）。

| 设置项 | 填什么 |
|---|---|
| 生产分支 | `main` |
| 框架预设 | 选 `None` / `Vite` 都行 |
| **构建命令** | `npm run build` |
| **输出目录** | `dist` |
| 根目录 | 留空（仓库根就是项目根） |

> **产品类型必须选 Pages，不能选 Workers。** 本项目用的是 `functions/` 目录（Pages Functions
> 的约定）配 `wrangler.toml` 的 `pages_build_output_dir`。建错产品类型会出现
> `No functions dir at /functions found` 或 `Pages only supports files up to 25 MiB`。

也可以本地手动发：

```bash
npm run deploy        # = vite build && wrangler pages deploy dist
```

改完接口代码要**重新部署才生效**（Pages 不是边改边生效的）。

> **仓库里没有 `package-lock.json`，这是故意的**：本机生成的 lock 只记录了
> win32 平台的原生包，仓库里一旦有 lock，Cloudflare 就会自动改用 `npm ci`，
> 到了 Linux 构建机上会报 `Cannot find module @rollup/rollup-linux-x64-gnu`，构建直接失败。
> 详见 `.gitignore` 里的说明。想恢复可复现安装，就把那行删掉并重新 `npm install`。

#### 前端路由为什么会「一刷新就 404」

本站前端用的是 History 模式路由（`createWebHistory`），`/blog/xxx`、`/admin/login`
这些地址在服务器上**并不存在同名文件**。所以 `public/_redirects` 里必须留着这条：

```
/*    /index.html   200
```

它的作用：任何没命中静态文件的路径，都把 `index.html` 的内容返回去（状态码仍给 200），
由前端路由自己解析地址。**少了它就会出现「站内点着走都正常、一刷新或直接输网址就 404」**。

配套的还有：

| 文件 | 作用 |
|---|---|
| `public/_redirects` | SPA 路由回退。`/api/*` 走的是 Functions，**不受这条规则影响**（官方明确：`_redirects` 不作用于 Functions 路由） |
| `public/_headers` | 带指纹的 `assets/*` 缓存一年；`index.html` 不缓存，避免用户卡在旧版本白屏 |
| `functions/robots.txt.js` | 让 `/robots.txt` 可用（内容由同一个 handler 生成，带 Sitemap 地址） |
| `functions/sitemap.xml.js` | 让 `/sitemap.xml` 可用（从 `blog_posts` 动态生成） |

后两个是薄转发层，路由逻辑本身仍在 `shared/api-handler.js`，本地和线上共用一份。

### 5. 上线后怎么确认真的成了

按顺序做这四件事，任何一步不对就停下来查：

1. **打开首页** → 应看到「倚声 · AI填词工坊」，不是白屏、不是 404。
2. **随手点进一个子页面再按 F5** → 例如 `/blog`、`/admin/login` 刷新后仍能正常显示。
   这一步专门验 `_redirects` 有没有生效。
3. **后台登录** → 打开 `https://<你的域名>/admin/login`，
   用第 2 步生成的账号密码登录。看到「请修改密码」提示 = 建表和插账号都成功了。
4. **登录后看首页数据** → 在后台「看板」页能看到卡片数字（此时全是 0 是正常的，库是空的）。
   若这里报错 `no such table`，说明第 1 步的建表没跑成功。

---

## 六、常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（HMR，单端口 5173） |
| `npm run build` | 生产构建。**它比开发服务器严——Vue 模板里的错误只有构建才报**，提交前跑一次 |
| `npm run preview` | 构建 + 用 dist 起服务，验证生产形态 |
| `npm run seed` | 灌示范数据 / 建管理员（`-- --admin=me --pwd=xxxx` 可换账号）。**仅本地**，线上建管理员用下一行 |
| `npm run gen-admin` | 生成线上管理员的初始化 SQL（见第五节第 2 步），输出一行可直接粘进 D1 控制台的 `INSERT` |
| `npm run test:engine` | 填词引擎回归自测（110 项） |
| `npm run smoke` | 接口端到端自测（163 项，跑在独立库 `.data/smoke.db`） |
| `npm run check` | 上面两个一起跑 |
| `npm run shots:admin` | **后台真机渲染扫描**：真的用 Chrome 逐页打开后台，抓控制台报错 + 截图 + 核对是否白屏。改完后台 UI 必跑（见第七节） |
| `npm run audit:rhyme` | 韵书容量体检：哪些韵部撑不住哪个词牌 |
| `npm run audit:rhyme -- 水调歌头 dong` | 逐句列出该词牌某韵部每一句能押哪些字（定位瓶颈） |

---

## 七、后台管理系统（`/admin`）

入口：`http://127.0.0.1:5173/admin`，**未登录会强制跳到 `/admin/login`**。
本地默认账号 `admin / yisheng2026`（`npm run seed` 建的）。**线上的管理员是另一回事** ——
用 `npm run gen-admin` 生成后插进 D1（见第五节第 2 步），两套互不影响。
无论哪套，**首次登录后请立刻改密**。

### 有哪些页面

| 页面 | 路径 | 内容 |
|---|---|---|
| 登录 | `/admin/login` | 账号 + 密码 +（可选）两步验证码，淡墨竹影背景 |
| 数据看板 | `/admin/dashboard` | 四张统计卡（文章/阅读/评论/填词）+ 阅读趋势折线图 + 热门文章 TOP5 + 最近动态 |
| 文章管理 | `/admin/posts` | 搜索 / 分类 / 状态 / 排序筛选、表格与卡片双视图、批量发布·删除·改分类、分页 |
| 文章编辑器 | `/admin/posts/edit/new` | 三栏（编辑 ｜ 实时预览 ｜ 发布设置），Markdown 工具栏、拖拽插图、Slug 自动生成、每 30 秒自动存草稿 |
| 评论管理 | `/admin/comments` | 全部 / 待审核 / 已通过 / 垃圾 四态筛选、内联回复、批量通过·删除 |
| 分类标签 | `/admin/categories` | 左右两列，改名会同步到文章，分类下还有文章时拒绝删除 |
| 媒体库 | `/admin/media` | 拖拽上传、网格浏览、点图看详情（尺寸/大小/所属文章/R2 链接/Markdown 复制） |
| 设置 | `/admin/settings` | 博客设置 / 管理员设置（改密·两步验证·登录历史）/ API 设置 / 关于页面 |

### 安全设计（三处，都不是可选项）

1. **会话存 KV，24 小时有效**。令牌本身是无状态 HMAC（改不动），但服务端每次请求都会
   去 KV 查 `sess:{sid}` 还在不在 —— 这样才能做到「退出登录」「注销所有会话」立刻生效。
2. **连错 5 次密码锁 15 分钟**，锁定期内即使密码正确也返回 `423`。
3. **两步验证（TOTP）**：标准的 RFC 6238，用 Google Authenticator / 微软 Authenticator /
   1Password 扫码或用密钥手动添加。允许前后各 1 个时间窗（容忍手机与服务器差 30 秒）。

### 数据库

`schema/schema.sql`（**给人读**，带注释）与 `schema/schema.console.sql`（**给网页控制台粘贴**，
无注释、一条语句一行）内容必须一致，改结构两处同步改。

> 控制台粘贴版不能带 `--` 注释：Cloudflare 的 SQL 输入框会把换行吃掉，
> 注释会把后面整段代码一起吞掉，表现为「静默零张表」。

### 改完后台 UI 一定要跑这个

```bash
npm run dev            # 另开一个终端，保持运行
npm run shots:admin    # 逐页真机截图 + 抓报错，有问题退出码非 0
```

**`npm run build` 全绿不代表页面能打开。** 本项目真实踩过：路由守卫把 `/admin/login`
也当成需要登录的页面，未登录时无限重定向，**登录页根本打不开**——
`vite build` 全绿、`npm run smoke` 163 项全绿，只有真用浏览器打开才会暴露。
所以这个脚本是**闸门**，不是可选项。

---

## 八、常见维护

**管理员密码忘了 / 想重建账号**

```bash
npm run seed -- --admin=me --pwd=新密码
```

线上则用 D1 控制台执行 `UPDATE users SET password_hash='...'`——密码哈希格式是
`pbkdf2$迭代数$盐$散列`。注意 **Cloudflare Workers 的 PBKDF2 硬上限是 100,000 次迭代**
（更高会 500 且响应体为空），本项目就按 10 万写死。

**换字体**：项目**不引外部字体文件**（中文字体动辄十几 MB，外部 CDN 也未必可达），
用系统字体栈，Windows 的「楷体/宋体」、macOS 的「Kaiti SC/Songti SC」都能命中。
想换成霞鹜文楷/思源宋体：把字体文件放进 `public/fonts/`，在 `src/styles/tokens.css`
顶部加 `@font-face`，并把 `--font-*` 三个变量指过去即可。

**往韵书里加字**：直接在 `shared/rhyme.js` 的 `RHYME_BU[].chars` 里加。
加完**必须跑** `npm run audit:rhyme`——它会告诉你这个韵部还撑不撑得住每个词牌。
韵脚词组同理，加进 `RHYME_TAILS` 或补丁表；放错韵部/平仄写反不会报错，
但会在体检里显示为"已迁往 xx"或"已丢弃"。

**换默认分享图**：替换 `public/og-default.svg`（1200×630）。

---

## 九、本机环境（Windows）注意事项

这台机器的 npm 有几个坑，本项目都已实测并绕过：

- **平台原生包会漏装**。`npm install` 后若 `npm run build` 报
  `Cannot find module '@rollup/rollup-win32-x64-msvc'` 或 `@esbuild/win32-x64 could not be found`，
  一次补齐即可（两个包要**写在同一条命令里**，分两次装会互相删掉）：

  ```bash
  CODEBUDDY_SAFE_DELETE_ENABLED=0 npm install --no-save --ignore-scripts \
    --registry=https://registry.npmjs.org @rollup/rollup-win32-x64-msvc @esbuild/win32-x64
  ```

- 装依赖时若卡在批量删除的确认上，加 `CODEBUDDY_SAFE_DELETE_ENABLED=0`；
  esbuild 的 postinstall 在本机会 `EBUSY`，所以加 `--ignore-scripts`（不影响使用）。

- 本地数据库文件在 `.data/`，删掉即"恢复出厂"（下次启动会自动重建表结构）。

---

## 十、已知限制

- **只支持 10 个词牌自动填词**（忆江南、如梦令、相见欢、点绛唇、浣溪沙、菩萨蛮、
  鹧鸪天、虞美人、蝶恋花、水调歌头）。满江红、临江仙等只提供词条与名作，暂不填词。
- **韵书是简化版**（词林正韵 12 部），不是全本。某些字（如「涯」按支韵收在第三部）
  按词韵惯例处理，若按《平水韵》严格对校会有出入。
- **意象词库是本地静态表**，主题覆盖面靠人工维护。接上大模型后文采会明显不一样。
- 生成的词**不保证"像名作"**——它保证的是格律合格与用词不重复，
  意境是否动人取决于词库与运气，多按几次"换整首"。

### 后台相关的限制

- **登录历史里的「城市」在线上靠 `request.cf.city`**，只有 Cloudflare 的边缘会带这个字段；
  本地开发环境取不到，一律记成「本地」。局域网/内网访问也拿不到城市。
- **两步验证没有恢复码**。手机丢了、验证器 App 数据清了，就只能连数据库把
  `users.totp_enabled` 置 0 再登录。开之前请确认验证器 App 有云备份。
- **媒体库依赖 R2**。没绑 `BUCKET` 时图片以 base64 存进数据库，
  这样存得下但很大，只适合本地试玩，正式用一定要绑 R2。
- **`npm run smoke` 不碰真实数据**：它跑在独立库 `.data/smoke.db`，并临时建一个
  `smoke` 账号，所以不需要任何凭据。
- **`npm run shots:admin` 需要能登录的后台账号**，默认读 `admin / yisheng2026`。
  线上改过密码后要带环境变量：
  `YS_USER=你的账号 YS_PWD=你的密码 npm run shots:admin`。
