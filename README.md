# Local Script Manager (开发说明文档)

这是一个基于 **Vite + Vue 3 + CRXJS + TypeScript** 构建的 Chrome 浏览器插件项目，用于管理和注入本地 JavaScript 脚本。

---

## 🛠️ 技术栈

* **构建工具**: Vite 5
* **框架**: Vue 3 (Composition API, `<script setup>`)
* **扩展开发插件**: `@crxjs/vite-plugin` (CRXJS)
* **语言**: TypeScript
* **样式**: CSS (可扩展支持 SASS/LESS)

---

## 📂 目录结构

```
chrome-plugin/
├── src/                      # 源代码目录
│   ├── background.ts         # 后台服务脚本 (Service Worker)
│   ├── popup/                # 弹窗面板 (页面 & Vue 挂载)
│   │   ├── index.html
│   │   ├── main.ts
│   │   └── App.vue
│   └── guide/                # 使用说明独立页面 (页面 & Vue 挂载)
│       ├── index.html
│       ├── main.ts
│       └── App.vue
├── public/                   # 静态资源目录 (打包时会自动复制到 dist 根目录)
│   ├── icon-*.png            # 各种尺寸的黄底 JS 插件图标
│   ├── icon.svg              # 矢量图标
│   └── scripts/              # 存放本地用户脚本清单和文件
│       ├── index.json        # 脚本配置文件
│       └── ...               # 其他本地 .js 脚本文件
├── native-host/              # 本地宿主程序相关文件
│   ├── register-host.ps1     # 注册 Native Host 脚本
│   └── unregister-host.bat   # 一键取消注册脚本
├── manifest.json             # 插件清配置单
├── vite.config.ts            # Vite 配置文件 (集成了 CRXJS 和自动复制宿主插件)
├── tsconfig.json             # TypeScript 配置
└── package.json              # 项目依赖及脚本说明
```

---

## 🚀 快速开始

### 1. 安装依赖
在项目根目录下打开终端，执行：
```bash
npm install
```

### 2. 启动开发模式 (热更新 HMR)
```bash
npm run dev
```
* 该命令会启动开发服务器并在根目录实时生成 `dist/` 文件夹。
* **加载插件**：打开 Chrome 浏览器 $\rightarrow$ 进入 `chrome://extensions/` $\rightarrow$ 开启“开发者模式” $\rightarrow$ 点击“加载已解压的扩展程序” $\rightarrow$ 选择项目根目录下的 **`dist/`** 目录。
* **热重载**：开发过程中，修改 `src/` 下的代码并保存后，Chrome 中的插件会自动实时刷新，无需手动重载。

### 3. 生产环境打包
```bash
npm run build
```
* 该命令会先进行 TypeScript 类型检查（`vue-tsc`），然后将代码混淆压缩打包进 `dist/` 目录。
* 打包完成后，`native-host` 目录会自动复制到 `dist/native-host` 目录中，方便分发。

---

## 🐞 调试指南

1. **调试弹窗界面 (Popup)**:
   * 点击 Chrome 栏的插件图标展开弹窗，在弹窗内**右键选择“检查” (Inspect)** 即可打开专用的 DevTools 调试控制台和 Vue 状态。

2. **调试后台服务脚本 (Background)**:
   * 在 `chrome://extensions/` 页面中找到本插件，点击卡片上的 **`服务工作线程 (service worker)`** 蓝色链接，会弹出独立的后台调试窗口。

3. **调试使用说明页 (Guide)**:
   * 在使用说明的浏览器页签中直接按 `F12` 即可调试。

---

## 🔒 宿主程序对接 (Native Host)

由于浏览器安全沙箱限制，导入、删除、打开本地文件功能需要本地 Native Host 的支持：

1. **注册 Native Host**：
   * 复制你在 Chrome 中安装好该插件后生成的**扩展程序 ID**。
   * 进入 `dist/native-host/` (或开发目录 `native-host/`)。
   * 打开 PowerShell 运行以下命令：
     ```powershell
     powershell -ExecutionPolicy Bypass -File .\register-host.ps1 -ExtensionId "你的扩展ID"
     ```
2. **取消注册 (卸载)**：
   * 双击运行 `native-host` 目录下的 `unregister-host.bat` 即可一键清理注册表及配置文件。
