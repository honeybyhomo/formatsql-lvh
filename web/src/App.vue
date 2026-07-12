<script setup>
import { ref, reactive, watch, onMounted } from 'vue'
import { prettify } from './lib/prettify.js'

const input = ref('')
const output = ref('')
const copied = ref(false)

// Radio-based option groups. Each is a mutually-exclusive *style*.
const options = reactive({
  layout: 'perKeyword', // 'oneLine' | 'perKeyword' | 'perKeywordSub'
  alignment: 'off', // 'off' (river) | 'aligned'
  capitalization: 'unchanged', // 'unchanged' | 'keywords'
  aliases: 'unchanged', // 'unchanged' | 'as' | 'bare'
  variables: 'repeated', // 'none' | 'repeated' (>=2) | 'all'
  unwrapDateFormat: true, // DATE_FORMAT(d,'%Y-%m-%d') -> d
  unwrapVariables: true, // '@var' -> @var (only when the whole literal is one var)
})

const OPT_KEY = 'formatsql:options:v2'
const INPUT_KEY = 'formatsql:input'

onMounted(() => {
  try {
    const saved = localStorage.getItem(OPT_KEY)
    if (saved) Object.assign(options, JSON.parse(saved))
  } catch (e) {
    /* ignore corrupt storage */
  }
  const savedInput = localStorage.getItem(INPUT_KEY)
  if (savedInput) input.value = savedInput
})

let timer
watch(
  [input, options],
  () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        output.value = input.value.trim() ? prettify(input.value, options) : ''
      } catch (e) {
        output.value = '⚠️ ' + e.message
      }
      localStorage.setItem(INPUT_KEY, input.value)
      localStorage.setItem(OPT_KEY, JSON.stringify(options))
    }, 150)
  },
  { deep: true }
)

function copyOutput() {
  if (!output.value || output.value.startsWith('⚠️')) return
  navigator.clipboard.writeText(output.value).then(() => {
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  })
}

function preset(name) {
  if (name === 'pretty') {
    Object.assign(options, {
      layout: 'perKeywordSub',
      alignment: 'aligned',
      capitalization: 'keywords',
      aliases: 'as',
      variables: 'repeated',
      unwrapDateFormat: true,
      unwrapVariables: true,
    })
  } else if (name === 'reset') {
    Object.assign(options, {
      layout: 'perKeyword',
      alignment: 'off',
      capitalization: 'unchanged',
      aliases: 'unchanged',
      variables: 'none',
      unwrapDateFormat: false,
      unwrapVariables: false,
    })
  }
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <h1>FormatSQL</h1>
      <span class="sub">layout · alignment · case · aliases · variables — for Google Sheets SQL</span>
    </header>

    <section class="options">
      <div class="opt-group">
        <span class="opt-title">Layout</span>
        <label><input type="radio" value="oneLine" v-model="options.layout" /> Single line</label>
        <label><input type="radio" value="perKeyword" v-model="options.layout" /> Keywords / line</label>
        <label><input type="radio" value="perKeywordSub" v-model="options.layout" /> + Subqueries</label>
      </div>

      <div class="opt-group">
        <span class="opt-title">Alignment</span>
        <label><input type="radio" value="off" v-model="options.alignment" /> River</label>
        <label><input type="radio" value="aligned" v-model="options.alignment" /> Aligned</label>
      </div>

      <div class="opt-group">
        <span class="opt-title">Case</span>
        <label><input type="radio" value="unchanged" v-model="options.capitalization" /> Unchanged</label>
        <label><input type="radio" value="keywords" v-model="options.capitalization" /> Keywords</label>
      </div>

      <div class="opt-group">
        <span class="opt-title">Aliases</span>
        <label><input type="radio" value="unchanged" v-model="options.aliases" /> Unchanged</label>
        <label><input type="radio" value="as" v-model="options.aliases" /> With AS</label>
        <label><input type="radio" value="bare" v-model="options.aliases" /> Without AS</label>
      </div>

      <div class="opt-group">
        <span class="opt-title">Variables</span>
        <label><input type="radio" value="none" v-model="options.variables" /> None</label>
        <label><input type="radio" value="repeated" v-model="options.variables" /> Repeated ≥2</label>
        <label><input type="radio" value="all" v-model="options.variables" /> All</label>
      </div>

      <div class="opt-group">
        <span class="opt-title">Simplify</span>
        <label title="DATE_FORMAT(col, '%Y-%m-%d') → col (assumes the column is DATE-typed)">
          <input type="checkbox" v-model="options.unwrapDateFormat" /> Unwrap DATE_FORMAT
        </label>
        <label title="Strip quotes off a variable literal whose entire content is one @var">
          <input type="checkbox" v-model="options.unwrapVariables" /> Unwrap '@vars'
        </label>
      </div>

      <span class="presets">
        <button @click="preset('pretty')">Pretty</button>
        <button @click="preset('reset')">Reset</button>
      </span>
    </section>

    <main class="grid">
      <div class="pane">
        <div class="pane-head">Query</div>
        <textarea v-model="input" spellcheck="false" placeholder="Paste SQL here…"></textarea>
      </div>
      <div class="pane output" @click="copyOutput" :title="output ? 'Click to copy' : ''">
        <div class="pane-head">
          <span>{{ copied ? '✓ Copied!' : 'Output' }}</span>
          <span class="hint" v-if="output && !output.startsWith('⚠️')">click to copy</span>
        </div>
        <pre>{{ output }}</pre>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 16px;
  gap: 12px;
}

.topbar {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.topbar h1 {
  font-size: 18px;
  margin: 0;
  color: var(--accent);
  letter-spacing: 0.5px;
}
.topbar .sub {
  color: var(--muted);
  font-size: 12px;
}

.options {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px 20px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
}
.opt-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.opt-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--muted);
}
.opt-group label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--text);
  font-size: 13px;
}
.opt-group input[type='radio'] {
  accent-color: var(--accent);
  width: 14px;
  height: 14px;
}
.opt-group input[type='checkbox'] {
  accent-color: var(--accent);
  width: 14px;
  height: 14px;
}
.presets {
  margin-left: auto;
  align-self: flex-start;
  display: flex;
  gap: 8px;
}
.presets button {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
}
.presets button:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.pane {
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  min-height: 0;
}
.pane-head {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--muted);
  background: var(--panel-2);
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
}
.pane.output {
  cursor: pointer;
}
.pane.output:hover {
  border-color: var(--accent);
}
.hint {
  color: var(--muted);
  font-size: 11px;
}
textarea {
  flex: 1;
  border: 0;
  outline: 0;
  resize: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  padding: 12px;
  line-height: 1.6;
}
pre {
  flex: 1;
  margin: 0;
  padding: 12px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
}

@media (max-width: 800px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
