// ==UserScript==
// @name         Cache Offline (IndexedDB) + Botão Limpar
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Salva HTML, CSS, JS, imagens e fontes no IndexedDB com botão para limpar
// @author       Você
// @match        https://github.com*
// @match        http://github.com*
// @match        http://www.github.com*
// @match        https://www.github.com*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const DB_NAME = 'offline_cache_db';
    const DB_VERSION = 1;
    const STORE_META = 'meta';      // metadados (url, título, data)
    const STORE_FILES = 'files';    // recursos binários (key = url)

    // ---------- INDEXEDDB HELPERS ----------
    function abrirDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_META)) {
                    db.createObjectStore(STORE_META, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORE_FILES)) {
                    const s = db.createObjectStore(STORE_FILES, { keyPath: 'url' });
                    s.createIndex('tipo', 'tipo', { unique: false });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function putMeta(meta) {
        const db = await abrirDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_META, 'readwrite');
            tx.objectStore(STORE_META).put(meta);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function putFile(url, blob, tipo) {
        const db = await abrirDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_FILES, 'readwrite');
            tx.objectStore(STORE_FILES).put({ url, blob, tipo, data: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function getMeta(id) {
        const db = await abrirDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_META, 'readonly');
            const req = tx.objectStore(STORE_META).get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function contarArquivos() {
        const db = await abrirDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_FILES, 'readonly');
            const req = tx.objectStore(STORE_FILES).count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function tamanhoTotal() {
        const db = await abrirDB();
        return new Promise((resolve, reject) => {
            let total = 0;
            const tx = db.transaction(STORE_FILES, 'readonly');
            const req = tx.objectStore(STORE_FILES).openCursor();
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    total += cursor.value.blob?.size || 0;
                    cursor.continue();
                } else resolve(total);
            };
            req.onerror = () => reject(req.error);
        });
    }

    async function limparTudo() {
        const db = await abrirDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_META, STORE_FILES], 'readwrite');
            tx.objectStore(STORE_META).clear();
            tx.objectStore(STORE_FILES).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // ---------- UI ----------
    function criarUI() {
        if (document.getElementById('oidb-ui')) return;

        const box = document.createElement('div');
        box.id = 'oidb-ui';
        box.style.cssText = `
            position: fixed; bottom: 15px; right: 15px; z-index: 999999;
            font-family: sans-serif; display: flex; gap: 6px; flex-direction: column;
            background: rgba(0,0,0,0.85); padding: 10px; border-radius: 8px;
            color: #fff; font-size: 12px; box-shadow: 0 0 10px #000;
            min-width: 200px;
        `;

        const info = document.createElement('div');
        info.id = 'oidb-info';
        info.textContent = 'Calculando...';

        const btnSalvar = document.createElement('button');
        btnSalvar.textContent = '💾 Salvar tudo agora';
        btnSalvar.style.cssText = 'padding:6px;cursor:pointer;border-radius:4px;border:none;background:#2ecc71;color:#000;font-weight:bold;';

        const btnLimpar = document.createElement('button');
        btnLimpar.textContent = '🗑️ Limpar IndexedDB';
        btnLimpar.style.cssText = 'padding:6px;cursor:pointer;border-radius:4px;border:none;background:#e74c3c;color:#fff;font-weight:bold;';

        const btnDump = document.createElement('button');
        btnDump.textContent = '📄 Ver resumo';
        btnDump.style.cssText = 'padding:6px;cursor:pointer;border-radius:4px;border:none;background:#3498db;color:#fff;font-weight:bold;';

        btnSalvar.onclick = () => salvarTudo(true);
        btnLimpar.onclick = async () => {
            if (confirm('Apagar TODOS os dados do IndexedDB offline_cache_db?')) {
                await limparTudo();
                alert('🗑️ IndexedDB limpo.');
                atualizarInfo();
            }
        };
        btnDump.onclick = async () => {
            const meta = await getMeta(location.origin + location.pathname);
            console.log('[offline-cache] meta:', meta);
            alert('Abra o console (F12) para ver o resumo completo.');
        };

        box.appendChild(info);
        box.appendChild(btnSalvar);
        box.appendChild(btnDump);
        box.appendChild(btnLimpar);
        document.body.appendChild(box);
    }

    async function atualizarInfo() {
        const el = document.getElementById('oidb-info');
        if (!el) return;
        try {
            const [n, bytes] = await Promise.all([contarArquivos(), tamanhoTotal()]);
            el.textContent = `📦 ${n} recursos • ${(bytes / 1024).toFixed(1)} KB`;
        } catch (e) {
            el.textContent = 'Erro ao ler DB';
        }
    }

    // ---------- CAPTURA ----------
    function listarRecursos() {
        const urls = new Set();
        document.querySelectorAll('link[rel="stylesheet"], script[src], img[src], source[src], video[src], audio[src]')
            .forEach(el => {
                const u = el.href || el.src;
                if (u && u.startsWith('http')) urls.add(u);
            });
        const icon = document.querySelector('link[rel*="icon"]');
        if (icon?.href) urls.add(icon.href);

        // Fontes declaradas em CSS inline
        document.querySelectorAll('style').forEach(s => {
            const matches = s.textContent.match(/url\((['"]?)(https?:\/\/[^)'"]+)\1\)/g) || [];
            matches.forEach(m => {
                const u = m.replace(/url\(['"]?|['"]?\)/g, '');
                if (u.startsWith('http')) urls.add(u);
            });
        });

        return [...urls];
    }

    async function baixarBlob(url) {
        try {
            const resp = await fetch(url, { credentials: 'include' });
            if (!resp.ok) return null;
            const blob = await resp.blob();
            return blob;
        } catch (e) {
            console.warn('[offline-cache] falha:', url, e);
            return null;
        }
    }

    async function salvarTudo(manual = false) {
        const el = document.getElementById('oidb-info');
        if (el) el.textContent = '⏳ Capturando...';

        try {
            // 1) Meta + HTML
            const clone = document.documentElement.cloneNode(true);
            clone.querySelectorAll('#oidb-ui').forEach(n => n.remove());

            const meta = {
                id: location.origin + location.pathname,
                origem: location.origin,
                url: location.href,
                titulo: document.title,
                data: new Date().toISOString(),
                html: '<!DOCTYPE html>\n' + clone.outerHTML
            };
            await putMeta(meta);

            // 2) Recursos binários
            const recursos = listarRecursos();
            let i = 0, salvos = 0, falhas = 0;

            for (const url of recursos) {
                i++;
                if (el) el.textContent = `⏳ ${i}/${recursos.length}`;
                const blob = await baixarBlob(url);
                if (blob) {
                    await putFile(url, blob, blob.type || 'application/octet-stream');
                    salvos++;
                } else {
                    falhas++;
                }
            }

            if (manual) {
                alert(`✅ Salvo!\n${salvos} recursos ok\n${falhas} falhas\n\nConsulte a cota em DevTools → Application → Storage.`);
            }
        } catch (e) {
            console.error('[offline-cache] erro:', e);
            alert('❌ Erro: ' + e.message);
        }

        atualizarInfo();
    }

    // ---------- INICIALIZAÇÃO ----------
    setTimeout(() => {
        criarUI();
        salvarTudo(false);
    }, 1500);
})();
