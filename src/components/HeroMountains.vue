<script setup>
/**
 * 顶部横幅：淡墨远山 + 孤舟渔翁
 * 极简线条山水，全部内联 SVG —— 不额外请求、主题切换自动跟随。
 * 支持 scrollY 传入做缓慢视差。
 */
const props = defineProps({
  height: { type: Number, default: 260 },
  parallax: { type: Number, default: 0 }
})
</script>

<template>
  <div class="hero" :style="{ height: props.height + 'px' }" aria-hidden="true">
    <div class="hero-inner parallax-slow" :style="{ transform: `translateY(${props.parallax}px)` }">
      <svg viewBox="0 0 1200 320" preserveAspectRatio="xMidYMax slice" class="hero-svg">
        <defs>
          <linearGradient id="mistFar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--ink-3)" stop-opacity="0.30" />
            <stop offset="100%" stop-color="var(--ink-3)" stop-opacity="0.02" />
          </linearGradient>
          <linearGradient id="mistMid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--ink-2)" stop-opacity="0.38" />
            <stop offset="100%" stop-color="var(--ink-2)" stop-opacity="0.03" />
          </linearGradient>
          <linearGradient id="mistNear" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--ink)" stop-opacity="0.42" />
            <stop offset="100%" stop-color="var(--ink)" stop-opacity="0.04" />
          </linearGradient>
        </defs>

        <!-- 远山：三重淡墨，愈远愈轻 -->
        <path
          d="M0 214 L96 168 C124 150 148 150 172 166 L232 202 L286 172 C316 152 344 152 372 170 L430 206 L470 186 C500 170 528 170 556 188 L612 218 L666 190 C696 172 722 172 750 190 L806 220 L856 196 C886 178 912 178 940 196 L1000 224 L1060 200 C1090 184 1116 184 1144 202 L1200 226 L1200 320 L0 320 Z"
          fill="url(#mistFar)"
        />
        <path
          d="M0 246 L84 206 C112 190 138 190 164 208 L214 246 L268 214 C300 194 330 196 358 216 L412 254 L468 224 C498 206 524 208 550 228 L604 264 L664 230 C694 212 720 214 746 232 L800 266 L860 238 C892 220 918 222 944 240 L1000 272 L1058 244 C1088 226 1114 228 1140 246 L1200 278 L1200 320 L0 320 Z"
          fill="url(#mistMid)"
        />
        <path
          d="M0 280 L70 254 C100 242 126 244 152 258 L196 284 L252 258 C284 240 312 242 340 260 L392 292 L452 264 C482 246 508 248 534 266 L586 296 L648 268 C680 250 706 252 732 270 L786 298 L846 274 C878 258 904 260 930 278 L984 300 L1046 276 C1076 260 1102 262 1128 280 L1200 306 L1200 320 L0 320 Z"
          fill="url(#mistNear)"
        />

        <!-- 水波：极细横线，愈远愈疏 -->
        <g stroke="var(--ink-3)" stroke-width="0.8" opacity="0.28" stroke-linecap="round">
          <line x1="120" y1="292" x2="266" y2="292" />
          <line x1="330" y1="298" x2="520" y2="298" />
          <line x1="600" y1="290" x2="700" y2="290" />
          <line x1="760" y1="300" x2="960" y2="300" />
          <line x1="210" y1="306" x2="430" y2="306" />
          <line x1="640" y1="310" x2="880" y2="310" />
        </g>

        <!-- 孤舟渔翁：一笔船身，两笔人形，一竿一笠 -->
        <g class="boat">
          <path
            d="M556 288 C566 296 596 296 606 288 L600 284 L562 284 Z"
            fill="var(--ink-2)"
            opacity="0.85"
          />
          <!-- 蓑笠 -->
          <path d="M574 284 l4 -7 l9 0 l4 7 z" fill="var(--ink)" opacity="0.8" />
          <!-- 身 -->
          <path d="M581 277 l0 7" stroke="var(--ink)" stroke-width="1.4" opacity="0.8" />
          <!-- 钓竿 -->
          <path d="M582 276 L600 258" stroke="var(--ink)" stroke-width="0.9" opacity="0.65" />
          <!-- 水痕 -->
          <path d="M552 292 C566 296 598 296 610 292" stroke="var(--ink-3)" stroke-width="0.7" fill="none" opacity="0.5" />
        </g>
      </svg>
    </div>
    <div class="hero-fade"></div>
  </div>
</template>

<style scoped>
.hero {
  position: relative;
  width: 100%;
  overflow: hidden;
  pointer-events: none;
  /* 入场：水墨晕染扩散 */
  animation: inkSpread 1100ms var(--ease-ink) both;
}
.hero-inner {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.hero-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.hero-fade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 70px;
  background: linear-gradient(to bottom, transparent, var(--paper) 92%);
}
.boat {
  animation: boatDrift 22s ease-in-out infinite alternate;
}
@keyframes boatDrift {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(26px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .boat {
    animation: none;
  }
}
</style>
