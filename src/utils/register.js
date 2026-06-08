import { hostWindow } from './host-window.js';

var bcModSdk = (function () {
    "use strict";
    const SDK_VERSION = "1.2.0";

    function throwError(msg) {
        alert("Mod ERROR:\n" + msg);
        const err = new Error(msg);
        console.error(err);
        throw err;
    }

    const encoder = new TextEncoder();

    function isObject(val) {
        return !!val && typeof val === "object" && !Array.isArray(val);
    }

    function unique(arr) {
        const set = new Set();
        return arr.filter((x) => !set.has(x) && set.add(x));
    }

    const functionMap = new Map();
    const warned = new Set();

    function warnOnce(msg) {
        if (!warned.has(msg)) {
            warned.add(msg);
            console.warn(msg);
        }
    }

    function computeHooks(fnObj) {
        const hooks = [];
        const patches = new Map();
        const patchSources = new Set();

        for (const mod of mods.values()) {
            const patching = mod.patching.get(fnObj.name);
            if (patching) {
                hooks.push(...patching.hooks);
                for (const [pattern, patch] of patching.patches.entries()) {
                    if (patches.has(pattern) && patches.get(pattern) !== patch) {
                        warnOnce(
                            `ModSDK: Mod '${mod.name}' is patching function ${fnObj.name} with same pattern that is already applied by different mod, but with different pattern:\nPattern:\n${pattern}\nPatch1:\n${patches.get(pattern) || ""}\nPatch2:\n${patch}`
                        );
                    }
                    patches.set(pattern, patch);
                    patchSources.add(mod.name);
                }
            }
        }

        hooks.sort((a, b) => b.priority - a.priority);

        function applyPatches(fn, patchMap) {
            if (patchMap.size === 0) return fn;
            let src = fn.toString().replaceAll("\r\n", "\n");
            for (const [pattern, patch] of patchMap.entries()) {
                if (!src.includes(pattern)) {
                    warnOnce(`ModSDK: Patching ${fn.name}: Patch ${pattern} not applied`);
                }
                src = src.replaceAll(pattern, patch);
            }
            return (0, eval)(`(${src})`);
        }

        const finalFn = applyPatches(fnObj.original, patches);

        let chain = function (args) {
            const enter = errorReporterHooks?.hookChainExit?.(fnObj.name, patchSources);
            const result = finalFn.apply(this, args);
            if (enter) enter();
            return result;
        };

        for (let i = hooks.length - 1; i >= 0; i--) {
            const hook = hooks[i];
            const next = chain;
            chain = function (args) {
                const enter = errorReporterHooks?.hookEnter?.(fnObj.name, hook.mod);
                const res = hook.hook.apply(this, [
                    args,
                    (nextArgs) => {
                        if (arguments.length !== 1 || !Array.isArray(nextArgs))
                            throw new Error(
                                `Mod ${hook.mod} failed to call next hook: Expected args to be array, got ${typeof nextArgs}`
                            );
                        return next.call(this, nextArgs);
                    },
                ]);
                if (enter) enter();
                return res;
            };
        }

        return {
            hooks,
            patches,
            patchesSources: patchSources,
            enter: chain,
            final: finalFn,
        };
    }

    function getOrCreateFunction(fnName, forceRecompute = false) {
        let fnObj = functionMap.get(fnName);
        if (fnObj) {
            if (forceRecompute) fnObj.precomputed = computeHooks(fnObj);
        } else {
            let ctx = window;
            const parts = fnName.split(".");
            for (let i = 0; i < parts.length - 1; i++) {
                ctx = ctx[parts[i]];
                if (!isObject(ctx))
                    throw new Error(
                        `ModSDK: Function ${fnName} to be patched not found; ${parts
                            .slice(0, i + 1)
                            .join(".")} is not object`
                    );
            }
            const orig = ctx[parts[parts.length - 1]];
            if (typeof orig !== "function")
                throw new Error(`ModSDK: Function ${fnName} to be patched not found`);
            const hash = (function (src) {
                let crc = -1;
                for (const byte of encoder.encode(src)) {
                    let code = (crc ^ byte) & 0xff;
                    for (let i = 0; i < 8; i++)
                        code = code & 1 ? -306674912 ^ (code >>> 1) : code >>> 1;
                    crc = (crc >>> 8) ^ code;
                }
                return ((-1 ^ crc) >>> 0).toString(16).padStart(8, "0").toUpperCase();
            })(orig.toString().replaceAll("\r\n", "\n"));
            const fnData = { name: fnName, original: orig, originalHash: hash };
            fnObj = Object.assign({}, fnData, {
                precomputed: computeHooks(fnData),
                router: () => { },
                context: ctx,
                contextProperty: parts[parts.length - 1],
            });
            fnObj.router = function (...args) {
                return fnObj.precomputed.enter.apply(this, [args]);
            };
            functionMap.set(fnName, fnObj);
            ctx[fnObj.contextProperty] = fnObj.router;
        }
        return fnObj;
    }

    function recomputeAll() {
        for (const fnObj of functionMap.values()) fnObj.precomputed = computeHooks(fnObj);
    }

    function getPatchingInfo() {
        const info = new Map();
        for (const [name, fnObj] of functionMap) {
            info.set(name, {
                name,
                original: fnObj.original,
                originalHash: fnObj.originalHash,
                sdkEntrypoint: fnObj.router,
                currentEntrypoint: fnObj.context[fnObj.contextProperty],
                hookedByMods: unique(fnObj.precomputed.hooks.map((h) => h.mod)),
                patchedByMods: Array.from(fnObj.precomputed.patchesSources),
            });
        }
        return info;
    }

    const mods = new Map();

    function unloadMod(mod) {
        if (mods.get(mod.name) !== mod)
            throwError(`Failed to unload mod '${mod.name}': Not registered`);
        mods.delete(mod.name);
        mod.loaded = false;
        recomputeAll();
    }

    function registerMod(info, options) {
        if (!info || typeof info !== "object")
            throwError("Failed to register mod: Expected info object, got " + typeof info);
        if (!info.name || typeof info.name !== "string")
            throwError(
                "Failed to register mod: Expected name to be non-empty string, got " +
                typeof info.name
            );
        let modLabel = `'${info.name}'`;
        if (!info.fullName || typeof info.fullName !== "string")
            throwError(
                `Failed to register mod ${modLabel}: Expected fullName to be non-empty string, got ${typeof info.fullName}`
            );
        modLabel = `'${info.fullName} (${info.name})'`;
        if (typeof info.version !== "string")
            throwError(
                `Failed to register mod ${modLabel}: Expected version to be string, got ${typeof info.version}`
            );
        if (!info.repository) info.repository = undefined;
        if (
            info.repository !== undefined &&
            typeof info.repository !== "string"
        )
            throwError(
                `Failed to register mod ${modLabel}: Expected repository to be undefined or string, got ${typeof info.version}`
            );
        if (options == null) options = {};
        if (!options || typeof options !== "object")
            throwError(
                `Failed to register mod ${modLabel}: Expected options to be undefined or object, got ${typeof options}`
            );
        const allowReplace = options.allowReplace === true;
        const existing = mods.get(info.name);
        if (existing) {
            if (!existing.allowReplace || !allowReplace)
                throwError(
                    `Refusing to load mod ${modLabel}: it is already loaded and doesn't allow being replaced.\nWas the mod loaded multiple times?`
                );
            unloadMod(existing);
        }

        function getPatching(fnObj) {
            let patching = modApi.patching.get(fnObj.name);
            if (!patching) {
                patching = { hooks: [], patches: new Map() };
                modApi.patching.set(fnObj.name, patching);
            }
            return patching;
        }

        function wrapApi(name, fn) {
            return (...args) => {
                const enter = errorReporterHooks?.apiEndpointEnter?.(name, modApi.name);
                if (!modApi.loaded)
                    throwError(
                        `Mod ${modLabel} attempted to call SDK function after being unloaded`
                    );
                const res = fn(...args);
                if (enter) enter();
                return res;
            };
        }

        const api = {
            unload: wrapApi("unload", () => unloadMod(modApi)),
            hookFunction: wrapApi("hookFunction", (fnName, priority, hookFn) => {
                if (!fnName || typeof fnName !== "string")
                    throwError(
                        `Mod ${modLabel} failed to patch a function: Expected function name string, got ${typeof fnName}`
                    );
                const fnObj = getOrCreateFunction(fnName);
                const patching = getPatching(fnObj);
                if (typeof priority !== "number")
                    throwError(
                        `Mod ${modLabel} failed to hook function '${fnName}': Expected priority number, got ${typeof priority}`
                    );
                if (typeof hookFn !== "function")
                    throwError(
                        `Mod ${modLabel} failed to hook function '${fnName}': Expected hook function, got ${typeof hookFn}`
                    );
                const hook = { mod: modApi.name, priority, hook: hookFn };
                patching.hooks.push(hook);
                recomputeAll();
                return () => {
                    const idx = patching.hooks.indexOf(hook);
                    if (idx >= 0) {
                        patching.hooks.splice(idx, 1);
                        recomputeAll();
                    }
                };
            }),
            patchFunction: wrapApi("patchFunction", (fnName, patches) => {
                if (!fnName || typeof fnName !== "string")
                    throwError(
                        `Mod ${modLabel} failed to patch a function: Expected function name string, got ${typeof fnName}`
                    );
                const fnObj = getOrCreateFunction(fnName);
                const patching = getPatching(fnObj);
                if (!isObject(patches))
                    throwError(
                        `Mod ${modLabel} failed to patch function '${fnName}': Expected patches object, got ${typeof patches}`
                    );
                for (const [pattern, patch] of Object.entries(patches)) {
                    if (typeof patch === "string") patching.patches.set(pattern, patch);
                    else if (patch === null) patching.patches.delete(pattern);
                    else
                        throwError(
                            `Mod ${modLabel} failed to patch function '${fnName}': Invalid format of patch '${pattern}'`
                        );
                }
                recomputeAll();
            }),
            removePatches: wrapApi("removePatches", (fnName) => {
                if (!fnName || typeof fnName !== "string")
                    throwError(
                        `Mod ${modLabel} failed to patch a function: Expected function name string, got ${typeof fnName}`
                    );
                const fnObj = getOrCreateFunction(fnName);
                getPatching(fnObj).patches.clear();
                recomputeAll();
            }),
            callOriginal: wrapApi("callOriginal", (fnName, args, ctx) => {
                if (!fnName || typeof fnName !== "string")
                    throwError(
                        `Mod ${modLabel} failed to call a function: Expected function name string, got ${typeof fnName}`
                    );
                const fnObj = getOrCreateFunction(fnName);
                if (!Array.isArray(args))
                    throwError(
                        `Mod ${modLabel} failed to call a function: Expected args array, got ${typeof args}`
                    );
                return fnObj.original.apply(ctx != null ? ctx : globalThis, args);
            }),
            getOriginalHash: wrapApi("getOriginalHash", (fnName) => {
                if (!fnName || typeof fnName !== "string")
                    throwError(
                        `Mod ${modLabel} failed to get hash: Expected function name string, got ${typeof fnName}`
                    );
                return getOrCreateFunction(fnName).originalHash;
            }),
        };

        const modApi = {
            name: info.name,
            fullName: info.fullName,
            version: info.version,
            repository: info.repository,
            allowReplace,
            api,
            loaded: true,
            patching: new Map(),
        };

        mods.set(info.name, modApi);
        return Object.freeze(api);
    }

    function getModsInfo() {
        const arr = [];
        for (const mod of mods.values()) {
            arr.push({
                name: mod.name,
                fullName: mod.fullName,
                version: mod.version,
                repository: mod.repository,
            });
        }
        return arr;
    }

    let errorReporterHooks;
    const sdk = (typeof window.bcModSdk === "undefined"
        ? (window.bcModSdk = (function () {
            const sdkObj = {
                version: SDK_VERSION,
                apiVersion: 1,
                registerMod,
                getModsInfo,
                getPatchingInfo,
                errorReporterHooks: Object.seal({
                    apiEndpointEnter: null,
                    hookEnter: null,
                    hookChainExit: null,
                }),
            };
            errorReporterHooks = sdkObj.errorReporterHooks;
            return Object.freeze(sdkObj);
        })())
        : (function () {
            if (!isObject(window.bcModSdk))
                throwError("Failed to init Mod SDK: Name already in use");
            if (window.bcModSdk.apiVersion !== 1)
                throwError(
                    `Failed to init Mod SDK: Different version already loaded ('1.2.0' vs '${window.bcModSdk.version}')`
                );
            if (window.bcModSdk.version !== SDK_VERSION)
                alert(
                    `Mod SDK warning: Loading different but compatible versions ('1.2.0' vs '${window.bcModSdk.version}')\nOne of mods you are using is using an old version of SDK. It will work for now but please inform author to update`
                );
            return window.bcModSdk;
        })());

    if (typeof exports !== "undefined") {
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.default = sdk;
    }

    return sdk;
})();


export function registerModWithSdk(VERSION_NUMBER) {
    // IMPORTANT: prefer the game's shared Mod SDK living on the PAGE window
    // (unsafeWindow). The SDK embedded above resolves target functions on the
    // userscript-sandbox `window` (see `let ctx = window`), which cannot see
    // page globals like `CharacterRefresh` — that mismatch causes
    // "Function CharacterRefresh to be patched not found".
    const sdk =
        (typeof hostWindow !== 'undefined' && hostWindow.bcModSdk) ||
        (typeof window !== 'undefined' && window.bcModSdk) ||
        null;

    if (!sdk?.registerMod) {
        console.error('VPW: Mod SDK not available');
        return;
    }

    const modApi = sdk.registerMod(
        {
            name: "Portable Wardrobe (VPW)",
            fullName: "Vivians Portable Wardrobe (VPW)",
            version: VERSION_NUMBER,
            repository: "https://VivianMoonlight.github.io/Vivians-Portable-Wardrobe",
        },
        {
            allowReplace: true
        }
    );

    return modApi;
}


export function hookHistory(modApi, HistoryRecord, getOutfitData) {
    modApi.hookFunction("CharacterRefresh", 10, (args, next) => {
        const [C] = args;
        if (C.IsPlayer()) {
            try {
                HistoryRecord.addRecord(getOutfitData(C));
            } catch (e) {
                console.error("[VPW] hookHistory CharacterRefresh failed:", e);
            }
        }
        return next(args);
    });
}

export function hookDrawCharacter(modApi) {
    /* modApi.hookFunction("CharacterRefresh", 90, (args, next) => {
        const [C] = args;
        if (C.CharacterID.startsWith("displayCharacter")) {
            const originalIsPlayer = C.IsPlayer;
            C.IsPlayer = () => true;
            const result = next(args);
            C.IsPlayer = originalIsPlayer;
            return result;
        }
        return next(args);
    });

    modApi.hookFunction("ValidationResolveAppearanceDiff", 90, (args, next) => {
        const [groupName, previousItem, newItem, params] = args;
        const C = params.C;
        if (C.CharacterID.startsWith("displayCharacter"))
            { return { item: newItem, valid: true }; }
        return next(args);
    });*/
} 