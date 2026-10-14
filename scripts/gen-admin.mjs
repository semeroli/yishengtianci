/**
 * 生成管理员账号的初始化 SQL（线上部署用）
 * ─────────────────────────────────────────────────────────────
 * 为什么需要这个脚本：
 *   本项目的后台**没有「首次自助注册」这回事** —— 登录页只会提示管理员去找你，
 *   不会自己造账号。所以第一次上线时，必须往 D1 的 users 表里手动插一条记录。
 *
 *   而 users.password_hash 存的是 PBKDF2 散列（格式 pbkdf2$迭代数$盐$散列），
 *   手写很容易把迭代数、盐长度、编码弄错 —— 那样插进去的账号永远登不上，
 *   而且报错只有一句「账号或密码不正确」，极难排查。
 *
 *   所以这里**直接调用项目自己的 hashPassword()**，跟登录时的校验逻辑同源，
 *   生成后再用 verifyPassword() 回验一遍、再故意用错密码试一次，三条自检全过才输出。
 *
 * 用法：
 *   node scripts/gen-admin.mjs                        # 用户名 admin，随机 16 位强密码
 *   ADMIN_USER=wang ADMIN_PWD='自定义密码' node scripts/gen-admin.mjs
 *   ADMIN_NAME='李老师' node scripts/gen-admin.mjs
 *
 * 产物：
 *   schema/admin-seed.local.sql —— 一行 INSERT，直接整行粘进 D1 控制台执行。
 *   该文件已在 .gitignore 里排除，不会进仓库（里面有你的密码散列）。
 */
import { writeFileSync } from 'node:fs'
import { hashPassword, verifyPassword } from '../shared/api-handler.js'

const USERNAME = process.env.ADMIN_USER || 'admin'
const DISPLAY = process.env.ADMIN_NAME || '王老师'

/** 生成 len 位强密码：保证大小写字母、数字、符号各至少一个，再打乱顺序 */
function genPwd(len = 16) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // 去掉 I O，避免和 1 0 看混
  const lower = 'abcdefghijkmnopqrstuvwxyz' // 去掉 l
  const digit = '23456789' // 去掉 0 1
  const sym = '!@#$%^&*-_=+'
  const all = upper + lower + digit + sym
  const pick = (s) => s[Math.floor(Math.random() * s.length)]
  const buf = [pick(upper), pick(lower), pick(digit), pick(sym)]
  while (buf.length < len) buf.push(pick(all))
  for (let i = buf.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[buf[i], buf[j]] = [buf[j], buf[i]]
  }
  return buf.join('')
}

const pwd = process.env.ADMIN_PWD || genPwd(16)
const say = (...a) => console.log(...a)

say('=== 倚声 · 管理员初始化 SQL ===\n')

const hash = await hashPassword(pwd)
const parts = hash.split('$')
const b64len = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length

say(`用户名     : ${USERNAME}`)
say(`显示名     : ${DISPLAY}`)
say(`明文密码   : ${pwd}`)
say(`散列       : ${hash}`)
say(`散列组成   : ${parts[0]} / 迭代 ${parts[1]} 次 / 盐 ${b64len(parts[2])} 字节 / 派生值 ${b64len(parts[3])} 字节\n`)

// ── 三条自检，全过才输出 ──────────────────────────────────────
const c1 = await verifyPassword(pwd, hash) // ① 密码能通过校验
const c2 = (await verifyPassword(pwd + 'x', hash)) === false // ② 错密码必须被拒
const c3 = !hash.includes("'") && !DISPLAY.includes("'") // ③ 不能含单引号（否则把 SQL 写坏）
say(`自检 ① 回验通过     : ${c1 ? '通过' : '★失败'}`)
say(`自检 ② 错密码被拒   : ${c2 ? '通过' : '★失败'}`)
say(`自检 ③ 无单引号     : ${c3 ? '通过' : '★失败'}\n`)

if (!c1 || !c2 || !c3) {
  say('★ 自检未通过，已中止，没有写出 SQL 文件。')
  process.exit(1)
}

// INSERT OR IGNORE：重复执行不报错，也不会覆盖你后来改过的密码
const sql =
  `INSERT OR IGNORE INTO users (username, password_hash, display_name, role, must_change_pwd) ` +
  `VALUES ('${USERNAME}', '${hash}', '${DISPLAY}', 'admin', 1);`

const file = 'schema/admin-seed.local.sql'
writeFileSync(file, sql + '\n', 'utf8')

say(`已写入     : ${file}`)
say('\n—— 复制下面这一整行，粘进 Cloudflare D1 控制台执行 ——————')
say(sql)
say('———————————————————————————————————————————————\n')
say('must_change_pwd = 1：首次登录成功后，后台会强制要求你改一个新密码。')
say('这条密码只出现在本次输出里，请现在就存到安全的地方；忘了只能重跑本脚本换一个。')
