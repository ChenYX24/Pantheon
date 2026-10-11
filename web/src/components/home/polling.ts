export function watchHomeVisibility(refresh: () => void, poll: boolean | number): () => void {
  const tick = () => { if (!document.hidden) refresh() }
  tick()
  const timer = poll ? window.setInterval(tick, typeof poll === 'number' ? poll : 10_000) : undefined
  document.addEventListener('visibilitychange', tick)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', tick)
  }
}
