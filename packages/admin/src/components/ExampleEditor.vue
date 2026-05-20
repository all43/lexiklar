<template>
  <div class="ex-editor">
    <!-- Annotated text -->
    <div class="ex-editor-section">
      <div class="ex-editor-label">German text</div>
      <div class="annotated-text" @click="onTextClick">
        <template v-for="(seg, i) in segments" :key="i">
          <span
            v-if="seg.annIdx != null"
            class="ann-span"
            :class="{
              selected: selectedAnn === seg.annIdx,
              'ann-form2': seg.part === 'form2',
              'ann-verb': editAnnotations[seg.annIdx]?.pos === 'verb',
              'ann-noun': editAnnotations[seg.annIdx]?.pos === 'noun',
              'ann-adj': editAnnotations[seg.annIdx]?.pos === 'adjective',
            }"
            :data-ann-idx="seg.annIdx"
            @click.stop="selectAnnotation(seg.annIdx)"
          >{{ seg.text }}</span>
          <span
            v-else
            class="plain-text"
            :data-word-start="seg.wordStart"
            :data-word-end="seg.wordEnd"
          >{{ seg.text }}</span>
        </template>
      </div>
    </div>

    <!-- Translation -->
    <div class="ex-editor-section">
      <div class="ex-editor-label">Translation</div>
      <textarea
        v-model="editTranslation"
        class="ex-editor-textarea"
        rows="2"
      ></textarea>
    </div>

    <!-- Annotations list -->
    <div class="ex-editor-section">
      <div class="ex-editor-label">
        Annotations
        <span v-if="!addingAnnotation" class="ann-tip">Click an unhighlighted word to annotate</span>
      </div>

      <!-- Add annotation form -->
      <div v-if="addingAnnotation" class="add-ann-form">
        <div class="add-ann-hint">Click a word in the text above to select it, or type manually:</div>
        <div class="add-ann-fields">
          <label>
            <span class="field-label">Form</span>
            <input v-model="newAnn.form" class="ann-input" placeholder="word as in text" />
          </label>
          <label>
            <span class="field-label">Lemma</span>
            <div class="lemma-autocomplete">
              <input
                v-model="newAnn.lemma"
                class="ann-input"
                :class="lemmaInputClass(newAnn.lemma, newAnn.pos)"
                placeholder="dictionary form"
                @input="onLemmaInput(newAnn.lemma, newAnn.pos, 'new')"
                @focus="lemmaDropdownTarget = 'new'"
                @blur="closeLemmaDropdown"
              />
              <span class="lemma-status" :class="lemmaStatusClass(newAnn.lemma, newAnn.pos)">{{ lemmaStatusIcon(newAnn.lemma, newAnn.pos) }}</span>
              <div v-if="lemmaResults.length && lemmaDropdownTarget === 'new'" class="lemma-dropdown">
                <div
                  v-for="r in lemmaResults"
                  :key="r.pos + '/' + r.word"
                  class="lemma-option"
                  @mousedown.prevent="pickNewLemma(r)"
                >
                  <span class="lemma-word">{{ r.word }}</span>
                  <span class="lemma-pos">{{ r.pos }}</span>
                  <span v-if="r.gloss_en" class="lemma-gloss">{{ r.gloss_en }}</span>
                </div>
              </div>
            </div>
          </label>
          <label>
            <span class="field-label">POS</span>
            <select v-model="newAnn.pos" class="ann-select">
              <option v-for="p in POS_OPTIONS" :key="p" :value="p">{{ p }}</option>
            </select>
          </label>
          <label>
            <span class="field-label">Hint</span>
            <input v-model="newAnn.gloss_hint" class="ann-input" placeholder="sense hint (optional)" />
          </label>
        </div>
        <div class="add-ann-form2">
          <label v-if="!newAnn.form2">
            <button class="btn-link-form2" @click="startLinkForm2('new')">Link prefix/particle</button>
          </label>
          <div v-else class="form2-display">
            form2: "{{ newAnn.form2 }}"
            <button class="btn-remove-form2" @click="newAnn.form2 = undefined; newAnn.form2_index = undefined">×</button>
          </div>
        </div>
        <div class="add-ann-actions">
          <button class="btn-confirm-add" @click="confirmAddAnnotation" :disabled="!newAnn.form || !newAnn.lemma">Add</button>
          <button class="btn-cancel-add" @click="cancelAddAnnotation">Cancel</button>
        </div>
      </div>

      <!-- Existing annotations -->
      <div v-for="(ann, idx) in editAnnotations" :key="idx" class="ann-row" :class="{ expanded: selectedAnn === idx }">
        <div class="ann-row-summary" @click="toggleAnnotation(idx)">
          <span class="ann-form-label">"{{ ann.form }}"</span>
          <span class="ann-arrow">→</span>
          <span class="ann-lemma-label">{{ ann.lemma }}</span>
          <span class="ann-pos-badge">{{ ann.pos }}</span>
          <span v-if="ann.gloss_hint" class="ann-hint-badge">{{ ann.gloss_hint }}</span>
          <span v-if="ann.form2" class="ann-form2-badge">{{ ann.form2 }}</span>
          <button class="btn-remove-ann" @click.stop="removeAnnotation(idx)" title="Remove annotation">×</button>
        </div>

        <div v-if="selectedAnn === idx" class="ann-row-detail">
          <div class="ann-detail-fields">
            <label>
              <span class="field-label">Lemma</span>
              <div class="lemma-autocomplete">
                <input
                  v-model="ann.lemma"
                  class="ann-input"
                  :class="lemmaInputClass(ann.lemma, ann.pos)"
                  @input="onLemmaInput(ann.lemma, ann.pos, idx)"
                  @focus="lemmaDropdownTarget = idx"
                  @blur="closeLemmaDropdown"
                />
                <span class="lemma-status" :class="lemmaStatusClass(ann.lemma, ann.pos)">{{ lemmaStatusIcon(ann.lemma, ann.pos) }}</span>
                <div v-if="lemmaResults.length && lemmaDropdownTarget === idx" class="lemma-dropdown">
                  <div
                    v-for="r in lemmaResults"
                    :key="r.pos + '/' + r.word"
                    class="lemma-option"
                    @mousedown.prevent="pickExistingLemma(idx, r)"
                  >
                    <span class="lemma-word">{{ r.word }}</span>
                    <span class="lemma-pos">{{ r.pos }}</span>
                    <span v-if="r.gloss_en" class="lemma-gloss">{{ r.gloss_en }}</span>
                  </div>
                </div>
              </div>
            </label>
            <label>
              <span class="field-label">POS</span>
              <select v-model="ann.pos" class="ann-select" @change="loadSensesFor(idx)">
                <option v-for="p in POS_OPTIONS" :key="p" :value="p">{{ p }}</option>
              </select>
            </label>
          </div>
          <div class="ann-sense-picker">
            <span class="field-label">Sense</span>
            <div v-if="loadingSenses" class="sense-loading">Loading senses...</div>
            <div v-else-if="getSensesForAnn(idx).length === 0" class="sense-none">No senses found</div>
            <div v-else class="sense-options">
              <div
                v-for="group in getSensesForAnn(idx)"
                :key="group.file"
                class="sense-group"
              >
                <div v-if="getSensesForAnn(idx).length > 1" class="sense-group-label">{{ group.file }}</div>
                <div
                  v-for="s in group.senses"
                  :key="s.idx"
                  class="sense-option"
                  :class="{ active: isSenseActive(ann, s) }"
                  @click="pickSense(idx, s)"
                >
                  <span class="sense-idx">{{ s.idx + 1 }}.</span>
                  <span class="sense-gloss">{{ s.gloss }}</span>
                  <span v-if="s.gloss_en" class="sense-en">— {{ s.gloss_en }}</span>
                </div>
              </div>
            </div>
          </div>
          <label class="ann-hint-field">
            <span class="field-label">Hint (manual)</span>
            <input v-model="ann.gloss_hint" class="ann-input" placeholder="gloss_hint override" />
          </label>
          <div class="ann-form2-field">
            <template v-if="ann.form2">
              <span class="field-label">Linked: "{{ ann.form2 }}"</span>
              <button class="btn-remove-form2" @click="ann.form2 = undefined; ann.form2_index = undefined">× Remove link</button>
            </template>
            <button v-else class="btn-link-form2" @click="startLinkForm2(idx)">Link prefix/particle</button>
          </div>
        </div>
      </div>

      <div v-if="editAnnotations.length === 0 && !addingAnnotation" class="no-annotations">
        No annotations. Click any word in the text above to annotate it.
      </div>
    </div>

    <!-- Form2 selection mode banner -->
    <div v-if="linkingForm2For != null" class="form2-banner">
      Click a word in the text to link as form2 (prefix/particle).
      <button @click="linkingForm2For = null">Cancel</button>
    </div>

    <!-- Actions -->
    <div class="ex-editor-actions">
      <button class="btn-save" @click="save" :disabled="saving">{{ saving ? 'Saving...' : 'Save' }}</button>
      <button class="btn-cancel" @click="$emit('cancel')">Cancel</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";

interface Annotation {
  form: string;
  lemma: string;
  pos: string;
  gloss_hint: string | null;
  form_index?: number;
  form2?: string;
  form2_index?: number;
}

interface SenseInfo {
  idx: number;
  gloss: string;
  gloss_en: string | null;
}

interface SenseGroup {
  file: string;
  senses: SenseInfo[];
}

interface WordResult {
  pos: string;
  word: string;
  gloss_en?: string;
}

interface Segment {
  text: string;
  annIdx?: number;
  part?: "form" | "form2";
  wordStart?: number;
  wordEnd?: number;
}

const props = defineProps<{
  exampleId: string;
  text: string;
  translation: string | null;
  annotations: Annotation[];
}>();

const emit = defineEmits<{
  (e: "save", data: { translation: string; annotations: Annotation[] }): void;
  (e: "cancel"): void;
}>();

const POS_OPTIONS = [
  "noun", "verb", "adjective", "adverb", "pronoun", "preposition",
  "determiner", "conjunction", "particle", "numeral", "abbreviation",
  "interjection", "name", "phrase",
];

const DIR_TO_POS: Record<string, string> = {
  nouns: "noun", verbs: "verb", adjectives: "adjective", adverbs: "adverb",
  abbreviations: "abbreviation", prepositions: "preposition", conjunctions: "conjunction",
  determiners: "determiner", pronouns: "pronoun", phrases: "phrase",
  interjections: "interjection", particles: "particle", numerals: "numeral",
  names: "name", postpositions: "postposition",
};

const editTranslation = ref(props.translation || "");
const editAnnotations = ref<Annotation[]>(JSON.parse(JSON.stringify(props.annotations || [])));
const selectedAnn = ref<number | null>(null);
const saving = ref(false);

// Annotation adding state
const addingAnnotation = ref(false);
const newAnn = ref<Partial<Annotation> & { form: string; lemma: string; pos: string; gloss_hint: string | null }>({
  form: "", lemma: "", pos: "noun", gloss_hint: null,
});

// Form2 linking state
const linkingForm2For = ref<number | "new" | null>(null);

// Lemma autocomplete
const lemmaResults = ref<WordResult[]>([]);
const lemmaDropdownTarget = ref<number | "new" | null>(null);
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

// Lemma existence check
const lemmaExists = ref<Record<string, boolean | null>>({});
let existCheckTimeout: ReturnType<typeof setTimeout> | null = null;

function lemmaExistsKey(lemma: string, pos: string): string {
  return `${pos}/${lemma}`;
}

function lemmaStatusIcon(lemma: string, pos: string): string {
  if (!lemma || lemma.length < 2) return "";
  const v = lemmaExists.value[lemmaExistsKey(lemma, pos)];
  if (v === true) return "✓";
  if (v === false) return "✕";
  return "";
}

function lemmaStatusClass(lemma: string, pos: string): string {
  if (!lemma || lemma.length < 2) return "status-hidden";
  const v = lemmaExists.value[lemmaExistsKey(lemma, pos)];
  if (v === true) return "status-ok";
  if (v === false) return "status-missing";
  return "status-hidden";
}

function lemmaInputClass(lemma: string, pos: string): string {
  if (!lemma || lemma.length < 2) return "";
  const v = lemmaExists.value[lemmaExistsKey(lemma, pos)];
  if (v === true) return "input-ok";
  if (v === false) return "input-missing";
  return "";
}

async function checkLemmaExists(lemma: string, pos: string) {
  const key = lemmaExistsKey(lemma, pos);
  if (lemmaExists.value[key] != null) return;
  try {
    const res = await fetch(`/api/search-words?q=${encodeURIComponent(lemma)}&limit=50&exact=1`);
    const results: WordResult[] = await res.json();
    const found = results.some(r => r.word === lemma && (DIR_TO_POS[r.pos] || r.pos) === pos);
    lemmaExists.value[key] = found;
  } catch {
    // leave as null
  }
}

// Sense data
const sensesCache = ref<Record<string, SenseGroup[]>>({});
const loadingSenses = ref(false);

// Build segments for annotated text rendering
const segments = computed<Segment[]>(() => {
  const text = props.text;
  const anns = editAnnotations.value;
  if (!text) return [];

  // Find positions of each annotation in the text
  const positions: { start: number; end: number; annIdx: number; part: "form" | "form2" }[] = [];
  const used = new Set<number>();

  for (let ai = 0; ai < anns.length; ai++) {
    const ann = anns[ai];
    const formPos = findFormPosition(text, ann.form, ann.form_index, used);
    if (formPos !== -1) {
      positions.push({ start: formPos, end: formPos + ann.form.length, annIdx: ai, part: "form" });
      for (let c = formPos; c < formPos + ann.form.length; c++) used.add(c);
    }
    if (ann.form2) {
      const form2Pos = findFormPosition(text, ann.form2, ann.form2_index, used);
      if (form2Pos !== -1) {
        positions.push({ start: form2Pos, end: form2Pos + ann.form2.length, annIdx: ai, part: "form2" });
        for (let c = form2Pos; c < form2Pos + ann.form2.length; c++) used.add(c);
      }
    }
  }

  positions.sort((a, b) => a.start - b.start);

  // Build segments
  const segs: Segment[] = [];
  let cursor = 0;
  for (const pos of positions) {
    if (cursor < pos.start) {
      segs.push({ text: text.slice(cursor, pos.start), wordStart: cursor, wordEnd: pos.start });
    }
    segs.push({ text: text.slice(pos.start, pos.end), annIdx: pos.annIdx, part: pos.part });
    cursor = pos.end;
  }
  if (cursor < text.length) {
    segs.push({ text: text.slice(cursor), wordStart: cursor, wordEnd: text.length });
  }

  return segs;
});

function findFormPosition(text: string, form: string, formIndex: number | undefined, used: Set<number>): number {
  if (formIndex != null) {
    // form_index is 0-based word index
    const words = text.split(/(\s+)/);
    let wordCount = 0;
    let charPos = 0;
    for (const w of words) {
      if (/\S/.test(w)) {
        if (wordCount === formIndex && w.includes(form)) {
          const offset = w.indexOf(form);
          return charPos + offset;
        }
        wordCount++;
      }
      charPos += w.length;
    }
  }

  // Linear scan — find first match not already used
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const idx = text.indexOf(form, searchFrom);
    if (idx === -1) break;
    // Check word boundary
    const before = idx > 0 ? text[idx - 1] : " ";
    const after = idx + form.length < text.length ? text[idx + form.length] : " ";
    const isWordBound = /[\s\p{P}]/u.test(before) && /[\s\p{P}]/u.test(after);
    if (isWordBound && !used.has(idx)) return idx;
    // Also accept if it starts at a word boundary (form might be embedded with punctuation)
    if (/[\s\p{P}]/u.test(before) && !used.has(idx)) return idx;
    searchFrom = idx + 1;
  }

  // Fallback: case-insensitive
  searchFrom = 0;
  const lower = text.toLowerCase();
  const formLower = form.toLowerCase();
  while (searchFrom < lower.length) {
    const idx = lower.indexOf(formLower, searchFrom);
    if (idx === -1) break;
    if (!used.has(idx)) return idx;
    searchFrom = idx + 1;
  }

  return -1;
}

function onTextClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.classList.contains("ann-span")) return;

  // Extract the clicked word
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const textNode = range.startContainer;
  if (textNode.nodeType !== Node.TEXT_NODE) return;

  const nodeText = textNode.textContent || "";
  const offset = range.startOffset;

  // Find the word at offset
  let wordStart = offset;
  let wordEnd = offset;
  while (wordStart > 0 && /\S/.test(nodeText[wordStart - 1])) wordStart--;
  while (wordEnd < nodeText.length && /\S/.test(nodeText[wordEnd])) wordEnd++;
  const clickedWord = nodeText.slice(wordStart, wordEnd).replace(/[„""»«,;.:!?()]/g, "");

  if (!clickedWord) return;

  if (linkingForm2For.value != null) {
    // Linking form2
    if (linkingForm2For.value === "new") {
      newAnn.value.form2 = clickedWord;
    } else {
      editAnnotations.value[linkingForm2For.value].form2 = clickedWord;
    }
    linkingForm2For.value = null;
    return;
  }

  if (addingAnnotation.value) {
    newAnn.value.form = clickedWord;
    newAnn.value.lemma = clickedWord;
    onLemmaInput(clickedWord, newAnn.value.pos, "new");
    return;
  }

  // Click on unhighlighted word → auto-start add annotation
  newAnn.value = { form: clickedWord, lemma: clickedWord, pos: "noun", gloss_hint: null };
  addingAnnotation.value = true;
  lemmaDropdownTarget.value = "new";
  onLemmaInput(clickedWord, "noun", "new");
}

function selectAnnotation(idx: number) {
  if (linkingForm2For.value != null) return;
  selectedAnn.value = selectedAnn.value === idx ? null : idx;
  if (selectedAnn.value != null) {
    loadSensesFor(selectedAnn.value);
  }
}

function toggleAnnotation(idx: number) {
  selectAnnotation(idx);
}

function removeAnnotation(idx: number) {
  editAnnotations.value.splice(idx, 1);
  if (selectedAnn.value === idx) selectedAnn.value = null;
  else if (selectedAnn.value != null && selectedAnn.value > idx) selectedAnn.value--;
}

function confirmAddAnnotation() {
  if (!newAnn.value.form || !newAnn.value.lemma) return;
  const ann: Annotation = {
    form: newAnn.value.form,
    lemma: newAnn.value.lemma,
    pos: newAnn.value.pos,
    gloss_hint: newAnn.value.gloss_hint || null,
  };
  if (newAnn.value.form2) ann.form2 = newAnn.value.form2;
  if (newAnn.value.form2_index != null) ann.form2_index = newAnn.value.form2_index;
  editAnnotations.value.push(ann);
  addingAnnotation.value = false;
}

function cancelAddAnnotation() {
  addingAnnotation.value = false;
  linkingForm2For.value = null;
}

function startLinkForm2(target: number | "new") {
  linkingForm2For.value = target;
}

// Lemma autocomplete + existence check
function onLemmaInput(query: string, pos: string, target: number | "new") {
  if (searchTimeout) clearTimeout(searchTimeout);
  if (existCheckTimeout) clearTimeout(existCheckTimeout);
  if (!query || query.length < 2) { lemmaResults.value = []; return; }
  lemmaDropdownTarget.value = target;
  searchTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`/api/search-words?q=${encodeURIComponent(query)}&limit=8`);
      lemmaResults.value = await res.json();
    } catch { lemmaResults.value = []; }
  }, 200);
  existCheckTimeout = setTimeout(() => {
    checkLemmaExists(query, pos);
  }, 500);
}

function closeLemmaDropdown() {
  setTimeout(() => { lemmaDropdownTarget.value = null; lemmaResults.value = []; }, 200);
}

function pickNewLemma(r: WordResult) {
  newAnn.value.lemma = r.word;
  const pos = DIR_TO_POS[r.pos] || r.pos;
  newAnn.value.pos = pos;
  lemmaExists.value[lemmaExistsKey(r.word, pos)] = true;
  lemmaDropdownTarget.value = null;
  lemmaResults.value = [];
}

function pickExistingLemma(idx: number, r: WordResult) {
  const pos = DIR_TO_POS[r.pos] || r.pos;
  editAnnotations.value[idx].lemma = r.word;
  editAnnotations.value[idx].pos = pos;
  lemmaExists.value[lemmaExistsKey(r.word, pos)] = true;
  lemmaDropdownTarget.value = null;
  lemmaResults.value = [];
  loadSensesFor(idx);
}

// Sense loading
async function loadSensesFor(annIdx: number) {
  const ann = editAnnotations.value[annIdx];
  if (!ann) return;
  const key = `${ann.pos}/${ann.lemma}`;
  if (sensesCache.value[key]) return;

  loadingSenses.value = true;
  try {
    const res = await fetch("/api/annotation-senses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words: [{ lemma: ann.lemma, pos: ann.pos }] }),
    });
    const data = await res.json();
    const result = data.results?.[key];
    sensesCache.value[key] = result?.files || [];
  } catch {
    sensesCache.value[key] = [];
  }
  loadingSenses.value = false;
}

function getSensesForAnn(idx: number): SenseGroup[] {
  const ann = editAnnotations.value[idx];
  if (!ann) return [];
  return sensesCache.value[`${ann.pos}/${ann.lemma}`] || [];
}

function isSenseActive(ann: Annotation, sense: SenseInfo): boolean {
  if (!ann.gloss_hint) return false;
  const hint = ann.gloss_hint.toLowerCase();
  return (sense.gloss_en || "").toLowerCase().includes(hint)
    || sense.gloss.toLowerCase().includes(hint);
}

function pickSense(annIdx: number, sense: SenseInfo) {
  const ann = editAnnotations.value[annIdx];
  ann.gloss_hint = sense.gloss_en || sense.gloss.slice(0, 30);
}

// Batch-load senses for all annotations on mount
onMounted(async () => {
  const uniqueWords: { lemma: string; pos: string }[] = [];
  const seen = new Set<string>();
  for (const ann of editAnnotations.value) {
    const key = `${ann.pos}/${ann.lemma}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueWords.push({ lemma: ann.lemma, pos: ann.pos });
    checkLemmaExists(ann.lemma, ann.pos);
  }
  if (uniqueWords.length === 0) return;

  loadingSenses.value = true;
  try {
    const res = await fetch("/api/annotation-senses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words: uniqueWords }),
    });
    const data = await res.json();
    for (const [key, val] of Object.entries(data.results || {})) {
      sensesCache.value[key] = (val as any).files || [];
    }
  } catch { /* ignore */ }
  loadingSenses.value = false;
});

async function save() {
  saving.value = true;
  try {
    const res = await fetch(`/api/proofread/examples/${props.exampleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        translation: editTranslation.value,
        annotations: editAnnotations.value.map(a => {
          const out: any = { form: a.form, lemma: a.lemma, pos: a.pos, gloss_hint: a.gloss_hint || null };
          if (a.form_index != null) out.form_index = a.form_index;
          if (a.form2) out.form2 = a.form2;
          if (a.form2_index != null) out.form2_index = a.form2_index;
          return out;
        }),
      }),
    });
    if (res.ok) {
      emit("save", { translation: editTranslation.value, annotations: editAnnotations.value });
    }
  } catch { /* ignore */ }
  saving.value = false;
}
</script>

<style scoped>
.ex-editor {
  background: white;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  overflow: hidden;
}

.ex-editor-section {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--admin-border);
}

.ex-editor-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--admin-text-muted);
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* Annotated text */
.annotated-text {
  font-size: 1.1rem;
  line-height: 1.7;
  cursor: text;
  padding: 0.5rem;
  border: 1px solid var(--admin-border);
  border-radius: 4px;
  background: #fafafa;
}

.ann-span {
  cursor: pointer;
  border-radius: 2px;
  padding: 0 2px;
  transition: all 0.15s;
  border-bottom: 2px solid transparent;
}

.ann-noun { background: rgba(25, 118, 210, 0.12); border-bottom-color: #1976d2; }
.ann-verb { background: rgba(56, 142, 60, 0.12); border-bottom-color: #388e3c; }
.ann-adj { background: rgba(194, 24, 91, 0.12); border-bottom-color: #c2185b; }

.ann-span:hover { filter: brightness(0.95); }

.ann-span.selected {
  outline: 2px solid var(--admin-primary);
  outline-offset: 1px;
}

.ann-form2 {
  border-bottom-style: dashed;
}

.plain-text { cursor: pointer; }

/* Translation */
.ex-editor-textarea {
  width: 100%;
  border: 1px solid var(--admin-border-ui);
  border-radius: 4px;
  padding: 0.5rem;
  font-size: 0.95rem;
  font-family: inherit;
  resize: vertical;
  line-height: 1.5;
}

.ex-editor-textarea:focus { border-color: var(--admin-primary); outline: none; }

/* Annotation rows */
.ann-row {
  border: 1px solid var(--admin-border);
  border-radius: 6px;
  margin-bottom: 0.4rem;
  overflow: hidden;
}

.ann-row.expanded { border-color: var(--admin-primary); }

.ann-row-summary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.6rem;
  cursor: pointer;
  font-size: 0.85rem;
  transition: background 0.15s;
  flex-wrap: wrap;
}

.ann-row-summary:hover { background: var(--admin-subtle); }

.ann-form-label { font-weight: 600; }
.ann-arrow { color: var(--admin-text-muted); font-size: 0.75rem; }
.ann-lemma-label { color: var(--admin-primary); }

.ann-pos-badge {
  font-size: 0.7rem;
  background: var(--admin-subtle);
  padding: 1px 6px;
  border-radius: 8px;
  color: var(--admin-text-muted);
}

.ann-hint-badge {
  font-size: 0.7rem;
  background: #e3f2fd;
  padding: 1px 6px;
  border-radius: 8px;
  color: #1565c0;
  font-style: italic;
}

.ann-form2-badge {
  font-size: 0.7rem;
  background: #e8f5e9;
  padding: 1px 6px;
  border-radius: 8px;
  color: #2e7d32;
}

.btn-remove-ann {
  margin-left: auto;
  background: none;
  border: none;
  color: #c62828;
  cursor: pointer;
  font-size: 1.1rem;
  font-weight: bold;
  padding: 0 4px;
  line-height: 1;
  opacity: 0.5;
  transition: opacity 0.15s;
}

.btn-remove-ann:hover { opacity: 1; }

/* Annotation detail (expanded) */
.ann-row-detail {
  padding: 0.6rem;
  border-top: 1px solid var(--admin-border);
  background: #fafafa;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ann-detail-fields {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.ann-detail-fields label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 120px;
}

.field-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  color: var(--admin-text-muted);
  letter-spacing: 0.03em;
}

.ann-input {
  padding: 4px 8px;
  border: 1px solid var(--admin-border-ui);
  border-radius: 4px;
  font-size: 0.85rem;
  width: 100%;
}

.ann-input:focus { border-color: var(--admin-primary); outline: none; }

.ann-select {
  padding: 4px 8px;
  border: 1px solid var(--admin-border-ui);
  border-radius: 4px;
  font-size: 0.85rem;
}

/* Sense picker */
.ann-sense-picker { display: flex; flex-direction: column; gap: 4px; }

.sense-loading, .sense-none {
  font-size: 0.8rem;
  color: var(--admin-text-muted);
  padding: 4px 0;
}

.sense-options {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}

.sense-group-label {
  font-size: 0.7rem;
  color: var(--admin-text-muted);
  padding: 4px 0 2px;
  font-weight: 600;
}

.sense-option {
  display: flex;
  gap: 0.3rem;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  transition: background 0.15s;
  align-items: baseline;
}

.sense-option:hover { background: #e3f2fd; }
.sense-option.active { background: #bbdefb; }

.sense-idx { color: var(--admin-text-muted); font-weight: 600; flex-shrink: 0; }
.sense-gloss { color: var(--admin-text-medium, #555); }
.sense-en { color: var(--admin-primary); font-style: italic; }

.ann-hint-field { display: flex; flex-direction: column; gap: 2px; }

.ann-form2-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
}

/* Buttons */
.ann-tip {
  font-size: 0.7rem;
  color: var(--admin-text-muted);
  font-style: italic;
  font-weight: 400;
}

.btn-link-form2, .btn-remove-form2 {
  padding: 2px 8px;
  border: 1px solid var(--admin-border-ui);
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.15s;
}

.btn-link-form2:hover { border-color: var(--admin-primary); color: var(--admin-primary); }
.btn-remove-form2 { color: #c62828; border-color: #ffcdd2; }
.btn-remove-form2:hover { background: #ffebee; }

/* Add annotation form */
.add-ann-form {
  background: #f0f7ff;
  border: 1px solid #bbdefb;
  border-radius: 6px;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
}

.add-ann-hint {
  font-size: 0.8rem;
  color: var(--admin-text-secondary);
  margin-bottom: 0.5rem;
}

.add-ann-fields {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.add-ann-fields label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 100px;
}

.add-ann-form2 { margin-bottom: 0.5rem; }

.form2-display {
  font-size: 0.8rem;
  color: #2e7d32;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.add-ann-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-confirm-add {
  padding: 4px 14px;
  background: var(--admin-primary);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 500;
}

.btn-confirm-add:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-confirm-add:hover:not(:disabled) { background: var(--admin-primary-dark); }

.btn-cancel-add {
  padding: 4px 14px;
  background: white;
  border: 1px solid var(--admin-border-ui);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}

/* Lemma autocomplete dropdown */
.lemma-autocomplete { position: relative; }
.lemma-status {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.8rem;
  font-weight: 600;
  pointer-events: none;
  line-height: 1;
}
.status-ok { color: #2e7d32; }
.status-missing { color: #c62828; }
.status-hidden { display: none; }
.ann-input.input-ok { border-color: #a5d6a7; padding-right: 24px; }
.ann-input.input-missing { border-color: #ef9a9a; padding-right: 24px; }

.lemma-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: white;
  border: 1px solid var(--admin-border-ui);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
}

.lemma-option {
  display: flex;
  gap: 0.4rem;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 0.8rem;
  align-items: baseline;
}

.lemma-option:hover { background: var(--admin-subtle); }

.lemma-word { font-weight: 600; }
.lemma-pos { font-size: 0.7rem; color: var(--admin-text-muted); }
.lemma-gloss { font-size: 0.7rem; color: var(--admin-text-secondary); font-style: italic; }

/* Form2 banner */
.form2-banner {
  padding: 0.5rem 1rem;
  background: #fff8e1;
  border-top: 1px solid #ffe082;
  font-size: 0.85rem;
  color: #f57f17;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.form2-banner button {
  padding: 2px 10px;
  border: 1px solid #ffe082;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 0.8rem;
}

/* No annotations */
.no-annotations {
  font-size: 0.85rem;
  color: var(--admin-text-muted);
  padding: 0.5rem 0;
  font-style: italic;
}

/* Action bar */
.ex-editor-actions {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--admin-subtle);
}

.btn-save {
  padding: 6px 20px;
  background: #2e7d32;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: background 0.15s;
}

.btn-save:hover:not(:disabled) { background: #1b5e20; }
.btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-cancel {
  padding: 6px 20px;
  background: white;
  border: 1px solid var(--admin-border-ui);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.15s;
}

.btn-cancel:hover { background: var(--admin-subtle); }
</style>
