const STORAGE_KEY = 'scriptManagerScripts';
const SCRIPT_INDEX_PATH = 'scripts/index.json';
const SCRIPT_AUTO_RUN_KEY = 'scriptAutoRunMap';
const AUTO_RUN_DEDUPLICATE_MS = 1500;

interface ScriptDefinition {
    id: string;
    path: string;
}

interface ScriptAutoRunConfig {
    enabled: boolean;
    domains: string;
}

const recentAutoRuns = new Map<number, { url: string; time: number }>();

chrome.runtime.onInstalled.addListener(async () => {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    if (!Array.isArray(result[STORAGE_KEY])) {
        await chrome.storage.local.set({ [STORAGE_KEY]: [] });
    }

    chrome.tabs.create({ url: chrome.runtime.getURL('src/guide/index.html') });
});

function canUseUserScripts(): boolean {
    // @ts-ignore
    return !!(chrome.userScripts && typeof chrome.userScripts.execute === 'function');
}

async function loadScriptDefinitions(): Promise<ScriptDefinition[]> {
    const response = await fetch(chrome.runtime.getURL(SCRIPT_INDEX_PATH), { cache: 'no-store' });
    if (!response.ok) {
        throw new Error('脚本清单读取失败');
    }

    const definitions = await response.json();
    if (Array.isArray(definitions)) {
        return definitions.filter(item => item?.id && item?.path);
    }
    if (definitions?.id && definitions?.path) {
        return [definitions];
    }
    return [];
}

async function getAutoRunMap(): Promise<Record<string, ScriptAutoRunConfig>> {
    const result = await chrome.storage.local.get(SCRIPT_AUTO_RUN_KEY);
    return result[SCRIPT_AUTO_RUN_KEY] && typeof result[SCRIPT_AUTO_RUN_KEY] === 'object'
        ? result[SCRIPT_AUTO_RUN_KEY]
        : {};
}

function normalizeDomain(input: string): string {
    const value = input.trim().toLowerCase();
    if (!value) return '';

    try {
        const withProtocol = value.includes('://') ? value : `https://${value}`;
        return new URL(withProtocol).hostname.replace(/^\*\./, '').replace(/^www\./, '');
    } catch {
        return value
            .split('/')[0]
            .split(':')[0]
            .replace(/^\*\./, '')
            .replace(/^www\./, '');
    }
}

function getPageHostname(url: string): string {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return '';
    }
}

function matchesAutoRunDomains(tabUrl: string, domainsText: string): boolean {
    const domains = domainsText
        .split(/\r?\n/)
        .map(normalizeDomain)
        .filter(Boolean);

    if (domains.length === 0) {
        return true;
    }

    const hostname = getPageHostname(tabUrl);
    if (!hostname) {
        return false;
    }

    return domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}

async function executeScriptFile(tabId: number, filePath: string) {
    await chrome.scripting.executeScript({
        target: { tabId },
        files: [filePath],
        world: 'MAIN'
    });
}

async function runAutoScripts(tabId: number, tabUrl?: string) {
    if (!tabUrl || !/^https?:\/\//i.test(tabUrl)) {
        return;
    }

    const [definitions, autoRunMap] = await Promise.all([
        loadScriptDefinitions(),
        getAutoRunMap()
    ]);

    for (const script of definitions) {
        const config = autoRunMap[script.id];
        if (!config?.enabled || !matchesAutoRunDomains(tabUrl, config.domains || '')) {
            continue;
        }

        try {
            await executeScriptFile(tabId, script.path);
        } catch (error) {
            console.error(`[auto-run] Failed to execute ${script.id}:`, error);
        }
    }
}

async function runAutoScript(tabId: number, tabUrl: string | undefined, scriptId: string) {
    if (!tabUrl || !/^https?:\/\//i.test(tabUrl)) {
        return { ok: false, error: '当前页面不支持自动执行' };
    }

    const [definitions, autoRunMap] = await Promise.all([
        loadScriptDefinitions(),
        getAutoRunMap()
    ]);
    const script = definitions.find(item => item.id === scriptId);
    if (!script) {
        return { ok: false, error: '未找到脚本清单配置' };
    }

    const config = autoRunMap[script.id];
    if (!config?.enabled) {
        return { ok: true, skipped: true };
    }
    if (!matchesAutoRunDomains(tabUrl, config.domains || '')) {
        return { ok: false, error: '当前域名不在自动执行范围内' };
    }

    await executeScriptFile(tabId, script.path);
    return { ok: true };
}

function shouldRunForNavigation(tabId: number, url: string): boolean {
    const recent = recentAutoRuns.get(tabId);
    const now = Date.now();
    if (recent?.url === url && now - recent.time < AUTO_RUN_DEDUPLICATE_MS) {
        return false;
    }

    recentAutoRuns.set(tabId, { url, time: now });
    return true;
}

function runAutoScriptsForNavigation(tabId: number, url?: string) {
    if (!url || !shouldRunForNavigation(tabId, url)) {
        return;
    }

    runAutoScripts(tabId, url).catch(error => {
        console.error('[auto-run] Failed to run scripts:', error);
    });
}

function sendNativeMessage(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendNativeMessage(
            'com.wise.chrome_plugin_host',
            message,
            (response) => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    reject(new Error(lastError.message));
                    return;
                }
                resolve(response);
            }
        );
    });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') {
        return;
    }

    if (tab.url) {
        runAutoScriptsForNavigation(tabId, tab.url);
        return;
    }

    chrome.tabs.get(tabId, currentTab => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
            console.warn('[auto-run] Failed to read tab url:', lastError.message);
            return;
        }
        runAutoScriptsForNavigation(tabId, currentTab.url);
    });
});

chrome.webNavigation.onCompleted.addListener(details => {
    if (details.frameId !== 0) {
        return;
    }

    runAutoScriptsForNavigation(details.tabId, details.url);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

    if (message?.type === 'IMPORT_SCRIPT_FILE') {
        sendNativeMessage({
            action: 'importScript',
            fileName: message.fileName,
            content: message.content
        })
            .then(response => {
                if (response?.ok) {
                    sendResponse(response);
                    return;
                }
                sendResponse({ ok: false, error: response?.error || '导入脚本失败' });
            })
            .catch(error => {
                sendResponse({ ok: false, error: error.message || String(error) });
            });
        return true;
    }

    if (message?.type === 'DELETE_SCRIPT_FILE') {
        sendNativeMessage({
            action: 'deleteScript',
            fileName: message.fileName
        })
            .then(response => {
                if (response?.ok) {
                    sendResponse(response);
                    return;
                }
                sendResponse({ ok: false, error: response?.error || '删除脚本失败' });
            })
            .catch(error => {
                sendResponse({ ok: false, error: error.message || String(error) });
            });
        return true;
    }

    if (message?.type === 'OPEN_SCRIPT_FILE') {
        sendNativeMessage({
            action: 'openScript',
            fileName: message.fileName
        })
            .then(response => {
                if (response?.ok) {
                    sendResponse(response);
                    return;
                }
                sendResponse({ ok: false, error: response?.error || '打开脚本失败' });
            })
            .catch(error => {
                sendResponse({ ok: false, error: error.message || String(error) });
            });
        return true;
    }

    if (message?.type === 'RUN_AUTO_SCRIPT_NOW') {
        chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
            const activeTab = tabs && tabs[0];
            if (!activeTab?.id) {
                sendResponse({ ok: false, error: '未找到当前标签页' });
                return;
            }

            try {
                const response = await runAutoScript(activeTab.id, activeTab.url, message.scriptId);
                sendResponse(response);
            } catch (error: any) {
                sendResponse({ ok: false, error: error.message || String(error) });
            }
        });
        return true;
    }

    if (message?.type !== 'EXECUTE_SCRIPT_IN_PAGE') {
        return false;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
        const activeTab = tabs && tabs[0];
        if (!activeTab?.id) {
            sendResponse({ ok: false, error: '未找到当前标签页' });
            return;
        }

        try {
            if (message.filePath) {
                await executeScriptFile(activeTab.id, message.filePath);
                sendResponse({ ok: true });
                return;
            }

            if (!canUseUserScripts()) {
                sendResponse({
                    ok: false,
                    error: '当前 Chrome 未启用 User Scripts，请到扩展详情页开启 Allow User Scripts 后重试'
                });
                return;
            }

            // @ts-ignore
            const result = await chrome.userScripts.execute({
                target: { tabId: activeTab.id },
                js: [{ code: message.code }],
                injectImmediately: true
            });

            const failed = Array.isArray(result) ? result.find(item => item && item.error) : null;
            if (failed) {
                sendResponse({ ok: false, error: failed.error || '执行失败' });
                return;
            }

            sendResponse({ ok: true });
        } catch (error: any) {
            sendResponse({ ok: false, error: error.message || String(error) });
        }
    });

    return true;
});
