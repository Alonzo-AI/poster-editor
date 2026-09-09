export default function StageHost({ iframeRef, src, onLoad, className = '' }) {
  return (
    <div className={`relative h-full min-h-0 w-full flex-1 overflow-hidden ${className}`}>
      <iframe
        ref={iframeRef}
        title="Poster stage"
        src={src}
        onLoad={onLoad}
        className="absolute inset-0 h-full w-full border-0 bg-[#f4f7f8]"
      />
    </div>
  )
}
