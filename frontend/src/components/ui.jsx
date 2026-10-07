export function Card({ step, title, subtitle, actions, children, className = '' }) {
  return (
    <section
      className={`rounded-2xl border border-white/[0.07] bg-zinc-900/70 shadow-xl shadow-black/20 backdrop-blur ${className}`}
    >
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {step && (
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-xs font-bold text-white shadow shadow-indigo-500/30">
                {step}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="text-sm font-semibold tracking-tight text-zinc-100">{title}</h2>
              {subtitle && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{subtitle}</p>}
            </div>
          </div>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

export function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between text-xs font-medium text-zinc-300">
        {label}
        {hint && <span className="font-normal text-zinc-500">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-lg border border-zinc-700/80 bg-zinc-950/80 px-3 py-2 placeholder:text-zinc-600 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50'

export function Input(props) {
  return <input {...props} className={`${inputCls} ${props.className || ''}`} />
}

export function Textarea(props) {
  return <textarea {...props} className={`${inputCls} resize-y ${props.className || ''}`} />
}

export function Select({ options, ...props }) {
  return (
    <select {...props} className={inputCls}>
      {options.map((o) => {
        const value = typeof o === 'string' ? o : o.value
        const label = typeof o === 'string' ? o : o.label
        return (
          <option key={value} value={value}>
            {label}
          </option>
        )
      })}
    </select>
  )
}

export function Button({ variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20',
    accent: 'bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-500 hover:to-indigo-500 text-white shadow-lg shadow-fuchsia-600/20',
    ghost: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200',
    danger: 'bg-red-600/15 hover:bg-red-600/25 text-red-300',
  }
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]} ${className}`}
    />
  )
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-sm text-zinc-300"
    >
      <span className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-indigo-600' : 'bg-zinc-700'}`}>
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-4.5' : 'left-0.5'}`}
        />
      </span>
      {label}
    </button>
  )
}

export function StatusBadge({ status }) {
  const map = {
    succeeded: 'bg-emerald-500/15 text-emerald-300',
    failed: 'bg-red-500/15 text-red-300',
    cancelled: 'bg-zinc-700 text-zinc-300',
    expired: 'bg-zinc-700 text-zinc-300',
  }
  const cls = map[status] || 'bg-sky-500/15 text-sky-300'
  const pending = !map[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {pending && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {status}
    </span>
  )
}

export function ErrorText({ children }) {
  if (!children) return null
  return <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{children}</p>
}
