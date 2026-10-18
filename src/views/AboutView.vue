<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Api } from '../api.js'
import { setSeo, websiteJsonLd } from '../utils/seo.js'

/**
 * 关于页
 * ─────────────────────────────────────────────────────────────
 * 这一页要回答三件事：这东西是什么、生成的词为什么合律、数据存在哪。
 */

const site = ref({ site_name: '倚声 · AI填词工坊', site_desc: '', footer_note: '' })

onMounted(async () => {
  try {
    const { data } = await Api.settings()
    site.value = { ...site.value, ...data }
  } catch {}
  setSeo({
    title: '关于',
    description: '倚声是一个按《词林正韵》校验平仄韵脚的填词工具：输入意境、选词牌，得一首合律的词。',
    url: location.origin + '/about',
    jsonLd: websiteJsonLd()
  })
})
onBeforeUnmount(() => (document.title = '倚声 · AI填词工坊'))
</script>

<template>
  <div class="page wrap about">
    <section class="head reveal">
      <span class="seal kai">倚</span>
      <h1>{{ site.site_name }}</h1>
      <p class="sub">{{ site.site_desc }}</p>
    </section>

    <div class="cols">
      <section class="panel">
        <h3>这是什么</h3>
        <p>
          填词和写诗不同的地方在于：<b>词牌的格律是死的</b>。
          选定了《浣溪沙》，就是 42 个字、6 句、每句几个字、哪几句押韵、押平声还是仄声，全都定死了。
          字数不对、韵脚出部、平仄全乱，就不叫这个词牌。
        </p>
        <p>
          倚声做的是把这些死规矩替你记住：你只要负责「想说什么」，
          平仄与韵脚由引擎在词库里逐字挑选并实时校验。生成后每句都能单独重写，
          不合意就换，直到顺眼。
        </p>
      </section>

      <section class="panel">
        <h3>为什么它生成的词「合律」</h3>
        <ol class="steps">
          <li>
            <b>按句读拆块。</b>每句先按词谱切成 2 字 / 3 字的小块，
            逐块匹配平仄形状，而不是先写句子再改。
          </li>
          <li>
            <b>韵脚只从本韵部取。</b>押哪个韵部，句末就只能从该部的韵脚字里选，
            从源头杜绝「出韵」。
          </li>
          <li>
            <b>「一三五不论」当通融位。</b>奇数位允许放宽，
            偶数位与句末严格把关；放宽的地方会在字旁标出，不藏。
          </li>
          <li>
            <b>全局去重。</b>同一首词里韵脚字互不相同，也不让同一个字反复堆叠。
          </li>
        </ol>
        <p class="hint mb0">
          引擎用的是集束搜索，每次生成会从多条候选里挑整体最顺的一条，
          所以同一个意境两次生成结果不同是正常的。
        </p>
      </section>

      <section class="panel">
        <h3>关于 AI 通道</h3>
        <p>
          站点支持接大模型：配上 API Key 后，会先请模型写一稿，
          再<b>逐句校验</b>字数、平仄、韵脚、重韵——任何一句不达标，整首退回本地引擎重做。
        </p>
        <p>
          这样做的理由很简单：模型写词常犯「看着像那么回事、其实字数都不对」的毛病。
          宁可给你一首朴素的合律词，也不给一首漂亮的出律词。
        </p>
        <p class="hint mb0">
          当前状态：<b>{{ site.aiEnabled ? '已接入大模型' : '本地格律引擎' }}</b>。
        </p>
      </section>

      <section class="panel">
        <h3>数据与隐私</h3>
        <ul class="plain">
          <li>词笺收藏按浏览器里的一个随机标识保存，<b>不收集姓名、手机号、邮箱</b>。</li>
          <li>评论可留昵称和邮箱，邮箱仅用于识别，<b>不会公开展示</b>。</li>
          <li>生成的词作会记入统计（用于看哪个词牌受欢迎），不含任何个人身份信息。</li>
          <li>清除浏览器数据会一并清掉词笺，重要作品请先生成图片保存。</li>
        </ul>
      </section>

      <section class="panel">
        <h3>体例说明</h3>
        <ul class="plain">
          <li><b>平仄符号</b>：○ 平声，● 仄声，◐ 可平可仄。</li>
          <li><b>韵脚标色</b>：句末朱砂红 = 押韵字。</li>
          <li><b>字旁小点</b>：○ 平 ● 仄；点色发红表示该字用了通融位。</li>
          <li><b>「正格 / 变体 / 破格」</b>：全句严守词谱为「正格」；只用通融位为「变体」；偶数位或句末失守为「破格」。</li>
        </ul>
      </section>

      <section class="panel">
        <h3>致谢与版权</h3>
        <p>
          词牌格律谱参照《钦定词谱》与《词林正韵》整理；名句灵感全部取自唐宋词
          （原作者均已过世千年以上，属公有领域），标注作者与出处，不做二次创作。
        </p>
        <p class="hint mb0">
          生成工具按下「起韵填词」后得到的作品，版权归你。发表时提一句「倚声」就更好了。
        </p>
      </section>
    </div>

    <footer class="tail center small muted">{{ site.footer_note }}</footer>
  </div>
</template>

<style scoped>
.about {
  max-width: 980px;
  margin: 0 auto;
}
.head {
  text-align: center;
  padding: 18px 0 30px;
}
.seal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  background: var(--cinnabar-solid); /* 印面底色：上面压的是浅色「倚」字，必须用 solid 那支 */
  color: #fbf4ea;
  border-radius: 6px;
  font-size: 1.5rem;
  margin-bottom: 12px;
  box-shadow: var(--shadow-2);
}
.head h1 {
  font-family: var(--font-kai);
  font-size: clamp(1.5rem, 3.4vw, 2rem);
  letter-spacing: 0.18em;
  margin: 0 0 10px;
}
.head .sub {
  color: var(--ink-2);
  margin: 0;
  line-height: 1.95;
}
.cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(310px, 1fr));
  gap: 18px;
}
.panel h3 {
  margin: 0 0 13px;
  padding-left: 11px;
  border-left: 3px solid var(--cinnabar);
  font-size: 1.08rem;
}
.panel p {
  color: var(--ink-2);
  line-height: 2.05;
  font-size: 0.94rem;
  margin: 0 0 12px;
}
.panel p:last-child {
  margin-bottom: 0;
}
.steps {
  margin: 0 0 12px;
  padding-left: 20px;
  color: var(--ink-2);
  line-height: 2;
  font-size: 0.94rem;
}
.steps li {
  margin-bottom: 9px;
}
.steps b {
  color: var(--ink);
}
.plain {
  margin: 0;
  padding-left: 18px;
  color: var(--ink-2);
  line-height: 2;
  font-size: 0.94rem;
}
.plain li {
  margin-bottom: 7px;
}
.plain b {
  color: var(--ink);
}
.tail {
  margin-top: 34px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
  font-family: var(--font-kai);
  letter-spacing: 0.1em;
}
</style>
