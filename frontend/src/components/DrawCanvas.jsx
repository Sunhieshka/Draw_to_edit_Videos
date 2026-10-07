import { useImperativeHandle, useRef } from 'react'

const MAX_UNDO = 30

/**
 * Overlay canvas on top of a captured frame. Coordinates are kept in the frame's native
 * resolution so the exported reference image matches the video.
 */
export default function DrawCanvas({ ref, frame, tool, color, size, onChange }) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const drawing = useRef(null)
  const history = useRef([])

  const ctx = () => canvasRef.current.getContext('2d')

  const toCanvas = (e) => {
    const c = canvasRef.current
    const r = c.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) * c.width) / r.width,
      y: ((e.clientY - r.top) * c.height) / r.height,
      scale: c.width / r.width,
    }
  }

  // Report whether anything is drawn (checked on a downscaled copy to stay cheap).
  // Also reports the marks' bounding box (0–1 of width/height) so prompts can say where the target is.
  const notify = () => {
    const W = 160
    const H = 160
    const probe = document.createElement('canvas')
    probe.width = W
    probe.height = H
    const p = probe.getContext('2d')
    p.drawImage(canvasRef.current, 0, 0, W, H)
    const { data } = p.getImageData(0, 0, W, H)
    let x0 = W
    let y0 = H
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    const hasMarks = x1 >= 0
    const bounds = hasMarks ? { x0: x0 / W, y0: y0 / H, x1: (x1 + 1) / W, y1: (y1 + 1) / H } : null
    onChange?.(hasMarks, history.current.length > 0, bounds)
  }

  useImperativeHandle(ref, () => ({
    undo() {
      const prev = history.current.pop()
      if (prev) ctx().putImageData(prev, 0, 0)
      notify()
    },
    clear() {
      const c = canvasRef.current
      history.current.push(ctx().getImageData(0, 0, c.width, c.height))
      ctx().clearRect(0, 0, c.width, c.height)
      notify()
    },
    /** Frame + drawings flattened into a JPEG data URL (used as role=reference_image). */
    exportComposite(quality = 0.92) {
      const c = canvasRef.current
      const out = document.createElement('canvas')
      out.width = c.width
      out.height = c.height
      const o = out.getContext('2d')
      o.drawImage(imgRef.current, 0, 0, c.width, c.height)
      o.drawImage(c, 0, 0)
      return out.toDataURL('image/jpeg', quality)
    },
  }))

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const c = canvasRef.current
    const snapshot = ctx().getImageData(0, 0, c.width, c.height)
    history.current.push(snapshot)
    if (history.current.length > MAX_UNDO) history.current.shift()
    const p = toCanvas(e)
    drawing.current = { start: p, last: p, snapshot }
    if (tool === 'brush' || tool === 'eraser') stroke(p, p)
  }

  const stroke = (from, to) => {
    const g = ctx()
    g.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    g.strokeStyle = color
    g.lineWidth = size * to.scale
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(from.x, from.y)
    g.lineTo(to.x + 0.01, to.y)
    g.stroke()
  }

  const onPointerMove = (e) => {
    const d = drawing.current
    if (!d) return
    const p = toCanvas(e)
    if (tool === 'brush' || tool === 'eraser') {
      stroke(d.last, p)
      d.last = p
      return
    }
    // Shapes: restore snapshot and redraw the preview.
    const g = ctx()
    g.putImageData(d.snapshot, 0, 0)
    g.globalCompositeOperation = 'source-over'
    g.strokeStyle = color
    g.lineWidth = size * p.scale
    const { x, y } = d.start
    g.beginPath()
    if (tool === 'rect') {
      g.rect(x, y, p.x - x, p.y - y)
    } else if (tool === 'ellipse') {
      g.ellipse((x + p.x) / 2, (y + p.y) / 2, Math.abs(p.x - x) / 2, Math.abs(p.y - y) / 2, 0, 0, Math.PI * 2)
    }
    g.stroke()
  }

  const onPointerUp = () => {
    if (!drawing.current) return
    drawing.current = null
    notify()
  }

  return (
    <div className="relative mx-auto w-full overflow-hidden rounded-lg bg-black" style={{ maxWidth: '100%' }}>
      <img ref={imgRef} src={frame.dataUrl} alt="Selected frame" className="block w-full select-none" draggable={false} />
      <canvas
        ref={canvasRef}
        width={frame.width}
        height={frame.height}
        className={`absolute inset-0 h-full w-full touch-none ${tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  )
}
