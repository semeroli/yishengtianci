<script setup>
import { computed, onMounted, ref } from 'vue'
import { loadBranding, BRAND_DEFAULTS, hasCustomLogo, SEAL_TEXT } from '../utils/branding.js'

// 与顶栏共用同一个 loadBranding() 缓存，页脚不再单独打一次设置接口
const site = ref({ ...BRAND_DEFAULTS })
const customLogo = computed(() => hasCustomLogo(site.value.logo))

onMounted(async () => {
  site.value = await loadBranding()
})
const year = new Date().getFullYear()
</script>

<template>
  <footer class="ftr no-print">
    <div class="wrap">
      <div class="rule"></div>
      <div class="ftr-grid">
        <div>
          <div class="ftr-brand">
            <span v-if="customLogo" class="lamp">{{ site.logo }}</span>
            <span v-else class="brand-seal" aria-hidden="true">{{ SEAL_TEXT }}</span>
            <b>{{ site.site_name || '倚声 · AI填词工坊' }}</b>
          </div>
          <p class="small muted mb0">{{ site.site_desc || '输入一段意境，选一个词牌，得一首合律的词。' }}</p>
        </div>
        <div>
          <h4>逛一逛</h4>
          <ul>
            <li><RouterLink to="/studio">填词工作台</RouterLink></li>
            <li><RouterLink to="/blog">填词博客</RouterLink></li>
            <li><RouterLink to="/rhyme">词林正韵速查</RouterLink></li>
            <li><RouterLink to="/favorites">我的词笺</RouterLink></li>
          </ul>
        </div>
        <div>
          <h4>关于格律</h4>
          <p class="small muted mb0">
            格律依龙榆生《唐宋词格律》通行体整理；韵部依《词林正韵》常用字表。
            词牌多有一体（正格）与变体，本站在解析中会分别标出。
          </p>
        </div>
        <div v-if="site.social_weibo || site.social_wechat || site.social_email">
          <h4>联系</h4>
          <ul>
            <li v-if="site.social_weibo"><a :href="site.social_weibo" target="_blank" rel="noopener">微博</a></li>
            <li v-if="site.social_wechat">微信：{{ site.social_wechat }}</li>
            <li v-if="site.social_email"><a :href="`mailto:${site.social_email}`">邮件</a></li>
          </ul>
        </div>
      </div>
      <div class="ftr-bottom small muted">
        <span>© {{ year }} {{ site.site_name || '倚声' }}　{{ site.footer_note || '倚声填词，以韵为骨。' }}</span>
        <span class="kai">「倚声」者，依词调之声以填词也。</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.ftr {
  margin-top: 48px;
  padding-bottom: 34px;
}
.ftr-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1.6fr 1fr;
  gap: 26px;
  font-size: 0.9rem;
}
.ftr-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ftr-brand b {
  letter-spacing: 0.06em;
}
.lamp {
  font-size: 1.15rem;
}
/* 与顶栏、favicon 同一枚朱砂方印 */
.brand-seal {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 3px;
  background: linear-gradient(135deg, #ce4a40, #9c2a25);
  color: #fdf6ec;
  font-family: var(--font-serif);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
}
.ftr h4 {
  font-size: 0.86rem;
  color: var(--ink-2);
  letter-spacing: 0.14em;
  margin-bottom: 10px;
  font-weight: 600;
}
.ftr ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ftr ul a {
  color: var(--ink-2);
}
.ftr ul a:hover {
  color: var(--cinnabar);
}
.ftr-bottom {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 22px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
@media (max-width: 860px) {
  .ftr-grid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 560px) {
  .ftr-grid {
    grid-template-columns: 1fr;
  }
}
</style>
