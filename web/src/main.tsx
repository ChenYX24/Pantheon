import { appURL } from './basePath'
import { ProjectWorkspace } from './components/ProjectWorkspace'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { AuthGate } from './components/AuthGate'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ChatPage } from './components/ChatPage'
import { SharingPage } from './components/SharingPage'
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
// workspace, chat and sharing pages use the same AuthGate and cookie.
// `/share/<token>` never reaches this bundle: the server answers it
// with the page the link draws, or with a page of its own saying the link no
// longer works, so a stranger holding a share address is never one click from
// the sign-in screen.
const route = routeFor(location.pathname)

createRoot(root).render(
  <StrictMode>
    {route.kind === 'projects' ? (
      <ErrorBoundary label="Project workspace"><AuthGate>{(_auth, signOut) => <ProjectWorkspace onSignOut={signOut} />}</AuthGate></ErrorBoundary>
    ) : route.kind === 'sharing' ? (
      <ErrorBoundary label="The sharing page">
        <AuthGate>{(auth, signOut) => <SharingPage auth={auth} onSignOut={signOut} />}</AuthGate>
      </ErrorBoundary>
    ) : route.kind === 'chat' ? (
      <ErrorBoundary label="The chat page">
        <AuthGate>{(auth, signOut) => <ChatPage auth={auth} onSignOut={signOut} />}</AuthGate>
      </ErrorBoundary>
    ) : (
      <ErrorBoundary label="The panel">
        <AuthGate>{(auth, signOut) => <App auth={auth} onSignOut={signOut} />}</AuthGate>
      </ErrorBoundary>
    )}
  </StrictMode>,
)
