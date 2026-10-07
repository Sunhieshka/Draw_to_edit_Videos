import { useEffect, useState } from 'react'
import { api, PENDING } from './api'
import GeneratePanel from './components/GeneratePanel'
import VideoLibrary from './components/VideoLibrary'
import DrawToEdit from './components/DrawToEdit'
import AssetLibrary from './components/AssetLibrary'

const STORAGE_KEY = 'draw-to-edit.videos'

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [models, setModels] = useState([])
  const [health, setHealth] = useState(null)
  const [videos, setVideos] = useState(() => load(STORAGE_KEY, []))
  const [selectedId, setSelectedId] = useState(null)
  const [assetConfig, setAssetConfig] = useState(null)
  const [assetGroup, setAssetGroup] = useState(() => load('draw-to-edit.assetGroup', null))
  const [pickedAssets, setPickedAssets] = useState(() => load('draw-to-edit.pickedAssets', []))

  useEffect(() => {
    api.models().then(setModels).catch(() => {})
    api.health().then(setHealth).catch(() => setHealth({ ok: false }))
    api.assetConfig().then(setAssetConfig).catch(() => setAssetConfig({ enabled: false }))
  }, [])

  useEffect(() => save(STORAGE_KEY, videos), [videos])
  useEffect(() => save('draw-to-edit.assetGroup', assetGroup), [assetGroup])
  useEffect(() => save('draw-to-edit.pickedAssets', pickedAssets), [pickedAssets])

  const togglePick = (asset) =>
    setPickedAssets((ps) =>
      ps.some((p) => p.id === asset.id)
        ? ps.filter((p) => p.id !== asset.id)
        : [...ps, { id: asset.id, uri: asset.uri, type: asset.type, name: asset.name, preview_url: asset.preview_url }],
    )

  const updateVideo = (id, patch) =>
    setVideos((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)))

  const addVideo = (video) => {
    const v = { id: crypto.randomUUID(), createdAt: Date.now(), ...video }
    setVideos((vs) => [v, ...vs])
    return v
  }

  // Poll pending tasks every 5s.
  const pendingKey = videos
    .filter((v) => v.taskId && PENDING.includes(v.status))
    .map((v) => v.id)
    .join(',')

  useEffect(() => {
    if (!pendingKey) return
    const tick = async () => {
      const pending = videos.filter((v) => v.taskId && PENDING.includes(v.status))
      for (const v of pending) {
        try {
          const t = await api.task(v.taskId)
          updateVideo(v.id, {
            status: t.status,
            videoUrl: t.video_url || v.videoUrl,
            localVideo: t.local_video || v.localVideo,
            duration: t.duration ?? v.duration,
            error: t.error || t.download_error || null,
          })
        } catch (e) {
          updateVideo(v.id, { error: e.message })
        }
      }
    }
    tick()
    const timer = setInterval(tick, 5000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey])

  const selected = videos.find((v) => v.id === selectedId)

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-zinc-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-lg font-bold shadow-lg shadow-fuchsia-500/20">
              ✎
            </div>
            <div>
              <h1 className="text-[15px] font-semibold leading-tight tracking-tight">
                Draw to Edit
                <span className="ml-2 rounded-md bg-white/5 px-1.5 py-0.5 align-middle text-[10px] font-medium text-zinc-400 ring-1 ring-inset ring-white/10">
                  Seedance
                </span>
              </h1>
              <p className="text-xs text-zinc-500">Generate a video, mark a region, remove · replace · modify · add</p>
            </div>
          </div>
          {health &&
            (health.ok && health.api_key_set ? (
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 ring-1 ring-inset ring-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Connected
              </span>
            ) : (
              <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 ring-1 ring-inset ring-amber-500/20">
                {health.ok === false ? 'Backend not reachable on :8000' : 'ARK_API_KEY missing in backend/.env'}
              </span>
            ))}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <GeneratePanel
            models={models}
            pickedAssets={pickedAssets}
            onUnpick={togglePick}
            uploadEnabled={!!assetConfig?.upload_enabled}
            onCreated={(v) => {
              // Show the new video (and its progress while generating) in the main panel.
              setSelectedId(addVideo(v).id)
            }}
          />
          <AssetLibrary
            config={assetConfig}
            group={assetGroup}
            onGroupChange={setAssetGroup}
            picked={pickedAssets}
            onTogglePick={togglePick}
          />
          <VideoLibrary
            videos={videos}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRemove={(id) => {
              setVideos((vs) => vs.filter((v) => v.id !== id))
              if (id === selectedId) setSelectedId(null)
            }}
          />
        </div>

        <DrawToEdit
          key={selected?.id || 'none'}
          video={selected}
          models={models}
          edits={videos.filter((v) => v.kind === 'edit' && v.parentId && v.parentId === selected?.id)}
          onCreated={(v) => addVideo({ ...v, parentId: selected?.id })}
          onSelect={setSelectedId}
          onUpdateVideo={updateVideo}
          assetsEnabled={!!assetConfig?.enabled}
          assetGroup={assetGroup}
          pickedAssets={pickedAssets}
        />
      </main>
    </div>
  )
}
