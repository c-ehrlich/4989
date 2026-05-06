import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage
});

function HomePage() {
  return (
    <main className="app-shell">
      <div className="placeholder-panel">
        <p className="eyebrow">4989 American Life</p>
        <h1>Search app scaffold</h1>
        <p>TanStack Start is running. Corpus search comes next.</p>
      </div>
    </main>
  );
}
