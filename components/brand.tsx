import Image from "next/image";
import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" href="/" aria-label="Feuille Flip home">
      <span className="brand-mark" aria-hidden="true">
        <Image src="/brand/feuille-flip-mark.svg" alt="" width={35} height={35} priority />
      </span>
      {!compact && <span>Feuille<span>Flip</span></span>}
    </Link>
  );
}
