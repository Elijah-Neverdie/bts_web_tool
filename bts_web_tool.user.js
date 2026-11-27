// ==UserScript==
// @name         bts_web_tool
// @name:zh-CN   bts_web_tool
// @namespace    https://btsow.live/
// @version      2.0.0
// @description  Restyle BTSOW magnet conversion and search results in a cold, desaturated layout. Copy magnet links, and send detail-page magnets to the NAS Xunlei engine.
// @description:zh-CN  把 BTSOW 磁力转换页、搜索结果和详情页改成性冷淡排版；支持复制磁力，并把详情页磁力一键发送到 NAS 迅雷引擎。
// @match        *://btsow.live/*
// @match        *://*.btsow.live/*
// @include      /^https?:\/\/[^/]+\/webman\/3rdparty\/pan-xunlei-com\/index\.cgi\/.*$/
// @require      file:///E:/Code/cursor_projects/nas-xunlei-lib/nas-xunlei-button.lib.js
// @run-at       document-start
// @noframes
// @connect      10.10.10.10
// @connect      10.144.0.1
// @connect      REDACTED_IPV6
// @connect      *
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// ==/UserScript==

(function () {
  'use strict';

  if (location.host.indexOf('btsow.live') === -1) return; // 只在 btsow 页面运行

  if (window.top !== window) return;
  if (window.__btsowCold) return;
  window.__btsowCold = true;

  const CSS = `
html.btsow-cold {
  background: #f3f2ee !important;
  color-scheme: light;
}
html.btsow-cold body {
  background: #f3f2ee !important;
  color: #1c1b19 !important;
  font-family: "Avenir Next", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei UI", sans-serif !important;
  font-weight: 400 !important;
  letter-spacing: 0.01em;
}
html.btsow-cold ::selection {
  background: #1c1b19;
  color: #f3f2ee;
}

html.btsow-cold .q-header,
html.btsow-cold .q-header.bg-grey-9,
html.btsow-cold .q-header.toolbar-bg,
html.btsow-cold .q-header.glossy {
  background: #f3f2ee !important;
  color: #1c1b19 !important;
  box-shadow: none !important;
  border-bottom: 1px solid #1c1b19;
}
html.btsow-cold .q-header.glossy::before,
html.btsow-cold .q-header.glossy::after,
html.btsow-cold .q-layout__shadow {
  display: none !important;
  background: none !important;
}
html.btsow-cold .q-header .q-toolbar {
  min-height: 58px !important;
  color: #1c1b19 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}
html.btsow-cold .q-header .text-white,
html.btsow-cold .q-header .q-toolbar__title {
  color: #1c1b19 !important;
}
html.btsow-cold .q-header img {
  height: 16px !important;
  width: auto !important;
  filter: grayscale(1) contrast(1.15);
  opacity: 0.8;
}
html.btsow-cold .q-toolbar__title {
  font-family: "Palatino Linotype", "Songti SC", "STSong", "PMingLiU", serif !important;
  font-size: 15px !important;
  font-weight: 400 !important;
  letter-spacing: 0.34em !important;
  line-height: 1 !important;
  min-width: 0 !important;
  padding-left: 10px !important;
}
html.btsow-cold .material-icons,
html.btsow-cold .q-icon {
  font-family: "Material Icons" !important;
  font-weight: normal !important;
  font-style: normal !important;
  letter-spacing: normal !important;
  text-transform: none !important;
  line-height: 1 !important;
}
html.btsow-cold .q-header .q-toolbar.q-container,
html.btsow-cold .q-page-container.q-container {
  max-width: none !important;
  width: 100% !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
  padding-left: clamp(32px, 2.8vw, 56px) !important;
  padding-right: clamp(32px, 2.8vw, 56px) !important;
  box-sizing: border-box;
}
html.btsow-cold .q-header .q-toolbar > a {
  flex: none;
}
html.btsow-cold .q-header .q-btn-toggle {
  flex: none;
  margin-left: 32px !important;
}
html.btsow-cold .q-page-container {
  background: transparent !important;
  padding-top: 58px !important;
}

html.btsow-cold .YL__toolbar-input-container {
  align-items: center;
  flex: 1 1 auto !important;
  width: auto !important;
  max-width: none !important;
  border-bottom: 1px solid #1c1b19;
  margin-right: 0 !important;
  padding-right: 0 !important;
  min-width: 0;
}
html.btsow-cold .YL__toolbar-input-container .q-field,
html.btsow-cold .YL__toolbar-input-container .q-field__control,
html.btsow-cold .YL__toolbar-input-container .bg-white {
  background: transparent !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}
html.btsow-cold .YL__toolbar-input-container .q-field__control::before,
html.btsow-cold .YL__toolbar-input-container .q-field__control::after {
  border: none !important;
}
html.btsow-cold .YL__toolbar-input-container .q-field__native {
  color: #1c1b19 !important;
  font-size: 13px !important;
  letter-spacing: 0.04em;
  padding-top: 6px !important;
  padding-bottom: 6px !important;
}
html.btsow-cold .YL__toolbar-input-container .q-field__native::placeholder {
  color: #a39e94 !important;
  letter-spacing: 0.12em;
}
html.btsow-cold .YL__toolbar-input-container .q-btn,
html.btsow-cold .YL__toolbar-input-container .q-btn.bg-grey-3 {
  background: transparent !important;
  color: #1c1b19 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  min-width: 36px;
}
html.btsow-cold .YL__toolbar-input-container .q-icon {
  color: #1c1b19 !important;
  font-size: 18px !important;
}

html.btsow-cold .q-btn-toggle {
  background: transparent !important;
  box-shadow: none !important;
  border-radius: 0 !important;
}
html.btsow-cold .q-btn-toggle .q-btn {
  background: transparent !important;
  color: #8d897f !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  min-height: 58px;
}
html.btsow-cold .q-btn-toggle .q-btn .block {
  color: inherit !important;
  font-weight: 400 !important;
  letter-spacing: 0.16em;
  font-size: 11px !important;
  text-transform: uppercase;
}
html.btsow-cold .q-btn-toggle .q-btn .q-icon {
  color: inherit !important;
  font-size: 16px !important;
}
html.btsow-cold .q-btn-toggle .q-btn[aria-pressed="true"] {
  color: #1c1b19 !important;
  box-shadow: inset 0 -1px 0 #1c1b19 !important;
}
html.btsow-cold .q-focus-helper {
  opacity: 0 !important;
}
html.btsow-cold .q-btn:focus-visible,
html.btsow-cold a:focus-visible,
html.btsow-cold input:focus-visible,
html.btsow-cold textarea:focus-visible {
  outline: 1px solid #1c1b19;
  outline-offset: 2px;
}

html.btsow-cold iframe,
html.btsow-cold .tags-recommendation-ad-grid,
html.btsow-cold .upload-container > div:has(iframe),
html.btsow-cold .row:has(iframe),
html.btsow-cold .q-px-md:has(iframe),
html.btsow-cold .q-pb-md:has(iframe) {
  display: none !important;
}

html.btsow-cold .q-page-container > .tags-box,
html.btsow-cold .detail .tags-box {
  padding: 22px 8px 4px !important;
  margin: 0 !important;
  line-height: 2.15 !important;
  font-size: 13px !important;
  word-break: break-word;
}
html.btsow-cold .tags-box .ln {
  display: none !important;
}
html.btsow-cold .tags-box a.tag,
html.btsow-cold .tags-box a.tag.t1,
html.btsow-cold .tags-box a.tag.t2,
html.btsow-cold .tags-box a.tag.t3,
html.btsow-cold .tags-box a.tag.t4,
html.btsow-cold .tags-box a.tag.t5,
html.btsow-cold .tags-box a.tag.t6,
html.btsow-cold .tags-box a.tag.t7,
html.btsow-cold .tags-box a.tag.t8,
html.btsow-cold .tags-box a.tag.t9 {
  display: inline !important;
  background: transparent !important;
  color: #6f6b63 !important;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  text-shadow: none !important;
  font-weight: 400 !important;
  font-size: 13px !important;
  margin: 0 !important;
  padding: 0 !important;
  text-decoration: none !important;
}
html.btsow-cold .tags-box > a.tag + a.tag::before {
  content: "·";
  display: inline-block;
  margin: 0 0.72em;
  color: #c8c3b8 !important;
  font-weight: 400;
  pointer-events: none;
}
html.btsow-cold .tags-box a.tag:hover,
html.btsow-cold .tags-box a.router-link-active {
  color: #1c1b19 !important;
}
html.btsow-cold .tags-box a.router-link-active {
  box-shadow: inset 0 -1px 0 #1c1b19;
}

html.btsow-cold .data-list {
  padding-top: 8px;
}
html.btsow-cold .data-list .data-row {
  align-items: baseline !important;
  background: transparent !important;
  border: none !important;
  border-bottom: 1px solid #e3e0d8 !important;
  margin: 0 !important;
  padding: 15px 0 !important;
}
html.btsow-cold .data-list:not(.detail) > .data-row,
html.btsow-cold .data-list:not(.detail) .q-infinite-scroll > .data-row {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) 6.5rem 8.75rem;
  column-gap: 2.5rem;
}
html.btsow-cold .data-list:not(.detail) .data-row > div {
  width: auto !important;
  max-width: none !important;
  flex: none !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}
html.btsow-cold .detail.data-list > .data-row:has(.value) {
  display: grid !important;
  grid-template-columns: 10rem minmax(0, 1fr);
  column-gap: 1.75rem;
}
html.btsow-cold .detail.data-list > .data-row:not(:has(.value)) {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) 8.75rem;
  column-gap: 2.5rem;
}
html.btsow-cold .detail.data-list > .data-row > div {
  width: auto !important;
  max-width: none !important;
  flex: none !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}
html.btsow-cold .data-list .data-row:hover {
  background: rgba(28, 27, 25, 0.035) !important;
}
html.btsow-cold .data-list .thead,
html.btsow-cold .data-list .thead:hover {
  background: transparent !important;
  border-bottom: 1px solid #1c1b19 !important;
  padding-top: 18px !important;
  padding-bottom: 8px !important;
}
html.btsow-cold .data-list .field {
  margin: 0 !important;
  color: #8d897f !important;
  font-weight: 400 !important;
  font-size: 10px !important;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
html.btsow-cold .data-list a,
html.btsow-cold .data-list a:hover {
  color: #1c1b19 !important;
  text-decoration: none !important;
}
html.btsow-cold .data-list a.file,
html.btsow-cold .data-list .file {
  margin: 0 !important;
  font-size: 14px !important;
  line-height: 1.5 !important;
  font-weight: 400 !important;
  word-break: break-word;
}
html.btsow-cold .data-list em {
  color: inherit !important;
  font-style: normal !important;
  background-image: linear-gradient(#1c1b19, #1c1b19);
  background-repeat: no-repeat;
  background-size: 100% 1px;
  background-position: 0 1.08em;
}
html.btsow-cold .data-list .size,
html.btsow-cold .data-list .date,
html.btsow-cold .data-list .size-date {
  color: #8d897f !important;
  font-weight: 400 !important;
  font-size: 12px !important;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.03em;
}
html.btsow-cold .cold-title {
  display: flex !important;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 14px;
  row-gap: 4px;
}
html.btsow-cold .cold-title > a.file {
  flex: 1 1 auto;
  min-width: 0;
}
html.btsow-cold .cold-title > .size-date {
  flex: 1 0 100%;
}
html.btsow-cold .cold-copy {
  appearance: none;
  background: transparent;
  border: none;
  border-bottom: 1px solid transparent;
  color: #8d897f;
  cursor: pointer;
  flex: none;
  font: 400 11px/1 "Avenir Next", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;
  letter-spacing: 0.2em;
  margin: 0;
  padding: 0 0 2px;
}
html.btsow-cold .cold-copy:hover,
html.btsow-cold .cold-copy[data-state="ok"] {
  color: #1c1b19;
  border-bottom-color: #1c1b19;
}

html.btsow-cold main.q-page {
  max-width: none;
  width: 100%;
  margin: 0;
  padding: 8px 0 64px !important;
}
html.btsow-cold main.q-page:not(.flex-center) {
  min-height: 0 !important;
  align-items: stretch !important;
  justify-content: flex-start !important;
}
html.btsow-cold main.q-page.flex-center {
  min-height: calc(100vh - 58px) !important;
}
html.btsow-cold .force-break {
  font-family: "Palatino Linotype", "Songti SC", "STSong", "PMingLiU", serif !important;
  font-weight: 400 !important;
  font-size: 14px !important;
  line-height: 1.45 !important;
  letter-spacing: 0 !important;
  color: #1c1b19 !important;
  text-align: left !important;
  margin: 20px 0 10px !important;
  padding: 0 !important;
}
html.btsow-cold textarea.magnet-link,
html.btsow-cold textarea.detail-link {
  display: block;
  width: 100% !important;
  margin: 0;
  background: transparent !important;
  color: #3f3d38 !important;
  border: 1px solid #d5d1c8 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  font-family: "Cascadia Mono", "Sarasa Mono SC", Consolas, "Source Code Pro", ui-monospace, monospace !important;
  font-size: 12px !important;
  line-height: 1.55 !important;
  letter-spacing: 0.01em;
  padding: 14px 16px !important;
  resize: vertical;
}
html.btsow-cold textarea.magnet-link {
  height: auto !important;
  min-height: 4.6em;
}
html.btsow-cold textarea.detail-link {
  height: auto !important;
  min-height: 3em;
}
html.btsow-cold .detail .data-row {
  padding-top: 12px !important;
  padding-bottom: 12px !important;
}
html.btsow-cold .detail .hash {
  font-family: "Cascadia Mono", Consolas, ui-monospace, monospace !important;
  font-size: 12px !important;
  letter-spacing: 0.04em;
  color: #1c1b19 !important;
}
html.btsow-cold .detail .value {
  color: #1c1b19 !important;
  font-size: 14px;
}
html.btsow-cold .glyphicon {
  color: #8d897f !important;
}

html.btsow-cold .upload-container {
  align-items: stretch !important;
  border: none !important;
  gap: 0 !important;
  width: min(460px, calc(100vw - 48px)) !important;
  min-width: 0 !important;
  padding: 0 !important;
  background: transparent !important;
}
html.btsow-cold .b2m,
html.btsow-cold .m2b {
  display: none !important;
}
html.btsow-cold .upload-btn,
html.btsow-cold .upload-btn.bg-light-green-7 {
  background: transparent !important;
  color: #1c1b19 !important;
  border: 1px solid #1c1b19 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  min-height: 46px !important;
  height: 46px;
  padding: 0 24px !important;
  width: 100%;
  font-size: 12px !important;
  font-weight: 400 !important;
  letter-spacing: 0.18em !important;
  text-transform: uppercase !important;
}
html.btsow-cold .upload-btn .block,
html.btsow-cold .upload-btn .q-btn__content {
  color: inherit !important;
  font-weight: 400 !important;
  letter-spacing: 0.18em;
}
html.btsow-cold .upload-btn:hover,
html.btsow-cold .upload-btn:hover .block,
html.btsow-cold .upload-btn:hover .q-btn__content {
  background: #1c1b19 !important;
  color: #f3f2ee !important;
}

html.btsow-cold main.q-page .q-gutter-sm {
  margin-top: 8px !important;
  justify-content: flex-start !important;
}
html.btsow-cold main.q-page .q-btn.bg-primary,
html.btsow-cold main.q-page .q-btn.bg-secondary,
html.btsow-cold main.q-page a.q-btn.bg-red,
html.btsow-cold main.q-page .q-btn.bg-primary .q-btn__content,
html.btsow-cold main.q-page .q-btn.bg-secondary .q-btn__content,
html.btsow-cold main.q-page a.q-btn.bg-red .q-btn__content,
html.btsow-cold main.q-page .q-btn .block,
html.btsow-cold main.q-page .q-btn .q-icon {
  background: transparent !important;
  color: #1c1b19 !important;
  box-shadow: none !important;
}
html.btsow-cold main.q-page .q-btn.bg-primary,
html.btsow-cold main.q-page .q-btn.bg-secondary,
html.btsow-cold main.q-page a.q-btn.bg-red {
  border: 1px solid #1c1b19 !important;
  border-radius: 0 !important;
  min-height: 36px;
  padding: 0 16px !important;
}
html.btsow-cold main.q-page .q-btn .block {
  font-size: 11px !important;
  font-weight: 400 !important;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
html.btsow-cold main.q-page .q-btn--push::before,
html.btsow-cold main.q-page .q-btn--push::after {
  display: none !important;
}
html.btsow-cold main.q-page .q-btn.bg-primary:hover,
html.btsow-cold main.q-page .q-btn.bg-secondary:hover,
html.btsow-cold main.q-page a.q-btn.bg-red:hover {
  background: #1c1b19 !important;
}
html.btsow-cold main.q-page .q-btn.bg-primary:hover .q-btn__content,
html.btsow-cold main.q-page .q-btn.bg-secondary:hover .q-btn__content,
html.btsow-cold main.q-page a.q-btn.bg-red:hover .q-btn__content,
html.btsow-cold main.q-page .q-btn.bg-primary:hover .block,
html.btsow-cold main.q-page .q-btn.bg-secondary:hover .block,
html.btsow-cold main.q-page a.q-btn.bg-red:hover .block,
html.btsow-cold main.q-page .q-btn.bg-primary:hover .q-icon,
html.btsow-cold main.q-page .q-btn.bg-secondary:hover .q-icon,
html.btsow-cold main.q-page a.q-btn.bg-red:hover .q-icon {
  color: #f3f2ee !important;
}

html.btsow-cold .alert,
html.btsow-cold .alert-danger {
  background: transparent !important;
  color: #1c1b19 !important;
  border: 1px solid #1c1b19 !important;
  border-radius: 0 !important;
  font-weight: 400 !important;
}
html.btsow-cold .q-spinner,
html.btsow-cold .text-primary {
  color: #1c1b19 !important;
}
html.btsow-cold .q-loading-bar {
  background: #1c1b19 !important;
}
html.btsow-cold .q-notification {
  background: #1c1b19 !important;
  color: #f3f2ee !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}

@media (max-width: 720px) {
  html.btsow-cold .q-header .q-toolbar.q-container,
  html.btsow-cold .q-page-container.q-container {
    padding-left: 16px !important;
    padding-right: 16px !important;
  }
  html.btsow-cold .q-toolbar__title {
    letter-spacing: 0.22em !important;
    font-size: 14px !important;
  }
  html.btsow-cold .q-btn-toggle .q-btn .block {
    display: none !important;
  }
  html.btsow-cold .data-list:not(.detail) > .data-row,
  html.btsow-cold .data-list:not(.detail) .q-infinite-scroll > .data-row,
  html.btsow-cold .detail.data-list > .data-row:has(.value),
  html.btsow-cold .detail.data-list > .data-row:not(:has(.value)) {
    display: flex !important;
    grid-template-columns: none;
    column-gap: 0;
  }
  html.btsow-cold .upload-container {
    min-width: 0;
    padding: 40px 20px !important;
  }
  html.btsow-cold .force-break {
    font-size: 14px !important;
  }
}
`;

  function injectStyle() {
    const root = document.documentElement;
    if (!root) return false;
    root.classList.add('btsow-cold');
    if (!document.getElementById('btsow-cold-style')) {
      const style = document.createElement('style');
      style.id = 'btsow-cold-style';
      style.textContent = CSS;
      (document.head || root).appendChild(style);
    }
    return true;
  }

  function magnetFromAnchor(anchor) {
    const href = anchor.getAttribute('href') || '';
    const match = href.match(/\/magnet\/detail\/([A-Fa-f0-9]{32,40})/);
    if (!match) return '';
    const name = (anchor.textContent || '')
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const dn = name ? '&dn=' + encodeURIComponent(name) : '';
    return 'magnet:?xt=urn:btih:' + match[1] + dn;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy'));
      } catch (error) {
        reject(error);
      } finally {
        area.remove();
      }
    });
  }

  // btsow 详情页：在「Open with BT Client」右侧挂载 NAS 下载按钮（按钮与下载逻辑由库提供）
  function ensureNasButton(scope) {
    if (location.pathname.indexOf('/magnet/detail/') !== 0) return;
    if (!window.NasXunleiButton) return;
    const bt = (scope || document).querySelector('main.q-page .q-gutter-sm a.q-btn.bg-red');
    if (!bt || bt.parentElement.querySelector('.nasxl-btn')) return;
    new window.NasXunleiButton({
      name: 'Download To Nas',
      color: '#1c1b19',
      size: 'medium',
      position: { target: bt, where: 'afterend' },
      downloadLink: function () {
        const box = document.querySelector('textarea.magnet-link');
        return box ? box.value : '';
      }
    }).mount();
  }

  function decorate(scope) {
    ensureNasButton(scope || document);
    const rows = (scope || document).querySelectorAll('a.file[href*="/magnet/detail/"]');
    rows.forEach(function (anchor) {
      const row = anchor.closest('.data-row');
      if (!row || row.querySelector('.cold-copy')) return;
      const holder = anchor.parentElement;
      if (holder) holder.classList.add('cold-title');

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cold-copy';
      button.textContent = '复制';
      button.setAttribute('aria-label', '复制磁力链接');
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const magnet = magnetFromAnchor(anchor);
        if (!magnet) return;
        copyText(magnet).then(function () {
          button.dataset.state = 'ok';
          button.textContent = '已复制';
          window.setTimeout(function () {
            button.dataset.state = '';
            button.textContent = '复制';
          }, 1400);
        }).catch(function () {
          button.textContent = '失败';
          window.setTimeout(function () {
            button.textContent = '复制';
          }, 1400);
        });
      });
      anchor.insertAdjacentElement('afterend', button);
    });
  }

  let scheduled = false;
  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    const run = window.requestAnimationFrame || function (fn) { return window.setTimeout(fn, 16); };
    run(function () {
      scheduled = false;
      decorate(document);
    });
  }

  function boot() {
    if (!injectStyle()) return;
    decorate(document);
    if (!window.__btsowColdWatch) {
      window.__btsowColdWatch = true;
      const observer = new MutationObserver(scheduleDecorate);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (!injectStyle()) {
    const waiter = new MutationObserver(function () {
      if (injectStyle()) {
        waiter.disconnect();
        boot();
      }
    });
    waiter.observe(document, { childList: true, subtree: true });
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  return !!document.getElementById('btsow-cold-style');
})();
