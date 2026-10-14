// 让 /robots.txt 直接可用（内容由 shared/api-handler.js 的 '/robots.txt' 分支生成，
// 里面会带上 Sitemap 地址）。与 functions/sitemap.xml.js 同理，只做一层转发。
import { handleApi } from '../shared/api-handler.js'

export const onRequest = (ctx) => handleApi({ request: ctx.request, env: ctx.env })
