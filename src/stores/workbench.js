import { computed, reactive, ref } from 'vue'
import { Api, visitorId } from '../api.js'
import { toast } from './ui.js'

/**
 * 填词工作台状态
 * ─────────────────────────────────────────────────────────────
 * 「换整首」= 重新生成全篇（新种子）；
 * 「换一句」= 只替换某一句，并给该句记一个新的动画版本号，
 *             让词作区只重放这一句的落笔动画，而不是整篇重来。
 */

const cipaiList = ref([])
const cipaiLoaded = ref(false)
const cipaiError = ref('')

const prompt = ref('')
const selectedId = ref('huanxisha')
const pickerMode = ref(localStorage.getItem('ys_picker_mode') || 'grid') // grid | list
const filterStyle = ref('')
const filterSize = ref('')
const vertical = ref(localStorage.getItem('ys_vertical') !== '0')

const poem = ref(null)
const generating = ref(false)
const genError = ref('')
const changingLine = ref(-1)
const lineAnim = reactive({})

const favorites = ref([])
const favLoading = ref(false)

const inspiration = ref(null)

const selectedCipai = computed(() => cipaiList.value.find((c) => c.id === selectedId.value) || null)

const filteredCipai = computed(() => {
  let list = cipaiList.value
  if (filterStyle.value) list = list.filter((c) => c.styleTag === filterStyle.value)
  if (filterSize.value === 'short') list = list.filter((c) => c.syllables <= 45)
  else if (filterSize.value === 'mid') list = list.filter((c) => c.syllables > 45 && c.syllables <= 60)
  else if (filterSize.value === 'long') list = list.filter((c) => c.syllables > 60)
  return list
})

const isFavorited = computed(() => {
  if (!poem.value?.id) return false
  return favorites.value.some((f) => f.target_type === 'poem' && f.target_id === poem.value.id)
})

export function useWorkbench() {
  async function loadCipai(force = false) {
    if (cipaiLoaded.value && !force) return cipaiList.value
    try {
      const { data } = await Api.cipai()
      cipaiList.value = data.list || []
      cipaiError.value = ''
      cipaiLoaded.value = true
      if (!cipaiList.value.some((c) => c.id === selectedId.value)) {
        const first = cipaiList.value.find((c) => c.generatable) || cipaiList.value[0]
        if (first) selectedId.value = first.id
      }
    } catch (e) {
      cipaiError.value = e.message || '词牌加载失败'
    }
    return cipaiList.value
  }

  async function loadInspiration() {
    try {
      const { data } = await Api.inspiration()
      inspiration.value = data.item
    } catch {}
  }

  function setPickerMode(m) {
    pickerMode.value = m
    try {
      localStorage.setItem('ys_picker_mode', m)
    } catch {}
  }

  function setVertical(v) {
    vertical.value = v
    try {
      localStorage.setItem('ys_vertical', v ? '1' : '0')
    } catch {}
  }

  async function generate(seed) {
    const c = selectedCipai.value
    if (!c) {
      genError.value = '请先选择一个词牌'
      return
    }
    if (!c.generatable) {
      genError.value = c.note || `《${c.name}》的格律谱尚未整理，暂不支持自动填词`
      return
    }
    if (prompt.value.trim().length < 4) {
      genError.value = '请先写下你的意境（至少几个字）'
      return
    }
    generating.value = true
    genError.value = ''
    try {
      const { data } = await Api.generate({
        cipaiId: c.id,
        prompt: prompt.value.trim(),
        seed: seed ?? ((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0)
      })
      poem.value = data
      for (const k of Object.keys(lineAnim)) delete lineAnim[k]
      data.lines.forEach((_, i) => {
        lineAnim[i] = 1
      })
      if (data.engineNote) toast(data.engineNote, 'info', 4200)
    } catch (e) {
      genError.value = e.message || '生成失败'
    } finally {
      generating.value = false
    }
  }

  async function changeLine(index) {
    const p = poem.value
    if (!p || changingLine.value >= 0) return
    changingLine.value = index
    try {
      const { data } = await Api.generateLine({
        cipaiId: p.cipaiId,
        lineIndex: index,
        prompt: prompt.value.trim() || p.prompt,
        avoid: [p.lines[index].text]
      })
      p.lines[index] = { ...p.lines[index], ...data }
      lineAnim[index] = (lineAnim[index] || 1) + 1
    } catch (e) {
      toast(e.message || '换句失败', 'error')
    } finally {
      changingLine.value = -1
    }
  }

  async function loadFavorites() {
    favLoading.value = true
    try {
      const { data } = await Api.favorites()
      favorites.value = data.list || []
    } catch {
      favorites.value = []
    } finally {
      favLoading.value = false
    }
  }

  async function toggleFavorite() {
    if (!poem.value) return
    if (!poem.value.id) {
      toast('这首词还没存到服务器，无法收藏', 'error')
      return
    }
    await loadFavorites()
    const hit = favorites.value.find((f) => f.target_type === 'poem' && f.target_id === poem.value.id)
    try {
      if (hit) {
        await Api.removeFavorite(hit.id)
        favorites.value = favorites.value.filter((f) => f.id !== hit.id)
        toast('已从词笺移出', 'info')
      } else {
        await Api.addFavorite({
          targetType: 'poem',
          targetId: poem.value.id,
          snapshot: {
            cipaiName: poem.value.cipaiName,
            text: poem.value.lines.map((l) => l.text).join('|'),
            prompt: poem.value.prompt,
            engine: poem.value.engine
          }
        })
        await loadFavorites()
        toast('已收入词笺', 'success')
      }
    } catch (e) {
      toast(e.message || '操作失败', 'error')
    }
  }

  function setPoemFromFavorite(snapshot) {
    toast('词笺里保存的是快照，完整词作请重新生成', 'info')
  }

  return {
    cipaiList,
    cipaiLoaded,
    cipaiError,
    prompt,
    selectedId,
    selectedCipai,
    pickerMode,
    setPickerMode,
    filterStyle,
    filterSize,
    filteredCipai,
    vertical,
    setVertical,
    poem,
    generating,
    genError,
    changingLine,
    lineAnim,
    favorites,
    favLoading,
    isFavorited,
    inspiration,
    loadCipai,
    loadInspiration,
    generate,
    changeLine,
    loadFavorites,
    toggleFavorite,
    setPoemFromFavorite,
    visitorId
  }
}
