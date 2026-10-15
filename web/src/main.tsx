import { appURL } from './basePath'
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { AuthGate } from './components/AuthGate'
import { ErrorBoundary } from './components/ErrorBoundary'
import { loadModules, safeMode } from './components/plugins/hostRuntime'
import { showToast } from './components/toasts'
import { routeFor } from './routes'
import { watchSystemTheme } from './components/theme'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

// Before the first render: the meta tag ships one fixed colour, and on a
// home-screen PWA that colour is the chrome around the whole app.
watchSystemTheme()

// The service worker is what makes this installable and what shows a
// notification on Android, where `new Notification()` is refused outright. It
// caches nothing -- see public/sw.js for why that is deliberate rather than
// unfinished.
//
// Registered after load so it never competes with the first paint, and failing
// silently: a panel that will not start because a service worker would not
// register has traded the whole product for a nicety.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(appURL('/sw.js'), { scope: appURL('/') }).catch(() => {})
  })
}

// routes.ts selects the authenticated application page. The terminal, project
// workspace, home, chat and sharing pages use the same AuthGate and cookie.
// `/share/<token>` never reaches this bundle: the server answers it
// with the page the link draws, or with a page of its own saying the link no
// longer works, so a stranger holding a share address is never one click from
// the sign-in screen.
const route = routeFor(location.pathname)

// Each page is its own chunk. The home and resource pages are what a phone
// opens most, and they need none of the terminal (xterm and its addons are
// most of the bundle); the terminal panel likewise needs none of the home.
const HomePage = lazy(() => import('./components/HomePage').then((m) => ({ default: m.HomePage })))
const ProjectWorkspace = lazy(() => import('./components/ProjectWorkspace').then((m) => ({ default: m.ProjectWorkspace })))
const SharingPage = lazy(() => import('./components/SharingPage').then((m) => ({ default: m.SharingPage })))
const ChatPage = lazy(() => import('./components/ChatPage').then((m) => ({ default: m.ChatPage })))
const PluginsPage = lazy(() => import('./components/PluginsPage').then((m) => ({ default: m.PluginsPage })))
const PluginPageRoot = lazy(() => import('./components/plugins/slots').then((m) => ({ default: m.PluginPageRoot })))
const App = lazy(() => import('./App').then((m) => ({ default: m.App })))

// index.html found this browser too old and has said so in #root; starting
// the app here would draw over that with a layout the browser cannot lay out.
if (document.documentElement.dataset.vpUnsupported !== '1') createRoot(root).render(
  <StrictMode>
    <Suspense fallback={null}>
    {route.kind === 'home' ? (
      <ErrorBoundary label="Project home"><AuthGate>{(_auth, signOut) => <HomePage onSignOut={signOut} />}</AuthGate></ErrorBoundary>
    ) : route.kind === 'projects' ? (
      <ErrorBoundary label="Project workspace"><AuthGate>{(_auth, signOut) => <ProjectWorkspace onSignOut={signOut} />}</AuthGate></ErrorBoundary>
    ) : route.kind === 'sharing' ? (
      <ErrorBoundary label="The sharing page">
        <AuthGate>{(auth, signOut) => <SharingPage auth={auth} onSignOut={signOut} />}</AuthGate>
      </ErrorBoundary>
    ) : route.kind === 'chat' ? (
      <ErrorBoundary label="The chat page">
        <AuthGate>{(auth, signOut) => <ChatPage auth={auth} onSignOut={signOut} />}</AuthGate>
      </ErrorBoundary>
    ) : route.kind === 'plugins' ? (
      <ErrorBoundary label="The plugins page">
        <AuthGate>{(auth, signOut) => <PluginsPage auth={auth} onSignOut={signOut} />}</AuthGate>
      </ErrorBoundary>
    ) : route.kind === 'plugin-page' ? (
      <ErrorBoundary label="A plugin's page">
        <AuthGate>{(auth, signOut) => <PluginPageRoot path={route.path} auth={auth} onSignOut={signOut} />}</AuthGate>
      </ErrorBoundary>
    ) : (
      <ErrorBoundary label="The panel">
        <AuthGate>{(auth, signOut) => <App auth={auth} onSignOut={signOut} />}</AuthGate>
      </ErrorBoundary>
    )}
    </Suspense>
  </StrictMode>,
)

// Rung-4 modules (docs/plugins.md §7): on the panel's own page only, after
// the first render, never under ?safe=1 -- which is the way back from a
// module that broke the page, and says so once it has loaded without them.
if (route.kind === 'panel') {
  if (safeMode()) {
    window.addEventListener('load', () => showToast({ kind: 'info', key: 'plg.safe' }))
  } else {
    window.addEventListener('load', () => {
      void loadModules()
    })
  }
}
