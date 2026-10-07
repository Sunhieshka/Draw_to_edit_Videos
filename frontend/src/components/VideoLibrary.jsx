import { Card, StatusBadge } from './ui'
import { ActionBadge, EDIT_ACTIONS, editActionOf, shortPrompt } from '../editActions'

function titleOf(v) {
  if (v.kind === 'edit') {
    const action = editActionOf(v)
    return action ? `Edited — ${EDIT_ACTIONS[action].done}` : 'Edited video'
  }
  return v.kind === 'import' ? 'Imported video' : 'Generated video'
}

export default function VideoLibrary({ videos, selectedId, onSelect, onRemove }) {
  return (
    <Card
      step={2}
      title="Library"
      subtitle="Pick a video to view progress or draw on it"
      actions={videos.length > 0 && <span className="text-xs text-zinc-500">{videos.length}</span>}
    >
      {videos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
          Your generated and edited videos will appear here.
        </div>
      ) : (
        <ul className="-mr-2 max-h-[560px] space-y-2 overflow-y-auto pr-2">
          {videos.map((v) => {
            const ready = v.status === 'succeeded' && v.localVideo
            const active = v.id === selectedId
            const action = v.kind === 'edit' ? editActionOf(v) : null
            return (
              <li
                key={v.id}
                className={`group rounded-xl border p-2 transition ${
                  active
                    ? 'border-indigo-500/70 bg-indigo-500/10 shadow-lg shadow-indigo-500/10'
                    : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700 hover:bg-zinc-900'
                }`}
              >
                <button onClick={() => onSelect(v.id)} className="flex w-full gap-3 text-left">
                  <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
                    {ready ? (
                      <video src={`/media/${v.localVideo}#t=0.5`} muted preload="metadata" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-indigo-400" />
                      </div>
                    )}
                    {v.duration ? (
                      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-zinc-200">
                        {Number(v.duration).toFixed(1)}s
                      </span>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold text-zinc-100">{titleOf(v)}</span>
                      {v.status !== 'succeeded' && <StatusBadge status={v.status} />}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">
                      {v.kind === 'edit' ? shortPrompt(v.prompt) : v.prompt}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5">
                      {action && <ActionBadge action={action} />}
                      {v.model && <span className="text-[11px] text-zinc-500">{v.model}</span>}
                    </div>
                  </div>
                </button>
                {v.error && <p className="mt-1 text-[11px] text-red-300">{v.error}</p>}
                <div className="mt-1 flex justify-end gap-3 text-[11px] opacity-0 transition group-hover:opacity-100">
                  {v.videoUrl && (
                    <a href={v.videoUrl} target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-white">
                      Open ↗
                    </a>
                  )}
                  <button onClick={() => onRemove(v.id)} className="text-zinc-500 hover:text-red-300">
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
