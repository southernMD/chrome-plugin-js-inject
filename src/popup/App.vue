<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface ScriptItem {
  id: string;
  name: string;
  path: string;
  description?: string;
  displayName: string;
  code: string;
  statusText?: string;
  statusType?: 'success' | 'error' | '';
}

const SCRIPT_INDEX_PATH = 'scripts/index.json';
const SCRIPT_TITLE_KEY = 'scriptTitleMap';

const scripts = ref<ScriptItem[]>([]);
const loading = ref(false);

async function getTitleMap(): Promise<Record<string, string>> {
  const result = await chrome.storage.local.get(SCRIPT_TITLE_KEY);
  return result[SCRIPT_TITLE_KEY] && typeof result[SCRIPT_TITLE_KEY] === 'object'
    ? result[SCRIPT_TITLE_KEY]
    : {};
}

async function setTitleMap(titleMap: Record<string, string>) {
  await chrome.storage.local.set({ [SCRIPT_TITLE_KEY]: titleMap });
}

async function getBookmarksBarId(): Promise<string | undefined> {
  const tree = await chrome.bookmarks.getTree();
  const root = Array.isArray(tree) ? tree[0] : null;
  const children = root && Array.isArray(root.children) ? root.children : [];
  const barNode = children.find(item => item && item.id && item.title === 'Bookmarks bar')
    || children.find(item => item && item.id && item.title === '书签栏')
    || children[0];

  return barNode?.id;
}

async function loadScriptDefinitions(): Promise<any[]> {
  const response = await fetch(chrome.runtime.getURL(SCRIPT_INDEX_PATH), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('脚本清单读取失败');
  }

  const definitions = await response.json();
  if (Array.isArray(definitions)) {
    return definitions;
  }
  if (definitions && typeof definitions === 'object') {
    return [definitions];
  }
  return [];
}

async function loadScriptContent(scriptPath: string): Promise<string> {
  const response = await fetch(chrome.runtime.getURL(scriptPath), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`脚本文件读取失败: ${scriptPath}`);
  }
  return response.text();
}

async function fetchScripts() {
  loading.value = true;
  try {
    const definitions = await loadScriptDefinitions();
    const titleMap = await getTitleMap();
    
    scripts.value = await Promise.all(
      definitions.map(async item => {
        let code = '';
        try {
          code = await loadScriptContent(item.path);
        } catch (e) {
          code = `// 文件读取失败: ${item.path}`;
        }
        return {
          ...item,
          displayName: titleMap[item.id] || item.name,
          code,
          statusText: '',
          statusType: ''
        };
      })
    );
  } catch (error: any) {
    console.error(error);
    scripts.value = [];
  } finally {
    loading.value = false;
  }
}

async function updateDisplayName(script: ScriptItem, newName: string) {
  const name = newName.trim();
  if (!name) return;
  script.displayName = name;
  const titleMap = await getTitleMap();
  titleMap[script.id] = name;
  await setTitleMap(titleMap);
}

function setStatus(script: ScriptItem, text: string, type: 'success' | 'error' | '' = '') {
  script.statusText = text;
  script.statusType = type;
}

async function runScript(script: ScriptItem) {
  setStatus(script, '执行中...');
  const response = await chrome.runtime.sendMessage({
    type: 'EXECUTE_SCRIPT_IN_PAGE',
    filePath: script.path
  });

  if (response?.ok) {
    setStatus(script, '执行成功', 'success');
  } else {
    setStatus(script, response?.error || '执行失败', 'error');
  }
}

async function openScriptFile(script: ScriptItem) {
  const response = await chrome.runtime.sendMessage({
    type: 'OPEN_SCRIPT_FILE',
    fileName: script.name
  });
  if (!response?.ok) {
    setStatus(script, response?.error || '打开脚本失败', 'error');
  }
}

async function bookmarkScript(script: ScriptItem) {
  // Strip comments (block and single-line), collapse whitespace/newlines to prevent syntax errors in bookmarklet
  const cleanCode = script.code
    .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  const bookmarkTitle = script.displayName || script.name || script.id;
  const bookmarkUrl = `javascript:${encodeURIComponent(cleanCode)}`;

  try {
    const parentId = await getBookmarksBarId();
    await chrome.bookmarks.create({
      parentId,
      title: bookmarkTitle,
      url: bookmarkUrl
    });
    setStatus(script, '已加入书签', 'success');
  } catch (error: any) {
    setStatus(script, error.message || '加入书签失败', 'error');
  }
}

async function deleteScript(script: ScriptItem) {
  const confirmed = window.confirm(`确认删除脚本“${script.displayName || script.name || script.id}”吗？`);
  if (!confirmed) return;

  const response = await chrome.runtime.sendMessage({
    type: 'DELETE_SCRIPT_FILE',
    fileName: script.name
  });
  if (!response?.ok) {
    setStatus(script, response?.error || '删除脚本失败', 'error');
    return;
  }

  const titleMap = await getTitleMap();
  if (titleMap[script.id] !== undefined) {
    delete titleMap[script.id];
    await setTitleMap(titleMap);
  }

  await fetchScripts();
}

async function importScript() {
  // @ts-ignore
  if (typeof window.showOpenFilePicker !== 'function') {
    window.alert('当前浏览器环境不支持文件选择');
    return;
  }

  try {
    // @ts-ignore
    const [fileHandle] = await window.showOpenFilePicker({
      types: [{
        description: 'JavaScript Files',
        accept: { 'text/javascript': ['.js'] }
      }],
      multiple: false
    });

    const file = await fileHandle.getFile();
    const content = await file.text();

    const response = await chrome.runtime.sendMessage({
      type: 'IMPORT_SCRIPT_FILE',
      fileName: file.name,
      content: content
    });

    if (response?.ok) {
      window.alert('导入脚本成功，请刷新列表');
      await fetchScripts();
    } else {
      window.alert(response?.error || '导入脚本失败');
    }
  } catch (error: any) {
    if (error.name !== 'AbortError') {
      window.alert(`导入出错: ${error.message || String(error)}`);
    }
  }
}

function openGuide() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/guide/index.html') });
}

onMounted(() => {
  fetchScripts();
});
</script>

<template>
  <div class="app">
    <div class="header">
      <div>
        <h1>脚本管理</h1>
      </div>
      <div class="header-actions">
        <button class="secondary-btn" type="button" @click="openGuide">使用说明</button>
        <button class="secondary-btn" type="button" @click="importScript">导入脚本</button>
        <button class="primary-btn" type="button" @click="fetchScripts">加载刷新</button>
      </div>
    </div>

    <div class="script-list">
      <div v-if="scripts.length === 0" class="empty-state">
        暂无可用脚本。点击“导入脚本”选择一个 .js 文件，插件会自动复制并更新脚本清单。
      </div>

      <section v-for="script in scripts" :key="script.id" class="script-card">
        <div class="script-meta">
          <input 
            class="script-name-input" 
            type="text" 
            :value="script.displayName" 
            @change="e => updateDisplayName(script, (e.target as HTMLInputElement).value)"
          />
          <div class="script-subtitle">
            {{ script.description || '未填写说明' }} | {{ script.path }}
          </div>
        </div>

        <div class="script-card__actions">
          <button class="primary-btn run-script-btn" type="button" @click="runScript(script)">
            在当前页面执行
          </button>
          <button class="secondary-btn open-script-btn" type="button" @click="openScriptFile(script)">
            打开本地文件
          </button>
          <button class="secondary-btn bookmark-script-btn" type="button" @click="bookmarkScript(script)">
            加入书签
          </button>
          <button class="danger-btn delete-script-btn" type="button" @click="deleteScript(script)">
            删除
          </button>
        </div>

        <div 
          v-if="script.statusText" 
          :class="['script-status', script.statusType ? `is-${script.statusType}` : '']"
        >
          {{ script.statusText }}
        </div>
      </section>
    </div>
  </div>
</template>

<style>
* {
    box-sizing: border-box;
}

body {
    margin: 0;
    font-family: "Microsoft YaHei", sans-serif;
    background: #f5f7fa;
    color: #1f2d3d;
}

.app {
    width: 420px;
    min-height: 320px;
    padding: 16px;
}

.header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 16px;
}

.header-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
}

.header h1 {
    margin: 0 0 4px;
    font-size: 18px;
}

.header p {
    margin: 0;
    color: #606266;
    font-size: 12px;
}

.script-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.script-card {
    background: #fff;
    border: 1px solid #dcdfe6;
    border-radius: 10px;
    padding: 12px;
    box-shadow: 0 4px 12px rgba(31, 45, 61, 0.06);
}

.script-meta {
    margin-bottom: 10px;
}

.script-name-input {
    width: 100%;
    border: 1px solid #dcdfe6;
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
    color: #303133;
    background: #fff;
}

.script-name-input:focus {
    outline: none;
    border-color: #409eff;
}

.script-subtitle {
    margin-top: 4px;
    color: #909399;
    font-size: 12px;
    line-height: 18px;
}

.script-card__actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

button {
    border: none;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 12px;
    cursor: pointer;
    transition: opacity 0.2s ease;
}

button:hover {
    opacity: 0.9;
}

.primary-btn {
    background: #409eff;
    color: #fff;
}

.secondary-btn {
    background: #ecf5ff;
    color: #409eff;
}

.danger-btn {
    background: #fef0f0;
    color: #f56c6c;
}

.script-status {
    min-height: 18px;
    margin-top: 10px;
    font-size: 12px;
    color: #909399;
}

.script-status.is-success {
    color: #67c23a;
}

.script-status.is-error {
    color: #f56c6c;
}

.empty-state {
    padding: 32px 12px;
    text-align: center;
    color: #909399;
    font-size: 13px;
    background: #fff;
    border: 1px dashed #dcdfe6;
    border-radius: 10px;
}
</style>
