// Independently written model of BC's public rendering/cache behavior for offline tests.
// Observed source (not distributed here):
// https://gitgud.io/BondageProjects/Bondage-College/-/tree/02a7130050fcce7c96fcebf252b39dbbc1b0f1ed/BondageClub/Scripts
// Drawing.js, GLDraw.js, Appearance.js; version 2026-09-24.
// Set VPW_BC_SOURCE_DIR to a local Scripts directory to run against the actual functions.

function DrawGetImage(url) {
  if (DrawCacheImage.has(url)) return DrawCacheImage.get(url);
  const image = new Image();
  DrawCacheImage.set(url, image);
  const asset = url.includes('Assets');
  if (asset) image.addEventListener('load', () => DrawGetImageOnLoad(image));
  image.addEventListener('error', () => DrawGetImageOnError(image, asset));
  image.crossOrigin = 'anonymous';
  image.src = url;
  return image;
}

function DrawGetImageOnLoad(image) {
  DrawRefreshCharacterForImage(image);
}

function DrawGetImageOnError(image, asset) {
  image.errorcount = (image.errorcount || 0) + 1;
  if (image.errorcount >= 3) {
    if (asset) DrawRefreshCharacterForImage(null);
    return;
  }
  image.src = image.src;
  if (image.errorcount === 2) image.crossOrigin = null;
}

function GLDrawLoadImage(gl, url) {
  if (gl.textureCache.has(url)) return gl.textureCache.get(url);
  const texture = { texture: gl.createTexture(), width: 1, height: 1 };
  gl.textureCache.set(url, texture);
  if (GLDrawImageCache.has(url)) {
    GLDrawBingImageToTextureInfo(gl, GLDrawImageCache.get(url), texture);
    return texture;
  }
  const image = new Image();
  GLDrawImageCache.set(url, image);
  image.addEventListener('load', () => {
    GLDrawBingImageToTextureInfo(gl, image, texture);
    DrawRefreshCharacterForImage(image);
  });
  image.addEventListener('error', () => {
    image.errorcount = (image.errorcount || 0) + 1;
    if (image.errorcount >= 3) DrawRefreshCharacterForImage(image);
    else image.src = image.src;
  });
  image.src = url;
  return texture;
}

function CharacterAppearanceBuildCanvas(character) {
  const useGL = GLVersion !== 'No WebGL' && GLDrawCanvas && GLDrawCanvas.GL && !GLDrawCanvas.GL.isContextLost();
  if (useGL) {
    GLDrawAppearanceBuild(character);
  } else {
    CommonDrawCanvasPrepare(character);
    CommonDrawAppearanceBuild(character, {
      drawImage: (url, x, y, options) => DrawImageCanvas(url, character.Canvas.getContext('2d'), x, y, options),
    });
  }
}
