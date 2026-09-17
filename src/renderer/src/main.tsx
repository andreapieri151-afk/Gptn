import { createRoot } from 'react-dom/client'
import App from './App'
import { isDesktop } from './platform/api'
import './styles/global.css'
import './styles/highlight.css'

// In the packaged app the window is transparent and macOS vibrancy shows through.
// In a plain browser (interface preview) the page needs its own background.
document.documentElement.dataset.shell = isDesktop ? 'electron' : 'browser'

const container = document.getElementById('root')
if (!container) throw new Error('GPTN: #root container is missing from index.html')

// No StrictMode: the app deliberately performs side effects on mount
// (opening/creating the active conversation) that must run exactly once.
createRoot(container).render(<App />)
