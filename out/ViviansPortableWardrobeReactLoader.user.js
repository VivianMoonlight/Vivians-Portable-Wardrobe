// ==UserScript==
// @name         Vivians Portable Wardrobe (React Preview Loader)
// @namespace    https://www.bondageprojects.com/
// @version      0.10.1-react.1
// @description  Preview loader for Vivian's Portable Wardrobe React branch
// @author       VivianMoonlight
// @match        https://bondageprojects.elementfx.com/*
// @match        https://www.bondageprojects.elementfx.com/*
// @match        https://bondage-europe.com/*
// @match        https://www.bondage-europe.com/*
// @match        https://bondage-asia.com/*
// @match        https://www.bondage-asia.com/*
// @match        http://localhost:*/*
// @run-at       document-end
// @grant        none
// @updateURL    https://cdn.jsdelivr.net/gh/vivianmoonlight/Vivians-Portable-Wardrobe@wardrobe-react/ViviansPortableWardrobeReactLoader.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/vivianmoonlight/Vivians-Portable-Wardrobe@wardrobe-react/ViviansPortableWardrobeReactLoader.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BRANCH = 'wardrobe-react';
  const SCRIPT_URL =
    `https://cdn.jsdelivr.net/gh/vivianmoonlight/Vivians-Portable-Wardrobe@${BRANCH}/out/Vivians-Portable-Wardrobe.user.js`;

  setTimeout(() => {
    const script = document.createElement('script');
    script.type = 'module';
    script.crossOrigin = 'anonymous';
    script.src = `${SCRIPT_URL}?t=${Date.now()}`;
    script.onload = () => script.remove();
    script.onerror = () => {
      console.error('[VPW] Failed to load React preview bundle:', script.src);
      script.remove();
    };
    document.head.appendChild(script);
  }, 1000);
})();
