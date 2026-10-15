import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

// Icône de l'application (installation sur l'écran d'accueil) : flocon blanc sur fond bleu, avec marge pour le masquage « maskable »
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', background: '#0369a1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="300" height="300" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m10 20-1.25-2.5L6 18M10 4 8.75 6.5 6 6M10.585 15H10M2 12h6.5L10 9M20 14.5 18 12l2-2.5M22 12h-6.5L14 15M4 10l2 2-2 2.5M14 4l1.25 2.5L18 6M14 20l1.25-2.5L18 18M12 2v20" />
        </svg>
      </div>
    ),
    size,
  );
}
