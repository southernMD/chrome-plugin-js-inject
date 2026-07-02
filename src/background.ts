const STORAGE_KEY = 'scriptManagerScripts';

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
                await chrome.scripting.executeScript({
                    target: { tabId: activeTab.id },
                    files: [message.filePath],
                    world: 'MAIN'
                });
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
