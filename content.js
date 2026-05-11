(() => {
  "use strict";

  const OFFSETS_MPH = [0, 5, 10, 15];
  const OVERLAY_ID = "gmso-overlay";
  const OVERLAY_STATUS_ID = "gmso-status";
  const DURATION_TAG_CLASS = "gmso-adjusted-eta";
  const DURATION_HOST_CLASS = "gmso-duration-host";
  const OVERLAY_LEFT_KEY = "gmso_overlay_left";
  const OVERLAY_TOP_KEY = "gmso_overlay_top";

  const state = {
    selectedOffset: 0,
    lastUrl: window.location.href,
    observer: null,
    refreshTimer: null,
    dragCleanup: null
  };

  function parseDurationToMinutes(rawText) {
    if (!rawText) {
      return null;
    }

    const text = rawText.trim().toLowerCase().replace(/\s+/g, " ");
    const match = text.match(
      /^(?:(\d+)\s*(?:h|hr|hrs|hour|hours)\s*)?(?:(\d+)\s*(?:m|min|mins|minute|minutes))?$/
    );

    if (!match) {
      return null;
    }

    const hours = match[1] ? Number(match[1]) : 0;
    const minutes = match[2] ? Number(match[2]) : 0;

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return null;
    }

    const total = hours * 60 + minutes;
    return total > 0 ? total : null;
  }

  function formatMinutes(totalMinutes) {
    const clamped = Math.max(1, Math.round(totalMinutes));
    const hours = Math.floor(clamped / 60);
    const minutes = clamped % 60;

    if (hours === 0) {
      return `${minutes} min`;
    }

    if (minutes === 0) {
      return `${hours} hr`;
    }

    return `${hours} hr ${minutes} min`;
  }

  function computeAdjustedMinutes(originalMinutes, baseSpeedMph, offsetMph) {
    if (
      !Number.isFinite(originalMinutes) ||
      !Number.isFinite(baseSpeedMph) ||
      !Number.isFinite(offsetMph) ||
      baseSpeedMph <= 0
    ) {
      return originalMinutes;
    }

    if (offsetMph === 0) {
      return originalMinutes;
    }

    if (baseSpeedMph + offsetMph <= 1) {
      return originalMinutes;
    }

    const adjustedSpeed = baseSpeedMph + offsetMph;
    if (adjustedSpeed <= 0) {
      return originalMinutes;
    }

    const multiplier = baseSpeedMph / adjustedSpeed;
    return originalMinutes * multiplier;
  }

  function parseDistanceToMiles(rawText) {
    if (!rawText) {
      return null;
    }

    const text = rawText.toLowerCase().replace(/\s+/g, " ");
    const match = text.match(
      /(\d+(?:\.\d+)?)\s*(mi|mile|miles|km|kilometer|kilometers|kilometre|kilometres)\b/
    );
    if (!match) {
      return null;
    }

    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }

    const unit = match[2];
    const miles = unit.startsWith("k") ? value * 0.621371 : value;
    return miles;
  }

  function inferRouteBaselineSpeedMph(host, durationMinutes) {
    if (!host || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return null;
    }

    let current = host;
    for (let depth = 0; depth < 5 && current; depth += 1) {
      const text = (current.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length > 0 && text.length < 500) {
        const miles = parseDistanceToMiles(text);
        if (miles) {
          const hours = durationMinutes / 60;
          if (hours > 0) {
            const mph = miles / hours;
            if (Number.isFinite(mph) && mph >= 5 && mph <= 120) {
              return mph;
            }
          }
        }
      }
      current = current.parentElement;
    }

    return null;
  }

  function isVisibleElement(element) {
    if (!element || !element.getBoundingClientRect) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function findMapsRoot() {
    return document.querySelector("#QA0Szd") || document.body;
  }

  function collectDurationElements() {
    const root = findMapsRoot();
    const results = [];
    const seenKeys = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      if (!textNode || !textNode.nodeValue) {
        continue;
      }

      const rawText = textNode.nodeValue.trim();
      if (rawText.length === 0 || rawText.length > 24) {
        continue;
      }

      const minutes = parseDurationToMinutes(rawText);
      if (!minutes) {
        continue;
      }

      const host = textNode.parentElement;
      if (!host || host.closest(`#${OVERLAY_ID}`)) {
        continue;
      }

      if (!isVisibleElement(host)) {
        continue;
      }

      const rect = host.getBoundingClientRect();
      if (rect.left > window.innerWidth * 0.55) {
        continue;
      }

      const key = `${rawText}|${Math.round(rect.top)}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);

      results.push({
        host,
        text: rawText,
        minutes,
        inferredBaseSpeedMph: inferRouteBaselineSpeedMph(host, minutes),
        top: rect.top
      });
    }

    results.sort((a, b) => a.top - b.top);
    return results.slice(0, 6);
  }

  function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("section");
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `
      <div class="gmso-title" title="Drag to move">Speed Offset ETA</div>
      <div class="gmso-buttons"></div>
      <div class="gmso-custom-row">
        <input id="gmso-custom-offset" type="number" step="1" placeholder="Custom MPH" />
        <button type="button" id="gmso-custom-apply">Apply</button>
      </div>
      <div id="${OVERLAY_STATUS_ID}" class="gmso-status"></div>
    `;

    const buttonWrap = overlay.querySelector(".gmso-buttons");
    OFFSETS_MPH.forEach((offset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.offset = String(offset);
      button.textContent =
        offset > 0 ? `+${offset} MPH` : offset < 0 ? `${offset} MPH` : `0 MPH`;
      button.addEventListener("click", () => {
        state.selectedOffset = offset;
        refreshOffsetButtons();
        refreshAllAdjustedEtas();
      });
      buttonWrap.appendChild(button);
    });

    const customInput = overlay.querySelector("#gmso-custom-offset");
    const customApply = overlay.querySelector("#gmso-custom-apply");
    if (customInput && customApply) {
      const applyCustomOffset = () => {
        const customValue = Number(customInput.value);
        if (!Number.isFinite(customValue)) {
          setStatus("Enter a valid custom MPH offset.");
          return;
        }

        const clampedValue = Math.max(-80, Math.min(80, Math.round(customValue)));
        state.selectedOffset = clampedValue;
        customInput.value = String(clampedValue);
        refreshOffsetButtons();
        refreshAllAdjustedEtas();
      };
      customApply.addEventListener("click", applyCustomOffset);
      customInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          applyCustomOffset();
        }
      });
    }

    document.body.appendChild(overlay);
    applySavedOverlayPosition(overlay);
    attachDragHandlers(overlay);
    refreshOffsetButtons();
    return overlay;
  }

  function applySavedOverlayPosition(overlay) {
    const rawLeft = window.localStorage.getItem(OVERLAY_LEFT_KEY);
    const rawTop = window.localStorage.getItem(OVERLAY_TOP_KEY);
    const left = Number(rawLeft);
    const top = Number(rawTop);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return;
    }

    overlay.style.left = `${Math.max(8, Math.round(left))}px`;
    overlay.style.top = `${Math.max(8, Math.round(top))}px`;
    overlay.style.transform = "none";
  }

  function saveOverlayPosition(left, top) {
    window.localStorage.setItem(OVERLAY_LEFT_KEY, String(Math.round(left)));
    window.localStorage.setItem(OVERLAY_TOP_KEY, String(Math.round(top)));
  }

  function attachDragHandlers(overlay) {
    if (state.dragCleanup) {
      state.dragCleanup();
      state.dragCleanup = null;
    }

    const title = overlay.querySelector(".gmso-title");
    if (!title) {
      return;
    }

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const onPointerMove = (event) => {
      if (!dragging) {
        return;
      }

      const nextLeft = Math.max(8, Math.min(window.innerWidth - 180, event.clientX - offsetX));
      const nextTop = Math.max(8, Math.min(window.innerHeight - 40, event.clientY - offsetY));
      overlay.style.left = `${Math.round(nextLeft)}px`;
      overlay.style.top = `${Math.round(nextTop)}px`;
      overlay.style.transform = "none";
    };

    const onPointerUp = () => {
      if (!dragging) {
        return;
      }
      dragging = false;
      overlay.classList.remove("gmso-dragging");
      const left = Number.parseFloat(overlay.style.left);
      const top = Number.parseFloat(overlay.style.top);
      if (Number.isFinite(left) && Number.isFinite(top)) {
        saveOverlayPosition(left, top);
      }
    };

    const onPointerDown = (event) => {
      if (event.button !== 0) {
        return;
      }

      const rect = overlay.getBoundingClientRect();
      dragging = true;
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      overlay.classList.add("gmso-dragging");
    };

    title.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    state.dragCleanup = () => {
      title.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }

  function refreshOffsetButtons() {
    const overlay = ensureOverlay();
    const buttons = overlay.querySelectorAll("button[data-offset]");

    buttons.forEach((button) => {
      const offset = Number(button.dataset.offset);
      const isActive = offset === state.selectedOffset;
      button.classList.toggle("gmso-active", isActive);
    });
  }

  function formatOffsetLabel(offsetMph) {
    if (offsetMph > 0) {
      return `+${offsetMph} MPH`;
    }
    if (offsetMph < 0) {
      return `${offsetMph} MPH`;
    }
    return "0 MPH";
  }

  function setStatus(text) {
    const overlay = ensureOverlay();
    const status = overlay.querySelector(`#${OVERLAY_STATUS_ID}`);
    if (status) {
      status.textContent = text;
    }
  }

  function clearStaleAdjustedEtas(activeHosts) {
    const tags = document.querySelectorAll(`.${DURATION_TAG_CLASS}`);
    tags.forEach((tag) => {
      const parent = tag.parentElement;
      if (!parent || !activeHosts.has(parent)) {
        tag.remove();
        if (parent) {
          parent.classList.remove(DURATION_HOST_CLASS);
        }
      }
    });
  }

  function renderAdjustedEta(entry) {
    let tag = entry.host.querySelector(`.${DURATION_TAG_CLASS}`);
    if (!tag) {
      tag = document.createElement("span");
      tag.className = DURATION_TAG_CLASS;
      entry.host.classList.add(DURATION_HOST_CLASS);
      entry.host.appendChild(tag);
    }

    if (!Number.isFinite(entry.inferredBaseSpeedMph)) {
      tag.classList.add("gmso-unavailable");
      tag.textContent = "Adj n/a (missing route distance)";
      return;
    }

    tag.classList.remove("gmso-unavailable");
    const adjustedMinutes = computeAdjustedMinutes(
      entry.minutes,
      entry.inferredBaseSpeedMph,
      state.selectedOffset
    );
    const savedMinutes = Math.max(0, Math.round(entry.minutes - adjustedMinutes));

    if (state.selectedOffset === 0) {
      tag.textContent = `Adj ${formatMinutes(adjustedMinutes)} (no change)`;
      return;
    }

    if (state.selectedOffset < 0) {
      const addedMinutes = Math.max(0, Math.round(adjustedMinutes - entry.minutes));
      tag.textContent = `Adj ${formatMinutes(adjustedMinutes)} (+${addedMinutes} min)`;
      return;
    }

    tag.textContent = `Adj ${formatMinutes(adjustedMinutes)} (-${savedMinutes} min)`;
  }

  function refreshAllAdjustedEtas() {
    const entries = collectDurationElements();
    const activeHosts = new Set(entries.map((entry) => entry.host));
    clearStaleAdjustedEtas(activeHosts);

    if (entries.length === 0) {
      setStatus("No route times found yet.");
      return;
    }

    entries.forEach(renderAdjustedEta);

    const derivedCount = entries.filter((entry) =>
      Number.isFinite(entry.inferredBaseSpeedMph)
    ).length;
    const unavailableCount = entries.length - derivedCount;
    setStatus(
      `Offset ${formatOffsetLabel(state.selectedOffset)}. Google-derived speed active for ${derivedCount}/${entries.length} routes.${unavailableCount > 0 ? ` ${unavailableCount} missing distance.` : ""}`
    );
  }

  function scheduleRefresh() {
    if (state.refreshTimer) {
      window.clearTimeout(state.refreshTimer);
    }

    state.refreshTimer = window.setTimeout(() => {
      state.refreshTimer = null;
      refreshAllAdjustedEtas();
    }, 250);
  }

  function startObservers() {
    if (state.observer) {
      state.observer.disconnect();
    }

    state.observer = new MutationObserver(() => {
      scheduleRefresh();
    });

    state.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    window.setInterval(() => {
      if (window.location.href !== state.lastUrl) {
        state.lastUrl = window.location.href;
        scheduleRefresh();
      }
    }, 1000);
  }

  function main() {
    ensureOverlay();
    startObservers();
    refreshAllAdjustedEtas();
  }

  main();
})();
