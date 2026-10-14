-- ═══════════════════════════════════════════════════════════════
-- 倚声 · AI填词工坊 —— 数据库结构（Cloudflare D1 / SQLite）
-- ═══════════════════════════════════════════════════════════════
-- 本文件供人阅读（带注释）。
-- 若要粘贴到 Cloudflare D1 控制台执行，请用 schema.console.sql
-- （控制台会吃掉换行，带 `--` 注释的那版可能整段失效）。
--
-- 改结构时两个文件必须同步修改。
-- ═══════════════════════════════════════════════════════════════

-- ── 管理员账号 ────────────────────────────────────────────────
-- ⚠️ 说明：后台规格文档里写的 `admins` 表，就是这一张 `users`。
--    不改名的原因：改名要迁移既有账号数据，风险大收益为零（表结构完全对应）。
--    规格要求的 totp_secret / totp_enabled 已作为列加在本表上。
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- 格式 pbkdf2$迭代数$盐$散列
  display_name  TEXT DEFAULT '',
  role          TEXT DEFAULT 'admin',   -- admin | editor
  must_change_pwd INTEGER DEFAULT 0,    -- 首登强制改密
  totp_secret   TEXT DEFAULT '',        -- 两步验证密钥（base32，未开启时为空）
  totp_enabled  INTEGER DEFAULT 0,      -- 0 关 1 开
  failed_count  INTEGER DEFAULT 0,      -- 连续登录失败次数（成功即清零）
  locked_until  TEXT,                   -- 锁定截止时间（datetime('now') 同格式）
  last_login_at TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- ── 登录历史 ─────────────────────────────────────────────────
-- 供「设置 → 管理员设置 → 登录历史」使用；成功与失败都记。
CREATE TABLE IF NOT EXISTS login_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   INTEGER,                   -- users.id；账号不存在时为 NULL
  username   TEXT DEFAULT '',           -- 记下尝试的用户名，便于排查撞库
  ip_address TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  city       TEXT DEFAULT '',           -- 云端取自 request.cf.city，本地为「本地」
  success    INTEGER DEFAULT 0,
  reason     TEXT DEFAULT '',           -- ok | bad_password | locked | totp_failed | no_user
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_logs_admin ON login_logs(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_logs_time  ON login_logs(created_at DESC);

-- ── 词牌库 ───────────────────────────────────────────────────
-- 代码里内置了 10 个可填词的词牌（shared/cipai.js）。
-- 这张表用于在后台补充词条、调整排序或覆盖简介；
-- 读取时以代码内置为准，表里的记录作为「增补/覆盖」。
CREATE TABLE IF NOT EXISTS ci_pai (
  id             TEXT PRIMARY KEY,      -- 与 shared/cipai.js 中的 id 对应
  name           TEXT NOT NULL,
  alias          TEXT DEFAULT '',       -- JSON 数组
  syllables      TEXT DEFAULT '',
  sentences      TEXT DEFAULT '',
  style_tag      TEXT DEFAULT '',       -- 婉约/豪放/清丽/疏朗/沉郁
  rhyme_type     TEXT DEFAULT '',       -- 平/仄/换
  tones_json     TEXT DEFAULT '',       -- 格律 JSON: [{p:"◐●◐○◐●○",r:true,...}]
  example        TEXT DEFAULT '',       -- 代表作
  example_author TEXT DEFAULT '',
  description    TEXT DEFAULT '',
  sort_order     INTEGER DEFAULT 0,
  enabled        INTEGER DEFAULT 1,
  updated_at     TEXT DEFAULT (datetime('now'))
);

-- ── 生成的词作记录 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS poems (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cipai_id     TEXT NOT NULL,
  cipai_name   TEXT NOT NULL,
  prompt       TEXT DEFAULT '',
  content_json TEXT NOT NULL,           -- 完整词作 JSON（含逐句解析）
  content_text TEXT DEFAULT '',         -- 纯文本，便于检索
  engine       TEXT DEFAULT 'local',    -- local | ai
  model        TEXT DEFAULT '',
  visitor_id   TEXT DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_poems_created ON poems(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_poems_cipai   ON poems(cipai_id);

-- ── 博客文章 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blog_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  content_md  TEXT DEFAULT '',
  excerpt     TEXT DEFAULT '',
  cover_image TEXT DEFAULT '',          -- R2 key 或 /api/media/xxx
  category    TEXT DEFAULT '填词教程',
  tags        TEXT DEFAULT '[]',        -- JSON 数组
  status      TEXT DEFAULT 'draft',     -- draft | published
  author      TEXT DEFAULT '管理员',
  view_count  INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  like_count  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now')),
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON blog_posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_slug   ON blog_posts(slug);

-- ── 评论 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blog_comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id      INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  author_name  TEXT DEFAULT '匿名',
  author_email TEXT DEFAULT '',
  content      TEXT NOT NULL,
  parent_id    INTEGER DEFAULT NULL,    -- 回复的评论 id
  likes        INTEGER DEFAULT 0,
  is_approved  INTEGER DEFAULT 0,       -- 0 待审 1 通过
  is_spam      INTEGER DEFAULT 0,       -- 1 已标垃圾（后台「垃圾」筛选用）
  ip_hash      TEXT DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON blog_comments(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_state ON blog_comments(is_spam, is_approved, created_at DESC);

-- ── 收藏（词笺） ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorites (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id   TEXT NOT NULL,
  target_type  TEXT NOT NULL,           -- poem | post
  target_id    INTEGER NOT NULL,
  snapshot_json TEXT DEFAULT '',        -- 词作快照，防止原记录被删后无法显示
  created_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(visitor_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_fav_visitor ON favorites(visitor_id, created_at DESC);

-- ── 站点设置 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── 事件统计（生成次数 / 分享 / 浏览） ────────────────────────
CREATE TABLE IF NOT EXISTS stats_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,             -- generate | view | share | comment
  ref_id     TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_kind ON stats_events(kind, created_at DESC);

-- ── 媒体文件（本地模式用；线上图片走 R2） ─────────────────────
CREATE TABLE IF NOT EXISTS media (
  key          TEXT PRIMARY KEY,
  filename     TEXT DEFAULT '',
  content_type TEXT DEFAULT '',
  size         INTEGER DEFAULT 0,
  data_b64     TEXT DEFAULT '',         -- 本地模式存的字节（base64）。R2 模式此列为空
  created_at   TEXT DEFAULT (datetime('now'))
);

-- ── 媒体文件索引 ──────────────────────────────────────────────
-- `media` 表存的是本地模式的文件字节（base64）；
-- `media_files` 是「媒体库」的元数据索引，两种存储模式都用它。
-- 规格要求的 width / height 就在这里（详情侧栏要显示尺寸）。
CREATE TABLE IF NOT EXISTS media_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT DEFAULT '',        -- 存储名（R2 key 或 media.key）
  original_name TEXT DEFAULT '',        -- 用户上传时的原始文件名
  r2_key        TEXT DEFAULT '',        -- R2 对象键；本地模式与 filename 相同
  storage       TEXT DEFAULT 'db',      -- r2 | db
  mime_type     TEXT DEFAULT '',
  size_bytes    INTEGER DEFAULT 0,
  width         INTEGER DEFAULT 0,
  height        INTEGER DEFAULT 0,
  post_id       INTEGER DEFAULT NULL,   -- 关联文章（可空）
  uploaded_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_media_uploaded ON media_files(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_post     ON media_files(post_id);

-- ── 分类 ─────────────────────────────────────────────────────
-- blog_posts.category 仍存「分类名」这个文本（前台查询沿用），
-- 这张表负责后台的分类清单、别名与描述、以及「N 篇」统计。
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT DEFAULT '',
  description TEXT DEFAULT '',
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ── 标签 ─────────────────────────────────────────────────────
-- blog_posts.tags 仍是 JSON 数组文本；这张表负责后台的标签清单与计数。
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  slug       TEXT DEFAULT '',
  color      TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── 敏感词（评论过滤） ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS banned_words (
  word TEXT PRIMARY KEY
);

-- ── 初始分类（与前台默认值保持一致，已存在则忽略） ─────────────
INSERT OR IGNORE INTO categories (name, slug, description, sort_order) VALUES
  ('填词教程', 'tutorial', '格律基础、韵书入门与填词方法', 10),
  ('词作赏析', 'appreciation', '历代名篇的读法与技法拆解', 9),
  ('词牌考据', 'cipai', '词牌的来历、别名与格律流变', 8),
  ('工坊日志', 'journal', '倚声工坊的更新与随想', 1);
