// Logo do netzsales: "n" branco com ponto azul num quadrado preto arredondado.
export function LogoMark({ size = 48 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="18" fill="#0f1115" />
      <path d="M21 20V45M21 31a10.5 10.5 0 0 1 21 0V45" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="49.5" cy="44" r="4" fill="#6f9dff" />
    </svg>
  );
}
