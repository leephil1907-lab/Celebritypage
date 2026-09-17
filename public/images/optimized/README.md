# Optimised renditions (optional)

`server/media.js` looks here for pre-cut derivatives of a file in `public/image-search/` and adds them
to `<img srcset>` automatically:

    <source-basename>-320.webp   (320 w)
    <source-basename>-640.webp   (640 w)
    <source-basename>-960.webp   (960 w)
    <source-basename>-1280.webp  (1280 w)
    <source-basename>-og.webp    (1200x630 social card)

so `takuya-kimura-live-tour-checkpoint-2026--3.jpg` needs `takuya-kimura-live-tour-checkpoint-2026--3-1280.webp`, and so on.

Rules the loader enforces, because the static-era archive shipped `-1280.webp` files that were
byte-for-byte copies of the source GIF:

* the file must really be WebP (`RIFF….WEBP`);
* its decoded width must match the width in its name (±6%);
* anything else is ignored — the page then serves the original file with no `srcset`, which is
  slower but never wrong.

Generate the set with any WebP encoder, e.g. `npx sharp-cli`, and the site picks it up within 30
seconds (no restart, no rebuild). The `<link rel=preload imagesrcset>` in `<head>` follows the same
list, so the hero is fetched exactly once.
