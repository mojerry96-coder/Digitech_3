# Drive Practice Simulation: Build Instructions

A front-end clone of Google Drive's web app in its **first-day state** (empty account, 0 bytes used). Learners practise every core Drive action here before they use the real product. It has no backend and no accounts, and it saves nothing to disk. Everything lives in memory, and a page reload gives you a brand-new account again.

---

## 1. Quick start

1. Unzip the folder.
2. Double-click `index.html`. It opens in Chrome, Edge, Firefox or Safari.
   - No build step, no `npm install` and no server are needed.
   - Optional: to serve it like a website, run `npx serve .` or `python -m http.server` in the folder and open the URL it prints.
3. To host it, upload the whole folder to any static host (Netlify, Vercel, GitHub Pages, an LMS SCORM wrapper or an `<iframe>`).

URL options:

| URL | Effect |
|---|---|
| `index.html` | Starts on **Home** (default) |
| `index.html#my-drive` | Starts on **My Drive** |
| `index.html?guide=off` | Hides the Practice tasks guide (pure clone) |

---

## 2. Project structure

```
drive-sim/
├── index.html              App shell: top bar, sidebar, main card, details panel, apps rail
├── BUILD_INSTRUCTIONS.md   This file
├── css/
│   └── drive.css           All styling: Material 3 tokens, layout, components, responsive rules
├── js/
│   ├── config.js           ← EDIT ME: user name, quota, start page, seed files, guide on/off
│   ├── icons.js            File-type icon SVGs + extension → type mapping + Type-filter groups
│   ├── store.js            Data model, all file operations, activity log, event bus, formatters
│   ├── ui.js               Primitives: menus/submenus, dialogs, snackbar, tooltips, popovers
│   ├── app.js              Routing, rendering of every view, interactions, uploads, drag-drop, search, shortcuts
│   └── tutor.js            Optional "Practice tasks" checklist (listens to app events)
└── assets/
    ├── logo.svg            Neutral placeholder mark (see §11 Branding)
    └── fonts/              Bundled Material Symbols + Roboto, so the app works offline
```

Scripts must load in this order: `config → icons → store → ui → app → tutor`.

---

## 3. Visual specification (how it looks)

### 3.1 Design tokens (`:root` in `drive.css`)

| Token | Value | Used for |
|---|---|---|
| `--bg` | `#f8fafd` | Page background behind the cards |
| `--surface` | `#ffffff` | Main content card, details card |
| `--surface-2` | `#f0f4f9` | Folder/suggestion cards, row hover, selection bar |
| `--surface-3` | `#e9eef6` | Search pill (unfocused) |
| `--on-surface` | `#1f1f1f` | Primary text |
| `--on-surface-var` | `#444746` | Icons, secondary text |
| `--outline` | `#747775` | Chip and segmented-button borders |
| `--divider` | `#e1e3e1` | List row separators |
| `--primary` | `#0b57d0` | Filled buttons, links, focus rings, active tabs |
| `--tonal` | `#d3e3fd` | "Upgrade" tonal button |
| `--nav-active` / `--selected` | `#c2e7ff` | Active nav pill, selected rows/cards, active chips |
| `--on-nav-active` | `#001d35` | Text on the active pill |
| `--snack-bg` / action | `#303030` / `#a8c7fa` | Snackbar |

Shadows follow Material 3 elevation levels 1, 2 and 3 (`--shadow-1/2/3`).

### 3.2 Typography
- **UI font:** `Google Sans`, falling back to `Roboto` (bundled), then Arial. Headings and buttons use Google Sans weight 500.
- **Body:** 14 px / 20 px line height.
- **Page title** ("My Drive", "Welcome to Drive"): 24 px / 32 px, weight 400.
- **Dialog titles:** 24 px. **Section headers** ("Suggested folders", "Folders"): 16 px / 500.
- **Icons:** Material Symbols Outlined at 24 px (20 px in menus and nav). The `FILL` axis is switched on for active and starred states.

### 3.3 Layout measurements
```
┌──────────────────────────────────────────────────────────────── 64px top bar ─┐
│ [logo] Drive   (  🔍 Search in Drive               ⚙︎tune )   ⓘ ? ⚙ ✦ [Upgrade] ⋮⋮⋮ (L) │
├──────────────┬──────────────────────────────────────────┬──────────┬──┤
│ [+ New] 56px │  Main card: white, radius 16px           │ Details  │ 56│
│  radius 16   │  Title row 64px  ·  layout toggle  ⓘ     │ card     │ px│
│              │  Chips row (Type, People, Modified)      │ 360px    │app│
│  Nav pills   │  List / grid                             │ radius16 │rail│
│  32px tall   │                                          │          │   │
│  radius 16   │                                          │          │   │
│  256px wide  │                                          │          │   │
│  Storage bar │                                          │          │   │
└──────────────┴──────────────────────────────────────────┴──────────┴──┘
```
- Search: 48 px tall, max 720 px wide, radius 24 px. Fill `#e9eef6`; turns white with a shadow on focus, and the suggestion dropdown attaches below it.
- List rows: 48 px (40 px in Compact density) with a 1 px divider. On hover the row turns `#f0f4f9` and shows quick actions: Share, Download, Rename, Star.
- Grid: `repeat(auto-fill, minmax(212px, 1fr))`, 16 px gap. Folder cards are 48 px tall; file cards are 248 px with a white thumbnail well.
- Menus: radius 4 px, 32 px items (40 px in the New menu), 8 px vertical padding, elevation 2.
- Dialogs: radius 28 px, 24 px padding, scrim `rgba(0,0,0,.4)`.
- Snackbar: bottom-left at 24 px, `#303030`, auto-hides after 6 s, with an optional **Undo**.
- Upload tray: bottom-right, 360 px wide, radius 16 px on the top corners.

### 3.4 Responsive behaviour
- **≤ 1100 px:** the details panel becomes a right-side overlay.
- **≤ 900 px:** a hamburger appears and the sidebar becomes a slide-in drawer. Upgrade, Offline, AI and the apps rail are hidden.
- **≤ 600 px:** the wordmark is hidden and the list shows only Name and actions.
- List columns also adapt to the space actually available. For example, when the details panel opens, the right-most columns drop first (`fitColumns()` in `app.js`, driven by a `ResizeObserver`).

---

## 4. Functional specification (how it works)

### 4.1 Views and routes (hash routing, so Back/Forward work)
| Sidebar item | Hash | What it shows | Empty-state copy |
|---|---|---|---|
| Home | `#home` | "Welcome to Drive": collapsible **Suggested folders** cards and **Suggested files** list | "Welcome to Drive, the home for all your files" |
| My Drive (▸ tree) | `#my-drive`, `#folders/<id>` | Folder contents with breadcrumbs. The ▸ caret expands a live folder tree | "A place for all of your files" |
| Computers | `#computers` | Always empty | "No computers syncing" |
| Shared with me | `#shared-with-me` | Items seeded in `config.js` (empty by default) | "Files shared with you" |
| Recent | `#recent` | Files grouped Today / Yesterday / Earlier this week… | "No recent files" |
| Starred | `#starred` | Starred items | "No starred files" |
| Spam | `#spam` | Always empty | "Your spam is empty" |
| Trash | `#trash` | Trashed items, a 30-day banner and **Empty trash** | "Nothing in trash" |
| Storage | `#quota` | Usage summary and files sorted by size | n/a |
| (search) | `#search?q=` | Results with Type, People, Modified and Location chips | "None of your files or folders matched this search" |

### 4.2 The **New** button
- **New folder** opens a dialog with "Untitled folder" pre-selected → Create.
- **File upload** opens the OS file picker (multiple files allowed).
- **Folder upload** opens the OS folder picker and recreates the folder tree.
- **Google Docs / Sheets / Slides / Forms ▸ Blank** creates "Untitled document/spreadsheet/presentation/form" and opens a **simulated editor**. Its title field renames the file. Docs, Sheet cells and Slide text are editable and persist for the session. "From a template" shows a "not available" message.
- **More ▸** lists Drawings, My Maps, Sites, Apps Script and "Connect more apps" (each says it isn't available here).
- New items are created in the folder you're viewing. From any other view they go to My Drive, and a snackbar offers **Show location**.

### 4.3 File and folder actions (right-click, ⋮, or the selection bar)
| Action | Behaviour |
|---|---|
| Open / Open with ▸ Preview | Folder → navigate. Image, video, audio, PDF and text → full-screen dark viewer with ← → navigation. Docs/Sheets/Slides/Forms → simulated editor. Other types → "No preview available" card |
| Download | Uploaded files really download. Native Docs and folders show what real Drive would do (.docx / zip) |
| Rename | Dialog. The name is selected without its extension. Snackbar with **Undo** |
| Make a copy | "Copy of …" in the same folder. **Undo** |
| Share ▸ Share | Full share dialog: add emails as chips, choose a role (Viewer/Commenter/Editor), Notify people, Message, Send. People with access can have their role changed or be removed. General access: Restricted or Anyone with the link. Shared items get a 👥 badge and a shared-folder icon. **No email is ever sent** |
| Share ▸ Copy link | Copies a practice URL to the clipboard |
| Organise ▸ Move | Move dialog: Suggested / Starred / All locations tabs, browse into folders, create a folder, **Move here**. Moving a folder into itself is blocked. **Undo** |
| Organise ▸ Add shortcut | Creates a shortcut (arrow badge) in My Drive that opens the original |
| Organise ▸ Add to starred | Toggles the star |
| Organise ▸ Change colour | 24-swatch palette (folders only) |
| File information ▸ Details / Activity | Opens the right panel on the matching tab |
| Move to trash | **Undo** snackbar. Trashed folders hide their contents everywhere |
| (Trash) Restore / Delete forever / Empty trash | Restore returns the item to its original folder, or to My Drive if that folder is gone. The two delete actions confirm first |

### 4.4 Selection model
- Click selects. **Ctrl/⌘+click** toggles. **Shift+click** selects a range. **Ctrl+A** selects all. **Esc** clears.
- With any selection, the chips row is replaced by the selection bar: `✕ N selected | Share · Download · Move · Trash · Copy link · ⋮`. In Trash it shows Restore and Delete forever.
- Double-click or **Enter** opens the item.

### 4.5 Drag and drop
- **From the computer:** dragging files over the main card shows a blue overlay ("Drop files to instantly upload them to …"). Dropping onto a folder row or card uploads into that folder.
- **Inside Drive:** drag rows or cards (multi-select works) onto a folder, a sidebar tree node, "My Drive" in the sidebar or a breadcrumb to move them, with an **Undo** snackbar.

### 4.6 Uploads
The upload tray shows a progress ring per file ("Uploading N items" → "N uploads complete"). You can minimise it, cancel, or click a finished row to jump to the file's location. Speed is set by `uploadSpeedMs`. Storage use updates live, and uploads beyond the quota are refused.

### 4.7 Search
- Focusing the search box shows recent files and type chips (Documents, Spreadsheets, PDFs…). Typing shows live matches with their location. ↑/↓ and Enter open a match. Enter on its own shows the full results view.
- The **tune** icon opens **Advanced search**: Type, Owner, Has the words, Item name, Location, Date modified, In trash and Starred.

### 4.8 Details panel (ⓘ)
- **Details:** preview, Who has access (avatars), Manage access, Type, Size, Storage used, Location chip (click to go there), Owner, Modified, Opened, Created, and an editable Description.
- **Activity:** a timeline of every action, filtered to the selected item.

### 4.9 Header and rail
- **Support (?):** Help, Training (opens the Practice tasks), Keyboard shortcuts.
- **Settings ⚙:** a Settings dialog (Start page: Home or My Drive; Density: Comfortable or Compact) plus Keyboard shortcuts.
- **Apps grid:** a 15-tile launcher. **Avatar:** an account card.
- **Right rail:** Calendar, Keep, Tasks, Contacts and Add-ons, plus a chevron that hides the rail.
- Anything outside Drive's scope says *"… isn't available in this practice simulation"* so learners aren't confused.

### 4.10 Keyboard shortcuts
| Keys | Action | Keys | Action |
|---|---|---|---|
| `/` | Focus search | `V` | Toggle list/grid |
| `Shift+F` | New folder | `D` | Show/hide details |
| `Shift+T` / `S` / `P` / `O` | New Doc / Sheet / Slides / Form | `N` | Rename |
| `Alt+C` then `F/U/I` | New folder / upload files / upload folder | `S` | Star / unstar |
| `Enter` or `O` | Open | `Z` | Move |
| `Delete` or `#` | Move to trash | `.` | Share |
| Arrow keys (+`Shift`) | Move / extend selection | `Ctrl+A` | Select all |
| `Esc` | Clear selection / close | `?` or `Ctrl+/` | Shortcuts dialog |

---

## 5. Data model (`store.js`)

```js
item = {
  id, type,            // 'folder' | 'doc' | 'sheet' | 'slide' | 'form' | 'pdf' | 'image' | 'video'
                       // | 'audio' | 'archive' | 'word' | 'excel' | 'powerpoint' | 'text' | 'file'
  name, parent,        // parent = 'root' (My Drive) | 'shared' (Shared with me) | <folderId>
  owner: 'me',
  created, modified, opened,       // timestamps (ms)
  size,                            // bytes (native Docs = 0)
  starred, trashed, trashedAt,
  color,                           // folder colour or null
  access: [{ email, role }],       // people shared with
  general: 'restricted' | 'anyone',
  description,
  blobUrl, mime, textContent,      // for real uploaded files (preview + download)
  content,                         // simulated-editor contents for Docs/Sheets/Slides
  shortcutOf,                      // id of the target, if this is a shortcut
  uploaded, copiedFrom, sharedWithMe
}
```

View state (`Store.S`) holds `view`, `folderId`, `layout`, `sort`, `foldersFirst`, `selection` (a Set), `filters`, `query`, `adv`, `detailsOpen`, `detailsTab`, `density` and `treeOpen`.

All mutations go through the `Store.*` functions (`create`, `rename`, `trash`, `restore`, `deleteForever`, `move`, `copy`, `star`, `emptyTrash`). Each one appends to `S.activity`, which the Activity tab uses.

---

## 6. Event bus and the Practice guide

`app.js` emits events on `window.Bus`, and `tutor.js` listens to them. You can attach your own analytics, LMS (xAPI/SCORM) reporting or narration to the same events:

| Event | Fired when | Event | Fired when |
|---|---|---|---|
| `folder:create` | A folder is created | `item:share` | Sharing changed and sent/done |
| `file:upload` | Each uploaded file finishes | `folder:upload` | A folder upload starts |
| `doc:create` | Doc/Sheet/Slide/Form created | `view:grid` / `view:list` | Layout toggled |
| `folder:open` | A folder is opened | `details:open` | Details panel opened |
| `file:open` | A file is previewed or opened | `search:run` | A search is run |
| `item:rename` | Renamed | `item:trash` | Moved to trash |
| `item:move` | Moved (dialog or drag) | `item:restore` | Restored from trash |
| `item:star` | Starred | `render` | After every re-render |

```js
// Example: send every learner action to your LMS
Bus.on('*', (event, data) => myLms.track(event, data));
```

**Adding a practice task:** add one line to `TASKS` in `tutor.js`:
```js
{ id: 'copy', ev: 'file:open', name: 'Preview a file', hint: 'Double-click any file.', target: '#content' },
```
`target` is the CSS selector that the **Show me** button pulses. Progress is labelled "not a score" on purpose. When every task is done, a completion dialog offers **Keep practising** or **Start over**.

---

## 7. Customising (`js/config.js`)
```js
user: { name: 'Learner', email: 'learner@practice.drive', initial: 'L', color: '#7b1fa2' },
quotaGB: 15,
startPage: 'home',            // or 'my-drive'
showPracticeGuide: true,
uploadSpeedMs: 1400,
trashRetentionDays: 30,
seedSharedWithMe: [ { name: 'Orientation Handbook.pdf', type: 'pdf', owner: 'Training Office', size: 482133 } ],
seedMyDrive: [],              // leave empty for a true first-day account
```

---

## 8. Rebuilding from scratch (step-by-step order)
If you want to rebuild or port this (for example to React or Vue), work in this order. Each step is testable on its own.

1. **Shell and tokens:** top bar, sidebar, main card, rail, with the colours and measurements from §3. Check it against a screenshot of real Drive at 1440×860.
2. **Store:** item model, `create`/`children`/`ancestors`, and the event bus.
3. **Routing:** hash → `S.view`/`S.folderId`, and a `render()` that redraws nav, storage, title, toolbar, content and details.
4. **Nav and storage meter**, including the active pill and the expandable My Drive tree.
5. **List view:** header with sort, rows, hover quick actions, then **grid view**.
6. **Empty states** for every view (§4.1 copy).
7. **UI primitives:** menu with cascading submenus and viewport clamping, dialog (Esc/Enter, scrim), snackbar with Undo, tooltips.
8. **New menu**, New folder, and native-file creation with the simulated editor.
9. **Selection model** (click, Ctrl, Shift, Ctrl+A) and the selection bar.
10. **Context menu** and every action in §4.3. Add Undo wherever Drive offers it.
11. **Share** and **Move** dialogs.
12. **Uploads** (picker, folder picker, progress tray) and **drag-drop** (OS files and internal moves).
13. **Trash** lifecycle (trash → restore / delete forever / empty).
14. **Search:** dropdown suggestions, results view, filter chips, Advanced search.
15. **Details/Activity panel.**
16. **Keyboard shortcuts.**
17. **Responsive** breakpoints and adaptive columns.
18. **Practice guide** layer on top of the event bus.

---

## 9. QA checklist (run before release)
- [ ] Fresh load: Home shows the welcome empty state, storage reads "0 bytes of 15 GB used", and the guide shows 0 of 13.
- [ ] New › New folder › Enter creates the folder **and does not open it**.
- [ ] Upload two files: the tray animates and completes, and the storage meter rises.
- [ ] Right-click a file › Organise › Move into a folder › Undo returns it.
- [ ] Drag a file onto a folder row moves it. Dragging from the desktop onto the page uploads.
- [ ] Double-click an image opens the dark viewer, and ← → step between files.
- [ ] New › Google Docs › Blank document: editor opens. Renaming via the title updates the list.
- [ ] Share: add `a@b.co`, Send; the 👥 badge appears and Details shows "Shared with 1 person".
- [ ] Star appears in the row and in Starred. Recent groups items under "Today".
- [ ] Delete moves to Trash. Restore returns the item to its original folder. Empty trash confirms first.
- [ ] Search "untitled" lists matches. Type chip › Folders filters.
- [ ] `V`, `D`, `?`, `/` and `Shift+F` shortcuts work. Esc closes menus and dialogs.
- [ ] Resize to 800 px: hamburger drawer appears and nothing overflows horizontally.
- [ ] `?guide=off` hides the guide completely.

---

## 10. Intentional simplifications
- No persistence (by design: every session starts as a new account). To keep work between reloads, serialise `Store.S.items` to `localStorage` in a `Bus.on('render')` handler.
- Docs/Sheets/Slides open in an in-page **simulated editor**, not a new tab, and every simulated editor is labelled as such.
- No real sharing, emails, comments, version history, Shared drives, offline sync or AI features. Each one says it's unavailable rather than failing silently.
- Dropping a *folder* from the desktop asks the learner to use **New › Folder upload**, because browsers expose dropped directories inconsistently.

## 11. Branding and fonts
- `assets/logo.svg` is a **neutral placeholder**, not Google's logo, and the file-type icons are generic shapes in product-like colours. If your organisation has permission to use Google's brand assets (for example under a Google for Education partnership), replace `logo.svg` and the SVGs in `icons.js`. The app's own instructions call it "Drive" and "Google Docs" only as names of the features being taught.
- Material Symbols (Apache 2.0) and Roboto (SIL Open Font License) are bundled. Their licence files are in `assets/fonts/`. Google Sans loads from Google Fonts when online and falls back to Roboto offline.
