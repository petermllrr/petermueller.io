interface LightboxItem {
  trigger: HTMLButtonElement;
  type: "image" | "video";
  src: string;
  alt: string;
  caption: string;
  outlined: boolean;
  inlineVideo: HTMLVideoElement | null;
}

interface PointerPoint {
  x: number;
  y: number;
}

function initLightbox(): void {
  const figures = [...document.querySelectorAll(".case-figure")];
  const dialogEl = document.getElementById("lightbox");
  if (figures.length === 0 || !(dialogEl instanceof HTMLDialogElement)) return;

  const stageEl = dialogEl.querySelector(".lightbox-stage");
  const slotEl = dialogEl.querySelector(".lightbox-media-slot");
  const captionElRaw = dialogEl.querySelector(".lightbox-caption");
  const counterElRaw = dialogEl.querySelector(".lightbox-counter");
  const closeBtnRaw = dialogEl.querySelector(".lightbox-close");
  const prevBtnRaw = dialogEl.querySelector(".lightbox-prev");
  const nextBtnRaw = dialogEl.querySelector(".lightbox-next");

  if (
    !(stageEl instanceof HTMLElement) ||
    !(slotEl instanceof HTMLElement) ||
    !(captionElRaw instanceof HTMLElement) ||
    !(counterElRaw instanceof HTMLElement) ||
    !(closeBtnRaw instanceof HTMLButtonElement) ||
    !(prevBtnRaw instanceof HTMLButtonElement) ||
    !(nextBtnRaw instanceof HTMLButtonElement)
  ) {
    return;
  }

  const dialog = dialogEl;
  const stage = stageEl;
  const slot = slotEl;
  const captionEl = captionElRaw;
  const counterEl = counterElRaw;
  const closeBtn = closeBtnRaw;
  const prevBtn = prevBtnRaw;
  const nextBtn = nextBtnRaw;

  const items: LightboxItem[] = [];
  for (const figure of figures) {
    const trigger = figure.querySelector(".case-media");
    if (!(trigger instanceof HTMLButtonElement)) continue;
    const video = figure.querySelector("video");
    const img = figure.querySelector("img");
    const caption = figure.querySelector(".case-caption")?.textContent?.trim() ?? "";
    const outlined = trigger.classList.contains("case-media-outlined");
    if (video instanceof HTMLVideoElement) {
      const source = video.querySelector("source");
      items.push({
        trigger,
        type: "video",
        src: source?.getAttribute("src") ?? video.currentSrc,
        alt: "",
        caption,
        outlined,
        inlineVideo: video,
      });
    } else if (img instanceof HTMLImageElement) {
      items.push({
        trigger,
        type: "image",
        src: img.currentSrc || img.getAttribute("src") || "",
        alt: img.getAttribute("alt") ?? "",
        caption,
        outlined,
        inlineVideo: null,
      });
    }
  }
  if (items.length === 0) return;

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;
  const DOUBLE_ZOOM = 2.5;

  let currentIndex = -1;
  let activeMedia: HTMLImageElement | HTMLVideoElement | null = null;
  let pausedInlineVideo: HTMLVideoElement | null = null;
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let baseW = 0;
  let baseH = 0;
  let baseCx = 0;
  let baseCy = 0;
  let swipePending = false;
  let backdropCandidate = false;
  let hadMultiTouch = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let lastDist = 0;
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let lastTouchTime = 0;
  const pointers = new Map<number, PointerPoint>();

  function measureBase(): void {
    if (!(activeMedia instanceof HTMLImageElement)) return;
    const prevTransform = activeMedia.style.transform;
    const prevTransition = activeMedia.style.transition;
    activeMedia.style.transition = "none";
    activeMedia.style.transform = "none";
    const rect = activeMedia.getBoundingClientRect();
    baseW = rect.width;
    baseH = rect.height;
    baseCx = rect.left + rect.width / 2;
    baseCy = rect.top + rect.height / 2;
    activeMedia.style.transform = prevTransform;
    activeMedia.style.transition = prevTransition;
  }

  function clampAxis(pan: number, halfSpan: number, center: number, viewport: number): number {
    if (halfSpan * 2 >= viewport) {
      return Math.min(halfSpan - center, Math.max(viewport - halfSpan - center, pan));
    }
    return Math.min(viewport - halfSpan - center, Math.max(halfSpan - center, pan));
  }

  function clampPan(): void {
    if (scale <= 1 || baseW === 0 || baseH === 0) {
      panX = 0;
      panY = 0;
      return;
    }
    panX = clampAxis(panX, (baseW * scale) / 2, baseCx, window.innerWidth);
    panY = clampAxis(panY, (baseH * scale) / 2, baseCy, window.innerHeight);
  }

  function applyTransform(animate = false): void {
    if (!(activeMedia instanceof HTMLImageElement)) return;
    if (scale <= 1.01) {
      scale = 1;
      panX = 0;
      panY = 0;
    }
    clampPan();
    const zoomed = scale > 1;
    dialog.toggleAttribute("data-zoomed", zoomed);
    dialog.setAttribute("closedby", zoomed ? "closerequest" : "any");
    activeMedia.style.transition = animate ? "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "";
    activeMedia.style.transform = zoomed ? `translate3d(${panX}px, ${panY}px, 0) scale(${scale})` : "";
  }

  function resetZoom(): void {
    scale = 1;
    panX = 0;
    panY = 0;
    baseW = 0;
    baseH = 0;
    baseCx = 0;
    baseCy = 0;
    dialog.removeAttribute("data-zoomed");
    dialog.removeAttribute("data-dragging");
    dialog.setAttribute("closedby", "any");
    if (activeMedia instanceof HTMLImageElement) {
      activeMedia.style.transition = "";
      activeMedia.style.transform = "";
    }
  }

  function zoomTo(nextScale: number, focalX: number, focalY: number, animate = false): void {
    if (!(activeMedia instanceof HTMLImageElement) || !activeMedia.complete || activeMedia.naturalWidth === 0) {
      return;
    }
    if (baseW === 0 || scale === 1) {
      measureBase();
    }
    if (baseW === 0 || baseH === 0) return;
    let clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextScale));
    if (clamped <= 1.01) {
      clamped = 1;
      panX = 0;
      panY = 0;
    } else {
      const ratio = clamped / scale;
      panX = focalX - baseCx - (focalX - baseCx - panX) * ratio;
      panY = focalY - baseCy - (focalY - baseCy - panY) * ratio;
    }
    scale = clamped;
    applyTransform(animate);
  }

  function cleanupActiveVideo(): void {
    if (activeMedia instanceof HTMLVideoElement) {
      activeMedia.pause();
      for (const source of activeMedia.querySelectorAll("source")) {
        source.removeAttribute("src");
      }
      activeMedia.removeAttribute("src");
      activeMedia.replaceChildren();
    }
  }

  function clearGestureState(): void {
    pointers.clear();
    swipePending = false;
    backdropCandidate = false;
    hadMultiTouch = false;
    lastDist = 0;
    dialog.removeAttribute("data-dragging");
  }

  function syncNavButtons(): void {
    const atStart = currentIndex <= 0;
    const atEnd = currentIndex >= items.length - 1;
    const active = document.activeElement;
    if (atStart && active === prevBtn && !atEnd) {
      nextBtn.focus();
    } else if (atEnd && active === nextBtn && !atStart) {
      prevBtn.focus();
    } else if ((atStart && active === prevBtn) || (atEnd && active === nextBtn)) {
      closeBtn.focus();
    }
    prevBtn.disabled = atStart;
    prevBtn.toggleAttribute("data-disabled", atStart);
    nextBtn.disabled = atEnd;
    nextBtn.toggleAttribute("data-disabled", atEnd);
  }

  function showItem(index: number): void {
    cleanupActiveVideo();
    resetZoom();
    clearGestureState();
    currentIndex = index;
    const item = items[index];
    counterEl.textContent = `${index + 1} / ${items.length}`;
    dialog.toggleAttribute("data-has-caption", Boolean(item.caption));
    captionEl.textContent = item.caption;
    captionEl.hidden = !item.caption;

    if (item.type === "video") {
      const video = document.createElement("video");
      video.className = item.outlined ? "lightbox-video lightbox-media-outlined" : "lightbox-video";
      video.controls = true;
      video.autoplay = true;
      video.loop = true;
      video.playsInline = true;
      const source = document.createElement("source");
      source.src = item.src;
      source.type = "video/mp4";
      video.appendChild(source);
      activeMedia = video;
      slot.replaceChildren(video);
      video.play().catch(() => {});
    } else {
      const img = document.createElement("img");
      img.className = item.outlined ? "lightbox-img lightbox-media-outlined" : "lightbox-img";
      img.src = item.src;
      img.alt = item.alt;
      img.draggable = false;
      activeMedia = img;
      slot.replaceChildren(img);
      if (img.complete && img.naturalWidth > 0) {
        measureBase();
      } else {
        img.addEventListener("load", measureBase, { once: true });
      }
    }
    syncNavButtons();
  }

  function openItem(index: number): void {
    const item = items[index];
    if (item.inlineVideo && !item.inlineVideo.paused) {
      pausedInlineVideo = item.inlineVideo;
      pausedInlineVideo.pause();
    }
    showItem(index);
    if (!dialog.open) {
      dialog.showModal();
    }
  }

  for (const [index, item] of items.entries()) {
    item.trigger.addEventListener("click", () => openItem(index));
  }

  if (!("commandForElement" in HTMLButtonElement.prototype)) {
    closeBtn.addEventListener("click", () => dialog.close());
  }

  prevBtn.addEventListener("click", () => {
    if (currentIndex > 0) showItem(currentIndex - 1);
  });

  nextBtn.addEventListener("click", () => {
    if (currentIndex < items.length - 1) showItem(currentIndex + 1);
  });

  dialog.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" && currentIndex > 0) {
      e.preventDefault();
      showItem(currentIndex - 1);
    } else if (e.key === "ArrowRight" && currentIndex < items.length - 1) {
      e.preventDefault();
      showItem(currentIndex + 1);
    }
  });

  dialog.addEventListener("wheel", (e: WheelEvent) => {
    if (!dialog.open) return;
    e.preventDefault();
    if (!(activeMedia instanceof HTMLImageElement) || !activeMedia.complete || activeMedia.naturalWidth === 0) {
      return;
    }
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0025));
    zoomTo(scale * factor, e.clientX, e.clientY, false);
  }, { passive: false });

  stage.addEventListener("dblclick", (e: MouseEvent) => {
    if (Date.now() - lastTouchTime < 500) return;
    if (!(activeMedia instanceof HTMLImageElement) || e.target !== activeMedia) return;
    if (scale > 1) {
      zoomTo(1, e.clientX, e.clientY, true);
    } else {
      zoomTo(DOUBLE_ZOOM, e.clientX, e.clientY, true);
    }
  });

  function isInteractiveTarget(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest(".lightbox-btn, .lightbox-video, .lightbox-caption"));
  }

  function getTwoPointerStats(): { dist: number; mx: number; my: number } {
    const [a, b] = [...pointers.values()];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
    };
  }

  stage.addEventListener("pointerdown", (e: PointerEvent) => {
    if (isInteractiveTarget(e.target)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType === "touch") lastTouchTime = Date.now();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      hadMultiTouch = true;
      swipePending = false;
      backdropCandidate = false;
      dialog.removeAttribute("data-dragging");
      if (activeMedia instanceof HTMLImageElement && activeMedia.complete && activeMedia.naturalWidth > 0) {
        if (baseW === 0 || scale === 1) measureBase();
        const stats = getTwoPointerStats();
        lastDist = stats.dist;
        lastX = stats.mx;
        lastY = stats.my;
      }
      return;
    }
    if (pointers.size === 1) {
      hadMultiTouch = false;
      startX = e.clientX;
      startY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
      backdropCandidate = scale === 1 && e.target !== activeMedia;
      swipePending = scale === 1;
    }
  });

  function handlePointerMove(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      if (!(activeMedia instanceof HTMLImageElement) || !activeMedia.complete || activeMedia.naturalWidth === 0) {
        return;
      }
      const stats = getTwoPointerStats();
      if (lastDist > 0 && stats.dist > 0) {
        const nextScale = scale * (stats.dist / lastDist);
        panX += stats.mx - lastX;
        panY += stats.my - lastY;
        zoomTo(nextScale, stats.mx, stats.my, false);
      }
      lastDist = stats.dist;
      lastX = stats.mx;
      lastY = stats.my;
      return;
    }
    if (pointers.size === 1) {
      if (scale > 1 && !hadMultiTouch) {
        const moveDist = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (moveDist > 3) {
          dialog.setAttribute("data-dragging", "");
        }
        panX += e.clientX - lastX;
        panY += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        applyTransform(false);
      } else if (Math.hypot(e.clientX - startX, e.clientY - startY) >= 6) {
        backdropCandidate = false;
      }
    }
  }

  function handlePointerEnd(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    if (e.pointerType === "touch") lastTouchTime = Date.now();
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      const [remaining] = [...pointers.values()];
      lastX = remaining.x;
      lastY = remaining.y;
      lastDist = 0;
      dialog.removeAttribute("data-dragging");
      return;
    }
    if (pointers.size > 0) return;

    const totalDx = e.clientX - startX;
    const totalDy = e.clientY - startY;
    const dist = Math.hypot(totalDx, totalDy);

    if (scale > 1) {
      dialog.removeAttribute("data-dragging");
      if (e.pointerType === "touch" && !hadMultiTouch && dist < 10 && e.target === activeMedia) {
        const now = Date.now();
        if (now - lastTapTime < 300 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 30) {
          zoomTo(1, e.clientX, e.clientY, true);
          lastTapTime = 0;
        } else {
          lastTapTime = now;
          lastTapX = e.clientX;
          lastTapY = e.clientY;
        }
      }
      hadMultiTouch = false;
      return;
    }

    if (swipePending && !hadMultiTouch && Math.abs(totalDx) > 48 && Math.abs(totalDx) > Math.abs(totalDy) * 1.5) {
      swipePending = false;
      backdropCandidate = false;
      if (totalDx < 0 && currentIndex < items.length - 1) {
        showItem(currentIndex + 1);
      } else if (totalDx > 0 && currentIndex > 0) {
        showItem(currentIndex - 1);
      }
      return;
    }

    if (e.pointerType === "touch" && !hadMultiTouch && dist < 10 && e.target === activeMedia) {
      const now = Date.now();
      if (now - lastTapTime < 300 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 30) {
        zoomTo(DOUBLE_ZOOM, e.clientX, e.clientY, true);
        lastTapTime = 0;
        swipePending = false;
        backdropCandidate = false;
        return;
      }
      lastTapTime = now;
      lastTapX = e.clientX;
      lastTapY = e.clientY;
    }

    const landedOnBackdrop = !isInteractiveTarget(e.target) && e.target !== activeMedia;
    if (backdropCandidate && landedOnBackdrop && !hadMultiTouch && dist < 6) {
      dialog.close();
    }
    swipePending = false;
    backdropCandidate = false;
    hadMultiTouch = false;
  }

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerEnd);
  window.addEventListener("pointercancel", handlePointerEnd);

  window.addEventListener("resize", () => {
    if (!dialog.open || !(activeMedia instanceof HTMLImageElement)) return;
    if (scale > 1) {
      measureBase();
      applyTransform(false);
    } else if (activeMedia.complete && activeMedia.naturalWidth > 0) {
      measureBase();
    }
  });

  dialog.addEventListener("close", () => {
    cleanupActiveVideo();
    slot.replaceChildren();
    activeMedia = null;
    resetZoom();
    clearGestureState();
    currentIndex = -1;
    if (pausedInlineVideo) {
      const v = pausedInlineVideo;
      pausedInlineVideo = null;
      v.play().catch(() => {});
    }
  });
}

initLightbox();

export {};
