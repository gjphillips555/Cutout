# Cutout

Drop an image or PDF. Cut the backdrop. Keep white lettering and enclosed fills. Edit PDFs without uploading them.

## Cut

Studio cut floods from the edges, then fills holes so logos like **LOOTERS** stay solid white. Neural cut (optional) loads a subject model in the browser.

## PDF studio

Built from the Grok PDF skill recipes, running entirely client-side:

- **PDF.js** renders pages onto the canvas so you can preview and cut a page.
- **pdf-lib** rebuilds the document: rotate, delete, duplicate, merge another PDF, keep a page range, stamp a watermark, optionally password-protect, and bake a cut PNG back onto its page.
- Extract selectable text from every page.

Open `index.html` or the Vercel URL. Nothing leaves the browser.
