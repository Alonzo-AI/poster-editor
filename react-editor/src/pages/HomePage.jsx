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
          <div className="text-[11px] text-muted">Design · Automate · Projects · Saves · QA</div>
        </div>
        {Nav ? <Nav /> : null}
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 overflow-y-auto px-4 py-10">
        <section className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-paper">Sports poster workspace</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-dim">
            Build frozen layouts in the Editor, fill copy in Automate, open CSV Projects, or revisit
            posters you saved from Automate — each area stays in its own bucket.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          <Link
            to="/automate-saves"
            className="rounded-2xl border border-line bg-panel p-5 shadow-sm transition hover:border-blaze/40"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
              Automate saves
            </div>
            <div className="mt-2 text-lg font-semibold text-paper">Saved from Automate</div>
            <p className="mt-2 text-[13px] text-muted">
              Posters you Save in Automate — separate from templates and CSV Projects.
            </p>
          </Link>
          <Link
            to="/qa-graphics"
            className="rounded-2xl border border-line bg-panel p-5 shadow-sm transition hover:border-blaze/40"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
              QA Graphics Testing
            </div>
            <div className="mt-2 text-lg font-semibold text-paper">Excel-like sheets</div>
            <p className="mt-2 text-[13px] text-muted">
              Named folders, each with its own spreadsheet — saves to Postgres when connected.
            </p>
          </Link>
          <Link
            to="/auto-stories"
            className="rounded-2xl border border-line bg-panel p-5 shadow-sm transition hover:border-blaze/40"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
              Auto select stories
            </div>
            <div className="mt-2 text-lg font-semibold text-paper">Stories → QA sheet</div>
            <p className="mt-2 text-[13px] text-muted">
              Run LLM extract on combined stories and fill a new QA Graphics folder automatically.
            </p>
          </Link>
        </section>
      </main>
    </div>
  )
}
