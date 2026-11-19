export function Flash({ notice, error }: { notice?: string; error?: string }) {
  if (error) return <div className="flash err" role="alert">{error}</div>;
  if (notice) return <div className="flash ok" role="status">{notice}</div>;
  return null;
}
