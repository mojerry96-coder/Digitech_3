/* icons.js — file-type icon SVGs, extension → type mapping, Type-filter groups.
 * The shapes are generic placeholders in product-like colours (see §11 Branding).
 */
(function () {
  'use strict';

  const COLOR = {
    folder: '#444746', doc: '#4285f4', sheet: '#0f9d58', slide: '#f4b400', form: '#7248b9',
    pdf: '#ea4335', image: '#ea4335', video: '#ea4335', audio: '#ea4335', archive: '#5f6368',
    word: '#2b579a', excel: '#217346', powerpoint: '#d24726', text: '#4285f4', file: '#80868b',
    drawing: '#ea4335', mymaps: '#c5221f', sites: '#3a5bd9', script: '#4285f4'
  };

  const FOLDER = 'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z';
  const SHARED = '<circle cx="15" cy="11.5" r="2" fill="#fff"/><path d="M11 17v-.6c0-1.3 2.7-2 4-2s4 .7 4 2v.6z" fill="#fff"/>';
  const SHORTCUT = '<circle cx="6.5" cy="17.5" r="4.6" fill="#fff"/><circle cx="6.5" cy="17.5" r="3.6" fill="#444746"/><path d="M5 19l3-3m-2.2 0H8v2.2" stroke="#fff" stroke-width="1.2" fill="none" stroke-linecap="round"/>';

  // Drive's own file-type icons (assets/icons/type, from drive-thirdparty.googleusercontent.com)
  // and product icons (assets/icons/product, from www.gstatic.com). Folders stay vector so they
  // can take the 24 folder colours, exactly as Drive draws them with the Material folder glyph.
  const TYPE_PNG = ['doc', 'sheet', 'slide', 'form', 'pdf', 'image', 'video', 'audio', 'archive', 'word', 'excel',
    'powerpoint', 'text', 'file', 'drawing', 'mymaps', 'sites', 'script'];
  const ICON_BASE = 'assets/icons/';

  /** Icon markup for a type. opts: size, color (folders), shared, shortcut */
  function svg(type, o) {
    o = o || {};
    const s = o.size || 20;
    let out;
    if (type === 'folder' || type === 'shortcut') {
      const inner = type === 'folder'
        ? `<path d="${FOLDER}" fill="${o.color || COLOR.folder}"/>` + (o.shared ? SHARED : '')
        : `<path d="${FOLDER}" fill="#5f6368"/>` + SHORTCUT;
      out = `<svg class="tsvg" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner}</svg>`;
    } else {
      const name = TYPE_PNG.includes(type) ? type : 'file';
      out = `<img class="tsvg" src="${ICON_BASE}type/${name}.png" width="${s}" height="${s}" alt="" draggable="false">`;
    }
    if (o.shortcut && type !== 'shortcut') {
      out = `<span class="ticon" style="width:${s}px;height:${s}px">${out}<svg class="tbadge" viewBox="0 0 24 24" aria-hidden="true">${SHORTCUT}</svg></span>`;
    }
    return out;
  }

  /** A product icon (Drive, Docs, Calendar…). Never the Google "G" logo. */
  const product = (name, size) =>
    `<img class="tsvg" src="${ICON_BASE}product/${name}.png" width="${size || 24}" height="${size || 24}" alt="" draggable="false">`;

  const EXT = {
    pdf: 'pdf',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', heic: 'image', avif: 'image', ico: 'image',
    mp4: 'video', mov: 'video', webm: 'video', avi: 'video', mkv: 'video', m4v: 'video',
    mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', flac: 'audio', aac: 'audio',
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
    doc: 'word', docx: 'word', odt: 'word', rtf: 'word',
    xls: 'excel', xlsx: 'excel', ods: 'excel', csv: 'excel',
    ppt: 'powerpoint', pptx: 'powerpoint', odp: 'powerpoint',
    txt: 'text', md: 'text', json: 'text', js: 'text', ts: 'text', css: 'text', html: 'text', htm: 'text', xml: 'text', log: 'text', py: 'text'
  };

  function typeFromName(name, mime) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    if (m && EXT[m[1].toLowerCase()]) return EXT[m[1].toLowerCase()];
    mime = mime || '';
    if (mime === 'application/pdf') return 'pdf';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('text/')) return 'text';
    return 'file';
  }

  const TYPE_LABEL = {
    folder: 'Google Drive Folder', doc: 'Google Docs', sheet: 'Google Sheets', slide: 'Google Slides', form: 'Google Forms',
    pdf: 'PDF', image: 'Image', video: 'Video', audio: 'Audio', archive: 'Archive', word: 'Word',
    excel: 'Excel', powerpoint: 'PowerPoint', text: 'Text', file: 'File'
  };

  const TYPE_GROUPS = [
    { id: 'documents', label: 'Documents', types: ['doc', 'word', 'text'], icon: 'doc' },
    { id: 'spreadsheets', label: 'Spreadsheets', types: ['sheet', 'excel'], icon: 'sheet' },
    { id: 'presentations', label: 'Presentations', types: ['slide', 'powerpoint'], icon: 'slide' },
    { id: 'forms', label: 'Forms', types: ['form'], icon: 'form' },
    { id: 'photos', label: 'Photos & images', types: ['image'], icon: 'image' },
    { id: 'pdfs', label: 'PDFs', types: ['pdf'], icon: 'pdf' },
    { id: 'videos', label: 'Videos', types: ['video'], icon: 'video' },
    { id: 'audio', label: 'Audio', types: ['audio'], icon: 'audio' },
    { id: 'archives', label: 'Archives (zip)', types: ['archive'], icon: 'archive' },
    { id: 'shortcuts', label: 'Shortcuts', test: i => !!i.shortcutOf, icon: 'shortcut' },
    { id: 'folders', label: 'Folders', types: ['folder'], icon: 'folder' }
  ];

  const group = id => TYPE_GROUPS.find(g => g.id === id) || null;
  const inGroup = (g, item) => !g || (g.test ? g.test(item) : g.types.includes(item.type));
  const groupIcon = (g, size) => svg(g.icon, { size: size || 20 });

  window.Icons = { svg, product, typeFromName, TYPE_LABEL, TYPE_GROUPS, group, inGroup, groupIcon, COLOR };
})();
