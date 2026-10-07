import { api } from '../api'
import { fileToDataUrl } from '../media'

const DEFAULT_LIMITS = { Image: 9, Video: 3, Audio: 3 }

const KINDS = [
  { type: 'Image', accept: 'image/*', icon: '🖼', multiple: true },
  { type: 'Video', accept: 'video/mp4,video/quicktime,video/webm', icon: '🎞', multiple: false },
  { type: 'Audio', accept: 'audio/*', icon: '♪', multiple: false },
]

/** Number references the way Seedance prompts refer to them: Image 1, Image 2, Video 1… */
export function labelReferences(refs) {
  const counts = {}
  return refs.map((r) => {
    counts[r.type] = (counts[r.type] || 0) + 1
    return { ...r, label: `${r.type} ${counts[r.type]}` }
  })
}

/** All references in send order: uploads first, then selected asset-library items. */
export function collectReferences(uploads, pickedAssets) {
  return labelReferences([
    ...uploads,
    ...pickedAssets.map((a) => ({ id: a.id, type: a.type || 'Image', url: a.uri, preview: a.preview_url, name: a.name, asset: a })),
  ])
}

const totalSeconds = (refs, type) => refs.filter((r) => r.type === type).reduce((t, r) => t + (r.duration || 0), 0)

/** Problems with the references for this model (count / combined-duration limits). */
export function referenceProblems(refs, model) {
  const limits = model?.reference_limits || DEFAULT_LIMITS
  const maxSeconds = model?.reference_max_seconds || {}
  const problems = []
  for (const type of ['Image', 'Video', 'Audio']) {
    const n = refs.filter((r) => r.type === type).length
    if (n > limits[type]) problems.push(`${model?.name || 'This model'} accepts at most ${limits[type]} ${type.toLowerCase()}s (you have ${n}).`)
    const secs = totalSeconds(refs, type)
    if (maxSeconds[type] && secs > maxSeconds[type] + 0.5)
      problems.push(`${type} references total ${secs.toFixed(1)}s — max ${maxSeconds[type]}s combined.`)
  }
  return problems
}

/**
 * Upload tiles for reference images / videos / audio plus selected asset-library items.
 * `uploads` items: { id, type, url, preview, name, uploading, error }.
 */
export default function ReferenceMedia({ uploads, setUploads, pickedAssets, onUnpick, uploadEnabled, model }) {
  const limits = model?.reference_limits || DEFAULT_LIMITS
  const maxSeconds = model?.reference_max_seconds || {}
  const refs = collectReferences(uploads, pickedAssets)
  const count = (type) => refs.filter((r) => r.type === type).length
  const problems = referenceProblems(refs, model)

  const addFiles = (type, files) => {
    const room = limits[type] - count(type)
    for (const file of [...files].slice(0, room)) {
      const id = crypto.randomUUID()
      const preview = URL.createObjectURL(file)
      setUploads((us) => [...us, { id, type, preview, name: file.name, uploading: true }])
      const done = (patch) => setUploads((us) => us.map((u) => (u.id === id ? { ...u, ...patch } : u)))
      const work =
        type === 'Image' && !uploadEnabled
          ? fileToDataUrl(file).then((url) => ({ url })) // images can be sent inline as base64
          : api.uploadMedia(file)
      work
        .then(({ url, duration }) => done({ url, duration: duration ?? null, uploading: false }))
        .catch((e) => done({ uploading: false, error: e.message }))
    }
  }

  const remove = (r) => {
    if (r.asset) onUnpick(r.asset)
    else setUploads((us) => us.filter((u) => u.id !== r.id))
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs font-medium text-zinc-300">
        Reference media
        <span className="font-normal text-zinc-500">
          optional · {limits.Image} images · {limits.Video} videos{maxSeconds.Video ? ` (${maxSeconds.Video}s total)` : ''} ·{' '}
          {limits.Audio} audio{maxSeconds.Audio ? ` (${maxSeconds.Audio}s total)` : ''}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {refs.map((r) => (
          <div
            key={r.id}
            title={r.error || r.name}
            className={`group relative aspect-square overflow-hidden rounded-lg bg-zinc-800 ring-1 ring-inset ${
              r.error ? 'ring-red-500/60' : r.asset ? 'ring-fuchsia-500/50' : 'ring-zinc-700'
            }`}
          >
            {r.type === 'Image' && r.preview && <img src={r.preview} alt="" className="h-full w-full object-cover" />}
            {r.type === 'Video' && r.preview && (
              <video src={r.preview} muted preload="metadata" className="h-full w-full object-cover" />
            )}
            {r.type === 'Audio' && (
              <div className="grid h-full place-items-center p-1 text-center">
                <span className="text-xl text-zinc-400">♪</span>
                <span className="line-clamp-2 text-[9px] text-zinc-400">{r.name}</span>
              </div>
            )}
            <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white">
              {r.label}
            </span>
            {r.duration ? (
              <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[9px] text-zinc-200">
                {r.duration.toFixed(1)}s
              </span>
            ) : null}
            {r.asset && (
              <span className="absolute bottom-1 left-1 rounded bg-fuchsia-500/80 px-1 text-[9px] text-white">asset</span>
            )}
            {r.uploading && (
              <div className="absolute inset-0 grid place-items-center bg-black/50">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-500 border-t-white" />
              </div>
            )}
            {r.error && (
              <span className="absolute inset-x-0 bottom-0 bg-red-600/80 px-1 text-[9px] text-white">failed</span>
            )}
            <button
              onClick={() => remove(r)}
              title="Remove"
              className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-[10px] text-zinc-200 opacity-0 transition group-hover:opacity-100 hover:bg-red-600"
            >
              ✕
            </button>
          </div>
        ))}

        {KINDS.map((k) => {
          const full = count(k.type) >= limits[k.type]
          const needsHosting = k.type !== 'Image' && !uploadEnabled
          const disabled = full || needsHosting
          return (
            <label
              key={k.type}
              title={needsHosting ? 'Needs TOS_BUCKET_NAME in backend/.env to host the file' : full ? 'Limit reached' : `Add ${k.type.toLowerCase()}`}
              className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed text-zinc-400 transition ${
                disabled
                  ? 'cursor-not-allowed border-zinc-800 opacity-40'
                  : 'cursor-pointer border-zinc-700 hover:border-indigo-400 hover:bg-indigo-500/5 hover:text-indigo-300'
              }`}
            >
              <span className="text-xl leading-none">＋</span>
              <span className="text-[10px]">{k.type}</span>
              <span className="text-[9px] text-zinc-500">
                {count(k.type)}/{limits[k.type]}
                {maxSeconds[k.type] ? ` · ${totalSeconds(refs, k.type).toFixed(0)}/${maxSeconds[k.type]}s` : ''}
              </span>
              <input
                type="file"
                accept={k.accept}
                multiple={k.multiple}
                disabled={disabled}
                className="hidden"
                onChange={(e) => {
                  addFiles(k.type, e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
          )
        })}
      </div>
      {problems.map((p) => (
        <p key={p} className="rounded-md bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
          {p}
        </p>
      ))}
      {refs.length > 0 && (
        <p className="text-[11px] text-zinc-500">
          Refer to them in the prompt by label, e.g. “The woman in Image 1 holds the jar from Image 2, music from Audio 1”.
          Real people must come from the asset library.
        </p>
      )}
    </div>
  )
}
