import './web-api'
import '@renderer/main'
// 必须排在 renderer 之后导入，才能覆盖桌面样式
import './mobile.css'

// 注册 Service Worker（离线壳缓存）；仅在生产构建与支持的环境下执行
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const url = `${import.meta.env.BASE_URL}sw.js`
    void navigator.serviceWorker
      .register(url, { scope: import.meta.env.BASE_URL })
      .catch(() => undefined)
  })
}
