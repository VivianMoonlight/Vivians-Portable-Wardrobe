# 📚 Vivian's Portable Wardrobe - User Guide

> **Version**: This guide covers version 0.5+ of Vivian's Portable Wardrobe. Features may vary by version.

## Table of Contents
- [Introduction](#-introduction)
- [Installation](#-installation)
- [Getting Started](#-getting-started)
- [File Manager](#-file-manager)
- [Outfit Studio](#-outfit-studio)
- [History Viewer](#-history-viewer)
- [Filter Manager](#-filter-manager)
- [Import & Export](#-import--export)
- [Advanced Features](#-advanced-features)
- [Troubleshooting](#-troubleshooting)
- [FAQ](#-faq)

---

## 🎭 Introduction

**Vivian's Portable Wardrobe** is a powerful browser extension/userscript for the Bondage Club game that provides advanced wardrobe and outfit management capabilities. It adds a sophisticated file management system and outfit editor directly into your game interface, making it easy to organize, customize, and manage your character's outfits.

### Who Is This For?

This tool is designed for **Bondage Club players** who want:
- Better organization of their outfits and wardrobes
- Advanced outfit editing and customization capabilities
- Visual preview of outfit changes in real-time
- Backup and restore functionality for their wardrobe data
- Layer-by-layer control over outfit appearance

### Key Benefits

✨ **Organize Better** - Create folders, save outfits, and search through your wardrobe  
🎨 **Edit Precisely** - Fine-tune colors, layers, priorities, and positions  
⏱️ **Track History** - Automatically record outfit changes and restore previous versions  
🔍 **Filter Easily** - Show/hide wardrobe items by category or group  
💾 **Backup & Share** - Export wardrobes, import from BCX format  
🌍 **Multi-language** - Supports English and Chinese (more languages can be added)  
🌓 **Theme Options** - Light and dark theme support

---

## 🔧 Installation

### Prerequisites

You need a **userscript manager** extension installed in your browser:

- **Tampermonkey** (recommended) - Available for:
  - [Chrome/Edge](https://chrome.google.com/webstore/detail/tampermonkey/)
  - [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
  - [Safari](https://apps.apple.com/app/tampermonkey/id1482490089) (desktop only; note: Safari has stricter extension policies and some features may be limited)
  
- **Greasemonkey** (Firefox) - [Install here](https://addons.mozilla.org/en-US/firefox/addon/greasemonkey/)

- **Violentmonkey** (Alternative) - Available for most browsers

### Installation Steps

1. **Install Tampermonkey** (or your preferred userscript manager) from the links above

2. **Get the script**:
   - Option A: Download the userscript file (`.user.js`) from the repository's releases page
   - Option B: If provided with a direct installation link, click it to open in Tampermonkey

3. **Install the userscript**:
   - Tampermonkey will automatically detect the script and show an installation page
   - Review the script details
   - Click **"Install"** or **"Confirm installation"**

4. **Script is ready!** The extension will now be active on Bondage Club game URLs

### Verification

To verify successful installation:

1. Navigate to any Bondage Club game URL
2. Look for a **floating button or panel** in the bottom-right corner of the screen
3. The button should appear after the game loads
4. If you see the interface, installation was successful! 🎉

⚠️ **Note**: The script only activates on official Bondage Club domains and localhost for development.

---

## 🚀 Getting Started

### Opening the File Manager

Once installed, you'll see a **floating interface** at the bottom-right of the Bondage Club game screen. Click on it to open the main **File Manager Panel**.

The main panel has three sections:

```
┌─────────────────────────────────────────────┐
│  [Title Bar with Controls]                  │
├──────┬──────────────────────────┬───────────┤
│      │                          │           │
│ Side │   File Manager /         │  Filter   │
│ Pre- │   History Viewer         │  Manager  │
│ view │   (Main Area)            │  Panel    │
│      │                          │           │
└──────┴──────────────────────────┴───────────┘
```

### Main Interface Components

#### Top Bar Controls

The title bar contains several action buttons:

- **📥** - Import player wardrobe
- **💾** - Save backup of your entire wardrobe
- **📂** - Import backup from file
- **🕒 / 📁** - Toggle between History Viewer and File Manager
- **🌓** - Switch between light and dark themes
- **🎨** - Open the Outfit Studio (advanced editor)
- **×** - Close the panel

#### Left Panel: Side Preview

Shows a **real-time preview** when you hover over outfit files. This lets you see what an outfit looks like before opening or applying it.

💡 **Tip**: Hover over any outfit file in the main area to see its preview on the left!

#### Center Panel: File Manager / History Viewer

This is the main workspace where you'll:
- Browse folders and files (File Manager mode)
- View and restore outfit history (History Viewer mode)

#### Right Panel: Filter Manager

Control which wardrobe items are **visible or hidden** by category (hair, clothing, accessories, etc.). More details in the [Filter Manager](#-filter-manager) section.

### Basic Navigation

- **Double-click** folders to open them
- **Right-click** items to see context menu options
- Use the **breadcrumb navigation** (path shown at top) to go back
- Use the **search box** to find items quickly

---

## 📁 File Manager

The File Manager is your main interface for organizing and managing outfits. It works like a traditional file system with folders and files.

### Creating Folders

To organize your outfits:

1. Click the **"New folder"** button (➕ icon or text button)
2. Enter a name for the folder
3. Press **OK** to create

💡 **Tip**: Create folders like "Casual", "Formal", "Party", "Favorites" to keep outfits organized!

### Saving Outfits

There are two main ways to save outfits:

#### Method 1: Save Current Character

1. In the title bar, use the save functions
2. Or click the **"Save"** button in the left sidebar
3. The current character's outfit will be saved to the current folder

#### Method 2: From the Game

The extension automatically integrates with the game's wardrobe system. Outfits saved through normal gameplay may also appear here (depending on integration settings).

### Working with Files

#### Opening/Viewing Files

- **Single-click** a file to see its details
- **Hover** over a file to preview it in the left panel
- **Double-click** to open a file (if applicable)

#### Context Menu (Right-Click)

Right-click on any file or folder to see available actions:

- **📖 Open** - Open the folder or view the file
- **✏️ Rename** - Change the name
- **🗑️ Delete** - Remove the item (with confirmation)
- **🎭 Apply to Character** - Apply this outfit to your character in-game
- **🎨 Send to Studio** - Open this outfit in the advanced Studio editor
- **📤 Export as BCX** - Export in BCX-compatible format

⚠️ **Note**: Deleted items cannot be recovered, so use caution!

### Search Functionality

The File Manager includes two search modes:

#### Current Folder Search

1. By default, search looks only in the **current folder**
2. Type in the search box to filter visible items
3. The placeholder text shows: *"Search in current folder..."*

#### Global Search

1. Click the **search scope toggle button** (icon next to search box)
2. Now search looks through **all folders**
3. The placeholder changes to: *"Search all folders..."*
4. Search results show the full path for each matching item

💡 **Tip**: Use global search to quickly find an outfit when you can't remember which folder it's in!

### Managing Items

#### Refresh Thumbnails

If previews aren't showing correctly:

1. Click the **"Refresh thumbnails"** button
2. The system will regenerate all preview images for items in the current view

#### Moving Items

To move files between folders:

1. Right-click the item and select **"Copy"** or similar (if available)
2. Navigate to the destination folder
3. Paste or use the appropriate option

*(Note: Drag-and-drop may be supported depending on the implementation)*

---

## 🎨 Outfit Studio

The **Outfit Studio** is the advanced outfit editor where you can fine-tune every aspect of an outfit. It provides layer-by-layer control with visual preview.

### Opening the Studio

To open the Studio:

1. Click the **🎨 button** in the title bar of the File Manager panel
2. Or right-click an outfit file and select **"Send to Studio"**

The Studio window will open with multiple panels for detailed editing.

### Studio Interface Overview

```
┌────────────────────────────────────────────────┐
│  [Toolbar: Save/Load | Palette | Layer Mgr]   │
├─────────┬──────────────────────┬───────────────┤
│         │                      │               │
│ Stacks  │   Preview Canvas     │ Part          │
│ List    │   (Visual Editor)    │ Inspector     │
│         │                      │               │
├─────────┼──────────────────────┤               │
│ Asset   │   Layer Manager      │               │
│ Selector│   (Drag to Reorder)  │               │
└─────────┴──────────────────────┴───────────────┘
```

### Stacks List Panel (Left)

**Stacks** are different outfit variations you can work on simultaneously.

#### Creating New Stacks

1. Click the **"+"** button to create a new stack
2. Give it a meaningful name (e.g., "Summer Look", "Winter Outfit")

#### Managing Stacks

- **Click** a stack to select and edit it
- **Rename**: Click the rename icon (✏️)
- **Delete**: Click once to arm deletion, click again to confirm
- **Copy**: Use the copy buttons to duplicate a stack
  - **Copy (full)**: Copies all parts
  - **Copy (visible only)**: Copies only visible/filtered parts

💡 **Tip**: Use multiple stacks to try different variations of an outfit without losing your work!

### Part Inspector Panel (Right)

This panel shows detailed information about the **currently selected part** (clothing item, accessory, etc.).

#### Viewing Part Details

When you click a part in the Parts List, you'll see:

- **Description**: Name of the item
- **Group**: Category (e.g., "Hair", "Upper Clothing", "Feet")
- **Color**: Current color values
- **Property**: Special properties or flags
- **TypeRecord**: Asset type information
- **Craft**: Crafting information summary

#### Editing Individual Layers

Each part can have multiple **layers** that can be edited independently:

- **Color**: Click to open color picker or palette
- **Opacity**: Adjust transparency (0-100%)
- **Offset**: Move the layer (X/Y coordinates)
- **Priority**: Change rendering order (higher = drawn on top)

⚠️ **Note**: The "linked" icons allow you to modify all sub-layers at once.

### Preview Canvas (Center)

The preview canvas shows a **real-time visual rendering** of the outfit being edited.

#### View Modes

- **View Mode (Pan & Zoom)**: 
  - Click and drag to pan around
  - Use mouse wheel to zoom in/out
  
- **Move Mode (Drag Layers)**:
  - Select a part/layer first
  - Then drag directly on the canvas to adjust its offset
  - Great for precise visual positioning!

#### Canvas Controls

- **Toggle Layer Manager**: Show/hide the layer order panel
- **Refresh Render**: Force redraw if something looks wrong

### Layer Manager Widget

The Layer Manager shows all layers in **rendering order** (bottom = drawn first, top = drawn last).

#### Reordering Layers

1. **Drag and drop** layers to change their rendering order
2. Layers at the **bottom** are drawn first (behind)
3. Layers at the **top** are drawn last (in front)

💡 **Tip**: Use this to fix rendering issues like hair showing behind clothing!

#### Selecting Multiple Layers

- **Click + Shift**: Select a range of layers
- **Click + Ctrl**: Select individual layers
- Selected layers can be edited together in batch

### Color Palette Panel

The Palette panel provides advanced color management.

#### Three Modes

1. **External Colors**: Edit colors from external sources
2. **Saved Colors**: Your saved color swatches
3. **Color Tags**: Named color presets

#### Saving Colors

1. Select a color you like
2. Click the **"Save"** button in Saved Colors section
3. The color is added to your palette for future use

#### Using Color Tags

- Tags are automatically created when you have duplicate colors
- Create custom tags for your favorite colors
- Click a tag to apply that color to the selected layer

💡 **Tip**: Build a color palette for each character to maintain consistent styling!

### Priority Arrangement Panel

This panel groups layers by their **priority override** settings, making it easy to see rendering order.

- Shows layers grouped by priority value
- **Drag layers** into this panel to set their priority
- Useful for understanding complex layer stacking

### Asset Selector Panel

Use this panel to **replace parts** with different assets.

#### Replacing a Part

1. In the Parts List, click a part and then click **"Replace"**
2. The Asset Selector becomes active
3. **Search** for assets by name or description
4. Browse by **group** (category)
5. Click an asset and then click **"Apply"** to replace

💡 **Tip**: Use card view or list view depending on your preference!

### History Panel (Studio)

The Studio has its own internal history for **undo/redo** operations.

- Shows recent changes in chronological order
- Click a history item to restore that state
- Shows how many undo/redo steps are available

### Batch Edit Panel

When you select **multiple layers**, the Batch Edit panel appears.

#### Batch Operations

- **Opacity**: Set or adjust opacity for all selected layers
- **Offset**: Move all selected layers together (absolute or relative)
- **Priority**: Change priority for all selected layers
- **Color**: Apply the same color to all colorable layers
- **Visual Move**: Enable to drag all selected layers together on canvas

**Modes**:
- **Absolute**: Set to exact value (e.g., opacity = 80%)
- **Relative**: Adjust by amount (e.g., +10 to X offset)

### Stack Management

#### Exporting Stacks

1. Click the **💾 Save** icon in the Studio toolbar
2. A JSON file containing all stacks will be downloaded
3. Save this file for backup or sharing

#### Importing Stacks

1. Click the **📂 Load** icon in the Studio toolbar
2. Select a previously saved JSON file
3. Stacks will be imported into the Studio

#### Applying to Character

1. Configure your outfit in the Studio
2. Click the **"Apply to Character"** button
3. The merged outfit will be applied to the target character in-game

### Saves Manager

The Studio includes a **Saves Manager** for quick save/load of work.

1. Click **"Manage Saves"** in the Studio
2. **Save Current**: Save current state with a name
3. **Load**: Restore a previous save
4. **Delete**: Remove old saves

💡 **Tip**: Use saves to experiment with variations without losing your progress!

---

## 🕒 History Viewer

The History Viewer automatically tracks changes to your outfits over time, allowing you to restore previous versions.

### Accessing History

1. In the File Manager panel, click the **🕒 button** in the title bar
2. The view switches from File Manager to History Viewer

### Viewing History Records

Each history record shows:

- **Timestamp**: When the outfit was recorded
- **Preview**: Thumbnail of the outfit
- **Recorded at**: Full date and time

Records are sorted with **newest first**.

### Restoring from History

To restore a previous outfit:

1. Find the history record you want
2. Right-click and select **"Load this record"**
3. Or use the context menu options

### History Context Menu

Right-click any history record to see options:

- **Load this record**: Restore this outfit version
- **Delete**: Remove this record from history
- *Other actions may be available depending on context*

### Managing History

#### Clearing All History

1. Click the **"Clear All"** button at the top
2. Confirm the action (this cannot be undone!)
3. All history records will be permanently deleted

⚠️ **Warning**: Clearing history is permanent and cannot be undone!

### History Recording

History is **automatically recorded** when:

- You change outfits in the game
- You apply outfits from the File Manager
- You save changes in the Studio

💡 **Tip**: Don't worry about manually saving history - it happens automatically!

---

## 🔍 Filter Manager

The Filter Manager (right panel) controls which wardrobe items are **visible or hidden** in the game and editors.

### Understanding Filter Groups

Items are organized into groups by category:

- **Hair** - Hairstyles and hair accessories
- **Face** - Facial features and expressions
- **Upper Clothing** - Shirts, jackets, tops
- **Lower Clothing** - Pants, skirts, shorts
- **Hands** - Gloves, mittens, hand accessories
- **Feet** - Shoes, socks, boots
- **Accessories** - Jewelry, bags, misc items
- **Markings / Tattoos** - Body art
- **Cosplay** - Costume pieces
- **Headwear** - Hats, crowns, masks
- **Item** - Bondage and special items
- **Hidden Body Parts** - Invisible body parts for technical purposes
- **Appearance** - Character appearance settings

### Toggling Filters

#### Individual Items

- **Click** any filter button to toggle it on/off
- **Green/Active** = Item is visible
- **Gray/Inactive** = Item is hidden

#### Group Operations

Each group has quick action buttons:

- **All On**: Enable all items in this group
- **All Off**: Disable all items in this group
- **Invert**: Toggle all items (on→off, off→on)

#### Global Operations

At the top of the Filter Manager:

- **All On**: Enable every filter
- **All Off**: Disable every filter
- **Invert**: Toggle all filters globally

### Hidden Groups

Some groups are marked as **"Hidden"** and are typically technical/internal:

- Toggle **"Show hidden groups"** to see them
- Most users won't need to interact with hidden groups

### Using Filters Effectively

💡 **Tip**: Use filters to:
- **Simplify editing**: Hide unrelated categories when editing an outfit
- **Troubleshoot**: Disable items to find which one is causing rendering issues
- **Focus**: Show only the categories you're currently working with
- **Preview**: See how an outfit looks with certain items hidden

---

## 💾 Import & Export

The application provides multiple ways to backup, restore, and share your wardrobe data.

### Backup System

#### Saving a Backup

1. Click the **💾 Save Backup** button in the title bar
2. A JSON file containing your entire wardrobe will be downloaded
3. Name it something memorable (e.g., "wardrobe-backup-2024-01-15.json")
4. Store it safely on your computer

💡 **Tip**: Make regular backups, especially before major changes!

#### Importing a Backup

1. Click the **📂 Import Backup** button
2. Select a previously saved backup JSON file
3. Your wardrobe will be restored from the backup

⚠️ **Note**: Importing a backup may overwrite current data. Consider saving a current backup first!

### BCX Format Import

**BCX** is another popular Bondage Club extension format. You can import BCX-format outfits:

1. Click the **"Import BCX"** button in the left sidebar
2. Select a BCX-format JSON file
3. The outfit will be imported and added to your wardrobe

### Player Wardrobe Import

To import outfits directly from the game's player wardrobe:

1. Click the **📥 Import Player Wardrobe** button in the title bar
2. The system will fetch your character's saved outfits
3. Outfits will be added to the current folder

### Export Individual Outfits

To export a single outfit:

1. Right-click the outfit file
2. Select **"Export as BCX"**
3. A BCX-compatible JSON file will be downloaded

### Studio Stack Operations

Within the Studio, you can export/import stack collections:

1. **Export Stacks**: Save all current stacks to a JSON file
2. **Import Stacks**: Load stacks from a JSON file
3. **Export Palette**: Save your color palette
4. **Import Palette**: Load a saved palette

💡 **Tip**: Share your stack JSON files with friends to share complete outfit designs!

---

## ⚡ Advanced Features

### Keyboard Shortcuts

While keyboard shortcuts may vary, common patterns include:

- **Ctrl + A**: Select all (in multi-select contexts)
- **Ctrl + D**: Clear selection
- **Delete**: Delete selected items (with confirmation)
- **Esc**: Close dialogs or cancel operations

*(Check the interface tooltips for more shortcuts)*

### Theme Switching

The application supports **light and dark themes**:

1. Click the **🌓** button in the title bar
2. Theme switches immediately
3. Your preference is saved for future sessions

**Light Theme**: Better for bright environments  
**Dark Theme**: Easier on the eyes in low light

### Multi-language Support

The application includes internationalization (i18n) support:

- **English** (default)
- **Chinese** (中文)

The language typically auto-detects based on your browser settings. Additional languages can be added by the community.

### Canvas Rendering Options

The preview system uses Canvas API for rendering:

- **Hardware acceleration** is used when available
- Rendering quality is optimized for performance
- Thumbnails are generated asynchronously

#### Performance Tips

For better performance:

1. **Close unused panels** - Reduce active preview rendering
2. **Limit visible items** - Use filters to show only what you need
3. **Refresh selectively** - Only refresh thumbnails when needed
4. **Use stack saves** - Save Studio work frequently to avoid re-rendering

### Storage Options

The extension can store data in multiple locations:

- **Local browser storage** (IndexedDB/localStorage)
- **GM storage** (provided by Tampermonkey)
- Data is automatically synced and persisted

💡 **Tip**: Regular backups are still recommended as browser storage can be cleared!

---

## 🔧 Troubleshooting

### Common Issues

#### Extension Not Appearing

**Problem**: The floating button/panel doesn't appear in the game.

**Solutions**:
1. Verify Tampermonkey is installed and enabled
2. Check that the script is enabled in Tampermonkey dashboard
3. Refresh the page (Ctrl+F5 or Cmd+Shift+R)
4. Verify you're on an official Bondage Club URL
5. Check browser console for errors (F12 → Console tab)

#### Thumbnails Not Showing

**Problem**: Outfit previews appear blank or broken.

**Solutions**:
1. Click **"Refresh thumbnails"** button
2. Wait a moment for rendering to complete
3. Check that Canvas rendering is supported in your browser
4. Disable hardware acceleration if you see graphical glitches

#### Studio Won't Open

**Problem**: Clicking the Studio button does nothing.

**Solutions**:
1. Check browser console for errors
2. Close and reopen the main panel
3. Refresh the page and try again
4. Clear browser cache and reload

#### Colors Not Saving

**Problem**: Color changes don't persist.

**Solutions**:
1. Ensure you click "Apply" or "Save" after making changes
2. Check that browser storage is not full
3. Verify storage permissions for the site
4. Try exporting as a backup and reimporting

#### Performance Issues

**Problem**: The interface is slow or laggy.

**Solutions**:
1. Close unused panels (History, Palette, Layer Manager)
2. Reduce the number of visible items with filters
3. Don't open too many stacks simultaneously
4. Clear old history records
5. Use a modern browser with hardware acceleration

### Known Limitations

- **Browser compatibility**: Best experience in Chrome, Firefox, Edge, and desktop Safari (with Tampermonkey installed)
- **Mobile support**: Not supported - mobile browsers cannot run userscripts
- **Canvas limits**: Very complex outfits may slow down rendering
- **Storage limits**: Browser storage has size limits (typically several MB)

### Getting Help

If you encounter issues not covered here:

1. Check the **browser console** (F12) for error messages
2. Review the **README.md** in the repository
3. Check the **Issues** page on GitHub for known bugs
4. Report new bugs with detailed information:
   - Browser and version
   - Tampermonkey version
   - Steps to reproduce
   - Console error messages

---

## ❓ FAQ

### General Questions

**Q: Is this safe to use?**  
A: Yes, this is an open-source userscript. You can review the code yourself. It only interacts with the Bondage Club game and doesn't collect or transmit personal data.

**Q: Will this get me banned from Bondage Club?**  
A: The script is designed to enhance the wardrobe system without violating game rules. However, always review the game's Terms of Service and use extensions responsibly.

**Q: Does this work on mobile?**  
A: No. The interface is optimized for desktop browsers only. Mobile browsers (including mobile Safari) do not support userscripts and cannot run this extension.

### Data & Storage

**Q: Where is my data stored?**  
A: Data is stored locally in your browser using GM storage (from Tampermonkey) and browser storage APIs. Nothing is sent to external servers.

**Q: Can I sync data between browsers?**  
A: Not automatically. Use the Backup/Export features to manually transfer data between browsers or devices.

**Q: What happens if I clear browser data?**  
A: Your wardrobe data may be lost. Always maintain backup files using the Export function!

**Q: How much storage space does this use?**  
A: Depends on the number of outfits and their complexity. Typically a few MB. Monitor storage in the Saves Manager.

### Features

**Q: Can I share outfits with friends?**  
A: Yes! Export outfits as BCX format or Studio stacks and share the JSON files.

**Q: What's the difference between File Manager and Studio?**  
A: File Manager is for organizing outfits (like a file browser). Studio is for detailed editing of outfit appearance (colors, layers, positions).

**Q: Can I undo changes?**  
A: Yes! The Studio has history/undo functionality. The main History Viewer tracks saved outfit versions.

**Q: What are Stacks?**  
A: Stacks are outfit variations in the Studio. You can work on multiple versions simultaneously and switch between them.

**Q: How do filters work?**  
A: Filters control visibility of wardrobe categories. Disabling a filter hides those items in the game and editors.

### Technical

**Q: Why is rendering slow?**  
A: Complex outfits with many layers require significant processing. Close unused panels and use filters to improve performance.

**Q: Can I edit the script?**  
A: Yes! It's open source. Fork the repository and make your own modifications.

**Q: Does this work offline?**  
A: The script itself works offline once installed, but the Bondage Club game requires an internet connection.

**Q: What browsers are supported?**  
A: Desktop versions of Chrome, Firefox, Edge, Safari (with Tampermonkey), and other Chromium-based browsers. Mobile browsers are not supported.

### Troubleshooting

**Q: The panel won't close!**  
A: Click the **×** button in the title bar. If that doesn't work, refresh the page.

**Q: I lost my wardrobe data!**  
A: If you have a backup file, use Import Backup to restore. If not, data may be unrecoverable - always make backups!

**Q: Colors look wrong after editing**  
A: Try refreshing the render. Reset color to default using the reset button on the color picker.

**Q: The script stopped working after a game update**  
A: Check for script updates in Tampermonkey. The game's structure may have changed and the script needs updating.

---

## 🎉 Conclusion

You now have a complete understanding of **Vivian's Portable Wardrobe**! This powerful tool gives you full control over your Bondage Club outfits with:

- Advanced file organization
- Detailed outfit editing
- Automatic history tracking
- Flexible import/export options

### Quick Start Checklist

- ✅ Install Tampermonkey
- ✅ Install the userscript
- ✅ Open the File Manager panel in-game
- ✅ Create your first folder
- ✅ Save an outfit
- ✅ Try editing in the Studio
- ✅ Make a backup!

### Best Practices

1. **Backup regularly** - Export your wardrobe monthly
2. **Organize early** - Create folders before you have hundreds of outfits
3. **Use descriptive names** - Make outfits easy to find later
4. **Experiment in Studio** - Use stacks to try variations without losing work
5. **Monitor storage** - Keep an eye on how much space you're using

Enjoy creating and managing your perfect wardrobe! 🎭✨
