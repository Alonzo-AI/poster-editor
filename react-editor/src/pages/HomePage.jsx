import { Link } from 'react-router-dom'

/**
 * Safe landing — does not replace Editor (/) or Automate (/automate).
 */
export default function HomePage({ Nav }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-4">
        <div>
          <div className="text-sm font-semibold text-paper">Poster Lab</div>
          <div className="text-[11px] text-muted">Design · Automate · Projects</div>
        </div>
        {Nav ? <Nav /> : null}
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 overflow-y-auto px-4 py-10">
        <section className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-paper">Sports poster workspace</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-dim">
            Build frozen 1080×1350 layouts in the Editor, fill copy in Automate, and open
            CSV-generated posters as editable Projects — without mixing them into your template
            library.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <Link
            to="/"
            className="rounded-2xl border border-line bg-panel p-5 shadow-sm transition hover:border-blaze/40"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">Editor</div>
            <div className="mt-2 text-lg font-semibold text-paper">Design templates</div>
            <p className="mt-2 text-[13px] text-muted">
              Place layers, fonts, and freeze layouts by college and category.
            </p>
          </Link>
          <Link
            to="/automate"
            className="rounded-2xl border border-line bg-panel p-5 shadow-sm transition hover:border-blaze/40"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">Automate</div>
            <div className="mt-2 text-lg font-semibold text-paper">Fill & export</div>
            <p className="mt-2 text-[13px] text-muted">
              Swap text and images on frozen templates, then download PNG.
            </p>
          </Link>
          <Link
            to="/projects"
            className="rounded-2xl border border-line bg-panel p-5 shadow-sm transition hover:border-blaze/40"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">Projects</div>
            <div className="mt-2 text-lg font-semibold text-paper">Bulk posters</div>
            <p className="mt-2 text-[13px] text-muted">
              CSV-generated posters stored separately, grouped by college, editable anytime.
            </p>
          </Link>
        </section>
      </main>
    </div>
  )
}
