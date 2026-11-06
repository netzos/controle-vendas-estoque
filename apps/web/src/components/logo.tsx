// Logo do netzsales: o "n" branco num quadrado grafite arredondado, no estilo da marca NetzCode
// (preto e branco, pontas retas e o quadradinho no alto, a mesma peça da logo NetzCode).
// Os ícones da tela de início (app/apple-icon.png, public/icons/*) e o app/icon.svg usam o mesmo desenho.
export function LogoMark({ size = 48 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="#14161a" />
      <path d="M19.5 24V48M19.5 35a10.5 10.5 0 0 1 21 0V48" fill="none" stroke="#fff" strokeWidth="7" />
      <rect x="40" y="16" width="8" height="8" fill="#fff" />
    </svg>
  );
}
