/**
 * Persistent Storage Module for Zepp OS 1.0 (Amazfit GTR 3 Pro)
 * Uses native hmFS to survive app terminations, system notifications, and device reboots.
 */

const STORAGE_FILE = 'anduin_workout.json'

function str2ab(str) {
  const buf = new ArrayBuffer(str.length * 2)
  const bufView = new Uint16Array(buf)
  for (let i = 0, len = str.length; i < len; i++) {
    bufView[i] = str.charCodeAt(i)
  }
  return buf
}

function ab2str(buf) {
  return String.fromCharCode.apply(null, new Uint16Array(buf))
}

export function saveWorkoutToDisk(data) {
  try {
    if (typeof hmFS === 'undefined') return false
    const jsonStr = JSON.stringify(data)
    const stringBuffer = str2ab(jsonStr)
    const sourceBuf = new Uint8Array(stringBuffer)

    const file = hmFS.open(STORAGE_FILE, hmFS.O_CREAT | hmFS.O_RDWR | hmFS.O_TRUNC)
    if (file < 0) return false

    hmFS.seek(file, 0, hmFS.SEEK_SET)
    hmFS.write(file, sourceBuf.buffer, 0, sourceBuf.length)
    hmFS.close(file)
    return true
  } catch (e) {
    console.log('hmFS save error:', e)
    return false
  }
}

export function loadWorkoutFromDisk() {
  try {
    if (typeof hmFS === 'undefined') return null
    const [stat, err] = hmFS.stat(STORAGE_FILE)
    if (err !== 0 || !stat || stat.size <= 0) return null

    const destBuf = new Uint8Array(stat.size)
    const file = hmFS.open(STORAGE_FILE, hmFS.O_RDONLY)
    if (file < 0) return null

    hmFS.seek(file, 0, hmFS.SEEK_SET)
    hmFS.read(file, destBuf.buffer, 0, stat.size)
    hmFS.close(file)

    const jsonStr = ab2str(destBuf.buffer)
    if (!jsonStr) return null
    return JSON.parse(jsonStr)
  } catch (e) {
    console.log('hmFS load error:', e)
    return null
  }
}

export function clearWorkoutFromDisk() {
  try {
    if (typeof hmFS === 'undefined') return
    hmFS.remove(STORAGE_FILE)
  } catch (e) {
    console.log('hmFS remove error:', e)
  }
}
