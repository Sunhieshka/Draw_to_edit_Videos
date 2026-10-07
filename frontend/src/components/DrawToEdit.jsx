import { useEffect, useMemo, useRef, useState } from 'react'
import { api, PENDING, waitForAsset } from '../api'
import DrawCanvas from './DrawCanvas'
import { fileToDataUrl } from '../media'
import { ActionBadge, EDIT_ACTIONS, editActionOf, shortPrompt } from '../editActions'
import { Button, Card, ErrorText, Field, Input, Select, Textarea, Toggle } from './ui'

const THUMB_COUNT = 10
const MIN_SECONDS = 4
const MAX_SECONDS = 30

// Marks are always red so prompts can say “marked in red”.
const MARK_COLOR = '#ef4444'

const TOOLS = [
  { id: 'brush', label: 'Brush', icon: '✎' },
  { id: 'rect', label: 'Box', icon: '▭' },
  { id: 'ellipse', label: 'Circle', icon: '◯' },
  { id: 'eraser', label: 'Eraser', icon: '⌫' },
]

const ACTIONS = Object.entries(EDIT_ACTIONS).map(([id, meta]) => ({ id, ...meta }))

// Actions that accept an uploaded object image (sent as the second reference_image).
const OBJECT_UPLOAD = {
  replace: { alt: 'Replacement object', empty: 'Optional: click ＋ to upload an image of the replacement object, or just describe it in the prompt.', set: 'the highlighted object is replaced with this.' },
  add: { alt: 'Object to add', empty: 'Optional: click ＋ to upload an image of the object to add, or just describe it in the prompt.', set: 'this object is added in the highlighted area.' },
}

// Starter prompt per action. It ends where the user is expected to keep typing.
// Per-action label/placeholder for the "what to do" field.
const DETAIL_FIELDS = {
  replace: { label: 'Replace with', placeholder: 'e.g. a boy in a red hoodie' },
  modify: { label: 'Modify with', placeholder: 'e.g. make its fur golden' },
  add: { label: 'Add', placeholder: 'e.g. a small red balloon' },
}

const clean = (t) => t.trim().replace(/[.\s]+$/, '')
const withArticle = (t) => (/^(the|a|an|this|that|his|her|its|their)\b/i.test(t) ? t : `the ${t}`)

// Build the prompt from the fields. Image 1 = the marked frame, Image 2 = the optional object image.
// With an empty detail field the prompt ends where the user can keep typing.
function buildPrompt(action, colorName, hasObject, { highlighted = '', detail = '', extra = '', keep = '' } = {}) {
  const what = clean(highlighted) ? withArticle(clean(highlighted)) : 'the object'
  const where = `marked in ${colorName} in Image 1`
  const d = clean(detail)
  const object2 = hasObject ? (d ? `${d} (shown in Image 2)` : 'the object in Image 2') : d
  let core
  switch (action) {
    case 'remove':
      core = `Edit the video: remove ${what} ${where}.`
      break
    case 'replace':
      core = object2 ? `Edit the video: replace ${what} ${where} with ${object2}.` : `Edit the video: replace ${what} ${where} with `
      break
    case 'modify':
      core = d ? `Edit the video: modify ${what} ${where}: ${d}.` : `Edit the video: modify ${what} ${where}: `
      break
    case 'add': {
      const place = clean(highlighted) ? `${what} ${where}` : `the area ${where}`
      core = object2 ? `Edit the video: add ${object2} to ${place}.` : `Edit the video: on ${place}, add `
      break
    }
    default:
      core = ''
  }
  if (!core.endsWith('.')) return core // still waiting for the user to finish the sentence
  const e = clean(extra)
  if (e) core += ` ${e.charAt(0).toUpperCase()}${e.slice(1)}.`
  const k = clean(keep)
  if (k) core += ` Do not change ${withArticle(k)}.`
  return core
}

// Where the marks are, in words, e.g. a "small" object in the "bottom-left" of the frame.
function describeMarks(b) {
  if (!b) return null
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  const h = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : 'center'
  const v = cy < 1 / 3 ? 'top' : cy > 2 / 3 ? 'bottom' : 'middle'
  const region = v === 'middle' ? (h === 'center' ? 'center' : `${h} side`) : `${v}-${h}`
  const area = (b.x1 - b.x0) * (b.y1 - b.y0)
  const size = area < 0.03 ? 'small' : area < 0.15 ? 'medium-sized' : 'large'
  return { region, size }
}

const ACTION_RULES = {
  remove:
    'Remove it from every frame where it appears and fill its area with the background that would naturally be behind it.',
  replace:
    'The replacement must take the original’s exact position, size, movement and timing in every frame where it appears, for the whole video.',
  modify: 'Keep its position, size, movement and identity; change only what is described, consistently in every frame.',
  add: 'The added object stays in the marked area for the whole video, moves naturally with the scene and does not cover other characters.',
}

// Appended on submit so the editable prompt stays short.
function editSuffix(action, colorName, { highlighted = '', bounds = null, time = null } = {}) {
  const noun = clean(highlighted).replace(/^(the|a|an)\s+/i, '') || (action === 'add' ? 'area' : 'object')
  const m = describeMarks(bounds)
  const parts = []
  if (m) {
    const at = time != null ? ` at ${time.toFixed(1)}s` : ''
    const hasSize = /\b(small|tiny|little|large|big|huge|medium)\b/i.test(noun)
    const target = action === 'add' ? 'marked area' : `${hasSize ? '' : `${m.size} `}${noun} marked in ${colorName}`
    parts.push(
      `Image 1 is the reference video’s frame${at}; the ${target} is in the ${m.region} of the frame.`,
    )
  }
  parts.push(
    action === 'add'
      ? 'Do not alter any existing character or object.'
      : `Edit only that exact ${noun}; do not alter any other character or object, even ones that look similar or are nearby.`,
  )
  parts.push(ACTION_RULES[action])
  parts.push(
    'Everything else must stay exactly as in the reference video: all other characters and objects, their appearance, ' +
      'actions and motion, the background and environment, camera angle and movement, framing, lighting, colors, ' +
      'art style, timing and audio.',
  )
  parts.push(`Do not show the ${colorName} marks.`)
  return parts.join(' ')
}

function waitFor(el, event) {
  return new Promise((resolve) => el.addEventListener(event, resolve, { once: true }))
}

export default function DrawToEdit({
  video,
  models,
  edits = [],
  onCreated,
  onSelect,
  onUpdateVideo,
  assetsEnabled,
  assetGroup,
  pickedAssets = [],
}) {
  const playerRef = useRef(null)
  const canvasRef = useRef(null)
  const [duration, setDuration] = useState(null)
  const [thumbs, setThumbs] = useState([])
  const [frame, setFrame] = useState(null)
  const [hasMarks, setHasMarks] = useState(false)
  const [canUndo, setCanUndo] = useState(false)

  const [tool, setTool] = useState('brush')
  const [size, setSize] = useState(8)

  const [action, setAction] = useState('remove')
  const [objectImages, setObjectImages] = useState({})
  const [highlighted, setHighlighted] = useState('')
  const [details, setDetails] = useState({}) // per action: replace / modify / add
  const [extras, setExtras] = useState({}) // per action
  const [keep, setKeep] = useState('') // look-alikes that must not change, e.g. "the monkey"
  const [markBounds, setMarkBounds] = useState(null)
  const [promptOverride, setPromptOverride] = useState(null)
  const [model, setModel] = useState('')
  const [resolution, setResolution] = useState('720p')
  const [audio, setAudio] = useState(true)
  const [busy, setBusy] = useState(false)
  const [busyText, setBusyText] = useState('')
  const [error, setError] = useState('')
  // Route the references through the asset library (needed when real people are in the video/images).
  const [useAssets, setUseAssets] = useState(!!video?.usesAssets)

  const src = video?.localVideo ? `/media/${video.localVideo}` : null
  const color = MARK_COLOR
  const colorName = 'red'
  const upload = OBJECT_UPLOAD[action]
  const objectImage = upload ? objectImages[action] : null // { value: data URL | asset://, preview }
  const setObjectImage = (img) => setObjectImages((m) => ({ ...m, [action]: img }))
  const pickedImages = pickedAssets.filter((a) => a.type === 'Image')
  const detailField = DETAIL_FIELDS[action]
  const detail = details[action] || ''
  const extra = extras[action] || ''
  const setExtra = (v) => setExtras((m) => ({ ...m, [action]: v }))
  const templatePrompt = useMemo(
    () => buildPrompt(action, colorName, !!objectImage, { highlighted, detail, extra, keep }),
    [action, colorName, objectImage, highlighted, detail, extra, keep],
  )
  // Typing in a field rebuilds the prompt (discarding manual prompt edits).
  const fieldChange = (setter) => (e) => {
    setter(e.target.value)
    setPromptOverride(null)
  }
  const prompt = promptOverride ?? templatePrompt
  const suffix = editSuffix(action, colorName, { highlighted, bounds: markBounds, time: frame?.time })
  const fullPrompt = `${prompt.trim()} ${suffix}`
  const currentModel = models.find((m) => m.id === model)

  useEffect(() => {
    if (!model && models.length) setModel((models.find((m) => m.default) || models[0]).id)
  }, [models, model])

  useEffect(() => {
    if (currentModel && !currentModel.resolutions.includes(resolution)) setResolution(currentModel.resolutions[0])
  }, [currentModel]) // eslint-disable-line react-hooks/exhaustive-deps

  // Extract a strip of thumbnails with an offscreen <video>.
  useEffect(() => {
    if (!src) return
    let cancelled = false
    const v = document.createElement('video')
    v.src = src
    v.muted = true
    v.preload = 'auto'
    ;(async () => {
      await waitFor(v, 'loadeddata')
      if (cancelled) return
      setDuration(v.duration)
      const c = document.createElement('canvas')
      c.height = 90
      c.width = Math.round((v.videoWidth / v.videoHeight) * 90)
      const out = []
      for (let i = 0; i < THUMB_COUNT; i++) {
        const t = ((i + 0.5) * v.duration) / THUMB_COUNT
        v.currentTime = t
        await waitFor(v, 'seeked')
        if (cancelled) return
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
        out.push({ time: t, url: c.toDataURL('image/jpeg', 0.7) })
        setThumbs([...out])
      }
    })()
    return () => {
      cancelled = true
      v.removeAttribute('src')
      v.load()
    }
  }, [src])

  const captureAt = async (time) => {
    const v = playerRef.current
    v.pause()
    if (time !== undefined && Math.abs(v.currentTime - time) > 0.01) {
      v.currentTime = time
      await waitFor(v, 'seeked')
    }
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)
    setFrame({ dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height, time: v.currentTime })
    setHasMarks(false)
    setCanUndo(false)
    setMarkBounds(null)
  }

  const durationOk = duration == null || (duration >= MIN_SECONDS && duration <= MAX_SECONDS + 0.5)
  const ageHours = video ? (Date.now() - video.createdAt) / 36e5 : 0
  const keywordOk = /edit the video|\badd\b|\bdelete\b|\bremove\b|\bmodify\b|\breplace\b|\bchange\b/i.test(prompt)

  // Upload the references to the asset library and wait until they are Active.
  const toAssets = async (composite, objectValue) => {
    if (!assetGroup) throw new Error('Pick an asset group in the Asset library panel first.')
    const groupId = assetGroup.id
    const pending = []

    let videoUri = video.assetRefs?.[groupId]
    if (!videoUri) {
      setBusyText('Uploading video to the asset library…')
      const source = video.videoUrl?.startsWith('https://') ? { url: video.videoUrl } : { local_video: video.localVideo }
      const a = await api.createAsset({ group_id: groupId, asset_type: 'Video', name: `video-${video.id.slice(0, 8)}`, ...source })
      videoUri = a.uri
      pending.push(a.id)
    }

    setBusyText('Uploading marked frame…')
    const frameAsset = await api.createAsset({ group_id: groupId, asset_type: 'Image', name: 'marked-frame', data_url: composite })
    pending.push(frameAsset.id)

    let objectUri = objectValue
    if (objectValue?.startsWith('data:')) {
      setBusyText('Uploading object image…')
      const o = await api.createAsset({ group_id: groupId, asset_type: 'Image', name: `${action}-object`, data_url: objectValue })
      objectUri = o.uri
      pending.push(o.id)
    }

    let done = 0
    setBusyText(`Asset library is processing… 0/${pending.length}`)
    await Promise.all(
      pending.map((id) =>
        waitForAsset(id).then(() => setBusyText(`Asset library is processing… ${++done}/${pending.length}`)),
      ),
    )
    onUpdateVideo?.(video.id, { assetRefs: { ...video.assetRefs, [groupId]: videoUri } })
    return { videoUri, frameUri: frameAsset.uri, objectUri }
  }

  const submit = async () => {
    setBusy(true)
    setBusyText('')
    setError('')
    try {
      const composite = canvasRef.current.exportComposite()
      let refs = { videoUri: video.videoUrl, frameUri: composite, objectUri: objectImage?.value || null }
      if (useAssets) refs = await toAssets(composite, refs.objectUri)
      setBusyText('Submitting edit…')
      const { task_id } = await api.edit({
        model,
        prompt: fullPrompt,
        reference_video_url: refs.videoUri,
        reference_image: refs.frameUri,
        object_image: refs.objectUri,
        local_video: video.localVideo,
        resolution,
        generate_audio: audio,
      })
      onCreated({
        kind: 'edit',
        action,
        taskId: task_id,
        status: 'queued',
        prompt,
        model: currentModel?.name,
        usesAssets: useAssets,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
      setBusyText('')
    }
  }

  if (!video) {
    const steps = [
      { icon: '🎬', title: 'Create', text: 'Generate a video with Seedance or import one.' },
      { icon: '✎', title: 'Draw', text: 'Pick a frame and mark the object or area.' },
      { icon: '✨', title: 'Edit', text: 'Remove, replace, modify or add — then watch the result here.' },
    ]
    return (
      <Card>
        <div className="py-14 text-center">
          <h2 className="text-lg font-semibold tracking-tight">Edit videos by drawing on them</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
            The marked frame is sent as the <b className="text-zinc-200">reference image</b> and your video as the{' '}
            <b className="text-zinc-200">reference video</b>.
          </p>
          <div className="mx-auto mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
            {steps.map((st, i) => (
              <div key={st.title} className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{st.icon}</span>
                  <span className="text-xs font-medium text-zinc-500">Step {i + 1}</span>
                </div>
                <p className="mt-2 text-sm font-semibold">{st.title}</p>
                <p className="mt-0.5 text-xs text-zinc-400">{st.text}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>
    )
  }

  if (!src) return <TaskProgress video={video} />

  const editResults = edits.map((e) => <EditResult key={e.id} video={e} onSelect={onSelect} />)

  return (
    <div className="space-y-6 min-w-0">
      <Card
        step={3}
        title="Pick a frame"
        subtitle={video.prompt}
        actions={
          duration != null && (
            <span className={`text-xs ${durationOk ? 'text-zinc-400' : 'text-red-300'}`}>{duration.toFixed(1)}s</span>
          )
        }
      >
        <div className="space-y-3">
          <video ref={playerRef} src={src} controls className="w-full max-h-[360px] rounded-lg bg-black" />
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {thumbs.map((t) => (
              <button
                key={t.time}
                onClick={() => captureAt(t.time)}
                title={`${t.time.toFixed(2)}s`}
                className={`relative shrink-0 overflow-hidden rounded-md border-2 transition ${
                  frame && Math.abs(frame.time - t.time) < 0.02 ? 'border-indigo-500' : 'border-transparent hover:border-zinc-600'
                }`}
              >
                <img src={t.url} alt="" className="h-14" />
                <span className="absolute bottom-0 right-0 bg-black/70 px-1 text-[10px]">{t.time.toFixed(1)}s</span>
              </button>
            ))}
            {thumbs.length < THUMB_COUNT && <div className="h-14 w-20 shrink-0 animate-pulse rounded-md bg-zinc-800" />}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => captureAt()}>
              Use current player frame
            </Button>
            <span className="text-xs text-zinc-500">…or click a thumbnail. Scrub the player for an exact frame.</span>
          </div>
          {!durationOk && (
            <ErrorText>
              Edit mode needs a reference video of {MIN_SECONDS}–{MAX_SECONDS}s. This one is {duration.toFixed(1)}s.
            </ErrorText>
          )}
          {video.kind !== 'import' && ageHours > 23 && (
            <ErrorText>
              Seedance output URLs expire after 24 hours. This video's remote URL may no longer be reachable by the API.
            </ErrorText>
          )}
        </div>
      </Card>

      {frame && (
        <Card
          step={4}
          title="Draw over what you want to edit"
          subtitle={`Frame at ${frame.time.toFixed(2)}s · ${frame.width}×${frame.height}`}
          actions={
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => canvasRef.current.undo()} disabled={!canUndo}>
                Undo
              </Button>
              <Button variant="ghost" onClick={() => canvasRef.current.clear()} disabled={!hasMarks}>
                Clear
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex rounded-lg bg-zinc-800 p-0.5">
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTool(t.id)}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ${
                      tool === t.id ? 'bg-zinc-950 text-white' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <span>{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                <span className="h-4 w-4 rounded-full" style={{ background: MARK_COLOR }} />
                Red marker
              </span>
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                Size
                <input
                  type="range"
                  min={2}
                  max={40}
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                  className="w-28 accent-indigo-500"
                />
                <span className="w-5 text-zinc-300">{size}</span>
              </label>
            </div>
            <ul className="space-y-0.5 rounded-lg bg-amber-500/5 px-3 py-2 text-[11px] text-zinc-400 ring-1 ring-inset ring-amber-500/20">
              <li>
                <span className="text-amber-300/90">•</span> Draw a <b className="text-zinc-300">tight box or circle</b> around
                the object rather than loose strokes.
              </li>
              <li>
                <span className="text-amber-300/90">•</span> Pick a frame where the object is{' '}
                <b className="text-zinc-300">clearly apart</b> from similar characters.
              </li>
            </ul>
            <DrawCanvas
              ref={canvasRef}
              key={frame.dataUrl.length + frame.time}
              frame={frame}
              tool={tool}
              color={color}
              size={size}
              onChange={(marks, undo, bounds) => {
                setHasMarks(marks)
                setCanUndo(undo)
                setMarkBounds(bounds)
              }}
            />
          </div>
        </Card>
      )}

      {!frame && edits.length > 0 && (
        <Card title="Edited videos" subtitle="Edits made from this video">
          <div className="space-y-3">{editResults}</div>
        </Card>
      )}

      {frame && (
        <Card step={5} title="Describe the edit" subtitle="Sent to Seedance with the marked frame + the original video">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ACTIONS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    setAction(a.id)
                    setPromptOverride(null)
                  }}
                  className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition ${
                    action === a.id
                      ? `border-transparent ${a.active}`
                      : 'border-zinc-800 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <span aria-hidden className="text-base leading-none">{a.icon}</span>
                    {a.label}
                  </span>
                  <span className="text-[11px] leading-snug opacity-70">{a.hint}</span>
                </button>
              ))}
            </div>

            {upload && (
              <div className="flex items-center gap-4">
                {objectImage ? (
                  <div className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-zinc-700">
                    <img src={objectImage.preview} alt={upload.alt} className="h-full w-full object-contain" />
                    <button
                      onClick={() => setObjectImage(null)}
                      title="Remove"
                      className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-[10px] text-zinc-200 opacity-0 transition group-hover:opacity-100 hover:bg-red-600"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <label
                    title="Upload object image"
                    className="flex h-20 w-20 shrink-0 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-700 text-zinc-400 transition hover:border-indigo-400 hover:bg-indigo-500/5 hover:text-indigo-300"
                  >
                    <span className="text-3xl leading-none">＋</span>
                    <span className="mt-0.5 text-[10px]">Object</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (!file) return
                        try {
                          const dataUrl = await fileToDataUrl(file)
                          setObjectImage({ value: dataUrl, preview: dataUrl })
                        } catch {
                          setError('Could not read that image.')
                        }
                      }}
                    />
                  </label>
                )}
                <div className="min-w-0 flex-1 text-xs text-zinc-400">
                  {objectImage ? (
                    <>
                      Sent as the second reference image — {upload.set}
                      {objectImage.value.startsWith('asset://') && (
                        <span className="mt-0.5 block font-mono text-[10px] text-fuchsia-300">{objectImage.value}</span>
                      )}
                    </>
                  ) : (
                    upload.empty
                  )}
                </div>
              </div>
            )}

            {upload && !objectImage && pickedImages.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto">
                <span className="shrink-0 text-[11px] text-zinc-500">or from asset library:</span>
                {pickedImages.map((a) => (
                  <button
                    key={a.id}
                    title={a.name || a.id}
                    onClick={() => setObjectImage({ value: a.uri, preview: a.preview_url })}
                    className="h-10 w-10 shrink-0 overflow-hidden rounded-md ring-1 ring-zinc-700 hover:ring-fuchsia-500"
                  >
                    <img src={a.preview_url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={action === 'add' ? 'Where is highlighted?' : 'What is highlighted?'}>
                <Input
                  value={highlighted}
                  onChange={fieldChange(setHighlighted)}
                  placeholder={action === 'add' ? 'e.g. the bench' : 'e.g. the small white rabbit'}
                />
              </Field>
              {detailField ? (
                <Field label={detailField.label}>
                  <Input
                    value={detail}
                    onChange={fieldChange((v) => setDetails((m) => ({ ...m, [action]: v })))}
                    placeholder={detailField.placeholder}
                  />
                </Field>
              ) : (
                <Field label="Extra guidance" hint="optional">
                  <Input value={extra} onChange={fieldChange(setExtra)} placeholder="e.g. fill with the grass behind it" />
                </Field>
              )}
              <Field label="Keep unchanged" hint="look-alikes · optional">
                <Input value={keep} onChange={fieldChange(setKeep)} placeholder="e.g. the monkey and the lion" />
              </Field>
              {detailField && (
                <Field label="Extra guidance" hint="optional">
                  <Input value={extra} onChange={fieldChange(setExtra)} placeholder="e.g. the boy waves at the camera" />
                </Field>
              )}
            </div>

            <Field
              label="Prompt"
              hint={
                promptOverride != null ? (
                  <button className="text-indigo-400 hover:underline" onClick={() => setPromptOverride(null)}>
                    reset to template
                  </button>
                ) : (
                  'built from the fields · editable'
                )
              }
            >
              <Textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPromptOverride(e.target.value)}
                onFocus={(e) => {
                  const end = e.target.value.length
                  e.target.setSelectionRange(end, end)
                }}
              />
            </Field>
            <div className="-mt-2 space-y-1 text-[11px] text-zinc-500">
              <p>
                <span className="text-amber-300/90">Tip:</span> describe the target precisely in{' '}
                <b className="text-zinc-300">What is highlighted?</b> (e.g. “the small white rabbit by the elephant’s feet”) and
                list nearby characters in <b className="text-zinc-300">Keep unchanged</b> so the model doesn’t edit the wrong one.
              </p>
              <p className="text-zinc-600">Added automatically: “{suffix}”</p>
            </div>
            {!keywordOk && (
              <ErrorText>
                The prompt must include “edit the video”, “add”, “delete/remove” or “modify/replace/change”.
              </ErrorText>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Model">
                <Select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  options={models.map((m) => ({ value: m.id, label: m.name }))}
                />
              </Field>
              <Field label="Resolution">
                <Select value={resolution} onChange={(e) => setResolution(e.target.value)} options={currentModel?.resolutions || []} />
              </Field>
              <div className="flex items-end pb-2">
                <Toggle checked={audio} onChange={setAudio} label="Generate audio" />
              </div>
            </div>

            {assetsEnabled && (
              <div
                className={`rounded-xl border p-3 transition ${
                  useAssets ? 'border-fuchsia-500/40 bg-fuchsia-500/5' : 'border-zinc-800 bg-zinc-950/40'
                }`}
              >
                <Toggle checked={useAssets} onChange={setUseAssets} label="Video contains real people — use asset library" />
                <p className="mt-1.5 pl-11 text-[11px] text-zinc-500">
                  {useAssets ? (
                    assetGroup ? (
                      <>
                        The video, marked frame and object image are uploaded to{' '}
                        <span className="text-zinc-300">{assetGroup.name || assetGroup.id}</span> (
                        {assetGroup.type === 'LivenessFace' ? 'verified person' : 'virtual'}) and sent as asset:// references.
                        Change the group in the Asset library panel.
                      </>
                    ) : (
                      <span className="text-amber-300">Select an asset group in the Asset library panel first.</span>
                    )
                  ) : (
                    'Seedance blocks real human faces in plain URLs/images. Turn this on if anyone real appears.'
                  )}
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {[
                'omni_reference_task_type: edit',
                'role: reference_video',
                'role: reference_image',
                'ratio: adaptive',
                'duration: -1',
                ...(useAssets ? ['asset:// references'] : []),
              ].map(
                (p) => (
                  <span key={p} className="rounded-md bg-zinc-800 px-2 py-1 font-mono text-zinc-400">
                    {p}
                  </span>
                ),
              )}
            </div>

            <ErrorText>{error}</ErrorText>

            <Button
              variant="accent"
              className="w-full py-2.5"
              onClick={submit}
              disabled={busy || !hasMarks || !keywordOk || !durationOk || !video.videoUrl || (useAssets && !assetGroup)}
            >
              {busy ? busyText || 'Submitting edit…' : !hasMarks ? 'Draw on the frame first' : 'Edit video'}
            </Button>

            {edits.length > 0 && (
              <div className="space-y-3 border-t border-zinc-800 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Edited videos <span className="text-zinc-600">· {edits.length}</span>
                </h3>
                {editResults}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

function useElapsed(video, running) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  const elapsed = Math.max(0, Math.floor((now - video.createdAt) / 1000))
  return `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
}

function EditResult({ video, onSelect }) {
  const pending = PENDING.includes(video.status)
  const clock = useElapsed(video, pending)
  const ready = video.status === 'succeeded' && video.localVideo
  const action = editActionOf(video)
  const title = action ? `Edited video — ${EDIT_ACTIONS[action].done}` : 'Edited video'

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/70">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <ActionBadge action={action} />
          <h4 className="truncate text-sm font-semibold text-zinc-100">{title}</h4>
        </div>
        <span className="shrink-0 text-[11px] text-zinc-500">
          {video.model} · {new Date(video.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div className="space-y-2.5 p-3">
        {ready ? (
          <video src={`/media/${video.localVideo}`} controls className="w-full max-h-[380px] rounded-lg bg-black" />
        ) : pending ? (
          <div className="flex flex-col items-center gap-3 rounded-lg bg-zinc-900/80 px-3 py-10">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-fuchsia-500 border-r-indigo-500" />
            <span className="text-sm text-zinc-300">
              {action ? EDIT_ACTIONS[action].ing : 'Editing'}… <span className="font-mono text-zinc-400">{clock}</span>
            </span>
            <span className="text-[11px] text-zinc-500">status: {video.status}</span>
          </div>
        ) : (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {video.status === 'succeeded' ? 'Finished, but the video could not be downloaded.' : `Edit ${video.status}`}
            {video.error ? `: ${video.error}` : '.'}
          </p>
        )}
        <p className="line-clamp-2 text-xs text-zinc-400" title={video.prompt}>
          {shortPrompt(video.prompt)}
        </p>
        {ready && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onSelect(video.id)}>
              ✎ Edit this result
            </Button>
            {video.videoUrl && (
              <a
                href={video.videoUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-lg px-3 py-2 text-sm text-zinc-400 hover:text-white"
              >
                Open original ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TaskProgress({ video }) {
  const pending = PENDING.includes(video.status)
  const clock = useElapsed(video, pending)
  const action = video.kind === 'edit' ? editActionOf(video) : null
  const verb = video.kind === 'edit' ? (action ? EDIT_ACTIONS[action].ing : 'Editing') : 'Generating'

  return (
    <Card title={pending ? `${verb} video…` : 'Video not available'} subtitle={video.model}>
      <div className="grid place-items-center gap-5 py-16 text-center">
        {pending ? (
          <>
            <div className="relative h-16 w-16">
              <div className="absolute inset-0 rounded-full border-4 border-zinc-800" />
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-fuchsia-500 border-r-indigo-500" />
            </div>
            <div className="space-y-1">
              <p className="text-sm text-zinc-200">
                {verb} with Seedance · <span className="font-mono">{clock}</span>
              </p>
              <p className="text-xs text-zinc-500">
                Status: {video.status} · this usually takes a few minutes. You can keep working; it opens here when ready.
              </p>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-red-300">
              {video.status === 'succeeded' ? 'Finished, but the video could not be downloaded.' : `Task ${video.status}.`}
            </p>
            {video.error && <p className="max-w-lg text-xs text-zinc-400">{video.error}</p>}
          </div>
        )}
        <p className="max-w-lg rounded-lg bg-zinc-950 px-4 py-3 text-left text-xs text-zinc-400">
          {video.kind === 'edit' ? shortPrompt(video.prompt) : video.prompt}
        </p>
      </div>
    </Card>
  )
}
