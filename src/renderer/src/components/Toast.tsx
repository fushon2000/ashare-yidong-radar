import { useApp } from '../store/AppStore'
import { AlertIcon, CloseIcon, SparkIcon } from './Icons'

export function ToastStack(): React.JSX.Element {
  const { toasts, removeToast } = useApp()
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div className={`toast ${toast.kind}`} key={toast.id}>
          <span className="toast-icon">
            {toast.kind === 'error' ? <AlertIcon size={16} /> : <SparkIcon size={16} />}
          </span>
          <span className="toast-message">{toast.message}</span>
          <button className="toast-close" onClick={() => removeToast(toast.id)} aria-label="关闭">
            <CloseIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
