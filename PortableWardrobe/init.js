
const { registerModWithSdk } = await import(`./utils/register.js?${Date.now()}`);
const { UIManager, createFloatingOutfitWidget } = await import(`./core/main_controller.js?${Date.now()}`);


const VERSION_NUMBER = "0.1";

let modInitialized = false;

async function initMod() {
    if (modInitialized) return;
    modInitialized = true;

    console.info("VPW: Successfully initialized.  Version: " + VERSION_NUMBER);

    //checkVersionUpdate();
    
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

        let uiManager = new UIManager();
        await uiManager.init();

        //uiManager.hookDrawMenu(modApi);
        //uiManager._floatingOutfitWidget = await createFloatingOutfitWidget(uiManager);
        //uiManager.createMainButton()
        uiManager.hookDrawCharacter(modApi);
        uiManager.hookHistory(modApi);
    } catch (error) {
        console.error('VPW: failed:', error);
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

