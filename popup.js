(() => {
  "use strict";

  const STORAGE_KEY = "gmso_base_speed_mph";
  const DEFAULT_BASE_SPEED_MPH = 55;
  const baseSpeedInput = document.getElementById("baseSpeed");
  const savedLabel = document.getElementById("saved");

  function setSavedText(text) {
    if (savedLabel) {
      savedLabel.textContent = text;
    }
  }

  function sanitizeSpeed(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    const rounded = Math.round(parsed);
    if (rounded < 10 || rounded > 120) {
      return null;
    }

    return rounded;
  }

  function loadValue() {
    chrome.storage.sync.get([STORAGE_KEY], (items) => {
      const stored = sanitizeSpeed(items?.[STORAGE_KEY]);
      const value = stored ?? DEFAULT_BASE_SPEED_MPH;
      baseSpeedInput.value = String(value);
    });
  }

  function saveValue() {
    const value = sanitizeSpeed(baseSpeedInput.value);
    if (value === null) {
      setSavedText("Enter 10-120 MPH.");
      return;
    }

    chrome.storage.sync.set({ [STORAGE_KEY]: value }, () => {
      setSavedText("Saved.");
      window.setTimeout(() => {
        setSavedText("");
      }, 1000);
    });
  }

  baseSpeedInput.addEventListener("change", saveValue);
  baseSpeedInput.addEventListener("blur", saveValue);

  loadValue();
})();
