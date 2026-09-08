import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs";
import { PDFDocument, degrees, rgb, StandardFonts } from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs";

const $ = (id) => document.getElementById(id);
const fileInput = $("file");
const drop = $("drop");
const view = $("view");
const stage = $("stage");
const statusEl = $("status");
const bar = $("bar");
const runBtn = $("run");
const dlBtn = $("download");
const dlPdfBtn = $("downloadPdf");

let source = null;
let result = null;
let mode = "auto";
let neural = null;
let workspace = "cut";
let pdfBytes = null;
let pdfJsDoc = null;
let pageIndex = 0;
let pageRotations = [];
let pageCutPngs = {};

function setStatus(msg, err = false) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (err ? " err" : "");
}

$("tabCut").onclick = () => setWorkspace("cut");
$("tabPdf").onclick = () => setWorkspace("pdf");
function setWorkspace(next) {
  workspace = next;
  $("tabCut").classList.toggle("on", next === "cut");
  $("tabPdf").classList.toggle("on", next === "pdf");
  $("cutPanel").classList.toggle("hidden", next !== "cut");
  $("pdfPanel").classList.toggle("hidden", next !== "pdf");
}

$("pick").onclick = () => fileInput.click();
fileInput.onchange = () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); };
["dragenter", "dragover"].forEach((ev) => {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
});
["dragleave", "drop"].forEach((ev) => {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
});
drop.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});

$("modeAuto").onclick = () => setMode("auto");
$("modeAi").onclick = () => setMode("ai");
function setMode(next) {
  mode = next;
  $("modeAuto").classList.toggle("on", next === "auto");
  $("modeAi").classList.toggle("on", next === "ai");
  $("modeHint").textContent =
    next === "auto"
      ? "Floods from the edges, then fills enclosed holes so white lettering is not punched out."
      : "Downloads a subject model in-browser, then hole-fills so interiors stay solid.";
}

function setStage(kind) {
  stage.classList.remove("light", "black");
  if (kind === "light") stage.classList.add("light");
  if (kind === "dark") stage.classList.add("black");
  $("bgCheck").classList.toggle("on", kind === "check");
  $("bgDark").classList.toggle("on", kind === "dark");
  $("bgLight").classList.toggle("on", kind === "light");
}
$("bgCheck").onclick = () => setStage("check");
$("bgDark").onclick = () => setStage("dark");
$("bgLight").onclick = () => setStage("light");

async function loadFile(file) {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) {
    setWorkspace("pdf");
    await loadPdf(await file.arrayBuffer());
    return;
  }
  if (!file.type.startsWith("image/")) {
    setStatus("That file is not an image or PDF.", true);
    return;
  }
  pdfBytes = null;
  pdfJsDoc = null;
  pageCutPngs = {};
  const img = new Image();
  img.onload = () => {
    source = img;
    result = null;
    drop.hidden = true;
    view.hidden = false;
    drawImage(img);
    runBtn.disabled = false;
    dlBtn.disabled = true;
    dlPdfBtn.disabled = false;
    setStatus(img.naturalWidth + " x " + img.naturalHeight + " ready to cut.");
  };
  img.onerror = () => setStatus("Could not read that image.", true);
  img.src = URL.createObjectURL(file);
}

async function loadPdf(buf) {
  pdfBytes = new Uint8Array(buf);
  pageCutPngs = {};
  result = null;
  try {
    pdfJsDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
  } catch (err) {
    setStatus((err && err.message) || "Could not open PDF.", true);
    return;
  }
  pageRotations = new Array(pdfJsDoc.numPages).fill(0);
  pageIndex = 0;
  drop.hidden = true;
  view.hidden = false;
  runBtn.disabled = false;
  dlBtn.disabled = true;
  dlPdfBtn.disabled = false;
  await renderPdfPage();
  await renderThumbs();
  setStatus(pdfJsDoc.numPages + " page PDF loaded.");
}

async function renderPdfPage() {
  if (!pdfJsDoc) return;
  const page = await pdfJsDoc.getPage(pageIndex + 1);
  const scale = Number($("pdfScale").value) || 1.5;
  const rot = pageRotations[pageIndex] || 0;
  const viewport = page.getViewport({ scale, rotation: rot });
  view.width = Math.floor(viewport.width);
  view.height = Math.floor(viewport.height);
  const ctx = view.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, view.width, view.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  source = await canvasToImage(view);
  result = pageCutPngs[pageIndex] ? view : null;
  if (pageCutPngs[pageIndex]) {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = pageCutPngs[pageIndex]; });
    view.width = img.naturalWidth;
    view.height = img.naturalHeight;
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.drawImage(img, 0, 0);
    result = view;
    dlBtn.disabled = false;
  } else {
    dlBtn.disabled = true;
  }
  $("pageLabel").textContent = "Page " + (pageIndex + 1) + " / " + pdfJsDoc.numPages;
}

async function renderThumbs() {
  const wrap = $("thumbs");
  wrap.innerHTML = "";
  if (!pdfJsDoc) return;
  for (let i = 0; i < pdfJsDoc.numPages; i++) {
    const page = await pdfJsDoc.getPage(i + 1);
    const vp = page.getViewport({ scale: 0.18, rotation: pageRotations[i] || 0 });
    const c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    if (i === pageIndex) c.classList.add("on");
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    c.onclick = async () => { pageIndex = i; await renderPdfPage(); await renderThumbs(); };
    wrap.appendChild(c);
  }
}

function canvasToImage(canvas) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = canvas.toDataURL("image/png");
  });
}

$("prevPage").onclick = async () => {
  if (!pdfJsDoc || pageIndex <= 0) return;
  pageIndex--;
  await renderPdfPage();
  await renderThumbs();
};
$("nextPage").onclick = async () => {
  if (!pdfJsDoc || pageIndex >= pdfJsDoc.numPages - 1) return;
  pageIndex++;
  await renderPdfPage();
  await renderThumbs();
};
$("pdfScale").onchange = () => renderPdfPage();
$("rotL").onclick = async () => {
  if (!pdfJsDoc) return;
  pageRotations[pageIndex] = ((pageRotations[pageIndex] || 0) - 90 + 360) % 360;
  await renderPdfPage();
  await renderThumbs();
};
$("rotR").onclick = async () => {
  if (!pdfJsDoc) return;
  pageRotations[pageIndex] = ((pageRotations[pageIndex] || 0) + 90) % 360;
  await renderPdfPage();
  await renderThumbs();
};

$("delPage").onclick = async () => {
  if (!pdfBytes || !pdfJsDoc || pdfJsDoc.numPages < 2) {
    setStatus("Need at least two pages to delete one.", true);
    return;
  }
  const doc = await PDFDocument.load(pdfBytes);
  doc.removePage(pageIndex);
  pdfBytes = await doc.save();
  pageIndex = Math.min(pageIndex, doc.getPageCount() - 1);
  await reloadFromBytes();
};

$("dupPage").onclick = async () => {
  if (!pdfBytes) return;
  const doc = await PDFDocument.load(pdfBytes);
  const [copied] = await doc.copyPages(doc, [pageIndex]);
  doc.insertPage(pageIndex + 1, copied);
  pdfBytes = await doc.save();
  pageIndex += 1;
  await reloadFromBytes();
};

async function reloadFromBytes() {
  pdfJsDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
  pageRotations = new Array(pdfJsDoc.numPages).fill(0);
  pageCutPngs = {};
  await renderPdfPage();
  await renderThumbs();
  setStatus(pdfJsDoc.numPages + " pages.");
}

$("mergePdf").onclick = () => $("mergeFile").click();
$("mergeFile").onchange = async () => {
  const f = $("mergeFile").files[0];
  if (!f) return;
  const extra = await PDFDocument.load(await f.arrayBuffer());
  const base = pdfBytes ? await PDFDocument.load(pdfBytes) : await PDFDocument.create();
  const copied = await base.copyPages(extra, extra.getPageIndices());
  copied.forEach((p) => base.addPage(p));
  pdfBytes = await base.save();
  await reloadFromBytes();
  setStatus("Merged " + extra.getPageCount() + " pages.");
};

$("extractText").onclick = async () => {
  if (!pdfJsDoc) { setStatus("Open a PDF first.", true); return; }
  const chunks = [];
  for (let n = 1; n <= pdfJsDoc.numPages; n++) {
    const content = await (await pdfJsDoc.getPage(n)).getTextContent();
    chunks.push("--- page " + n + " ---\n" + content.items.map((it) => it.str).join(" "));
  }
  const box = $("textOut");
  box.classList.remove("hidden");
  box.textContent = chunks.join("\n\n");
};

function parseRange(spec, max) {
  if (!spec || !spec.trim()) return [...Array(max).keys()];
  const out = new Set();
  for (const part of spec.split(",")) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
      if (i >= 1 && i <= max) out.add(i - 1);
    }
  }
  return [...out].sort((x, y) => x - y);
}

function drawImage(img) {
  const max = 1600;
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (Math.max(w, h) > max) {
    const s = max / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  view.width = w;
  view.height = h;
  const ctx = view.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
}

function sampleCorners(data, w, h) {
  const pts = [[0,0],[w-1,0],[0,h-1],[w-1,h-1],[w>>1,0],[0,h>>1],[w-1,h>>1],[w>>1,h-1]];
  let r=0,g=0,b=0;
  for (const [x,y] of pts) {
    const i = (y * w + x) * 4;
    r += data[i]; g += data[i+1]; b += data[i+2];
  }
  const n = pts.length;
  return [r/n, g/n, b/n];
}

function dist2(r,g,b, cr,cg,cb) {
  const dr=r-cr, dg=g-cg, db=b-cb;
  return dr*dr + dg*dg + db*db;
}

function floodBg(data, w, h, tol) {
  const bg = sampleCorners(data, w, h);
  const thresh = (tol / 100) * 255;
  const t2 = thresh * thresh * 3;
  const seen = new Uint8Array(w * h);
  const q = [];
  function push(x,y) {
    const id = y*w+x;
    if (seen[id]) return;
    const i = id*4;
    if (dist2(data[i], data[i+1], data[i+2], bg[0], bg[1], bg[2]) > t2) return;
    seen[id] = 1;
    q.push(id);
  }
  for (let x=0;x<w;x++) { push(x,0); push(x,h-1); }
  for (let y=0;y<h;y++) { push(0,y); push(w-1,y); }
  while (q.length) {
    const id = q.pop();
    const x = id % w, y = (id / w) | 0;
    if (x>0) push(x-1,y);
    if (x<w-1) push(x+1,y);
    if (y>0) push(x,y-1);
    if (y<h-1) push(x,y+1);
  }
  return seen;
}

function fillHoles(bgMask) {
  const keep = new Uint8Array(bgMask.length);
  for (let i=0;i<keep.length;i++) keep[i] = bgMask[i] ? 0 : 1;
  return keep;
}

function protectLights(data, keep) {
  for (let i=0;i<keep.length;i++) {
    if (keep[i]) continue;
    const p = i*4;
    const r=data[p], g=data[p+1], b=data[p+2];
    const lum = 0.2126*r + 0.7152*g + 0.0722*b;
    if (lum > 242 && Math.abs(r-g)<14 && Math.abs(r-b)<14) keep[i] = 1;
  }
}

function featherMask(keep, w, h, radius) {
  if (radius <= 0) {
    const a = new Float32Array(keep.length);
    for (let i=0;i<keep.length;i++) a[i] = keep[i] ? 1 : 0;
    return a;
  }
  const src = new Float32Array(keep.length);
  for (let i=0;i<keep.length;i++) src[i] = keep[i] ? 1 : 0;
  const tmp = new Float32Array(keep.length);
  const r = radius;
  for (let y=0;y<h;y++) {
    for (let x=0;x<w;x++) {
      let s=0, c=0;
      for (let k=-r;k<=r;k++) {
        const xx = Math.min(w-1, Math.max(0, x+k));
        s += src[y*w+xx]; c++;
      }
      tmp[y*w+x] = s/c;
    }
  }
  const out = new Float32Array(keep.length);
  for (let y=0;y<h;y++) {
    for (let x=0;x<w;x++) {
      let s=0, c=0;
      for (let k=-r;k<=r;k++) {
        const yy = Math.min(h-1, Math.max(0, y+k));
        s += tmp[yy*w+x]; c++;
      }
      out[y*w+x] = s/c;
    }
  }
  return out;
}

function applyCut(imgData, alpha, defringe) {
  const d = imgData.data;
  const w = imgData.width, h = imgData.height;
  const B = sampleCorners(d, w, h);
  for (let i=0;i<alpha.length;i++) {
    const a = alpha[i];
    const p = i*4;
    if (a <= 0.001) { d[p+3] = 0; continue; }
    if (defringe && a < 0.999) {
      const ia = 1 - a;
      d[p]   = Math.max(0, Math.min(255, (d[p]   - ia*B[0]) / a));
      d[p+1] = Math.max(0, Math.min(255, (d[p+1] - ia*B[1]) / a));
      d[p+2] = Math.max(0, Math.min(255, (d[p+2] - ia*B[2]) / a));
    }
    d[p+3] = Math.round(a * 255);
  }
}

async function loadNeural() {
  if (neural) return neural;
  setStatus("Loading subject model. First time can take a minute.");
  const mod = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2");
  setStatus("Building the cutter.");
  neural = await mod.pipeline("image-segmentation", "Xenova/modnet", { progress_callback: (x) => {
    if (x.status === "progress" && x.total) {
      bar.hidden = false;
      bar.value = Math.round((x.loaded / x.total) * 100);
      setStatus("Downloading model " + bar.value + "%");
    }
  }});
  return neural;
}

async function neuralKeep(canvas) {
  const pipe = await loadNeural();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  const out = await pipe(blob);
  const mask = out[0].mask;
  const keep = new Uint8Array(mask.width * mask.height);
  const buf = mask.data;
  for (let i=0;i<keep.length;i++) keep[i] = buf[i] > 0.5 ? 1 : 0;
  if (mask.width !== canvas.width || mask.height !== canvas.height) {
    const c = document.createElement("canvas");
    c.width = mask.width; c.height = mask.height;
    const ctx = c.getContext("2d");
    const imgd = ctx.createImageData(mask.width, mask.height);
    for (let i=0;i<keep.length;i++) {
      const v = keep[i]*255;
      imgd.data[i*4] = v; imgd.data[i*4+1]=v; imgd.data[i*4+2]=v; imgd.data[i*4+3]=255;
    }
    ctx.putImageData(imgd,0,0);
    const c2 = document.createElement("canvas");
    c2.width = canvas.width; c2.height = canvas.height;
    c2.getContext("2d").drawImage(c, 0, 0, canvas.width, canvas.height);
    const scaled = c2.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data;
    const k2 = new Uint8Array(canvas.width * canvas.height);
    for (let i=0;i<k2.length;i++) k2[i] = scaled[i*4] > 127 ? 1 : 0;
    return k2;
  }
  return keep;
}

$("run").onclick = async () => {
  if (!source) return;
  runBtn.disabled = true;
  try {
    drawImage(source);
    const ctx = view.getContext("2d");
    const imgd = ctx.getImageData(0, 0, view.width, view.height);
    const w = imgd.width, h = imgd.height;
    let keep;
    if (mode === "ai") keep = await neuralKeep(view);
    else keep = fillHoles(floodBg(imgd.data, w, h, Number($("tol").value)));
    if ($("holes").checked && mode === "ai") {
      const edge = new Uint8Array(keep.length);
      const q = [];
      const push = (x,y) => {
        const id=y*w+x;
        if (keep[id] || edge[id]) return;
        edge[id]=1; q.push(id);
      };
      for (let x=0;x<w;x++) { push(x,0); push(x,h-1); }
      for (let y=0;y<h;y++) { push(0,y); push(w-1,y); }
      while (q.length) {
        const id=q.pop();
        const x=id%w, y=(id/w)|0;
        if (x>0) push(x-1,y);
        if (x<w-1) push(x+1,y);
        if (y>0) push(x,y-1);
        if (y<h-1) push(x,y+1);
      }
      for (let i=0;i<keep.length;i++) if (!keep[i] && !edge[i]) keep[i]=1;
    }
    if ($("protect").checked) protectLights(imgd.data, keep);
    const alpha = featherMask(keep, w, h, Number($("feather").value));
    applyCut(imgd, alpha, $("defringe").checked);
    ctx.putImageData(imgd, 0, 0);
    result = view;
    dlBtn.disabled = false;
    dlPdfBtn.disabled = false;
    bar.hidden = true;
    if (pdfJsDoc) pageCutPngs[pageIndex] = view.toDataURL("image/png");
    setStatus("Cut complete. Download PNG or bake into a PDF.");
  } catch (err) {
    console.error(err);
    bar.hidden = true;
    setStatus((err && err.message) || "Cut failed. Try Studio cut.", true);
  } finally {
    runBtn.disabled = false;
  }
};

$("download").onclick = () => {
  if (!result) return;
  result.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cutout.png";
    a.click();
  }, "image/png");
};

$("downloadPdf").onclick = async () => {
  try {
    setStatus("Building PDF");
    const out = pdfBytes ? await PDFDocument.load(pdfBytes) : await PDFDocument.create();
    if (pdfBytes) {
      const keep = parseRange($("keepRange").value, out.getPageCount());
      if (keep.length && keep.length !== out.getPageCount()) {
        const fresh = await PDFDocument.create();
        const pages = await fresh.copyPages(out, keep);
        pages.forEach((p) => fresh.addPage(p));
        await stampAndSave(await PDFDocument.load(await fresh.save()));
        return;
      }
      const pages = out.getPages();
      for (let i = 0; i < pages.length; i++) {
        const rot = pageRotations[i] || 0;
        if (rot) pages[i].setRotation(degrees((pages[i].getRotation().angle + rot) % 360));
        if (pageCutPngs[i]) {
          const png = await out.embedPng(await (await fetch(pageCutPngs[i])).arrayBuffer());
          const { width, height } = pages[i].getSize();
          pages[i].drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
          pages[i].drawImage(png, { x: 0, y: 0, width, height });
        }
      }
      await stampAndSave(out);
      return;
    }
    const pngBytes = await new Promise((res) => view.toBlob((b) => b.arrayBuffer().then(res), "image/png"));
    const png = await out.embedPng(pngBytes);
    const page = out.addPage([png.width, png.height]);
    page.drawImage(png, { x: 0, y: 0, width: png.width, height: png.height });
    await stampAndSave(out);
  } catch (err) {
    console.error(err);
    setStatus((err && err.message) || "PDF export failed.", true);
  }
};

async function stampAndSave(doc) {
  const mark = $("wmText").value.trim();
  if (mark) {
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      page.drawText(mark, {
        x: width * 0.18,
        y: height * 0.45,
        size: Math.max(18, Math.min(width, height) / 10),
        font,
        color: rgb(0.75, 0.15, 0.2),
        rotate: degrees(28),
        opacity: 0.28,
      });
    }
  }
  const pass = $("pdfPass").value;
  const bytes = pass
    ? await doc.save({ userPassword: pass, ownerPassword: pass })
    : await doc.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "cutout.pdf";
  a.click();
  setStatus("PDF saved" + (pass ? " (password protected)." : "."));
}

$("reset").onclick = () => {
  source = null; result = null;
  pdfBytes = null; pdfJsDoc = null; pageCutPngs = {};
  view.hidden = true;
  drop.hidden = false;
  runBtn.disabled = true;
  dlBtn.disabled = true;
  dlPdfBtn.disabled = true;
  $("thumbs").innerHTML = "";
  $("pageLabel").textContent = "No PDF";
  $("textOut").classList.add("hidden");
  setStatus("");
};
