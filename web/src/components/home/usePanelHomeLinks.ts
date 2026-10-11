import { homeApi } from '../../protocol/home'
import { panelProjectLinks } from '../shell/model'
import { useHomeResource } from './useHomeResource'

const load = (signal: AbortSignal) => homeApi.index(true, signal)

export function usePanelHomeLinks() {
  const index = useHomeResource(load)
  return panelProjectLinks(index.data?.available ? index.data.projects : [])
}
