/**
 * @name B站视频下载助手
 * @description B站视频下载脚本
 */
import md5 from 'md5';

(() => {
    // 1. 验证是否处于 B站 播放页
    if (!window.location.host.includes("bilibili.com")) {
        alert("请在 Bilibili 视频播放页面运行此脚本！");
        return;
    }

    // @ts-ignore
    const initialState = window.__INITIAL_STATE__;
    if (!initialState || !initialState.videoData || !initialState.videoData.pages) {
        alert("未找到视频分P信息，请确保页面已完全加载！");
        return;
    }

    const bvid = initialState.videoData.bvid;
    const videoTitle = initialState.videoData.title || document.title;
    const pages = initialState.videoData.pages; // 分 P 列表数组

    // 2. WBI 签名算法相关逻辑
    const mixinKeyEncTab = [
        46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
        33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
        61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
        36, 20, 34, 44, 52
    ];

    const getMixinKey = (orig: string) => mixinKeyEncTab.map(n => orig[n]).join('').slice(0, 32);

    function encWbi(params: any, img_key: string, sub_key: string) {
        const mixin_key = getMixinKey(img_key + sub_key);
        const curr_time = Math.round(Date.now() / 1000);
        const chr_filter = /[!'()*]/g;

        Object.assign(params, { wts: curr_time });
        const query = Object.keys(params)
            .sort()
            .map(key => {
                const value = params[key].toString().replace(chr_filter, '');
                return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
            })
            .join('&');

        const wbi_sign = md5(query + mixin_key);
        return query + '&w_rid=' + wbi_sign;
    }

    async function getWbiKeys() {
        const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
            credentials: 'include'
        });
        const json = await res.json();
        // 未登录时 B站会返回 code: -101，但 data.wbi_img 依然有效存在，因此不能强校验 code === 0
        if (!json.data || !json.data.wbi_img) {
            console.error("WBI Keys fetch failed:", json);
            throw new Error(`获取 WBI 密钥失败 (${json.message || '返回数据为空'})`);
        }
        const { img_url, sub_url } = json.data.wbi_img;
        return {
            img_key: img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.')),
            sub_key: sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'))
        };
    }

    async function fetchPlayUrl(cid: number) {
        const keys = await getWbiKeys();
        const params = {
            bvid: bvid,
            cid: cid,
            qn: "127", // 请求最高清
            fnver: "0",
            fnval: "4048", // 启用 DASH 格式
            fourk: "1",
            otype: "json"
        };
        const query = encWbi(params, keys.img_key, keys.sub_key);
        const res = await fetch(`https://api.bilibili.com/x/player/wbi/playurl?${query}`, {
            credentials: 'include'
        });
        const json = await res.json();
        if (json.code !== 0 || !json.data) {
            throw new Error(json.message || "请求流媒体播放链接失败");
        }
        return json.data;
    }

    // 3. 动态渲染批量下载面板 UI (极具现代感和交互美学的毛玻璃面板)
    const container = document.createElement("div");
    container.id = "b-batch-download-container";
    container.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        z-index: 999999;
        width: 360px;
        max-height: 80vh;
        background: rgba(255, 255, 255, 0.96);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(0, 0, 0, 0.08);
        box-shadow: 0 12px 48px rgba(0, 0, 0, 0.15);
        border-radius: 20px;
        padding: 24px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #2c3e50;
        display: flex;
        flex-direction: column;
    `;

    const header = document.createElement("div");
    header.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;";

    const title = document.createElement("h3");
    title.textContent = "⚡ B站分P批量下载";
    title.style.cssText = "margin: 0; font-size: 18px; font-weight: bold; color: #111;";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = "background: none; border: none; font-size: 24px; cursor: pointer; color: #909399; padding: 0; line-height: 1; transition: color 0.2s;";
    closeBtn.addEventListener("click", () => container.remove());
    header.appendChild(closeBtn);
    container.appendChild(header);

    const desc = document.createElement("p");
    desc.textContent = `视频: ${videoTitle.substring(0, 45)}${videoTitle.length > 45 ? '...' : ''}`;
    desc.style.cssText = "font-size: 12px; color: #606266; margin: 0 0 16px 0; line-height: 1.4;";
    container.appendChild(desc);

    // 搜索过滤框
    const searchInput = document.createElement("input");
    searchInput.placeholder = "🔍 搜索分P标题...";
    searchInput.style.cssText = "width: 100%; padding: 8px 12px; border: 1px solid #dcdfe6; border-radius: 8px; font-size: 12px; margin-bottom: 12px; box-sizing: border-box; outline: none;";
    container.appendChild(searchInput);

    // 控制全选和统计的工具条
    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display: flex; justify-content: space-between; align-items: center; font-size: 12px; margin-bottom: 8px; padding: 0 4px;";

    const selectAllLabel = document.createElement("label");
    selectAllLabel.style.cssText = "display: flex; align-items: center; cursor: pointer; font-weight: 500;";
    const selectAllCheckbox = document.createElement("input");
    selectAllCheckbox.type = "checkbox";
    selectAllCheckbox.style.marginRight = "6px";
    selectAllLabel.appendChild(selectAllCheckbox);
    selectAllLabel.appendChild(document.createTextNode("全选所有集"));
    toolbar.appendChild(selectAllLabel);

    const countStats = document.createElement("span");
    countStats.textContent = `已选择: 0 / ${pages.length}`;
    countStats.style.cssText = "color: #909399; font-weight: 500;";
    toolbar.appendChild(countStats);
    container.appendChild(toolbar);

    // 分P视频列表区域（带滚动条）
    const listContainer = document.createElement("div");
    listContainer.style.cssText = "flex: 1; overflow-y: auto; margin-bottom: 16px; border: 1px solid #f2f6fc; border-radius: 10px; background: #fafafa; max-height: 300px; padding: 8px 0;";

    const rowElements: { checkbox: HTMLInputElement; page: any; rowDiv: HTMLDivElement; statusDiv: HTMLElement }[] = [];

    pages.forEach((page: any) => {
        const row = document.createElement("div");
        row.style.cssText = "display: flex; align-items: center; padding: 8px 16px; transition: background 0.2s; border-bottom: 1px solid #f2f6fc; cursor: pointer;";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.style.cssText = "margin-right: 10px; cursor: pointer;";
        row.appendChild(cb);

        const pNum = document.createElement("span");
        pNum.textContent = `P${page.page}`;
        pNum.style.cssText = "font-size: 12px; font-weight: bold; background: #e8f4ff; color: #1890ff; padding: 2px 6px; border-radius: 4px; margin-right: 8px; flex-shrink: 0;";
        row.appendChild(pNum);

        const pTitle = document.createElement("span");
        pTitle.textContent = page.part;
        pTitle.style.cssText = "font-size: 13px; color: #303133; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; margin-right: 8px;";
        row.appendChild(pTitle);

        const pStatus = document.createElement("span");
        pStatus.textContent = "等待中";
        pStatus.style.cssText = "font-size: 11px; color: #909399; flex-shrink: 0; font-weight: 500;";
        row.appendChild(pStatus);

        // 点击整行切换选择状态（除复选框自身）
        row.addEventListener("click", (e) => {
            if (e.target !== cb) {
                cb.checked = !cb.checked;
                updateStats();
            }
        });
        cb.addEventListener("change", updateStats);

        listContainer.appendChild(row);
        rowElements.push({ checkbox: cb, page, rowDiv: row, statusDiv: pStatus });
    });
    container.appendChild(listContainer);

    // 过滤列表逻辑
    searchInput.addEventListener("input", () => {
        const filter = searchInput.value.toLowerCase();
        rowElements.forEach(item => {
            const match = item.page.part.toLowerCase().includes(filter) || `p${item.page.page}`.includes(filter);
            item.rowDiv.style.display = match ? "flex" : "none";
        });
    });

    // 全选/取消全选逻辑
    selectAllCheckbox.addEventListener("change", () => {
        const checked = selectAllCheckbox.checked;
        rowElements.forEach(item => {
            if (item.rowDiv.style.display !== "none") {
                item.checkbox.checked = checked;
            }
        });
        updateStats();
    });

    function updateStats() {
        const selectedCount = rowElements.filter(item => item.checkbox.checked).length;
        countStats.textContent = `已选择: ${selectedCount} / ${pages.length}`;
        selectAllCheckbox.checked = selectedCount === rowElements.length && pages.length > 0;
    }

    // 4. 底部批量下载控制按钮
    const actionsContainer = document.createElement("div");
    actionsContainer.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

    const btnVideo = document.createElement("button");
    btnVideo.textContent = "🎬 批量下载选中视频轨";
    btnVideo.style.cssText = "width: 100%; padding: 12px; background: #00a1d6; color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: bold; font-size: 13px; transition: opacity 0.2s;";
    btnVideo.addEventListener("click", () => startBatchDownload("video"));
    actionsContainer.appendChild(btnVideo);

    const btnAudio = document.createElement("button");
    btnAudio.textContent = "🎵 批量下载选中音频轨";
    btnAudio.style.cssText = "width: 100%; padding: 12px; background: #f25d8e; color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: bold; font-size: 13px; transition: opacity 0.2s;";
    btnAudio.addEventListener("click", () => startBatchDownload("audio"));
    actionsContainer.appendChild(btnAudio);

    container.appendChild(actionsContainer);

    // 5. 批量流式保存至指定文件夹
    async function startBatchDownload(type: "video" | "audio") {
        const selectedItems = rowElements.filter(item => item.checkbox.checked);
        if (selectedItems.length === 0) {
            alert("请先在列表中勾选想要下载的分P！");
            return;
        }

        // @ts-ignore
        if (typeof window.showDirectoryPicker !== 'function') {
            alert("当前浏览器环境不支持文件夹保存 API，请升级 Chrome！");
            return;
        }

        let dirHandle: any = null;
        try {
            // 一次授权整个文件夹，后续写入免弹窗打扰
            // @ts-ignore
            dirHandle = await window.showDirectoryPicker();
        } catch (e) {
            console.warn("User cancelled directory picker", e);
            return;
        }

        // 锁定控制按钮防止重复点击
        btnVideo.disabled = true;
        btnAudio.disabled = true;
        searchInput.disabled = true;
        selectAllCheckbox.disabled = true;
        rowElements.forEach(item => item.checkbox.disabled = true);

        // 串行队列依次下载
        for (let i = 0; i < selectedItems.length; i++) {
            const item = selectedItems[i];
            item.statusDiv.textContent = "获取链接...";
            item.statusDiv.style.color = "#1890ff";
            item.rowDiv.style.background = "#e6f7ff";

            // 自动将列表滚动到当前下载项
            item.rowDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            const cleanPartTitle = item.page.part.replace(/[\\/:*?"<>|]/g, '_').trim();
            const filename = type === "video"
                ? `${videoTitle}_P${item.page.page}_${cleanPartTitle}_视频.mp4`.replace(/[\\/:*?"<>|]/g, '_')
                : `${videoTitle}_P${item.page.page}_${cleanPartTitle}_音频.mp3`.replace(/[\\/:*?"<>|]/g, '_');

            let fileWritable: any = null;
            try {
                // 1. 请求该分 P 的流媒体链接
                const playData = await fetchPlayUrl(item.page.cid);
                const streamList = type === "video" ? playData.dash.video : playData.dash.audio;
                if (!streamList || streamList.length === 0) {
                    throw new Error(`未找到${type === "video" ? "视频" : "音频"}流`);
                }
                const bestStream = [...streamList].sort((a, b) => (b.id || 0) - (a.id || 0))[0];
                const streamUrl = bestStream.baseUrl || bestStream.backupUrl[0];

                // 2. 在自选文件夹中新建文件
                const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
                fileWritable = await fileHandle.createWritable();

                // 3. 流式读取并存入磁盘
                const response = await fetch(streamUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                if (!response.body) throw new Error("流无法读取");

                const reader = response.body.getReader();
                const contentLength = +(response.headers.get('Content-Length') || 0);
                let receivedLength = 0;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    await fileWritable.write(value);
                    receivedLength += value.length;

                    if (contentLength) {
                        const pct = Math.round((receivedLength / contentLength) * 100);
                        item.statusDiv.textContent = `${pct}%`;
                    } else {
                        item.statusDiv.textContent = `${(receivedLength / (1024 * 1024)).toFixed(1)}MB`;
                    }
                }

                await fileWritable.close();
                item.statusDiv.textContent = "已完成";
                item.statusDiv.style.color = "#52c41a";
                item.rowDiv.style.background = "#f6ffed";
            } catch (err: any) {
                console.error(err);
                item.statusDiv.textContent = "失败";
                item.statusDiv.style.color = "#f5222d";
                item.rowDiv.style.background = "#fff2f0";
                if (fileWritable) {
                    try { await fileWritable.abort(); } catch (e) { }
                }
            }
        }

        // 解除控制锁定
        btnVideo.disabled = false;
        btnAudio.disabled = false;
        searchInput.disabled = false;
        selectAllCheckbox.disabled = false;
        rowElements.forEach(item => item.checkbox.disabled = false);
        alert("🎉 批量下载任务执行完毕！");
    }

    // 防止面板重复渲染
    const existing = document.getElementById("b-batch-download-container");
    if (existing) existing.remove();

    document.body.appendChild(container);
})();