// ==UserScript==
// @name         Vivians-Portable-Wardrobe
// @namespace    https://www.bondageprojects.com/
// @version      0.1
// @description  Loader for Portable Wardrobe
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
// ==/UserScript==

(function() {
    'use strict';
    setTimeout(function(){
        let n = document.createElement("script");
        n.type = "module";
        n.crossOrigin = "anonymous";
        n.src = "https://vivianmoonlight.github.io/Vivians-Portable-Wardrobe/PortableWardrobe/init.js?" + Date.now();
        n.onload = () => n.remove();
        document.head.appendChild(n);
    }, 1000);
})();
