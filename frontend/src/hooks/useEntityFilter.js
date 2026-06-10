import { useState, useCallback, useEffect, useRef } from 'react'
import { useAuth } from './useAuth'

/**
 * Page-level entity filter backed by the global activeEntity, so the entity
 * chosen in any dropdown sticks across every page (and across sessions, via
 * localStorage) until the user deliberately picks another one.
 *
 * Pass an initial override (e.g. an entity_id URL param) to land on a
 * specific entity without touching the global selection; the override is
 * dropped the first time the user changes the dropdown.
 *
 * Returns [filterEntity, setFilterEntity] where filterEntity is the entity
 * id as a string ('' = all entities), mirroring the previous useState API.
 */
export function useEntityFilter(initialOverride = '') {
  const { activeEntity, setActiveEntity, entities } = useAuth()
  const [override, setOverride] = useState(initialOverride || '')

  // The override must also yield when the GLOBAL entity changes (sidebar
  // switcher) — otherwise a page opened via ?entity_id=X keeps showing X's
  // data no matter which entity the user switches to.
  const prevActiveId = useRef(activeEntity?.id)
  useEffect(() => {
    if (prevActiveId.current !== activeEntity?.id) {
      prevActiveId.current = activeEntity?.id
      setOverride('')
    }
  }, [activeEntity?.id])

  const filterEntity = override || activeEntity?.id?.toString() || ''

  const setFilterEntity = useCallback((value) => {
    setOverride('')
    setActiveEntity(entities.find(e => e.id === parseInt(value)) || null)
  }, [entities, setActiveEntity])

  return [filterEntity, setFilterEntity]
}
