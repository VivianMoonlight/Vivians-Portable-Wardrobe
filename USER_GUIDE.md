# Portable wardrobe user guide / 随身衣橱使用指南

This guide covers the React preview on `wardrobe-react`. For detailed Chinese instructions, start with [快速开始](docs/user-docs/01-quick-start.md) or the [文档总览](docs/user-docs/00-index.md).

## Install and open

Install the [React preview loader](https://cdn.jsdelivr.net/gh/VivianMoonlight/Vivians-Portable-Wardrobe@wardrobe-react/ViviansPortableWardrobeReactLoader.user.js) in a userscript manager supported by your browser. Reload Bondage Club, then open the wardrobe from its floating button.

On mobile, the interface adapts to the screen. Running the script still requires a browser and userscript manager that support it.

## Find an outfit

Use **Import / Export → Save current outfit** to save what your character is wearing. The same menu imports BCX codes, JSON backups or outfits from the game's wardrobe.

Search outfit or tag names. Filter by tag or cloud sync in the sidebar; on mobile, open **Filters**. Use **Cards** for masonry thumbnails or **List** to browse without thumbnails.

Create unique tag names under **Manage tags**. An outfit's **⋯ → Edit tags** menu lets you assign multiple tags. Removing a tag keeps the outfit. Old folders migrate into full-path tags such as `Everyday / Summer`.

## Preview, adjust and apply

1. Select an outfit to open **Outfit preview**. On desktop it opens beside the wardrobe; on mobile it opens on a separate page. Each selection starts with full replacement.
2. Open **Adjust outfit** if you want to change individual parts or groups. Desktop uses a dialog; mobile moves to an adjustments page.
3. Choose **Done adjusting** to return to the preview. On mobile, **Back to preview** does the same. Both keep your adjustments without applying them.
4. Check **Target character**, then choose **Apply to “character name”**.

Closing the desktop preview or choosing **Back to wardrobe** on mobile keeps your search, filters and browsing position. Selecting an outfit again starts a fresh full replacement. Applying remains subject to BC permissions, locks and available assets.

### Group actions

Group source buttons show the next action based on the current preview:

| Preview state | Next action |
| --- | --- |
| Slots supplied by the source are empty | **Add** fills them and keeps existing items |
| Those slots have items that differ from the source | **Replace** overwrites them and keeps other slots |
| Those items already match the source | **Full replace** also clears slots missing from the source |
| The group already fully uses this source | **Fully replaced** keeps the result; the button is disabled |

The action is determined by content, including colors and properties, rather than a click counter.

Individual sliders directly choose **Original**, **Outfit** or **Empty**. Full replacement can leave a slot empty while its slider still shows the selected source. Only choosing **Empty** manually moves it to Empty.

**Keep original body** restores the original body, face, hairstyle and hair color while keeping other choices. **Replace body only** uses those parts from the outfit and restores all other parts from the original character. Both actions affect only the current preview.

## Save, sync and back up

Local-save and cloud-sync status are separate. **Submitted · awaiting verification** means the upload was submitted but has not been checked against fresh cloud data. Verification happens when matching data returns on login or reconnect. **Retry upload** resubmits; it does not fetch cloud data.

The storage panel shows VPW's usage and other extensions' usage within a shared **180000-byte (180 kB)** budget. When over the limit, uploads pause and saved local outfits remain available. Set some outfits to **This device only**, then retry. Tags and deletion records still use some cloud space.

Use **Import / Export → Save backup** before switching devices or clearing site data. Importing a backup adds new outfit copies and reuses matching tag names; repeated imports can create duplicates.

See [数据与备份](docs/user-docs/05-data-backup-import-export.md), [云同步与容量](docs/user-docs/06-sync-and-storage.md) and [故障排查](docs/user-docs/08-troubleshooting-faq.md) for formats and recovery steps.

## Other controls

**History** provides recent outfit records. Save outfits in the wardrobe for long-term use; history is limited and is not included in wardrobe JSON backups.

**Settings** offers light and dark themes. The interface supports English and Simplified Chinese; language follows the saved preference or browser language. See [主题、语言与移动端](docs/user-docs/07-theme-language-mobile.md).

The previous interface's Studio and folder instructions are preserved in the [legacy user guide](docs/LEGACY_USER_GUIDE.md). They describe the older version, not the current React preview.
