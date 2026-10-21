// Aparece na hora do clique enquanto a página carrega.
export default function Loading() {
  return (
    <div className="page-loading" aria-busy="true" aria-label="Carregando">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" />
      <div className="card">
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
      </div>
    </div>
  );
}
