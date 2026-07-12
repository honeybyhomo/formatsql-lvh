<script setup>
import { ref, reactive, watch, onMounted } from 'vue'
import { prettify } from './lib/prettify.js'

const input = ref('')
const output = ref('')
const copied = ref(false)

const options = reactive({
  compact: true,
  variabilize: true,
  variabilizeAll: false,
  simplifyDateFormat: true,
  unwrapQuotedVariables: true,
})

const OPT_KEY = 'formatsql:options'
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
  if (name === 'all') {
    Object.assign(options, {
      compact: true,
      variabilize: true,
      variabilizeAll: false,
      simplifyDateFormat: true,
      unwrapQuotedVariables: true,
    })
  } else if (name === 'none') {
    Object.assign(options, {
      compact: false,
      variabilize: false,
      variabilizeAll: false,
      simplifyDateFormat: false,
      unwrapQuotedVariables: false,
    })
  }
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <h1>FormatSQL</h1>
      <span class="sub">compact · variabilize · simplify — for Google Sheets SQL</span>
    </header>

    <section class="options">
      <label><input type="checkbox" v-model="options.compact" /> Compact</label>
      <label><input type="checkbox" v-model="options.variabilize" /> Variabilize (≥2×)</label>
      <label :class="{ disabled: !options.variabilize }">
        <input
          type="checkbox"
          v-model="options.variabilizeAll"
          :disabled="!options.variabilize"
        />
        Variabilize all
      </label>
      <label><input type="checkbox" v-model="options.simplifyDateFormat" /> Simplify DATE_FORMAT</label>
      <label><input type="checkbox" v-model="options.unwrapQuotedVariables" /> Unquote '@vars'</label>
      <span class="presets">
        <button @click="preset('all')">All</button>
        <button @click="preset('none')">Reset</button>
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
  align-items: center;
  gap: 16px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
}
.options label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--text);
}
.options label.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.options input[type='checkbox'] {
  accent-color: var(--accent);
  width: 15px;
  height: 15px;
}
.presets {
  margin-left: auto;
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
