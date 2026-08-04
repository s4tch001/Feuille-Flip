import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" href="/" aria-label="Feuille Flip home">
      <span className="brand-mark" aria-hidden="true"><i /><i /><b>F</b></span>
      {!compact && <span>Feuille<span>Flip</span></span>}
    </Link>
  );
}

