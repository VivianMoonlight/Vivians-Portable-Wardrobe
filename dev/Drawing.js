"use strict";
/**
 * The main game canvas where everything will be drawn
 * @type {CanvasRenderingContext2D}
 */
let MainCanvas;
const MainCanvasWidth = 2000;
const MainCanvasHeight = 1000;

/**
 * Temporary GPU-based canvas
 * @type {CanvasRenderingContext2D}
 */
let TempCanvas;
/**
 * Temporary CPU-based canvas (for colorization)
 * @type {CanvasRenderingContext2D}
 */
let ColorCanvas;

var BlindFlash = false;

/**
 * Whether a blindfold removal screen flash should _potentially_ be performed the next time the player character is refreshed.
 * Generally assigned by {@link InventoryRemove}.
 */
var BlindFlashQueue = false;
var DrawingBlindFlashTimer = 0;

// A bank of all the chached images
/** @type {Map<string, HTMLImageElement>} */
const DrawCacheImage = new Map;

// Last dark factor for blindflash
var DrawLastDarkFactor = 0;

/**
 * A list of the characters that are drawn every frame
 * @type {Character[]}
 */
var DrawLastCharacters = [];

/**
 * A list of elements to draw at the end of the drawing process.
 * Mostly used for hovering button labels.
 * @type {(() => void)[]}
 */
var DrawHoverElements = [];

/**
 * The last canvas position in format `[left, top, width, height]`
 * @type {RectTuple}
 */
var DrawCanvasPosition = [0, 0, 0, 0];

/**
 * An enum for the method for resizing custom backgrounds
 * @enum {number}
 */
var DrawingResizeMode = {
	Fill: 1,
	FillOriginalRatio: 2,
	ShowFullOriginalRatio: 3
};

/**
 * A cache of the texture masks used to draw the character
 * @type {Map<string, HTMLCanvasElement>}
 */
let DrawCacheTextureAlphaMasks = new Map();

/**
 * Converts a hex color string to a RGB color
 * @param {string} color - Hex color to conver
 * @returns {RGBColor} - RGB color
 */
function DrawHexToRGB(color) {
	const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
	color = color.replace(shorthandRegex, function (m, r, g, b) {
		return r + r + g + g + b + b;
	});

	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
	return result ? {
		r: parseInt(result[1], 16),
		g: parseInt(result[2], 16),
		b: parseInt(result[3], 16)
	} : {
		r: 0,
		g: 0,
		b: 0
	};
}

/**
 * Converts a RGB color to a hex color string
 * @param {readonly [R: number, G: number, B: number]} color - RGB color to conver
 * @returns {HexColor} - Hex color string
 */
function DrawRGBToHex(color) {
	const rgb = color[2] | (color[1] << 8) | (color[0] << 16);
	return `#${(0x1000000 + rgb).toString(16).slice(1).toUpperCase()}`;
}

/**
 * Loads the canvas to draw on with its style and event listeners.
 * @returns {void} - Nothing
 */
function DrawLoad() {
	const mainCanvas = /** @type {null | HTMLCanvasElement} */ (document.getElementById("MainCanvas"))?.getContext?.("2d");
	const tempCanvas = document.createElement("canvas").getContext("2d");
	const colorCanvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	if (!mainCanvas) {
		throw new Error("MainCanvas element or context is null");
	} else if (!tempCanvas) {
		throw new Error("TempCanvas context is null");
	} else if (!colorCanvas) {
		throw new Error("ColorCanvas context is null");
	}

	// Creates the objects used in the game
	MainCanvas = mainCanvas;
	TempCanvas = tempCanvas;
	ColorCanvas = colorCanvas;

	// Font is fixed for now, color can be set
	MainCanvas.font = CommonGetFont(36);
	MainCanvas.textAlign = "center";
	MainCanvas.textBaseline = "middle";
}

/**
 * Returns the image file from cache or build it from the source
 * @param {string} Source - URL of the image
 * @returns {HTMLImageElement} - Image file
 */
function DrawGetImage(Source) {
	// Search in the cache to find the image and make sure this image is valid
	let Img = DrawCacheImage.get(Source);
	if (!Img) {
		Img = new Image;
		DrawCacheImage.set(Source, Img);
		// Keep track of image load state
		const IsAsset = (Source.indexOf("Assets") >= 0);
		if (IsAsset) {
			Img.addEventListener("load", function () {
				DrawGetImageOnLoad(this);
			});
		}

		Img.addEventListener("error", function () {
			DrawGetImageOnError(this, IsAsset);
		});

		// For CORS access
		Img.crossOrigin = "anonymous";
		// Start loading
		Img.src = Source;
	}

	// returns the final image
	return Img;
}

/**
 * Reloads all character canvas once all images are loaded
 * @param {HTMLImageElement | null} img
 * @returns {void} - Nothing
 */
function DrawGetImageOnLoad(img) {
	DrawRefreshCharacterForImage(img);
}

/**
 *
 * @param {HTMLImageElement | null} img
 */
function DrawRefreshCharacterForImage(img) {
	if (!img) return;

	const url = new URL(img.src);
	const path = url.pathname;
	const parts = path.split("/");
	let pathPos = parts.indexOf("Assets");
	if (pathPos === -1) return;

	if (parts[++pathPos] !== "Female3DCG") return;

	let groupName = parts[++pathPos];
	if (groupName === "Override") {
		// Overrides have two extra positions
		pathPos += 2;
		groupName = parts[pathPos];
	}
	let layerName = parts[++pathPos];
	if (!layerName.endsWith(".png")) {
		// This is a pose directory
		layerName = parts[++pathPos];
	}
	const assetName = layerName.split("_")[0].replace(".png", "");
	const wearing = Character.filter(c => c.Appearance.some(i => (i.Asset.Group.Name === groupName || i.Asset.DynamicGroupName === groupName) && i.Asset.Name === assetName ));
	for (const char of wearing) {
		char.MustDraw = true;
	}
}

/**
 * Attempts to redownload an image if it previously failed to load
 * @param {HTMLImageElement & { errorcount?: number }} Img - Image tag that failed to load
 * @param {boolean} IsAsset - Whether or not the image is part of an asset
 * @returns {void} - Nothing
 */
function DrawGetImageOnError(Img, IsAsset) {
	if (Img.errorcount == null) Img.errorcount = 0;
	Img.errorcount += 1;
	if (Img.errorcount < 3) {
		// eslint-disable-next-line no-self-assign
		Img.src = Img.src;
		// On the third attempt, we try without the crossOrigin
		if (Img.errorcount == 2) Img.crossOrigin = null;
	} else {
		// Load failed. Display the error in the console and mark it as done.
		console.log("Error loading image " + Img.src);
		if (IsAsset) DrawRefreshCharacterForImage(null);
	}
}

/**
 * Draws the glow under the arousal meter under the screen
 * @param {number} X - Position of the meter on the X axis
 * @param {number} Y - Position of the meter on the Y axis
 * @param {number} Zoom - Zoom factor
 * @param {number} Level - Current vibration level on a scale of 0 to 4. Must be INTEGER
 * @param {boolean} Animated - Whether or not animations should be played
 * @param {number} AnimFactor
 * @param {boolean} Orgasm - Whether or not the meter is in recover from orgasm mode
 * @returns {void} - Nothing
 */
function DrawArousalGlow(X, Y, Zoom, Level, Animated, AnimFactor, Orgasm) {
	if (!Orgasm) {
		let Rx = 0;
		let Ry = 0;

		if (Level > 0 && Animated) {
			Rx = -(1 + AnimFactor * Level / 2) + (2 + AnimFactor * Level) * Math.random();
			Ry = -(1 + AnimFactor * Level / 2) + (2 + AnimFactor * Level) * Math.random();
		}
		if (!Animated || (Level > 0 || CommonTime() % 1000 > 500))
			DrawImageZoomCanvas("Screens/Character/Player/ArousalMeter_Glow_" + Math.max(0, Math.min(Math.floor(Level), 4)) + ".png", MainCanvas, 0, 0, 300, 700, X - 100 * Zoom + Rx, Y - 100 * Zoom + Ry, 300 * Zoom, 700 * Zoom);
	}
}


/**
 * Draws the arousal meter on screen
 * @param {number} X - Position of the meter on the X axis
 * @param {number} Y - Position of the meter on the Y axis
 * @param {number} Zoom - Zoom factor
 * @param {number} Progress - Current progress of the arousal meter
 * @param {boolean} Automatic - Wheter or not the arousal is in automatic mode
 * @param {boolean} Orgasm - Whether or not the meter is in recover from orgasm mode
 * @returns {void} - Nothing
 */
function DrawArousalThermometer(X, Y, Zoom, Progress, Automatic, Orgasm) {
	DrawImageZoomCanvas("Screens/Character/Player/ArousalMeter" + (Orgasm ? "Orgasm" : "") + (Automatic ? "Automatic" : "") + ".png", MainCanvas, 0, 0, 100, 500, X, Y, 100 * Zoom, 500 * Zoom);
	if ((Progress > 0) && !Orgasm) DrawRect(X + (30 * Zoom), Y + (15 * Zoom) + (Math.round((100 - Progress) * 4 * Zoom)), (40 * Zoom), (Math.round(Progress * 4 * Zoom)), "#FF0000");
}

/**
 * Draw the arousal meter next to the player if it is allowed by the character and visible for the player
 * @param {Character} C - Character for which to potentially draw the arousal meter
 * @param {number} X - Position of the meter on the X axis
 * @param {number} Y - Position of the meter on the Y axis
 * @param {number} Zoom - Zoom factor
 * @returns {void} - Nothing
 */
function DrawArousalMeter(C, X, Y, Zoom) {
	if (ActivityAllowed() && PreferenceArousalAtLeast(C, "Manual"))
		if (C.IsPlayer() || (C.ArousalSettings.Visible == "Access" && C.AllowItem) || C.ArousalSettings.Visible == "All")
			if (C.IsPlayer() || (Player.ArousalSettings.ShowOtherMeter == null) || Player.ArousalSettings.ShowOtherMeter) {
				ActivitySetArousal(C, C.ArousalSettings.Progress);
				if (Player.ArousalSettings.VFX != "VFXInactive" && C.ArousalSettings.Progress > 0 && PreferenceArousalAtLeast(C, "Hybrid")) {
					let Progress = 0;
					if (!(C.ArousalSettings.VibratorLevel == null || typeof C.ArousalSettings.VibratorLevel !== "number" || isNaN(C.ArousalSettings.VibratorLevel))) {
						Progress = C.ArousalSettings.VibratorLevel;
					}

					if (Progress > 0) { // -1 is disabled
						const animationTimeMax = 5000; // 5 seconds
						const animationTimeLeft = Math.min(C.ArousalSettings.ChangeTime - CommonTime(), 0) + animationTimeMax;

						DrawArousalGlow(
							X + (C.ArousalZoom ? 50 : 90) * Zoom,
							Y + (C.ArousalZoom ? 200 : 400) * Zoom,
							C.ArousalZoom ? Zoom : Zoom * 0.2,
							Progress,
							Player.ArousalSettings.VFX == "VFXAnimated" || (Player.ArousalSettings.VFX == "VFXAnimatedTemp" && C.ArousalSettings.ChangeTime != null && animationTimeLeft > 0),
							Math.max(0, animationTimeLeft / animationTimeMax),
							C.ArousalSettings.OrgasmTimer != null && typeof C.ArousalSettings.OrgasmTimer === "number" && !isNaN(C.ArousalSettings.OrgasmTimer) && C.ArousalSettings.OrgasmTimer > 0);
					}
				}

				DrawArousalThermometer(
					X + (C.ArousalZoom ? 50 : 90) * Zoom,
					Y + (C.ArousalZoom ? 200 : 400) * Zoom,
					C.ArousalZoom ? Zoom : Zoom * 0.2,
					C.ArousalSettings.Progress,
					PreferenceArousalAtLeast(C, "Automatic"),
					C.ArousalSettings.OrgasmTimer != null && typeof C.ArousalSettings.OrgasmTimer === "number" && !isNaN(C.ArousalSettings.OrgasmTimer) && C.ArousalSettings.OrgasmTimer > 0);

				if (C.ArousalZoom && (typeof C.ArousalSettings.OrgasmCount === "number") && (C.ArousalSettings.OrgasmCount >= 0) && (C.ArousalSettings.OrgasmCount <= 9999)) {
					MainCanvas.font = CommonGetFont(Math.round(36 * Zoom).toString());
					DrawText(((C.ArousalSettings.OrgasmCount != null) ? C.ArousalSettings.OrgasmCount : 0).toString(), X + 100 * Zoom, Y + 655 * Zoom, "Black", "Gray");
					MainCanvas.font = CommonGetFont(36);
				}
			}
}

/**
 * Refreshes the character if not all images are loaded and draw the character canvas on the main game screen
 * @param {Character} C - Character to draw
 * @param {number} X - Position of the character on the X axis
 * @param {number} Y - Position of the character on the Y axis
 * @param {number} Zoom - Zoom factor
 * @param {boolean} [IsHeightResizeAllowed=true] - Whether or not the settings allow for the height modifier to be applied
 * @param {CanvasRenderingContext2D} [DrawCanvas] - The canvas to draw to; If undefined `MainCanvas` is used
 * @returns {void} - Nothing
 */
/* eslint-disable-next-line */
function DrawCharacter(C, X, Y, Zoom, IsHeightResizeAllowed, DrawCanvas) {
	// There's a few screens that call us with an invalid character, mainly because screen loading doesn't track when
	// it actually completes; for example, the Management screen crashes in here, because it can't initialize its NPCs
	// before the text file for it has been loaded and translated.
	if (!C) return;

	// Record that the character was drawn this frame
	DrawLastCharacters.push(C);

	// FIXME: that whole parameter is dangerous, as there's a bunch of calls in here that blindly draw directly onto MainCanvas.
	// Since it's only ever used by KD, please keep it that way ❤️
	if (!DrawCanvas) DrawCanvas = MainCanvas;

	const OverrideDark = (
		CurrentModule == "MiniGame"
		|| ((Player.Effect.includes("VRAvatars") && C.Effect.includes("VRAvatars")))
		|| CurrentScreen == "InformationSheet"
		|| CurrentScreen === "Crafting"
		|| CurrentScreen === "Wardrobe"
		|| CurrentScreen === "Shop2"
		|| (CurrentScreen === "ChatRoom") && (ChatRoomMapViewIsActive() === true) && (CurrentCharacter == null)
	);

	if (
		C.IsPlayer()
		|| OverrideDark
		|| Player.GetBlindLevel() < 3
	) {

		CharacterCheckHooks(C, CurrentCharacter != null);

		ControllerAddActiveArea(X + 100, Y + 200);

		// If there's a fixed image to draw instead of the character
		if (C.FixedImage != null) {
			DrawImageZoomCanvas(C.FixedImage, DrawCanvas, 0, 0, 500, 1000, X, Y, 500 * Zoom, 1000 * Zoom);
			return;
		}

		// Run any existing asset scripts
		if (C.RunScripts && C.HasScriptedAssets) {
			const DynamicAssets = C.Appearance.filter(CA => CA.Asset.DynamicScriptDraw);
			DynamicAssets.forEach(Item =>
				CommonCallFunctionByNameWarn(`Assets${Item.Asset.Group.Name}${Item.Asset.Name}ScriptDraw`, {
					C, Item, PersistentData: () => AnimationPersistentDataGet(C, Item.Asset)
				})
			);

			// If we must rebuild the canvas due to an animation
			const charKey = AnimationGetDynamicDataName(C);
			const lastRefresh = AnimationPersistentStorage[AnimationDataTypes.RefreshTime][charKey] ?? 0;
			const refreshRate = AnimationPersistentStorage[AnimationDataTypes.RefreshRate][charKey] ?? 60000;
			if (refreshRate + lastRefresh < CommonTime() && AnimationPersistentStorage[AnimationDataTypes.Rebuild][charKey]) {
				CharacterRefresh(C, false, false);
				AnimationPersistentStorage[AnimationDataTypes.Rebuild][charKey] = false;
				AnimationPersistentStorage[AnimationDataTypes.RefreshTime][charKey] = CommonTime();
			}
		}

		if (C.MustDraw) {
			CharacterLoadCanvas(C);
			C.MustDraw = false;
		}

		// There's 2 different canvas, one blinking and one that doesn't
		let Canvas = (Math.round(CurrentTime / 400) % C.BlinkFactor == 0 && !CommonPhotoMode) ? C.CanvasBlink : C.Canvas;
		if (!Canvas) {
			// Things are FUBAR if we ever reach this point
			return;
		}

		// If we must dark the Canvas characters
		if (!C.IsPlayer() && !OverrideDark && (Player.IsBlind() || Player.HasTints())) {
			TempCanvas.canvas.width = CanvasDrawWidth;
			TempCanvas.canvas.height = CanvasDrawHeight;

			TempCanvas.globalCompositeOperation = "copy";
			TempCanvas.drawImage(Canvas, 0, 0);
			// Overlay black rectangle.
			TempCanvas.globalCompositeOperation = "source-atop";

			if (Player.IsBlind()) {
				const DarkFactor = Math.min(CharacterGetDarkFactor(Player) * 2, 1);
				TempCanvas.fillStyle = `rgba(0,0,0,${1.0 - DarkFactor})`;
				TempCanvas.fillRect(0, 0, Canvas.width, Canvas.height);
			}

			const Tints = Player.GetTints();
			for (const { r, g, b, a } of Tints) {
				TempCanvas.fillStyle = `rgba(${r},${g},${b},${a})`;
				TempCanvas.fillRect(0, 0, Canvas.width, Canvas.height);
			}

			Canvas = TempCanvas.canvas;
		}

		// If we must flip the canvas vertically
		const IsInverted = (CurrentScreen != "KinkyDungeon") ? CharacterAppearsInverted(C) : false;

		// Get the height ratio and X & Y offsets based on it
		const HeightRatio = (IsHeightResizeAllowed == null || IsHeightResizeAllowed == true) ? C.HeightRatio : 1;
		const XOffset = CharacterAppearanceXOffset(C, HeightRatio);
		const YOffset = CharacterAppearanceYOffset(C, HeightRatio);

		// Calculate the vertical parameters. In certain cases, cut off anything above the Y value.
		const YCutOff = YOffset >= 0 || ServerPlayerIsInChatRoom();
		const YStart = CanvasUpperOverflow + (YCutOff ? -YOffset / HeightRatio : 0);
		const SourceHeight = 1000 / HeightRatio + (YCutOff ? 0 : -YOffset / HeightRatio);
		const DestY = (IsInverted || YCutOff) ? 0 : YOffset;

		// Apply blur filter if needed
		const BlurLevel = Player.GetBlurLevel();
		const needsBlur = !C.IsPlayer() && !OverrideDark && BlurLevel > 0;
		if (needsBlur) {
			MainCanvas.filter = `blur(${BlurLevel}px)`;
		}
		// Draw the character
		DrawImageEx(Canvas, DrawCanvas, X + XOffset * Zoom, Y + DestY * Zoom, {
			SourcePos: [0, YStart, Canvas.width, SourceHeight],
			Width: 500 * HeightRatio * Zoom,
			Height: (1000 - DestY) * Zoom,
			Invert: IsInverted,
			Mirror: IsInverted
		});
		// Resetting the filter is expensive, even if there's no change. Only change the filter if we need to.
		if (needsBlur) {
			MainCanvas.filter = 'none';
		}

		// Draw the arousal meter & game images on certain conditions
		if (CurrentScreen != "ChatRoom" || ChatRoomHideIconState <= 1) {
			DrawArousalMeter(C, X, Y, Zoom);
			OnlineGameDrawCharacter(C, X, Y, Zoom);
			if (C.HasHiddenItems) DrawImageZoomCanvas("Screens/Character/Player/HiddenItem.png", DrawCanvas, 0, 0, 86, 86, X + 54 * Zoom, Y + 880 * Zoom, 70 * Zoom, 70 * Zoom);
		}

		// Draws the character focus zones if we need too
		if (
			C.FocusGroup?.Zone != null
			&& CurrentScreen != "Preference"
			&& !CommonIncludes(/** @type {const} */(["colorDefault", "colorExpression", "colorItem"]), DialogMenuMode)
		) {

			// Draw all the possible zones in transparent colors (gray if free, yellow if occupied, red if blocker)
			for (const group of AssetGroup) {
				if (group.Zone != null && group.Name != C.FocusGroup.Name) {
					let Color = "#80808040";
					if (group.IsItem() && InventoryGroupIsBlocked(C, group.Name)) Color = "#88000580";
					else if (InventoryGet(C, group.Name) != null) Color = "#D5A30080";
					DrawAssetGroupZone(C, group.Zone, Zoom, X, Y, HeightRatio, Color, 5);
				}
			}

			// Draw the focused zone in cyan
			DrawAssetGroupZone(C, C.FocusGroup.Zone, Zoom, X, Y, HeightRatio, "cyan");
		}

		// Draw the character name below herself
		if ((C.Name != "") && ((CurrentModule == "Room") || (CurrentModule == "Online" && !(ServerPlayerIsInChatRoom() && ChatRoomHideIconState >= 3)) || ((CurrentScreen == "Wardrobe") && !C.IsPlayer())) && (CurrentScreen != "Private") && (CurrentScreen != "PrivateBed") && (CurrentScreen != "PrivateRansom"))
			if (!ServerPlayerIsInChatRoom() || !ChatRoomMapViewIsActive() || CurrentCharacter)
				if ((!Player.IsBlind() && BlurLevel <= 10) || (Player.GameplaySettings && Player.GameplaySettings.SensDepChatLog == "SensDepLight")) {
					DrawCanvas.font = CommonGetFont(30);
					const NameOffset = ServerPlayerIsInChatRoom() && (ChatRoomCharacter.length > 5 || (ChatRoomCharacter.length == 5 && CommonPhotoMode)) && CurrentCharacter == null ? -4 : 0;
					DrawText(CharacterNickname(C), X + 255 * Zoom, Y + 980 * Zoom + NameOffset, (CommonIsColor(C.LabelColor)) ? C.LabelColor : "White", "Black");
					DrawCanvas.font = CommonGetFont(36);
				}

	}
}

/**
 * Draws an asset group zone outline over the character
 * @param {Character} C - Character for which to draw the zone
 * @param {readonly RectTuple[]} Zone - Zone to be drawn
 * @param {number} Zoom - Height ratio of the character
 * @param {number} X - Position of the character on the X axis
 * @param {number} Y - Position of the character on the Y axis
 * @param {number} HeightRatio - The displayed height ratio of the character
 * @param {string} Color - Color of the zone outline
 * @param {number} [Thickness=3] - Thickness of the outline
 * @param {string} [FillColor] - If non-empty, the color to fill the rectangle with
 * @returns {void} - Nothing
 */
function DrawAssetGroupZone(C, Zone, Zoom, X, Y, HeightRatio, Color, Thickness = 3, FillColor = undefined) {
	for (let Z = 0; Z < Zone.length; Z++) {
		let CZ = DialogGetCharacterZone(C, Zone[Z], X, Y, Zoom, HeightRatio);

		if (FillColor != null) DrawRect(CZ[0], CZ[1], CZ[2], CZ[3], FillColor);
		DrawEmptyRect(CZ[0], CZ[1], CZ[2], CZ[3], Color, Thickness);

		ControllerAddActiveArea(Math.round(CZ[0]), Math.round(CZ[1]));
	}
}

/**
 * Return a semi-transparent copy of a canvas
 * @param {HTMLCanvasElement} Canvas - source
 * @param {number} [Alpha] - transparency between 0-1
 * @returns {HTMLCanvasElement} - result
 */
function DrawAlpha(Canvas, Alpha) {
	// If there's nothing to do simply return the original image
	if ((Alpha == null) || (Alpha >= 1.0)) return Canvas;
	// Copy the image to the temp canvas
	TempCanvas.canvas.width = Canvas.width;
	TempCanvas.canvas.height = Canvas.height;
	TempCanvas.globalCompositeOperation = "copy";
	TempCanvas.drawImage(Canvas, 0, 0);
	// Apply the alpha
	TempCanvas.globalCompositeOperation = "destination-in";
	TempCanvas.fillStyle = "rgba(0,0,0," + Alpha + ")";
	TempCanvas.fillRect(0, 0, Canvas.width, Canvas.height);
	return TempCanvas.canvas;
}

/**
 * Clears a rectangle on a canvas
 * @param {CanvasRenderingContext2D} Canvas - The canvas on which to clear rect
 * @param {number} x - Position of the image on the X axis
 * @param {number} y - Position of the image on the Y axis
 * @param {number} width - Width of the rectangle to clear
 * @param {number} height - Height of the rectangle to clear
 * @returns {void} - Nothing
 */
function DrawClearRect(Canvas, x, y, width, height) {
	Canvas.clearRect(x, y, width, height);
}

/**
 * Clears alpha masks on a canvas
 * @param {CanvasRenderingContext2D} Canvas - The canvas on which to clear rect
 * @param {number} X - X offset of where the masking should be done
 * @param {number} Y - Y offset of where the masking should be done
 * @param {readonly RectTuple[]} AlphaMasks - An array of alpha masks to apply
 */
function DrawClearAlphaMasks(Canvas, X, Y, AlphaMasks) {
	if (!Array.isArray(AlphaMasks)) return;

	AlphaMasks.forEach(([x, y, w, h]) => DrawClearRect(Canvas, x - X, y - Y, w, h));
}

/**
 * Draws a zoomed image from a source to a specific canvas
 * @param {string | HTMLImageElement | HTMLCanvasElement} Source - URL of image or image itself
 * @param {CanvasRenderingContext2D} Canvas - Canvas on which to draw the image
 * @param {number} SX - The X coordinate where to start clipping
 * @param {number} SY - The Y coordinate where to start clipping
 * @param {number} SWidth - The width of the clipped image
 * @param {number} SHeight - The height of the clipped image
 * @param {number} X - Position of the image on the X axis
 * @param {number} Y - Position of the image on the Y axis
 * @param {number} Width - Width of the image
 * @param {number} Height - Height of the image
 * @param {boolean} [Invert] - Flips the image vertically
 * @returns {boolean} - whether the image was complete or not
 */
function DrawImageZoomCanvas(Source, Canvas, SX, SY, SWidth, SHeight, X, Y, Width, Height, Invert) {
	return DrawImageEx(Source, Canvas, X, Y, {
		SourcePos: [SX, SY, SWidth, SHeight],
		Width,
		Height,
		Invert
	});
}

/**
 * Draws a resized image from a source to the main canvas
 * @param {string | HTMLImageElement | HTMLCanvasElement} Source - URL of image or image itself
 * @param {number} X - Position of the image on the X axis
 * @param {number} Y - Position of the image on the Y axis
 * @param {number} Width - Width of the image after being resized
 * @param {number} Height - Height of the image after being resized
 * @returns {boolean} - whether the image was complete or not
 */
function DrawImageResize(Source, X, Y, Width, Height) {
	return DrawImageEx(Source, MainCanvas, X, Y, { Width, Height });
}

/**
 * Draws a zoomed image from a source to a specific canvas
 * @param {string | HTMLImageElement | HTMLCanvasElement} Source - URL of the image
 * @param {CanvasRenderingContext2D} Canvas - Canvas on which to draw the image
 * @param {number} X - Position of the image on the X axis
 * @param {number} Y - Position of the image on the Y axis
 * @param {DrawOptions} [Options] Options to use when drawing
 * @returns {boolean} - whether the image was complete or not
 */
function DrawImageCanvas(Source, Canvas, X, Y, Options) {
	return DrawImageEx(Source, Canvas, X, Y, Options);
}

/**
 * Draws a canvas to a specific canvas
 * @param {HTMLImageElement | HTMLCanvasElement} Img - Canvas to draw
 * @param {CanvasRenderingContext2D} Canvas - Canvas on which to draw the image
 * @param {number} X - Position of the image on the X axis
 * @param {number} Y - Position of the image on the Y axis
 * @param {readonly RectTuple[]} AlphaMasks - A list of alpha masks to apply to the asset
 * @param {readonly TextureAlphaMask[]} TextureAlphaMasks - A list of mask layers to apply to the asset
 * @returns {boolean} - whether the image was complete or not
 */
function DrawCanvas(Img, Canvas, X, Y, AlphaMasks, TextureAlphaMasks) {
	return DrawImageEx(Img, Canvas, X, Y, { AlphaMasks, TextureAlphaMask: TextureAlphaMasks });
}

/**
 * Draws an image from a source on the main canvas
 * @param {string | HTMLImageElement | HTMLCanvasElement} Source - URL of image or image itself
 * @param {number} X - Position of the image on the X axis
 * @param {number} Y - Position of the image on the Y axis
 * @param {boolean} [Invert] - Flips the image vertically
 * @returns {boolean} - whether the image was complete or not
 */
function DrawImage(Source, X, Y, Invert) {
	return DrawImageEx(Source, MainCanvas, X, Y, { Invert });
}

/**
 * Applies texture masks to a canvas about to be drawn
 * @param {CanvasRenderingContext2D} destCanvas
 * @param {number} X - Position of the image on the X axis
 * @param {number} Y - Position of the image on the Y axis
 * @param {readonly TextureAlphaMask[]} TextureAlphaMasks
 */
function DrawApplyTextureAlphaMask(destCanvas, X, Y, TextureAlphaMasks) {
	const key = "TexMask:" + JSON.stringify({
		coord: [X, Y, destCanvas.canvas.width, destCanvas.canvas.height],
		sources: TextureAlphaMasks.map(x=>x).sort(((a,b) => a.Url.localeCompare(b.Url))),
	});

	let mask = DrawCacheTextureAlphaMasks.get(key);
	if (!mask) {
		const tempCanvas = document.createElement("canvas");
		const ctx = tempCanvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) {
			return;
		}

		tempCanvas.width = destCanvas.canvas.width;
		tempCanvas.height = destCanvas.canvas.height;
		ctx.fillStyle = "rgb(0,0,0)";
		ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

		for(const tmask of TextureAlphaMasks) {
			const img = DrawGetImage(tmask.Url);
			if (img.complete) {
				ctx.globalCompositeOperation = tmask.Mode || "destination-in";
				ctx.drawImage(img, tmask.X - X, tmask.Y - Y);
			} else {
				// If the image is not loaded, we can't apply the mask yet
				return;
			}
		}

		mask = tempCanvas;
		DrawCacheTextureAlphaMasks.set(key, mask);
	}

	const oldCompositeOperation = destCanvas.globalCompositeOperation;
	destCanvas.globalCompositeOperation = "destination-in";
	destCanvas.drawImage(mask, 0, 0);
	destCanvas.globalCompositeOperation = oldCompositeOperation;
}

/**
 * Draws an image on canvas, applying all options
 * @param {string | HTMLImageElement | HTMLCanvasElement} Source - URL of image or image itself
 * @param {CanvasRenderingContext2D} Canvas - Canvas on which to draw the image
 * @param {number} X - Position of the image on the X axis
 * @param {number} Y - Position of the image on the Y axis
 * @param {DrawOptions} [Options = {}] - any extra options
 * @returns {boolean} - whether the image was complete or not
 */
function DrawImageEx(
	Source,
	Canvas,
	X,
	Y,
	Options
) {
	let { Zoom, HexColor, FullAlpha, AlphaMasks, Alpha, Invert, Mirror, BlendingMode, Width, Height, SourcePos, TextureAlphaMask: TexureMasks } = Options || {};

	let Img;

	if (typeof Source === "string") {
		Img = DrawGetImage(Source);
	} else {
		Img = Source;
	}

	if (Img instanceof HTMLImageElement) {
		if (!Img.complete) return false;
		if (!Img.naturalWidth) return true;
	}

	if (typeof Zoom !== "number")
		Zoom = 1.0;

	if (typeof HexColor !== "string")
		HexColor = undefined;

	if (typeof Alpha !== "number")
		Alpha = 1.0;

	Alpha = Math.max(0, Math.min(1, Alpha));
	if (Alpha === 0) return true;

	if (!BlendingMode) {
		BlendingMode = "source-over";
	}

	const sizeChanged = Width != null || Height != null;
	if (Width == null) {
		Width = SourcePos ? SourcePos[2] : Img.width;
	}
	if (Height == null) {
		Height = SourcePos ? SourcePos[3] : Img.height;
	}

	// If we need to colorize or mask, we need to copy the image to
	// a temporary canvas. On top of that, colorizing uses .getImageData
	// so we have to fallback to the CPU canvas
	let destCanvas;
	if (HexColor || AlphaMasks || TexureMasks) {
		destCanvas = HexColor ? ColorCanvas : TempCanvas;

		destCanvas.canvas.width = Img.width;
		destCanvas.canvas.height = Img.height;
		destCanvas.globalCompositeOperation = "copy";
		destCanvas.drawImage(Img, 0, 0);

		if (AlphaMasks) {
			// Apply masks
			DrawClearAlphaMasks(destCanvas, X, Y, AlphaMasks);
		}

		if (TexureMasks) {
			DrawApplyTextureAlphaMask(destCanvas, X, Y, TexureMasks);
		}

		if (HexColor) {
			// We've been asked to colorize the image, fetch the pixel data
			// and massage it
			const imageData = destCanvas.getImageData(0, 0, destCanvas.canvas.width, destCanvas.canvas.height);
			const data = imageData.data;

			// Get the RGB color used to transform
			const rgbColor = DrawHexToRGB(HexColor);

			// We transform each non transparent pixel based on the RGG value
			if (FullAlpha) {
				for (let p = 0, len = data.length; p < len; p += 4) {
					if (data[p + 3] == 0)
						continue;
					const trans = ((data[p] + data[p + 1] + data[p + 2]) / 383);
					data[p + 0] = rgbColor.r * trans;
					data[p + 1] = rgbColor.g * trans;
					data[p + 2] = rgbColor.b * trans;
				}
			} else {
				for (let p = 0, len = data.length; p < len; p += 4) {
					const trans = ((data[p] + data[p + 1] + data[p + 2]) / 383);
					if ((data[p + 3] == 0) || (trans < 0.8) || (trans > 1.2))
						continue;
					data[p + 0] = rgbColor.r * trans;
					data[p + 1] = rgbColor.g * trans;
					data[p + 2] = rgbColor.b * trans;
				}
			}

			// Replace the source image with the modified canvas
			destCanvas.putImageData(imageData, 0, 0);
		}
		destCanvas = destCanvas.canvas;
	} else {
		destCanvas = Img;
	}

	// Blit the transformed image to the main canvas, applying opacity and zoom

	// Instead of expensive save/restore, we store the relevant state info and restore it manually
	const savedCompositeOperation = Canvas.globalCompositeOperation;
	const savedAlpha = Canvas.globalAlpha;
	const savedTransform = Canvas.getTransform();

	Canvas.globalCompositeOperation = BlendingMode;
	Canvas.globalAlpha = Alpha;

	// Performance benefits from combining transforms is usually minimal to none but in cases with multiple transforms it adds up
	const scaleHoriz = Zoom * (Mirror ? -1 : 1);   // Scaling and horizontal mirroring
	const scaleVert = Zoom * (Invert ? -1 : 1);    // Scaling and vertical inversion
	const translateX = X + (Mirror ? Width : 0);    // Translation in x
	const translateY = Y + (Invert ? Height : 0);   // Translation in y

	Canvas.transform(scaleHoriz, 0, 0, scaleVert, translateX, translateY);

	if (SourcePos) {
		Canvas.drawImage(destCanvas, SourcePos[0], SourcePos[1], SourcePos[2], SourcePos[3], 0, 0, Width, Height);
	} else if (sizeChanged) {
		Canvas.drawImage(destCanvas, 0, 0, Width, Height);
	} else {
		Canvas.drawImage(destCanvas, 0, 0);
	}

	Canvas.globalCompositeOperation = savedCompositeOperation;
	Canvas.globalAlpha = savedAlpha;
	Canvas.setTransform(savedTransform);
	return true;
}

/**
 * Wrapping text in fragments to support languages that do not separate between words using space.
 * This function can also break between a long English word if somehow needed in the script.
 * @param {string} text - The text to be fragmented.
 * @param {number} maxWidth - The max width the text will be filled in.
 * @returns {string[]} - A list of string that being fragmented.
 */
function fragmentText(text, maxWidth) {
	let words = text.split(' '),
		lines = [],
		line = "";

	if (MainCanvas.measureText(text).width < maxWidth) {
		return [text];
	}

	while (words.length > 0) {
		while (MainCanvas.measureText(words[0]).width >= maxWidth) {
			let temp = words[0];
			words[0] = temp.slice(0, -1);
			if (words.length > 1) {
				words[1] = temp.slice(-1) + words[1];
			} else {
				words.push(temp.slice(-1));
			}
		}
		if (MainCanvas.measureText(line + words[0]).width < maxWidth) {
			line += words.shift() + " ";
		} else {
			lines.push(line);
			line = "";
		}
		if (words.length === 0) {
			lines.push(line);
		}
	}
	return lines;
}

/**
 * Reduces the font size progressively until the text fits the wrap size
 * @param {string} Text - Text that will be drawn
 * @param {number} Width - Width in which the text must fit
 * @param {number} MaxLine - Maximum of lines the word can wrap for
 * @returns {void} - Nothing
 */
function GetWrapTextSize(Text, Width, MaxLine) {

	// Don't bother if it fits on one line
	if (MainCanvas.measureText(Text).width <= Width) return;

	const words = fragmentText(Text, Width);
	let line = '';

	// Find the number of lines
	let LineCount = 1;
	for (let n = 0; n < words.length; n++) {
		const testLine = line + words[n] + ' ';
		if (MainCanvas.measureText(testLine).width > Width && n > 0) {
			line = words[n] + ' ';
			LineCount++;
		} else line = testLine;
	}

	// If there's too many lines, we launch the function again with size minus 2
	if (LineCount > MaxLine) {
		MainCanvas.font = (parseInt(MainCanvas.font.substring(0, 2)) - 2).toString() + "px arial";
		GetWrapTextSize(Text, Width, MaxLine);
	}
}

/**
 * Draws a word wrapped text in a rectangle
 * @param {string} Text - Text to draw
 * @param {number} X - Position of the rectangle on the X axis
 * @param {number} Y - Position of the rectangle on the Y axis
 * @param {number} Width - Width of the rectangle
 * @param {number} Height - Height of the rectangle
 * @param {string} ForeColor - Foreground color
 * @param {string} [BackColor] - Background color
 * @param {number} [MaxLine] - Maximum of lines the word can wrap for
 * @param {number} LineSpacing - The number of pixels between each lines (default to 23)
 * @param {"Center" | "Top"} Alignment - How the text should be alligned w.r.t. the Y position when wrapped over multiple lines
 * @returns {void} - Nothing
 */
function DrawTextWrap(Text, X, Y, Width, Height, ForeColor, BackColor, MaxLine, LineSpacing = 23, Alignment = "Center") {
	ControllerAddActiveArea(X, Y);

	// Draw the rectangle if we need too
	if (BackColor != null) {
		MainCanvas.beginPath();
		MainCanvas.rect(X, Y, Width, Height);
		MainCanvas.fillStyle = BackColor;
		MainCanvas.fillRect(X, Y, Width, Height);
		MainCanvas.fill();
		MainCanvas.lineWidth = 2;
		MainCanvas.strokeStyle = ForeColor;
		MainCanvas.stroke();
		MainCanvas.closePath();
	}
	if (!Text) return;

	// Sets the text size if there's a maximum number of lines
	let TextSize;
	if (MaxLine != null) {
		TextSize = MainCanvas.font;
		GetWrapTextSize(Text, Width, MaxLine);
	}

	// Split the text if it wouldn't fit in the rectangle
	MainCanvas.fillStyle = ForeColor;
	if (MainCanvas.measureText(Text).width > Width) {
		const words = fragmentText(Text, Width);
		let line = '';

		// Find the number of lines
		let LineCount = 1;
		for (let n = 0; n < words.length; n++) {
			const testLine = line + words[n] + ' ';
			if (MainCanvas.measureText(testLine).width > Width && n > 0) {
				line = words[n] + ' ';
				LineCount++;
			} else line = testLine;
		}

		// Splits the words and draw the text
		line = '';

		switch (Alignment) {
			case "Top":
				Y += Height / 2;
				break;
			case "Center":
			default:
				Y = Y - ((LineCount - 1) * LineSpacing) + (Height / 2);
		}

		for (let n = 0; n < words.length; n++) {
			const testLine = line + words[n] + ' ';
			if (MainCanvas.measureText(testLine).width > Width && n > 0) {
				MainCanvas.fillText(line, X + Width / 2, Y);
				line = words[n] + ' ';
				Y += LineSpacing * 2;
			}
			else {
				line = testLine;
			}
		}
		MainCanvas.fillText(line, X + Width / 2, Y);

	} else MainCanvas.fillText(Text, X + Width / 2, Y + Height / 2);

	// Resets the font text size
	if ((MaxLine != null) && (TextSize != null))
		MainCanvas.font = TextSize;

}

/**
 * Draws a text element on the canvas that will fit on the specified width
 * @param {string} Text - Text to draw
 * @param {number} X - Position of the text on the X axis
 * @param {number} Y - Position of the text on the Y axis
 * @param {number} Width - Width in which the text has to fit
 * @param {string} Color - Color of the text
 * @param {string} [BackColor] - Color of the background
 * @returns {void} - Nothing
 */
function DrawTextFit(Text, X, Y, Width, Color, BackColor) {
	if (!Text) return;

	// Get text properties
	let Result = DrawingGetTextSize(Text, Width);
	Text = Result[0];
	MainCanvas.font = CommonGetFont(Result[1].toString());

	// Draw a back color relief text if needed
	if ((BackColor != null) && (BackColor != "")) {
		MainCanvas.fillStyle = BackColor;
		MainCanvas.fillText(Text, X + 1, Y + 1);
	}

	// Restores the font size
	MainCanvas.fillStyle = Color;
	MainCanvas.fillText(Text, X, Y);
	MainCanvas.font = CommonGetFont(36);
}

/**
 * Gets the text size needed to fit inside a given width according to the current font.
 * This function is memoized because <code>MainCanvas.measureText(Text)</code> is a major resource hog.
 * @param {string} Text - Text to draw
 * @param {number} Width - Width in which the text has to fit
 * @returns {[string, number]} - Text to draw and its font size
 */
const DrawingGetTextSize = CommonMemoize(
	/** @type {(Text: string, width: number) => [text: string, size: number]} */
	(Text, Width) => {
		// If it doesn't fit, test with smaller and smaller fonts until it fits
		let S;
		for (S = 36; S >= 10; S = S - 2) {
			MainCanvas.font = CommonGetFont(S.toString());
			const metrics = MainCanvas.measureText(Text);
			if (metrics.width <= Width)
				return [Text, S];
		}

		// Cuts the text if it would go over the box
		while (Text.length > 0) {
			Text = Text.substr(1);
			const metrics = MainCanvas.measureText(Text);
			if (metrics.width <= Width)
				return [Text, S];
		}

		// Things are FUBAR if this point is ever reached
		return [Text, S];
	});

/**
 * Draws a text element on the canvas
 * @param {string} Text - Text to draw
 * @param {number} X - Position of the text on the X axis
 * @param {number} Y - Position of the text on the Y axis
 * @param {string} Color - Color of the text
 * @param {string} [BackColor] - Color of the background
 * @returns {void} - Nothing
 */
function DrawText(Text, X, Y, Color, BackColor) {
	if (!Text) return;

	// Draw a back color relief text if needed
	if ((BackColor != null) && (BackColor != "")) {
		MainCanvas.fillStyle = BackColor;
		MainCanvas.fillText(Text, X + 1, Y + 1);
	}

	// Split the text on two lines if there's a |
	MainCanvas.fillStyle = Color;
	MainCanvas.fillText(Text, X, Y);

}

/**
 * Draws a button component
 * @param {number} Left - Position of the component from the left of the canvas
 * @param {number} Top - Position of the component from the top of the canvas
 * @param {number} Width - Width of the component
 * @param {number} Height - Height of the component
 * @param {string} Label - Text to display in the button
 * @param {string} Color - Color of the component
 * @param {null | string} [Image] - URL of the image to draw inside the button, if applicable
 * @param {null | string} [HoveringText] - Text of the tooltip, if applicable
 * @param {boolean} [Disabled] - Disables the hovering options if set to true
 * @param {null | Rect} [tooltipPosition] - The position of the tooltip
 * @returns {void} - Nothing
 */
function DrawButton(Left, Top, Width, Height, Label, Color, Image=null, HoveringText=null, Disabled=false, tooltipPosition=null) {

	ControllerAddActiveArea(Left, Top);

	// Draw the button rectangle (makes the background color cyan if the mouse is over it)
	MainCanvas.beginPath();
	MainCanvas.rect(Left, Top, Width, Height);
	MainCanvas.fillStyle = ((MouseX >= Left) && (MouseX <= Left + Width) && (MouseY >= Top) && (MouseY <= Top + Height) && !CommonIsMobile && !Disabled) ? "Cyan" : Color;
	MainCanvas.fillRect(Left, Top, Width, Height);
	MainCanvas.fill();
	MainCanvas.lineWidth = 2;
	MainCanvas.strokeStyle = 'black';
	MainCanvas.stroke();
	MainCanvas.closePath();

	// Draw the text or image
	DrawTextFit(Label, Left + Width / 2, Top + (Height / 2) + 1, Width - 4, "black");
	if ((Image != null) && (Image != "")) DrawImage(Image, Left + 2, Top + 2);

	// Draw the hovering text
	if ((HoveringText != null) && (MouseX >= Left) && (MouseX <= Left + Width) && (MouseY >= Top) && (MouseY <= Top + Height) && !CommonIsMobile && !CommonPhotoMode) {
		DrawHoverElements.push(() => {
			const rect = tooltipPosition ?? RectMakeRect(Left, Top, Width, Height);
			DrawButtonHover(...RectGetFrame(rect), HoveringText);
		});
	}
}

/**
 * Draws a checkbox component
 * @param {number} Left - Position of the component from the left of the canvas
 * @param {number} Top - Position of the component from the top of the canvas
 * @param {number} Width - Width of the component
 * @param {number} Height - Height of the component
 * @param {string} Text - Label associated with the checkbox
 * @param {boolean} IsChecked - Whether or not the checkbox is checked
 * @param {boolean} [Disabled] - Disables the hovering options if set to true
 * @param {string} [TextColor] - Color of the text
 * @returns {void} - Nothing
 */
function DrawCheckbox(Left, Top, Width, Height, Text, IsChecked, Disabled = false, TextColor = "Black", CheckImage = "Icons/Checked.png") {
	DrawText(Text, Left + 100, Top + 33, TextColor, "Gray");
	DrawButton(Left, Top, Width, Height, "", Disabled ? "#ebebe4" : "White", IsChecked ? CheckImage : "", null, Disabled);
}

/**
 * Draw a back & next button component
 * @param {number} Left - Position of the component from the left of the canvas
 * @param {number} Top - Position of the component from the top of the canvas
 * @param {number} Width - Width of the component
 * @param {number} Height - Height of the component
 * @param {string} Label - Text inside the component
 * @param {string} Color - Color of the component
 * @param {null | string} [Image] - Image URL to draw in the component
 * @param {null | (() => string)} [BackText] - Text for the back button tooltip
 * @param {null | (() => string)} [NextText] - Text for the next button tooltip
 * @param {boolean} [Disabled] - Disables the hovering options if set to true
 * @param {null | number} [ArrowWidth] - How much of the button the previous/next sections cover. By default, half each.
 * @param {null | Rect} [tooltipPosition] - The position of the tooltip
 * @returns {void} - Nothing
 */
function DrawBackNextButton(Left, Top, Width, Height, Label, Color, Image=null, BackText=null, NextText=null, Disabled=false, ArrowWidth=null, tooltipPosition=null) {
	// Set the widths of the previous/next sections to be colored cyan when hovering over them
	// By default each covers half the width, together covering the whole button
	if (ArrowWidth == null || ArrowWidth > Width / 2) ArrowWidth = Width / 2;
	const LeftSplit = Left + ArrowWidth;
	const RightSplit = Left + Width - ArrowWidth;

	ControllerAddActiveArea(Left, Top);
	ControllerAddActiveArea(Left + Width - ArrowWidth, Top);

	MainCanvas.save();
	MainCanvas.textAlign = "center";

	// Draw the button rectangle
	MainCanvas.beginPath();
	MainCanvas.rect(Left, Top, Width, Height);
	MainCanvas.fillStyle = Color;
	MainCanvas.fillRect(Left, Top, Width, Height);
	if (MouseIn(Left, Top, Width, Height) && !CommonIsMobile && !Disabled) {
		MainCanvas.fillStyle = "Cyan";
		if (MouseX > RightSplit) {
			MainCanvas.fillRect(RightSplit, Top, ArrowWidth, Height);
		}
		else if (MouseX <= LeftSplit) {
			MainCanvas.fillRect(Left, Top, ArrowWidth, Height);
		} else {
			MainCanvas.fillRect(Left + ArrowWidth, Top, Width - ArrowWidth * 2, Height);
		}
	}
	else if (CommonIsMobile && ArrowWidth < Width / 2 && !Disabled) {
		// Fill in the arrow regions on mobile
		MainCanvas.fillStyle = "lightgrey";
		MainCanvas.fillRect(Left, Top, ArrowWidth, Height);
		MainCanvas.fillRect(RightSplit, Top, ArrowWidth, Height);
	}
	MainCanvas.lineWidth = 2;
	MainCanvas.strokeStyle = 'black';
	MainCanvas.stroke();
	MainCanvas.closePath();

	// Draw the text or image
	DrawTextFit(Label, Left + Width / 2, Top + (Height / 2) + 1, (CommonIsMobile) ? Width - 6 : Width - 36, "Black");
	if ((Image != null) && (Image != "")) DrawImage(Image, Left + 2, Top + 2);

	ControllerAddActiveArea(Left + Width / 2, Top);

	// Draw the back arrow
	MainCanvas.beginPath();
	MainCanvas.fillStyle = "black";
	MainCanvas.moveTo(Left + 15, Top + Height / 5);
	MainCanvas.lineTo(Left + 5, Top + Height / 2);
	MainCanvas.lineTo(Left + 15, Top + Height - Height / 5);
	MainCanvas.stroke();
	MainCanvas.closePath();

	// Draw the next arrow
	MainCanvas.beginPath();
	MainCanvas.fillStyle = "black";
	MainCanvas.moveTo(Left + Width - 15, Top + Height / 5);
	MainCanvas.lineTo(Left + Width - 5, Top + Height / 2);
	MainCanvas.lineTo(Left + Width - 15, Top + Height - Height / 5);
	MainCanvas.stroke();
	MainCanvas.closePath();

	MainCanvas.restore();

	// Draw the hovering text on the PC
	if (CommonIsMobile) return;
	if (BackText == null) BackText = () => "MISSING VALUE FOR: BACK TEXT";
	if (NextText == null) NextText = () => "MISSING VALUE FOR: NEXT TEXT";
	if ((MouseX >= Left) && (MouseX <= Left + Width) && (MouseY >= Top) && (MouseY <= Top + Height) && !Disabled) {
		DrawHoverElements.push(() => {
			const tooltip = MouseX < LeftSplit ? BackText() : MouseX >= RightSplit ? NextText() : "";
			const rect = tooltipPosition ?? RectMakeRect(Left, Top, Width, Height);
			DrawButtonHover(...RectGetFrame(rect), tooltip);
		});
	}
}

/**
 * Draw the hovering text tooltip
 * @param {number} Left - Position of the tooltip from the left of the canvas
 * @param {number} Top - Position of the tooltip from the top of the canvas
 * @param {number} Width - Width of the tooltip
 * @param {number} Height - Height of the tooltip
 * @param {string} HoveringText - Text to display in the tooltip
 * @returns {void} - Nothing
 */
function DrawButtonHover(Left, Top, Width, Height, HoveringText) {
	if ((HoveringText != null) && (HoveringText != "")) {
		Left = (MouseX > 1000) ? Left - 475 : Left + Width + 25;
		Top = Top + (Height - 65) / 2;
		MainCanvas.save();
		MainCanvas.textAlign = "center";
		MainCanvas.beginPath();
		MainCanvas.rect(Left, Top, 450, 65);
		MainCanvas.fillStyle = "#FFFF88";
		MainCanvas.fillRect(Left, Top, 450, 65);
		MainCanvas.fill();
		MainCanvas.lineWidth = 2;
		MainCanvas.strokeStyle = 'black';
		MainCanvas.stroke();
		MainCanvas.closePath();
		DrawTextFit(HoveringText, Left + 225, Top + 33, 444, "black");
		MainCanvas.restore();
	}
}

/**
 * Draws a basic empty rectangle with a colored outline
 * @param {number} Left - Position of the rectangle from the left of the canvas
 * @param {number} Top - Position of the rectangle from the top of the canvas
 * @param {number} Width - Width of the rectangle
 * @param {number} Height - Height of the rectangle
 * @param {string} Color - Color of the rectangle outline
 * @param {number} [Thickness=3] - Thickness of the rectangle line
 * @returns {void} - Nothing
 */
function DrawEmptyRect(Left, Top, Width, Height, Color, Thickness = 3) {
	MainCanvas.beginPath();
	MainCanvas.rect(Left, Top, Width, Height);
	MainCanvas.lineWidth = Thickness;
	MainCanvas.strokeStyle = Color;
	MainCanvas.stroke();
}

/**
 * Draws a basic rectangle filled with a given color
 * @param {number} Left - Position of the rectangle from the left of the canvas
 * @param {number} Top - Position of the rectangle from the top of the canvas
 * @param {number} Width - Width of the rectangle
 * @param {number} Height - Height of the rectangle
 * @param {string} Color - Color of the rectangle
 * @returns {void} - Nothing
 */
function DrawRect(Left, Top, Width, Height, Color) {
	MainCanvas.beginPath();
	MainCanvas.fillStyle = Color;
	MainCanvas.fillRect(Left, Top, Width, Height);
	MainCanvas.fill();
}

/**
 * Draws a basic circle
 * @param {number} CenterX - Position of the center of the circle on the X axis
 * @param {number} CenterY - Position of the center of the circle on the Y axis
 * @param {number} Radius - Radius of the circle to draw
 * @param {number} LineWidth - Width of the line
 * @param {string} LineColor - Color of the circle's line
 * @param {string} [FillColor] - Color of the space inside the circle
 * @param {CanvasRenderingContext2D} [Canvas] - The canvas element to draw onto, defaults to MainCanvas
 * @returns {void} - Nothing
 */
function DrawCircle(CenterX, CenterY, Radius, LineWidth, LineColor, FillColor, Canvas) {
	if (!Canvas) Canvas = MainCanvas;
	Canvas.beginPath();
	Canvas.arc(CenterX, CenterY, Radius, 0, 2 * Math.PI, false);
	if (FillColor) {
		Canvas.fillStyle = FillColor;
		Canvas.fill();
	}
	Canvas.lineWidth = LineWidth;
	Canvas.strokeStyle = LineColor;
	Canvas.stroke();
}

/**
 * Draws a progress bar with color
 * @param {number} x - Position of the bar on the X axis
 * @param {number} y - Position of the bar on the Y axis
 * @param {number} w - Width of the bar
 * @param {number} h - Height of the bar
 * @param {number} value - Current progress to display on the bar
 * @param {string} [foreground="#66FF66"] - Color of the first part of the bar
 * @param {string} [background="red"] - Color of the bar background
 * @returns {void} - Nothing
 */
function DrawProgressBar(x, y, w, h, value, foreground = "#66FF66", background = "red") {
	if (value < 0) value = 0;
	if (value > 100) value = 100;
	DrawRect(x, y, w, h, "white");
	DrawRect(x + 2, y + 2, Math.floor((w - 4) * value / 100), h - 4, foreground);
	DrawRect(Math.floor(x + 2 + (w - 4) * value / 100), y + 2, Math.floor((w - 4) * (100 - value) / 100), h - 4, background);
}

/**
 * Draws two lines, from one point to a second point then to a third point
 * @param {number} x0 - X co-ordinate of starting point
 * @param {number} y0 - Y co-ordinate of starting point
 * @param {number} x1 - X co-ordinate of mid point
 * @param {number} y1 - Y co-ordinate of mid point
 * @param {number} x2 - X co-ordinate of end point
 * @param {number} y2 - Y co-ordinate of end point
 * @param {number} lineWidth - The width of the lines
 * @param {string} color - The color of the lines
 * @returns {void} - Nothing
 */
function DrawLineCorner(x0, y0, x1, y1, x2, y2, lineWidth = 2, color = "black") {
	MainCanvas.beginPath();
	MainCanvas.lineWidth = lineWidth;
	MainCanvas.moveTo(x0, y0);
	MainCanvas.lineTo(x1, y1);
	MainCanvas.lineTo(x2, y2);
	MainCanvas.strokeStyle = color;
	MainCanvas.stroke();
}

/**
 * Gets a character's custom background from the assets it wears
 *
 * @param {Character} C - The character to get the background for
 * @returns {string | undefined} either `undefined` for no custom background, `""` for black, or
 * the filename to a background in the Backgrounds directory
 */
function DrawGetCustomBackground(C) {
	return C?.CustomBackground;
}

/**
 * Draws a background image onto the MainCanvas, applying zoom and visual effects
 * @param {string} URL The background image to use
 * @param {Rect} bounds The location to draw the background in
 * @param {object} [opts] The background drawing options
 * @param {boolean} [opts.inverted=false] Whether the background should be flipped upside-down
 * @param {number} [opts.blur=1.0] How blurry the background is
 * @param {number} [opts.darken=0.0] How darkened the background is (1 is bright, 0 is pitch black)
 * @param {readonly RGBAColor[]} [opts.tints] Tints to apply to the background
 * @param {DrawingResizeMode} [opts.sizeMode] The method of resizing the background
 */
function DrawRoomBackground(URL, bounds, opts) {
	let { inverted, blur, darken, tints, sizeMode } = opts ?? {};

	inverted ??= false;
	blur ??= 0.0;
	darken ??= 1.0;
	tints ??= [];
	sizeMode ??= DrawingResizeMode.FillOriginalRatio;

	const img = URL !== "" ? DrawGetImage(URL) : undefined;
	if (darken > 0 && img) {
		// Sets the blur level
		if (blur > 0) {
			MainCanvas.filter = `blur(${blur}px)`;
		}

		// Draw the background and custom filter
		const imageBounds = RectMakeRect(img.x, img.y, img.naturalWidth, img.naturalHeight);
		const [sourceRect, destRect] = RectFitIntoRect(imageBounds, bounds, sizeMode);

		DrawImageZoomCanvas(URL, MainCanvas, ...sourceRect, ...destRect, inverted);

		if (CurrentScreen === "ChatRoom" && ChatRoomIsCustomized() && ChatRoomData?.Custom?.ImageFilter) {
			DrawRect(...destRect, ChatRoomData.Custom.ImageFilter);
		}

		// Resetting the filter is expensive, even if there's no change. Only change the filter if we need to.
		if (blur > 0) {
			MainCanvas.filter = 'none';
		}

		// Draw an overlay if the character is partially blinded
		if (darken < 1) {
			DrawRect(bounds.x, bounds.y, bounds.w, bounds.h, "rgba(0,0,0," + (1 - darken) + ")");
		}
	} else {
		// Draw black rect to prevent overdraw if the actual image isn't ready
		DrawRect(...RectGetFrame(bounds), "#000");
	}

	for (const { r, g, b, a } of tints) {
		DrawRect(bounds.x, bounds.y, bounds.w, bounds.h, `rgba(${r},${g},${b},${a})`);
	}
}

/**
 * Perform a global screen flash effect when a blindfold gets removed
 * @param {number} intensity - The player's blind level before the removal
 * TODO: that should be merged with DrawScreenFlash somehow
 */
function DrawBlindFlash(intensity) {
	DrawingBlindFlashTimer = CurrentTime + 2000 * intensity;
	BlindFlash = true;
}

var DrawScreenFlashTime = 0;
/** @type {null | string} */
var DrawScreenFlashColor = null;
var DrawScreenFlashStrength = 140;

/**
 * Perform a global screen flash effect
 * @param {string} Color - The color to use
 * @param {number} Duration - How long should the flash effect be applied, in ms
 * @param {number} Intensity - How important is the effect visually
 */
function DrawFlashScreen(Color, Duration, Intensity) {
	DrawScreenFlashTime = CommonTime() + Duration;
	DrawScreenFlashColor = Color;
	DrawScreenFlashStrength = Intensity;
}

/**
 * Gets the alpha of a screen flash. append to a color like "#111111" + DrawGetScreenFlash(FlashTime)
 * @param {number} FlashTime - Time remaining as part of the screen flash
 * @returns {string} - alpha of screen flash
 */
function DrawGetScreenFlashAlpha(FlashTime) {
	let alpha = Math.max(0, Math.min(255, Math.floor(DrawScreenFlashStrength * (1 - Math.exp(-FlashTime / 2500))))).toString(16);
	if (alpha.length < 2) alpha = "0" + alpha;
	return alpha;
}

/**
 * Gets how dark the screen should be.
 *
 * The darkness factor varies with blindness level. Some screens also have
 * a natural darkening effect on them.
 *
 * @returns {number} 1 is bright, 0 is pitch black
 */
function DrawGetDarkFactor() {
	let darken = CharacterGetDarkFactor(Player);
	if (darken == 1 && CurrentCharacter != null && !CommonPhotoMode) darken = 0.5;

	const isItemBG = DrawGetCustomBackground(Player) !== undefined;
	if (isItemBG && (darken === 0.0 || Player.GameplaySettings.SensDepChatLog == "SensDepLight")) {
		darken = CharacterGetDarkFactor(Player, true);
	}

	// Apply screen darken
	darken *= CurrentDarkFactor;

	return darken;
}

/**
 * Display the loading screen
 * @param {number} time - The current time for frame
 */
function DrawLoadingScreen(time) {
	DrawClearRect(MainCanvas, 0, 0, MainCanvasWidth, MainCanvasHeight);
	const msg = InterfaceTextGet("ScreenLoading");
	if (msg.startsWith("MISSING")) return;
	MainCanvas.save();
	MainCanvas.textAlign = "left";
	DrawText(msg, MainCanvasWidth / 2 - 160, MainCanvasHeight / 2, "White", "Gray");
	MainCanvas.textAlign = "center";
	const loadingMsg = ".".repeat((time / 1000) % 7);
	DrawText(loadingMsg, MainCanvasWidth / 2, MainCanvasHeight / 2 + ChatRoomFontSize, "White", "Gray");
	MainCanvas.restore();
}

/**
 *
 * @param {boolean} skipVFX
 * @returns {undefined | string}
 */
function DrawGetBackgroundURL(skipVFX) {
	let bgName = window[`${CurrentScreen}Background`];

	const itemBackground = DrawGetCustomBackground(Player);
	if (!skipVFX && itemBackground !== undefined) {
		return itemBackground !== "" ? `Backgrounds/${itemBackground}.jpg` : "";
	} else if (CurrentScreen === "ChatRoom") {
		if (ChatRoomIsCustomized() && ChatRoomData?.Custom?.ImageURL) {
			return ChatRoomData?.Custom.ImageURL;
		} else if (ChatRoomData) {
			return `Backgrounds/${ChatRoomData.Background}.jpg`;
		}
	} else if (bgName) {
		return `Backgrounds/${bgName}.jpg`;
	}
	return undefined;
}

/** Namespace for managing the skipping of VFX drawing */
var DrawSkipVFX = {
	/**
	 * The list of registered callbacks; see {@link DrawSkipVFX.evaluate}.
	 * @readonly
	 * @private
	 * @type {((module: ModuleType, screen: ScreenName) => boolean)[]}
	 */
	_list: [],

	/**
	 * Register either a function or a module and/or screen name for which VFX drawing must be skipped
	 * @param  {...(PartialScreenSpecifier | ((module: ModuleType, screen: ScreenName) => boolean))} args The to-be registered functions/screen-/module names
	 */
	register: function register(...args) {
		for (const arg of args) {
			if (typeof arg === "function") {
				DrawSkipVFX._list.push(arg);
			} else {
				const { module, screen } = arg;
				if (module == null) {
					DrawSkipVFX._list.push((moduleArg, screenArg) => screen === screenArg);
				} else if (screen == null) {
					DrawSkipVFX._list.push((moduleArg, screenArg) => module === moduleArg);
				} else {
					DrawSkipVFX._list.push((moduleArg, screenArg) => module === moduleArg && screen === screenArg);
				}
			}
		}
	},

	/**
	 * Evaluate whether VFX drawing must be skipped for the passed module and screen
	 * @param {ModuleType} module The module
	 * @param {ScreenName} screen The screen within the module
	 * @returns {boolean} Whether VFX drawing must be skipped
	 */
	evaluate: function evaluate(module, screen) {
		return DrawSkipVFX._list.some(func => func(module, screen));
	},
};

DrawSkipVFX.register(
	{ module: "Character" },
	{ screen: "Crafting" },
	{ screen: "Wardrobe" },
	{ screen: "Shop2" },
	{ screen: "MaidCleaning" }, // does it's own darkening
	(_, screen) => window[`${screen}Background`] === "Sheet",
);

/**
 * Constantly looping draw process. Draws beeps, handles the screen size, handles the current blindfold state and draws the current screen.
 * @param {number} time - The current time for frame
 * @returns {void} - Nothing
 */
function DrawProcess(time) {
	if (ScreenIsLoading) {
		DrawLoadingScreen(time);
		return;
	}
	// Clear the list of characters that were drawn last frame
	DrawLastCharacters = [];

	// ChatRoom handles its own background drawing.
	// We do need to draw the full-width background when a dialog is running and it's not handled by ChatAdminRoomCustomizationProcess
	if (!DrawShowChatRoomCustomBackground()) {
		// Some screens never display visual effects
		const skipVFX = DrawSkipVFX.evaluate(CurrentModule, CurrentScreen);
		const backgroundURL = DrawGetBackgroundURL(skipVFX);
		if (backgroundURL != null) {
			/** @type {{ blur?: number, inverted?: boolean, darken?: number, tints?: readonly RGBAColor[] }} */
			const bgOptions = {};
			if (!skipVFX) {
				bgOptions.blur = Player.GetBlurLevel();
				bgOptions.inverted = Player.GraphicsSettings && Player.GraphicsSettings.InvertRoom && Player.IsInverted();
				bgOptions.darken = DrawGetDarkFactor();
				bgOptions.tints = Player.GetTints();
			}
			const rect = RectMakeRect(0, 0, MainCanvasWidth, MainCanvasHeight);
			DrawRoomBackground(backgroundURL, rect, bgOptions);
		}
	}

	// Draws the dialog screen or current screen if there's no loaded character
	if (CurrentCharacter != null) DialogDraw();
	else {
		CurrentScreenFunctions.Run(time);
		CurrentScreenFunctions.Draw();
	}

	// Handle screen flash effects
	DrawProcessScreenFlash();

	// Draw Hovering text so they can be above everything else
	DrawProcessHoverElements();

	// Draw a marker for the controller's position
	if (ControllerIsActive()) {
		DrawRect(MouseX - 5, MouseY - 5, 10, 10, "Red");
	}

	// Checks for screen resize/position change and calls appropriate function
	/** @type {RectTuple} */
	const newCanvasPosition = [MainCanvas.canvas.offsetLeft, MainCanvas.canvas.offsetTop, MainCanvas.canvas.clientWidth, MainCanvas.canvas.clientHeight];
	if (!CommonArraysEqual(newCanvasPosition, DrawCanvasPosition)) {
		DrawCanvasPosition = newCanvasPosition;
		if (CurrentCharacter != null) {
			DialogResize(false);
		} else {
			CurrentScreenFunctions.Resize(false);
		}
	}

	// Leave dialogs AFTER drawing everything
	// If needed
	// Used to support items that remove you from the dialog during the draw phase
	if (DialogLeaveDueToItem) {
		DialogLeaveDueToItem = false;
		DialogLeave();
	}

}

/**
 * Returns whether a chat room data custom background will be shown
 * @returns {boolean}
 */
function DrawShowChatRoomCustomBackground() {
	return CurrentModule === "Online"
		&& CurrentScreen === "ChatRoom"
		&& (!CurrentCharacter || (!!ChatRoomData?.Custom?.ImageURL && DrawGetCustomBackground(Player) !== undefined));
}

/**
 * Handles drawing the screen flash effects
 * @returns {void}
 */
function DrawProcessScreenFlash() {
	if (BlindFlash == true && CurrentTime < DrawingBlindFlashTimer) {
		if (Player.GetBlindLevel() == 0) {
			let FlashTime = DrawingBlindFlashTimer - CurrentTime;
			DrawRect(0, 0, 2000, 1000, "#ffffff" + DrawGetScreenFlashAlpha(FlashTime / Math.max(1, 4 - DrawLastDarkFactor)));
		}
	}

	if (Player.ImmersionSettings.StimulationEvents && Player.GraphicsSettings.StimulationFlash && DrawScreenFlashTime > CommonTime()) {
		// DrawScreenFlashTime is the end of the flash. The flash is brighter based on the distance to the end.
		let FlashTime = DrawScreenFlashTime - CommonTime();
		let PinkFlashAlpha = DrawGetScreenFlashAlpha(FlashTime);
		DrawRect(0, 0, 2000, 1000, DrawScreenFlashColor + PinkFlashAlpha);
	}
}

/**
 * Draws every element that is considered a "hover" element such has button tooltips.
 * @returns {void} - Nothing
 */
function DrawProcessHoverElements() {
	while (DrawHoverElements.length) {
		const func = DrawHoverElements.shift();
		if (typeof func === "function") {
			func();
		}
	}
}

/**
 *
 * @param {Item | DialogInventoryItem} itemOrDialogItem
 * @param {Character} char - The character using the item (used to calculate dynamic item descriptions/previews)
 * @param {number} X
 * @param {number} Y
 * @param {PreviewDrawOptions} [options]
 */
function DrawItemPreview(itemOrDialogItem, char, X, Y, options) {
	const item = itemOrDialogItem;
	// Now we act like this is a real DialogInventoryItem, reusing its properties or generating them otherwise

	const Vibrating = !("Vibrating" in item) ? InventoryItemHasEffect(item, "Vibrating", true) : item.Vibrating;
	/** @type {InventoryIcon[]} */
	let Icons = [];
	if (!("Icons" in item)) {
		// We're an item, so it makes sense to default to "worn"
		Icons = Icons.concat(DialogGetLockIcon(item, true));
		Icons = Icons.concat(DialogGetAssetIcons(item.Asset));
		Icons = Icons.concat(DialogEffectIcons.GetIcons(item));
	} else {
		Icons = item.Icons;
	}

	const Description = item.Craft && item.Craft.Name != "" ? item.Craft.Name : null;
	options = Object.assign({}, options, { C: char, Icons, Vibrating, Description });
	DrawAssetPreview(X, Y, item.Asset, options);
}

/**
 * Draws an asset's preview box
 * @param {number} X - Position of the preview box on the X axis
 * @param {number} Y - Position of the preview box on the Y axis
 * @param {Asset} A - The asset to draw the preview for
 * @param {PreviewDrawOptions} [Options] - Additional optional drawing options
 * @returns {void} - Nothing
 */
function DrawAssetPreview(X, Y, A, Options) {
	let { C, Description, Background, Foreground, Vibrating, Border, Hover, HoverBackground, Disabled, Icons, Width, Height } = (Options || {});

	const DynamicPreviewImage = C ? A.DynamicPreviewImage(C) : "";
	let Path = `${AssetGetPreviewPath(A)}/${A.Name}${DynamicPreviewImage}.png`;

	if (CharacterAppearanceItemIsHidden(A.Name, A.DynamicGroupName || A.Group.Name))
		Path = "Icons/HiddenItem.png";

	if (Description == null) Description = C ? A.DynamicDescription(C) : A.Description;

	DrawPreviewBox(X, Y, Path, Description, { Background, Foreground, Vibrating, Border, Hover, HoverBackground, Disabled, Icons, Width, Height });
}

/** The default width of item previews */
const DrawAssetPreviewDefaultWidth = 225;
/** The default height of item previews */
const DrawAssetPreviewDefaultHeight = 275;

/**
 * Draws an item preview box for the provided image path
 * @param {number} X - Position of the preview box on the X axis
 * @param {number} Y - Position of the preview box on the Y axis
 * @param {string} Path - The path of the image to draw
 * @param {string} Description - The preview box description
 * @param {PreviewDrawOptions} [Options] - Additional optional drawing options
 * @returns {void} - Nothing
 */
function DrawPreviewBox(X, Y, Path, Description, Options) {
	let { Background, Foreground, Vibrating, Border, Hover, HoverBackground, Disabled, Icons, Width, Height } = (Options || {});
	Width = Width || DrawAssetPreviewDefaultWidth;
	Height = Height || DrawAssetPreviewDefaultHeight;

	const Padding = 2;
	// Only reserve space if we have text to draw
	const TextGutter = (Description ? 44 : 0);

	// Default background and foreground colors
	Background = Background || "#fff";
	Foreground = Foreground || "#000";
	if (Disabled === true) Background = "#888";
	else if (Hover && MouseHovering(X, Y, Width, Height)) Background = (HoverBackground || "cyan");

	// Do a bunch of math to keep the image scaled
	let ImageX = X + Padding;
	let ImageY = Y + Padding;
	let ImageWidth = Width;
	let ImageHeight = Height - TextGutter;

	if (ImageWidth > ImageHeight) {
		const Ratio = ImageHeight / ImageWidth;
		ImageWidth *= Ratio;
		ImageX += (Width - ImageWidth) / 2;
	} else if (ImageWidth < ImageHeight) {
		const Ratio = ImageWidth / ImageHeight;
		ImageHeight *= Ratio;
		ImageY += (Height - ImageHeight - TextGutter) / 2;
	}

	ImageWidth -= 2 * Padding;
	ImageHeight -= 2 * Padding;

	if (Vibrating) {
		ImageX += 1 + Math.floor(Math.random() * 3);
		ImageY += 1 + Math.floor(Math.random() * 3);
	}

	// Now draw the preview box
	DrawRect(X, Y, Width, Height, Background);
	ControllerAddActiveArea(X, Y);
	if (Border) DrawEmptyRect(X, Y, Width, Height, Foreground);
	// DrawRect(ImageX, ImageY, ImageWidth, ImageHeight, "pink"); // Debug rect
	if (Path !== "") DrawImageResize(Path, ImageX, ImageY, ImageWidth, ImageHeight);
	DrawPreviewIcons(Icons ?? [], X, Y);
	if (Description) DrawTextFit(Description, X + Width / 2, Y + Height - 25, Width - 2 * Padding, Foreground);
}

/**
 * Draws a list of small icons over a preview box
 * @param {readonly InventoryIcon[]} icons - An array of icon names
 * @param {number} X - The X co-ordinate to start drawing from
 * @param {number} Y - The Y co-ordinate to start drawing from
 * @returns {void} - Nothing
 */
function DrawPreviewIcons(icons, X, Y) {
	if (icons && icons.length) {
		const iconsPerCol = 4;
		const iconSize = 50;
		icons.forEach((icon, index) => {
			const iconX = X + (iconSize + 5) * Math.floor(index / iconsPerCol);
			const iconY = Y + (iconSize + 5) * (index % iconsPerCol);
			let path = `Icons/Previews/${icon}.png`;
			let text = InterfaceTextGet("PreviewIcon" + icon);
			if (icon.endsWith("Padlock")) {
				path = `Assets/Female3DCG/ItemMisc/Preview/${icon}.png`;
				text = InterfaceTextGet("PreviewIconPadlock").replace("AssetName", AssetGet("Female3DCG", "ItemMisc", icon)?.Description ?? "AssetName");
			}
			DrawImageResize(path, iconX, iconY, iconSize, iconSize);
			if (MouseIn(iconX, iconY, iconSize * 0.9, iconSize * 0.9)) {
				DrawHoverElements.push(() => DrawButtonHover(iconX, iconY, 100, 65, text));
			}
		});
	}
}

/**
 * Draws an item preview box using the provided canvas
 * @param {number} X - Position of the preview box on the X axis
 * @param {number} Y - Position of the preview box on the Y axis
 * @param {HTMLCanvasElement} Canvas - The canvas element containing the image to draw
 * @param {string} Description - The preview box description
 * @param {PreviewDrawOptions} Options - Additional optional drawing options
 * @returns {void} - Nothing
 */
function DrawCanvasPreview(X, Y, Canvas, Description, Options) {
	DrawPreviewBox(X, Y, "", Description, Options);
	MainCanvas.drawImage(Canvas, X + 2, Y + 2, 221, 221);
}

/**
 * Returns a rectangular subsection of a canvas
 * @param {null | HTMLCanvasElement} Canvas - The source canvas to take a section of
 * @param {number} Left - The starting X co-ordinate of the section
 * @param {number} Top - The starting Y co-ordinate of the section
 * @param {number} Width - The width of the section to take
 * @param {number} Height - The height of the section to take
 * @returns {HTMLCanvasElement} - The new canvas containing the section
 */
function DrawCanvasSegment(Canvas, Left, Top, Width, Height) {
	TempCanvas.canvas.width = Width;
	TempCanvas.canvas.height = Height;
	TempCanvas.clearRect(0, 0, Width, Height);
	if (Canvas) {
		TempCanvas.drawImage(Canvas, Left, Top, Width, Height, 0, 0, Width, Height);
	}
	return TempCanvas.canvas;
}

/**
 * Returns a rectangular subsection of the character image
 * @param {Character} C - The character to copy part of
 * @param {number} Left - The starting X co-ordinate of the section
 * @param {number} Top - The starting Y co-ordinate of the section
 * @param {number} Width - The width of the section to take
 * @param {number} Height - The height of the section to take
 * @returns {HTMLCanvasElement} - The new canvas containing the section
 */
function DrawCharacterSegment(C, Left, Top, Width, Height) {
	if (C.MustDraw) {
		CharacterRefresh(C, false, false);
	}
	return DrawCanvasSegment(C.Canvas, Left, Top + CanvasUpperOverflow, Width, Height);
}

/**
 * Draws a source canvas or image onto a canvas, with a shear transformation (such that the width of the top and
 * bottom are different). If the `topToBottomRatio` is greater than 1, then the bottom edge of the image will be
 * smaller in the original image. If it's less than 1, then the top edge will be smaller than in the original (like the
 * Star Wars title text transform).
 *
 * @param {HTMLCanvasElement | HTMLImageElement} image - The source image
 * @param {HTMLCanvasElement} targetCanvas - The target canvas to draw the transformed image onto
 * @param {number} topToBottomRatio - The ratio between the desired length of the top edge and the bottom edge of the
 * final image.
 * @param {number} [x] - The x-position on the target canvas that the final image should be drawn at
 * @param {number} [y] - The y-position on the target canvas that the final image should be drawn at
 */
function DrawImageTrapezify(image, targetCanvas, topToBottomRatio, x = 0, y = 0) {
	const { width, height } = image;
	let xStartTop = 0;
	let xStartBottom = 0;

	if (topToBottomRatio > 1) {
		const bottomToTopRatio = 1 / topToBottomRatio;
		xStartBottom = (width * (1 - bottomToTopRatio)) / 2;
	} else {
		xStartTop = (width * (1 - topToBottomRatio)) / 2;
	}

	const targetCtx = targetCanvas.getContext("2d");

	for (let i = 0; i < height; i++) {
		const s = i / height;
		const xStart = (xStartTop * (1 - s) + xStartBottom * s);
		targetCtx?.drawImage(image, 0, i, width, 1, x + xStart, y + i, width - xStart * 2, 1);
	}
}

/**
 * Make a new rect from a 4-tuple
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {Rect}
 */
function RectMakeRect(x, y, w, h) {
	return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

/**
 * Convert a rect into a 4-tuple
 * @param {Rect} rect
 * @returns {RectTuple}
 */
function RectGetFrame(rect) {
	return [rect.x, rect.y, rect.w, rect.h];
}

/**
 * Get the rect's origin point
 * @param {Rect | RectTuple} rect
 * @return {[x: number, y: number]}
 */
function RectGetOrigin(rect) {
	return Array.isArray(rect) ? [rect[0], rect[1]] : [rect.x, rect.y];
}

/**
 * Offsets a rect by the given amount
 * @param {Rect} rect
 * @param {number} dX
 * @param {number} dY
 * @returns {Rect}
 */
function RectOffset(rect, dX, dY) {
	return RectMakeRect(rect.x + dX, rect.y + dY, rect.w, rect.h);
}

/**
 * Scale a rect in one direction
 * @param {Rect} rect
 * @param {number} wScale
 * @param {number} hScale
 * @returns {Rect}
 */
function RectScale(rect, wScale, hScale) {
	return RectMakeRect(rect.x, rect.y, rect.w * wScale, rect.h * hScale);
}

/**
 * Transform a rectangle to fit partially or wholly inside another. E.g. an image onto a background canvas
 * @param {Rect} sourceRect Source rectangle, to be resized and/or trimmed
 * @param {Rect} destRect Destination rectangle, the available space to contain the result
 * @param {DrawingResizeMode} sizeMode - How to transform sourceRect - whether to keep original aspect ratio and allow/prevent overflow
 * @returns {[RectTuple, RectTuple]} The subsection of the sourceRect to take and the rectangle to map it to
 */
const RectFitIntoRect = CommonMemoize(
	/** @type {(sourceRect: Rect, destRect: Rect, sizeMode: DrawingResizeMode) => [sourceRectTuple: RectTuple, destRectTuple: RectTuple]} */
	(sourceRect, destRect, sizeMode) => {
		if (sizeMode == DrawingResizeMode.Fill) {
			return [RectGetFrame(sourceRect), RectGetFrame(destRect)];
		}

		let sourceX, sourceY, sourceW, sourceH, destX, destY, destW, destH;

		let fitByWidth;
		if (sizeMode == DrawingResizeMode.ShowFullOriginalRatio) {
			fitByWidth = sourceRect.w / sourceRect.h >= destRect.w / destRect.h;
		} else {
			fitByWidth = sourceRect.w / sourceRect.h <= destRect.w / destRect.h;
		}

		if (fitByWidth) {
			const resizeFactor = destRect.w / sourceRect.w;
			const sourceYOffsetFactor = sourceRect.w > sourceRect.h ? 1 : 2; //allows landscape images to zoom towards the "floor"

			sourceX = sourceRect.x;
			sourceY = sourceRect.y + Math.max(sourceRect.h - (destRect.h / resizeFactor), 0) / sourceYOffsetFactor;
			sourceW = sourceRect.w;
			sourceH = Math.min(sourceRect.h, destRect.h / resizeFactor);
			destX = destRect.x;
			destY = destRect.y + Math.max(destRect.h - sourceRect.h * resizeFactor, 0) / 2;
			destW = destRect.w;
			destH = Math.min(sourceRect.h * resizeFactor, destRect.h);
		} else {
			const resizeFactor = destRect.h / sourceRect.h;

			sourceX = sourceRect.x + Math.max(sourceRect.w - (destRect.w / resizeFactor), 0) / 2;
			sourceY = sourceRect.y;
			sourceW = Math.min(sourceRect.w, destRect.w / resizeFactor);
			sourceH = sourceRect.h;
			destX = destRect.x + Math.max(destRect.w - sourceRect.w * resizeFactor, 0) / 2;
			destY = destRect.y;
			destW = Math.min(sourceRect.w * resizeFactor, destRect.w);
			destH = destRect.h;
		}

		/** @type {RectTuple} */
		const sourceRectTuple = [sourceX, sourceY, sourceW, sourceH];
		/** @type {RectTuple} */
		const destRectTuple = [destX, destY, destW, destH];

		return [sourceRectTuple, destRectTuple];
	});
