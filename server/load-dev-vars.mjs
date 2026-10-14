/**
 * 把 `.dev.vars` 读进 process.env（文件不存在就静默跳过）
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它：README 让用户「复制 .dev.vars.example 为 .dev.vars 并填写」，
 * 而 `wrangler pages dev` 会自动读这个文件、**我们自建的 dev-server 不会** ——
 * 「我明明填了 Key，本地还是走本地格律引擎」这种困惑就是这么来的。
 *
 * 用 Node 22 自带的 `process.loadEnvFile()`：格式与 dotenv 一致，不必引依赖。
 * 语义已实测：**已存在的环境变量优先**（`AI_MODEL=x node ...` 不会被文件覆盖），
 * 方便临时试某个模型。文件缺失时它会抛异常，这里吞掉。
 */
import { existsSync } from 'node:fs'

export function loadDevVars(file) {
  if (!existsSync(file)) return false
  try {
    process.loadEnvFile(file)
    return true
  } catch {
    return false
  }
}
