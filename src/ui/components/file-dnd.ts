import type { DragEvent } from 'react'

export interface FileDragPayload {
  name?: string
  fromPath?: string[]
  type?: string
}

export interface MovableFileDragPayload extends FileDragPayload {
  name: string
  fromPath: string[]
}

export function pathsEqual(a?: string[], b?: string[]): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  return a.length === b.length && a.every((seg, index) => seg === b[index])
}

export function isSameOrDescendantPath(path: string[], ancestor: string[]): boolean {
  if (path.length < ancestor.length) return false
  return ancestor.every((seg, index) => path[index] === seg)
}

export function writeFileDragPayload(event: DragEvent, payload: FileDragPayload): void {
  const serialized = JSON.stringify(payload)
  try {
    event.dataTransfer.setData('application/json', serialized)
  } catch {
    event.dataTransfer.setData('text/plain', serialized)
  }
}

export function readFileDragPayload(event: DragEvent): FileDragPayload | null {
  try {
    const raw = event.dataTransfer.getData('application/json') || event.dataTransfer.getData('text/plain')
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function canMovePayloadToPath(
  payload: FileDragPayload | null,
  targetPath: string[],
): payload is MovableFileDragPayload {
  if (!payload?.name || !Array.isArray(payload.fromPath)) return false
  if (pathsEqual(payload.fromPath, targetPath)) return false

  if (payload.type === 'folder') {
    const draggedFolderPath = [...payload.fromPath, payload.name]
    if (isSameOrDescendantPath(targetPath, draggedFolderPath)) return false
  }

  return true
}
