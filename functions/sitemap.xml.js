// 让 /sitemap.xml 直接可用。
//
// 路由逻辑本来就在 shared/api-handler.js 里（它会先把开头的 /api 去掉再匹配），
// 所以这里不需要任何新代码 —— 同一份 handler 已经实现了 '/sitemap.xml' 这个分支。
// 加上这个文件，只是把 /sitemap.xml 这个**不带 /api 前缀**的地址也接到同一个入口，
// 这样 public/robots.txt 里写的 Sitemap 地址（${origin}/sitemap.xml）才真的打得开。
//
// 注意：route.ts / route.js 里不允许导出多余的东西，所以这里只导出 onRequest。
import { handleApi } from '../shared/api-handler.js'

export const onRequest = (ctx) => handleApi({ request: ctx.request, env: ctx.env })
