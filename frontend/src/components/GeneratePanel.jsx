import { useEffect, useState } from 'react'
import { api } from '../api'
import { Button, Card, ErrorText, Field, Input, Select, Textarea, Toggle } from './ui'
import ReferenceMedia, { collectReferences, referenceProblems } from './ReferenceMedia'

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']

export default function GeneratePanel({ models, onCreated, pickedAssets = [], onUnpick, uploadEnabled }) {
  const [tab, setTab] = useState('generate')
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [resolution, setResolution] = useState('720p')
  const [ratio, setRatio] = useState('16:9')
  const [duration, setDuration] = useState(5)
  const [audio, setAudio] = useState(true)
  const [importUrl, setImportUrl] = useState('')
  const [uploads, setUploads] = useState([])
  const uploadsBusy = uploads.some((u) => u.uploading)
  const uploadsFailed = uploads.some((u) => u.error)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!model && models.length) setModel((models.find((m) => m.default) || models[0]).id)
  }, [models, model])

  const current = models.find((m) => m.id === model)
  const refs = collectReferences(uploads, pickedAssets)
  const refProblems = referenceProblems(refs, current)

  useEffect(() => {
    if (!current) return
    if (!current.resolutions.includes(resolution)) setResolution(current.resolutions.includes('720p') ? '720p' : current.resolutions[0])
    if (duration > current.max_duration) setDuration(current.max_duration)
  }, [current]) // eslint-disable-line react-hooks/exhaustive-deps

  const submitGenerate = async () => {
    setBusy(true)
    setError('')
    try {
      const { task_id } = await api.generate({
        model,
        prompt,
        image_url: imageUrl || null,
        resolution,
        ratio,
        duration: Number(duration),
        generate_audio: audio,
        // Same order as the labels shown in the UI (uploads first, then assets).
        references: refs.map((r) => ({ url: r.url, type: r.type, duration: r.duration || null })),
      })
      onCreated({
        kind: 'generate',
        taskId: task_id,
        status: 'queued',
        prompt,
        model: current?.name,
        usesAssets: pickedAssets.length > 0,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const submitImport = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api.importVideo(importUrl)
      onCreated({
        kind: 'import',
        status: 'succeeded',
        prompt: importUrl,
        videoUrl: r.video_url,
        localVideo: r.local_video,
        duration: r.duration,
      })
      setImportUrl('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      step={1}
      title="Create a video"
      subtitle="Generate with Seedance, or import a public video URL"
      actions={
        <div className="flex rounded-lg bg-zinc-800 p-0.5 text-xs">
          {['generate', 'import'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-2.5 py-1 capitalize ${tab === t ? 'bg-zinc-950 text-white' : 'text-zinc-400'}`}
            >
              {t}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'generate' ? (
        <div className="space-y-3">
          <Field label="Model">
            <Select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              options={models.map((m) => ({ value: m.id, label: m.name }))}
            />
          </Field>
          <Field label="Prompt">
            <Textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A girl holding a fox, she opens her eyes and looks gently at the camera…"
            />
          </Field>
          <ReferenceMedia
            uploads={uploads}
            setUploads={setUploads}
            pickedAssets={pickedAssets}
            onUnpick={onUnpick}
            uploadEnabled={uploadEnabled}
            model={current}
          />
          <Field label="First-frame image URL" hint="optional">
            <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Resolution">
              <Select value={resolution} onChange={(e) => setResolution(e.target.value)} options={current?.resolutions || []} />
            </Field>
            <Field label="Ratio">
              <Select value={ratio} onChange={(e) => setRatio(e.target.value)} options={RATIOS} />
            </Field>
          </div>
          <Field label="Duration" hint={`${duration}s · max ${current?.max_duration ?? 15}s`}>
            <input
              type="range"
              min={4}
              max={current?.max_duration ?? 15}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </Field>
          <Toggle checked={audio} onChange={setAudio} label="Generate audio" />
          <ErrorText>{error}</ErrorText>
          <Button
            className="w-full"
            onClick={submitGenerate}
            disabled={busy || uploadsBusy || uploadsFailed || refProblems.length > 0 || !prompt.trim() || !model}
          >
            {busy ? 'Submitting…' : uploadsBusy ? 'Uploading references…' : uploadsFailed ? 'Remove failed uploads' : refProblems.length ? 'Reference limits exceeded' : 'Generate video'}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Public video URL" hint="4–30s, mp4">
            <Input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://…/video.mp4" />
          </Field>
          <p className="text-xs text-zinc-500">
            The URL is sent to Seedance as the reference video, so it must be reachable from the internet.
          </p>
          <ErrorText>{error}</ErrorText>
          <Button className="w-full" onClick={submitImport} disabled={busy || !importUrl.trim()}>
            {busy ? 'Importing…' : 'Import video'}
          </Button>
        </div>
      )}
    </Card>
  )
}
