import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Button, Card, ErrorText, Input, Select } from './ui'

const GROUP_TYPES = [
  { id: 'LivenessFace', label: 'Real people', hint: 'Verified humans. Uploads must match the verified face.' },
  { id: 'AIGC', label: 'Virtual', hint: 'Fictional characters and objects. Must not resemble a real person.' },
]

const STATUS_STYLE = {
  Active: 'bg-emerald-500/15 text-emerald-300',
  Processing: 'bg-sky-500/15 text-sky-300',
  Failed: 'bg-red-500/15 text-red-300',
}

export default function AssetLibrary({ config, group, onGroupChange, picked, onTogglePick }) {
  const [groupType, setGroupType] = useState(group?.type || 'LivenessFace')
  const [groups, setGroups] = useState([])
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [newGroup, setNewGroup] = useState(null)
  const [verify, setVerify] = useState(null)
  const fileRef = useRef(null)

  const enabled = config?.enabled

  // Load groups for the selected type.
  useEffect(() => {
    if (!enabled) return
    setError('')
    api
      .assetGroups(groupType)
      .then((gs) => {
        setGroups(gs)
        if (!group || group.type !== groupType || !gs.some((g) => g.id === group.id)) {
          onGroupChange(gs.find((g) => g.id === config.default_group_id) || gs[0] || null)
        }
      })
      .catch((e) => setError(e.message))
  }, [enabled, groupType]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadAssets = useCallback(async () => {
    if (!group) return setAssets([])
    setLoading(true)
    try {
      setAssets(await api.assets(group.id, group.type))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [group])

  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  // Refresh while anything is still processing.
  const processing = assets.some((a) => a.status === 'Processing')
  useEffect(() => {
    if (!processing) return
    const t = setInterval(loadAssets, 4000)
    return () => clearInterval(t)
  }, [processing, loadAssets])

  const addAsset = async (fn) => {
    setUploading(true)
    setError('')
    try {
      const a = await fn()
      setAssets((as) => [{ ...a, group_id: group.id }, ...as])
      setTimeout(loadAssets, 1500)
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const createGroup = async () => {
    try {
      const g = await api.createAssetGroup(newGroup.trim())
      setGroups((gs) => [g, ...gs])
      onGroupChange(g)
      setNewGroup(null)
    } catch (e) {
      setError(e.message)
    }
  }

  const startVerify = async () => {
    setError('')
    try {
      setVerify({ ...(await api.startVerification()), checking: false })
    } catch (e) {
      setError(e.message)
    }
  }

  const checkVerify = async () => {
    setVerify((v) => ({ ...v, checking: true }))
    try {
      const r = await api.verificationResult(verify.token)
      if (r.group_id) {
        const g = { id: r.group_id, name: 'Newly verified person', type: 'LivenessFace' }
        setGroups((gs) => [g, ...gs.filter((x) => x.id !== g.id)])
        onGroupChange(g)
        setVerify(null)
      } else {
        setVerify((v) => ({ ...v, checking: false, note: 'Not finished yet — complete the check on the link, then try again.' }))
      }
    } catch (e) {
      setVerify((v) => ({ ...v, checking: false, note: e.message }))
    }
  }

  if (!config) return null
  if (!enabled) {
    return (
      <Card title="Asset library" subtitle="Use real people in videos">
        <p className="text-xs text-zinc-400">
          Add <code className="text-zinc-200">BYTEPLUS_AK</code> and <code className="text-zinc-200">BYTEPLUS_SK</code>{' '}
          to <code className="text-zinc-200">backend/.env</code> to upload human images and videos to the ModelArk asset
          library.
        </p>
      </Card>
    )
  }

  const pickedIds = new Set(picked.map((p) => p.id))
  const typeMeta = GROUP_TYPES.find((t) => t.id === groupType)

  return (
    <Card
      title="Asset library"
      subtitle="Human images / videos must go through here"
      actions={
        <div className="flex rounded-lg bg-zinc-800 p-0.5 text-xs">
          {GROUP_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setGroupType(t.id)}
              className={`rounded-md px-2.5 py-1 ${groupType === t.id ? 'bg-zinc-950 text-white' : 'text-zinc-400'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-[11px] text-zinc-500">{typeMeta.hint}</p>

        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Select
              value={group?.id || ''}
              onChange={(e) => onGroupChange(groups.find((g) => g.id === e.target.value) || null)}
              options={
                groups.length
                  ? groups.map((g) => ({ value: g.id, label: g.name ? `${g.name} · ${g.id.slice(-5)}` : g.id }))
                  : [{ value: '', label: 'No groups yet' }]
              }
            />
          </div>
          {groupType === 'AIGC' ? (
            <Button variant="ghost" onClick={() => setNewGroup('')} title="New group">
              ＋
            </Button>
          ) : (
            <Button variant="ghost" onClick={startVerify} title="Verify a new real person">
              Verify
            </Button>
          )}
        </div>

        {newGroup !== null && (
          <div className="flex gap-2">
            <Input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Character name" autoFocus />
            <Button onClick={createGroup} disabled={!newGroup.trim()}>
              Create
            </Button>
            <Button variant="ghost" onClick={() => setNewGroup(null)}>
              ✕
            </Button>
          </div>
        )}

        {verify && (
          <div className="space-y-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs text-zinc-300">
            <p>
              Send this link <b>only to the person being verified</b>. They consent and complete the liveness check
              themselves (valid ~30 min).
            </p>
            <a href={verify.h5_link} target="_blank" rel="noreferrer" className="block truncate text-indigo-300 underline">
              Open verification page ↗
            </a>
            {verify.note && <p className="text-amber-300">{verify.note}</p>}
            <div className="flex gap-2">
              <Button onClick={checkVerify} disabled={verify.checking}>
                {verify.checking ? 'Checking…' : 'Check result'}
              </Button>
              <Button variant="ghost" onClick={() => setVerify(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {group && (
          <div className="space-y-2 rounded-lg border border-dashed border-zinc-700 p-3">
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                disabled={uploading || !config.upload_enabled}
                title={config.upload_enabled ? '' : 'Needs TOS_BUCKET_NAME in backend/.env'}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? 'Uploading…' : '⬆ Upload image / video'}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) addAsset(() => api.uploadAsset(group.id, file, file.name.replace(/\.[^.]+$/, '')))
                }}
              />
            </div>
            <div className="flex gap-2">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or a public https:// URL" />
              <Button
                variant="ghost"
                disabled={uploading || !url.startsWith('https://')}
                onClick={() =>
                  addAsset(async () => {
                    const a = await api.createAsset({ group_id: group.id, url })
                    setUrl('')
                    return a
                  })
                }
              >
                Add
              </Button>
            </div>
            <p className="text-[10px] text-zinc-500">
              Images 300–6000px, &lt;30MB · Videos 2–30s mp4/mov, ≤200MB. Processing takes a few seconds.
            </p>
          </div>
        )}

        <ErrorText>{error}</ErrorText>

        {group && (
          <div>
            <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-500">
              <span>
                {assets.length} asset{assets.length === 1 ? '' : 's'} · click to use as a reference
              </span>
              <button onClick={loadAssets} className="hover:text-zinc-300">
                {loading ? '…' : '↻ Refresh'}
              </button>
            </div>
            <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1">
              {assets.map((a) => {
                const isPicked = pickedIds.has(a.id)
                const usable = a.status === 'Active'
                return (
                  <button
                    key={a.id}
                    disabled={!usable}
                    onClick={() => onTogglePick(a)}
                    title={a.error || a.name || a.id}
                    className={`group relative aspect-square overflow-hidden rounded-lg border-2 bg-zinc-800 text-left transition ${
                      isPicked ? 'border-fuchsia-500' : 'border-transparent hover:border-zinc-600'
                    } disabled:cursor-default`}
                  >
                    {a.preview_url &&
                      (a.type === 'Video' ? (
                        <video src={a.preview_url} muted preload="metadata" className="h-full w-full object-cover" />
                      ) : (
                        <img src={a.preview_url} alt={a.name || ''} className="h-full w-full object-cover" />
                      ))}
                    <span
                      className={`absolute left-1 top-1 rounded px-1 text-[9px] font-medium ${STATUS_STYLE[a.status] || 'bg-zinc-700 text-zinc-300'}`}
                    >
                      {a.type === 'Video' ? '▶ ' : ''}
                      {a.status}
                    </span>
                    {isPicked && (
                      <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-fuchsia-500 text-[11px] text-white">
                        ✓
                      </span>
                    )}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[10px] text-zinc-200">
                      {a.name || a.id}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
