export function watchHomeVisibility(refresh: () => void, poll: boolean): () => void {
  const tick = () => { if (!document.hidden) refresh() }
  tick()
  const timer = poll ? window.setInterval(tick, 10_000) : undefined
  document.addEventListener('visibilitychange', tick)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', tick)
  }
}
