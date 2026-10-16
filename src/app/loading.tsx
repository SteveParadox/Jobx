export default function Loading() {
  return (
    <div className="container page-container" role="status" aria-label="Loading page">
      <div className="skeleton" />
      <div className="skeleton" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
