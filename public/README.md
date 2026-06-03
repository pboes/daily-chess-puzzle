# Static assets

Drop your app logo here as **`logo.png`** (square, ideally 512×512 PNG with a
transparent or solid background). It's served at `/logo.png` and used by:

- the in-app header badge (`components/header.tsx`),
- the browser tab favicon + Apple touch icon (`app/layout.tsx` metadata),
- the Open Graph / social preview image,
- the garage submission (link to `https://<your-app>.vercel.app/logo.png`).

Anything in this `public/` folder is served from the site root and bundled into
every Vercel deploy automatically.
