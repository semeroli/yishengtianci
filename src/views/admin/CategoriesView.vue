<script setup>
import { onMounted, ref } from 'vue'
import { Api } from '../../api.js'
import { confirmDelete, toast } from '../../stores/ui.js'
import AdminEmpty from '../../components/admin/AdminEmpty.vue'
import AdminSkeleton from '../../components/admin/AdminSkeleton.vue'
import AdminModal from '../../components/admin/AdminModal.vue'

/**
 * 分类与标签
 * ─────────────────────────────────────────────────────────────
 * 两列并列。分类名与标签名是「文章身上的冗余字段」（blog_posts.category /
 * tags JSON），所以改名时后端会同步改所有文章；删除分类时如果还有文章在用，
 * 后端直接拒绝（而不是静默把文章变成野分类）。
 */

const loading = ref(true)
const cats = ref([])
const tags = ref([])
const busy = ref(false)

const catForm = ref({ open: false, id: 0, name: '', slug: '', description: '', sortOrder: 0, isNew: true })
const tagForm = ref({ open: false, id: 0, name: '', slug: '', color: '', isNew: true })
const catErr = ref('')
const tagErr = ref('')

async function load() {
  loading.value = true
  try {
    const [a, b] = await Promise.all([Api.adminCategories(), Api.adminTags()])
    cats.value = a.data.list || []
    tags.value = b.data.list || []
  } catch (e) {
    toast('加载失败：' + (e?.message || ''), 'error', 0, { label: '重试', run: load })
  } finally {
    loading.value = false
  }
}

// ── 分类 ──────────────────────────────────────────────
function newCat() {
  catErr.value = ''
  catForm.value = { open: true, id: 0, name: '', slug: '', description: '', sortOrder: 0, isNew: true }
}
function editCat(c) {
  catErr.value = ''
  catForm.value = { open: true, id: c.id, name: c.name, slug: c.slug, description: c.description, sortOrder: c.sort_order, isNew: false }
}

async function saveCat() {
  const f = catForm.value
  if (!f.name.trim()) {
    catErr.value = '分类名不能为空'
    return
  }
  busy.value = true
  try {
    const payload = { name: f.name.trim(), slug: f.slug.trim(), description: f.description, sortOrder: Number(f.sortOrder) || 0 }
    if (f.isNew) await Api.adminCreateCategory(payload)
    else await Api.adminUpdateCategory(f.id, payload)
    toast(f.isNew ? '分类已创建 ✓' : '分类已保存 ✓', 'success')
    catForm.value.open = false
    await load()
  } catch (e) {
    catErr.value = e?.message || '保存失败'
  } finally {
    busy.value = false
  }
}

async function delCat(c) {
  if (c.post_count > 0) {
    toast(`「${c.name}」还有 ${c.post_count} 篇文章在用，请先把它们改到别的分类`, 'error')
    return
  }
  const ok = await confirmDelete(`分类「${c.name}」`)
  if (!ok) return
  try {
    await Api.adminDeleteCategory(c.id)
    toast('分类已删除', 'success')
    load()
  } catch (e) {
    toast('删除失败：' + (e?.message || ''), 'error')
  }
}

// ── 标签 ──────────────────────────────────────────────
function newTag() {
  tagErr.value = ''
  tagForm.value = { open: true, id: 0, name: '', slug: '', color: '', isNew: true }
}
function editTag(t) {
  tagErr.value = ''
  tagForm.value = { open: true, id: t.id, name: t.name, slug: t.slug, color: t.color, isNew: false }
}

async function saveTag() {
  const f = tagForm.value
  if (!f.name.trim()) {
    tagErr.value = '标签名不能为空'
    return
  }
  busy.value = true
  try {
    const payload = { name: f.name.trim(), slug: f.slug.trim(), color: f.color }
    if (f.isNew) await Api.adminCreateTag(payload)
    else await Api.adminUpdateTag(f.id, payload)
    toast(f.isNew ? '标签已创建 ✓' : '标签已保存 ✓', 'success')
    tagForm.value.open = false
    await load()
  } catch (e) {
    tagErr.value = e?.message || '保存失败'
  } finally {
    busy.value = false
  }
}

async function delTag(t) {
  const tip = t.post_count > 0 ? `\n\n注意：有 ${t.post_count} 篇文章带着这个标签，删除后它们身上也会去掉该标签（文章本身不受影响）。` : ''
  const ok = await confirmDelete(`标签「${t.name}」${tip}`)
  if (!ok) return
  try {
    await Api.adminDeleteTag(t.id)
    toast('标签已删除', 'success')
    load()
  } catch (e) {
    toast('删除失败：' + (e?.message || ''), 'error')
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="adm-page-head">
      <h1>分类标签</h1>
      <span class="desc">{{ cats.length }} 个分类 · {{ tags.length }} 个标签</span>
      <span class="sp"></span>
      <button class="btn sm" type="button" :disabled="loading" @click="load">↻ 刷新</button>
    </div>

    <div class="adm-cols">
      <!-- 分类 -->
      <section class="adm-card">
        <div class="adm-card-head">
          <h3>分类管理</h3>
          <span class="sp"></span>
          <button class="btn primary sm" type="button" @click="newCat">＋ 新建分类</button>
        </div>
        <AdminSkeleton v-if="loading" :rows="4" />
        <AdminEmpty v-else-if="!cats.length" line="还没有分类" action="＋ 新建分类" @action="newCat" />
        <div v-else>
          <div v-for="c in cats" :key="c.id" class="adm-list-row">
            <div style="min-width: 0">
              <div class="nm">{{ c.name }}</div>
              <div class="sl">/{{ c.slug || '—' }}<template v-if="c.description"> · {{ c.description }}</template></div>
            </div>
            <span class="sp"></span>
            <span class="cnt">{{ c.post_count }} 篇</span>
            <button class="adm-act" type="button" @click="editCat(c)">编辑</button>
            <button class="adm-act danger" type="button" @click="delCat(c)">删除</button>
          </div>
        </div>
      </section>

      <!-- 标签 -->
      <section class="adm-card">
        <div class="adm-card-head">
          <h3>标签管理</h3>
          <span class="sp"></span>
          <button class="btn primary sm" type="button" @click="newTag">＋ 新建标签</button>
        </div>
        <AdminSkeleton v-if="loading" :rows="4" />
        <AdminEmpty v-else-if="!tags.length" line="还没有标签" sub="标签写在文章里会自动出现" action="＋ 新建标签" @action="newTag" />
        <div v-else>
          <div v-for="t in tags" :key="t.id" class="adm-list-row">
            <div style="min-width: 0">
              <div class="nm">{{ t.name }}</div>
              <div class="sl">/{{ t.slug || '—' }}</div>
            </div>
            <span class="sp"></span>
            <span class="cnt">{{ t.post_count }} 篇</span>
            <button class="adm-act" type="button" @click="editTag(t)">编辑</button>
            <button class="adm-act danger" type="button" @click="delTag(t)">删除</button>
          </div>
        </div>
      </section>
    </div>

    <!-- 分类弹窗 -->
    <AdminModal :open="catForm.open" :title="catForm.isNew ? '新建分类' : '编辑分类'" @close="catForm.open = false">
      <div class="adm-field">
        <label>名称 *</label>
        <input v-model="catForm.name" class="input" type="text" placeholder="例如：填词教程" maxlength="30" />
      </div>
      <div class="adm-field">
        <label>别名（slug，用于地址栏）</label>
        <input v-model="catForm.slug" class="input mono" type="text" placeholder="例如：tutorial" />
      </div>
      <div class="adm-field">
        <label>描述</label>
        <textarea v-model="catForm.description" class="textarea" rows="3" placeholder="一句话说明这个分类收什么内容" maxlength="200"></textarea>
      </div>
      <div class="adm-field">
        <label>排序权重（越大越靠前）</label>
        <input v-model="catForm.sortOrder" class="input" type="number" />
      </div>
      <p v-if="catErr" class="err" style="color: var(--a-danger); font-size: 0.82rem">{{ catErr }}</p>
      <p class="tiny" style="color: var(--a-text-3)">改名后，原本用旧名字的文章会一起跟着改。</p>
      <template #foot>
        <button class="btn" type="button" @click="catForm.open = false">取消</button>
        <button class="btn primary" type="button" :disabled="busy" @click="saveCat">保存</button>
      </template>
    </AdminModal>

    <!-- 标签弹窗 -->
    <AdminModal :open="tagForm.open" :title="tagForm.isNew ? '新建标签' : '编辑标签'" @close="tagForm.open = false">
      <div class="adm-field">
        <label>名称 *</label>
        <input v-model="tagForm.name" class="input" type="text" placeholder="例如：格律" maxlength="20" />
      </div>
      <div class="adm-field">
        <label>别名（slug）</label>
        <input v-model="tagForm.slug" class="input mono" type="text" placeholder="例如：gelv" />
      </div>
      <p v-if="tagErr" style="color: var(--a-danger); font-size: 0.82rem">{{ tagErr }}</p>
      <template #foot>
        <button class="btn" type="button" @click="tagForm.open = false">取消</button>
        <button class="btn primary" type="button" :disabled="busy" @click="saveTag">保存</button>
      </template>
    </AdminModal>
  </div>
</template>
