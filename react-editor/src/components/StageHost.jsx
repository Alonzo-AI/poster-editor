export default function StageHost({ iframeRef, src, onLoad, className = '' }) {
  return (
    <div className={`relative min-h-0 flex-1 overflow-hidden ${className}`}>
      <iframe
        ref={iframeRef}
        title="Poster stage"
        src={src}
        onLoad={onLoad}
        className="absolute inset-0 h-full w-full border-0 bg-inset"
      />
    </div>
  )
}
