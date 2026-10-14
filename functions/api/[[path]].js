// Cloudflare Pages / Functions 的入口包装。
// 真正的路由逻辑在 shared/api-handler.js —— 同一份代码本地也在跑。
import { handleApi } from '../../shared/api-handler.js'

export const onRequest = (ctx) => handleApi({ request: ctx.request, env: ctx.env })
