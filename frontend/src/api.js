async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d) => d.msg).join('; ')
      : data.detail
    throw new Error(detail || `Request failed (${res.status})`)
  }
  return data
}

export const api = {
  health: () => request('/api/health'),
  models: () => request('/api/models'),
  generate: (body) => request('/api/generate', { method: 'POST', body: JSON.stringify(body) }),
  edit: (body) => request('/api/edit', { method: 'POST', body: JSON.stringify(body) }),
  task: (id) => request(`/api/tasks/${id}`),
  importVideo: (url) => request('/api/import', { method: 'POST', body: JSON.stringify({ url }) }),

  // Asset library (real people / virtual characters)
  assetConfig: () => request('/api/assets/config'),
  assetGroups: (groupType) => request(`/api/assets/groups?group_type=${groupType}`),
  createAssetGroup: (name) => request('/api/assets/groups', { method: 'POST', body: JSON.stringify({ name }) }),
  startVerification: () => request('/api/assets/verify', { method: 'POST', body: '{}' }),
  verificationResult: (token) => request(`/api/assets/verify/${encodeURIComponent(token)}`),
  assets: (groupId, groupType) =>
    request(`/api/assets?group_id=${encodeURIComponent(groupId)}&group_type=${groupType}`),
  asset: (id) => request(`/api/assets/${id}`),
  createAsset: (body) => request('/api/assets', { method: 'POST', body: JSON.stringify(body) }),
  async uploadMedia(file) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.detail || `Upload failed (${res.status})`)
    return data
  },
  async uploadAsset(groupId, file, name) {
    const form = new FormData()
    form.append('group_id', groupId)
    form.append('file', file)
    if (name) form.append('name', name)
    const res = await fetch('/api/assets/upload', { method: 'POST', body: form })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.detail || `Upload failed (${res.status})`)
    return data
  },
}

/** Poll an asset until it is Active; throws if it fails. */
export async function waitForAsset(id, { onStatus, timeoutMs = 300000 } = {}) {
  const start = Date.now()
  for (;;) {
    const a = await api.asset(id)
    onStatus?.(a.status)
    if (a.status === 'Active') return a
    if (a.status === 'Failed') throw new Error(`Asset ${id} failed: ${a.error || 'rejected by the asset library'}`)
    if (Date.now() - start > timeoutMs) throw new Error(`Asset ${id} is still ${a.status} after ${timeoutMs / 1000}s`)
    await new Promise((r) => setTimeout(r, 3000))
  }
}

export const PENDING = ['queued', 'running', 'pending', 'submitted']
