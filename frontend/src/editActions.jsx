// Shared metadata for the four draw-to-edit actions.
export const EDIT_ACTIONS = {
  remove: {
    label: 'Remove',
    done: 'Removed',
    ing: 'Removing',
    icon: '⌫',
    hint: 'Erase the marked object and fill in the background',
    badge: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
    active: 'bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/50',
  },
  replace: {
    label: 'Replace',
    done: 'Replaced',
    ing: 'Replacing',
    icon: '⇄',
    hint: 'Swap the marked object for something else',
    badge: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    active: 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/50',
  },
  modify: {
    label: 'Modify',
    done: 'Modified',
    ing: 'Modifying',
    icon: '✦',
    hint: 'Change how the marked object looks',
    badge: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
    active: 'bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/50',
  },
  add: {
    label: 'Add',
    done: 'Added',
    ing: 'Adding',
    icon: '＋',
    hint: 'Place something new in the marked area',
    badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    active: 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/50',
  },
}

/** The action an edit video was made with (inferred from the prompt for older entries). */
export function editActionOf(video) {
  if (video.action && EDIT_ACTIONS[video.action]) return video.action
  const p = (video.prompt || '').split(/edit the video:/i).pop().toLowerCase()
  if (/\breplace\b/.test(p)) return 'replace'
  if (/\b(remove|delete)\b/.test(p)) return 'remove'
  if (/\badd\b/.test(p)) return 'add'
  if (/\b(modify|change)\b/.test(p)) return 'modify'
  return null
}

// The user-facing part of an edit prompt (drops the boilerplate about the marks).
export function shortPrompt(prompt = '') {
  const i = prompt.search(/edit the video:/i)
  return i >= 0 ? prompt.slice(i + 'edit the video:'.length).trim() : prompt
}

export function ActionBadge({ action, className = '' }) {
  const meta = EDIT_ACTIONS[action]
  if (!meta) return null
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${meta.badge} ${className}`}
    >
      <span aria-hidden>{meta.icon}</span>
      {meta.done}
    </span>
  )
}
