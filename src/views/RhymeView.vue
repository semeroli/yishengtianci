<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import RhymeLookup from '../components/RhymeLookup.vue'
import { Api } from '../api.js'
import { setSeo } from '../utils/seo.js'

/* 韵部 / 韵字的口径一律**从接口现算**，不写死 ——
   上一轮把韵库从 12 部补到 20 部之后，这页还写着「只收最常用的十二个韵部（八平四仄）」。
   默认值 = 接口没通时的兜底，等于当前真实值。 */
const parts = ref(20)
const ping = ref(12)
const ze = ref(8)
const chars = ref(1599)

onMounted(async () => {
  setSeo({
    title: '韵书速查',
    description: '词林正韵简表与查字归韵：输入一个字，看它属于哪个韵部、是平声还是仄声，写词选韵一步到位。',
    url: location.origin + '/rhyme'
  })
  try {
    const { data } = await Api.rhyme()
    if (data?.parts) {
      parts.value = data.parts
      ping.value = data.pingParts ?? ping.value
      ze.value = data.parts - ping.value
      chars.value = data.totalChars ?? chars.value
    }
  } catch {
    /* 接口不通就保持默认值 —— 页面照样完整 */
  }
})
onBeforeUnmount(() => (document.title = '倚声 · AI填词工坊'))
</script>

<template>
  <div class="page wrap">
    <section class="head reveal">
      <h1>韵书速查</h1>
      <p class="sub">
        词韵与诗韵不同：诗依《平水韵》，词依《词林正韵》。
        词林正韵把邻近的韵合并成十九部，因此词里「东」「冬」可通押，诗里却不行。
      </p>
    </section>

    <section class="panel">
      <RhymeLookup tab="lookup" />
    </section>

    <hr class="rule" />

    <section class="notes panel">
      <h3>三个常被问到的韵学问题</h3>

      <div class="qa">
        <h4>一、平声韵和仄声韵怎么选？</h4>
        <p>
          看词牌。<b>规定押平声韵</b>的词牌（忆江南、浣溪沙、鹧鸪天、水调歌头）只能用平声字收句；
          <b>规定押仄声韵</b>的（如梦令、点绛唇、蝶恋花）只能用仄声字。
          标了「换韵」的（菩萨蛮、虞美人）则要按句换部，且新旧韵部之间通常一平一仄交替。
        </p>
      </div>

      <div class="qa">
        <h4>二、什么是「一三五不论，二四六分明」？</h4>
        <p>
          词句的平仄谱上标了 ○（平）●（仄）◐（可平可仄）。
          当你手上没有完全合谱的字时，<b>奇数位（第 1、3、5 字）可以通融</b>，
          偶数位和句末字必须严守——因为它们决定这句话的「骨架」。
          本工具生成时会如实标注哪些字用了通融位。
        </p>
      </div>

      <div class="qa">
        <h4>三、重韵、同字韵要避免吗？</h4>
        <p>
          要。同一个韵脚字在一首词里出现两次叫「重韵」，是硬伤；韵脚用同一个字收尾也犯忌。
          本工具生成时会做全局去重，所以同一首词里的韵脚字互不相同。
        </p>
      </div>

      <p class="hint mb0">
        本简表收录常用韵部 {{ parts }} 个（平声 {{ ping }} 部、仄声 {{ ze }} 部），
        共 {{ chars }} 个韵字，是「够用」而非「完备」。
        未收录的字不代表不合韵，正式创作建议对照《词林正韵》原书。
      </p>
    </section>
  </div>
</template>

<style scoped>
.head {
  padding: 12px 0 20px;
}
.head h1 {
  font-family: var(--font-kai);
  font-size: clamp(1.6rem, 3.4vw, 2.1rem);
  letter-spacing: 0.14em;
  margin: 0 0 10px;
}
.head .sub {
  color: var(--ink-2);
  line-height: 2;
  margin: 0;
  max-width: 760px;
}
.notes h3 {
  margin-top: 0;
}
.qa {
  padding: 14px 0 12px;
  border-top: 1px dashed var(--line);
}
.qa:first-of-type {
  border-top: 0;
  padding-top: 6px;
}
.qa h4 {
  margin: 0 0 7px;
  color: var(--ink);
  font-size: 1rem;
}
.qa p {
  margin: 0;
  color: var(--ink-2);
  line-height: 2;
  font-size: 0.94rem;
}
</style>
