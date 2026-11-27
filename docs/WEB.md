# 网页版（PWA）说明

同一套引擎与界面，同时构建成两类产物：

| 产物 | 平台 | 构建命令 |
|---|---|---|
| Windows 便携版 | Windows 10/11 x64 | `pnpm build && pnpm package:win` |
| 网页版 / PWA | iPhone Safari、Android Chrome、桌面浏览器 | `pnpm build:web` |

在线地址：<https://fushon2000.github.io/ashare-yidong-radar/>（GitHub Pages 自动部署）

## 为什么 iPhone 不能装桌面版

Electron 只提供 Windows / macOS / Linux 运行时，iOS 上不存在对应运行环境，也不允许执行外来二进制。
因此移动端采用「同一份渲染层 + 浏览器版 `window.api`」的方案，而不是移植 Electron。

## 实现方式

```text
src/web/index.html            入口 HTML（PWA 元信息）
src/web/main.ts               注入 web-api → 加载渲染层 → 注册 Service Worker
src/web/web-api.ts            浏览器版 window.api（复用 MarketDataProvider）
src/web/mobile.css            手机端布局覆盖（≤760px）
src/web/public/manifest.webmanifest
src/web/public/sw.js          壳缓存：导航网络优先、静态资源缓存优先、行情接口不缓存
vite.web.config.ts            base=/ashare-yidong-radar/
```

关键点：**渲染层代码零改动**。`src/renderer/src/*` 只依赖 `window.api`，网页版在渲染层加载前
把浏览器实现挂到 `window.api` 上即可，因此桌面版与网页版的业务逻辑、口径、样式完全一致。

## 浏览器端与桌面端的接口差异（实测）

| 接口 | 浏览器可用性 | 网页版处理 |
|---|---|---|
| 东方财富个股实时报价 | ❌ 价格字段被屏蔽（`f2` 返回 0，只有昨收正常） | 不使用 |
| 东方财富指数报价 | ⚠️ 偶发跨域失败 | 不使用 |
| 东方财富日线 | ✅ 可用（UTF-8 JSON，含中文名） | 备源 |
| 腾讯报价 `qt.gtimg.cn` | ✅ 可用（`ACAO: *`、GBK 可解码、支持批量） | **主源** |
| 腾讯日线 `web.ifzq.gtimg.cn` | ✅ 可用 | 主源 |
| 东方财富搜索 | ❌ 跨域被拦 | 不使用 |
| 腾讯 smartbox 搜索 | ❌ fetch 被拦，但返回 `v_hint=` 赋值 | **script 标签 JSONP 读取** |

因此网页版把源顺序调整为 `[腾讯, 东财]`（通过 `MarketDataProvider` 新增的 `sources` 参数），
并把设置里的「数据源 = 东方财富」自动降级为「自动」。桌面版顺序不变，仍是东财优先。

## 能力差异

| 能力 | 桌面版 | 网页版 |
|---|---|---|
| 行情主备双源、偏离值、三时点测算、次数判定 | ✅ | ✅ |
| 缓存 | 本地文件 | localStorage |
| 通知 | Windows 通知 | Web Notification（页面打开时） |
| 托盘常驻 / 关闭继续运行 | ✅ | ❌ |
| CSV 导入导出 | 文件对话框 | 浏览器下载 / 选文件 |
| 拖动排序关注池 | ✅ | ❌（触屏无 HTML5 拖放） |

## iPhone 使用方式

1. Safari 打开 <https://fushon2000.github.io/ashare-yidong-radar/>
2. 分享按钮 → **添加到主屏幕**
3. 从主屏幕图标启动，即为全屏无地址栏的类 App 体验

首次进入先点一下页面任意位置，允许通知权限（用于严重异动提醒）。

## 本地开发与验证

```bash
pnpm dev:web      # 本地开发服务器
pnpm build:web    # 产物输出到 dist-web/
node tools/web-check.mjs   # 用无头 Edge 按 iPhone 15 Pro Max 视口渲染并截图
```

`tools/web-check.mjs` 会加载真实行情并截取首屏、偏离卡、模拟面板、测算表、趋势图与设置页，
输出到 `docs/screenshots/web-iphone-*.png`。

## 已知限制

- 触屏无法拖动排序关注池；需要排序时请在桌面版操作，或用 CSV 导入顺序。
- 「关闭窗口最小化到托盘」在网页版无效（设置项保留但不生效）。
- 页面关闭后不再计算与提醒；iOS 后台推送需要额外的推送服务，未实现。
- 东方财富接口跨域已实测放开（`Access-Control-Allow-Origin` 反射来源），腾讯源在 iOS Safari
  上因 GBK 解码支持不完整可能不可用，实际默认走东方财富。
