// system-dialog.js
// Modern replacement for native prompt(), alert(), and confirm()

window.SystemDialog = {
    alert: function (message) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[20000] p-4';
            overlay.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm border border-gray-100 ring-1 ring-black/5" id="sys-dialog-container" style="transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); transform: scale(0.9) translateY(20px); opacity: 0;">
                    <div class="mb-5">
                        <div class="flex items-center space-x-4 mb-3">
                            <div class="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 shadow-inner">
                                <i class="fas fa-info-circle text-xl"></i>
                            </div>
                            <div>
                                <h3 class="text-xl font-extrabold text-gray-900 tracking-tight">System Notification</h3>
                                <p class="text-xs font-semibold text-blue-500 uppercase tracking-wider">Information</p>
                            </div>
                        </div>
                        <div class="bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <p class="text-gray-700 leading-relaxed font-medium">${message.replace(/\n/g, '<br>')}</p>
                        </div>
                    </div>
                    <div class="flex">
                        <button id="sys-dialog-ok" class="flex-1 px-6 py-3.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 active:scale-95 transition-all font-black text-center shadow-lg shadow-indigo-200 uppercase tracking-widest text-sm">
                            Got it
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const container = overlay.querySelector('#sys-dialog-container');
            const okBtn = overlay.querySelector('#sys-dialog-ok');

            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';

            requestAnimationFrame(() => {
                container.style.transform = 'scale(1) translateY(0)';
                container.style.opacity = '1';
                okBtn.focus();
            });

            const cleanup = () => {
                container.style.transform = 'scale(0.95) translateY(10px)';
                container.style.opacity = '0';
                document.body.style.overflow = originalOverflow;
                setTimeout(() => {
                    if (document.body.contains(overlay)) document.body.removeChild(overlay);
                    resolve();
                }, 200);
            };

            okBtn.onclick = cleanup;
            overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                    if (document.body.contains(overlay)) cleanup();
                }
            }, { once: true });
        });
    },

    confirm: function (message) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[20000] p-4';
            overlay.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md border border-gray-100 ring-1 ring-black/5" id="sys-dialog-container" style="transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); transform: scale(0.9) translateY(20px); opacity: 0;">
                    <div class="mb-5">
                        <div class="flex items-center space-x-4 mb-3">
                            <div class="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 shadow-inner">
                                <i class="fas fa-exclamation-triangle text-xl"></i>
                            </div>
                            <div>
                                <h3 class="text-xl font-extrabold text-gray-900 tracking-tight">Confirm Action</h3>
                                <p class="text-xs font-semibold text-amber-500 uppercase tracking-wider">Verification Required</p>
                            </div>
                        </div>
                        <div class="bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <p class="text-gray-700 leading-relaxed font-medium">${message.replace(/\n/g, '<br>')}</p>
                        </div>
                    </div>
                    <div class="flex flex-row-reverse gap-3">
                        <button id="sys-dialog-ok" class="flex-1 px-6 py-3.5 bg-amber-600 text-white rounded-xl hover:bg-amber-700 active:scale-95 transition-all font-black text-center shadow-lg shadow-amber-200 uppercase tracking-widest text-sm">
                            Confirm
                        </button>
                        <button id="sys-dialog-cancel" class="flex-1 px-6 py-3.5 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 active:scale-95 transition-all font-bold text-center uppercase tracking-widest text-sm">
                            Cancel
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const container = overlay.querySelector('#sys-dialog-container');
            const okBtn = overlay.querySelector('#sys-dialog-ok');
            const cancelBtn = overlay.querySelector('#sys-dialog-cancel');

            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';

            requestAnimationFrame(() => {
                container.style.transform = 'scale(1) translateY(0)';
                container.style.opacity = '1';
                okBtn.focus();
            });

            const cleanup = (result) => {
                container.style.transform = 'scale(0.95) translateY(10px)';
                container.style.opacity = '0';
                document.body.style.overflow = originalOverflow;
                setTimeout(() => {
                    if (document.body.contains(overlay)) document.body.removeChild(overlay);
                    resolve(result);
                }, 200);
            };

            okBtn.onclick = () => cleanup(true);
            cancelBtn.onclick = () => cleanup(false);
            overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };

            const keyHandler = (e) => {
                if (e.key === 'Enter') { cleanup(true); window.removeEventListener('keydown', keyHandler); }
                if (e.key === 'Escape') { cleanup(false); window.removeEventListener('keydown', keyHandler); }
            };
            window.addEventListener('keydown', keyHandler);
        });
    },

    prompt: function (message, defaultValue = "") {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[20000] p-4';
            overlay.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md border border-gray-100 ring-1 ring-black/5" id="sys-dialog-container" style="transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); transform: scale(0.9) translateY(20px); opacity: 0;">
                    <div class="mb-5">
                        <div class="flex items-center space-x-4 mb-3">
                            <div class="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 shadow-inner">
                                <i class="fas fa-keyboard text-xl"></i>
                            </div>
                            <div>
                                <h3 class="text-xl font-extrabold text-gray-900 tracking-tight">System Input</h3>
                                <p class="text-xs font-semibold text-indigo-500 uppercase tracking-wider">Required Action</p>
                            </div>
                        </div>
                        <div class="bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <p class="text-gray-700 leading-relaxed font-medium">${message.replace(/\n/g, '<br>')}</p>
                        </div>
                    </div>
                    <div class="mb-6 relative">
                        <input type="text" id="sys-dialog-input" value="${defaultValue}"
                            class="w-full bg-white border-2 border-gray-200 rounded-xl px-4 py-4 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all text-lg font-bold text-gray-800 placeholder-gray-400 shadow-sm"
                            placeholder="Type here..."
                            autocomplete="off">
                    </div>
                    <div class="flex flex-row-reverse gap-3">
                        <button id="sys-dialog-ok" class="flex-1 px-6 py-3.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 active:scale-95 transition-all font-black text-center shadow-lg shadow-indigo-200 uppercase tracking-widest text-sm">
                            Confirm
                        </button>
                        <button id="sys-dialog-cancel" class="flex-1 px-6 py-3.5 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 active:scale-95 transition-all font-bold text-center uppercase tracking-widest text-sm">
                            Cancel
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const container = overlay.querySelector('#sys-dialog-container');
            const input = overlay.querySelector('#sys-dialog-input');
            const okBtn = overlay.querySelector('#sys-dialog-ok');
            const cancelBtn = overlay.querySelector('#sys-dialog-cancel');

            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';

            requestAnimationFrame(() => {
                container.style.transform = 'scale(1) translateY(0)';
                container.style.opacity = '1';
                input.focus();
                input.select();
            });

            const cleanup = (result) => {
                container.style.transform = 'scale(0.95) translateY(10px)';
                container.style.opacity = '0';
                document.body.style.overflow = originalOverflow;
                setTimeout(() => {
                    if (document.body.contains(overlay)) document.body.removeChild(overlay);
                    resolve(result);
                }, 200);
            };

            okBtn.onclick = () => cleanup(input.value);
            cancelBtn.onclick = () => cleanup(null);
            overlay.onclick = (e) => { if (e.target === overlay) cleanup(null); };

            input.onkeydown = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); okBtn.click(); }
                if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
            };
        });
    }
};
