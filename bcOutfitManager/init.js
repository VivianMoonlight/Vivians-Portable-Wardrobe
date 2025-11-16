
const { registerModWithSdk } = await import(`./utils/register.js?${Date.now()}`);
const { UIManager } = await import(`./ui/init_draw.js?${Date.now()}`);

const VERSION_NUMBER = "0.7.7";

let modInitialized = false;

function initMod() {
    if (modInitialized) return;
    modInitialized = true;

    console.info("BCOM: Successfully initialized.  Version: " + VERSION_NUMBER);

    //checkVersionUpdate();
    let uiManager = new UIManager();
    try {
        const modApi = registerModWithSdk(VERSION_NUMBER);

        const OUTFIT_PRIORITIES = {
            UI_INIT: 6,          // Higher than most UI mods
            DATA_HANDLING: 5,     // Standard priority
            OBSERVE: 0
        };
        // Initialize appearance data before any UI hooks
        modApi.hookFunction("CharacterAppearanceBuildCanvas", OUTFIT_PRIORITIES.UI_INIT, (args, next) => {
            const [C] = args;
            if (!C.Appearance) C.Appearance = [];
            return next(args);
        });

        //uiManager.hookDrawMenu(modApi);
        uiManager.createMainButton();
        uiManager.hookDrawCharacter(modApi);
    } catch (error) {
        console.error('BCOM: failed:', error);
    }
}

function waitForPlayerAndInit() {
    if (window.Player && typeof Player.MemberNumber !== "undefined") {
        initMod();
    } else {
        setTimeout(waitForPlayerAndInit, 100);
    }
}

// Instead of calling initMod() directly:
if (window.bcModSdk?.registerMod) {
    waitForPlayerAndInit();
} else {
    window.addEventListener('bcModSdkLoaded', waitForPlayerAndInit);
    setTimeout(waitForPlayerAndInit, 5000);
}

