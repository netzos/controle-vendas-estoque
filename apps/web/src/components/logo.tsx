import { BRAND_NAME } from "@/lib/brand";

export function LogoMark({ size = 48 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden="true">
      {BRAND_NAME[0]}
      <i />
    </span>
  );
}
