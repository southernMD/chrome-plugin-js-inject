const SCRIPT_INDEX_PATH = 'scripts/index.json';
const SCRIPT_TITLE_KEY = 'scriptTitleMap';

function setStatus(statusEl, text, type = '') {
    statusEl.textContent = text || '';
    statusEl.className = `script-status${type ? ` is-${type}` : ''}`;
}

async function getTitleMap() {
    const result = await chrome.storage.local.get(SCRIPT_TITLE_KEY);
    return result[SCRIPT_TITLE_KEY] && typeof result[SCRIPT_TITLE_KEY] === 'object'
        ? result[SCRIPT_TITLE_KEY]
        : {};
}

async function setTitleMap(titleMap) {
    await chrome.storage.local.set({ [SCRIPT_TITLE_KEY]: titleMap });
}

async function getBookmarksBarId() {
    const tree = await chrome.bookmarks.getTree();
    const root = Array.isArray(tree) ? tree[0] : null;
    const children = root && Array.isArray(root.children) ? root.children : [];
    const barNode = children.find(item => item && item.id && item.title === 'Bookmarks bar')
        || children.find(item => item && item.id && item.title === '书签栏')
        || children[0];

    return barNode?.id;
}

async function loadScriptDefinitions() {
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


async function loadScriptContent(scriptPath) {
    const response = await fetch(chrome.runtime.getURL(scriptPath), { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`脚本文件读取失败: ${scriptPath}`);
    }

    return response.text();
}

async function loadScripts() {
    const definitions = await loadScriptDefinitions();
    const titleMap = await getTitleMap();
    return Promise.all(
        definitions.map(async item => ({
            ...item,
            displayName: titleMap[item.id] || item.name,
            code: await loadScriptContent(item.path)
        }))
    );
}


function buildEmptyState() {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.textContent = '暂无可用脚本。点击“导入脚本”选择一个 .js 文件，插件会自动复制并更新脚本清单。';
    return el;
}

function buildScriptCard(script, onAfterChange) {
    const template = document.getElementById('script-item-template');
    const fragment = template.content.cloneNode(true);

    const nameInput = fragment.querySelector('.script-name-input');
    const subtitleEl = fragment.querySelector('.script-subtitle');
    const runBtn = fragment.querySelector('.run-script-btn');
    const openBtn = fragment.querySelector('.open-script-btn');
    const bookmarkBtn = fragment.querySelector('.bookmark-script-btn');
    const deleteBtn = fragment.querySelector('.delete-script-btn');
    const statusEl = fragment.querySelector('.script-status');

    nameInput.value = script.displayName || script.name || script.id;
    subtitleEl.textContent = `${script.description || '未填写说明'} | ${script.path}`;

    nameInput.addEventListener('change', async () => {
        const nextValue = (nameInput.value || '').trim() || script.name || script.id;
        nameInput.value = nextValue;
        const titleMap = await getTitleMap();
        titleMap[script.id] = nextValue;
        await setTitleMap(titleMap);
    });

    runBtn.addEventListener('click', async () => {
        setStatus(statusEl, '执行中...');

        const response = await chrome.runtime.sendMessage({
            type: 'EXECUTE_SCRIPT_IN_PAGE',
            filePath: script.path
        });

        if (response?.ok) {
            setStatus(statusEl, '执行成功', 'success');
            return;
        }

        setStatus(statusEl, response?.error || '执行失败', 'error');
    });

    openBtn.addEventListener('click', async () => {
        const response = await chrome.runtime.sendMessage({
            type: 'OPEN_SCRIPT_FILE',
            fileName: script.name
        });
        if (!response?.ok) {
            setStatus(statusEl, response?.error || '打开脚本失败', 'error');
        }
    });


    bookmarkBtn.addEventListener('click', async () => {
        const bookmarkTitle = (nameInput.value || '').trim() || script.displayName || script.name || script.id;
        const bookmarkUrl = `javascript:${script.code}`;

        try {
            const parentId = await getBookmarksBarId();
            await chrome.bookmarks.create({
                parentId,
                title: bookmarkTitle,
                url: bookmarkUrl
            });
            setStatus(statusEl, '已加入书签', 'success');
        } catch (error) {
            setStatus(statusEl, error.message || '加入书签失败', 'error');
        }
    });

    deleteBtn.addEventListener('click', async () => {
        const confirmed = window.confirm(`确认删除脚本“${nameInput.value || script.name || script.id}”吗？`);
        if (!confirmed) {
            return;
        }

        const response = await chrome.runtime.sendMessage({
            type: 'DELETE_SCRIPT_FILE',
            fileName: script.name
        });
        if (!response?.ok) {
            setStatus(statusEl, response?.error || '删除脚本失败', 'error');
            return;
        }

        const titleMap = await getTitleMap();
        if (titleMap[script.id] !== undefined) {
            delete titleMap[script.id];
            await setTitleMap(titleMap);
        }

        await onAfterChange();
    });

    return fragment;
}


async function render() {
    const listEl = document.getElementById('script-list');
    listEl.innerHTML = '';

    try {
        const scripts = await loadScripts();
        if (!scripts.length) {
            listEl.appendChild(buildEmptyState());
            return;
        }

        scripts.forEach(script => {
            listEl.appendChild(buildScriptCard(script, render));
        });
    } catch (error) {
        listEl.appendChild(buildEmptyState());
        const errorEl = document.createElement('div');
        errorEl.className = 'script-status is-error';
        errorEl.textContent = error.message || '脚本加载失败';
        listEl.appendChild(errorEl);
    }
}


document.getElementById('import-script-btn').addEventListener('click', async () => {
    try {
        if (typeof window.showOpenFilePicker !== 'function') {
            window.alert('当前浏览器环境不支持文件选择');
            return;
        }

        const [fileHandle] = await window.showOpenFilePicker({
            multiple: false,
            types: [
                {
                    description: 'JavaScript Files',
                    accept: {
                        'text/javascript': ['.js'],
                        'application/javascript': ['.js']
                    }
                }
            ]
        });

        if (!fileHandle) {
            return;
        }

        const file = await fileHandle.getFile();
        const response = await chrome.runtime.sendMessage({
            type: 'IMPORT_SCRIPT_FILE',
            fileName: file.name,
            content: await file.text()
        });

        if (!response?.ok) {
            window.alert(response?.error || '导入脚本失败');
            return;
        }

        await render();
    } catch (error) {
        if (error?.name === 'AbortError') {
            return;
        }
        window.alert(error.message || '导入脚本失败');
    }
});

document.getElementById('guide-btn').addEventListener('click', async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('guide.html') });
});

document.getElementById('reload-btn').addEventListener('click', async () => {
    await render();
});

render();
