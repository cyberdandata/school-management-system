// ==================== GLOBAL VARIABLES ====================
 let currentSchool = null;
let currentSettings = null;
let currentUser = { name: 'Admin', role: 'admin' };
let isCheckingSetup = false;
let notifications = [];

// ==================== FEE MANAGEMENT GLOBAL VARIABLES ====================
let feeLevelsData = [];
let feeStructuresData = [];
let feeBursariesData = [];
let currentFeeTab = 'fee-structures';


// ==================== PAGINATION VARIABLES ====================
let currentPage = 1;
let itemsPerPage = 10;
let filteredStudents = [];
let selectedStudents = new Set();

// ==================== ADDITIONAL FEES SELECTION ====================
let selectedAdditionalFeesArray = [];

// ==================== ACADEMIC YEAR & TERM GLOBALS ====================
// ==================== GLOBAL ACADEMIC SETTINGS ====================
// ==================== SYNC UI ====================

let syncStatus = {
    isOnline: false,
    lastSyncTime: null,
    hasUpdates: false
};

async function checkSyncStatus() {
    try {
        const response = await fetch('/api/sync/status');
        if (response.ok) {
            const data = await response.json();
            syncStatus = data;
            updateSyncUI();
        }
    } catch (error) {
        console.warn('Sync status check failed:', error);
    }
}

async function checkForUpdates() {
    try {
        const response = await fetch('/api/sync/check-updates');
        if (response.ok) {
            const data = await response.json();
            syncStatus.hasUpdates = data.hasUpdates;
            syncStatus.behind = data.behind;
            updateSyncUI();
            if (data.hasUpdates) {
                showToast(`📥 ${data.behind} update(s) available. Click sync to download.`, 'info');
            }
        }
    } catch (error) {
        console.warn('Update check failed:', error);
    }
}

async function triggerSync() {
    const btn = document.querySelector('#syncBtn');
    const originalText = btn?.innerHTML || 'Sync';
    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
        btn.disabled = true;
    }
    
    try {
        const response = await fetch('/api/sync/trigger', { method: 'POST' });
        if (response.ok) {
            showToast('✅ Sync completed successfully!', 'success');
            await checkSyncStatus();
            // Reload page to reflect changes
            setTimeout(() => location.reload(), 1000);
        } else {
            const error = await response.json();
            showToast('❌ Sync failed: ' + error.error, 'error');
        }
    } catch (error) {
        showToast('❌ Sync failed: ' + error.message, 'error');
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

function updateSyncUI() {
    const statusEl = document.getElementById('syncStatus');
    if (!statusEl) return;
    
    const statusDot = syncStatus.isOnline ? '🟢' : '🔴';
    const statusText = syncStatus.isOnline ? 'Online' : 'Offline';
    const lastSync = syncStatus.lastSyncTime ? new Date(syncStatus.lastSyncTime).toLocaleString() : 'Never';
    const updateBadge = syncStatus.hasUpdates ? ' <span class="badge bg-yellow-500 text-white">📥 Updates Available</span>' : '';
    
    statusEl.innerHTML = `
        <div class="flex items-center gap-2 text-sm">
            <span>${statusDot}</span>
            <span>${statusText}</span>
            <span class="text-gray-400">|</span>
            <span class="text-gray-400">Last sync: ${lastSync}</span>
            ${updateBadge}
            <button onclick="triggerSync()" id="syncBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg text-xs flex items-center gap-1">
                <i class="fas fa-sync-alt"></i> Sync Now
            </button>
            <button onclick="checkForUpdates()" class="bg-gray-600 hover:bg-gray-700 text-white px-3 py-1 rounded-lg text-xs flex items-center gap-1">
                <i class="fas fa-search"></i> Check Updates
            </button>
        </div>
    `;
}

// Initialize sync UI
document.addEventListener('DOMContentLoaded', function() {
    // Add sync status bar to the top of the page
    const header = document.querySelector('.header, .navbar, .top-bar');
    if (header) {
        const syncBar = document.createElement('div');
        syncBar.id = 'syncStatus';
        syncBar.className = 'bg-gray-100 border-b border-gray-300 px-4 py-1 text-xs';
        syncBar.style.position = 'sticky';
        syncBar.style.top = '0';
        syncBar.style.zIndex = '1000';
        header.parentNode.insertBefore(syncBar, header);
    }
    
    // Initial status check
    checkSyncStatus();
    checkForUpdates();
    
    // Check every 30 seconds
    setInterval(checkSyncStatus, 30000);
    setInterval(checkForUpdates, 60000);
});

// Make sync functions global
window.checkSyncStatus = checkSyncStatus;
window.checkForUpdates = checkForUpdates;
window.triggerSync = triggerSync;

let currentAcademicSettings = {
    currentTerm: 1,
    currentYear: new Date().getFullYear()
};


// ========== TOGGLE TUITION BREAKDOWN ==========
window.toggleTuitionBreakdown = function(id) {
    var element = document.getElementById(id);
    if (element) {
        element.classList.toggle('hidden');
        if (!window.expandedTuition) window.expandedTuition = {};
        window.expandedTuition[id] = !element.classList.contains('hidden');
    }
};

// ========== TOGGLE PERIOD BREAKDOWN ==========
window.togglePeriodBreakdown = function(id) {
    var element = document.getElementById(id);
    if (element) {
        element.classList.toggle('hidden');
        if (!window.expandedPeriods) window.expandedPeriods = {};
        window.expandedPeriods[id] = !element.classList.contains('hidden');
    }
};

// ========== TOGGLE ITEM HISTORY ==========
window.toggleItemHistory = function(id) {
    var element = document.getElementById(id);
    if (element) {
        element.classList.toggle('hidden');
        if (!window.expandedItems) window.expandedItems = {};
        window.expandedItems[id] = !element.classList.contains('hidden');
    }
};
// ==================== HELPER: GET CUSTOMIZED ITEM VALUE ====================
// This function MUST be available globally
function getCustomizedItemValue(student, itemId, itemName, defaultAmount, defaultQuantity, defaultPaymentOption, defaultUnitPrice) {
    // Guard against null/undefined
    if (!student) {
        return {
            amount: defaultAmount || 0,
            quantity: defaultQuantity || 1,
            paymentOption: defaultPaymentOption || 'either',
            unitPrice: defaultUnitPrice || (defaultAmount / (defaultQuantity || 1)),
            isCustomized: false,
            reason: null,
            updatedAt: null,
            customAmount: null,
            customQuantity: null,
            defaultAmount: defaultAmount || 0,
            defaultQuantity: defaultQuantity || 1
        };
    }
    
    // Check if student has custom overrides for this item
    if (student.customItemOverrides && student.customItemOverrides[itemId]) {
        const custom = student.customItemOverrides[itemId];
        
        // CRITICAL: If custom is active and has values, use them
        if (custom.isActive !== false) {
            const customAmount = (custom.customAmount !== null && custom.customAmount !== undefined) 
                ? custom.customAmount 
                : defaultAmount;
            const customQuantity = (custom.customQuantity !== null && custom.customQuantity !== undefined) 
                ? custom.customQuantity 
                : defaultQuantity;
            const customPaymentOption = custom.paymentOption || defaultPaymentOption;
            
            // Calculate unit price from custom values
            let customUnitPrice = defaultUnitPrice;
            if (customQuantity > 0 && customAmount > 0) {
                customUnitPrice = customAmount / customQuantity;
            } else if (customAmount > 0) {
                customUnitPrice = customAmount / (customQuantity || 1);
            } else if (customQuantity > 0) {
                customUnitPrice = defaultUnitPrice || (defaultAmount / (defaultQuantity || 1));
            }
            
            return {
                amount: customAmount,
                quantity: customQuantity,
                paymentOption: customPaymentOption,
                unitPrice: customUnitPrice,
                isCustomized: true,
                reason: custom.reason || null,
                updatedAt: custom.updatedAt || null,
                customAmount: custom.customAmount,
                customQuantity: custom.customQuantity,
                defaultAmount: custom.defaultAmount || defaultAmount,
                defaultQuantity: custom.defaultQuantity || defaultQuantity
            };
        }
    }
    
    // No customization - return defaults
    return {
        amount: defaultAmount || 0,
        quantity: defaultQuantity || 1,
        paymentOption: defaultPaymentOption || 'either',
        unitPrice: defaultUnitPrice || (defaultAmount / (defaultQuantity || 1)),
        isCustomized: false,
        reason: null,
        updatedAt: null,
        customAmount: null,
        customQuantity: null,
        defaultAmount: defaultAmount || 0,
        defaultQuantity: defaultQuantity || 1
    };
}

// Make it globally available
window.getCustomizedItemValue = getCustomizedItemValue;

// Helper function for formatting
function formatMoney(amount) {
    return Math.round(amount || 0).toLocaleString('en-US');
}

// Helper function for escaping HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateAcademicHeader() {
    const academicHeader = document.getElementById('academicHeader');
    if (academicHeader) {
        const termNames = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
        academicHeader.innerHTML = `
            <div class="flex items-center space-x-4">
                <div class="bg-blue-100 rounded-lg px-3 py-1.5">
                    <span class="text-sm font-semibold text-blue-800">${termNames[currentAcademicSettings.currentTerm]}</span>
                </div>
                <div class="bg-purple-100 rounded-lg px-3 py-1.5">
                    <span class="text-sm font-semibold text-purple-800">${currentAcademicSettings.currentYear}</span>
                </div>
                <div class="bg-green-100 rounded-lg px-3 py-1.5">
                    <i class="fas fa-calendar-alt text-green-600"></i>
                    <span class="text-sm font-semibold text-green-800 ml-1">${new Date().toLocaleDateString()}</span>
                </div>
            </div>
        `;
    }
}

async function updateAcademicSettingsOnServer(year, term) {
    try {
        const response = await fetch('/api/academic/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentYear: year, currentTerm: term })
        });
        
        if (response.ok) {
            currentAcademicSettings.currentYear = year;
            currentAcademicSettings.currentTerm = term;
            localStorage.setItem('currentAcademicYear', year);
            localStorage.setItem('currentAcademicTerm', term);
            updateAcademicHeader();
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error updating academic settings:', error);
        return false;
    }
}
let availableAcademicYears = [];

// ==================== INITIALIZE ACADEMIC SETTINGS ====================
// ==================== FIXED INITIALIZE ACADEMIC SETTINGS ====================
async function initializeAcademicSettings() {
    try {
        // First, check localStorage for saved values
        const savedYear = localStorage.getItem('currentAcademicYear');
        const savedTerm = localStorage.getItem('currentAcademicTerm');
        
        // Try to get from server
        const response = await fetch('/api/academic/settings');
        
        if (response.ok) {
            const settings = await response.json();
            
            // Use server values if they exist, otherwise use localStorage or defaults
            if (settings.currentYear && settings.currentTerm) {
                currentAcademicSettings.currentYear = settings.currentYear;
                currentAcademicSettings.currentTerm = settings.currentTerm;
                // Sync localStorage with server
                localStorage.setItem('currentAcademicYear', settings.currentYear.toString());
                localStorage.setItem('currentAcademicTerm', settings.currentTerm.toString());
            } else if (savedYear && savedTerm) {
                currentAcademicSettings.currentYear = parseInt(savedYear);
                currentAcademicSettings.currentTerm = parseInt(savedTerm);
            } else {
                currentAcademicSettings.currentYear = new Date().getFullYear();
                currentAcademicSettings.currentTerm = 1;
            }
        } else if (savedYear && savedTerm) {
            // Use localStorage if server fails
            currentAcademicSettings.currentYear = parseInt(savedYear);
            currentAcademicSettings.currentTerm = parseInt(savedTerm);
        } else {
            // Default values
            currentAcademicSettings.currentYear = new Date().getFullYear();
            currentAcademicSettings.currentTerm = 1;
        }
        
        // Get available years
        const yearsRes = await fetch('/api/academic/years');
        if (yearsRes.ok) {
            window.availableAcademicYears = await yearsRes.json();
        }
        
        updateAcademicHeader();
        
        console.log('Academic settings initialized:', {
            year: currentAcademicSettings.currentYear,
            term: currentAcademicSettings.currentTerm
        });
        
    } catch (error) {
        console.error('Error initializing academic settings:', error);
        // Fallback to defaults
        currentAcademicSettings.currentYear = new Date().getFullYear();
        currentAcademicSettings.currentTerm = 1;
    }
}

// Update academic settings
// ==================== FIXED UPDATE ACADEMIC SETTINGS ====================
async function updateAcademicSettings(year, term) {
    try {
        const response = await fetch('/api/academic/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentYear: year, currentTerm: term })
        });
        
        if (response.ok) {
            currentAcademicSettings.currentYear = year;
            currentAcademicSettings.currentTerm = term;
            localStorage.setItem('currentAcademicYear', year.toString());
            localStorage.setItem('currentAcademicTerm', term.toString());
            updateAcademicHeader();
            
            // Clear caches
            window.allStudentsData = null;
            window.enhancedStudentsData = null;
            window.currentTermPayments = null;
            
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error updating academic settings:', error);
        return false;
    }
}
// Update academic header display
function updateAcademicHeader() {
    const academicHeader = document.getElementById('academicHeader');
    if (academicHeader) {
        const termNames = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
        academicHeader.innerHTML = `
            <div class="flex items-center space-x-4">
                <div class="bg-blue-100 rounded-lg px-3 py-1.5">
                    <span class="text-sm font-semibold text-blue-800">${termNames[currentAcademicSettings.currentTerm]}</span>
                </div>
                <div class="bg-purple-100 rounded-lg px-3 py-1.5">
                    <span class="text-sm font-semibold text-purple-800">${currentAcademicSettings.currentYear}</span>
                </div>
                <div class="bg-green-100 rounded-lg px-3 py-1.5">
                    <i class="fas fa-calendar-alt text-green-600"></i>
                    <span class="text-sm font-semibold text-green-800 ml-1">${new Date().toLocaleDateString()}</span>
                </div>
            </div>
        `;
    }
}

// ==================== ACADEMIC SETTINGS MODAL ====================

// Add this function after your updateAcademicHeader function
// ==================== FIXED SHOW ACADEMIC SETTINGS MODAL ====================
async function showAcademicSettingsModal() {
    const { currentYear, currentTerm } = currentAcademicSettings;
    const termNames = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
    
    const modalHtml = `
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold">📅 Academic Year Settings</h3>
                    <button onclick="closeModal()" class="text-gray-500 hover:text-gray-700"><i class="fas fa-times text-xl"></i></button>
                </div>
                <form id="academicSettingsForm">
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium mb-1">Academic Year</label>
                            <select id="academicYearSelect" class="w-full border rounded-lg px-3 py-2">
                                ${generateYearOptions(currentYear)}
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium mb-1">Current Term</label>
                            <select id="academicTermSelect" class="w-full border rounded-lg px-3 py-2">
                                <option value="1" ${currentTerm === 1 ? 'selected' : ''}>First Term (Jan - Apr)</option>
                                <option value="2" ${currentTerm === 2 ? 'selected' : ''}>Second Term (May - Aug)</option>
                                <option value="3" ${currentTerm === 3 ? 'selected' : ''}>Third Term (Sep - Dec)</option>
                            </select>
                        </div>
                        <div class="bg-yellow-50 p-3 rounded-lg">
                            <p class="text-sm text-yellow-800"><i class="fas fa-info-circle"></i> Changing term/year will filter all data to show only the selected period.</p>
                        </div>
                    </div>
                    <div class="flex gap-3 mt-6">
                        <button type="submit" class="flex-1 bg-blue-600 text-white py-2 rounded-lg">Apply Settings</button>
                        <button type="button" onclick="closeModal()" class="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg">Cancel</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    document.getElementById('academicSettingsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const year = parseInt(document.getElementById('academicYearSelect').value);
        const term = parseInt(document.getElementById('academicTermSelect').value);
        
        // Update the settings
        await updateAcademicSettingsAndRefresh(year, term);
    });
}

// ==================== NEW FUNCTION: Update settings AND refresh current page ====================
async function updateAcademicSettingsAndRefresh(year, term) {
    const submitBtn = document.querySelector('#academicSettingsForm button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Applying...';
    submitBtn.disabled = true;
    
    try {
        // 1. Update server
        const response = await fetch('/api/academic/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentYear: year, currentTerm: term })
        });
        
        if (!response.ok) throw new Error('Failed to update server');
        
        // 2. Update global variables
        currentAcademicSettings.currentYear = year;
        currentAcademicSettings.currentTerm = term;
        
        // 3. Update localStorage
        localStorage.setItem('currentAcademicYear', year.toString());
        localStorage.setItem('currentAcademicTerm', term.toString());
        
        // 4. Update the header display
        updateAcademicHeader();
        
        // 5. Close the modal
        closeModal();
        
        // 6. Show success message
        const termName = getTermName(term);
        showToast(`✅ Switched to ${termName} ${year}`, 'success');
        
        // 7. CRITICAL: Force refresh the current page with new data
        const currentPageTitle = document.getElementById('pageTitle')?.innerText || '';
        
        // Clear all cached data
        window.allStudentsData = null;
        window.enhancedStudentsData = null;
        window.currentTermPayments = null;
        window.feeStructureStatsData = null;
        window.dashboardStudents = null;
        
        // Refresh the appropriate page
        setTimeout(() => {
            if (currentPageTitle.includes('Dashboard')) {
                showDashboard();
            } else if (currentPageTitle.includes('All Students')) {
                showStudentList();
            } else if (currentPageTitle.includes('Fee Management')) {
                showFeeManagement();
            } else if (currentPageTitle.includes('Fee Structure Statistics')) {
                showFeeStructureStatistics();
            } else if (currentPageTitle.includes('Settings')) {
                showSettings();
                setTimeout(() => {
                    const tab = document.querySelector('.settings-tab[data-tab="academic"]');
                    if (tab) tab.click();
                }, 100);
            } else {
                showDashboard();
            }
        }, 200);
        
    } catch (error) {
        console.error('Error:', error);
        alert('❌ Error updating academic period: ' + error.message);
    } finally {
        if (submitBtn) {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    }
}

// ==================== Helper to generate year options ====================
function generateYearOptions(currentYear) {
    const years = [];
    for (let i = currentYear - 2; i <= currentYear + 3; i++) {
        years.push(i);
    }
    return years.map(y => `<option value="${y}" ${currentYear === y ? 'selected' : ''}>${y}</option>`).join('');
}
// Make sure closeModal function exists
function closeModal() {
    const modal = document.querySelector('.fixed.inset-0');
    if (modal) modal.remove();
}

// Show academic settings modal
async function showAcademicSettings() {
    const years = Array.isArray(availableAcademicYears) && availableAcademicYears.length
        ? [...new Set([...availableAcademicYears, currentAcademicSettings.currentYear])].sort((a, b) => b - a)
        : [currentAcademicSettings.currentYear, new Date().getFullYear(), new Date().getFullYear() - 1].sort((a, b) => b - a);

    const modalHtml = `
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold">📅 Academic Year Settings</h3>
                    <button onclick="closeModal()" class="text-gray-500 hover:text-gray-700"><i class="fas fa-times text-xl"></i></button>
                </div>
                <form id="academicSettingsForm">
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium mb-1">Academic Year</label>
                            <select id="academicYearSelect" class="w-full border rounded-lg px-3 py-2">
                                ${years.map(y => `<option value="${y}" ${currentAcademicSettings.currentYear === y ? 'selected' : ''}>${y}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium mb-1">Term</label>
                            <select id="academicTermSelect" class="w-full border rounded-lg px-3 py-2">
                                <option value="1" ${currentAcademicSettings.currentTerm === 1 ? 'selected' : ''}>First Term (Jan - Apr)</option>
                                <option value="2" ${currentAcademicSettings.currentTerm === 2 ? 'selected' : ''}>Second Term (May - Aug)</option>
                                <option value="3" ${currentAcademicSettings.currentTerm === 3 ? 'selected' : ''}>Third Term (Sep - Dec)</option>
                            </select>
                        </div>
                        <div class="border rounded-lg p-3 bg-gray-50">
                            <p class="text-sm font-semibold mb-2">Create a new academic year</p>
                            <div class="flex gap-2">
                                <input id="newAcademicYearInput" type="number" class="flex-1 border rounded-lg px-3 py-2" placeholder="e.g. 2027" min="1900" max="3000" />
                                <button id="createAcademicYearBtn" type="button" class="bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-semibold">Add</button>
                            </div>
                            <p class="text-xs text-gray-600 mt-2">This creates a dedicated folder for the year and initializes term folders when needed.</p>
                        </div>
                        <div class="bg-yellow-50 p-3 rounded-lg">
                            <p class="text-sm text-yellow-800"><i class="fas fa-info-circle"></i> Changing term/year will filter all data to show only the selected period.</p>
                        </div>
                    </div>
                    <div class="flex gap-3 mt-6">
                        <button type="submit" class="flex-1 bg-blue-600 text-white py-2 rounded-lg">Apply Settings</button>
                        <button type="button" onclick="closeModal()" class="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg">Cancel</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const createBtn = document.getElementById('createAcademicYearBtn');
    if (createBtn) {
        createBtn.addEventListener('click', async () => {
            const input = document.getElementById('newAcademicYearInput');
            const yearValue = parseInt(input?.value);
            if (!yearValue || yearValue < 1900 || yearValue > 3000) {
                showToast('Enter a valid year (e.g. 2027)', 'error');
                return;
            }

            try {
                const res = await fetch('/api/academic/years', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ year: yearValue })
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    showToast(err.error || 'Failed to create academic year', 'error');
                    return;
                }

                // refresh years list + select new one
                const yearsRes = await fetch('/api/academic/years');
                if (yearsRes.ok) availableAcademicYears = await yearsRes.json();

                const yearSelect = document.getElementById('academicYearSelect');
                if (yearSelect) {
                    const yearsNow = [...new Set([...(availableAcademicYears || []), currentAcademicSettings.currentYear])].sort((a, b) => b - a);
                    yearSelect.innerHTML = yearsNow.map(y => `<option value="${y}">${y}</option>`).join('');
                    yearSelect.value = yearValue.toString();
                }

                showToast(`Academic year ${yearValue} created`, 'success');
            } catch (e) {
                console.error('Create year failed:', e);
                showToast('Failed to create academic year', 'error');
            }
        });
    }
    
    document.getElementById('academicSettingsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const year = parseInt(document.getElementById('academicYearSelect').value);
        const term = parseInt(document.getElementById('academicTermSelect').value);
        
        await updateAcademicSettings(year, term);
        closeModal();
        
        // Refresh current page to show filtered data
        const currentPage = document.getElementById('pageTitle')?.innerText || '';
        if (currentPage.includes('Dashboard')) {
            showDashboard();
        } else if (currentPage.includes('All Students')) {
            showStudentList();
        } else if (currentPage.includes('Fee Management')) {
            showFeeManagement();
        }
        
        showToast(`Switched to ${getTermName(term)} ${year}`, 'success');
    });
}

// ==================== FIXED GET TERM NAME ====================
function getTermName(term) {
    const names = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
    return names[term] || `Term ${term}`;
}
// Filter data by current academic year and term
function filterDataByAcademicPeriod(data, type = 'payments') {
    const { currentYear, currentTerm } = currentAcademicSettings;
    
    if (type === 'payments') {
        return data.filter(item => item.academicYear === currentYear.toString() && item.term === currentTerm);
    } else if (type === 'assessments') {
        return data.filter(item => item.year === currentYear && item.term === currentTerm);
    } else if (type === 'attendance') {
        // Filter attendance by date range for the term
        const termDates = getTermDateRange(currentYear, currentTerm);
        return data.filter(item => {
            const itemDate = new Date(item.date);
            return itemDate >= termDates.start && itemDate <= termDates.end;
        });
    }
    return data;
}

function getTermDateRange(year, term) {
    const startDates = {
        1: new Date(year, 0, 10),  // January 10
        2: new Date(year, 4, 10),  // May 10
        3: new Date(year, 8, 10)   // September 10
    };
    const endDates = {
        1: new Date(year, 3, 10),   // April 10
        2: new Date(year, 7, 10),   // August 10
        3: new Date(year, 11, 10)   // December 10
    };
    return { start: startDates[term], end: endDates[term] };
}



// Use a single global variable for selected students
if (typeof window.selectedStudentIdsGlobal === 'undefined') {
    window.selectedStudentIdsGlobal = new Set();
}


// ==================== COMPLETE REBUILT STUDENT LIST ====================
// Version: FINAL - One-Time items always shown, show "Fully Paid" when paid

// ==================== COMPLETE REBUILT STUDENT LIST ====================
// Version: 8.0 - Shows ALL academic periods with balances
// - One-Time: FOREVER until fully paid (shown in ALL periods)
// - Termly: Each term independent
// - Yearly: Resets each year

// ==================== GLOBAL HELPER FUNCTIONS ====================

function formatMoney(amount) {
    const num = Math.round(amount || 0);
    return num.toLocaleString('en-US');
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getTermName(term) {
    const names = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
    return names[term] || `Term ${term}`;
}

function getStatusGroupColor(name) {
    const colors = {
        'Transportation': 'bg-orange-100 text-orange-800 border-orange-200',
        'Admission Fee': 'bg-purple-100 text-purple-800 border-purple-200',
        'schoolastic requirement': 'bg-green-100 text-green-800 border-green-200',
        'Tuition': 'bg-blue-100 text-blue-800 border-blue-200'
    };
    return colors[name] || 'bg-gray-100 text-gray-800 border-gray-200';
}

function deduplicateHistories(histories) {
    if (!histories || histories.length === 0) return [];
    const seen = new Set();
    const unique = [];
    for (let h = 0; h < histories.length; h++) {
        const history = histories[h];
        const key = `${history.date || ''}_${history.type || ''}_${history.amount || 0}_${history.itemsBrought || 0}_${history.receiptNumber || ''}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(history);
        }
    }
    return unique;
}

function closeModal() {
    const modal = document.querySelector('.fixed.inset-0');
    if (modal) modal.remove();
}

// ==================== GET CUSTOMIZED ITEM VALUE ====================

function getCustomizedItemValue(student, itemId, defaultAmount, defaultQuantity, defaultPaymentOption, defaultUnitPrice) {
    if (student && student.customItemOverrides && student.customItemOverrides[itemId]) {
        const custom = student.customItemOverrides[itemId];
        if (custom.isActive !== false) {
            const customAmount = (custom.customAmount !== null && custom.customAmount !== undefined) 
                ? custom.customAmount 
                : defaultAmount;
            const customQuantity = (custom.customQuantity !== null && custom.customQuantity !== undefined) 
                ? custom.customQuantity 
                : defaultQuantity;
            const customPaymentOption = custom.paymentOption || defaultPaymentOption;
            
            let customUnitPrice = defaultUnitPrice;
            if (customQuantity > 0 && customAmount > 0) {
                customUnitPrice = customAmount / customQuantity;
            } else if (customAmount > 0) {
                customUnitPrice = customAmount / (customQuantity || 1);
            } else if (customQuantity > 0) {
                customUnitPrice = defaultUnitPrice || (defaultAmount / (defaultQuantity || 1));
            }
            
            return {
                amount: customAmount,
                quantity: customQuantity,
                paymentOption: customPaymentOption,
                unitPrice: customUnitPrice,
                isCustomized: true,
                reason: custom.reason || null,
                updatedAt: custom.updatedAt || null,
                customAmount: custom.customAmount,
                customQuantity: custom.customQuantity,
                defaultAmount: custom.defaultAmount || defaultAmount,
                defaultQuantity: custom.defaultQuantity || defaultQuantity
            };
        }
    }
    
    return {
        amount: defaultAmount || 0,
        quantity: defaultQuantity || 1,
        paymentOption: defaultPaymentOption || 'either',
        unitPrice: defaultUnitPrice || (defaultAmount / (defaultQuantity || 1)),
        isCustomized: false,
        reason: null,
        updatedAt: null,
        customAmount: null,
        customQuantity: null,
        defaultAmount: defaultAmount || 0,
        defaultQuantity: defaultQuantity || 1
    };
}

// ==================== CHECK IF ITEM IS REMOVED ====================

function isItemRemoved(student, itemId) {
    if (!student || !student.removedItems) return false;
    return student.removedItems[itemId] && student.removedItems[itemId].isActive !== false;
}

// ==================== GET PAID AMOUNTS WITH PERIOD SCOPING ====================

function getPaidAmountsWithScoping(studentId, componentName, itemName, periodType, year, term, allPayments) {
    // Scope payments based on period type
    let scopedPayments = [];
    
    if (periodType === 'one_time') {
        // One-Time: Check ALL payments across ALL years/terms FOREVER
        scopedPayments = allPayments.filter(p => p && p.studentId === studentId);
    } else if (periodType === 'yearly') {
        // Yearly: Check ALL payments across ALL terms in the CURRENT academic year
        scopedPayments = allPayments.filter(p => 
            p && p.studentId === studentId && 
            p.academicYear === year.toString()
        );
    } else {
        // Termly: Check ONLY payments in the CURRENT term
        scopedPayments = allPayments.filter(p => 
            p && p.studentId === studentId && 
            p.term === term && 
            p.academicYear === year.toString()
        );
    }
    
    let cashPaid = 0;
    let itemsBrought = 0;
    const paymentHistories = [];
    const processedKeys = new Set();
    const uniquePaymentItems = new Map();
    
    for (const payment of scopedPayments) {
        if (!payment || !payment.id) continue;
        
        // Check activityItemPayments
        if (payment.activityItemPayments && Array.isArray(payment.activityItemPayments)) {
            for (const paidItem of payment.activityItemPayments) {
                if (!paidItem || !paidItem.componentName || !paidItem.itemName) continue;
                
                const compMatch = paidItem.componentName && 
                    paidItem.componentName.toLowerCase() === componentName.toLowerCase();
                const itemMatch = paidItem.itemName && 
                    paidItem.itemName.toLowerCase() === itemName.toLowerCase();
                
                if (compMatch && itemMatch) {
                    const key = `${payment.id}_${paidItem.itemName}_${paidItem.componentName}`;
                    if (!uniquePaymentItems.has(key)) {
                        uniquePaymentItems.set(key, { payment, paidItem });
                    }
                }
            }
        }
        
        // Check paymentsByPeriodType
        if (payment.paymentsByPeriodType) {
            const periodTypes = ['one_time', 'termly', 'yearly'];
            for (const pt of periodTypes) {
                const periodItems = payment.paymentsByPeriodType[pt] || [];
                for (const paidItem of periodItems) {
                    if (!paidItem || !paidItem.componentName || !paidItem.itemName) continue;
                    
                    const compMatch = paidItem.componentName && 
                        paidItem.componentName.toLowerCase() === componentName.toLowerCase();
                    const itemMatch = paidItem.itemName && 
                        paidItem.itemName.toLowerCase() === itemName.toLowerCase();
                    
                    if (compMatch && itemMatch) {
                        const key = `${payment.id}_${paidItem.itemName}_${paidItem.componentName}`;
                        if (!uniquePaymentItems.has(key)) {
                            uniquePaymentItems.set(key, { payment, paidItem });
                        }
                    }
                }
            }
        }
    }
    
    // Process unique payment items
    for (const [key, data] of uniquePaymentItems) {
        const { payment, paidItem } = data;
        const historyKey = `${payment.receiptNumber || payment.id}_${paidItem.itemName}`;
        if (processedKeys.has(historyKey)) continue;
        processedKeys.add(historyKey);
        
        if (paidItem.paymentType === 'paid_cash') {
            const amount = (paidItem.amountPaid || 0);
            cashPaid += amount;
            paymentHistories.push({
                type: 'cash',
                amount: amount,
                date: payment.date || new Date().toISOString(),
                receiptNumber: payment.receiptNumber || 'N/A',
                academicYear: payment.academicYear,
                term: payment.term,
                paymentId: payment.id,
                isPreviousBalancePayment: payment.isPreviousBalancePayment || false,
                method: payment.method || 'cash'
            });
        } else if (paidItem.paymentType === 'brought_item') {
            const qty = (paidItem.itemsBrought || 0);
            const equiv = (paidItem.cashEquivalent || qty * (paidItem.unitPrice || 0));
            itemsBrought += qty;
            cashPaid += equiv;
            paymentHistories.push({
                type: 'item',
                quantity: qty,
                amount: equiv,
                date: payment.date || new Date().toISOString(),
                receiptNumber: payment.receiptNumber || 'N/A',
                academicYear: payment.academicYear,
                term: payment.term,
                paymentId: payment.id,
                isPreviousBalancePayment: payment.isPreviousBalancePayment || false,
                method: payment.method || 'cash'
            });
        }
    }
    
    // Deduplicate histories
    const seen = new Set();
    const uniqueHistories = [];
    for (const h of paymentHistories) {
        const key = `${h.date || ''}_${h.type || ''}_${h.amount || 0}_${h.quantity || 0}_${h.receiptNumber || ''}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueHistories.push(h);
        }
    }
    
    return { cashPaid, itemsBrought, paymentHistories: uniqueHistories };
}

// ==================== GET ALL PERIODS WITH BALANCES ====================

function getAllPeriodsWithBalances(student, feeStructure, allPayments, currentYear, currentTerm) {
    if (!feeStructure) return { currentPeriod: null, previousPeriods: [], totalPreviousBalance: 0 };
    
    const periods = [];
    const isFirstTerm = currentTerm === 1;
    
    // Get all unique years from fee structure, payments, and current year
    const yearsSet = new Set();
    yearsSet.add(currentYear);
    
    // Add years from payments
    allPayments.forEach(p => {
        if (p && p.studentId === student.id && p.academicYear) {
            yearsSet.add(parseInt(p.academicYear));
        }
    });
    
    // Add years from student enrollment
    if (student.enrolledAt) {
        const enrollYear = new Date(student.enrolledAt).getFullYear();
        yearsSet.add(enrollYear);
    }
    
    // If still no years, use current year
    if (yearsSet.size === 0) {
        yearsSet.add(currentYear);
    }
    
    const minYear = Math.min(...yearsSet);
    const maxYear = Math.max(...yearsSet);
    
    // For each year and term, calculate balances
    for (let year = minYear; year <= maxYear; year++) {
        for (let term = 1; term <= 3; term++) {
            // Skip future periods
            if (year > currentYear || (year === currentYear && term > currentTerm)) continue;
            
            const isCurrentPeriod = (year === currentYear && term === currentTerm);
            const isFirstTermForPeriod = (term === 1);
            
            // Calculate tuition for this period
            let tuitionExpected = feeStructure.tuition || 0;
            let discountAmount = 0;
            let appliedBursary = null;
            
            // Apply custom bursary
            if (student.customBursary && student.customBursary.amount > 0) {
                discountAmount = student.customBursary.amount;
                tuitionExpected = Math.max(0, tuitionExpected - discountAmount);
                appliedBursary = { name: 'Custom Bursary', isCustom: true };
            } else if (student.bursaryId) {
                // Bursary would be looked up from bursaries map
                // For simplicity, we'll use the one passed in
            }
            
            // Calculate tuition paid for this period
            let tuitionPaid = 0;
            const periodPayments = allPayments.filter(p => 
                p && p.studentId === student.id && 
                p.term === term && 
                p.academicYear === year.toString()
            );
            
            for (const p of periodPayments) {
                tuitionPaid += (p.tuitionPaid || 0);
            }
            
            const tuitionBalance = tuitionExpected - tuitionPaid;
            
            // Process activity items for this period
            const periodItems = [];
            let totalActivityExpected = 0;
            let totalActivityPaid = 0;
            let totalActivityBalance = 0;
            let totalItemsRequired = 0;
            let totalItemsBrought = 0;
            let totalItemsRemaining = 0;
            const statusGroupBreakdown = {};
            
            if (feeStructure.activityComponents) {
                for (const component of feeStructure.activityComponents) {
                    const periodType = component.periodType || 'termly';
                    
                    // Determine if this component should be included based on period type
                    let shouldInclude = false;
                    if (periodType === 'termly') {
                        shouldInclude = true;
                    } else if (periodType === 'one_time') {
                        shouldInclude = true; // One-Time: ALWAYS included
                    } else if (periodType === 'yearly') {
                        shouldInclude = isFirstTermForPeriod;
                    }
                    
                    if (!shouldInclude) continue;
                    
                    const isTransportation = component.name.toLowerCase().includes('transport') || 
                                            (component.statusGroupName && component.statusGroupName.toLowerCase().includes('transport'));
                    
                    // Check if transportation is disabled
                    if (isTransportation && student.customTransportation) {
                        if (student.customTransportation.hasTransportation === false) {
                            continue;
                        }
                    }
                    
                    for (const item of (component.items || [])) {
                        const itemId = item.id || item.name;
                        
                        // Skip removed items
                        if (isItemRemoved(student, itemId)) {
                            continue;
                        }
                        
                        // Get custom values
                        const defaultAmount = item.totalAmount || 0;
                        const defaultQuantity = item.quantity || 1;
                        const defaultUnitPrice = item.unitPrice || (defaultAmount / defaultQuantity);
                        const defaultPaymentOption = item.paymentOption || 'either';
                        
                        const customValues = getCustomizedItemValue(
                            student,
                            itemId,
                            defaultAmount,
                            defaultQuantity,
                            defaultPaymentOption,
                            defaultUnitPrice
                        );
                        
                        let effectiveAmount = customValues.amount;
                        let effectiveQuantity = customValues.quantity;
                        let effectiveUnitPrice = customValues.unitPrice;
                        let effectivePaymentOption = customValues.paymentOption;
                        const isCustomized = customValues.isCustomized;
                        const customReason = customValues.reason;
                        
                        // Apply custom transportation
                        if (isTransportation && student.customTransportation) {
                            if (student.customTransportation.hasTransportation === false) {
                                continue;
                            }
                            if (student.customTransportation.amount) {
                                effectiveAmount = student.customTransportation.amount;
                                effectiveUnitPrice = effectiveAmount / (effectiveQuantity || 1);
                            }
                        }
                        
                        // Get paid amounts with period scoping
                        const paidInfo = getPaidAmountsWithScoping(
                            student.id,
                            component.name,
                            item.name,
                            periodType,
                            year,
                            term,
                            allPayments
                        );
                        
                        const cashPaid = paidInfo.cashPaid;
                        const itemsBrought = paidInfo.itemsBrought;
                        const paymentHistories = paidInfo.paymentHistories;
                        
                        // Calculate remaining
                        let remainingAmount = 0;
                        let remainingQuantity = 0;
                        let isFullyPaid = false;
                        
                        if (effectivePaymentOption === 'cash_only') {
                            remainingAmount = Math.max(0, effectiveAmount - cashPaid);
                            isFullyPaid = remainingAmount <= 0;
                        } else if (effectivePaymentOption === 'item_only') {
                            remainingQuantity = Math.max(0, effectiveQuantity - itemsBrought);
                            isFullyPaid = remainingQuantity <= 0;
                        } else {
                            const totalPaidValue = cashPaid + (itemsBrought * effectiveUnitPrice);
                            const totalRequired = effectiveQuantity * effectiveUnitPrice;
                            isFullyPaid = totalPaidValue >= totalRequired;
                            if (!isFullyPaid) {
                                remainingAmount = Math.max(0, totalRequired - totalPaidValue);
                                remainingQuantity = Math.ceil(remainingAmount / effectiveUnitPrice);
                            }
                        }
                        
                        // Add to period totals
                        totalActivityExpected += effectiveAmount;
                        totalActivityPaid += cashPaid + (itemsBrought * effectiveUnitPrice);
                        totalActivityBalance += remainingAmount;
                        totalItemsRequired += effectiveQuantity;
                        totalItemsBrought += itemsBrought;
                        totalItemsRemaining += remainingQuantity;
                        
                        // Status group breakdown
                        const sgName = component.statusGroupName || component.name || 'Other';
                        if (!statusGroupBreakdown[sgName]) {
                            statusGroupBreakdown[sgName] = {
                                name: sgName,
                                expected: 0,
                                paid: 0,
                                balance: 0,
                                itemsRequired: 0,
                                itemsBrought: 0,
                                itemsRemaining: 0,
                                items: []
                            };
                        }
                        statusGroupBreakdown[sgName].expected += effectiveAmount;
                        statusGroupBreakdown[sgName].paid += cashPaid + (itemsBrought * effectiveUnitPrice);
                        statusGroupBreakdown[sgName].balance += remainingAmount;
                        statusGroupBreakdown[sgName].itemsRequired += effectiveQuantity;
                        statusGroupBreakdown[sgName].itemsBrought += itemsBrought;
                        statusGroupBreakdown[sgName].itemsRemaining += remainingQuantity;
                        statusGroupBreakdown[sgName].items.push({
                            name: item.name,
                            itemId: itemId,
                            quantityRequired: effectiveQuantity,
                            totalAmount: effectiveAmount,
                            unitPrice: effectiveUnitPrice,
                            paymentOption: effectivePaymentOption,
                            cashPaid: cashPaid,
                            itemsBrought: itemsBrought,
                            remainingAmount: remainingAmount,
                            remainingQuantity: remainingQuantity,
                            isFullyPaid: isFullyPaid,
                            isCustomized: isCustomized,
                            customReason: customReason,
                            paymentHistories: paymentHistories,
                            periodType: periodType,
                            isTransportation: isTransportation
                        });
                    }
                }
            }
            
            const totalExpected = tuitionExpected + totalActivityExpected;
            const totalPaid = tuitionPaid + totalActivityPaid;
            const totalBalance = totalExpected - totalPaid;
            
            // Determine if this period has any data or balance
            const hasData = totalExpected > 0 || totalPaid > 0 || totalItemsRequired > 0;
            const hasBalance = totalBalance > 0 || totalItemsRemaining > 0;
            const isEmpty = !hasData && !hasBalance;
            
            periods.push({
                year: year,
                term: term,
                isCurrent: isCurrentPeriod,
                isFirstTerm: isFirstTermForPeriod,
                hasData: hasData,
                hasBalance: hasBalance,
                isEmpty: isEmpty,
                tuition: {
                    expected: tuitionExpected,
                    paid: tuitionPaid,
                    balance: tuitionBalance,
                    discountAmount: discountAmount,
                    bursaryName: appliedBursary?.name || null,
                    isCustomBursary: appliedBursary?.isCustom || false
                },
                activity: {
                    expected: totalActivityExpected,
                    paid: totalActivityPaid,
                    balance: totalActivityBalance,
                    itemsRequired: totalItemsRequired,
                    itemsBrought: totalItemsBrought,
                    itemsRemaining: totalItemsRemaining,
                    items: periodItems
                },
                total: {
                    expected: totalExpected,
                    paid: totalPaid,
                    balance: totalBalance
                },
                statusGroupBreakdown: statusGroupBreakdown,
                payments: periodPayments,
                feeStructure: feeStructure,
                studentCustomizations: {
                    customItemOverrides: student.customItemOverrides || {},
                    customTransportation: student.customTransportation || null,
                    customBursary: student.customBursary || null,
                    removedItems: student.removedItems || {}
                }
            });
        }
    }
    
    // Separate current and previous periods
    const currentPeriod = periods.find(p => p.isCurrent) || null;
    const previousPeriods = periods.filter(p => !p.isCurrent && p.hasBalance);
    
    // Calculate total previous balance
    let totalPreviousBalance = 0;
    let totalPreviousItems = 0;
    for (const p of previousPeriods) {
        totalPreviousBalance += p.total.balance;
        totalPreviousItems += p.activity.itemsRemaining;
    }
    
    return {
        currentPeriod: currentPeriod,
        previousPeriods: previousPeriods,
        totalPreviousBalance: totalPreviousBalance,
        totalPreviousItems: totalPreviousItems
    };
}

// ==================== BUILD STATUS GROUP SUMMARY FOR ALL PERIODS ====================

function buildStatusGroupSummary(student, feeStructure, allPayments, currentYear, currentTerm) {
    const periodData = getAllPeriodsWithBalances(student, feeStructure, allPayments, currentYear, currentTerm);
    const allStatusGroups = new Map();
    
    // Process current period
    if (periodData.currentPeriod) {
        const p = periodData.currentPeriod;
        for (const [sgName, sgData] of Object.entries(p.statusGroupBreakdown || {})) {
            if (!allStatusGroups.has(sgName)) {
                allStatusGroups.set(sgName, {
                    name: sgName,
                    expected: 0,
                    paid: 0,
                    balance: 0,
                    itemsRequired: 0,
                    itemsBrought: 0,
                    itemsRemaining: 0,
                    hasCustomItems: false,
                    customItemsCount: 0,
                    periodTypes: new Set(),
                    isTransportation: false
                });
            }
            const group = allStatusGroups.get(sgName);
            group.expected += sgData.expected || 0;
            group.paid += sgData.paid || 0;
            group.balance += sgData.balance || 0;
            group.itemsRequired += sgData.itemsRequired || 0;
            group.itemsBrought += sgData.itemsBrought || 0;
            group.itemsRemaining += sgData.itemsRemaining || 0;
            
            // Check for custom items
            for (const item of (sgData.items || [])) {
                if (item.isCustomized) {
                    group.hasCustomItems = true;
                    group.customItemsCount++;
                }
                if (item.isTransportation) {
                    group.isTransportation = true;
                }
                if (item.periodType) {
                    group.periodTypes.add(item.periodType);
                }
            }
        }
    }
    
    // Process previous periods
    for (const p of periodData.previousPeriods) {
        for (const [sgName, sgData] of Object.entries(p.statusGroupBreakdown || {})) {
            if (!allStatusGroups.has(sgName)) {
                allStatusGroups.set(sgName, {
                    name: sgName,
                    expected: 0,
                    paid: 0,
                    balance: 0,
                    itemsRequired: 0,
                    itemsBrought: 0,
                    itemsRemaining: 0,
                    hasCustomItems: false,
                    customItemsCount: 0,
                    periodTypes: new Set(),
                    isTransportation: false
                });
            }
            const group = allStatusGroups.get(sgName);
            group.expected += sgData.expected || 0;
            group.paid += sgData.paid || 0;
            group.balance += sgData.balance || 0;
            group.itemsRequired += sgData.itemsRequired || 0;
            group.itemsBrought += sgData.itemsBrought || 0;
            group.itemsRemaining += sgData.itemsRemaining || 0;
            
            for (const item of (sgData.items || [])) {
                if (item.isCustomized) {
                    group.hasCustomItems = true;
                    group.customItemsCount++;
                }
                if (item.isTransportation) {
                    group.isTransportation = true;
                }
                if (item.periodType) {
                    group.periodTypes.add(item.periodType);
                }
            }
        }
    }
    
    return allStatusGroups;
}

// ==================== RENDER STATUS GROUP CELL WITH ALL PERIODS ====================

function renderStatusGroupCellWithAllPeriods(student, sg, allStatusGroups, formatMoneyFn) {
    const groupData = allStatusGroups.get(sg.name) || {
        expected: 0,
        paid: 0,
        balance: 0,
        itemsRequired: 0,
        itemsBrought: 0,
        itemsRemaining: 0,
        hasCustomItems: false,
        customItemsCount: 0,
        periodTypes: new Set(),
        isTransportation: false
    };
    
    const expected = groupData.expected || 0;
    const paid = groupData.paid || 0;
    const balance = groupData.balance || 0;
    const itemsRemaining = groupData.itemsRemaining || 0;
    const customItemsCount = groupData.customItemsCount || 0;
    const hasCustomItems = groupData.hasCustomItems || false;
    
    // Check if student has fee structure with this group
    const hasGroupInStructure = student.studentFeeStructureGroups ? student.studentFeeStructureGroups[sg.name] : false;
    
    if (!student.hasFeeStructure) {
        return `<td class="p-2 text-center border text-xs text-gray-400">
            <span class="italic">No Fee Structure</span>
        </td>`;
    }
    
    if (!hasGroupInStructure) {
        const displayName = sg.name === 'schoolastic requirement' ? 'Scholastic' : 
                           sg.name === 'Admission Fee' ? 'Admission' : sg.name;
        return `<td class="p-2 text-center border text-xs text-gray-400">
            <span class="italic">Does not pay ${escapeHtml(displayName)}</span>
        </td>`;
    }
    
    // Special handling for Transportation
    if (sg.name.toLowerCase().includes('transport') && student.customTransportation) {
        if (student.customTransportation.hasTransportation === false) {
            return `<td class="p-2 text-center border text-xs text-gray-400">
                <span class="italic">Transport disabled</span>
            </td>`;
        }
    }
    
    // Build display
    const customBadge = hasCustomItems ? 
        `<span class="text-xs text-orange-500 ml-1">⚡${customItemsCount}</span>` : '';
    
    const periodIcons = [];
    if (groupData.periodTypes.has('one_time')) periodIcons.push('⭐');
    if (groupData.periodTypes.has('termly')) periodIcons.push('📅');
    if (groupData.periodTypes.has('yearly')) periodIcons.push('📆');
    const periodBadge = periodIcons.length > 0 ? 
        `<span class="text-xs text-gray-400">${periodIcons.join(' ')}</span>` : '';
    
    let displayHtml = '';
    
    if (expected === 0 && paid === 0 && itemsRemaining === 0) {
        displayHtml = `<span class="text-gray-400">-</span>`;
    } else if (Math.abs(balance) <= 10 && paid > 0) {
        displayHtml = `<span class="text-green-600 font-semibold">✓ Fully Paid</span>`;
    } else if (balance < 0) {
        displayHtml = `<span class="text-blue-600 font-semibold">Credit: UGX ${formatMoneyFn(Math.abs(balance))}</span>`;
    } else if (balance > 0 && paid > 0) {
        displayHtml = `
            <div class="text-red-600 font-semibold">UGX ${formatMoneyFn(balance)}</div>
            <div class="text-orange-600 text-xs">${itemsRemaining} item(s)</div>
        `;
    } else if (balance > 0 && paid === 0) {
        displayHtml = `
            <div class="text-red-600 font-semibold">UGX ${formatMoneyFn(expected)}</div>
            <div class="text-orange-600 text-xs">${itemsRemaining} item(s)</div>
        `;
    } else if (paid > 0) {
        displayHtml = `<span class="text-green-600">UGX ${formatMoneyFn(paid)}</span>`;
    } else {
        displayHtml = `<span class="text-gray-400">-</span>`;
    }
    
    // Transportation custom badge
    let transportBadge = '';
    if (sg.name.toLowerCase().includes('transport') && student.customTransportation) {
        if (student.customTransportation.amount) {
            transportBadge = `<div class="text-xs text-blue-500">🚌 Custom: UGX ${formatMoneyFn(student.customTransportation.amount)}</div>`;
        }
    }
    
    const infoIcon = expected > 0 || itemsRemaining > 0 ? 
        `<i class="fas fa-info-circle text-blue-500 ml-1 cursor-pointer hover:text-blue-700" 
            onclick="event.stopPropagation(); showStatusGroupItemDetailsModal('${student.id}', '${escapeHtml(sg.name)}')"></i>` : '';
    
    return `
        <td class="p-2 text-center border text-xs">
            <div class="cursor-pointer hover:bg-gray-100 rounded p-1 transition" 
                 onclick="showStatusGroupItemDetailsModal('${student.id}', '${escapeHtml(sg.name)}')">
                ${displayHtml}
                ${transportBadge}
                ${customBadge}
                ${periodBadge}
                ${infoIcon}
            </div>
        </td>
    `;
}

// ==================== COMPLETE SHOW STUDENT LIST ====================

// ==================== COMPLETE REBUILT STUDENT LIST ====================
// Version: 8.0 - Shows ALL academic periods with balances
// - One-Time: FOREVER until fully paid (shown in ALL periods)
// - Termly: Each term independent
// - Yearly: Resets each year

// ==================== GLOBAL HELPER FUNCTIONS ====================

function formatMoney(amount) {
    const num = Math.round(amount || 0);
    return num.toLocaleString('en-US');
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getTermName(term) {
    const names = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
    return names[term] || `Term ${term}`;
}

function getStatusGroupColor(name) {
    const colors = {
        'Transportation': 'bg-orange-100 text-orange-800 border-orange-200',
        'Admission Fee': 'bg-purple-100 text-purple-800 border-purple-200',
        'schoolastic requirement': 'bg-green-100 text-green-800 border-green-200',
        'Tuition': 'bg-blue-100 text-blue-800 border-blue-200'
    };
    return colors[name] || 'bg-gray-100 text-gray-800 border-gray-200';
}

function deduplicateHistories(histories) {
    if (!histories || histories.length === 0) return [];
    const seen = new Set();
    const unique = [];
    for (let h = 0; h < histories.length; h++) {
        const history = histories[h];
        const key = `${history.date || ''}_${history.type || ''}_${history.amount || 0}_${history.itemsBrought || 0}_${history.receiptNumber || ''}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(history);
        }
    }
    return unique;
}

function closeModal() {
    const modal = document.querySelector('.fixed.inset-0');
    if (modal) modal.remove();
}

// ==================== GET CUSTOMIZED ITEM VALUE ====================

// function getCustomizedItemValue(student, itemId, defaultAmount, defaultQuantity, defaultPaymentOption, defaultUnitPrice) {
//     if (student && student.customItemOverrides && student.customItemOverrides[itemId]) {
//         const custom = student.customItemOverrides[itemId];
//         if (custom.isActive !== false) {
//             const customAmount = (custom.customAmount !== null && custom.customAmount !== undefined) 
//                 ? custom.customAmount 
//                 : defaultAmount;
//             const customQuantity = (custom.customQuantity !== null && custom.customQuantity !== undefined) 
//                 ? custom.customQuantity 
//                 : defaultQuantity;
//             const customPaymentOption = custom.paymentOption || defaultPaymentOption;
            
//             let customUnitPrice = defaultUnitPrice;
//             if (customQuantity > 0 && customAmount > 0) {
//                 customUnitPrice = customAmount / customQuantity;
//             } else if (customAmount > 0) {
//                 customUnitPrice = customAmount / (customQuantity || 1);
//             } else if (customQuantity > 0) {
//                 customUnitPrice = defaultUnitPrice || (defaultAmount / (defaultQuantity || 1));
//             }
            
//             return {
//                 amount: customAmount,
//                 quantity: customQuantity,
//                 paymentOption: customPaymentOption,
//                 unitPrice: customUnitPrice,
//                 isCustomized: true,
//                 reason: custom.reason || null,
//                 updatedAt: custom.updatedAt || null,
//                 customAmount: custom.customAmount,
//                 customQuantity: custom.customQuantity,
//                 defaultAmount: custom.defaultAmount || defaultAmount,
//                 defaultQuantity: custom.defaultQuantity || defaultQuantity
//             };
//         }
//     }
    
//     return {
//         amount: defaultAmount || 0,
//         quantity: defaultQuantity || 1,
//         paymentOption: defaultPaymentOption || 'either',
//         unitPrice: defaultUnitPrice || (defaultAmount / (defaultQuantity || 1)),
//         isCustomized: false,
//         reason: null,
//         updatedAt: null,
//         customAmount: null,
//         customQuantity: null,
//         defaultAmount: defaultAmount || 0,
//         defaultQuantity: defaultQuantity || 1
//     };
// }

// ==================== CHECK IF ITEM IS REMOVED ====================

function isItemRemoved(student, itemId) {
    if (!student || !student.removedItems) return false;
    return student.removedItems[itemId] && student.removedItems[itemId].isActive !== false;
}

// ==================== GET PAID AMOUNTS WITH PERIOD SCOPING ====================

function getPaidAmountsWithScoping(studentId, componentName, itemName, periodType, year, term, allPayments) {
    // Scope payments based on period type
    let scopedPayments = [];
    
    if (periodType === 'one_time') {
        // One-Time: Check ALL payments across ALL years/terms FOREVER
        scopedPayments = allPayments.filter(p => p && p.studentId === studentId);
    } else if (periodType === 'yearly') {
        // Yearly: Check ALL payments across ALL terms in the CURRENT academic year
        scopedPayments = allPayments.filter(p => 
            p && p.studentId === studentId && 
            p.academicYear === year.toString()
        );
    } else {
        // Termly: Check ONLY payments in the CURRENT term
        scopedPayments = allPayments.filter(p => 
            p && p.studentId === studentId && 
            p.term === term && 
            p.academicYear === year.toString()
        );
    }
    
    let cashPaid = 0;
    let itemsBrought = 0;
    const paymentHistories = [];
    const processedKeys = new Set();
    const uniquePaymentItems = new Map();
    
    for (const payment of scopedPayments) {
        if (!payment || !payment.id) continue;
        
        // Check activityItemPayments
        if (payment.activityItemPayments && Array.isArray(payment.activityItemPayments)) {
            for (const paidItem of payment.activityItemPayments) {
                if (!paidItem || !paidItem.componentName || !paidItem.itemName) continue;
                
                const compMatch = paidItem.componentName && 
                    paidItem.componentName.toLowerCase() === componentName.toLowerCase();
                const itemMatch = paidItem.itemName && 
                    paidItem.itemName.toLowerCase() === itemName.toLowerCase();
                
                if (compMatch && itemMatch) {
                    const key = `${payment.id}_${paidItem.itemName}_${paidItem.componentName}`;
                    if (!uniquePaymentItems.has(key)) {
                        uniquePaymentItems.set(key, { payment, paidItem });
                    }
                }
            }
        }
        
        // Check paymentsByPeriodType
        if (payment.paymentsByPeriodType) {
            const periodTypes = ['one_time', 'termly', 'yearly'];
            for (const pt of periodTypes) {
                const periodItems = payment.paymentsByPeriodType[pt] || [];
                for (const paidItem of periodItems) {
                    if (!paidItem || !paidItem.componentName || !paidItem.itemName) continue;
                    
                    const compMatch = paidItem.componentName && 
                        paidItem.componentName.toLowerCase() === componentName.toLowerCase();
                    const itemMatch = paidItem.itemName && 
                        paidItem.itemName.toLowerCase() === itemName.toLowerCase();
                    
                    if (compMatch && itemMatch) {
                        const key = `${payment.id}_${paidItem.itemName}_${paidItem.componentName}`;
                        if (!uniquePaymentItems.has(key)) {
                            uniquePaymentItems.set(key, { payment, paidItem });
                        }
                    }
                }
            }
        }
    }
    
    // Process unique payment items
    for (const [key, data] of uniquePaymentItems) {
        const { payment, paidItem } = data;
        const historyKey = `${payment.receiptNumber || payment.id}_${paidItem.itemName}`;
        if (processedKeys.has(historyKey)) continue;
        processedKeys.add(historyKey);
        
        if (paidItem.paymentType === 'paid_cash') {
            const amount = (paidItem.amountPaid || 0);
            cashPaid += amount;
            paymentHistories.push({
                type: 'cash',
                amount: amount,
                date: payment.date || new Date().toISOString(),
                receiptNumber: payment.receiptNumber || 'N/A',
                academicYear: payment.academicYear,
                term: payment.term,
                paymentId: payment.id,
                isPreviousBalancePayment: payment.isPreviousBalancePayment || false,
                method: payment.method || 'cash'
            });
        } else if (paidItem.paymentType === 'brought_item') {
            const qty = (paidItem.itemsBrought || 0);
            const equiv = (paidItem.cashEquivalent || qty * (paidItem.unitPrice || 0));
            itemsBrought += qty;
            cashPaid += equiv;
            paymentHistories.push({
                type: 'item',
                quantity: qty,
                amount: equiv,
                date: payment.date || new Date().toISOString(),
                receiptNumber: payment.receiptNumber || 'N/A',
                academicYear: payment.academicYear,
                term: payment.term,
                paymentId: payment.id,
                isPreviousBalancePayment: payment.isPreviousBalancePayment || false,
                method: payment.method || 'cash'
            });
        }
    }
    
    // Deduplicate histories
    const seen = new Set();
    const uniqueHistories = [];
    for (const h of paymentHistories) {
        const key = `${h.date || ''}_${h.type || ''}_${h.amount || 0}_${h.quantity || 0}_${h.receiptNumber || ''}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueHistories.push(h);
        }
    }
    
    return { cashPaid, itemsBrought, paymentHistories: uniqueHistories };
}

// ==================== GET ALL PERIODS WITH BALANCES ====================

function getAllPeriodsWithBalances(student, feeStructure, allPayments, currentYear, currentTerm) {
    if (!feeStructure) return { currentPeriod: null, previousPeriods: [], totalPreviousBalance: 0 };
    
    const periods = [];
    const isFirstTerm = currentTerm === 1;
    
    // Get all unique years from fee structure, payments, and current year
    const yearsSet = new Set();
    yearsSet.add(currentYear);
    
    // Add years from payments
    allPayments.forEach(p => {
        if (p && p.studentId === student.id && p.academicYear) {
            yearsSet.add(parseInt(p.academicYear));
        }
    });
    
    // Add years from student enrollment
    if (student.enrolledAt) {
        const enrollYear = new Date(student.enrolledAt).getFullYear();
        yearsSet.add(enrollYear);
    }
    
    // If still no years, use current year
    if (yearsSet.size === 0) {
        yearsSet.add(currentYear);
    }
    
    const minYear = Math.min(...yearsSet);
    const maxYear = Math.max(...yearsSet);
    
    // For each year and term, calculate balances
    for (let year = minYear; year <= maxYear; year++) {
        for (let term = 1; term <= 3; term++) {
            // Skip future periods
            if (year > currentYear || (year === currentYear && term > currentTerm)) continue;
            
            const isCurrentPeriod = (year === currentYear && term === currentTerm);
            const isFirstTermForPeriod = (term === 1);
            
            // Calculate tuition for this period
            let tuitionExpected = feeStructure.tuition || 0;
            let discountAmount = 0;
            let appliedBursary = null;
            
            // Apply custom bursary
            if (student.customBursary && student.customBursary.amount > 0) {
                discountAmount = student.customBursary.amount;
                tuitionExpected = Math.max(0, tuitionExpected - discountAmount);
                appliedBursary = { name: 'Custom Bursary', isCustom: true };
            } else if (student.bursaryId) {
                // Bursary would be looked up from bursaries map
                // For simplicity, we'll use the one passed in
            }
            
            // Calculate tuition paid for this period
            let tuitionPaid = 0;
            const periodPayments = allPayments.filter(p => 
                p && p.studentId === student.id && 
                p.term === term && 
                p.academicYear === year.toString()
            );
            
            for (const p of periodPayments) {
                tuitionPaid += (p.tuitionPaid || 0);
            }
            
            const tuitionBalance = tuitionExpected - tuitionPaid;
            
            // Process activity items for this period
            const periodItems = [];
            let totalActivityExpected = 0;
            let totalActivityPaid = 0;
            let totalActivityBalance = 0;
            let totalItemsRequired = 0;
            let totalItemsBrought = 0;
            let totalItemsRemaining = 0;
            const statusGroupBreakdown = {};
            
            if (feeStructure.activityComponents) {
                for (const component of feeStructure.activityComponents) {
                    const periodType = component.periodType || 'termly';
                    
                    // Determine if this component should be included based on period type
                    let shouldInclude = false;
                    if (periodType === 'termly') {
                        shouldInclude = true;
                    } else if (periodType === 'one_time') {
                        shouldInclude = true; // One-Time: ALWAYS included
                    } else if (periodType === 'yearly') {
                        shouldInclude = isFirstTermForPeriod;
                    }
                    
                    if (!shouldInclude) continue;
                    
                    const isTransportation = component.name.toLowerCase().includes('transport') || 
                                            (component.statusGroupName && component.statusGroupName.toLowerCase().includes('transport'));
                    
                    // Check if transportation is disabled
                    if (isTransportation && student.customTransportation) {
                        if (student.customTransportation.hasTransportation === false) {
                            continue;
                        }
                    }
                    
                    for (const item of (component.items || [])) {
                        const itemId = item.id || item.name;
                        
                        // Skip removed items
                        if (isItemRemoved(student, itemId)) {
                            continue;
                        }
                        
                        // Get custom values
                        const defaultAmount = item.totalAmount || 0;
                        const defaultQuantity = item.quantity || 1;
                        const defaultUnitPrice = item.unitPrice || (defaultAmount / defaultQuantity);
                        const defaultPaymentOption = item.paymentOption || 'either';
                        
                        const customValues = getCustomizedItemValue(
                            student,
                            itemId,
                            defaultAmount,
                            defaultQuantity,
                            defaultPaymentOption,
                            defaultUnitPrice
                        );
                        
                        let effectiveAmount = customValues.amount;
                        let effectiveQuantity = customValues.quantity;
                        let effectiveUnitPrice = customValues.unitPrice;
                        let effectivePaymentOption = customValues.paymentOption;
                        const isCustomized = customValues.isCustomized;
                        const customReason = customValues.reason;
                        
                        // Apply custom transportation
                        if (isTransportation && student.customTransportation) {
                            if (student.customTransportation.hasTransportation === false) {
                                continue;
                            }
                            if (student.customTransportation.amount) {
                                effectiveAmount = student.customTransportation.amount;
                                effectiveUnitPrice = effectiveAmount / (effectiveQuantity || 1);
                            }
                        }
                        
                        // Get paid amounts with period scoping
                        const paidInfo = getPaidAmountsWithScoping(
                            student.id,
                            component.name,
                            item.name,
                            periodType,
                            year,
                            term,
                            allPayments
                        );
                        
                        const cashPaid = paidInfo.cashPaid;
                        const itemsBrought = paidInfo.itemsBrought;
                        const paymentHistories = paidInfo.paymentHistories;
                        
                        // Calculate remaining
                        let remainingAmount = 0;
                        let remainingQuantity = 0;
                        let isFullyPaid = false;
                        
                        if (effectivePaymentOption === 'cash_only') {
                            remainingAmount = Math.max(0, effectiveAmount - cashPaid);
                            isFullyPaid = remainingAmount <= 0;
                        } else if (effectivePaymentOption === 'item_only') {
                            remainingQuantity = Math.max(0, effectiveQuantity - itemsBrought);
                            isFullyPaid = remainingQuantity <= 0;
                        } else {
                            const totalPaidValue = cashPaid + (itemsBrought * effectiveUnitPrice);
                            const totalRequired = effectiveQuantity * effectiveUnitPrice;
                            isFullyPaid = totalPaidValue >= totalRequired;
                            if (!isFullyPaid) {
                                remainingAmount = Math.max(0, totalRequired - totalPaidValue);
                                remainingQuantity = Math.ceil(remainingAmount / effectiveUnitPrice);
                            }
                        }
                        
                        // Add to period totals
                        totalActivityExpected += effectiveAmount;
                        totalActivityPaid += cashPaid + (itemsBrought * effectiveUnitPrice);
                        totalActivityBalance += remainingAmount;
                        totalItemsRequired += effectiveQuantity;
                        totalItemsBrought += itemsBrought;
                        totalItemsRemaining += remainingQuantity;
                        
                        // Status group breakdown
                        const sgName = component.statusGroupName || component.name || 'Other';
                        if (!statusGroupBreakdown[sgName]) {
                            statusGroupBreakdown[sgName] = {
                                name: sgName,
                                expected: 0,
                                paid: 0,
                                balance: 0,
                                itemsRequired: 0,
                                itemsBrought: 0,
                                itemsRemaining: 0,
                                items: []
                            };
                        }
                        statusGroupBreakdown[sgName].expected += effectiveAmount;
                        statusGroupBreakdown[sgName].paid += cashPaid + (itemsBrought * effectiveUnitPrice);
                        statusGroupBreakdown[sgName].balance += remainingAmount;
                        statusGroupBreakdown[sgName].itemsRequired += effectiveQuantity;
                        statusGroupBreakdown[sgName].itemsBrought += itemsBrought;
                        statusGroupBreakdown[sgName].itemsRemaining += remainingQuantity;
                        statusGroupBreakdown[sgName].items.push({
                            name: item.name,
                            itemId: itemId,
                            quantityRequired: effectiveQuantity,
                            totalAmount: effectiveAmount,
                            unitPrice: effectiveUnitPrice,
                            paymentOption: effectivePaymentOption,
                            cashPaid: cashPaid,
                            itemsBrought: itemsBrought,
                            remainingAmount: remainingAmount,
                            remainingQuantity: remainingQuantity,
                            isFullyPaid: isFullyPaid,
                            isCustomized: isCustomized,
                            customReason: customReason,
                            paymentHistories: paymentHistories,
                            periodType: periodType,
                            isTransportation: isTransportation
                        });
                    }
                }
            }
            
            const totalExpected = tuitionExpected + totalActivityExpected;
            const totalPaid = tuitionPaid + totalActivityPaid;
            const totalBalance = totalExpected - totalPaid;
            
            // Determine if this period has any data or balance
            const hasData = totalExpected > 0 || totalPaid > 0 || totalItemsRequired > 0;
            const hasBalance = totalBalance > 0 || totalItemsRemaining > 0;
            const isEmpty = !hasData && !hasBalance;
            
            periods.push({
                year: year,
                term: term,
                isCurrent: isCurrentPeriod,
                isFirstTerm: isFirstTermForPeriod,
                hasData: hasData,
                hasBalance: hasBalance,
                isEmpty: isEmpty,
                tuition: {
                    expected: tuitionExpected,
                    paid: tuitionPaid,
                    balance: tuitionBalance,
                    discountAmount: discountAmount,
                    bursaryName: appliedBursary?.name || null,
                    isCustomBursary: appliedBursary?.isCustom || false
                },
                activity: {
                    expected: totalActivityExpected,
                    paid: totalActivityPaid,
                    balance: totalActivityBalance,
                    itemsRequired: totalItemsRequired,
                    itemsBrought: totalItemsBrought,
                    itemsRemaining: totalItemsRemaining,
                    items: periodItems
                },
                total: {
                    expected: totalExpected,
                    paid: totalPaid,
                    balance: totalBalance
                },
                statusGroupBreakdown: statusGroupBreakdown,
                payments: periodPayments,
                feeStructure: feeStructure,
                studentCustomizations: {
                    customItemOverrides: student.customItemOverrides || {},
                    customTransportation: student.customTransportation || null,
                    customBursary: student.customBursary || null,
                    removedItems: student.removedItems || {}
                }
            });
        }
    }
    
    // Separate current and previous periods
    const currentPeriod = periods.find(p => p.isCurrent) || null;
    const previousPeriods = periods.filter(p => !p.isCurrent && p.hasBalance);
    
    // Calculate total previous balance
    let totalPreviousBalance = 0;
    let totalPreviousItems = 0;
    for (const p of previousPeriods) {
        totalPreviousBalance += p.total.balance;
        totalPreviousItems += p.activity.itemsRemaining;
    }
    
    return {
        currentPeriod: currentPeriod,
        previousPeriods: previousPeriods,
        totalPreviousBalance: totalPreviousBalance,
        totalPreviousItems: totalPreviousItems
    };
}

// ==================== BUILD STATUS GROUP SUMMARY FOR ALL PERIODS ====================

function buildStatusGroupSummary(student, feeStructure, allPayments, currentYear, currentTerm) {
    const periodData = getAllPeriodsWithBalances(student, feeStructure, allPayments, currentYear, currentTerm);
    const allStatusGroups = new Map();
    
    // Process current period
    if (periodData.currentPeriod) {
        const p = periodData.currentPeriod;
        for (const [sgName, sgData] of Object.entries(p.statusGroupBreakdown || {})) {
            if (!allStatusGroups.has(sgName)) {
                allStatusGroups.set(sgName, {
                    name: sgName,
                    expected: 0,
                    paid: 0,
                    balance: 0,
                    itemsRequired: 0,
                    itemsBrought: 0,
                    itemsRemaining: 0,
                    hasCustomItems: false,
                    customItemsCount: 0,
                    periodTypes: new Set(),
                    isTransportation: false
                });
            }
            const group = allStatusGroups.get(sgName);
            group.expected += sgData.expected || 0;
            group.paid += sgData.paid || 0;
            group.balance += sgData.balance || 0;
            group.itemsRequired += sgData.itemsRequired || 0;
            group.itemsBrought += sgData.itemsBrought || 0;
            group.itemsRemaining += sgData.itemsRemaining || 0;
            
            // Check for custom items
            for (const item of (sgData.items || [])) {
                if (item.isCustomized) {
                    group.hasCustomItems = true;
                    group.customItemsCount++;
                }
                if (item.isTransportation) {
                    group.isTransportation = true;
                }
                if (item.periodType) {
                    group.periodTypes.add(item.periodType);
                }
            }
        }
    }
    
    // Process previous periods
    for (const p of periodData.previousPeriods) {
        for (const [sgName, sgData] of Object.entries(p.statusGroupBreakdown || {})) {
            if (!allStatusGroups.has(sgName)) {
                allStatusGroups.set(sgName, {
                    name: sgName,
                    expected: 0,
                    paid: 0,
                    balance: 0,
                    itemsRequired: 0,
                    itemsBrought: 0,
                    itemsRemaining: 0,
                    hasCustomItems: false,
                    customItemsCount: 0,
                    periodTypes: new Set(),
                    isTransportation: false
                });
            }
            const group = allStatusGroups.get(sgName);
            group.expected += sgData.expected || 0;
            group.paid += sgData.paid || 0;
            group.balance += sgData.balance || 0;
            group.itemsRequired += sgData.itemsRequired || 0;
            group.itemsBrought += sgData.itemsBrought || 0;
            group.itemsRemaining += sgData.itemsRemaining || 0;
            
            for (const item of (sgData.items || [])) {
                if (item.isCustomized) {
                    group.hasCustomItems = true;
                    group.customItemsCount++;
                }
                if (item.isTransportation) {
                    group.isTransportation = true;
                }
                if (item.periodType) {
                    group.periodTypes.add(item.periodType);
                }
            }
        }
    }
    
    return allStatusGroups;
}

// ==================== RENDER STATUS GROUP CELL WITH ALL PERIODS ====================

function renderStatusGroupCellWithAllPeriods(student, sg, allStatusGroups, formatMoneyFn) {
    const groupData = allStatusGroups.get(sg.name) || {
        expected: 0,
        paid: 0,
        balance: 0,
        itemsRequired: 0,
        itemsBrought: 0,
        itemsRemaining: 0,
        hasCustomItems: false,
        customItemsCount: 0,
        periodTypes: new Set(),
        isTransportation: false
    };
    
    const expected = groupData.expected || 0;
    const paid = groupData.paid || 0;
    const balance = groupData.balance || 0;
    const itemsRemaining = groupData.itemsRemaining || 0;
    const customItemsCount = groupData.customItemsCount || 0;
    const hasCustomItems = groupData.hasCustomItems || false;
    
    // Check if student has fee structure with this group
    const hasGroupInStructure = student.studentFeeStructureGroups ? student.studentFeeStructureGroups[sg.name] : false;
    
    if (!student.hasFeeStructure) {
        return `<td class="p-2 text-center border text-xs text-gray-400">
            <span class="italic">No Fee Structure</span>
        </td>`;
    }
    
    if (!hasGroupInStructure) {
        const displayName = sg.name === 'schoolastic requirement' ? 'Scholastic' : 
                           sg.name === 'Admission Fee' ? 'Admission' : sg.name;
        return `<td class="p-2 text-center border text-xs text-gray-400">
            <span class="italic">Does not pay ${escapeHtml(displayName)}</span>
        </td>`;
    }
    
    // Special handling for Transportation
    if (sg.name.toLowerCase().includes('transport') && student.customTransportation) {
        if (student.customTransportation.hasTransportation === false) {
            return `<td class="p-2 text-center border text-xs text-gray-400">
                <span class="italic">Transport disabled</span>
            </td>`;
        }
    }
    
    // Build display
    const customBadge = hasCustomItems ? 
        `<span class="text-xs text-orange-500 ml-1">⚡${customItemsCount}</span>` : '';
    
    const periodIcons = [];
    if (groupData.periodTypes.has('one_time')) periodIcons.push('⭐');
    if (groupData.periodTypes.has('termly')) periodIcons.push('📅');
    if (groupData.periodTypes.has('yearly')) periodIcons.push('📆');
    const periodBadge = periodIcons.length > 0 ? 
        `<span class="text-xs text-gray-400">${periodIcons.join(' ')}</span>` : '';
    
    let displayHtml = '';
    
    if (expected === 0 && paid === 0 && itemsRemaining === 0) {
        displayHtml = `<span class="text-gray-400">-</span>`;
    } else if (Math.abs(balance) <= 10 && paid > 0) {
        displayHtml = `<span class="text-green-600 font-semibold">✓ Fully Paid</span>`;
    } else if (balance < 0) {
        displayHtml = `<span class="text-blue-600 font-semibold">Credit: UGX ${formatMoneyFn(Math.abs(balance))}</span>`;
    } else if (balance > 0 && paid > 0) {
        displayHtml = `
            <div class="text-red-600 font-semibold">UGX ${formatMoneyFn(balance)}</div>
            <div class="text-orange-600 text-xs">${itemsRemaining} item(s)</div>
        `;
    } else if (balance > 0 && paid === 0) {
        displayHtml = `
            <div class="text-red-600 font-semibold">UGX ${formatMoneyFn(expected)}</div>
            <div class="text-orange-600 text-xs">${itemsRemaining} item(s)</div>
        `;
    } else if (paid > 0) {
        displayHtml = `<span class="text-green-600">UGX ${formatMoneyFn(paid)}</span>`;
    } else {
        displayHtml = `<span class="text-gray-400">-</span>`;
    }
    
    // Transportation custom badge
    let transportBadge = '';
    if (sg.name.toLowerCase().includes('transport') && student.customTransportation) {
        if (student.customTransportation.amount) {
            transportBadge = `<div class="text-xs text-blue-500">🚌 Custom: UGX ${formatMoneyFn(student.customTransportation.amount)}</div>`;
        }
    }
    
    const infoIcon = expected > 0 || itemsRemaining > 0 ? 
        `<i class="fas fa-info-circle text-blue-500 ml-1 cursor-pointer hover:text-blue-700" 
            onclick="event.stopPropagation(); showStatusGroupItemDetailsModal('${student.id}', '${escapeHtml(sg.name)}')"></i>` : '';
    
    return `
        <td class="p-2 text-center border text-xs">
            <div class="cursor-pointer hover:bg-gray-100 rounded p-1 transition" 
                 onclick="showStatusGroupItemDetailsModal('${student.id}', '${escapeHtml(sg.name)}')">
                ${displayHtml}
                ${transportBadge}
                ${customBadge}
                ${periodBadge}
                ${infoIcon}
            </div>
        </td>
    `;
}

// ==================== COMPLETE SHOW STUDENT LIST ====================

// ==================== COMPLETE REBUILT STUDENT LIST v9.0 ====================
// Version: 9.0 - Fixes "Does not pay" issue, shows ALL period balances correctly
// ==================== COMPLETE REBUILT STUDENT LIST - CURRENT TERM ONLY ====================
// Version: 10.0 - Shows ONLY current term data, no previous balances
// ==================== COMPLETE REBUILT STUDENT LIST ====================
// Version: 11.0 - WITH OR LOGIC AND EXCEL-COMPATIBLE DATA
// - Cash and Items tracked separately (never converted)
// - OR Logic: Cash OR Items (either method covers the requirement)
// - Items brought are NEVER converted to cash
// - Removed items are excluded
// - Custom overrides are applied
// - Shows CURRENT TERM ONLY
// ============================================================================
// ALL STUDENTS — MODERN EDITION
// Version: 12.0 — Matches dashboard.js design system (teal/indigo ledger look)
// Same data contracts, OR-logic calculations & function names — visuals rebuilt.
// ============================================================================

async function showStudentList() {
    console.log('showStudentList called - v13.0 CURRENT PERIOD SCHOLASTIC ITEMS FIXED + FUZZY SEARCH');
    if (typeof injectDashboardDesignSystem === 'function') injectDashboardDesignSystem();

    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) pageTitle.innerHTML = '<i class="fas fa-users mr-2"></i>All Students';

    const mainContent = document.getElementById('mainContent');
    if (mainContent) {
        mainContent.innerHTML = `
            <div class="db-app-bg -m-4 p-4 min-h-[70vh] rounded-2xl">
                <div class="db-hero mb-6" style="padding-bottom:30px;">
                    <div class="db-skeleton h-8 w-64 mb-3 opacity-40"></div>
                    <div class="db-skeleton h-4 w-40 opacity-30"></div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
                    ${Array(5).fill('<div class="db-skeleton h-28 rounded-2xl"></div>').join('')}
                </div>
            </div>
        `;
    }

    try {
        await initializeAcademicSettings();
        const { currentYear, currentTerm } = currentAcademicSettings;
        const termName = getTermName(currentTerm);
        const isFirstTerm = currentTerm === 1;

        // ========== FETCH ALL DATA ==========
        const [studentsRes, classesRes, feeStructuresRes, feeAssignmentsRes, feePaymentsRes, feeBursariesRes, termRecordsRes] = await Promise.all([
            fetch('/api/students').catch(() => ({ ok: false, json: async () => [] })),
            fetch('/api/school/classes').catch(() => ({ ok: false, json: async () => [] })),
            fetch('/api/fee/structures').catch(() => ({ ok: false, json: async () => [] })),
            fetch('/api/student-fee-assignments').catch(() => ({ ok: false, json: async () => [] })),
            fetch(`/api/fee/payments?year=${currentYear}&term=${currentTerm}`).catch(() => ({ ok: false, json: async () => [] })),
            fetch('/api/fee/bursaries').catch(() => ({ ok: false, json: async () => [] })),
            fetch('/api/student-term-records').catch(() => ({ ok: false, json: async () => ({}) }))
        ]);

        let students = studentsRes.ok ? await studentsRes.json() : [];
        let classes = classesRes.ok ? await classesRes.json() : [];
        let feeStructures = feeStructuresRes.ok ? await feeStructuresRes.json() : [];
        let feeAssignments = feeAssignmentsRes.ok ? await feeAssignmentsRes.json() : [];
        let allPayments = feePaymentsRes.ok ? await feePaymentsRes.json() : [];
        let feeBursaries = feeBursariesRes.ok ? await feeBursariesRes.json() : [];
        let termRecords = termRecordsRes.ok ? await termRecordsRes.json() : {};

        students = Array.isArray(students) ? students : [];
        classes = Array.isArray(classes) ? classes : [];
        feeStructures = Array.isArray(feeStructures) ? feeStructures : [];
        feeAssignments = Array.isArray(feeAssignments) ? feeAssignments : [];
        allPayments = Array.isArray(allPayments) ? allPayments : [];

        console.log(`📊 Loaded ${students.length} students, ${feeStructures.length} fee structures`);
        console.log(`📊 Loaded ${allPayments.length} payments for ${termName} ${currentYear}`);

        // ========== CREATE MAPS ==========
        const classesMap = {};
        classes.forEach(c => { if (c && c.id) classesMap[c.id] = c; });

        const assignmentsMap = {};
        feeAssignments.forEach(a => { if (a && a.studentId) assignmentsMap[a.studentId] = a; });

        const bursariesMap = {};
        feeBursaries.forEach(b => { if (b && b.id) bursariesMap[b.id] = b; });

        const feeStructuresMap = {};
        feeStructures.forEach(fs => { if (fs && fs.id) feeStructuresMap[fs.id] = fs; });

        // ========== BUILD STATUS GROUPS MAP ==========
        const allStatusGroups = new Map();

        feeStructures.forEach(fs => {
            (fs.activityComponents || []).forEach(comp => {
                const statusGroupName = comp.statusGroupName || comp.name || 'Other';
                if (!allStatusGroups.has(statusGroupName)) {
                    allStatusGroups.set(statusGroupName, {
                        name: statusGroupName,
                        periodTypes: new Set(),
                        color: getStatusGroupColor(statusGroupName)
                    });
                }
                const periodType = comp.periodType || 'termly';
                allStatusGroups.get(statusGroupName).periodTypes.add(periodType);
            });
        });

        const sortedStatusGroups = Array.from(allStatusGroups.values()).sort((a, b) => {
            const order = { 'Transportation': 1, 'Admission Fee': 2, 'schoolastic requirement': 3 };
            const aOrder = order[a.name] || 99;
            const bOrder = order[b.name] || 99;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return a.name.localeCompare(b.name);
        });

        console.log('📊 Status Groups:', sortedStatusGroups.map(sg => sg.name));

        // ========== HELPER FUNCTIONS ==========
        function formatMoney(amount) {
            const num = Math.round(amount || 0);
            return num.toLocaleString('en-US');
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function getStatusGroupColor(name) {
            const colors = {
                'Transportation': 'bg-orange-50 text-orange-700 border-orange-200',
                'Admission Fee': 'bg-purple-50 text-purple-700 border-purple-200',
                'schoolastic requirement': 'bg-emerald-50 text-emerald-700 border-emerald-200',
                'Tuition': 'bg-indigo-50 text-indigo-700 border-indigo-200'
            };
            return colors[name] || 'bg-slate-100 text-slate-600 border-slate-200';
        }

        function getTermName(term) {
            const names = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
            return names[term] || `Term ${term}`;
        }

        function closeModal() {
            const modal = document.querySelector('.fixed.inset-0');
            if (modal) modal.remove();
        }

        // ========== FUZZY SEARCH HELPERS ==========
        // Levenshtein edit distance (classic DP implementation) — counts the
        // minimum number of single-character insertions, deletions, or
        // substitutions needed to turn `a` into `b`.
        function levenshteinDistance(a, b) {
            a = a || ''; b = b || '';
            const m = a.length, n = b.length;
            if (m === 0) return n;
            if (n === 0) return m;

            let prevRow = new Array(n + 1);
            let currRow = new Array(n + 1);
            for (let j = 0; j <= n; j++) prevRow[j] = j;

            for (let i = 1; i <= m; i++) {
                currRow[0] = i;
                for (let j = 1; j <= n; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    currRow[j] = Math.min(
                        currRow[j - 1] + 1,      // insertion
                        prevRow[j] + 1,           // deletion
                        prevRow[j - 1] + cost     // substitution
                    );
                }
                [prevRow, currRow] = [currRow, prevRow];
            }
            return prevRow[n];
        }

        // Returns a 0..1 similarity score between a search query and a single
        // word/token, tolerant of typos, missing letters, or transpositions.
        function fuzzyWordScore(query, word) {
            if (!query || !word) return 0;
            if (word === query) return 1;
            if (word.startsWith(query)) return 0.95;
            if (word.includes(query)) return 0.85;

            const dist = levenshteinDistance(query, word);
            const maxLen = Math.max(query.length, word.length);
            if (maxLen === 0) return 0;
            return Math.max(0, 1 - dist / maxLen);
        }

        // Fuzzy-matches a search query against a full text field (a student
        // name, admission number, etc). Checks the whole string plus each
        // individual word (so "gabriela" still matches "Gabriella Sserunjogi"
        // even though the word order/spelling isn't exact), and requires a
        // minimum query length before applying edit-distance tolerance so
        // very short queries ("sg") don't produce noisy false positives.
        function fuzzyTextMatch(query, text, threshold = 0.6) {
            const q = (query || '').toLowerCase().trim();
            const t = (text || '').toLowerCase().trim();
            if (!q) return true;
            if (!t) return false;

            // Fast path: plain substring match always counts, regardless of length.
            if (t.includes(q)) return true;

            // Short queries: don't apply fuzzy edit-distance (too noisy on 1-2
            // char inputs) — only substring/word-prefix matching applies.
            if (q.length < 3) {
                return t.split(/\s+/).some(word => word.startsWith(q));
            }

            // Whole-string similarity (helps when comparing full names)
            const fullScore = fuzzyWordScore(q, t);
            if (fullScore >= threshold) return true;

            // Per-word similarity (helps when the query matches just one
            // part of a multi-word name/field, e.g. only the first name)
            const words = t.split(/\s+/).filter(Boolean);
            return words.some(word => fuzzyWordScore(q, word) >= threshold);
        }

        // ========== GET CUSTOMIZED ITEM VALUE ==========
        function getCustomizedItemValue(student, itemId, defaultAmount, defaultQuantity, defaultPaymentOption, defaultUnitPrice) {
            if (student && student.customItemOverrides && student.customItemOverrides[itemId]) {
                const custom = student.customItemOverrides[itemId];
                if (custom.isActive !== false) {
                    const customAmount = (custom.customAmount !== null && custom.customAmount !== undefined)
                        ? custom.customAmount
                        : defaultAmount;
                    const customQuantity = (custom.customQuantity !== null && custom.customQuantity !== undefined)
                        ? custom.customQuantity
                        : defaultQuantity;
                    const customPaymentOption = custom.paymentOption || defaultPaymentOption;

                    let customUnitPrice = defaultUnitPrice;
                    if (customQuantity > 0 && customAmount > 0) {
                        customUnitPrice = customAmount / customQuantity;
                    } else if (customAmount > 0) {
                        customUnitPrice = customAmount / (customQuantity || 1);
                    } else if (customQuantity > 0) {
                        customUnitPrice = defaultUnitPrice || (defaultAmount / (defaultQuantity || 1));
                    }

                    return {
                        amount: customAmount,
                        quantity: customQuantity,
                        paymentOption: customPaymentOption,
                        unitPrice: customUnitPrice,
                        isCustomized: true,
                        reason: custom.reason || null,
                        updatedAt: custom.updatedAt || null,
                        customAmount: custom.customAmount,
                        customQuantity: custom.customQuantity,
                        defaultAmount: custom.defaultAmount || defaultAmount,
                        defaultQuantity: custom.defaultQuantity || defaultQuantity
                    };
                }
            }

            return {
                amount: defaultAmount || 0,
                quantity: defaultQuantity || 1,
                paymentOption: defaultPaymentOption || 'either',
                unitPrice: defaultUnitPrice || (defaultAmount / (defaultQuantity || 1)),
                isCustomized: false,
                reason: null,
                updatedAt: null,
                customAmount: null,
                customQuantity: null,
                defaultAmount: defaultAmount || 0,
                defaultQuantity: defaultQuantity || 1
            };
        }

        // ========== CHECK IF ITEM IS REMOVED ==========
        function isItemRemoved(student, itemId) {
            if (!student || !student.removedItems) return false;
            return student.removedItems[itemId] && student.removedItems[itemId].isActive !== false;
        }

        // ========== GET PAID AMOUNTS WITH OR LOGIC ==========
        function getPaidAmountsWithOrLogic(studentId, componentName, itemName, periodType, quantityRequired, amountExpected, unitPrice, paymentOption, paymentsToCheck) {
            let cashPaid = 0;
            let itemsBrought = 0;
            const paymentHistories = [];
            const processedKeys = new Set();
            const uniquePaymentItems = new Map();

            for (const payment of paymentsToCheck) {
                if (!payment || !payment.id) continue;

                if (payment.activityItemPayments && Array.isArray(payment.activityItemPayments)) {
                    for (const paidItem of payment.activityItemPayments) {
                        if (!paidItem || !paidItem.componentName || !paidItem.itemName) continue;
                        const compMatch = paidItem.componentName && paidItem.componentName.toLowerCase() === componentName.toLowerCase();
                        const itemMatch = paidItem.itemName && paidItem.itemName.toLowerCase() === itemName.toLowerCase();
                        if (compMatch && itemMatch) {
                            const key = `${payment.id}_${paidItem.itemName}_${paidItem.componentName}`;
                            if (!uniquePaymentItems.has(key)) uniquePaymentItems.set(key, { payment, paidItem });
                        }
                    }
                }

                if (payment.paymentsByPeriodType) {
                    const periodTypes = ['one_time', 'termly', 'yearly'];
                    for (const pt of periodTypes) {
                        const periodItems = payment.paymentsByPeriodType[pt] || [];
                        for (const paidItem of periodItems) {
                            if (!paidItem || !paidItem.componentName || !paidItem.itemName) continue;
                            const compMatch = paidItem.componentName && paidItem.componentName.toLowerCase() === componentName.toLowerCase();
                            const itemMatch = paidItem.itemName && paidItem.itemName.toLowerCase() === itemName.toLowerCase();
                            if (compMatch && itemMatch) {
                                const key = `${payment.id}_${paidItem.itemName}_${paidItem.componentName}`;
                                if (!uniquePaymentItems.has(key)) uniquePaymentItems.set(key, { payment, paidItem });
                            }
                        }
                    }
                }
            }

            for (const [key, data] of uniquePaymentItems) {
                const { payment, paidItem } = data;
                const historyKey = `${payment.receiptNumber || payment.id}_${paidItem.itemName}`;
                if (processedKeys.has(historyKey)) continue;
                processedKeys.add(historyKey);

                if (paidItem.paymentType === 'paid_cash') {
                    const amount = (paidItem.amountPaid || 0);
                    cashPaid += amount;
                    paymentHistories.push({
                        type: 'cash', amount: amount, date: payment.date || new Date().toISOString(),
                        receiptNumber: payment.receiptNumber || 'N/A', academicYear: payment.academicYear,
                        term: payment.term, paymentId: payment.id,
                        isPreviousBalancePayment: payment.isPreviousBalancePayment || false,
                        method: payment.method || 'cash'
                    });
                } else if (paidItem.paymentType === 'brought_item') {
                    const qty = (paidItem.itemsBrought || 0);
                    const equiv = (paidItem.cashEquivalent || qty * (paidItem.unitPrice || 0));
                    itemsBrought += qty;
                    paymentHistories.push({
                        type: 'item', quantity: qty, amount: equiv, date: payment.date || new Date().toISOString(),
                        receiptNumber: payment.receiptNumber || 'N/A', academicYear: payment.academicYear,
                        term: payment.term, paymentId: payment.id,
                        isPreviousBalancePayment: payment.isPreviousBalancePayment || false,
                        method: payment.method || 'cash'
                    });
                }
            }

            let finalCashPaid = cashPaid;
            let finalItemsBrought = Math.min(itemsBrought, quantityRequired);

            if (paymentOption === 'either' || paymentOption === 'item_only') {
                if (finalItemsBrought >= quantityRequired) {
                    finalCashPaid = 0;
                } else if (paymentOption === 'item_only') {
                    finalCashPaid = 0;
                }
            }

            if (paymentOption === 'cash_only' || paymentOption === 'either') {
                finalCashPaid = Math.min(finalCashPaid, amountExpected);
            }

            let remainingAmount = 0;
            let remainingItems = 0;
            let isFullyPaid = false;
            let isOverDelivered = false;

            if (paymentOption === 'cash_only') {
                remainingAmount = Math.max(0, amountExpected - finalCashPaid);
                isFullyPaid = remainingAmount <= 0;
            } else if (paymentOption === 'item_only') {
                remainingItems = Math.max(0, quantityRequired - finalItemsBrought);
                isFullyPaid = remainingItems <= 0;
                isOverDelivered = itemsBrought > quantityRequired;
            } else {
                const cashCovers = finalCashPaid >= amountExpected;
                const itemsCover = finalItemsBrought >= quantityRequired;
                isFullyPaid = cashCovers || itemsCover;

                if (!isFullyPaid) {
                    const totalPaidValue = finalCashPaid + (finalItemsBrought * unitPrice);
                    const totalRequired = quantityRequired * unitPrice;
                    remainingAmount = Math.max(0, totalRequired - totalPaidValue);
                    remainingItems = Math.ceil(remainingAmount / unitPrice);
                }
                isOverDelivered = itemsBrought > quantityRequired && finalCashPaid === 0;
            }

            return {
                cashPaid: finalCashPaid, itemsBrought: finalItemsBrought,
                remainingAmount, remainingItems, isFullyPaid, isOverDelivered,
                paymentHistories, cashPaidRaw: cashPaid, itemsBroughtRaw: itemsBrought
            };
        }

        // ========== PROCESS EACH STUDENT ==========
        const enhancedStudents = [];
        let totalStudents = 0, maleCount = 0, femaleCount = 0, activeCount = 0;
        let totalTuitionExpected = 0, totalTuitionCollected = 0;
        let totalCurrentItemsOutstanding = 0;
        let studentsWithCustomizations = 0, noFeeStructureCount = 0;
        let fullyPaidCount = 0, paymentDueCount = 0, noPaymentCount = 0, creditCount = 0, criticalCount = 0;
        let nurseryCount = 0, lowerPrimaryCount = 0, upperPrimaryCount = 0;

        for (const student of students) {
            // Determine all periods for this student from payments, term records, fee assignments
            const studentPeriods = new Map();

            allPayments.forEach(p => {
                if (p && p.studentId === student.id && p.academicYear && p.term !== undefined) {
                    const key = `${p.academicYear}_${p.term}`;
                    if (!studentPeriods.has(key)) {
                        studentPeriods.set(key, { year: parseInt(p.academicYear), term: parseInt(p.term) });
                    }
                }
            });

            for (const [key, record] of Object.entries(termRecords)) {
                if (key.startsWith(student.id + '_')) {
                    const parts = key.split('_');
                    if (parts.length === 3) {
                        const year = parseInt(parts[1]);
                        const term = parseInt(parts[2]);
                        const periodKey = `${year}_${term}`;
                        if (!studentPeriods.has(periodKey)) {
                            studentPeriods.set(periodKey, { year, term });
                        }
                    }
                }
            }

            feeAssignments.forEach(a => {
                if (a && a.studentId === student.id && a.academicYear) {
                    const year = parseInt(a.academicYear);
                    const term = parseInt(a.term) || 1;
                    const key = `${year}_${term}`;
                    if (!studentPeriods.has(key)) {
                        studentPeriods.set(key, { year, term });
                    }
                }
            });

            if (studentPeriods.size === 0) {
                studentPeriods.set(`${currentYear}_${currentTerm}`, { year: currentYear, term: currentTerm });
            }

            const maxTermByYear = {};
            let oldestYear = Infinity, oldestTerm = Infinity, oldestPeriodKey = null;
            for (const [key, data] of studentPeriods) {
                const { year, term } = data;
                if (!maxTermByYear[year] || term > maxTermByYear[year]) {
                    maxTermByYear[year] = term;
                }
                if (year < oldestYear || (year === oldestYear && term < oldestTerm)) {
                    oldestYear = year;
                    oldestTerm = term;
                    oldestPeriodKey = key;
                }
            }

            const isLatestTermForCurrentYear = (currentTerm === maxTermByYear[currentYear]);
            const isOldestPeriod = (oldestPeriodKey === `${currentYear}_${currentTerm}`);

            totalStudents++;
            if (student.gender === 'Male') maleCount++;
            else if (student.gender === 'Female') femaleCount++;
            if (student.status === 'Active') activeCount++;

            const assignment = assignmentsMap[student.id] || {};
            const feeStructure = feeStructures.find(f => f && f.id === assignment.feeStructureId);

            let currentClass = 'Not Assigned';
            let classLevel = 'Unknown';
            if (student.currentClassId && classesMap[student.currentClassId]) {
                currentClass = classesMap[student.currentClassId].name;
                classLevel = classesMap[student.currentClassId].level || 'Unknown';
            } else if (student.currentClass) {
                currentClass = student.currentClass;
            }

            if (classLevel === 'Nursery') nurseryCount++;
            else if (classLevel === 'LowerPrimary') lowerPrimaryCount++;
            else if (classLevel === 'UpperPrimary') upperPrimaryCount++;

            // ========== CALCULATE TUITION ==========
            let originalTuition = feeStructure ? (feeStructure.tuition || 0) : 0;
            let expectedTuition = originalTuition;
            let discountAmount = 0;
            let discountDisplay = '';
            let bursaryName = null;

            if (student.customBursary && student.customBursary.amount > 0) {
                discountAmount = student.customBursary.amount;
                discountDisplay = `Custom: UGX ${discountAmount.toLocaleString()} off`;
                expectedTuition = Math.max(0, originalTuition - discountAmount);
                bursaryName = 'Custom Bursary';
            } else if (assignment.bursaryId && bursariesMap[assignment.bursaryId]) {
                const bursary = bursariesMap[assignment.bursaryId];
                bursaryName = bursary.name;
                if (bursary.type === 'percentage') {
                    discountAmount = (originalTuition * bursary.value) / 100;
                    discountDisplay = `${bursary.value}% off`;
                    expectedTuition = Math.max(0, originalTuition - discountAmount);
                } else {
                    discountAmount = bursary.value;
                    discountDisplay = `UGX ${discountAmount.toLocaleString()} off`;
                    expectedTuition = Math.max(0, originalTuition - discountAmount);
                }
            }

            let tuitionPaid = 0;
            const studentPayments = allPayments.filter(p =>
                p && p.studentId === student.id &&
                p.term === currentTerm &&
                p.academicYear === currentYear.toString()
            );
            for (const p of studentPayments) tuitionPaid += (p.tuitionPaid || 0);

            const tuitionBalance = expectedTuition - tuitionPaid;

            let tuitionStatusText = 'Payment Due';
            let tuitionStatusColor = 'bg-amber-50 text-amber-700 border border-amber-200';
            let tuitionStatusIcon = '⚠️';

            if (Math.abs(tuitionBalance) <= 10 && tuitionPaid > 0) {
                tuitionStatusText = 'Fully Paid'; tuitionStatusColor = 'bg-emerald-50 text-emerald-700 border border-emerald-200'; tuitionStatusIcon = '✅';
            } else if (tuitionBalance < -10) {
                tuitionStatusText = 'Credit Balance'; tuitionStatusColor = 'bg-sky-50 text-sky-700 border border-sky-200'; tuitionStatusIcon = '💰';
            } else if (tuitionBalance > expectedTuition && expectedTuition > 0) {
                tuitionStatusText = 'Critical Overdue'; tuitionStatusColor = 'bg-rose-50 text-rose-700 border border-rose-200'; tuitionStatusIcon = '🔴';
            } else if (tuitionPaid === 0 && expectedTuition > 0) {
                tuitionStatusText = 'No Payment'; tuitionStatusColor = 'bg-slate-100 text-slate-600 border border-slate-200'; tuitionStatusIcon = '📋';
            }

            totalTuitionExpected += expectedTuition;
            totalTuitionCollected += tuitionPaid;

            if (tuitionStatusText === 'Fully Paid') fullyPaidCount++;
            else if (tuitionStatusText === 'Payment Due') paymentDueCount++;
            else if (tuitionStatusText === 'No Payment') noPaymentCount++;
            else if (tuitionStatusText === 'Credit Balance') creditCount++;
            else if (tuitionStatusText === 'Critical Overdue') criticalCount++;

            if (!feeStructure) noFeeStructureCount++;

            // ========== BUILD STATUS GROUP DATA – only for current period, only scholastic groups ==========
            const statusGroupTotals = {};
            for (const sg of sortedStatusGroups) {
                statusGroupTotals[sg.name] = {
                    expected: 0, paid: 0, balance: 0, moneyRemaining: 0, itemsRemaining: 0, items: [],
                    hasStructure: false, periodTypes: new Set(), isTransportation: false,
                    customAmountApplied: false, customTransportAmount: null, customItemsCount: 0,
                    existsInFeeStructure: false
                };
            }

            let currentPeriodItemsRemaining = 0;

            // ========== MAIN LOOP OVER COMPONENTS (for status groups and OR totals) ==========
            if (feeStructure && feeStructure.activityComponents) {
                for (const component of feeStructure.activityComponents) {
                    const periodType = component.periodType || 'termly';

                    let shouldInclude = false;
                    if (periodType === 'termly') shouldInclude = true;
                    else if (periodType === 'one_time') shouldInclude = isOldestPeriod;
                    else if (periodType === 'yearly') shouldInclude = isLatestTermForCurrentYear;

                    if (!shouldInclude) continue;

                    const groupName = component.statusGroupName || component.name || 'Other';
                    const isTransportation = component.name.toLowerCase().includes('transport') ||
                        (component.statusGroupName && component.statusGroupName.toLowerCase().includes('transport'));

                    if (isTransportation && student.customTransportation) {
                        if (student.customTransportation.hasTransportation === false) continue;
                    }

                    if (!statusGroupTotals[groupName]) {
                        statusGroupTotals[groupName] = {
                            expected: 0, paid: 0, balance: 0, moneyRemaining: 0, itemsRemaining: 0, items: [],
                            hasStructure: false, periodTypes: new Set(), isTransportation: isTransportation,
                            customAmountApplied: false, customTransportAmount: null, customItemsCount: 0,
                            existsInFeeStructure: false
                        };
                    }

                    statusGroupTotals[groupName].hasStructure = true;
                    statusGroupTotals[groupName].existsInFeeStructure = true;
                    statusGroupTotals[groupName].periodTypes.add(periodType);
                    statusGroupTotals[groupName].isTransportation = isTransportation;

                    let scopedPayments = [];
                    if (periodType === 'yearly') {
                        scopedPayments = allPayments.filter(p =>
                            p && p.studentId === student.id &&
                            parseInt(p.academicYear) === currentYear
                        );
                    } else if (periodType === 'one_time') {
                        scopedPayments = allPayments.filter(p => p && p.studentId === student.id);
                    } else {
                        scopedPayments = studentPayments;
                    }

                    for (const item of (component.items || [])) {
                        const itemId = item.id || item.name;
                        if (isItemRemoved(student, itemId)) continue;

                        const defaultAmount = item.totalAmount || 0;
                        const defaultQuantity = item.quantity || 1;
                        const defaultUnitPrice = item.unitPrice || (defaultAmount / defaultQuantity);
                        const defaultPaymentOption = item.paymentOption || 'either';

                        const customValues = getCustomizedItemValue(student, itemId, defaultAmount, defaultQuantity, defaultPaymentOption, defaultUnitPrice);

                        let effectiveAmount = customValues.amount;
                        let effectiveQuantity = customValues.quantity;
                        let effectiveUnitPrice = customValues.unitPrice;
                        let effectivePaymentOption = customValues.paymentOption;
                        const isCustomized = customValues.isCustomized;
                        const customReason = customValues.reason;

                        if (isTransportation && student.customTransportation) {
                            if (student.customTransportation.hasTransportation === false) continue;
                            if (student.customTransportation.amount) {
                                effectiveAmount = student.customTransportation.amount;
                                effectiveUnitPrice = effectiveAmount / (effectiveQuantity || 1);
                            }
                        }

                        const paidInfo = getPaidAmountsWithOrLogic(
                            student.id, component.name, item.name, periodType,
                            effectiveQuantity, effectiveAmount, effectiveUnitPrice, effectivePaymentOption,
                            scopedPayments
                        );

                        const cashPaid = paidInfo.cashPaid;
                        const itemsBrought = paidInfo.itemsBrought;
                        const paymentHistories = paidInfo.paymentHistories;
                        const isFullyPaid = paidInfo.isFullyPaid;
                        const isOverDelivered = paidInfo.isOverDelivered;
                        const remainingAmount = paidInfo.remainingAmount;
                        const remainingQuantity = paidInfo.remainingItems;

                        let statusText = 'Not Paid', statusClass = 'bg-rose-50 text-rose-600', statusIcon = '❌';

                        if (isFullyPaid) {
                            if (effectivePaymentOption === 'item_only' && itemsBrought > 0) { statusText = '✅ Items Delivered'; statusClass = 'bg-emerald-50 text-emerald-700'; statusIcon = '✅'; }
                            else if (effectivePaymentOption === 'cash_only' && cashPaid > 0) { statusText = '✅ Cash Paid'; statusClass = 'bg-emerald-50 text-emerald-700'; statusIcon = '✅'; }
                            else if (cashPaid > 0 && itemsBrought > 0) { statusText = '✅ Both (Cash + Items)'; statusClass = 'bg-emerald-50 text-emerald-700'; statusIcon = '✅'; }
                            else if (cashPaid > 0) { statusText = '✅ Cash Only'; statusClass = 'bg-emerald-50 text-emerald-700'; statusIcon = '✅'; }
                            else if (itemsBrought > 0) { statusText = '✅ Items Only'; statusClass = 'bg-emerald-50 text-emerald-700'; statusIcon = '✅'; }
                            else { statusText = '✅ Fully Paid'; statusClass = 'bg-emerald-50 text-emerald-700'; statusIcon = '✅'; }
                        } else if (cashPaid > 0 || itemsBrought > 0) {
                            statusText = '⚠️ Partial'; statusClass = 'bg-amber-50 text-amber-700'; statusIcon = '⚠️';
                        } else {
                            statusText = '❌ Unpaid'; statusClass = 'bg-rose-50 text-rose-600'; statusIcon = '❌';
                        }

                        const isScholastic = groupName.toLowerCase().includes('scholastic');
                        if (isScholastic) {
                            currentPeriodItemsRemaining += remainingQuantity;
                        }

                        statusGroupTotals[groupName].expected += effectiveAmount;
                        statusGroupTotals[groupName].paid += cashPaid;
                        statusGroupTotals[groupName].balance += remainingAmount;
                        statusGroupTotals[groupName].moneyRemaining += remainingAmount;
                        statusGroupTotals[groupName].itemsRemaining += remainingQuantity;
                        statusGroupTotals[groupName].items.push({
                            name: item.name, itemId: itemId, quantityRequired: effectiveQuantity, totalAmount: effectiveAmount,
                            unitPrice: effectiveUnitPrice, paymentOption: effectivePaymentOption, cashPaid: cashPaid,
                            itemsBrought: itemsBrought, remainingAmount: remainingAmount, remainingQuantity: remainingQuantity,
                            isFullyPaid: isFullyPaid, isOverDelivered: isOverDelivered, isCustomized: isCustomized,
                            customReason: customReason, paymentHistories: paymentHistories, periodType: periodType,
                            isTransportation: isTransportation, statusText: statusText, statusClass: statusClass, statusIcon: statusIcon
                        });

                        if (isCustomized) statusGroupTotals[groupName].customItemsCount++;
                    }
                }
            }

            // ========== CALCULATE ORIGINAL TOTALS (for reference) ==========
            let totalExpected = 0, totalPaid = 0, totalBalance = 0, totalRemainingItems = 0, totalCustomItems = 0;
            for (const sg of sortedStatusGroups) {
                const dataSg = statusGroupTotals[sg.name] || { expected: 0, paid: 0, balance: 0, itemsRemaining: 0, customItemsCount: 0 };
                totalExpected += dataSg.expected;
                totalPaid += dataSg.paid;
                totalBalance += dataSg.balance;
                totalRemainingItems += dataSg.itemsRemaining;
                totalCustomItems += dataSg.customItemsCount;
            }
            totalExpected += expectedTuition;
            totalPaid += tuitionPaid;
            totalBalance += tuitionBalance;

            totalCurrentItemsOutstanding += currentPeriodItemsRemaining;

            const hasCustomizations = student.customItemOverrides && Object.keys(student.customItemOverrides).length > 0;
            if (hasCustomizations) studentsWithCustomizations++;

            // ========== COMPUTE CASH‑ONLY TOTALS (tuition + all cash‑only items, regardless of period) ==========
                    // ========== COMPUTE CASH-ONLY TOTALS (FIXED v2 — matches what's shown per-cell) ==========
            // NOTE: We intentionally do NOT gate cash-only items by one_time/yearly period
            // position here. renderStatusGroupCell() already displays a cash-only item's
            // amount for any status group defined in the student's fee structure (via its
            // fallback), regardless of period position. If we excluded those same items
            // from this total, the Balance column would silently disagree with every cell
            // above it. So this loop counts every cash-only item that exists in the fee
            // structure and hasn't been explicitly removed for the student — exactly the
            // same criteria the cell display already uses.
            let cashOnlyExpected = expectedTuition;
            let cashOnlyPaid = tuitionPaid;

            if (feeStructure && feeStructure.activityComponents) {
                for (const component of feeStructure.activityComponents) {
                    const periodType = component.periodType || 'termly';

                    const isTransportation = component.name.toLowerCase().includes('transport') ||
                        (component.statusGroupName && component.statusGroupName.toLowerCase().includes('transport'));
                    if (isTransportation && student.customTransportation && student.customTransportation.hasTransportation === false) continue;

                    for (const item of (component.items || [])) {
                        const itemId = item.id || item.name;
                        if (isItemRemoved(student, itemId)) continue;

                        const defaultAmount = item.totalAmount || 0;
                        const defaultQuantity = item.quantity || 1;
                        const defaultUnitPrice = item.unitPrice || (defaultAmount / defaultQuantity);
                        const defaultPaymentOption = item.paymentOption || 'either';

                        const customValues = getCustomizedItemValue(student, itemId, defaultAmount, defaultQuantity, defaultPaymentOption, defaultUnitPrice);
                        const effectiveAmount = customValues.amount;
                        const effectivePaymentOption = customValues.paymentOption;
                        const effectiveQuantity = customValues.quantity;
                        const effectiveUnitPrice = customValues.unitPrice;

                        if (effectivePaymentOption !== 'cash_only') continue;

                        cashOnlyExpected += effectiveAmount;

                        // Get paid amount for this item using deduplicated function.
                        // Use the same period-scoping the display cell uses: termly items
                        // check current-term payments only; one_time/yearly check across
                        // all of the student's payments so a payment made in an earlier
                        // period still counts as "paid" here.
                        const scopedPayments = (periodType === 'termly')
                            ? studentPayments
                            : allPayments.filter(p => p && p.studentId === student.id);

                        const paidInfo = getPaidAmountsWithOrLogic(
                            student.id, component.name, item.name, periodType,
                            effectiveQuantity, effectiveAmount, effectiveUnitPrice, effectivePaymentOption,
                            scopedPayments
                        );
                        cashOnlyPaid += paidInfo.cashPaid;
                    }
                }
            }

            const cashOnlyBalance = cashOnlyExpected - cashOnlyPaid;

            // ========== OVERALL STATUS (based on cash‑only) ==========
            let overallStatusText, overallStatusColor, overallStatusIcon;
            if (cashOnlyBalance < -10) {
                overallStatusText = 'Credit Balance';
                overallStatusColor = 'bg-sky-50 text-sky-700 border border-sky-200';
                overallStatusIcon = '💰';
            } else if (Math.abs(cashOnlyBalance) <= 10 && cashOnlyPaid > 0) {
                overallStatusText = 'Fully Paid';
                overallStatusColor = 'bg-emerald-50 text-emerald-700 border border-emerald-200';
                overallStatusIcon = '✅';
            } else if (cashOnlyPaid === 0 && cashOnlyExpected > 0) {
                overallStatusText = 'No Payment';
                overallStatusColor = 'bg-slate-100 text-slate-600 border border-slate-200';
                overallStatusIcon = '📋';
            } else if (cashOnlyBalance > 0 && cashOnlyPaid > 0) {
                overallStatusText = 'Payment Due';
                overallStatusColor = 'bg-amber-50 text-amber-700 border border-amber-200';
                overallStatusIcon = '⚠️';
            } else if (cashOnlyBalance > 0 && cashOnlyPaid === 0) {
                overallStatusText = 'No Payment';
                overallStatusColor = 'bg-slate-100 text-slate-600 border border-slate-200';
                overallStatusIcon = '📋';
            } else {
                overallStatusText = 'Payment Due';
                overallStatusColor = 'bg-amber-50 text-amber-700 border border-amber-200';
                overallStatusIcon = '⚠️';
            }

            enhancedStudents.push({
                id: student.id, firstName: student.firstName || '', lastName: student.lastName || '',
                admissionNumber: student.admissionNumber || '', gender: student.gender || 'N/A',
                currentClass: currentClass, classLevel: classLevel,
                parentName: student.parentInfo?.name || 'N/A', parentPhone: student.parentInfo?.phone || 'N/A',
                parentEmail: student.parentInfo?.email || 'N/A', address: student.address || 'N/A',
                status: student.status || 'Active', enrollmentDate: student.enrolledAt || student.createdAt || new Date().toISOString(),
                feeStructureName: feeStructure ? (feeStructure.name || 'Not Assigned') : 'Not Assigned',
                feeStructureId: feeStructure ? feeStructure.id : null,
                bursaryName: bursaryName || null, discountDisplay: discountDisplay || '',
                statusGroupTotals: statusGroupTotals, tuitionExpected: expectedTuition, tuitionPaid: tuitionPaid,
                tuitionBalance: tuitionBalance, tuitionStatusText: tuitionStatusText, tuitionStatusColor: tuitionStatusColor,
                tuitionStatusIcon: tuitionStatusIcon, totalExpected: totalExpected, totalPaid: totalPaid,
                totalBalance: totalBalance, totalRemainingItems: totalRemainingItems,
                currentPeriodItemsRemaining: currentPeriodItemsRemaining,
                totalCustomItems: totalCustomItems,
                // ========== NEW CASH‑ONLY FIELDS ==========
                cashOnlyExpected: cashOnlyExpected,
                cashOnlyPaid: cashOnlyPaid,
                cashOnlyBalance: cashOnlyBalance,
                overallStatus: overallStatusText, overallStatusColor: overallStatusColor, overallStatusIcon: overallStatusIcon,
                paymentCount: studentPayments.length, hasFeeStructure: !!feeStructure,
                customTransportation: student.customTransportation || null, customItemOverrides: student.customItemOverrides || {},
                hasCustomizations: hasCustomizations, removedItems: student.removedItems || {},
                removedItemsCount: student.removedItems ? Object.keys(student.removedItems).length : 0,
                currentPeriod: `${termName} ${currentYear}`, currentTerm: currentTerm, currentYear: currentYear, isFirstTerm: isFirstTerm
            });
        }

        window.allStudentsData = enhancedStudents;
        window.allClassesData = classes;
        window.sortedStatusGroups = sortedStatusGroups;

        console.log(`📊 Processed ${enhancedStudents.length} students for ${termName} ${currentYear}`);

        const totalCollectionRate = totalTuitionExpected > 0 ? (totalTuitionCollected / totalTuitionExpected * 100) : 0;
        const totalOutstanding = totalTuitionExpected - totalTuitionCollected;

        // ====================================================================
        // RENDER FUNCTIONS (unchanged)
        // ====================================================================

        function renderTuitionCell(student) {
            const tuitionPaid = student.tuitionPaid || 0;
            const tuitionExpected = student.tuitionExpected || 0;

            let statusDisplay = '';
            if (tuitionPaid >= tuitionExpected && tuitionExpected > 0) {
                statusDisplay = `<span class="db-badge bg-emerald-50 text-emerald-700">Paid</span>`;
            } else if (tuitionPaid > 0) {
                statusDisplay = `<span class="db-badge bg-amber-50 text-amber-700">Partial</span>`;
            } else if (tuitionExpected > 0) {
                statusDisplay = `<span class="db-badge bg-rose-50 text-rose-600">Unpaid</span>`;
            }

            const hasBursary = student.bursaryName || student.discountDisplay;
            const bursaryBadge = hasBursary ?
                `<div class="text-[10px] text-emerald-500 mt-1"><i class="fas fa-award mr-0.5"></i>${student.bursaryName} (${student.discountDisplay})</div>` : '';

            const customBadge = student.hasCustomizations ?
                `<div class="text-[10px] text-amber-500 mt-1"><i class="fas fa-bolt mr-0.5"></i>${student.totalCustomItems} custom</div>` : '';

            return `
                <td class="p-2 text-center border-r border-slate-100 text-xs bg-indigo-50/30">
                    <div class="cursor-pointer hover:bg-indigo-100/50 rounded-lg p-1.5 transition"
                         onclick="showTuitionDetailsModal('${student.id}')">
                        <div class="font-bold font-mono-num ${tuitionPaid > 0 ? 'text-emerald-600' : 'text-slate-300'}">
                            UGX ${formatMoney(tuitionPaid)}
                        </div>
                        <div class="text-[10px] text-slate-400 font-mono-num">/ ${formatMoney(tuitionExpected)}</div>
                        <div class="mt-1">${statusDisplay}</div>
                        ${bursaryBadge}
                        ${customBadge}
                        <i class="fas fa-circle-info text-indigo-400 text-[10px] ml-1 mt-1"></i>
                    </div>
                </td>
            `;
        }

  function renderStatusGroupCell(student, sg) {
    const sgData = student.statusGroupTotals?.[sg.name] || {
        expected: 0, paid: 0, balance: 0, moneyRemaining: 0, itemsRemaining: 0, items: [],
        hasStructure: false, periodTypes: new Set(), isTransportation: false,
        customAmountApplied: false, customTransportAmount: null, customItemsCount: 0, existsInFeeStructure: false
    };

    if (!student.hasFeeStructure) {
        return `<td class="p-2 text-center border-r border-slate-100 text-xs text-slate-300">
            <span class="italic">No Fee Structure</span>
        </td>`;
    }

    // Check if this status group exists in the student's fee structure
    const feeStructure = feeStructures.find(f => f && f.id === student.feeStructureId);
    let groupExistsInFeeStructure = false;
    if (feeStructure && feeStructure.activityComponents) {
        for (const comp of feeStructure.activityComponents) {
            const compGroupName = comp.statusGroupName || comp.name || 'Other';
            if (compGroupName === sg.name) {
                groupExistsInFeeStructure = true;
                break;
            }
        }
    }

    if (!groupExistsInFeeStructure) {
        const displayName = sg.name === 'schoolastic requirement' ? 'Scholastic' :
            sg.name === 'Admission Fee' ? 'Admission' : sg.name;
        return `<td class="p-2 text-center border-r border-slate-100 text-xs text-slate-300">
            <span class="italic">Does not pay ${escapeHtml(displayName)}</span>
        </td>`;
    }

    // Handle transportation disabled
    if (sgData.isTransportation && student.customTransportation) {
        if (student.customTransportation.hasTransportation === false) {
            return `<td class="p-2 text-center border-r border-slate-100 text-xs text-slate-300">
                <span class="italic">Transport disabled</span>
            </td>`;
        }
    }

    // ========== RECALCULATE GROUP TOTALS DIRECTLY FROM FEE STRUCTURE ==========
    // This ensures MDD (and any other item) appears even if the main loop missed it.
    let directExpected = 0;
    let directPaid = 0;
    let directItemsRemaining = 0;
    let directItemsRequired = 0;
    let directItemsBrought = 0;
    let hasDirectAmount = false;

    const currentYear = student.currentYear || new Date().getFullYear();
    const currentTerm = student.currentTerm || 1;
    const isOldestPeriod = true; // If only one period, it's the oldest.
    const isLatestTermForCurrentYear = true; // Only one term.

    if (feeStructure && feeStructure.activityComponents) {
        for (const comp of feeStructure.activityComponents) {
            const compGroupName = comp.statusGroupName || comp.name || 'Other';
            if (compGroupName !== sg.name) continue;

            const periodType = comp.periodType || 'termly';
            let shouldInclude = false;
            if (periodType === 'termly') shouldInclude = true;
            else if (periodType === 'one_time') shouldInclude = isOldestPeriod;
            else if (periodType === 'yearly') shouldInclude = isLatestTermForCurrentYear;
            if (!shouldInclude) continue;

            for (const item of (comp.items || [])) {
                const itemId = item.id || item.name;
                if (isItemRemoved(student, itemId)) continue;

                const defaultAmount = item.totalAmount || 0;
                const defaultQuantity = item.quantity || 1;
                const defaultUnitPrice = item.unitPrice || (defaultAmount / defaultQuantity);
                const defaultPaymentOption = item.paymentOption || 'either';

                const customValues = getCustomizedItemValue(
                    student,
                    itemId,
                    defaultAmount,
                    defaultQuantity,
                    defaultPaymentOption,
                    defaultUnitPrice
                );

                const effectiveAmount = customValues.amount;
                const effectiveQuantity = customValues.quantity;
                const effectiveUnitPrice = customValues.unitPrice;
                const effectivePaymentOption = customValues.paymentOption;

                directExpected += effectiveAmount;
                hasDirectAmount = true;

                if (effectivePaymentOption !== 'cash_only') {
                    directItemsRequired += effectiveQuantity;
                }
            }
        }
    }

    const effectiveExpected = sgData.expected || directExpected;
    const effectivePaid = sgData.paid || directPaid;
    const effectiveItemsRemaining = sgData.itemsRemaining || directItemsRemaining;
    const effectiveBalance = effectiveExpected - effectivePaid;
    const effectiveMoneyRemaining = sgData.moneyRemaining || (effectiveExpected - effectivePaid);

    // If still no amount, show dash
    if (effectiveExpected === 0 && effectivePaid === 0 && effectiveItemsRemaining === 0) {
        // ✅ FIX: Double-check for a custom amount, but SKIP any item that has
        // been removed for this student — a removed item must never surface
        // here, custom or not, since it is not being charged at all.
        let customTotal = 0;
        if (student.customItemOverrides) {
            for (const [itemId, custom] of Object.entries(student.customItemOverrides)) {
                if (custom.isActive === false) continue;

                // ✅ Skip removed items entirely — a removal always wins over
                // any lingering customization data for that same item.
                if (isItemRemoved(student, itemId)) continue;

                // Check if this custom belongs to this group
                let belongs = false;
                if (feeStructure && feeStructure.activityComponents) {
                    for (const comp of feeStructure.activityComponents) {
                        const compGroupName = comp.statusGroupName || comp.name || 'Other';
                        if (compGroupName !== sg.name) continue;
                        for (const item of (comp.items || [])) {
                            const id = item.id || item.name;
                            if (id === itemId || item.name === custom.itemName) {
                                belongs = true;
                                break;
                            }
                        }
                        if (belongs) break;
                    }
                }
                if (belongs) {
                    const amount = custom.customAmount !== undefined && custom.customAmount !== null
                        ? custom.customAmount
                        : custom.defaultAmount || 0;
                    customTotal += amount;
                }
            }
        }
        if (customTotal > 0) {
            return `<td class="p-2 text-center border-r border-slate-100 text-xs">
                <div class="font-semibold text-orange-600">UGX ${formatMoney(customTotal)}</div>
                <div class="text-[10px] text-slate-400">Custom amount</div>
            </td>`;
        }
        return `<td class="p-2 text-center border-r border-slate-100 text-xs text-slate-300">
            <span>—</span>
        </td>`;
    }

    // ========== EXISTING DISPLAY LOGIC (with effective values) ==========
    let hasItemOnlyPaid = false, hasCashOnlyPaid = false, hasBothPaid = false;
    let totalItemsBrought = 0, totalItemsRequired = 0;

    for (const item of (sgData.items || [])) {
        if (item.isFullyPaid) {
            if (item.paymentOption === 'item_only' || (item.paymentOption === 'either' && item.itemsBrought >= item.quantityRequired && item.cashPaid === 0)) hasItemOnlyPaid = true;
            else if (item.paymentOption === 'cash_only' || (item.paymentOption === 'either' && item.cashPaid >= item.totalAmount)) hasCashOnlyPaid = true;
            else if (item.paymentOption === 'either' && item.cashPaid > 0 && item.itemsBrought > 0) hasBothPaid = true;
        }
        totalItemsBrought += item.itemsBrought || 0;
        totalItemsRequired += item.quantityRequired || 0;
    }

    const customItemsCount = sgData.customItemsCount || 0;
    const hasCustomItems = customItemsCount > 0;
    const customBadge = hasCustomItems ? `<span class="db-badge bg-amber-50 text-amber-600 ml-1">⚡${customItemsCount}</span>` : '';

    const periodIcons = [];
    const periodTypes = sgData.periodTypes || new Set();
    if (periodTypes.has('one_time')) periodIcons.push('⭐');
    if (periodTypes.has('termly')) periodIcons.push('📅');
    if (periodTypes.has('yearly')) periodIcons.push('📆');
    const periodBadge = periodIcons.length > 0 ? `<span class="text-[10px] text-slate-300 block">${periodIcons.join(' ')}</span>` : '';

    let orBadge = '';
    if (hasItemOnlyPaid && hasCashOnlyPaid) orBadge = `<span class="text-[10px] text-purple-500 block font-medium">Both (Cash + Items)</span>`;
    else if (hasItemOnlyPaid) orBadge = `<span class="text-[10px] text-indigo-500 block font-medium">Items Only</span>`;
    else if (hasCashOnlyPaid) orBadge = `<span class="text-[10px] text-emerald-500 block font-medium">Cash Only</span>`;

    let displayHtml = '';
    if (effectiveBalance <= 0 && effectivePaid >= 0 && effectiveItemsRemaining === 0) {
        displayHtml = `<span class="text-emerald-600 font-bold text-xs"><i class="fas fa-circle-check mr-1"></i>Fully Paid</span>`;
        if (hasItemOnlyPaid && !hasCashOnlyPaid) displayHtml += `<div class="text-[10px] text-indigo-500">Items only</div>`;
        else if (hasCashOnlyPaid && !hasItemOnlyPaid) displayHtml += `<div class="text-[10px] text-emerald-500">Cash only</div>`;
        else if (hasBothPaid) displayHtml += `<div class="text-[10px] text-purple-500">Cash + Items</div>`;
    } else if (effectiveBalance < 0) {
        displayHtml = `<span class="text-sky-600 font-bold font-mono-num">Credit ${formatMoney(Math.abs(effectiveBalance))}</span>`;
    } else if (effectiveMoneyRemaining > 0 && effectiveItemsRemaining > 0) {
        displayHtml = `
            <div class="text-rose-600 font-bold font-mono-num">UGX ${formatMoney(effectiveMoneyRemaining)}</div>
            <div class="text-orange-600 text-[10px] font-medium">${effectiveItemsRemaining} item(s) remaining</div>
            <div class="text-[10px] text-slate-300">Cash OR Items</div>
            ${customBadge}${periodBadge}${orBadge}`;
    } else if (effectiveMoneyRemaining > 0) {
        displayHtml = `<div class="text-rose-600 font-bold font-mono-num">UGX ${formatMoney(effectiveMoneyRemaining)}</div>${customBadge}${periodBadge}${orBadge}`;
    } else if (effectiveItemsRemaining > 0) {
        displayHtml = `<div class="text-orange-600 text-[10px] font-medium">${effectiveItemsRemaining} item(s) remaining</div>${customBadge}${periodBadge}${orBadge}`;
    } else if (effectivePaid > 0) {
        displayHtml = `<span class="text-emerald-600 font-mono-num font-semibold">UGX ${formatMoney(effectivePaid)}</span>${orBadge}${customBadge}${periodBadge}`;
    } else {
        displayHtml = `<span class="text-rose-600 font-mono-num font-semibold">UGX ${formatMoney(effectiveExpected)}</span>${orBadge}${customBadge}${periodBadge}`;
    }

    let itemsSummary = '';
    if (totalItemsRequired > 0 || directItemsRequired > 0) {
        const req = totalItemsRequired || directItemsRequired;
        const brought = totalItemsBrought || directItemsBrought;
        itemsSummary = `<div class="text-[10px] text-slate-400 mt-1"><i class="fas fa-box-open mr-0.5"></i>${brought}/${req} items</div>`;
    }

    const infoIcon = effectiveExpected > 0 || effectiveItemsRemaining > 0 ?
        `<i class="fas fa-circle-info text-indigo-400 ml-1 cursor-pointer hover:text-indigo-600"
            onclick="event.stopPropagation(); showStatusGroupItemDetailsModal('${student.id}', '${escapeHtml(sg.name)}')"></i>` : '';

    return `
        <td class="p-2 text-center border-r border-slate-100 text-xs">
            <div class="cursor-pointer hover:bg-slate-50 rounded-lg p-1.5 transition"
                 onclick="showStatusGroupItemDetailsModal('${student.id}', '${escapeHtml(sg.name)}')">
                ${displayHtml}
                ${itemsSummary}
                ${infoIcon}
            </div>
        </td>
    `;
}

        // ========== BUILD HEADERS ==========
        let statusGroupHeaders = '';
        for (const sg of sortedStatusGroups) {
            const colorClass = getStatusGroupColor(sg.name);
            let periodIcons = '';
            const periodTypes = sg.periodTypes || new Set();
            if (periodTypes.has('one_time')) periodIcons += '<span class="text-[10px] mr-1" title="One-Time (Current term only)">⭐</span>';
            if (periodTypes.has('termly')) periodIcons += '<span class="text-[10px] mr-1" title="Termly (Every Term)">📅</span>';
            if (periodTypes.has('yearly')) periodIcons += '<span class="text-[10px]" title="Yearly (Resets Each Year)">📆</span>';

            let displayName = sg.name;
            if (displayName === 'schoolastic requirement') displayName = 'Scholastic';
            if (displayName === 'Admission Fee') displayName = 'Admission';

            statusGroupHeaders += `
                <th class="p-2.5 text-center min-w-32 ${colorClass} border-r border-slate-100">
                    <div class="flex flex-col items-center gap-1">
                        <div class="flex items-center gap-1">
                            <span class="font-display font-bold text-[11px]">${escapeHtml(displayName)}</span>
                            <span class="text-[9px] text-slate-400 font-normal">(OR)</span>
                        </div>
                        <div class="flex gap-1">${periodIcons}</div>
                    </div>
                </th>
            `;
        }

        // ====================================================================
        // BUILD PAGE HTML
        // ====================================================================
        const html = `
            <div class="db-app-bg -m-4 p-4 space-y-6 pb-8 rounded-2xl">

                <!-- ================= HERO ================= -->
                <div class="db-hero db-fade-in">
                    <div class="db-hero-edge"></div>
                    <div class="relative z-10 flex justify-between items-start flex-wrap gap-5">
                        <div>
                            <p class="db-eyebrow" style="color:rgba(255,255,255,.72)">${termName} &middot; ${currentYear}</p>
                            <h1 class="font-display text-3xl font-bold tracking-tight mt-0.5"><i class="fas fa-users mr-2 opacity-80"></i>All Students</h1>
                            <p class="text-sm text-white/80 mt-1">Complete student &amp; fee management</p>
                            <div class="flex flex-wrap gap-2 mt-3">
                                <span class="db-chip px-3 py-1.5 rounded-lg text-xs font-semibold">${isFirstTerm ? 'One-Time &amp; Yearly fees active' : 'Only Termly fees charged'}</span>
                                <span class="db-chip px-3 py-1.5 rounded-lg text-xs font-semibold">${totalTuitionCollected > 0 ? `UGX ${formatMoney(totalTuitionCollected)} collected` : 'No payments yet'}</span>
                                <span class="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-400/25 border border-amber-300/40">🔄 OR Logic: Cash OR Items</span>
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <button onclick="showAcademicSettingsModal()" class="db-chip px-4 py-2.5 rounded-xl text-sm font-semibold transition flex items-center gap-2"><i class="fas fa-calendar-days"></i> Period</button>
                            <button onclick="showStudentRegistration()" class="bg-white text-teal-700 hover:bg-slate-50 px-4 py-2.5 rounded-xl text-sm font-bold transition flex items-center gap-2 shadow-md"><i class="fas fa-user-plus"></i> Register Student</button>
                        </div>
                    </div>
                </div>

                <!-- ================= STAT CARDS ================= -->
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                    <div class="db-metric">
                        <span class="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 opacity-80"></span>
                        <div class="flex justify-between items-start">
                            <div>
                                <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Total Students</p>
                                <p class="db-metric-value text-2xl font-bold text-slate-800 mt-1">${totalStudents}</p>
                                <div class="flex gap-2 mt-1.5">
                                    <span class="text-[11px] text-indigo-600 font-medium">♂ ${maleCount}</span>
                                    <span class="text-[11px] text-rose-500 font-medium">♀ ${femaleCount}</span>
                                </div>
                            </div>
                            <div class="db-metric-icon bg-indigo-50 text-indigo-600"><i class="fas fa-users"></i></div>
                        </div>
                        <div class="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
                            <span class="text-emerald-600 font-semibold">Active: ${activeCount}</span>
                            <span class="text-slate-400">No Structure: ${noFeeStructureCount}</span>
                            <span class="text-amber-500 font-semibold">Custom: ${studentsWithCustomizations}</span>
                        </div>
                    </div>

                    <div class="db-metric">
                        <span class="absolute left-0 top-0 bottom-0 w-1 bg-teal-500 opacity-80"></span>
                        <div class="flex justify-between items-start">
                            <div>
                                <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">By Level</p>
                                <p class="text-sm font-bold text-slate-700 mt-1.5 font-mono-num">Nursery &middot; ${nurseryCount}</p>
                                <p class="text-sm text-slate-600 font-mono-num">Lower &middot; ${lowerPrimaryCount}</p>
                                <p class="text-sm text-slate-600 font-mono-num">Upper &middot; ${upperPrimaryCount}</p>
                            </div>
                            <div class="db-metric-icon bg-teal-50 text-teal-600"><i class="fas fa-chart-pie"></i></div>
                        </div>
                    </div>

                    <div class="db-metric">
                        <span class="absolute left-0 top-0 bottom-0 w-1 bg-amber-500 opacity-80"></span>
                        <div class="flex justify-between items-start">
                            <div>
                                <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Tuition Summary</p>
                                <p class="text-xl font-bold text-emerald-600 mt-1 font-mono-num">UGX ${(totalTuitionCollected / 1000000).toFixed(1)}M</p>
                                <p class="text-xs text-slate-400 font-mono-num">of UGX ${(totalTuitionExpected / 1000000).toFixed(1)}M</p>
                                <p class="text-[11px] font-semibold text-slate-500 mt-0.5">Rate: ${totalCollectionRate.toFixed(1)}%</p>
                                <p class="text-[11px] text-rose-500 font-medium">Outstanding: UGX ${formatMoney(totalOutstanding)}</p>
                            </div>
                            <div class="db-metric-icon bg-amber-50 text-amber-600"><i class="fas fa-chart-line"></i></div>
                        </div>
                        <div class="db-progress-track h-1.5 mt-2.5"><div class="db-progress-fill bg-emerald-500 h-1.5" style="width:${totalCollectionRate}%"></div></div>
                    </div>

                    <div class="db-metric">
                        <span class="absolute left-0 top-0 bottom-0 w-1 bg-rose-500 opacity-80"></span>
                        <div class="flex justify-between items-start">
                            <div>
                                <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Tuition Status</p>
                                <p class="text-[11px] text-emerald-600 font-semibold mt-1.5">✅ Fully Paid: ${fullyPaidCount}</p>
                                <p class="text-[11px] text-amber-600 font-semibold">⚠️ Due: ${paymentDueCount}</p>
                                <p class="text-[11px] text-rose-600 font-semibold">🔴 Critical: ${criticalCount}</p>
                                <p class="text-[11px] text-sky-600 font-semibold">💰 Credit: ${creditCount}</p>
                                <p class="text-[11px] text-slate-500 font-semibold">📋 No Payment: ${noPaymentCount}</p>
                            </div>
                            <div class="db-metric-icon bg-rose-50 text-rose-600"><i class="fas fa-chart-bar"></i></div>
                        </div>
                    </div>

                    <div class="db-metric">
                        <span class="absolute left-0 top-0 bottom-0 w-1 bg-purple-500 opacity-80"></span>
                        <div class="flex justify-between items-start">
                            <div>
                                <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Items Outstanding</p>
                                <p class="text-2xl font-bold text-orange-600 mt-1 font-mono-num">${totalCurrentItemsOutstanding}</p>
                                <p class="text-[11px] text-slate-400">total items remaining (current period)</p>
                                <p class="text-[11px] text-amber-500 font-medium mt-1">⚡ ${studentsWithCustomizations} customized</p>
                                <p class="text-[11px] text-indigo-500 font-medium">Cash OR Items</p>
                            </div>
                            <div class="db-metric-icon bg-purple-50 text-purple-600"><i class="fas fa-box"></i></div>
                        </div>
                    </div>
                </div>

                <!-- ================= SEARCH & FILTERS ================= -->
                <div class="db-card p-4">
                    <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
                        <div class="relative">
                            <i class="fas fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                            <input type="text" id="studentSearchInput" placeholder="Search by name, admission... (typo-tolerant)" class="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 outline-none">
                        </div>
                        <select id="classFilterInput" class="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-white focus:ring-2 focus:ring-teal-500/40 outline-none">
                            <option value="">All Classes</option>
                            ${classes.map(c => `<option value="${c.name}">${c.name}</option>`).join('')}
                        </select>
                        <select id="levelFilterInput" class="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-white focus:ring-2 focus:ring-teal-500/40 outline-none">
                            <option value="">All Levels</option>
                            <option value="Nursery">Nursery</option>
                            <option value="LowerPrimary">Lower Primary</option>
                            <option value="UpperPrimary">Upper Primary</option>
                        </select>
                        <select id="statusFilterInput" class="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-white focus:ring-2 focus:ring-teal-500/40 outline-none">
                            <option value="">All Status</option>
                            <option value="Fully Paid">Fully Paid</option>
                            <option value="Payment Due">Payment Due</option>
                            <option value="Critical Overdue">Critical Overdue</option>
                            <option value="Credit Balance">Credit Balance</option>
                            <option value="No Payment">No Payment</option>
                            <option value="No Fee Structure">No Fee Structure</option>
                        </select>
                        <button onclick="refreshStudentList()" class="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition"><i class="fas fa-arrows-rotate mr-1.5"></i>Refresh</button>
                    </div>
                    <div class="mt-3.5 flex justify-between items-center text-xs text-slate-500 flex-wrap gap-2">
                        <div>Showing <span id="filteredCount" class="font-bold text-slate-700 font-mono-num">${totalStudents}</span> of ${totalStudents} students</div>
                        <div class="flex gap-4">
                            <button onclick="exportStudentListData()" class="text-emerald-600 hover:text-emerald-800 font-semibold"><i class="fas fa-download mr-1"></i>Export CSV</button>
                            <button onclick="printStudentListReport()" class="text-indigo-600 hover:text-indigo-800 font-semibold"><i class="fas fa-print mr-1"></i>Print Report</button>
                        </div>
                    </div>
                </div>

                <!-- ================= STUDENTS TABLE ================= -->
                <div class="db-card overflow-hidden">
                    <div class="overflow-x-auto db-scroll" style="max-height: 70vh; overflow-y: auto;">
                        <table class="w-full text-sm">
                            <thead class="db-table">
                                <tr>
                                    <th class="p-2.5 w-8">#</th>
                                    <th class="p-2.5 text-left">Admission</th>
                                    <th class="p-2.5 text-left">Student Name</th>
                                    <th class="p-2.5 text-left">Class</th>
                                    <th class="p-2.5 text-left">Parent</th>
                                    <th class="p-2.5 text-center min-w-32 bg-indigo-50/60 border-r border-slate-100">Tuition</th>
                                    ${statusGroupHeaders}
                                    <th class="p-2.5 text-right">Total Paid</th>
                                    <th class="p-2.5 text-right">Balance</th>
                                    <th class="p-2.5 text-left">Status</th>
                                    <th class="p-2.5 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="studentsTableBody" class="divide-y divide-slate-100">
                                ${enhancedStudents.map((student, index) => {
                                    let statusGroupCells = '';
                                    for (const sg of sortedStatusGroups) statusGroupCells += renderStatusGroupCell(student, sg);

                                    // ========== CASH‑ONLY VALUES ==========
                                    const cashPaid = student.cashOnlyPaid || 0;
                                    const cashBalance = student.cashOnlyBalance || 0;
                                    const cashPaidDisplay = cashPaid > 0 ? formatMoney(cashPaid) : '0';
                                    let balanceDisplay = '', balanceClass = '';
                                    if (cashBalance < 0) { balanceDisplay = `Credit: ${formatMoney(Math.abs(cashBalance))}`; balanceClass = 'text-sky-600'; }
                                    else if (cashBalance > 0) { balanceDisplay = formatMoney(cashBalance); balanceClass = 'text-rose-600 font-bold'; }
                                    else { balanceDisplay = '0'; balanceClass = 'text-emerald-600'; }

                                    const initials = `${(student.firstName || '').charAt(0)}${(student.lastName || '').charAt(0)}`.toUpperCase();
                                    const avatarColors = ['bg-gradient-to-br from-rose-400 to-rose-600', 'bg-gradient-to-br from-indigo-400 to-indigo-600', 'bg-gradient-to-br from-emerald-400 to-emerald-600', 'bg-gradient-to-br from-purple-400 to-purple-600', 'bg-gradient-to-br from-amber-400 to-amber-600', 'bg-gradient-to-br from-teal-400 to-teal-600'];
                                    const avatarColor = avatarColors[index % avatarColors.length];

                                    const bursaryBadge = student.bursaryName ? `<div class="text-[10px] text-emerald-500 mt-1"><i class="fas fa-award mr-0.5"></i>${student.bursaryName} (${student.discountDisplay})</div>` : '';
                                    const noStructureBadge = !student.hasFeeStructure ? `<div class="text-[10px] text-rose-500 mt-1"><i class="fas fa-triangle-exclamation mr-0.5"></i>No Fee Structure</div>` : '';
                                    const customBadge = student.hasCustomizations ? `<div class="text-[10px] text-amber-500 mt-1"><i class="fas fa-bolt mr-0.5"></i>${student.totalCustomItems} custom items</div>` : '';
                                    const removedBadge = student.removedItemsCount > 0 ? `<div class="text-[10px] text-rose-400 mt-1"><i class="fas fa-xmark mr-0.5"></i>${student.removedItemsCount} removed</div>` : '';

                                    return `
                                        <tr class="student-row hover:bg-slate-50/80 transition-colors"
                                            data-student-id="${student.id}"
                                            data-student-name="${(student.firstName + ' ' + student.lastName).toLowerCase()}"
                                            data-admission="${student.admissionNumber.toLowerCase()}"
                                            data-class="${student.currentClass}"
                                            data-level="${student.classLevel}"
                                            data-status="${student.overallStatus}"
                                            data-has-fee-structure="${student.hasFeeStructure}"
                                            data-has-customizations="${student.hasCustomizations}">
                                            <td class="p-2 text-center text-slate-300 text-xs font-mono-num">${index + 1}</td>
                                            <td class="p-2 font-mono-num text-xs font-semibold text-slate-500">${student.admissionNumber}</td>
                                            <td class="p-2">
                                                <div class="flex items-center gap-2.5">
                                                    <div class="w-8 h-8 ${avatarColor} rounded-xl flex items-center justify-center text-white text-xs font-bold shadow-sm flex-shrink-0">${initials || 'S'}</div>
                                                    <div class="min-w-0">
                                                        <p class="font-semibold text-slate-700 truncate">${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</p>
                                                        <p class="text-[10px] text-slate-400">${student.gender} &middot; ${student.enrollmentDate ? new Date(student.enrollmentDate).toLocaleDateString() : 'N/A'}</p>
                                                        ${customBadge}${removedBadge}
                                                    </div>
                                                </div>
                                            </td>
                                            <td class="p-2"><span class="db-badge bg-purple-50 text-purple-700">${student.currentClass}</span></td>
                                            <td class="p-2">
                                                <p class="text-sm text-slate-600 truncate max-w-[140px]">${escapeHtml(student.parentName)}</p>
                                                <p class="text-[10px] text-slate-400"><i class="fas fa-phone text-[9px] mr-0.5"></i>${student.parentPhone}</p>
                                                ${bursaryBadge}${noStructureBadge}
                                            </td>
                                            ${renderTuitionCell(student)}
                                            ${statusGroupCells}
                                            <td class="p-2 text-right font-mono-num font-bold ${cashPaid > 0 ? 'text-emerald-600' : 'text-slate-300'}">
                                                ${cashPaid > 0 ? `UGX ${cashPaidDisplay}` : 'UGX 0'}
                                                <div class="text-[10px] text-slate-400 font-sans font-medium">(T + C/o)</div>
                                            </td>
                                            <td class="p-2 text-right font-mono-num font-bold ${balanceClass}">
                                                ${cashBalance < 0 ? `(${balanceDisplay})` : `UGX ${balanceDisplay}`}
                                                <div class="text-[10px] text-slate-400 font-sans font-medium">(T + C/o)</div>
                                            </td>
                                            <td class="p-2"><span class="db-badge ${student.overallStatusColor}">${student.overallStatusIcon} ${student.overallStatus}</span></td>
                                            <td class="p-2 text-center">
                                                <div class="flex justify-center gap-0.5">
                                                    <button onclick="viewStudentDetailsList('${student.id}')" class="text-indigo-500 hover:text-white hover:bg-indigo-500 w-7 h-7 rounded-lg transition flex items-center justify-center" title="View Details"><i class="fas fa-eye text-xs"></i></button>
                                                    <button onclick="makePaymentForStudent('${student.id}')" class="text-emerald-500 hover:text-white hover:bg-emerald-500 w-7 h-7 rounded-lg transition flex items-center justify-center" title="Make Payment"><i class="fas fa-receipt text-xs"></i></button>
                                                    <button onclick="editStudentInfoList('${student.id}')" class="text-amber-500 hover:text-white hover:bg-amber-500 w-7 h-7 rounded-lg transition flex items-center justify-center" title="Edit"><i class="fas fa-pen text-xs"></i></button>
                                                    <button onclick="deleteStudentEntryList('${student.id}')" class="text-rose-500 hover:text-white hover:bg-rose-500 w-7 h-7 rounded-lg transition flex items-center justify-center" title="Delete"><i class="fas fa-trash text-xs"></i></button>
                                                </div>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        mainContent.innerHTML = html;

        // ========== INITIALIZE FILTERS ==========
        const searchInput = document.getElementById('studentSearchInput');
        const classFilter = document.getElementById('classFilterInput');
        const levelFilter = document.getElementById('levelFilterInput');
        const statusFilter = document.getElementById('statusFilterInput');

        const applyFilters = () => {
            const searchTerm = (searchInput?.value || '').toLowerCase().trim();
            const classValue = classFilter?.value || '';
            const levelValue = levelFilter?.value || '';
            const statusValue = statusFilter?.value || '';

            const rows = document.querySelectorAll('#studentsTableBody .student-row');
            let visibleCount = 0;

            rows.forEach(row => {
                const name = row.getAttribute('data-student-name') || '';
                const admission = row.getAttribute('data-admission') || '';
                const studentClass = row.getAttribute('data-class') || '';
                const studentLevel = row.getAttribute('data-level') || '';
                const studentStatus = row.getAttribute('data-status') || '';

                // ========== FUZZY SEARCH MATCH ==========
                // Matches on plain substring first (fast path, always exact),
                // then falls back to typo-tolerant fuzzy matching against the
                // full name and admission number, so a slightly misspelled or
                // incomplete search term still surfaces the intended student.
                const matchSearch = searchTerm === '' ||
                    fuzzyTextMatch(searchTerm, name, 0.62) ||
                    fuzzyTextMatch(searchTerm, admission, 0.7);

                const matchClass = classValue === '' || studentClass === classValue;
                const matchLevel = levelValue === '' || studentLevel === levelValue;
                const matchStatus = statusValue === '' || studentStatus === statusValue;

                const isVisible = matchSearch && matchClass && matchLevel && matchStatus;
                row.style.display = isVisible ? '' : 'none';
                if (isVisible) visibleCount++;
            });

            const countSpan = document.getElementById('filteredCount');
            if (countSpan) countSpan.innerText = visibleCount;
        };

        if (searchInput) searchInput.addEventListener('input', applyFilters);
        if (classFilter) classFilter.addEventListener('change', applyFilters);
        if (levelFilter) levelFilter.addEventListener('change', applyFilters);
        if (statusFilter) statusFilter.addEventListener('change', applyFilters);

        // ========== EXPORT FUNCTIONS ==========
        window.exportStudentListData = function () {
            const studentsData = window.allStudentsData || [];
            if (studentsData.length === 0) { alert('No students to export'); return; }

            const headers = ['Admission', 'First Name', 'Last Name', 'Class', 'Parent Name', 'Parent Phone', 'Status'];
            const statusGroupsList = window.sortedStatusGroups || [];
            for (const sg of statusGroupsList) {
                headers.push(`${sg.name} Expected`);
                headers.push(`${sg.name} Paid (Cash)`);
                headers.push(`${sg.name} Items Brought`);
                headers.push(`${sg.name} Items Remaining`);
                headers.push(`${sg.name} Balance`);
            }
            headers.push('Total Expected', 'Total Paid (Cash)', 'Total Items Brought', 'Total Items Remaining', 'Balance');

            const rows = studentsData.map(s => {
                const row = [s.admissionNumber || '', s.firstName || '', s.lastName || '', s.currentClass || '', s.parentName || '', s.parentPhone || '', s.overallStatus || ''];
                for (const sg of statusGroupsList) {
                    const sgData = s.statusGroupTotals?.[sg.name] || {};
                    row.push(sgData.expected || 0);
                    row.push(sgData.paid || 0);
                    let itemsBrought = 0, itemsRemaining = 0;
                    for (const item of (sgData.items || [])) { itemsBrought += item.itemsBrought || 0; itemsRemaining += item.remainingQuantity || 0; }
                    row.push(itemsBrought);
                    row.push(itemsRemaining);
                    row.push(sgData.balance || 0);
                }
                let totalItemsBrought = 0, totalItemsRemaining = 0;
                for (const sg of statusGroupsList) {
                    const sgData = s.statusGroupTotals?.[sg.name] || {};
                    for (const item of (sgData.items || [])) { totalItemsBrought += item.itemsBrought || 0; totalItemsRemaining += item.remainingQuantity || 0; }
                }
                row.push(s.totalExpected || 0);
                row.push(s.totalPaid || 0);
                row.push(totalItemsBrought);
                row.push(totalItemsRemaining);
                row.push(s.totalBalance || 0);
                return row;
            });

            const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `students_export_${new Date().toISOString().split('T')[0]}.csv`;
            link.click();
            URL.revokeObjectURL(link.href);
            alert(`✅ ${studentsData.length} students exported! (Cash and Items tracked separately)`);
        };

        window.printStudentListReport = function () { window.print(); };
        window.refreshStudentList = function () { showStudentList(); };

        window.makePaymentForStudent = function (studentId) {
            closeModal();
            const feeLink = document.querySelector('.sidebar-item[onclick*="showFeeManagement"]');
            if (feeLink) feeLink.click();
            else if (typeof showFeeManagement === 'function') showFeeManagement();
            setTimeout(() => {
                const studentSelect = document.getElementById('collectStudentSelect');
                if (studentSelect) { studentSelect.value = studentId; studentSelect.dispatchEvent(new Event('change')); }
                const collectTab = document.querySelector('.fee-tab[data-tab="collect"]');
                if (collectTab) collectTab.click();
            }, 500);
        };

        window.showStatusGroupItemDetailsModal = showStatusGroupItemDetailsModal;
        window.showTuitionDetailsModal = showTuitionDetailsModal;
        window.closeModal = closeModal;
        window.makePaymentForStudent = makePaymentForStudent;
        window.escapeHtml = escapeHtml;
        window.formatMoney = formatMoney;

    } catch (error) {
        console.error('Error:', error);
        if (mainContent) {
            mainContent.innerHTML = `
                <div class="db-app-bg -m-4 p-4 min-h-[60vh] flex items-center justify-center rounded-2xl">
                    <div class="db-card p-10 text-center max-w-lg">
                        <div class="w-14 h-14 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center mx-auto mb-4">
                            <i class="fas fa-triangle-exclamation text-xl"></i>
                        </div>
                        <p class="text-slate-800 font-semibold text-lg font-display">Couldn't load students</p>
                        <p class="text-slate-500 text-sm mt-1.5">${error.message}</p>
                        <button onclick="showStudentList()" class="mt-5 bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition"><i class="fas fa-rotate-right mr-2"></i>Retry</button>
                    </div>
                </div>`;
        }
    }
}

window.showStudentList = showStudentList;
// ========== MAKE GLOBAL ==========
window.showStudentList = showStudentList;
window.deduplicateHistories = deduplicateHistories;

console.log('✅ showStudentList - v11.0 WITH OR LOGIC LOADED!');
console.log('   ✅ Cash and Items are tracked separately (never converted)');
console.log('   ✅ OR Logic: Cash OR Items (either method covers the requirement)');
console.log('   ✅ Items brought are NEVER converted to cash');
console.log('   ✅ Removed items are excluded');
console.log('   ✅ Custom overrides are applied');
console.log('   ✅ Shows CURRENT TERM ONLY');
console.log('   ✅ Excel-compatible data with separate cash and item columns');
// ==================== GLOBAL STATUS GROUP ITEM DETAILS MODAL ====================
// Version: 5.0 - Fully working with removedItems support

// ============================================================================
// COMPLETE REBUILT: showStatusGroupItemDetailsModal
// Version: 7.0 - Period-Aware Tracking (Only from enrollment date forward)
// ============================================================================

// ==================== COMPLETE REPLACEMENT FOR showStatusGroupItemDetailsModal ====================
// Version: 11.0 - CORRECTLY SEPARATES CASH PAYMENTS FROM ITEMS BROUGHT
// Items brought are NEVER converted to cash - they are tracked separately

// ============================================================================
// STATUS GROUP ITEM DETAILS MODAL — RESTYLED
// ============================================================================
// All calculation logic (period scoping for one_time / yearly / termly,
// payment matching, remaining-balance math) is UNCHANGED from your version.
// Only the rendered markup/classes were reworked for a cleaner visual
// hierarchy, consistent color tokens, better spacing, and small UX polish
// (backdrop blur, click-outside-to-close, Escape-to-close, subtle motion).
// ============================================================================

// ---------- one-time style injector (mirrors the dashboard's pattern) ----------
function injectStatusModalDesignSystem() {
    if (document.getElementById('statusGroupModalStyles')) return;
    const style = document.createElement('style');
    style.id = 'statusGroupModalStyles';
    style.textContent = `
        @keyframes sgmFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes sgmSlideUp { from { opacity: 0; transform: translateY(14px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .sgm-backdrop { animation: sgmFadeIn .18s ease-out; }
        .sgm-panel { animation: sgmSlideUp .22s cubic-bezier(.16,1,.3,1); }
        .sgm-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .sgm-scroll::-webkit-scrollbar-track { background: transparent; }
        .sgm-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 8px; }
        .sgm-scroll::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        .sgm-period-card { transition: box-shadow .2s ease, border-color .2s ease; }
        .sgm-item-card { transition: box-shadow .2s ease, transform .15s ease; }
        .sgm-item-card:hover { box-shadow: 0 4px 14px -4px rgba(15,23,42,.12); }
        .sgm-chevron { transition: transform .2s ease; }
        @media (prefers-reduced-motion: reduce) {
            .sgm-backdrop, .sgm-panel { animation: none; }
            .sgm-item-card, .sgm-period-card, .sgm-chevron { transition: none; }
        }
    `;
    document.head.appendChild(style);
}

window.showStatusGroupItemDetailsModal = function(studentId, statusGroupName) {
    console.log('=== showStatusGroupItemDetailsModal v14.0 — period‑aware removal ===');
    console.log('Student:', studentId, 'Status Group:', statusGroupName);

    injectStatusModalDesignSystem();

    // ---------- Loading overlay ----------
    const loadingHtml = `
        <div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 sgm-backdrop" id="statusGroupLoadingModal">
            <div class="bg-white rounded-2xl px-10 py-8 flex flex-col items-center shadow-xl shadow-slate-900/10 ring-1 ring-slate-200">
                <div class="w-9 h-9 rounded-full border-[3px] border-slate-200 border-t-indigo-600 animate-spin mb-4"></div>
                <p class="text-slate-500 text-sm font-medium">Loading details…</p>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', loadingHtml);

    // ========== FETCH ALL DATA ==========
    Promise.all([
        fetch(`/api/students/${studentId}`).then(r => r.ok ? r.json() : null),
        fetch('/api/fee/structures').then(r => r.ok ? r.json() : []),
        fetch('/api/fee/payments').then(r => r.ok ? r.json() : []),
        fetch('/api/student-term-records').then(r => r.ok ? r.json() : {}),
        fetch(`/api/students/${studentId}/previous-balances`).then(r => r.ok ? r.json() : null),
        fetch('/api/school/classes').then(r => r.ok ? r.json() : [])
    ])
    .then(([student, feeStructures, allPayments, termRecords, previousBalancesData, classes]) => {
        const loadingModal = document.getElementById('statusGroupLoadingModal');
        if (loadingModal) loadingModal.remove();

        if (!student) {
            alert('Student not found');
            return;
        }

        console.log('✅ Student loaded:', student.firstName, student.lastName);

        // ========== FIND THE FEE STRUCTURE ==========
        let feeStructure = null;
        if (student.assignedFeeStructureId) {
            feeStructure = feeStructures.find(f => f.id === student.assignedFeeStructureId);
        }
        if (!feeStructure && student.feeStructureId) {
            feeStructure = feeStructures.find(f => f.id === student.feeStructureId);
        }
        if (!feeStructure && student.currentClassId) {
            const classObj = classes.find(c => c.id === student.currentClassId);
            if (classObj) {
                const matchingStructures = feeStructures.filter(f => f.level === classObj.level);
                if (matchingStructures.length > 0) {
                    feeStructure = matchingStructures[0];
                }
            }
        }

        if (!feeStructure) {
            alert('Fee structure not found for this student');
            return;
        }

        // ========== GET STUDENT'S ENROLLMENT DATE ==========
        const enrollmentDate = student.enrolledAt || student.createdAt || new Date().toISOString();
        const enrollmentYear = new Date(enrollmentDate).getFullYear();
        const enrollmentMonth = new Date(enrollmentDate).getMonth();

        let enrollmentTerm = 1;
        if (enrollmentMonth >= 4 && enrollmentMonth < 8) enrollmentTerm = 2;
        else if (enrollmentMonth >= 8) enrollmentTerm = 3;

        console.log(`📅 Enrollment: ${enrollmentDate} → Year ${enrollmentYear}, Term ${enrollmentTerm}`);

        // ========== GET REMOVED ITEMS AND CUSTOM OVERRIDES ==========
        const removedItems = student.removedItems || {};
        const customOverrides = student.customItemOverrides || {};

        // ========== PERIOD‑AWARE REMOVAL CHECK ==========
        function isItemRemovedForPeriod(itemId, periodYear, periodTerm) {
            const removed = removedItems[itemId];
            if (!removed || removed.isActive === false) return false;

            // Legacy removals without period stamp → treat as always removed
            if (removed.academicYear === undefined || removed.academicYear === null) {
                return true;
            }

            const removedYear = parseInt(removed.academicYear);
            const removedTerm = parseInt(removed.term) || 1;
            const checkYear = parseInt(periodYear);
            const checkTerm = parseInt(periodTerm);

            // Removed in a later period → this period is BEFORE removal → show item
            if (checkYear < removedYear) return false;
            if (checkYear === removedYear && checkTerm < removedTerm) return false;

            // This period is the removal period or later → hide item
            return true;
        }

        // ========== HELPER FUNCTIONS ==========
        function getCustomizedItemValue(itemId, defaultAmount, defaultQuantity, defaultPaymentOption, defaultUnitPrice) {
            if (customOverrides[itemId] && customOverrides[itemId].isActive !== false) {
                const custom = customOverrides[itemId];
                const customAmount = (custom.customAmount !== null && custom.customAmount !== undefined)
                    ? custom.customAmount
                    : defaultAmount;
                const customQuantity = (custom.customQuantity !== null && custom.customQuantity !== undefined)
                    ? custom.customQuantity
                    : defaultQuantity;
                const customPaymentOption = custom.paymentOption || defaultPaymentOption;

                let customUnitPrice = defaultUnitPrice;
                if (customQuantity > 0 && customAmount > 0) {
                    customUnitPrice = customAmount / customQuantity;
                } else if (customAmount > 0) {
                    customUnitPrice = customAmount / (customQuantity || 1);
                } else if (customQuantity > 0) {
                    customUnitPrice = defaultUnitPrice || (defaultAmount / (defaultQuantity || 1));
                }

                return {
                    amount: customAmount,
                    quantity: customQuantity,
                    paymentOption: customPaymentOption,
                    unitPrice: customUnitPrice,
                    isCustomized: true,
                    reason: custom.reason || null,
                    customAmount: custom.customAmount,
                    customQuantity: custom.customQuantity,
                    defaultAmount: custom.defaultAmount || defaultAmount,
                    defaultQuantity: custom.defaultQuantity || defaultQuantity
                };
            }

            return {
                amount: defaultAmount || 0,
                quantity: defaultQuantity || 1,
                paymentOption: defaultPaymentOption || 'either',
                unitPrice: defaultUnitPrice || (defaultAmount / (defaultQuantity || 1)),
                isCustomized: false,
                reason: null,
                customAmount: null,
                customQuantity: null,
                defaultAmount: defaultAmount || 0,
                defaultQuantity: defaultQuantity || 1
            };
        }

        function deduplicateHistories(histories) {
            if (!histories || histories.length === 0) return [];
            const seen = new Set();
            const unique = [];
            for (let h = 0; h < histories.length; h++) {
                const history = histories[h];
                const key = `${history.date || ''}_${history.type || ''}_${history.amount || 0}_${history.quantity || 0}_${history.receiptNumber || ''}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    unique.push(history);
                }
            }
            return unique;
        }

        function formatMoney(amount) {
            const num = Math.round(amount || 0);
            return num.toLocaleString('en-US');
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function getTermName(term) {
            const names = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
            return names[term] || `Term ${term}`;
        }

        function closeModal() {
            const modal = document.getElementById('statusGroupModal');
            if (modal) modal.remove();
        }

        // ========== GET PAID AMOUNTS FOR ITEM WITH PERIOD SCOPE ==========
        function getPaidAmountsForItem(studentId, componentName, itemName, periodType, year, term) {
            let scopedPayments = [];

            if (periodType === 'one_time') {
                scopedPayments = allPayments.filter(p => p && p.studentId === studentId);
            } else if (periodType === 'yearly') {
                scopedPayments = allPayments.filter(p =>
                    p && p.studentId === studentId &&
                    p.academicYear === year.toString()
                );
            } else {
                scopedPayments = allPayments.filter(p =>
                    p && p.studentId === studentId &&
                    p.term === term &&
                    p.academicYear === year.toString()
                );
            }

            let cashPaid = 0;
            let itemsBrought = 0;
            const paymentHistories = [];
            const processedKeys = new Set();
            const uniquePaymentItems = new Map();

            for (const payment of scopedPayments) {
                if (!payment || !payment.id) continue;

                if (payment.activityItemPayments && Array.isArray(payment.activityItemPayments)) {
                    for (const paidItem of payment.activityItemPayments) {
                        if (!paidItem || !paidItem.componentName || !paidItem.itemName) continue;

                        const compMatch = paidItem.componentName &&
                            paidItem.componentName.toLowerCase() === componentName.toLowerCase();
                        const itemMatch = paidItem.itemName &&
                            paidItem.itemName.toLowerCase() === itemName.toLowerCase();

                        if (compMatch && itemMatch) {
                            const key = `${payment.id}_${paidItem.itemName}_${paidItem.componentName}`;
                            if (!uniquePaymentItems.has(key)) {
                                uniquePaymentItems.set(key, { payment, paidItem });
                            }
                        }
                    }
                }

                if (payment.paymentsByPeriodType) {
                    const periodTypes = ['one_time', 'termly', 'yearly'];
                    for (const pt of periodTypes) {
                        const periodItems = payment.paymentsByPeriodType[pt] || [];
                        for (const paidItem of periodItems) {
                            if (!paidItem || !paidItem.componentName || !paidItem.itemName) continue;

                            const compMatch = paidItem.componentName &&
                                paidItem.componentName.toLowerCase() === componentName.toLowerCase();
                            const itemMatch = paidItem.itemName &&
                                paidItem.itemName.toLowerCase() === itemName.toLowerCase();

                            if (compMatch && itemMatch) {
                                const key = `${payment.id}_${paidItem.itemName}_${paidItem.componentName}`;
                                if (!uniquePaymentItems.has(key)) {
                                    uniquePaymentItems.set(key, { payment, paidItem });
                                }
                            }
                        }
                    }
                }
            }

            for (const [key, data] of uniquePaymentItems) {
                const { payment, paidItem } = data;
                const historyKey = `${payment.receiptNumber || payment.id}_${paidItem.itemName}`;
                if (processedKeys.has(historyKey)) continue;
                processedKeys.add(historyKey);

                if (paidItem.paymentType === 'paid_cash') {
                    const amount = (paidItem.amountPaid || 0);
                    cashPaid += amount;
                    paymentHistories.push({
                        type: 'cash',
                        amount: amount,
                        date: payment.date || new Date().toISOString(),
                        receiptNumber: payment.receiptNumber || 'N/A',
                        academicYear: payment.academicYear,
                        term: payment.term,
                        paymentId: payment.id,
                        isPreviousBalancePayment: payment.isPreviousBalancePayment || false,
                        method: payment.method || 'cash'
                    });
                } else if (paidItem.paymentType === 'brought_item') {
                    const qty = (paidItem.itemsBrought || 0);
                    itemsBrought += qty;
                    paymentHistories.push({
                        type: 'item',
                        quantity: qty,
                        date: payment.date || new Date().toISOString(),
                        receiptNumber: payment.receiptNumber || 'N/A',
                        academicYear: payment.academicYear,
                        term: payment.term,
                        paymentId: payment.id,
                        isPreviousBalancePayment: payment.isPreviousBalancePayment || false,
                        method: payment.method || 'cash'
                    });
                }
            }

            const seen = new Set();
            const uniqueHistories = [];
            for (const h of paymentHistories) {
                const key = `${h.date || ''}_${h.type || ''}_${h.amount || 0}_${h.quantity || 0}_${h.receiptNumber || ''}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueHistories.push(h);
                }
            }

            return { cashPaid, itemsBrought, paymentHistories: uniqueHistories };
        }

        // ========== BUILD STATUS GROUP ITEMS ==========
        // We keep all items, even those that are globally removed.
        // Period-aware filtering happens later.
        function buildStatusGroupItems(component, periodType) {
            const items = [];

            for (const item of (component.items || [])) {
                const itemId = item.id || item.name;

                // Always include, even if globally removed — will be handled per period
                const defaultAmount = item.totalAmount || 0;
                const defaultQuantity = item.quantity || 1;
                const defaultUnitPrice = item.unitPrice || (defaultAmount / defaultQuantity);
                const defaultPaymentOption = item.paymentOption || 'either';

                const custom = getCustomizedItemValue(itemId, defaultAmount, defaultQuantity, defaultPaymentOption, defaultUnitPrice);

                let totalAmount = custom.amount;
                let quantity = custom.quantity;
                let unitPrice = custom.unitPrice;
                let paymentOption = custom.paymentOption;
                const isCustomized = custom.isCustomized;
                const customReason = custom.reason;

                const isTransportation = component.name.toLowerCase().includes('transport') ||
                                        (component.statusGroupName && component.statusGroupName.toLowerCase().includes('transport'));

                if (isTransportation && student.customTransportation) {
                    if (student.customTransportation.hasTransportation === false) {
                        // Treat as removed globally for this student? We'll still keep it, but mark as removed.
                        // We'll handle per period.
                        // We'll keep it and let period handling decide.
                        // But we need to know it's disabled; we can set a flag.
                        // We'll just keep it with totalAmount = 0? Better: we'll keep it and later check.
                        // Since it's disabled, we'll treat it as removed for all periods.
                        // So we'll set a flag isTransportDisabled = true.
                        // We'll store that in the item object.
                        items.push({
                            id: itemId,
                            name: item.name,
                            isRemoved: false, // we'll rely on period check later
                            isTransportDisabled: true,
                            total: 0,
                            quantity: 0,
                            unitPrice: 0,
                            paymentOption: paymentOption,
                            periodType: periodType,
                            isCustomized: false,
                            customReason: null,
                            defaultTotal: defaultAmount,
                            defaultQuantity: defaultQuantity,
                            cashPaid: 0,
                            itemsBrought: 0,
                            remaining: 0,
                            remainingItems: 0,
                            isFullyPaid: false,
                            paymentHistories: [],
                            originalAmount: defaultAmount,
                            originalQuantity: defaultQuantity
                        });
                        continue;
                    } else if (student.customTransportation.amount) {
                        totalAmount = student.customTransportation.amount;
                        unitPrice = totalAmount / (quantity || 1);
                    }
                }

                items.push({
                    id: itemId,
                    name: item.name,
                    isRemoved: false, // we'll handle per period
                    isTransportDisabled: false,
                    total: totalAmount,
                    quantity: quantity,
                    unitPrice: unitPrice,
                    paymentOption: paymentOption,
                    periodType: periodType,
                    isCustomized: isCustomized,
                    customReason: customReason,
                    defaultTotal: defaultAmount,
                    defaultQuantity: defaultQuantity,
                    cashPaid: 0,
                    itemsBrought: 0,
                    remaining: totalAmount,
                    remainingItems: quantity,
                    isFullyPaid: false,
                    paymentHistories: [],
                    originalAmount: defaultAmount,
                    originalQuantity: defaultQuantity
                });
            }

            return items;
        }

        // ========== FIND THE SPECIFIC STATUS GROUP ==========
        let targetComponent = null;
        let targetItems = [];
        let componentName = '';

        for (const component of (feeStructure.activityComponents || [])) {
            const groupName = component.statusGroupName || component.name || 'Other';
            if (groupName === statusGroupName || component.name === statusGroupName) {
                targetComponent = component;
                componentName = component.name;
                const builtItems = buildStatusGroupItems(component, component.periodType || 'termly');
                targetItems = builtItems;
                break;
            }
        }

        if (!targetComponent || targetItems.length === 0) {
            alert(`No items found for ${statusGroupName}`);
            return;
        }

        // ========== GET ALL PERIODS FROM ENROLLMENT DATE ==========
        const allPeriods = [];
        const currentYear = currentAcademicSettings?.currentYear || new Date().getFullYear();
        const currentTerm = currentAcademicSettings?.currentTerm || 1;
        const currentPeriodKey = `${currentYear}_${currentTerm}`;

        if (previousBalancesData && previousBalancesData.previousPeriods) {
            for (const period of previousBalancesData.previousPeriods) {
                if (period.year >= enrollmentYear &&
                    !(period.year === enrollmentYear && period.term < enrollmentTerm)) {
                    allPeriods.push({
                        year: period.year,
                        term: period.term,
                        periodKey: `${period.year}_${period.term}`,
                        data: period,
                        isCurrent: period.periodKey === currentPeriodKey
                    });
                }
            }
        }

        for (const payment of allPayments) {
            if (payment && payment.studentId === student.id && payment.academicYear && payment.term) {
                const year = parseInt(payment.academicYear);
                const term = parseInt(payment.term);
                const key = `${year}_${term}`;
                if (year >= enrollmentYear &&
                    !(year === enrollmentYear && term < enrollmentTerm) &&
                    !allPeriods.some(p => p.year === year && p.term === term)) {
                    allPeriods.push({
                        year: year,
                        term: term,
                        periodKey: key,
                        data: null,
                        isCurrent: key === currentPeriodKey
                    });
                }
            }
        }

        allPeriods.sort((a, b) => {
            if (a.year !== b.year) return a.year - b.year;
            return a.term - b.term;
        });

        for (const period of allPeriods) {
            if (period.periodKey === currentPeriodKey) {
                period.isCurrent = true;
            }
        }

        console.log(`📅 Found ${allPeriods.length} periods from enrollment`);

        // ========== SCOPE DETERMINATION ==========
        const oldestPeriod = allPeriods.length > 0 ? allPeriods[0] : null;
        const oldestPeriodKey = oldestPeriod ? oldestPeriod.periodKey : null;

        const maxTermByYear = {};
        for (const period of allPeriods) {
            if (!maxTermByYear[period.year] || period.term > maxTermByYear[period.year]) {
                maxTermByYear[period.year] = period.term;
            }
        }

        console.log('📅 Oldest period:', oldestPeriodKey);
        console.log('📅 Max term per year:', maxTermByYear);

        // ========== BUILD PERIOD HTML ==========
        function buildPeriodHtml(period, index) {
            const { year, term, periodKey, isCurrent } = period;
            const termName = getTermName(term);
            const collapseId = `period_${periodKey.replace(/[^a-zA-Z0-9]/g, '_')}`;
            const isExpanded = isCurrent || index === 0;

            let periodTotalExpected = 0;
            let periodTotalCashPaid = 0;
            let periodTotalItemsBrought = 0;
            let periodTotalBalance = 0;
            let periodTotalItemsRequired = 0;
            let periodTotalItemsRemaining = 0;
            let periodItems = [];
            let periodPaymentCount = 0;
            const uniquePaymentIds = new Set();

            for (const item of targetItems) {
                // ========== PERIOD‑AWARE REMOVAL CHECK ==========
                const isRemovedForPeriod = isItemRemovedForPeriod(item.id, year, term);
                // Also check if transportation is disabled (global)
                const isTransportDisabled = item.isTransportDisabled || false;

                // If item is removed for this period OR transport disabled, treat as removed for this period
                const isPeriodRemoved = isRemovedForPeriod || isTransportDisabled;

                if (isPeriodRemoved) {
                    periodItems.push({
                        ...item,
                        periodCashPaid: 0,
                        periodItemsBrought: 0,
                        periodRemaining: 0,
                        periodRemainingItems: 0,
                        periodIsFullyPaid: true,
                        periodPaymentHistories: [],
                        periodIsRemoved: true
                    });
                    continue;
                }

                const itemPeriodType = item.periodType || 'termly';
                let shouldInclude = false;

                if (itemPeriodType === 'termly') {
                    shouldInclude = true;
                } else if (itemPeriodType === 'one_time') {
                    shouldInclude = (periodKey === oldestPeriodKey);
                } else if (itemPeriodType === 'yearly') {
                    const latestTermForYear = maxTermByYear[year] || 0;
                    shouldInclude = (term === latestTermForYear);
                }

                if (!shouldInclude) {
                    periodItems.push({
                        ...item,
                        periodCashPaid: 0,
                        periodItemsBrought: 0,
                        periodRemaining: 0,
                        periodRemainingItems: 0,
                        periodIsFullyPaid: true,
                        periodPaymentHistories: [],
                        periodSkipped: true
                    });
                    continue;
                }

                const paidInfo = getPaidAmountsForItem(
                    student.id,
                    componentName,
                    item.name,
                    itemPeriodType,
                    year,
                    term
                );

                const cashPaid = paidInfo.cashPaid;
                const itemsBrought = paidInfo.itemsBrought;
                const uniqueHistories = deduplicateHistories(paidInfo.paymentHistories);

                for (const h of uniqueHistories) {
                    if (h.paymentId) uniquePaymentIds.add(h.paymentId);
                }

                const totalAmount = item.total || 0;
                const quantity = item.quantity || 1;
                const unitPrice = item.unitPrice || 0;
                const paymentOption = item.paymentOption || 'either';

                let remainingAmount = 0;
                let remainingItems = 0;
                let isFullyPaid = false;
                let isPaidByItems = false;
                let isPaidByCash = false;

                if (paymentOption === 'cash_only') {
                    remainingAmount = Math.max(0, totalAmount - cashPaid);
                    isFullyPaid = remainingAmount <= 0;
                    isPaidByCash = isFullyPaid;
                } else if (paymentOption === 'item_only') {
                    remainingItems = Math.max(0, quantity - itemsBrought);
                    isFullyPaid = remainingItems <= 0;
                    isPaidByItems = isFullyPaid;
                } else {
                    const cashCovers = cashPaid >= totalAmount;
                    const itemsCover = itemsBrought >= quantity;
                    isFullyPaid = cashCovers || itemsCover;
                    isPaidByCash = cashCovers;
                    isPaidByItems = itemsCover;

                    if (!isFullyPaid) {
                        const totalPaidValue = cashPaid + (itemsBrought * unitPrice);
                        const totalRequired = quantity * unitPrice;
                        if (totalPaidValue < totalRequired) {
                            remainingAmount = Math.max(0, totalRequired - totalPaidValue);
                            remainingItems = Math.ceil(remainingAmount / unitPrice);
                        }
                    }
                }

                periodTotalExpected += totalAmount;
                periodTotalCashPaid += cashPaid;
                periodTotalItemsBrought += itemsBrought;
                periodTotalBalance += remainingAmount;
                periodTotalItemsRequired += quantity;
                periodTotalItemsRemaining += remainingItems;

                periodItems.push({
                    ...item,
                    periodCashPaid: cashPaid,
                    periodItemsBrought: itemsBrought,
                    periodRemaining: remainingAmount,
                    periodRemainingItems: remainingItems,
                    periodIsFullyPaid: isFullyPaid,
                    periodIsPaidByCash: isPaidByCash,
                    periodIsPaidByItems: isPaidByItems,
                    periodPaymentHistories: uniqueHistories,
                    periodSkipped: false,
                    periodIsRemoved: false
                });
            }

            periodPaymentCount = uniquePaymentIds.size;

            const hasBalance = periodTotalBalance > 0 || periodTotalItemsRemaining > 0;
            const isFullyPaid = !hasBalance && (periodTotalCashPaid > 0 || periodTotalItemsBrought > 0);
            const hasNoItems = periodTotalExpected === 0 && periodTotalItemsRequired === 0;

            // ---------- restyled state tokens ----------
            let headerClass = 'bg-gradient-to-r from-indigo-500 to-indigo-600';
            let borderClass = 'border-indigo-200';
            let dotClass = 'bg-indigo-300';

            if (hasNoItems) {
                headerClass = 'bg-gradient-to-r from-slate-400 to-slate-500';
                borderClass = 'border-slate-200';
                dotClass = 'bg-slate-300';
            } else if (isFullyPaid) {
                headerClass = 'bg-gradient-to-r from-emerald-500 to-emerald-600';
                borderClass = 'border-emerald-200';
                dotClass = 'bg-emerald-300';
            } else if (!isCurrent) {
                headerClass = 'bg-gradient-to-r from-amber-500 to-orange-500';
                borderClass = 'border-amber-200';
                dotClass = 'bg-amber-300';
            }

            let statusBadge = '';
            if (isCurrent) {
                statusBadge = '<span class="text-[11px] font-semibold bg-white/20 text-white px-2.5 py-1 rounded-full">Current</span>';
            } else if (hasNoItems) {
                statusBadge = '<span class="text-[11px] font-semibold bg-white/20 text-white px-2.5 py-1 rounded-full">No data</span>';
            } else if (isFullyPaid) {
                statusBadge = '<span class="text-[11px] font-semibold bg-white/20 text-white px-2.5 py-1 rounded-full">✅ Fully paid</span>';
            } else if (hasBalance) {
                statusBadge = '<span class="text-[11px] font-semibold bg-white/20 text-white px-2.5 py-1 rounded-full">⚠️ Balance due</span>';
            }

            let dueText = '';
            if (hasBalance && !isFullyPaid) {
                const parts = [];
                if (periodTotalBalance > 0) parts.push(`UGX ${formatMoney(periodTotalBalance)}`);
                if (periodTotalItemsRemaining > 0) parts.push(`${periodTotalItemsRemaining} items`);
                dueText = `Due: ${parts.join(' or ')}`;
            } else if (isFullyPaid) {
                dueText = 'Fully paid';
            } else if (hasNoItems) {
                dueText = 'No items';
            }

            const paymentDisplay = periodPaymentCount > 0 ? `${periodPaymentCount} payment${periodPaymentCount === 1 ? '' : 's'}` : '';

            let summaryHtml = '';
            if (!hasNoItems) {
                summaryHtml = `
                    <div class="grid grid-cols-3 gap-3 mb-5">
                        <div class="bg-slate-50 ring-1 ring-slate-200 rounded-xl p-3.5 text-center">
                            <p class="text-[11px] font-medium uppercase tracking-wide text-slate-400">Expected</p>
                            <p class="font-bold text-slate-800 mt-1">UGX ${formatMoney(periodTotalExpected)}</p>
                            ${periodTotalItemsRequired > 0 ? `<p class="text-[11px] text-slate-400 mt-0.5">or ${periodTotalItemsRequired} items</p>` : ''}
                        </div>
                        <div class="bg-emerald-50 ring-1 ring-emerald-100 rounded-xl p-3.5 text-center">
                            <p class="text-[11px] font-medium uppercase tracking-wide text-emerald-500">Paid</p>
                            <p class="font-bold text-emerald-700 mt-1">UGX ${formatMoney(periodTotalCashPaid)}</p>
                            ${periodTotalItemsBrought > 0 ? `<p class="text-[11px] text-emerald-500 mt-0.5">+ ${periodTotalItemsBrought} items brought</p>` : ''}
                        </div>
                        <div class="${periodTotalBalance > 0 || periodTotalItemsRemaining > 0 ? 'bg-rose-50 ring-1 ring-rose-100' : 'bg-emerald-50 ring-1 ring-emerald-100'} rounded-xl p-3.5 text-center">
                            <p class="text-[11px] font-medium uppercase tracking-wide ${periodTotalBalance > 0 || periodTotalItemsRemaining > 0 ? 'text-rose-500' : 'text-emerald-500'}">Balance</p>
                            <p class="font-bold mt-1 ${periodTotalBalance > 0 || periodTotalItemsRemaining > 0 ? 'text-rose-600' : 'text-emerald-700'}">
                                ${periodTotalBalance > 0 ? `UGX ${formatMoney(periodTotalBalance)}` : '✓ Paid'}
                            </p>
                            ${periodTotalItemsRemaining > 0 ? `<p class="text-[11px] text-rose-500 mt-0.5">or ${periodTotalItemsRemaining} items</p>` : ''}
                        </div>
                    </div>
                `;
            }

            return `
                <div class="sgm-period-card border ${borderClass} rounded-2xl overflow-hidden shadow-sm bg-white" id="periodContainer_${periodKey}">
                    <div class="cursor-pointer ${headerClass} text-white px-4 py-3.5 flex justify-between items-center gap-3"
                         onclick="togglePeriodDetails('${collapseId}')">
                        <div class="flex items-center gap-3 min-w-0">
                            <span class="w-2 h-2 rounded-full ${dotClass} shrink-0"></span>
                            <div class="min-w-0">
                                <h4 class="font-bold text-[15px] leading-tight truncate">${termName} ${year}</h4>
                                <p class="text-[12px] text-white/80 mt-0.5">${paymentDisplay || (hasNoItems ? '\u00A0' : dueText)}</p>
                            </div>
                            ${statusBadge}
                        </div>
                        <div class="flex items-center gap-3 shrink-0">
                            <p class="text-[13px] font-semibold hidden sm:block">${hasNoItems ? '' : isFullyPaid ? '' : dueText}</p>
                            <i class="fas fa-chevron-down sgm-chevron text-white/90 ${isExpanded ? 'rotate-180' : ''}" id="icon_${collapseId}"></i>
                        </div>
                    </div>

                    <div id="${collapseId}" class="${isExpanded ? '' : 'hidden'} p-4 sm:p-5 bg-white">
                        ${hasNoItems ? `
                            <div class="text-center py-8 text-slate-400">
                                <i class="fas fa-inbox text-3xl mb-3 text-slate-200"></i>
                                <p class="font-medium text-slate-500 text-sm">No items for this period</p>
                            </div>
                        ` : `
                            ${summaryHtml}
                            <div class="space-y-2.5">
                                ${periodItems.map(item => buildItemHtml(item, period)).join('')}
                            </div>
                        `}
                    </div>
                </div>
            `;
        }

        // ========== BUILD ITEM HTML ==========
        function buildItemHtml(item, period) {
            if (item.periodSkipped) {
                return `
                    <div class="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 opacity-70">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="text-slate-400 text-sm">📦 ${escapeHtml(item.name)}</span>
                            <span class="bg-slate-200 text-slate-500 text-[11px] font-medium px-2 py-0.5 rounded-full">Not applicable this period</span>
                        </div>
                        <p class="text-[11px] text-slate-400 mt-1.5">${item.periodType === 'one_time' ? '⭐ One-time — only counted in the oldest period' : '📆 Yearly — only counted in the latest term of the year'}</p>
                    </div>
                `;
            }

            if (item.periodIsRemoved) {
                return `
                    <div class="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="line-through text-slate-400 text-sm">📦 ${escapeHtml(item.name)}</span>
                            <span class="bg-rose-100 text-rose-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">Removed for this period</span>
                        </div>
                        <p class="text-[11px] text-rose-500 mt-1.5">This item was removed from this period onwards</p>
                    </div>
                `;
            }

            const periodType = item.periodType || 'termly';
            const isFullyPaid = item.periodIsFullyPaid;
            const isPaidByCash = item.periodIsPaidByCash || false;
            const isPaidByItems = item.periodIsPaidByItems || false;
            const cashPaid = item.periodCashPaid || 0;
            const itemsBrought = item.periodItemsBrought || 0;
            const remaining = item.periodRemaining || 0;
            const remainingItems = item.periodRemainingItems || 0;
            const paymentOption = item.paymentOption || 'either';
            const unitPrice = item.unitPrice || 0;
            const quantity = item.quantity || 1;

            let paidDisplay = '';
            let paidByText = '';

            if (paymentOption === 'cash_only') {
                paidDisplay = cashPaid > 0 ? `💵 UGX ${formatMoney(cashPaid)}` : '—';
            } else if (paymentOption === 'item_only') {
                paidDisplay = itemsBrought > 0 ? `📦 ${itemsBrought} items` : '—';
            } else {
                const parts = [];
                if (cashPaid > 0) parts.push(`💵 UGX ${formatMoney(cashPaid)}`);
                if (itemsBrought > 0) parts.push(`📦 ${itemsBrought} items`);
                paidDisplay = parts.length > 0 ? parts.join(' + ') : '—';
                if (isFullyPaid) {
                    if (isPaidByCash) paidByText = 'via cash';
                    else if (isPaidByItems) paidByText = 'via items';
                }
            }

            let remainingDisplay = '';
            if (isFullyPaid) {
                remainingDisplay = '✓ Paid';
            } else if (paymentOption === 'cash_only') {
                remainingDisplay = `UGX ${formatMoney(remaining)}`;
            } else if (paymentOption === 'item_only') {
                remainingDisplay = `${remainingItems} items`;
            } else {
                const parts = [];
                if (remaining > 0) parts.push(`UGX ${formatMoney(remaining)}`);
                if (remainingItems > 0) parts.push(`${remainingItems} items`);
                remainingDisplay = parts.length > 0 ? parts.join(' <span class="text-amber-500 font-semibold">or</span> ') : '✓ Paid';
            }

            let statusDisplay = '';
            let statusClass = '';
            let statusDot = '';
            if (isFullyPaid) {
                statusDisplay = 'Fully paid';
                statusClass = 'text-emerald-600';
                statusDot = 'bg-emerald-500';
            } else if (cashPaid > 0 || itemsBrought > 0) {
                statusDisplay = 'Partial';
                statusClass = 'text-amber-600';
                statusDot = 'bg-amber-500';
            } else {
                statusDisplay = 'Unpaid';
                statusClass = 'text-rose-600';
                statusDot = 'bg-rose-500';
            }

            let optionBadge = '';
            if (paymentOption === 'cash_only') {
                optionBadge = '<span class="bg-blue-50 text-blue-700 ring-1 ring-blue-100 text-[11px] font-medium px-2 py-0.5 rounded-full">💵 Cash only</span>';
            } else if (paymentOption === 'item_only') {
                optionBadge = '<span class="bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 text-[11px] font-medium px-2 py-0.5 rounded-full">📦 Item only</span>';
            } else {
                optionBadge = '<span class="bg-purple-50 text-purple-700 ring-1 ring-purple-100 text-[11px] font-medium px-2 py-0.5 rounded-full">🔄 Cash or item</span>';
            }

            let periodBadge = '';
            let periodIcon = '';
            let periodColor = '';
            if (periodType === 'one_time') {
                periodBadge = 'One-time'; periodIcon = '⭐';
                periodColor = 'bg-violet-50 text-violet-700 ring-1 ring-violet-100';
            } else if (periodType === 'yearly') {
                periodBadge = 'Yearly'; periodIcon = '📆';
                periodColor = 'bg-orange-50 text-orange-700 ring-1 ring-orange-100';
            } else {
                periodBadge = 'Termly'; periodIcon = '📅';
                periodColor = 'bg-teal-50 text-teal-700 ring-1 ring-teal-100';
            }

            const customBadge = item.isCustomized
                ? `<span class="bg-amber-50 text-amber-700 ring-1 ring-amber-200 text-[11px] font-medium px-2 py-0.5 rounded-full">⚡ Custom</span>`
                : '';

            let paymentByDisplay = '';
            if (isFullyPaid && isPaidByCash) {
                paymentByDisplay = '<span class="text-[11px] text-emerald-600 font-medium">Paid by cash</span>';
            } else if (isFullyPaid && isPaidByItems) {
                paymentByDisplay = '<span class="text-[11px] text-blue-600 font-medium">Paid by items</span>';
            } else if (isFullyPaid && paymentOption === 'either' && cashPaid > 0 && itemsBrought > 0) {
                paymentByDisplay = '<span class="text-[11px] text-purple-600 font-medium">Cash + items</span>';
            }

            let historyHtml = '';
            const histories = item.periodPaymentHistories || [];
            if (histories.length > 0) {
                const historyId = `history_${item.id}_${period.year}_${period.term}`;
                historyHtml = `
                    <div class="mt-3 pt-3 border-t border-slate-100">
                        <button onclick="toggleItemHistory('${historyId}')" class="text-[12px] text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1.5">
                            <i class="fas fa-chevron-down sgm-chevron" id="${historyId}_icon"></i>
                            Payment history (${histories.length})
                        </button>
                        <div id="${historyId}" class="hidden mt-2 space-y-1 max-h-32 overflow-y-auto sgm-scroll pr-1">
                            ${histories.map(h => {
                                const date = new Date(h.date).toLocaleDateString();
                                let displayText = '';
                                let amountDisplay = '';

                                if (h.type === 'cash') {
                                    displayText = '💵 Cash';
                                    amountDisplay = `UGX ${formatMoney(h.amount)}`;
                                } else if (h.type === 'item') {
                                    displayText = '📦 Brought';
                                    amountDisplay = `${h.quantity || 0} item(s)`;
                                } else {
                                    displayText = '💳 Payment';
                                    amountDisplay = h.amount > 0 ? `UGX ${formatMoney(h.amount)}` : `${h.quantity || 0} items`;
                                }

                                let receiptDisplay = '';
                                if (h.receiptNumber && h.receiptNumber !== 'N/A') {
                                    receiptDisplay = ` <span class="text-indigo-400 font-mono text-[10px]">#${h.receiptNumber}</span>`;
                                }

                                let methodDisplay = '';
                                if (h.method && h.method !== 'cash') {
                                    methodDisplay = `<span class="text-slate-400"> (${h.method.toUpperCase()})</span>`;
                                }

                                const prevBadge = h.isPreviousBalancePayment ? ' 📋' : '';

                                return `
                                    <div class="flex justify-between items-center text-[11px] py-1.5 px-2 rounded-lg hover:bg-slate-50">
                                        <span class="text-slate-400">${date}</span>
                                        <span class="font-medium text-slate-600">${displayText}${methodDisplay}</span>
                                        <span class="font-semibold text-emerald-600">${amountDisplay}</span>
                                        ${receiptDisplay}${prevBadge}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }

            return `
                <div class="sgm-item-card border ${item.isCustomized ? 'border-amber-200' : 'border-slate-200'} rounded-xl p-4 bg-white ${item.isCustomized ? 'border-l-4 border-l-amber-400' : ''}">
                    <div class="flex justify-between items-start gap-3 flex-wrap">
                        <div class="flex-1 min-w-[220px]">
                            <div class="flex items-center gap-1.5 flex-wrap mb-1.5">
                                <p class="font-semibold text-slate-800 text-[14px]">📦 ${escapeHtml(item.name)}</p>
                                <span class="w-1.5 h-1.5 rounded-full ${statusDot}"></span>
                            </div>
                            <div class="flex items-center gap-1.5 flex-wrap mb-2">
                                ${optionBadge}
                                <span class="${periodColor} text-[11px] font-medium px-2 py-0.5 rounded-full">${periodIcon} ${periodBadge}</span>
                                ${customBadge}
                                ${paymentByDisplay}
                            </div>
                            <div class="text-[12px] text-slate-400 flex items-center gap-2 flex-wrap">
                                ${unitPrice > 0 ? `<span>Unit: UGX ${formatMoney(unitPrice)}</span>` : ''}
                                ${quantity > 0 ? `<span>· Qty: ${quantity}</span>` : ''}
                                ${item.isCustomized ? `<span class="text-amber-500 font-medium">· Custom: UGX ${formatMoney(item.total)}</span>` : ''}
                            </div>
                            <p class="text-[11px] text-slate-300 mt-1">
                                ${periodType === 'one_time' ? '⭐ Follows the student forever' :
                                  periodType === 'yearly' ? '📆 Resets each academic year' :
                                  '📅 Each term is independent'}
                            </p>
                        </div>
                        <div class="text-right shrink-0">
                            <p class="text-[13px] font-semibold text-slate-700">Paid: ${paidDisplay}</p>
                            ${paidByText ? `<p class="text-[11px] text-slate-400">${paidByText}</p>` : ''}
                            <p class="text-[13px] mt-0.5 font-medium ${remaining > 0 || remainingItems > 0 ? 'text-rose-600' : 'text-emerald-600'}">
                                ${remainingDisplay}
                            </p>
                        </div>
                    </div>

                    <div class="mt-3 pt-2.5 border-t border-slate-100 flex justify-between items-center text-[12px]">
                        <span class="text-slate-400">Status</span>
                        <span class="font-semibold ${statusClass}">${statusDisplay}</span>
                    </div>

                    ${historyHtml}
                </div>
            `;
        }

        // ========== TOTALS ACROSS ALL PERIODS ==========
        // We need to compute totals only for periods where the item is NOT removed for that period.
        let totalOutstanding = 0;
        let totalItemsOutstanding = 0;
        let totalPaymentCount = 0;
        const allPaymentIds = new Set();

        for (const period of allPeriods) {
            for (const item of targetItems) {
                // Check if removed for this period
                const isRemovedForPeriod = isItemRemovedForPeriod(item.id, period.year, period.term);
                if (isRemovedForPeriod || item.isTransportDisabled) continue;

                const itemPeriodType = item.periodType || 'termly';
                let shouldInclude = false;

                if (itemPeriodType === 'termly') {
                    shouldInclude = true;
                } else if (itemPeriodType === 'one_time') {
                    shouldInclude = (period.periodKey === oldestPeriodKey);
                } else if (itemPeriodType === 'yearly') {
                    const latestTermForYear = maxTermByYear[period.year] || 0;
                    shouldInclude = (period.term === latestTermForYear);
                }

                if (!shouldInclude) continue;

                const paidInfo = getPaidAmountsForItem(
                    student.id,
                    componentName,
                    item.name,
                    itemPeriodType,
                    period.year,
                    period.term
                );

                const totalAmount = item.total || 0;
                const quantity = item.quantity || 1;
                const unitPrice = item.unitPrice || 0;
                const paymentOption = item.paymentOption || 'either';
                const cashPaid = paidInfo.cashPaid;
                const itemsBrought = paidInfo.itemsBrought;

                let remaining = 0;
                let remainingItems = 0;

                if (paymentOption === 'cash_only') {
                    remaining = Math.max(0, totalAmount - cashPaid);
                } else if (paymentOption === 'item_only') {
                    remainingItems = Math.max(0, quantity - itemsBrought);
                } else {
                    const totalPaidValue = cashPaid + (itemsBrought * unitPrice);
                    const totalRequired = quantity * unitPrice;
                    remaining = Math.max(0, totalRequired - totalPaidValue);
                    remainingItems = Math.ceil(remaining / unitPrice);
                }

                if (remaining > 0 || remainingItems > 0) {
                    totalOutstanding += remaining;
                    totalItemsOutstanding += remainingItems;
                }

                for (const h of paidInfo.paymentHistories) {
                    if (h.paymentId) allPaymentIds.add(h.paymentId);
                }
            }
        }

        totalPaymentCount = allPaymentIds.size;

        // Count removed items (global, but we'll show only those that are removed globally; but we have no global flag now.
        // We can count items that are removed for the current period? Better: count items that have a removal entry.
        const globalRemovedCount = Object.keys(removedItems).filter(id => {
            const removed = removedItems[id];
            return removed && removed.isActive !== false;
        }).length;

        // For the modal, we'll show global removed count? But we want to show period-specific removed count? We'll just show total items and some stats.
        // We'll use the removedItems count globally.

        let periodsHtml = allPeriods.map((period, index) => buildPeriodHtml(period, index)).join('');

        // ========== MODAL ==========
        const modalHtml = `
            <div class="fixed inset-0 bg-slate-900/55 backdrop-blur-sm flex items-center justify-center z-50 overflow-y-auto p-4 sgm-backdrop" id="statusGroupModal">
                <div class="sgm-panel bg-white rounded-2xl w-full max-w-4xl my-8 max-h-[90vh] overflow-y-auto sgm-scroll shadow-2xl shadow-slate-900/20 ring-1 ring-slate-200" id="sgmPanel">

                    <!-- Header -->
                    <div class="flex justify-between items-start gap-4 px-6 pt-6 pb-4 border-b border-slate-100 sticky top-0 bg-white/95 backdrop-blur z-10 rounded-t-2xl">
                        <div class="min-w-0">
                            <h3 class="text-xl font-bold text-slate-800 flex items-center gap-2 tracking-tight">
                                <span class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                                    <i class="fas fa-tag text-sm"></i>
                                </span>
                                ${escapeHtml(statusGroupName)}
                            </h3>
                            <p class="text-[13px] text-slate-500 mt-1">${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)} <span class="text-slate-300 mx-1">·</span> ${escapeHtml(student.admissionNumber)}</p>

                            <div class="flex flex-wrap gap-1.5 mt-2.5">
                                ${globalRemovedCount > 0 ? `<span class="text-[11px] font-medium bg-rose-50 text-rose-700 ring-1 ring-rose-100 px-2 py-0.5 rounded-full">${globalRemovedCount} removed globally</span>` : ''}
                                ${targetItems.filter(i => i.isCustomized).length > 0 ? `<span class="text-[11px] font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-100 px-2 py-0.5 rounded-full">⚡ ${targetItems.filter(i => i.isCustomized).length} customized</span>` : ''}
                                <span class="text-[11px] font-medium bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 px-2 py-0.5 rounded-full">${allPeriods.length} period${allPeriods.length === 1 ? '' : 's'}</span>
                                <span class="text-[11px] font-medium bg-rose-50 text-rose-700 ring-1 ring-rose-100 px-2 py-0.5 rounded-full">Outstanding: UGX ${formatMoney(totalOutstanding)}</span>
                                ${totalItemsOutstanding > 0 ? `<span class="text-[11px] font-medium bg-orange-50 text-orange-700 ring-1 ring-orange-100 px-2 py-0.5 rounded-full">${totalItemsOutstanding} items</span>` : ''}
                                <span class="text-[11px] font-medium bg-purple-50 text-purple-700 ring-1 ring-purple-100 px-2 py-0.5 rounded-full">${totalPaymentCount} payment${totalPaymentCount === 1 ? '' : 's'}</span>
                            </div>
                        </div>
                        <button onclick="closeModal()" aria-label="Close" class="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors text-lg">
                            &times;
                        </button>
                    </div>

                    <div class="px-6 pb-6 pt-4">
                        <!-- Enrollment banner -->
                        <div class="bg-indigo-50/70 ring-1 ring-indigo-100 rounded-xl px-4 py-3 mb-4 text-[13px] flex items-center gap-2 flex-wrap text-slate-600">
                            <i class="fas fa-calendar-alt text-indigo-500"></i>
                            <span class="font-medium text-slate-700">Enrolled</span>
                            <span>${new Date(enrollmentDate).toLocaleDateString()}</span>
                            <span class="text-slate-300">·</span>
                            <span>${getTermName(enrollmentTerm)} ${enrollmentYear}</span>
                            <span class="ml-auto text-slate-400 text-[12px]">⭐ one-time counted once · 📆 yearly once per year</span>
                        </div>

                        <!-- Periods -->
                        <h4 class="font-semibold text-slate-700 text-[15px] mb-3 flex items-center gap-2">
                            <i class="fas fa-calendar-week text-slate-400"></i> Period breakdown
                        </h4>
                        <div class="space-y-3">
                            ${periodsHtml}
                        </div>
                    </div>

                    <!-- Actions -->
                    <div class="flex gap-3 px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white/95 backdrop-blur rounded-b-2xl">
                        <button onclick="closeModal(); makePaymentForStudent('${student.id}')"
                                class="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl font-medium text-[13px] hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2">
                            <i class="fas fa-receipt"></i> Make payment
                        </button>
                        <button onclick="closeModal(); editStudentInfoList('${student.id}')"
                                class="flex-1 bg-orange-500 text-white py-2.5 rounded-xl font-medium text-[13px] hover:bg-orange-600 transition-colors flex items-center justify-center gap-2">
                            <i class="fas fa-edit"></i> Edit student
                        </button>
                        <button onclick="closeModal()"
                                class="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-medium text-[13px] hover:bg-slate-200 transition-colors">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // ---------- UX polish: click-outside + Escape to close ----------
        const overlay = document.getElementById('statusGroupModal');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeModal();
            });
        }
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    })
    .catch(error => {
        console.error('Error:', error);
        const loadingModal = document.getElementById('statusGroupLoadingModal');
        if (loadingModal) loadingModal.remove();
        alert('Error loading student details: ' + error.message);
    });
};

// ========== TOGGLE FUNCTIONS ==========
window.togglePeriodDetails = function(collapseId) {
    const element = document.getElementById(collapseId);
    const icon = document.getElementById('icon_' + collapseId);

    if (element) {
        element.classList.toggle('hidden');
        if (icon) {
            icon.classList.toggle('rotate-180');
        }
    }
};

window.toggleItemHistory = function(historyId) {
    const element = document.getElementById(historyId);
    const icon = document.getElementById(historyId + '_icon');

    if (element) {
        element.classList.toggle('hidden');
        if (icon) {
            icon.classList.toggle('fa-chevron-down');
            icon.classList.toggle('fa-chevron-up');
        }
    }
};

// ========== CLOSE MODAL ==========
window.closeModal = function() {
    const modal = document.getElementById('statusGroupModal');
    if (modal) modal.remove();
};

// ========== MAKE PAYMENT FOR STUDENT ==========
window.makePaymentForStudent = function(studentId) {
    closeModal();
    const feeLink = document.querySelector('.sidebar-item[onclick*="showFeeManagement"]');
    if (feeLink) feeLink.click();
    else if (typeof showFeeManagement === 'function') showFeeManagement();
    setTimeout(() => {
        const studentSelect = document.getElementById('collectStudentSelect');
        if (studentSelect) {
            studentSelect.value = studentId;
            studentSelect.dispatchEvent(new Event('change'));
        }
        const collectTab = document.querySelector('.fee-tab[data-tab="collect"]');
        if (collectTab) collectTab.click();
    }, 500);
};

console.log('✅ showStatusGroupItemDetailsModal v11.0 - CASH VS ITEMS SEPARATED LOADED!');
console.log('   ✅ Cash and Items are NEVER mixed - they are tracked separately');
console.log('   ✅ "Paid" shows cash and items separately: 💵 UGX 14,000 + 📦 8 items');
console.log('   ✅ Items are NEVER converted to cash');
console.log('   ✅ "OR" statements show options: UGX 8,000 OR 2 items');
console.log('   ✅ Fully paid by items shows: 📦 2 items (Fully Paid - Items)');
console.log('   ✅ Fully paid by cash shows: 💵 UGX 2,000 (Fully Paid - Cash)');
console.log('   ✅ Removed items are clearly marked');
console.log('   ✅ Custom overrides are preserved');
console.log('   ✅ Payment history shows separate cash and item entries');
// ==================== GLOBAL TUITION DETAILS MODAL ====================
// Version: 2.0 - Fully working with all data

window.showTuitionDetailsModal = function(studentId) {
    console.log('showTuitionDetailsModal called - GLOBAL VERSION');
    
    // Find the student in the global data
    const student = window.allStudentsData?.find(s => s.id === studentId);
    if (!student) {
        alert('Student not found');
        return;
    }
    
    // Get fresh payment data
    fetch('/api/fee/payments')
        .then(res => res.json())
        .then(allPayments => {
            const { currentYear, currentTerm } = currentAcademicSettings || { currentYear: new Date().getFullYear(), currentTerm: 1 };
            
            const tuitionPaid = student.tuitionPaid || 0;
            const tuitionExpected = student.tuitionExpected || 0;
            const tuitionBalance = student.tuitionBalance || 0;
            const bursary = student.bursaryDetails;
            
            // Get tuition payment history for this student
            const studentPayments = allPayments.filter(p => 
                p && p.studentId === studentId && 
                p.term === currentTerm && 
                p.academicYear === currentYear.toString() && 
                (p.tuitionPaid || 0) > 0
            );
            
            const tuitionPaymentHistory = studentPayments.map(p => ({
                date: p.date || new Date().toISOString(),
                amount: p.tuitionPaid || 0,
                receiptNumber: p.receiptNumber || 'N/A',
                method: p.method || 'cash'
            }));
            
            let paymentHistoryHtml = '';
            if (tuitionPaymentHistory.length > 0) {
                const sortedHistory = [...tuitionPaymentHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
                paymentHistoryHtml = sortedHistory.map(p => `
                    <div class="flex justify-between items-center text-sm border-b border-gray-100 py-1 last:border-0 hover:bg-gray-50 px-1 rounded">
                        <span class="text-gray-500">${new Date(p.date).toLocaleDateString()}</span>
                        <span class="font-semibold text-green-600">UGX ${formatMoney(p.amount)}</span>
                        <span class="text-xs text-blue-500 font-mono">#${p.receiptNumber}</span>
                        <span class="text-xs text-gray-400">${p.method.toUpperCase()}</span>
                    </div>
                `).join('');
            } else {
                paymentHistoryHtml = '<div class="text-gray-500 text-sm text-center py-2">No tuition payments recorded</div>';
            }
            
            const modalHtml = `
                <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
                    <div class="bg-white rounded-2xl p-6 max-w-md w-full mx-4 my-8">
                        <div class="flex justify-between items-start mb-4 pb-3 border-b">
                            <div>
                                <h3 class="text-2xl font-bold flex items-center gap-2">
                                    <i class="fas fa-money-bill-wave text-blue-600"></i>
                                    Tuition Details
                                </h3>
                                <p class="text-sm text-gray-500">${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)} - ${student.admissionNumber}</p>
                                ${student.hasCustomizations ? `<p class="text-xs text-orange-500 mt-1">⚡ ${student.totalCustomItems} custom item(s) in other groups</p>` : ''}
                            </div>
                            <button onclick="closeModal()" class="text-gray-500 text-2xl hover:text-gray-700">&times;</button>
                        </div>
                        
                        ${bursary ? `
                            <div class="bg-yellow-50 rounded-lg p-3 mb-4 border border-yellow-200">
                                <p class="font-semibold text-yellow-800">🎖️ Bursary Applied</p>
                                <p class="text-sm">${bursary.name}</p>
                                <p class="text-sm text-green-600">Discount: ${student.discountDisplay}</p>
                                <p class="text-sm font-semibold">Tuition After Bursary: UGX ${formatMoney(student.tuitionExpected)}</p>
                            </div>
                        ` : `
                            <div class="bg-gray-50 rounded-lg p-3 mb-4 border border-gray-200">
                                <p class="text-sm text-gray-600">No bursary applied</p>
                            </div>
                        `}
                        
                        <div class="grid grid-cols-3 gap-3 mb-4">
                            <div class="bg-blue-50 rounded-lg p-3 text-center">
                                <p class="text-xs text-gray-500">Expected</p>
                                <p class="text-xl font-bold text-blue-600">UGX ${formatMoney(tuitionExpected)}</p>
                            </div>
                            <div class="bg-green-50 rounded-lg p-3 text-center">
                                <p class="text-xs text-gray-500">Paid</p>
                                <p class="text-xl font-bold text-green-600">UGX ${formatMoney(tuitionPaid)}</p>
                            </div>
                            <div class="bg-red-50 rounded-lg p-3 text-center">
                                <p class="text-xs text-gray-500">Balance</p>
                                <p class="text-xl font-bold ${tuitionBalance > 0 ? 'text-red-600' : 'text-green-600'}">
                                    UGX ${formatMoney(Math.abs(tuitionBalance))}
                                </p>
                            </div>
                        </div>
                        
                        <h4 class="font-bold text-md mb-2">📜 Payment History (This Term)</h4>
                        <div class="bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto">
                            ${paymentHistoryHtml}
                        </div>
                        
                        <div class="flex gap-3 mt-6 pt-4 border-t">
                            <button onclick="closeModal(); makePaymentForStudent('${student.id}')" 
                                    class="flex-1 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700">
                                <i class="fas fa-receipt"></i> Make Tuition Payment
                            </button>
                            <button onclick="closeModal()" class="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        })
        .catch(error => {
            console.error('Error loading tuition details:', error);
            alert('Error loading tuition details: ' + error.message);
        });
};

// ==================== GLOBAL MAKE PAYMENT FOR STUDENT ====================

window.makePaymentForStudent = function(studentId) {
    closeModal();
    const feeLink = document.querySelector('.sidebar-item[onclick*="showFeeManagement"]');
    if (feeLink) {
        feeLink.click();
    } else if (typeof showFeeManagement === 'function') {
        showFeeManagement();
    }
    setTimeout(() => {
        const studentSelect = document.getElementById('collectStudentSelect');
        if (studentSelect) {
            studentSelect.value = studentId;
            studentSelect.dispatchEvent(new Event('change'));
        }
        const collectTab = document.querySelector('.fee-tab[data-tab="collect"]');
        if (collectTab) collectTab.click();
    }, 500);
};

// ==================== GLOBAL CLOSE MODAL ====================

window.closeModal = function() {
    const modal = document.querySelector('.fixed.inset-0');
    if (modal) modal.remove();
};

// ==================== GLOBAL ESCAPE HTML ====================

window.escapeHtml = function(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

// ==================== GLOBAL FORMAT MONEY ====================

window.formatMoney = function(amount) {
    const num = Math.round(amount || 0);
    return num.toLocaleString('en-US');
};

// ==================== GLOBAL DEDUPLICATE HISTORIES ====================

window.deduplicateHistories = function(histories) {
    if (!histories || histories.length === 0) return [];
    const seen = new Set();
    const unique = [];
    for (let h = 0; h < histories.length; h++) {
        const history = histories[h];
        const key = `${history.date || ''}_${history.type || ''}_${history.amount || 0}_${history.itemsBrought || 0}_${history.receiptNumber || ''}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(history);
        }
    }
    return unique;
};

console.log('✅ Global helper functions loaded:');
console.log('   - showTuitionDetailsModal');
console.log('   - showStatusGroupItemDetailsModal');
console.log('   - makePaymentForStudent');
console.log('   - closeModal');
console.log('   - escapeHtml');
console.log('   - formatMoney');
console.log('   - deduplicateHistories');
// ==================== ACTION FUNCTIONS ====================

// ==================== COMPLETE VIEW STUDENT DETAILS MODAL ====================
// Version: 3.0 - Professional student profile view with all information

// ==================== COMPLETE VIEW STUDENT DETAILS MODAL WITH ACTIVITY FEES BREAKDOWN ====================
// Version: 4.0 - Shows all activity fees categorized by period type

// ==================== COMPLETE FIXED VIEW STUDENT DETAILS MODAL ====================
// Version: 6.0 - Deduplicates items within the same payment

// ==================== COMPLETELY REBUILT VIEW STUDENT DETAILS ====================
// Version: 8.0 - With Print Button and Correct Calculations

// ==================== COMPLETELY REBUILT VIEW STUDENT DETAILS ====================
// Version: 8.0 - With Print Button and Correct Calculations



// ==================== PRINT STUDENT PROFILE FUNCTION ====================


// Helper functions for rendering sections
function renderPersonalInfoSection(student) {
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-user-circle mr-2 text-blue-600"></i> Personal Information
            </div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div><p class="text-xs text-gray-500">First Name</p><p class="font-medium">${escapeHtml(student.firstName || 'N/A')}</p></div>
                    <div><p class="text-xs text-gray-500">Last Name</p><p class="font-medium">${escapeHtml(student.lastName || 'N/A')}</p></div>
                    <div><p class="text-xs text-gray-500">Gender</p><p class="font-medium">${student.gender || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Date of Birth</p><p class="font-medium">${student.dateOfBirth ? new Date(student.dateOfBirth).toLocaleDateString() : 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Place of Birth</p><p class="font-medium">${student.birthPlace || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Nationality</p><p class="font-medium">${student.nationality || 'Ugandan'}</p></div>
                </div>
            </div>
        </div>
    `;
}

function renderParentInfoSection(student) {
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-users mr-2 text-green-600"></i> Parent/Guardian Information
            </div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div><p class="text-xs text-gray-500">Full Name</p><p class="font-medium">${escapeHtml(student.parentInfo?.name || 'N/A')}</p></div>
                    <div><p class="text-xs text-gray-500">Relationship</p><p class="font-medium">${student.parentInfo?.relationship || 'Parent'}</p></div>
                    <div><p class="text-xs text-gray-500">Phone Number</p><p class="font-medium">${student.parentInfo?.phone || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Alternative Phone</p><p class="font-medium">${student.parentInfo?.altPhone || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Email Address</p><p class="font-medium">${student.parentInfo?.email || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Occupation</p><p class="font-medium">${student.parentInfo?.occupation || 'N/A'}</p></div>
                </div>
                <div><p class="text-xs text-gray-500">Address</p><p class="font-medium">${student.address || 'N/A'}</p></div>
            </div>
        </div>
    `;
}

function renderAcademicInfoSection(student, currentClass, classLevel) {
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-graduation-cap mr-2 text-purple-600"></i> Academic Information
            </div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div><p class="text-xs text-gray-500">Current Class</p><p class="font-medium">${currentClass}</p></div>
                    <div><p class="text-xs text-gray-500">Class Level</p><p class="font-medium">${classLevel === 'Nursery' ? 'Nursery' : classLevel === 'LowerPrimary' ? 'Lower Primary' : classLevel === 'UpperPrimary' ? 'Upper Primary' : 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Previous School</p><p class="font-medium">${student.previousSchool || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Admission Type</p><p class="font-medium">${student.admissionType || 'New'}</p></div>
                </div>
            </div>
        </div>
    `;
}

function renderFeeInfoSection(feeStructure, bursary, discountDisplay, expectedTuition, tuitionPaid, tuitionBalance, totalActivityPaid, termName) {
    let tuitionBalanceDisplay = '';
    let tuitionBalanceClass = '';
    if (tuitionBalance > 0) {
        tuitionBalanceDisplay = `UGX ${Math.round(tuitionBalance).toLocaleString()} (Due)`;
        tuitionBalanceClass = 'text-red-600';
    } else if (tuitionBalance < 0) {
        tuitionBalanceDisplay = `Credit: UGX ${Math.round(Math.abs(tuitionBalance)).toLocaleString()}`;
        tuitionBalanceClass = 'text-blue-600';
    } else {
        tuitionBalanceDisplay = 'Fully Paid';
        tuitionBalanceClass = 'text-green-600';
    }
    
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-money-bill-wave mr-2 text-yellow-600"></i> Fee Information
            </div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div><p class="text-xs text-gray-500">Fee Structure</p><p class="font-medium">${feeStructure?.name || 'Not Assigned'}</p></div>
                    <div><p class="text-xs text-gray-500">Bursary Applied</p><p class="font-medium text-green-600">${bursary?.name || 'None'} ${discountDisplay ? `(${discountDisplay})` : ''}</p></div>
                    <div><p class="text-xs text-gray-500">Expected Tuition (${termName})</p><p class="font-medium">UGX ${Math.round(expectedTuition).toLocaleString()}</p></div>
                    <div><p class="text-xs text-gray-500">Tuition Paid</p><p class="font-medium text-green-600">UGX ${Math.round(tuitionPaid).toLocaleString()}</p></div>
                    <div><p class="text-xs text-gray-500">Tuition Balance</p><p class="font-medium ${tuitionBalanceClass}">${tuitionBalanceDisplay}</p></div>
                    <div><p class="text-xs text-gray-500">Total Activities Paid</p><p class="font-medium text-green-600">UGX ${Math.round(totalActivityPaid).toLocaleString()}</p></div>
                </div>
            </div>
        </div>
    `;
}

function renderPaymentSummarySection(studentPayments, totalPaidThisTerm) {
    const lastPaymentDate = studentPayments.length > 0 ? new Date(Math.max(...studentPayments.map(p => new Date(p.date)))).toLocaleDateString() : 'N/A';
    
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-chart-line mr-2 text-indigo-600"></i> ${currentAcademicSettings.currentTerm === 1 ? 'First' : currentAcademicSettings.currentTerm === 2 ? 'Second' : 'Third'} Term ${currentAcademicSettings.currentYear} Payment Summary
            </div>
            <div class="p-4">
                <div class="grid grid-cols-3 gap-3 text-center mb-3">
                    <div class="bg-blue-50 rounded-lg p-2"><p class="text-xs text-gray-500">Total Paid</p><p class="text-lg font-bold text-green-600">UGX ${Math.round(totalPaidThisTerm).toLocaleString()}</p></div>
                    <div class="bg-yellow-50 rounded-lg p-2"><p class="text-xs text-gray-500">Payment Count</p><p class="text-lg font-bold">${studentPayments.length}</p></div>
                    <div class="bg-purple-50 rounded-lg p-2"><p class="text-xs text-gray-500">Last Payment</p><p class="text-sm font-medium">${lastPaymentDate}</p></div>
                </div>
            </div>
        </div>
    `;
}

function getTermStartDate(year, term) {
    if (term === 1) return new Date(year, 0, 10);
    if (term === 2) return new Date(year, 4, 10);
    return new Date(year, 8, 10);
}

function getTermName(term) {
    const names = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
    return names[term] || `Term ${term}`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function closeModal() {
    const modal = document.querySelector('.fixed.inset-0');
    if (modal) modal.remove();
}

// ==================== PRINT STUDENT PROFILE FUNCTION ====================
// ==================== IMPROVED PRINT STUDENT PROFILE FUNCTION ====================
// ==================== IMPROVED PRINT STUDENT PROFILE FUNCTION ====================


// Helper functions for rendering sections
function renderPersonalInfoSection(student) {
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-user-circle mr-2 text-blue-600"></i> Personal Information
            </div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div><p class="text-xs text-gray-500">First Name</p><p class="font-medium">${escapeHtml(student.firstName || 'N/A')}</p></div>
                    <div><p class="text-xs text-gray-500">Last Name</p><p class="font-medium">${escapeHtml(student.lastName || 'N/A')}</p></div>
                    <div><p class="text-xs text-gray-500">Gender</p><p class="font-medium">${student.gender || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Date of Birth</p><p class="font-medium">${student.dateOfBirth ? new Date(student.dateOfBirth).toLocaleDateString() : 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Place of Birth</p><p class="font-medium">${student.birthPlace || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Nationality</p><p class="font-medium">${student.nationality || 'Ugandan'}</p></div>
                </div>
            </div>
        </div>
    `;
}

function renderParentInfoSection(student) {
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-users mr-2 text-green-600"></i> Parent/Guardian Information
            </div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div><p class="text-xs text-gray-500">Full Name</p><p class="font-medium">${escapeHtml(student.parentInfo?.name || 'N/A')}</p></div>
                    <div><p class="text-xs text-gray-500">Relationship</p><p class="font-medium">${student.parentInfo?.relationship || 'Parent'}</p></div>
                    <div><p class="text-xs text-gray-500">Phone Number</p><p class="font-medium">${student.parentInfo?.phone || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Alternative Phone</p><p class="font-medium">${student.parentInfo?.altPhone || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Email Address</p><p class="font-medium">${student.parentInfo?.email || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Occupation</p><p class="font-medium">${student.parentInfo?.occupation || 'N/A'}</p></div>
                </div>
                <div><p class="text-xs text-gray-500">Address</p><p class="font-medium">${student.address || 'N/A'}</p></div>
            </div>
        </div>
    `;
}

function renderAcademicInfoSection(student, currentClass, classLevel) {
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-graduation-cap mr-2 text-purple-600"></i> Academic Information
            </div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div><p class="text-xs text-gray-500">Current Class</p><p class="font-medium">${currentClass}</p></div>
                    <div><p class="text-xs text-gray-500">Class Level</p><p class="font-medium">${classLevel === 'Nursery' ? 'Nursery' : classLevel === 'LowerPrimary' ? 'Lower Primary' : classLevel === 'UpperPrimary' ? 'Upper Primary' : 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Previous School</p><p class="font-medium">${student.previousSchool || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Admission Type</p><p class="font-medium">${student.admissionType || 'New'}</p></div>
                </div>
            </div>
        </div>
    `;
}

function renderFeeInfoSection(feeStructure, bursary, discountDisplay, expectedTuition, tuitionPaid, tuitionBalance, totalActivityPaid, termName) {
    let tuitionBalanceDisplay = '';
    let tuitionBalanceClass = '';
    if (tuitionBalance > 0) {
        tuitionBalanceDisplay = `UGX ${Math.round(tuitionBalance).toLocaleString()} (Due)`;
        tuitionBalanceClass = 'text-red-600';
    } else if (tuitionBalance < 0) {
        tuitionBalanceDisplay = `Credit: UGX ${Math.round(Math.abs(tuitionBalance)).toLocaleString()}`;
        tuitionBalanceClass = 'text-blue-600';
    } else {
        tuitionBalanceDisplay = 'Fully Paid';
        tuitionBalanceClass = 'text-green-600';
    }
    
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-money-bill-wave mr-2 text-yellow-600"></i> Fee Information
            </div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div><p class="text-xs text-gray-500">Fee Structure</p><p class="font-medium">${feeStructure?.name || 'Not Assigned'}</p></div>
                    <div><p class="text-xs text-gray-500">Bursary Applied</p><p class="font-medium text-green-600">${bursary?.name || 'None'} ${discountDisplay ? `(${discountDisplay})` : ''}</p></div>
                    <div><p class="text-xs text-gray-500">Expected Tuition (${termName})</p><p class="font-medium">UGX ${Math.round(expectedTuition).toLocaleString()}</p></div>
                    <div><p class="text-xs text-gray-500">Tuition Paid</p><p class="font-medium text-green-600">UGX ${Math.round(tuitionPaid).toLocaleString()}</p></div>
                    <div><p class="text-xs text-gray-500">Tuition Balance</p><p class="font-medium ${tuitionBalanceClass}">${tuitionBalanceDisplay}</p></div>
                    <div><p class="text-xs text-gray-500">Total Activities Paid</p><p class="font-medium text-green-600">UGX ${Math.round(totalActivityPaid).toLocaleString()}</p></div>
                </div>
            </div>
        </div>
    `;
}

function renderPaymentSummarySection(studentPayments, totalPaidThisTerm) {
    const lastPaymentDate = studentPayments.length > 0 ? new Date(Math.max(...studentPayments.map(p => new Date(p.date)))).toLocaleDateString() : 'N/A';
    
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-chart-line mr-2 text-indigo-600"></i> ${currentAcademicSettings.currentTerm === 1 ? 'First' : currentAcademicSettings.currentTerm === 2 ? 'Second' : 'Third'} Term ${currentAcademicSettings.currentYear} Payment Summary
            </div>
            <div class="p-4">
                <div class="grid grid-cols-3 gap-3 text-center mb-3">
                    <div class="bg-blue-50 rounded-lg p-2"><p class="text-xs text-gray-500">Total Paid</p><p class="text-lg font-bold text-green-600">UGX ${Math.round(totalPaidThisTerm).toLocaleString()}</p></div>
                    <div class="bg-yellow-50 rounded-lg p-2"><p class="text-xs text-gray-500">Payment Count</p><p class="text-lg font-bold">${studentPayments.length}</p></div>
                    <div class="bg-purple-50 rounded-lg p-2"><p class="text-xs text-gray-500">Last Payment</p><p class="text-sm font-medium">${lastPaymentDate}</p></div>
                </div>
            </div>
        </div>
    `;
}

function getTermStartDate(year, term) {
    if (term === 1) return new Date(year, 0, 10);
    if (term === 2) return new Date(year, 4, 10);
    return new Date(year, 8, 10);
}

function getTermName(term) {
    const names = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
    return names[term] || `Term ${term}`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function closeModal() {
    const modal = document.querySelector('.fixed.inset-0');
    if (modal) modal.remove();
}

// Helper functions for rendering sections
function renderPersonalInfoSection(student) {
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-user-circle mr-2 text-blue-600"></i> Personal Information
            </div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div><p class="text-xs text-gray-500">First Name</p><p class="font-medium">${escapeHtml(student.firstName || 'N/A')}</p></div>
                    <div><p class="text-xs text-gray-500">Last Name</p><p class="font-medium">${escapeHtml(student.lastName || 'N/A')}</p></div>
                    <div><p class="text-xs text-gray-500">Gender</p><p class="font-medium">${student.gender || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Date of Birth</p><p class="font-medium">${student.dateOfBirth ? new Date(student.dateOfBirth).toLocaleDateString() : 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Place of Birth</p><p class="font-medium">${student.birthPlace || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Nationality</p><p class="font-medium">${student.nationality || 'Ugandan'}</p></div>
                </div>
            </div>
        </div>
    `;
}

function renderParentInfoSection(student) {
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-users mr-2 text-green-600"></i> Parent/Guardian Information
            </div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div><p class="text-xs text-gray-500">Full Name</p><p class="font-medium">${escapeHtml(student.parentInfo?.name || 'N/A')}</p></div>
                    <div><p class="text-xs text-gray-500">Relationship</p><p class="font-medium">${student.parentInfo?.relationship || 'Parent'}</p></div>
                    <div><p class="text-xs text-gray-500">Phone Number</p><p class="font-medium">${student.parentInfo?.phone || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Alternative Phone</p><p class="font-medium">${student.parentInfo?.altPhone || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Email Address</p><p class="font-medium">${student.parentInfo?.email || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Occupation</p><p class="font-medium">${student.parentInfo?.occupation || 'N/A'}</p></div>
                </div>
                <div><p class="text-xs text-gray-500">Address</p><p class="font-medium">${student.address || 'N/A'}</p></div>
            </div>
        </div>
    `;
}

function renderAcademicInfoSection(student, currentClass, classLevel) {
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-graduation-cap mr-2 text-purple-600"></i> Academic Information
            </div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div><p class="text-xs text-gray-500">Current Class</p><p class="font-medium">${currentClass}</p></div>
                    <div><p class="text-xs text-gray-500">Class Level</p><p class="font-medium">${classLevel === 'Nursery' ? 'Nursery' : classLevel === 'LowerPrimary' ? 'Lower Primary' : classLevel === 'UpperPrimary' ? 'Upper Primary' : 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Previous School</p><p class="font-medium">${student.previousSchool || 'N/A'}</p></div>
                    <div><p class="text-xs text-gray-500">Admission Type</p><p class="font-medium">${student.admissionType || 'New'}</p></div>
                </div>
            </div>
        </div>
    `;
}

function renderFeeInfoSection(feeStructure, bursary, discountDisplay, expectedTuition, tuitionPaid, tuitionBalance, totalActivityPaid, termName) {
    let tuitionBalanceDisplay = '';
    let tuitionBalanceClass = '';
    if (tuitionBalance > 0) {
        tuitionBalanceDisplay = `UGX ${Math.round(tuitionBalance).toLocaleString()} (Due)`;
        tuitionBalanceClass = 'text-red-600';
    } else if (tuitionBalance < 0) {
        tuitionBalanceDisplay = `Credit: UGX ${Math.round(Math.abs(tuitionBalance)).toLocaleString()}`;
        tuitionBalanceClass = 'text-blue-600';
    } else {
        tuitionBalanceDisplay = 'Fully Paid';
        tuitionBalanceClass = 'text-green-600';
    }
    
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-money-bill-wave mr-2 text-yellow-600"></i> Fee Information
            </div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div><p class="text-xs text-gray-500">Fee Structure</p><p class="font-medium">${feeStructure?.name || 'Not Assigned'}</p></div>
                    <div><p class="text-xs text-gray-500">Bursary Applied</p><p class="font-medium text-green-600">${bursary?.name || 'None'} ${discountDisplay ? `(${discountDisplay})` : ''}</p></div>
                    <div><p class="text-xs text-gray-500">Expected Tuition (${termName})</p><p class="font-medium">UGX ${Math.round(expectedTuition).toLocaleString()}</p></div>
                    <div><p class="text-xs text-gray-500">Tuition Paid</p><p class="font-medium text-green-600">UGX ${Math.round(tuitionPaid).toLocaleString()}</p></div>
                    <div><p class="text-xs text-gray-500">Tuition Balance</p><p class="font-medium ${tuitionBalanceClass}">${tuitionBalanceDisplay}</p></div>
                    <div><p class="text-xs text-gray-500">Total Activities Paid</p><p class="font-medium text-green-600">UGX ${Math.round(totalActivityPaid).toLocaleString()}</p></div>
                </div>
            </div>
        </div>
    `;
}

function renderPaymentSummarySection(studentPayments, totalPaidThisTerm) {
    const lastPaymentDate = studentPayments.length > 0 ? new Date(Math.max(...studentPayments.map(p => new Date(p.date)))).toLocaleDateString() : 'N/A';
    
    return `
        <div class="border rounded-xl overflow-hidden">
            <div class="bg-gray-100 px-4 py-3 font-semibold text-gray-700 border-b">
                <i class="fas fa-chart-line mr-2 text-indigo-600"></i> ${currentAcademicSettings.currentTerm === 1 ? 'First' : currentAcademicSettings.currentTerm === 2 ? 'Second' : 'Third'} Term ${currentAcademicSettings.currentYear} Payment Summary
            </div>
            <div class="p-4">
                <div class="grid grid-cols-3 gap-3 text-center mb-3">
                    <div class="bg-blue-50 rounded-lg p-2"><p class="text-xs text-gray-500">Total Paid</p><p class="text-lg font-bold text-green-600">UGX ${Math.round(totalPaidThisTerm).toLocaleString()}</p></div>
                    <div class="bg-yellow-50 rounded-lg p-2"><p class="text-xs text-gray-500">Payment Count</p><p class="text-lg font-bold">${studentPayments.length}</p></div>
                    <div class="bg-purple-50 rounded-lg p-2"><p class="text-xs text-gray-500">Last Payment</p><p class="text-sm font-medium">${lastPaymentDate}</p></div>
                </div>
            </div>
        </div>
    `;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getTermStartDate(year, term) {
    if (term === 1) return new Date(year, 0, 10);
    if (term === 2) return new Date(year, 4, 10);
    return new Date(year, 8, 10);
}

function closeModal() {
    const modal = document.querySelector('.fixed.inset-0');
    if (modal) modal.remove();
}

// Helper function to get term start date
function getTermStartDate(year, term) {
    if (term === 1) return new Date(year, 0, 10);
    if (term === 2) return new Date(year, 4, 10);
    return new Date(year, 8, 10);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}



// ========== CLOSE EDIT MODAL ==========
function closeEditModal() {
    const modal = document.getElementById('editStudentModal');
    if (modal) modal.remove();
    
    // Clean up globals
    window._editStudentData = null;
    window._customizationContext = null;
}

// ========== SHOW TOAST ==========
function showToast(message, type) {
    const existing = document.getElementById('editToast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.id = 'editToast';
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500';
    toast.className = `fixed bottom-4 right-4 ${bgColor} text-white px-4 py-2 rounded-lg shadow-lg z-[300]`;
    toast.innerHTML = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// ========== ESCAPE HTML ==========
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== MAKE FUNCTIONS GLOBAL ==========
window.editStudentInfoList = editStudentInfoList;
window.closeEditModal = closeEditModal;
window.showToast = showToast;
window.escapeHtml = escapeHtml;

console.log('✅ editStudentInfoList - COMPLETE REBUILD FINAL LOADED!');
console.log('✅ editStudentInfoList - COMPLETE REBUILD LOADED!');
console.log('✅ editStudentInfoList - COMPLETE FIXED VERSION LOADED!');
// ==================== DELETE STUDENT WITH CONFIRMATION ====================

async function deleteStudentEntryList(studentId) {
    // Get student name for confirmation message
    const student = window.allStudentsData?.find(s => s.id === studentId);
    const studentName = student ? `${student.firstName} ${student.lastName}` : 'this student';
    
    // Professional confirmation modal
    const confirmHtml = `
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
                <div class="text-center">
                    <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <i class="fas fa-exclamation-triangle text-red-600 text-2xl"></i>
                    </div>
                    <h3 class="text-xl font-bold text-gray-800 mb-2">Delete Student</h3>
                    <p class="text-gray-600 mb-4">Are you sure you want to delete <strong>${escapeHtml(studentName)}</strong>?</p>
                    <p class="text-sm text-red-500 mb-4">This action cannot be undone. All fee records and academic data will be permanently removed.</p>
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Type "DELETE" to confirm:</label>
                        <input type="text" id="deleteConfirmInput" class="w-full border rounded-lg px-3 py-2 text-center" placeholder="DELETE">
                    </div>
                    <div class="flex gap-3">
                        <button onclick="closeModal()" class="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400">Cancel</button>
                        <button id="confirmDeleteBtn" class="flex-1 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 opacity-50 cursor-not-allowed" disabled>Delete</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', confirmHtml);
    
    // Enable delete button only when DELETE is typed
    const confirmInput = document.getElementById('deleteConfirmInput');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    
    confirmInput.addEventListener('input', function() {
        if (this.value === 'DELETE') {
            confirmBtn.disabled = false;
            confirmBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        } else {
            confirmBtn.disabled = true;
            confirmBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
    });
    
    confirmBtn.addEventListener('click', async () => {
        try {
            const response = await fetch(`/api/students/${studentId}`, { method: 'DELETE' });
            if (response.ok) {
                closeModal();
                alert(`✅ ${studentName} has been deleted successfully`);
                showStudentList(); // Refresh the student list
            } else {
                const error = await response.json();
                alert('❌ Error deleting student: ' + (error.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Network error: ' + error.message);
        }
    });
}



// ==================== viewStudentDetailsList (FULLY FIXED) ====================
async function viewStudentDetailsList(studentId) {
    console.log('=== viewStudentDetailsList vFINAL - ONLY SCHOLASTIC ITEMS COUNTED, YEARLY/ONETIME FIX ===');
    console.log('Student ID:', studentId);

    // ==================== HELPER: GET CUSTOMIZED ITEM VALUE ====================
    function getCustomizedItemValue(student, itemId, itemName, defaultAmount, defaultQuantity, defaultPaymentOption, defaultUnitPrice) {
        if (!student) {
            return {
                amount: defaultAmount || 0,
                quantity: defaultQuantity || 1,
                paymentOption: defaultPaymentOption || 'either',
                unitPrice: defaultUnitPrice || (defaultAmount / (defaultQuantity || 1)),
                isCustomized: false,
                reason: null,
                updatedAt: null,
                customAmount: null,
                customQuantity: null,
                defaultAmount: defaultAmount || 0,
                defaultQuantity: defaultQuantity || 1
            };
        }

        if (student.customItemOverrides && student.customItemOverrides[itemId]) {
            const custom = student.customItemOverrides[itemId];
            if (custom.isActive !== false) {
                const customAmount = (custom.customAmount !== null && custom.customAmount !== undefined)
                    ? custom.customAmount
                    : defaultAmount;
                const customQuantity = (custom.customQuantity !== null && custom.customQuantity !== undefined)
                    ? custom.customQuantity
                    : defaultQuantity;
                const customPaymentOption = custom.paymentOption || defaultPaymentOption;

                let customUnitPrice = defaultUnitPrice;
                if (customQuantity > 0 && customAmount > 0) {
                    customUnitPrice = customAmount / customQuantity;
                } else if (customAmount > 0) {
                    customUnitPrice = customAmount / (customQuantity || 1);
                } else if (customQuantity > 0) {
                    customUnitPrice = defaultUnitPrice || (defaultAmount / (defaultQuantity || 1));
                }

                return {
                    amount: customAmount,
                    quantity: customQuantity,
                    paymentOption: customPaymentOption,
                    unitPrice: customUnitPrice,
                    isCustomized: true,
                    reason: custom.reason || null,
                    updatedAt: custom.updatedAt || null,
                    customAmount: custom.customAmount,
                    customQuantity: custom.customQuantity,
                    defaultAmount: custom.defaultAmount || defaultAmount,
                    defaultQuantity: custom.defaultQuantity || defaultQuantity,
                    itemName: custom.itemName || itemName || itemId
                };
            }
        }

        return {
            amount: defaultAmount || 0,
            quantity: defaultQuantity || 1,
            paymentOption: defaultPaymentOption || 'either',
            unitPrice: defaultUnitPrice || (defaultAmount / (defaultQuantity || 1)),
            isCustomized: false,
            reason: null,
            updatedAt: null,
            customAmount: null,
            customQuantity: null,
            defaultAmount: defaultAmount || 0,
            defaultQuantity: defaultQuantity || 1,
            itemName: itemName || itemId
        };
    }

    // ==================== HELPER: CHECK IF ITEM IS REMOVED ====================
    function isItemRemoved(student, itemId) {
        if (!student || !student.removedItems) return false;
        return student.removedItems[itemId] && student.removedItems[itemId].isActive !== false;
    }

    // ==================== HELPER: CHECK IF ITEM IS REMOVED FOR A SPECIFIC PERIOD ====================
    // An item removed during a given academic year/term stays hidden from that period
    // and every period after it, but remains visible (with its payment history) in
    // periods that came BEFORE the removal was made.
    function isItemRemovedForPeriod(student, itemId, periodYear, periodTerm) {
        if (!student || !student.removedItems) return false;
        const removed = student.removedItems[itemId];
        if (!removed || removed.isActive === false) return false;

        // Legacy removals with no period stamp: treat as always removed (old behavior)
        if (removed.academicYear === undefined || removed.academicYear === null) {
            return true;
        }

        const removedYear = parseInt(removed.academicYear);
        const removedTerm = parseInt(removed.term) || 1;
        const checkYear = parseInt(periodYear);
        const checkTerm = parseInt(periodTerm);

        if (checkYear > removedYear) return true;
        if (checkYear === removedYear && checkTerm >= removedTerm) return true;
        return false;
    }

    // ==================== HELPER: DEDUPLICATE HISTORIES ====================
    function deduplicateHistories(histories) {
        if (!histories || histories.length === 0) return [];
        const seen = new Set();
        const unique = [];
        for (let h = 0; h < histories.length; h++) {
            const history = histories[h];
            const key = `${history.date || ''}_${history.type || ''}_${history.amount || 0}_${history.itemsBrought || 0}_${history.receiptNumber || ''}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(history);
            }
        }
        return unique;
    }

    // ==================== INTERNAL HELPER FUNCTIONS ====================
    function formatMoney(amount) {
        const num = Math.round(amount || 0);
        return num.toLocaleString('en-US');
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function getTermName(term) {
        const names = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
        return names[term] || `Term ${term}`;
    }

    function closeModal() {
        const modal = document.querySelector('.fixed.inset-0');
        if (modal) {
            modal.classList.add('db-modal-closing');
            setTimeout(() => modal.remove(), 180);
        }
    }

    // ==================== OR LOGIC HELPER FOR ITEMS ====================
    function calculateItemRemaining(item, cashPaid, itemsBrought) {
        const { quantity, totalAmount, unitPrice, paymentOption } = item;

        if (paymentOption === 'cash_only') {
            const remainingCash = Math.max(0, totalAmount - cashPaid);
            return { remainingCash, remainingItems: 0, isFullyPaid: remainingCash === 0 };
        }

        if (paymentOption === 'item_only') {
            const remainingItems = Math.max(0, quantity - itemsBrought);
            return { remainingCash: 0, remainingItems, isFullyPaid: remainingItems === 0 };
        }

        // EITHER (OR Logic)
        const itemsBroughtCapped = Math.min(itemsBrought, quantity);
        const cashValueOfItems = itemsBroughtCapped * unitPrice;
        const remainingCash = Math.max(0, totalAmount - cashPaid - cashValueOfItems);
        const itemsCoveredByCash = unitPrice > 0 ? Math.floor(cashPaid / unitPrice) : 0;
        const remainingItems = Math.max(0, quantity - itemsBroughtCapped - itemsCoveredByCash);
        const totalValueCovered = cashPaid + (itemsBroughtCapped * unitPrice);
        const totalRequired = quantity * unitPrice;
        const isFullyPaid = totalValueCovered >= totalRequired;

        return { remainingCash, remainingItems, isFullyPaid };
    }

    // ==================== RENDER PERSONAL INFO CARD ====================
    function renderPersonalInfoCard(student) {
        return `
            <div class="db-card overflow-hidden transition-all duration-300 hover:shadow-lg">
                <div class="db-card-hd px-4 py-3 flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center flex-shrink-0">
                        <i class="fas fa-user-circle text-sm"></i>
                    </div>
                    <h4 class="font-display font-bold text-slate-800">Personal Information</h4>
                </div>
                <div class="p-4">
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">First Name</span><br><span class="font-medium text-slate-700">${escapeHtml(student.firstName || 'N/A')}</span></div>
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Last Name</span><br><span class="font-medium text-slate-700">${escapeHtml(student.lastName || 'N/A')}</span></div>
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Gender</span><br><span class="font-medium text-slate-700">${student.gender || 'N/A'}</span></div>
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Date of Birth</span><br><span class="font-medium text-slate-700">${student.dateOfBirth ? new Date(student.dateOfBirth).toLocaleDateString() : 'N/A'}</span></div>
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Place of Birth</span><br><span class="font-medium text-slate-700">${student.birthPlace || 'N/A'}</span></div>
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Nationality</span><br><span class="font-medium text-slate-700">${student.nationality || 'Ugandan'}</span></div>
                    </div>
                </div>
            </div>
        `;
    }

    // ==================== RENDER PARENT INFO CARD ====================
    function renderParentInfoCard(student) {
        return `
            <div class="db-card overflow-hidden transition-all duration-300 hover:shadow-lg">
                <div class="db-card-hd px-4 py-3 flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                        <i class="fas fa-users text-sm"></i>
                    </div>
                    <h4 class="font-display font-bold text-slate-800">Parent/Guardian Information</h4>
                </div>
                <div class="p-4">
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Full Name</span><br><span class="font-medium text-slate-700">${escapeHtml(student.parentInfo?.name || 'N/A')}</span></div>
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Relationship</span><br><span class="font-medium text-slate-700">${student.parentInfo?.relationship || 'Parent'}</span></div>
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Phone</span><br><span class="font-medium text-slate-700">${student.parentInfo?.phone || 'N/A'}</span></div>
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Alt Phone</span><br><span class="font-medium text-slate-700">${student.parentInfo?.altPhone || 'N/A'}</span></div>
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Email</span><br><span class="font-medium text-slate-700">${student.parentInfo?.email || 'N/A'}</span></div>
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Occupation</span><br><span class="font-medium text-slate-700">${student.parentInfo?.occupation || 'N/A'}</span></div>
                    </div>
                    <div class="mt-3 pt-3 border-t border-slate-100"><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Address</span><br><span class="font-medium text-slate-700">${student.address || 'N/A'}</span></div>
                </div>
            </div>
        `;
    }

    // ==================== RENDER ACADEMIC INFO CARD ====================
    function renderAcademicInfoCard(student, currentClass, classLevel) {
        return `
            <div class="db-card overflow-hidden transition-all duration-300 hover:shadow-lg">
                <div class="db-card-hd px-4 py-3 flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                        <i class="fas fa-graduation-cap text-sm"></i>
                    </div>
                    <h4 class="font-display font-bold text-slate-800">Academic Information</h4>
                </div>
                <div class="p-4">
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Current Class</span><br><span class="font-medium text-slate-700">${currentClass}</span></div>
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Class Level</span><br><span class="font-medium text-slate-700">${classLevel === 'Nursery' ? 'Nursery' : classLevel === 'LowerPrimary' ? 'Lower Primary' : classLevel === 'UpperPrimary' ? 'Upper Primary' : 'N/A'}</span></div>
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Previous School</span><br><span class="font-medium text-slate-700">${student.previousSchool || 'N/A'}</span></div>
                        <div><span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Admission Type</span><br><span class="font-medium text-slate-700">${student.admissionType || 'New'}</span></div>
                    </div>
                </div>
            </div>
        `;
    }

    // ==================== RENDER PAYMENT HISTORY ====================
    function renderPaymentHistoryForPeriod(payments, periodLabel, feeStructure) {
        const sortedPayments = [...payments].sort((a, b) => new Date(b.date) - new Date(a.date));

        const expectedQuantities = new Map();
        if (feeStructure && feeStructure.activityComponents) {
            for (const component of feeStructure.activityComponents) {
                if (component.items) {
                    for (const item of component.items) {
                        const key = `${component.name}_${item.name}`;
                        expectedQuantities.set(key, item.quantity || 1);
                        if (!expectedQuantities.has(item.name)) {
                            expectedQuantities.set(item.name, item.quantity || 1);
                        }
                    }
                }
            }
        }

        if (sortedPayments.length === 0) {
            return `
                <div class="text-center py-6 text-slate-400 text-sm">
                    <i class="fas fa-receipt text-2xl text-slate-300 mb-2 block"></i> No payments for ${periodLabel}
                </div>
            `;
        }

        return `
            <div class="space-y-2 max-h-60 overflow-y-auto db-scroll pr-1">
                ${sortedPayments.map(p => {
                    const methodIcon = p.method === 'cash' ? '💵' :
                                      p.method === 'bank' ? '🏦' :
                                      p.method === 'mobile' ? '📱' : '🏫';
                    const methodClass = p.method === 'cash' ? 'bg-emerald-50 text-emerald-700' :
                                       p.method === 'bank' ? 'bg-sky-50 text-sky-700' :
                                       p.method === 'mobile' ? 'bg-indigo-50 text-indigo-700' : 'bg-orange-50 text-orange-700';

                    let totalCashAmount = p.tuitionPaid || 0;

                    const uniqueItems = new Map();

                    function addItemToMap(item, periodType) {
                        const itemName = item.itemName || item.name || 'Unknown';
                        const componentName = item.componentName || '';
                        const key = `${itemName}_${componentName}_${periodType || 'termly'}`;

                        if (!uniqueItems.has(key)) {
                            const expectedQty = expectedQuantities.get(key) ||
                                               expectedQuantities.get(itemName) ||
                                               (item.quantityRequired || 1);

                            uniqueItems.set(key, {
                                name: itemName,
                                componentName: componentName,
                                periodType: periodType || 'termly',
                                qty: 0,
                                amount: 0,
                                type: item.paymentType || 'unknown',
                                expectedQty: expectedQty,
                                originalQty: item.itemsBrought || 0,
                                originalAmount: item.amountPaid || item.cashEquivalent || 0,
                                receiptNumber: p.receiptNumber,
                                paymentId: p.id
                            });
                        }

                        const existing = uniqueItems.get(key);

                        if (item.paymentType === 'paid_cash') {
                            const amount = item.amountPaid || item.cashEquivalent || 0;
                            if (amount > existing.amount) {
                                existing.amount = amount;
                            }
                            existing.type = 'paid_cash';
                        } else if (item.paymentType === 'brought_item') {
                            const qty = item.itemsBrought || 0;
                            const cappedQty = Math.min(qty, existing.expectedQty);
                            if (cappedQty > existing.qty) {
                                existing.qty = cappedQty;
                            }
                            existing.type = 'brought_item';
                        }
                    }

                    if (p.activityItemPayments) {
                        for (const item of p.activityItemPayments) {
                            addItemToMap(item, item.periodType || 'termly');
                        }
                    }

                    if (p.paymentsByPeriodType) {
                        for (const period of ['one_time', 'termly', 'yearly']) {
                            const periodItems = p.paymentsByPeriodType[period] || [];
                            for (const item of periodItems) {
                                addItemToMap(item, period);
                            }
                        }
                    }

                    const itemsBreakdown = Array.from(uniqueItems.values());
                    let totalItemsBrought = 0;
                    let totalCashItems = 0;

                    const cashItems = itemsBreakdown.filter(i => i.type === 'paid_cash' && i.amount > 0);
                    const broughtItems = itemsBreakdown.filter(i => i.type === 'brought_item' && i.qty > 0);

                    for (const item of broughtItems) {
                        totalItemsBrought += item.qty;
                    }
                    for (const item of cashItems) {
                        totalCashAmount += item.amount;
                        totalCashItems++;
                    }

                    let itemsDisplay = '';
                    if (cashItems.length > 0 || broughtItems.length > 0) {
                        let displayParts = [];

                        if (cashItems.length > 0) {
                            displayParts.push(`
                                <div class="mt-1.5 pt-1.5 border-t border-slate-100 text-[10px]">
                                    <div class="font-semibold text-emerald-600 mb-1">💵 Cash Payments</div>
                                    ${cashItems.map(item => {
                                        const periodIcon = item.periodType === 'one_time' ? '⭐' :
                                                         item.periodType === 'yearly' ? '📆' : '📅';
                                        return `
                                            <div class="flex justify-between items-center py-0.5 border-b border-slate-50 last:border-0">
                                                <span>${periodIcon} ${escapeHtml(item.name)}</span>
                                                <span class="font-semibold text-emerald-600 font-mono-num">💵 UGX ${formatMoney(item.amount)}</span>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            `);
                        }

                        if (broughtItems.length > 0) {
                            displayParts.push(`
                                <div class="mt-1.5 pt-1.5 border-t border-slate-100 text-[10px]">
                                    <div class="font-semibold text-sky-600 mb-1">📦 Items Brought</div>
                                    ${broughtItems.map(item => {
                                        const periodIcon = item.periodType === 'one_time' ? '⭐' :
                                                         item.periodType === 'yearly' ? '📆' : '📅';
                                        const displayQty = item.qty;
                                        const expectedQty = item.expectedQty || displayQty;
                                        const isFullyPaid = displayQty >= expectedQty;
                                        const statusText = isFullyPaid ? ' ✅' : '';

                                        return `
                                            <div class="flex justify-between items-center py-0.5 border-b border-slate-50 last:border-0">
                                                <span>${periodIcon} ${escapeHtml(item.name)}</span>
                                                <span class="font-semibold text-sky-600 font-mono-num">📦 ${displayQty} item(s)${statusText}</span>
                                                <span class="text-[9px] text-slate-400">(expected: ${expectedQty})</span>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            `);
                        }

                        itemsDisplay = displayParts.join('');
                    }

                    return `
                        <div class="db-card p-2.5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer text-xs"
                             onclick="printPaymentReceipt('${p.receiptNumber}')">
                            <div class="flex justify-between items-center">
                                <div class="flex-1">
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <span class="text-slate-500">${new Date(p.date).toLocaleDateString()}</span>
                                        <span class="text-slate-400 text-[10px]">${new Date(p.date).toLocaleTimeString()}</span>
                                        <span class="font-mono-num font-semibold text-indigo-600">${p.receiptNumber || 'N/A'}</span>
                                        <span class="db-badge ${methodClass}">
                                            ${methodIcon} ${(p.method || 'cash').toUpperCase()}
                                        </span>
                                        ${p.isPreviousBalancePayment ? '<span class="text-[10px] text-amber-500 font-semibold">📋 Previous</span>' : ''}
                                    </div>
                                    <div class="flex gap-3 mt-1 text-[10px] text-slate-500">
                                        ${p.tuitionPaid > 0 ? `<span>💰 Tuition: UGX ${formatMoney(p.tuitionPaid)}</span>` : ''}
                                        ${totalCashItems > 0 ? `<span>💵 Cash Items: ${totalCashItems}</span>` : ''}
                                        ${totalItemsBrought > 0 ? `<span>📦 ${totalItemsBrought} item(s) brought</span>` : ''}
                                    </div>
                                    ${itemsDisplay}
                                </div>
                                <div class="text-right ml-2 flex-shrink-0">
                                    <p class="font-bold text-emerald-600 text-sm font-mono-num">UGX ${formatMoney(totalCashAmount)}</p>
                                    ${totalItemsBrought > 0 ? `<p class="text-[10px] text-sky-500">+ ${totalItemsBrought} items</p>` : ''}
                                    <p class="text-[10px] text-indigo-400 hover:text-indigo-600 transition-colors">
                                        <i class="fas fa-print"></i>
                                    </p>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    // ==================== RENDER FEE SUMMARY FOR PERIOD (FIXED – only scholastic items counted) ====================
    function renderFeeSummaryForPeriod(periodData, periodLabel, removedCount) {
        const tuition = periodData.tuition || {};
        const activity = periodData.activity || {};
        const totals = periodData.totals || {};

        const tuitionExpected = tuition.expected || 0;
        const tuitionPaid = tuition.paid || 0;
        const tuitionBalance = tuition.balance || (tuitionExpected - tuitionPaid);

        const cashExpected = activity.cashExpected || 0;
        const cashPaid = activity.cashPaid || 0;
        const cashBalance = activity.cashBalance || (cashExpected - cashPaid);

        let itemsRequired = 0;
        let itemsBrought = 0;
        let itemsRemaining = 0;

        const statusGroups = periodData.statusGroups || {};
        for (const groupName of Object.keys(statusGroups)) {
            const group = statusGroups[groupName];
            if (!group || !group.items) continue;

            // Only count items from "Scholastic" groups
            const isScholastic = groupName.toLowerCase().includes('scholastic');
            if (!isScholastic) continue;

            for (const item of (group.items || [])) {
                if (item.isRemoved) continue;
                const paymentOption = item.paymentOption || 'either';
                const qty = item.quantity || 1;
                const brought = item.itemsBrought || 0;
                const cashPaidForItem = item.cashPaid || 0;
                const unitPrice = item.unitPrice || 0;
                const totalAmount = item.totalAmount || 0;

                if (paymentOption === 'cash_only') {
                    // No items involved
                    continue;
                } else if (paymentOption === 'item_only') {
                    itemsRequired += qty;
                    itemsBrought += Math.min(brought, qty);
                    itemsRemaining += Math.max(0, qty - Math.min(brought, qty));
                } else {
                    // Either: OR logic
                    itemsRequired += qty;
                    itemsBrought += Math.min(brought, qty);
                    const itemsCoveredByCash = unitPrice > 0 ? Math.floor(cashPaidForItem / unitPrice) : 0;
                    const totalCovered = Math.min(brought, qty) + itemsCoveredByCash;
                    itemsRemaining += Math.max(0, qty - totalCovered);
                }
            }
        }

        const totalExpected = tuitionExpected + cashExpected;
        const totalPaid = tuitionPaid + cashPaid;
        const totalBalance = totalExpected - totalPaid;

        const collectionRate = totalExpected > 0 ? ((totalPaid / totalExpected) * 100).toFixed(1) : 0;
        const rateColor = collectionRate >= 80 ? 'text-emerald-600' : collectionRate >= 50 ? 'text-amber-600' : 'text-rose-600';
        const rateBar = collectionRate >= 80 ? 'bg-emerald-500' : collectionRate >= 50 ? 'bg-amber-500' : 'bg-rose-500';
        const balanceColor = totalBalance > 0 ? 'text-rose-600' : totalBalance < 0 ? 'text-sky-600' : 'text-emerald-600';

        const appliedBursary = periodData.appliedBursary || null;
        const discountDisplay = periodData.discountDisplay || '';

        const hasBalance = totalBalance > 0 || itemsRemaining > 0;

        return `
            <div class="db-card p-4 bg-gradient-to-br from-slate-50 to-white">
                <div class="flex justify-between items-start mb-3 flex-wrap gap-2">
                    <div>
                        <h4 class="font-display font-bold text-lg flex items-center gap-2"><i class="fas fa-chart-simple text-indigo-500 text-base"></i> Fee Summary</h4>
                        <p class="text-xs text-slate-400">${periodLabel}</p>
                        <div class="flex flex-wrap gap-1.5 mt-1.5">
                            ${removedCount > 0 ? `<span class="db-badge bg-rose-50 text-rose-700">❌ ${removedCount} item(s) removed</span>` : ''}
                            ${hasBalance ? `<span class="db-badge bg-amber-50 text-amber-700">⚠️ Balance Due: UGX ${formatMoney(totalBalance)}</span>` : ''}
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="text-sm font-bold font-mono-num ${balanceColor}">
                            ${totalBalance > 0 ? `Outstanding: UGX ${formatMoney(totalBalance)}` :
                              totalBalance < 0 ? `Credit: UGX ${formatMoney(Math.abs(totalBalance))}` :
                              '✓ Fully Paid'}
                        </div>
                        <div class="text-xs text-slate-400">Collection Rate: <span class="${rateColor} font-semibold">${collectionRate}%</span></div>
                        ${itemsRemaining > 0 ? `<div class="text-xs text-orange-500 font-medium">📦 ${itemsRemaining} items remaining</div>` : ''}
                        ${itemsBrought > 0 ? `<div class="text-xs text-sky-500 font-medium">📦 ${itemsBrought} items brought</div>` : ''}
                    </div>
                </div>

                ${appliedBursary ? `
                    <div class="mb-3 p-2.5 bg-amber-50 rounded-xl text-sm border border-amber-100">
                        <span class="font-semibold">🎖️ Bursary:</span> ${appliedBursary.name} ${discountDisplay ? `(${discountDisplay})` : ''}
                    </div>
                ` : ''}

                <div class="grid grid-cols-2 gap-3 mb-3">
                    <div class="bg-sky-50 rounded-xl p-3 text-center transition-transform duration-200 hover:scale-[1.02]">
                        <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">💰 Tuition</p>
                        <p class="text-lg font-bold font-mono-num text-sky-600">UGX ${formatMoney(tuitionExpected)}</p>
                        <p class="text-xs text-emerald-600 font-medium">Paid: UGX ${formatMoney(tuitionPaid)}</p>
                        <p class="text-xs font-medium ${tuitionBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}">Balance: UGX ${formatMoney(Math.abs(tuitionBalance))}</p>
                    </div>
                    <div class="bg-indigo-50 rounded-xl p-3 text-center transition-transform duration-200 hover:scale-[1.02]">
                        <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">📦 Activity Items</p>
                        <p class="text-lg font-bold font-mono-num text-indigo-600">Cash Expected: UGX ${formatMoney(cashExpected)}</p>
                        <p class="text-xs text-emerald-600 font-medium">Cash Paid: UGX ${formatMoney(cashPaid)}</p>
                        <p class="text-xs font-medium ${cashBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}">Cash Balance: UGX ${formatMoney(Math.abs(cashBalance))}</p>
                        ${itemsRequired > 0 ? `<p class="text-xs text-orange-600 font-medium">📦 Items: ${itemsBrought}/${itemsRequired} (${itemsRemaining} remaining)</p>` : ''}
                        ${removedCount > 0 ? `<p class="text-xs text-rose-500 mt-1">❌ ${removedCount} item(s) removed (not charged)</p>` : ''}
                    </div>
                </div>

                <div class="bg-slate-50 rounded-xl p-3.5 border border-slate-100">
                    <div class="flex justify-between items-center mb-1.5">
                        <span class="font-semibold text-slate-600">Total Expected:</span>
                        <span class="font-bold font-mono-num text-slate-800">UGX ${formatMoney(totalExpected)}</span>
                    </div>
                    <div class="flex justify-between items-center mb-1.5">
                        <span class="font-semibold text-slate-600">Total Paid (Cash):</span>
                        <span class="font-bold font-mono-num text-emerald-600">UGX ${formatMoney(totalPaid)}</span>
                    </div>
                    ${itemsBrought > 0 ? `
                        <div class="flex justify-between items-center mb-1.5 text-sm text-sky-600">
                            <span class="font-semibold">📦 Items Brought:</span>
                            <span class="font-bold">${itemsBrought} item(s) (not counted as cash)</span>
                        </div>
                    ` : ''}
                    <div class="flex justify-between items-center pt-2 border-t border-slate-200">
                        <span class="font-semibold text-slate-700">Outstanding Balance:</span>
                        <span class="font-bold font-mono-num ${balanceColor}">
                            ${totalBalance > 0 ? `UGX ${formatMoney(totalBalance)}` :
                              totalBalance < 0 ? `Credit: UGX ${formatMoney(Math.abs(totalBalance))}` :
                              'Fully Paid'}
                        </span>
                    </div>
                    <div class="mt-3">
                        <div class="flex justify-between text-xs mb-1">
                            <span class="text-slate-500">Collection Rate</span>
                            <span class="font-semibold ${rateColor}">${collectionRate}%</span>
                        </div>
                        <div class="db-progress-track h-1.5">
                            <div class="db-progress-fill ${rateBar} h-1.5 transition-all duration-500" style="width: ${Math.min(100, collectionRate)}%"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ==================== RENDER STATUS GROUP TABLE FOR PERIOD ====================
    function renderStatusGroupTableForPeriod(group, periodItems, student, periodYear, periodTerm, searchTerm) {
        if (!group.items || group.items.length === 0) return '';

        let filteredItems = group.items;
        if (searchTerm && searchTerm.trim() !== '') {
            const term = searchTerm.toLowerCase().trim();
            filteredItems = group.items.filter(item =>
                item.name.toLowerCase().includes(term) ||
                (item.id && item.id.toLowerCase().includes(term)) ||
                (group.componentName && group.componentName.toLowerCase().includes(term))
            );
        }

        const processedItems = [];
        let groupTotalExpected = 0;
        let groupCashPaid = 0;
        let groupItemsBrought = 0;
        let removedItemsSkipped = 0;
        let visibleItemsCount = 0;

        for (const item of filteredItems) {
            const itemId = item.id || item.name;

            if (isItemRemovedForPeriod(student, itemId, periodYear, periodTerm)) {
                removedItemsSkipped++;
                continue;
            }

            visibleItemsCount++;

            const itemPeriodType = item.periodType || 'termly';

            let periodBadge = '';
            let periodIcon = '';
            let periodColor = '';
            let periodDescription = '';

            if (itemPeriodType === 'one_time') {
                periodBadge = 'One-Time';
                periodIcon = '⭐';
                periodColor = 'bg-purple-50 text-purple-700';
                periodDescription = '⭐ One-Time: Follows student FOREVER until fully paid';
            } else if (itemPeriodType === 'yearly') {
                periodBadge = 'Yearly';
                periodIcon = '📆';
                periodColor = 'bg-orange-50 text-orange-700';
                periodDescription = '📆 Yearly: Resets each academic year';
            } else {
                periodBadge = 'Termly';
                periodIcon = '📅';
                periodColor = 'bg-emerald-50 text-emerald-700';
                periodDescription = '📅 Termly: Each term is independent';
            }

            const defaultAmount = item.totalAmount || 0;
            const defaultQuantity = item.quantity || 1;
            const defaultUnitPrice = item.unitPrice || (defaultAmount / defaultQuantity);
            const defaultPaymentOption = item.paymentOption || 'either';

            const customValues = getCustomizedItemValue(
                student,
                itemId,
                item.name,
                defaultAmount,
                defaultQuantity,
                defaultPaymentOption,
                defaultUnitPrice
            );

            const isCustomized = customValues.isCustomized;
            const effectiveAmount = customValues.amount;
            const effectiveQuantity = customValues.quantity;
            const effectiveUnitPrice = customValues.unitPrice;
            const effectivePaymentOption = customValues.paymentOption;

            const periodPayments = periodItems.payments || [];
            let cashPaid = 0;
            let itemsBrought = 0;
            const histories = [];
            const processedKeys = new Set();

            for (const payment of periodPayments) {
                if (payment.activityItemPayments) {
                    for (const paidItem of payment.activityItemPayments) {
                        if (paidItem.itemName === item.name &&
                            paidItem.componentName === group.componentName) {
                            const key = `${payment.id}_${paidItem.itemName}_${paidItem.componentName}`;
                            if (processedKeys.has(key)) continue;
                            processedKeys.add(key);

                            if (paidItem.paymentType === 'paid_cash') {
                                const amount = paidItem.amountPaid || 0;
                                cashPaid += amount;
                                histories.push({
                                    date: payment.date,
                                    receiptNumber: payment.receiptNumber,
                                    amount: amount,
                                    type: 'cash',
                                    method: payment.method,
                                    time: new Date(payment.date).toLocaleTimeString(),
                                    paymentId: payment.id
                                });
                            } else if (paidItem.paymentType === 'brought_item') {
                                const qty = paidItem.itemsBrought || 0;
                                itemsBrought += qty;
                                histories.push({
                                    date: payment.date,
                                    receiptNumber: payment.receiptNumber,
                                    quantity: qty,
                                    type: 'item',
                                    method: payment.method,
                                    time: new Date(payment.date).toLocaleTimeString(),
                                    paymentId: payment.id
                                });
                            }
                        }
                    }
                }

                if (payment.paymentsByPeriodType) {
                    for (const period of ['one_time', 'termly', 'yearly']) {
                        const periodItemsList = payment.paymentsByPeriodType[period] || [];
                        for (const paidItem of periodItemsList) {
                            if (paidItem.itemName === item.name &&
                                paidItem.componentName === group.componentName) {
                                const key = `${payment.id}_${paidItem.itemName}_${paidItem.componentName}`;
                                if (processedKeys.has(key)) continue;
                                processedKeys.add(key);

                                if (paidItem.paymentType === 'paid_cash') {
                                    const amount = paidItem.amountPaid || 0;
                                    cashPaid += amount;
                                    histories.push({
                                        date: payment.date,
                                        receiptNumber: payment.receiptNumber,
                                        amount: amount,
                                        type: 'cash',
                                        method: payment.method,
                                        time: new Date(payment.date).toLocaleTimeString(),
                                        paymentId: payment.id
                                    });
                                } else if (paidItem.paymentType === 'brought_item') {
                                    const qty = paidItem.itemsBrought || 0;
                                    itemsBrought += qty;
                                    histories.push({
                                        date: payment.date,
                                        receiptNumber: payment.receiptNumber,
                                        quantity: qty,
                                        type: 'item',
                                        method: payment.method,
                                        time: new Date(payment.date).toLocaleTimeString(),
                                        paymentId: payment.id
                                    });
                                }
                            }
                        }
                    }
                }
            }

            const finalItemsBrought = Math.min(itemsBrought, effectiveQuantity);

            // ========== CORRECT REMAINING CALCULATION WITH OR LOGIC ==========
            let remainingCash = 0;
            let remainingItems = 0;
            let isFullyPaid = false;
            let isItemOnlyPaid = false;
            let isCashOnlyPaid = false;

            if (effectivePaymentOption === 'cash_only') {
                remainingCash = Math.max(0, effectiveAmount - cashPaid);
                isFullyPaid = remainingCash <= 0;
                remainingItems = 0;
                if (isFullyPaid) isCashOnlyPaid = true;
            } else if (effectivePaymentOption === 'item_only') {
                remainingItems = Math.max(0, effectiveQuantity - finalItemsBrought);
                isFullyPaid = remainingItems <= 0;
                remainingCash = 0;
                if (isFullyPaid) isItemOnlyPaid = true;
            } else {
                // OR Logic: Cash OR Items (either can cover the requirement)
                const cashCoversFull = cashPaid >= effectiveAmount;
                const itemsCoversFull = finalItemsBrought >= effectiveQuantity;

                if (cashCoversFull) {
                    isFullyPaid = true;
                    isCashOnlyPaid = true;
                    remainingCash = 0;
                    remainingItems = 0;
                } else if (itemsCoversFull) {
                    isFullyPaid = true;
                    isItemOnlyPaid = true;
                    remainingCash = 0;
                    remainingItems = 0;
                } else {
                    const cashCoversItems = Math.floor(cashPaid / effectiveUnitPrice);
                    const totalCovered = Math.max(finalItemsBrought, cashCoversItems);
                    const totalItemsCovered = Math.min(totalCovered, effectiveQuantity);
                    const remainingQty = Math.max(0, effectiveQuantity - totalItemsCovered);
                    const remainingAmt = remainingQty * effectiveUnitPrice;

                    remainingCash = remainingAmt;
                    remainingItems = remainingQty;

                    const totalValueCovered = cashPaid + (finalItemsBrought * effectiveUnitPrice);
                    const totalRequired = effectiveQuantity * effectiveUnitPrice;
                    if (totalValueCovered >= totalRequired) {
                        isFullyPaid = true;
                        remainingCash = 0;
                        remainingItems = 0;
                    }
                }
            }

            groupTotalExpected += effectiveAmount;
            groupCashPaid += cashPaid;
            groupItemsBrought += finalItemsBrought;

            let paidValue = '';
            if (cashPaid > 0 && finalItemsBrought > 0) {
                paidValue = `💵 UGX ${formatMoney(cashPaid)} + 📦 ${finalItemsBrought} items`;
            } else if (cashPaid > 0) {
                paidValue = `💵 UGX ${formatMoney(cashPaid)}`;
            } else if (finalItemsBrought > 0) {
                paidValue = `📦 ${finalItemsBrought} items`;
            } else {
                paidValue = '___';
            }

            let paymentMadeHtml = '';
            if (cashPaid > 0 && finalItemsBrought > 0) {
                paymentMadeHtml = `💵 UGX ${formatMoney(cashPaid)} + 📦 ${finalItemsBrought} items`;
            } else if (cashPaid > 0) {
                paymentMadeHtml = `💵 UGX ${formatMoney(cashPaid)}`;
            } else if (finalItemsBrought > 0) {
                paymentMadeHtml = `📦 ${finalItemsBrought} items`;
            } else {
                paymentMadeHtml = '___';
            }

            let remainingDisplay = '';
            if (isFullyPaid) {
                if (isItemOnlyPaid) {
                    remainingDisplay = '✓ Paid (Items Delivered)';
                } else if (isCashOnlyPaid) {
                    remainingDisplay = '✓ Paid (Cash)';
                } else {
                    remainingDisplay = '✓ Paid';
                }
            } else if (effectivePaymentOption === 'cash_only') {
                remainingDisplay = `UGX ${formatMoney(remainingCash)}`;
            } else if (effectivePaymentOption === 'item_only') {
                remainingDisplay = `${remainingItems} items`;
            } else {
                if (remainingCash > 0 && remainingItems > 0) {
                    remainingDisplay = `${remainingItems} item(s) <span class="text-orange-500 font-bold">OR</span> UGX ${formatMoney(remainingCash)}`;
                } else if (remainingItems > 0) {
                    remainingDisplay = `${remainingItems} item(s)`;
                } else if (remainingCash > 0) {
                    remainingDisplay = `UGX ${formatMoney(remainingCash)}`;
                } else {
                    remainingDisplay = '✓ Paid';
                }
            }

            let optionBadge = '';
            if (effectivePaymentOption === 'cash_only') {
                optionBadge = '<span class="db-badge bg-sky-50 text-sky-700">💵 Cash Only</span>';
            } else if (effectivePaymentOption === 'item_only') {
                optionBadge = '<span class="db-badge bg-emerald-50 text-emerald-700">📦 Item Only</span>';
            } else {
                optionBadge = '<span class="db-badge bg-indigo-50 text-indigo-700">🔄 Cash or Item</span>';
            }

            let periodBadgeHtml = `<span class="db-badge ${periodColor}">${periodIcon} ${periodBadge}</span>`;

            let customizationBadge = '';
            let customizationDisplay = '';
            if (isCustomized) {
                const displayName = customValues.itemName || item.name || itemId;

                customizationBadge = `
                    <span class="db-badge bg-orange-50 text-orange-700 inline-flex items-center gap-1">
                        <i class="fas fa-sliders-h"></i> Custom
                    </span>
                `;

                const amountChanged = defaultAmount !== effectiveAmount;
                const qtyChanged = defaultQuantity !== effectiveQuantity;
                const changes = [];
                if (amountChanged) changes.push(`UGX ${formatMoney(defaultAmount)} → UGX ${formatMoney(effectiveAmount)}`);
                if (qtyChanged) changes.push(`Qty: ${defaultQuantity} → ${effectiveQuantity}`);

                customizationDisplay = `
                    <div class="mt-1.5 text-xs text-orange-600 bg-orange-50 p-1.5 rounded-lg border border-orange-100">
                        <i class="fas fa-edit mr-1"></i>
                        <span class="font-medium">Customized:</span>
                        ${changes.length > 0 ? changes.join(' | ') : 'Custom values applied'}
                        ${customValues.reason ? `<br><span class="text-slate-500">📝 ${escapeHtml(customValues.reason)}</span>` : ''}
                    </div>
                `;
            }

            let statusBadge = '';
            if (isFullyPaid) {
                statusBadge = '<span class="db-badge bg-emerald-50 text-emerald-700">✅ Fully Paid</span>';
            } else if (cashPaid > 0 || finalItemsBrought > 0) {
                statusBadge = '<span class="db-badge bg-amber-50 text-amber-700">⚠️ Partial</span>';
            } else {
                statusBadge = '<span class="db-badge bg-rose-50 text-rose-700">❌ Unpaid</span>';
            }

            // ========== BUILD PAYMENT HISTORY TOOLTIP ==========
            const uniqueHistories = deduplicateHistories(histories);
            let historyTooltipHtml = '';
            if (uniqueHistories.length > 0) {
                const historyRows = uniqueHistories.map(h => {
                    const date = new Date(h.date).toLocaleDateString();
                    const time = h.time || new Date(h.date).toLocaleTimeString();
                    let displayText = '', amountDisplay = '';
                    if (h.type === 'cash') {
                        displayText = '💵 Cash';
                        amountDisplay = `UGX ${formatMoney(h.amount)}`;
                    } else if (h.type === 'item') {
                        displayText = '📦 Items';
                        amountDisplay = `${h.quantity || 0} item(s)`;
                    }
                    const receipt = h.receiptNumber ? `#${h.receiptNumber}` : '';
                    const method = h.method && h.method !== 'cash' ? ` (${h.method.toUpperCase()})` : '';
                    return `
                        <div class="flex justify-between items-center border-b border-slate-100 last:border-0 py-1.5 text-xs">
                            <span class="text-slate-500">${date} ${time}</span>
                            <span class="font-medium">${displayText}</span>
                            ${method}
                            <span class="font-semibold text-emerald-600 font-mono-num">${amountDisplay}</span>
                            <span class="font-mono-num text-indigo-500 text-[10px]">${receipt}</span>
                        </div>
                    `;
                }).join('');

                historyTooltipHtml = `
                    <div class="history-tooltip hidden absolute left-0 top-full mt-1.5 z-50 bg-white border border-slate-200 rounded-xl shadow-xl p-2.5 w-80 max-h-48 overflow-y-auto db-scroll db-fade-in">
                        <div class="text-xs font-bold text-slate-700 mb-1.5">Payment History (${uniqueHistories.length})</div>
                        ${historyRows}
                    </div>
                `;
            }

            // ========== BUILD THE ROW ==========
            const rowClass = isCustomized ? 'border-l-4 border-l-orange-400' : '';

            processedItems.push({
                html: `
                    <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors duration-150 ${rowClass}">
                        <td class="p-3">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="font-medium text-slate-700">📦 ${escapeHtml(item.name)}</span>
                                ${optionBadge}
                                ${periodBadgeHtml}
                                ${customizationBadge}
                                ${uniqueHistories.length > 0 ? `
                                    <span class="relative inline-block history-trigger ml-1 cursor-help" 
                                          style="display:inline-block;"
                                          onmouseenter="showHistoryTooltip(this)"
                                          onmouseleave="hideHistoryTooltip(this)">
                                        <i class="fas fa-clock-rotate-left text-indigo-400 hover:text-indigo-600 text-xs transition-colors"></i>
                                        <span class="text-xs text-slate-400">${uniqueHistories.length}</span>
                                        ${historyTooltipHtml}
                                    </span>
                                ` : ''}
                            </div>
                            <div class="text-xs text-slate-400 mt-0.5">${escapeHtml(group.componentName || group.name)}</div>
                            ${isCustomized ? `
                                <div class="text-xs text-slate-400 mt-0.5">
                                    Default: UGX ${formatMoney(defaultAmount)} ${defaultQuantity > 1 ? `| Qty: ${defaultQuantity}` : ''}
                                </div>
                            ` : ''}
                            <div class="text-xs text-slate-400 mt-0.5">${periodDescription}</div>
                            ${customizationDisplay}
                        </td>
                        <td class="p-3 text-center font-mono-num">
                            ${effectiveQuantity}
                            ${isCustomized && customValues.customQuantity !== null && customValues.customQuantity !== defaultQuantity ?
                                `<div class="text-xs text-orange-500">(was ${defaultQuantity})</div>` : ''}
                        </td>
                        <td class="p-3 text-center font-mono-num text-slate-600">UGX ${formatMoney(effectiveUnitPrice)}</td>
                        <td class="p-3 text-right font-mono-num">
                            UGX ${formatMoney(effectiveAmount)}
                            ${isCustomized && customValues.customAmount !== null && customValues.customAmount !== defaultAmount ?
                                `<div class="text-xs text-orange-500 line-through">UGX ${formatMoney(defaultAmount)}</div>` : ''}
                        </td>
                        <td class="p-3 text-center min-w-32">${paymentMadeHtml}</td>
                        <td class="p-3 text-right font-semibold font-mono-num">${paidValue}</td>
                        <td class="p-3 text-right font-semibold font-mono-num ${isFullyPaid ? 'text-emerald-600' : 'text-rose-600'}">
                            ${remainingDisplay}
                        </td>
                        <td class="p-3 text-center">${statusBadge}</td>
                    </tr>
                `,
                isCustomized: isCustomized,
                name: item.name,
                periodType: itemPeriodType,
                cashPaid: cashPaid,
                itemsBrought: finalItemsBrought,
                remainingCash: remainingCash,
                remainingItems: remainingItems,
                isFullyPaid: isFullyPaid,
                isItemOnlyPaid: isItemOnlyPaid,
                isCashOnlyPaid: isCashOnlyPaid,
                histories: uniqueHistories
            });
        }

        // ====================================================================
        // HANDLE NO VISIBLE ITEMS OR SEARCH RESULTS
        // ====================================================================
        if (visibleItemsCount === 0 && searchTerm && searchTerm.trim() !== '') {
            return `
                <div class="db-card overflow-hidden mb-3 bg-slate-50">
                    <div class="px-4 py-3 border-b border-slate-100 flex justify-between items-center">
                        <div class="flex items-center gap-2">
                            <i class="fas fa-magnifying-glass text-slate-400"></i>
                            <h4 class="font-bold text-md text-slate-500">No items match "${escapeHtml(searchTerm)}"</h4>
                        </div>
                    </div>
                </div>
            `;
        }

        if (processedItems.length === 0 && visibleItemsCount === 0) {
            return `
                <div class="db-card overflow-hidden mb-3 bg-slate-50">
                    <div class="px-4 py-3 border-b border-slate-100 flex justify-between items-center">
                        <div class="flex items-center gap-2">
                            <i class="fas fa-tag text-slate-400"></i>
                            <h4 class="font-bold text-md text-slate-500">🏷️ ${escapeHtml(group.name)}</h4>
                        </div>
                        <span class="text-xs text-slate-400">All items removed for this student</span>
                    </div>
                    <div class="p-4 text-center text-slate-500 text-sm">
                        <i class="fas fa-circle-info text-slate-300 text-xl mb-1.5 block"></i>
                        <p>All items in this group have been removed for this student</p>
                    </div>
                </div>
            `;
        }

        // ====================================================================
        // BUILD GROUP TOTALS AND FOOTER
        // ====================================================================
        const groupRate = groupTotalExpected > 0 ? (groupCashPaid / groupTotalExpected * 100).toFixed(1) : 0;
        const rateColor = groupRate >= 80 ? 'text-emerald-600' : groupRate >= 50 ? 'text-amber-600' : 'text-rose-600';

        let groupCashRemaining = 0;
        let groupItemsRemaining = 0;
        for (const item of processedItems) {
            groupCashRemaining += item.remainingCash || 0;
            groupItemsRemaining += item.remainingItems || 0;
        }

        let groupRemainingDisplay = '';
        if (groupCashRemaining > 0 && groupItemsRemaining > 0) {
            groupRemainingDisplay = `UGX ${formatMoney(groupCashRemaining)} <span class="text-orange-500 font-bold">OR</span> ${groupItemsRemaining} item(s)`;
        } else if (groupCashRemaining > 0) {
            groupRemainingDisplay = `UGX ${formatMoney(groupCashRemaining)}`;
        } else if (groupItemsRemaining > 0) {
            groupRemainingDisplay = `${groupItemsRemaining} item(s)`;
        } else {
            groupRemainingDisplay = '✓ Paid';
        }

        const periodBadges = [];
        const uniquePeriodTypes = new Set();
        for (const item of processedItems) {
            uniquePeriodTypes.add(item.periodType);
        }
        if (uniquePeriodTypes.has('one_time')) {
            periodBadges.push('<span class="db-badge bg-purple-50 text-purple-700">⭐ One-Time</span>');
        }
        if (uniquePeriodTypes.has('termly')) {
            periodBadges.push('<span class="db-badge bg-emerald-50 text-emerald-700">📅 Termly</span>');
        }
        if (uniquePeriodTypes.has('yearly')) {
            periodBadges.push('<span class="db-badge bg-orange-50 text-orange-700">📆 Yearly</span>');
        }

        let displayName = group.name;
        if (displayName === 'schoolastic requirement') displayName = 'Scholastic';
        if (displayName === 'Admission Fee') displayName = 'Admission';
        if (displayName === 'Tuition') displayName = 'Tuition';

        const hasCustomItems = processedItems.some(p => p.isCustomized);
        const customBadge = hasCustomItems ?
            `<span class="ml-2 db-badge bg-orange-50 text-orange-700">⚡ ${processedItems.filter(p => p.isCustomized).length} customized</span>` : '';

        const groupRemovedCount = group.items.length - processedItems.length;
        const removedBadge = groupRemovedCount > 0 ?
            `<span class="ml-2 db-badge bg-rose-50 text-rose-700">❌ ${groupRemovedCount} removed</span>` : '';

        let periodNote = '';
        if (uniquePeriodTypes.size === 1) {
            if (uniquePeriodTypes.has('one_time')) {
                periodNote = '⭐ One-Time: Charged once. Follows student FOREVER until fully paid.';
            } else if (uniquePeriodTypes.has('yearly')) {
                periodNote = '📆 Yearly: Charged once per year. Resets each academic year.';
            } else if (uniquePeriodTypes.has('termly')) {
                periodNote = '📅 Termly: Charged every term. Each term has its own balance.';
            }
        } else {
            periodNote = '🔄 Mixed period types in this group. Each item has its own period shown individually above.';
        }

        return `
            <div class="db-card overflow-hidden mb-3 transition-all duration-300 hover:shadow-md ${group.name === 'Transportation' ? 'border-l-4 border-l-orange-400' : ''}">
                <div class="bg-gradient-to-r from-slate-50 to-white px-4 py-3 border-b border-slate-100 flex justify-between items-center flex-wrap gap-2">
                    <div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <i class="fas fa-tag text-indigo-500"></i>
                            <h4 class="font-display font-bold text-md text-slate-800">🏷️ ${escapeHtml(displayName)}</h4>
                            ${customBadge}
                            ${removedBadge}
                            <div class="flex gap-1">${periodBadges.join(' ')}</div>
                        </div>
                        <p class="text-xs text-slate-400 mt-1">${periodNote}</p>
                        ${group.name === 'Transportation' && student.customTransportation ? `
                            <span class="db-badge bg-orange-50 text-orange-700 inline-flex items-center gap-1 mt-1">
                                <i class="fas fa-bus"></i> Custom: UGX ${formatMoney(student.customTransportation.amount || 0)}
                                ${student.customTransportation.hasTransportation === false ? '| ❌ Disabled' : ''}
                            </span>
                        ` : ''}
                        ${groupRemovedCount > 0 ? `<p class="text-xs text-rose-500 mt-1.5">❌ ${groupRemovedCount} item(s) removed (not charged)</p>` : ''}
                    </div>
                    <div class="text-right">
                        <p class="text-sm text-slate-500">Cash Paid: <span class="font-semibold text-emerald-600 font-mono-num">UGX ${formatMoney(groupCashPaid)}</span> / ${formatMoney(groupTotalExpected)}</p>
                        ${groupItemsBrought > 0 ? `<p class="text-xs text-sky-600 font-medium">📦 Items Brought: ${groupItemsBrought}</p>` : ''}
                        <p class="text-xs font-semibold ${rateColor}">${groupRate}% collected</p>
                        <p class="text-xs text-rose-500 font-medium">Remaining: ${groupRemainingDisplay}</p>
                    </div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead class="db-table">
                            <tr>
                                <th class="p-3 text-left">Item</th>
                                <th class="p-3 text-center">Qty</th>
                                <th class="p-3 text-center">Unit Price</th>
                                <th class="p-3 text-right">Total</th>
                                <th class="p-3 text-center min-w-40">Payment Made</th>
                                <th class="p-3 text-right">Paid</th>
                                <th class="p-3 text-right">Remaining</th>
                                <th class="p-3 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${processedItems.map(p => p.html).join('')}
                        </tbody>
                        <tfoot class="bg-slate-50 font-semibold">
                            <tr class="border-t border-slate-200">
                                <td colspan="5" class="p-3 text-right text-slate-600">${escapeHtml(displayName)} Total:</td>
                                <td class="p-3 text-right text-emerald-600 font-mono-num">${groupCashPaid > 0 ? `UGX ${formatMoney(groupCashPaid)}` : ''}${groupCashPaid > 0 && groupItemsBrought > 0 ? ' + ' : ''}${groupItemsBrought > 0 ? `${groupItemsBrought} items` : ''}</td>
                                <td class="p-3 text-right text-rose-600 font-mono-num">${groupRemainingDisplay}</td>
                                <td class="p-3"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        `;
    }

    // ==================== RENDER PERIOD CONTAINER (FIXED – only scholastic items counted) ====================
    function renderPeriodContainer(period, periodIndex, isCurrent, student, feeStructure, searchTerm) {
        const periodKey = period.periodKey || `${period.year}_${period.term}`;
        const periodLabel = isCurrent ? `Current Period (${getTermName(period.term)} ${period.year})` :
                                           `${getTermName(period.term)} ${period.year}`;
        const collapseId = `period_${periodKey}`;
        const isExpanded = isCurrent || periodIndex === 0;

        // ====================================================================
        // TOTALS CALCULATION – ONLY COUNT SCHOLASTIC ITEMS
        // ====================================================================
        let totalItemsRequired = 0;
        let totalItemsBrought = 0;
        let totalItemsRemaining = 0;
        let totalCashPaid = 0;
        let totalCashExpected = 0;
        let totalTuitionPaid = 0;
        let totalTuitionExpected = 0;
        let scholasticCashPaid = 0;
        let scholasticItemsCoveredByCash = 0;

        const statusGroups = period.statusGroups || {};

        for (const groupName of Object.keys(statusGroups)) {
            const group = statusGroups[groupName];
            if (!group || !group.items) continue;

            const isScholastic = groupName.toLowerCase().includes('scholastic');

            for (const item of group.items) {
                if (item.isRemoved) continue;

                const paymentOption = item.paymentOption || 'either';
                const qty = item.quantity || 1;
                const brought = item.itemsBrought || 0;
                const cashPaid = item.cashPaid || 0;
                const unitPrice = item.unitPrice || 0;
                const totalAmount = item.totalAmount || 0;

                totalCashPaid += cashPaid;

                if (isScholastic && paymentOption === 'either' && cashPaid > 0) {
                    scholasticCashPaid += cashPaid;
                    if (unitPrice > 0) {
                        const itemsCovered = Math.floor(cashPaid / unitPrice);
                        scholasticItemsCoveredByCash += itemsCovered;
                    }
                }

                if (paymentOption === 'cash_only') {
                    totalCashExpected += totalAmount;
                    continue; // cash_only items do NOT count as items
                }

                // Only count items if the group is Scholastic
                if (isScholastic) {
                    totalItemsRequired += qty;
                    totalItemsBrought += Math.min(brought, qty);

                    if (paymentOption === 'item_only') {
                        totalItemsRemaining += Math.max(0, qty - Math.min(brought, qty));
                    } else {
                        if (cashPaid >= totalAmount) {
                            totalItemsRemaining += 0;
                        } else {
                            const itemsCoveredByCash = unitPrice > 0 ? Math.floor(cashPaid / unitPrice) : 0;
                            const totalCovered = Math.min(brought, qty) + itemsCoveredByCash;
                            totalItemsRemaining += Math.max(0, qty - totalCovered);
                        }
                    }
                }

                // For 'either' items, we still add cashExpected for ALL groups (including non-scholastic)
                if (paymentOption === 'either') {
                    const remainingAfterItems = Math.max(0, qty - Math.min(brought, qty));
                    totalCashExpected += remainingAfterItems * unitPrice;
                }
            }
        }

        const tuition = period.tuition || {};
        totalTuitionPaid = tuition.paid || 0;
        totalTuitionExpected = tuition.expected || 0;

        const totals = period.totals || {};
        const totalBalance = totals.balance || 0;
        const totalExpected = totals.expected || 0;
        const totalPaid = totals.paid || 0;

        const hasBalance = totalBalance > 0 || totalItemsRemaining > 0;
        const isEmpty = period.isEmpty || false;
        const isFullyPaid = !hasBalance && !isEmpty && totalPaid > 0;

        let headerColor = 'bg-gradient-to-r from-sky-500 to-indigo-600';
        let borderColor = 'border-sky-400';
        let statusBadge = '';
        let dueText = '';

        if (isCurrent) {
            headerColor = 'bg-gradient-to-r from-indigo-600 to-violet-600';
            borderColor = 'border-indigo-500';
            statusBadge = '<span class="text-xs bg-amber-300 text-amber-900 px-2 py-0.5 rounded-full ml-2 font-bold shadow-sm">Current</span>';
        } else if (isEmpty) {
            headerColor = 'bg-gradient-to-r from-slate-400 to-slate-500';
            borderColor = 'border-slate-300';
            statusBadge = '<span class="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full ml-2 font-bold">No Data</span>';
        } else if (isFullyPaid) {
            headerColor = 'bg-gradient-to-r from-emerald-500 to-teal-600';
            borderColor = 'border-emerald-400';
            statusBadge = '<span class="text-xs bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full ml-2 font-bold">✅ Fully Paid</span>';
        } else if (hasBalance) {
            headerColor = 'bg-gradient-to-r from-amber-500 to-orange-500';
            borderColor = 'border-orange-400';
            const balanceDisplay = totalBalance > 0 ? `UGX ${formatMoney(totalBalance)}` : 'Balance';
            statusBadge = `<span class="text-xs bg-rose-200 text-rose-800 px-2 py-0.5 rounded-full ml-2 font-bold">⚠️ ${balanceDisplay} Due</span>`;
            dueText = `Due: UGX ${formatMoney(totalBalance)}`;
        }

        const removedCount = student.removedItems ? Object.keys(student.removedItems).length : 0;

        let html = `
            <div class="border-2 ${borderColor} rounded-2xl overflow-hidden shadow-sm mb-4 db-fade-in transition-shadow duration-300 hover:shadow-lg" id="periodContainer_${periodKey}">
                <div class="cursor-pointer ${headerColor} text-white p-4 flex justify-between items-center transition-all duration-200"
                     onclick="togglePeriodContainer('${collapseId}')">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
                            <i class="fas ${isCurrent ? 'fa-calendar-day' : 'fa-clock-rotate-left'}"></i>
                        </div>
                        <div>
                            <h4 class="font-display font-bold text-base">${periodLabel}</h4>
                            <p class="text-xs opacity-90">
                                ${period.year} Term ${period.term}
                                ${isEmpty ? ' 📋 No Data' : ''}
                                ${isFullyPaid ? ' ✅ Fully Paid' : ''}
                                ${hasBalance && !isEmpty ? ` ⚠️ ${dueText}` : ''}
                                ${!isEmpty && totalPaid > 0 ? ` 💰 UGX ${formatMoney(totalPaid)} paid` : ''}
                                ${scholasticCashPaid > 0 ? ` | 💰 Scholastic Cash: UGX ${formatMoney(scholasticCashPaid)}` : ''}
                                ${scholasticItemsCoveredByCash > 0 ? ` | 💳 ${scholasticItemsCoveredByCash} items paid with cash` : ''}
                                ${totalItemsBrought > 0 ? ` 📦 ${totalItemsBrought} items brought` : ''}
                                ${totalItemsRemaining > 0 ? ` 📦 ${totalItemsRemaining} items remaining` : ''}
                                ${totalItemsRequired > 0 ? ` 📦 ${totalItemsRequired} items required` : ''}
                            </p>
                        </div>
                        ${statusBadge}
                    </div>
                    <div class="flex items-center gap-4">
                        <div class="text-right">
                            <p class="text-sm font-bold font-mono-num">
                                ${isEmpty ? '📋 No Data' :
                                  isFullyPaid ? '✅ Fully Paid' :
                                  hasBalance ? `UGX ${formatMoney(totalBalance)} Due` :
                                  `UGX ${formatMoney(totalExpected)}`}
                            </p>
                            ${totalItemsRemaining > 0 ? `<p class="text-xs opacity-90">📦 ${totalItemsRemaining} items remaining</p>` : ''}
                            ${totalItemsBrought > 0 ? `<p class="text-xs opacity-80">📦 ${totalItemsBrought} items brought</p>` : ''}
                            ${totalItemsRequired > 0 ? `<p class="text-xs opacity-70">📦 ${totalItemsRequired} items required</p>` : ''}
                            ${totalPaid > 0 && !isFullyPaid ? `<p class="text-xs opacity-80">Paid: UGX ${formatMoney(totalPaid)}</p>` : ''}
                            ${scholasticCashPaid > 0 ? `<p class="text-xs opacity-60">Scholastic Cash: UGX ${formatMoney(scholasticCashPaid)}</p>` : ''}
                            ${scholasticItemsCoveredByCash > 0 ? `<p class="text-xs opacity-60">💳 ${scholasticItemsCoveredByCash} cash-covered items</p>` : ''}
                        </div>
                        <i class="fas ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'} transition-transform duration-300" id="icon_${collapseId}"></i>
                    </div>
                </div>

                <div id="${collapseId}" class="${isExpanded ? '' : 'hidden'} p-4 bg-white transition-all duration-300">
        `;

        if (isEmpty) {
            html += `
                <div class="text-center py-8 text-slate-400">
                    <i class="fas fa-inbox text-4xl mb-3 text-slate-300"></i>
                    <p class="font-medium text-slate-500">No data available for this period</p>
                    <p class="text-sm text-slate-400">No fees or payments recorded</p>
                    <div class="mt-3 flex justify-center gap-2 flex-wrap">
                        <span class="db-badge bg-slate-100 text-slate-600">📋 No Tuition</span>
                        <span class="db-badge bg-slate-100 text-slate-600">📦 No Items</span>
                        <span class="db-badge bg-slate-100 text-slate-600">💰 No Payments</span>
                    </div>
                </div>
            `;
        } else {
            html += renderFeeSummaryForPeriod(period, periodLabel, removedCount);

            html += `
                <div class="mt-5">
                    <h4 class="font-display font-bold text-sm mb-2 flex items-center gap-2 text-slate-700">
                        <i class="fas fa-clock-rotate-left text-slate-400"></i> Payment History
                        <span class="text-xs font-normal text-slate-400">(${period.payments?.length || 0} payments)</span>
                    </h4>
                    <div class="bg-slate-50 rounded-xl p-3 border border-slate-100">
                        ${renderPaymentHistoryForPeriod(period.payments || [], periodLabel, feeStructure)}
                    </div>
                </div>
            `;

            html += `
                <div class="mt-5">
                    <div class="flex justify-between items-center mb-2 flex-wrap gap-2">
                        <h4 class="font-display font-bold text-sm flex items-center gap-2 text-slate-700">
                            <i class="fas fa-tags text-indigo-500"></i> Fee Breakdown by Status Group
                        </h4>
                        <div class="relative">
                            <input type="text"
                                   id="itemSearch_${periodKey}"
                                   placeholder="🔍 Search items..."
                                   class="w-48 border border-slate-200 rounded-xl px-3.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 outline-none transition-all"
                                   oninput="filterItemsInPeriod('${periodKey}', this.value)">
                            <button onclick="document.getElementById('itemSearch_${periodKey}').value=''; filterItemsInPeriod('${periodKey}', '')"
                                    class="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs transition-colors">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                    <p class="text-xs text-slate-400 mb-2">Detailed breakdown of all fees grouped by category</p>
                    <div class="space-y-3" id="statusGroupsContainer_${periodKey}">
                        ${Object.keys(statusGroups).map(groupName => {
                            const groupData = statusGroups[groupName];
                            return renderStatusGroupTableForPeriod(
                                { name: groupName, componentName: groupData.componentName || groupName, items: groupData.items || [] },
                                period,
                                student,
                                period.year,
                                period.term,
                                searchTerm || ''
                            );
                        }).join('')}
                    </div>
                </div>
            `;
        }

        html += `
                </div>
            </div>
        `;

        return html;
    }

    // ==================== MAIN FUNCTION LOGIC ====================

    try {
        const [studentRes, feeStructuresRes, feeAssignmentsRes, feePaymentsRes, feeBursariesRes, classesRes, termRecordsRes] = await Promise.all([
            fetch(`/api/students/${studentId}`),
            fetch('/api/fee/structures'),
            fetch('/api/student-fee-assignments'),
            fetch(`/api/fee/payments`),
            fetch('/api/fee/bursaries'),
            fetch('/api/school/classes'),
            fetch('/api/student-term-records')
        ]);

        const student = await studentRes.json();
        let feeStructures = await feeStructuresRes.json();
        let feeAssignments = await feeAssignmentsRes.json();
        let allPayments = await feePaymentsRes.json();
        let feeBursaries = await feeBursariesRes.json();
        let classes = await classesRes.json();
        let termRecords = termRecordsRes.ok ? await termRecordsRes.json() : {};

        console.log('✅ Student loaded:', student.firstName, student.lastName);

        const removedItems = student.removedItems || {};
        const removedCount = Object.keys(removedItems).length;
        console.log(`✅ Removed Items (${removedCount}):`, removedItems);

        const { currentYear, currentTerm } = currentAcademicSettings;
        const termName = getTermName(currentTerm);

        const classesMap = {};
        classes.forEach(c => { if (c && c.id) classesMap[c.id] = c; });

        const assignment = feeAssignments.find(a => a && a.studentId === studentId) || {};
        let feeStructure = feeStructures.find(f => f && f.id === assignment.feeStructureId);

        let bursary = null;
        if (assignment.bursaryId && feeBursaries) {
            bursary = feeBursaries.find(b => b && b.id === assignment.bursaryId);
        }

        let isCustomBursary = false;
        let customBursaryAmount = null;
        let discountAmount = 0;
        let discountDisplay = '';
        let appliedBursary = null;

        if (student.customBursary && student.customBursary.amount > 0) {
            isCustomBursary = true;
            customBursaryAmount = student.customBursary.amount;
            discountAmount = customBursaryAmount;
            discountDisplay = `UGX ${formatMoney(discountAmount)} off (Custom)`;
            appliedBursary = { name: 'Custom Bursary', type: 'fixed', value: customBursaryAmount, isCustom: true };
        } else if (bursary) {
            appliedBursary = bursary;
            if (bursary.type === 'percentage') {
                discountAmount = (feeStructure?.tuition || 0) * bursary.value / 100;
                discountDisplay = `${bursary.value}% off`;
            } else {
                discountAmount = bursary.value;
                discountDisplay = `UGX ${formatMoney(discountAmount)} off`;
            }
        }

        let currentClass = 'Not Assigned';
        let classLevel = 'Unknown';
        if (student.currentClassId && classesMap[student.currentClassId]) {
            currentClass = classesMap[student.currentClassId].name;
            classLevel = classesMap[student.currentClassId].level || 'Unknown';
        }

        const periodMap = new Map();

        for (const payment of allPayments) {
            if (!payment || payment.studentId !== studentId) continue;

            const year = payment.academicYear || new Date(payment.date).getFullYear();
            const term = payment.term || 1;
            const periodKey = `${year}_${term}`;

            if (!periodMap.has(periodKey)) {
                periodMap.set(periodKey, {
                    periodKey: periodKey,
                    year: year,
                    term: term,
                    payments: [],
                    tuition: { expected: 0, paid: 0, balance: 0 },
                    activity: {
                        cashExpected: 0,
                        cashPaid: 0,
                        cashBalance: 0,
                        itemsRequired: 0,
                        itemsBrought: 0,
                        itemsRemaining: 0
                    },
                    totals: { expected: 0, paid: 0, balance: 0 },
                    statusGroups: {},
                    hasBalance: false,
                    isEmpty: false,
                    isFullyPaid: false
                });
            }

            const periodData = periodMap.get(periodKey);
            periodData.payments.push(payment);

            const tuitionPaid = payment.tuitionPaid || 0;
            periodData.tuition.paid += tuitionPaid;

            const processedActivityKeys = new Set();

            if (payment.activityItemPayments) {
                for (const item of payment.activityItemPayments) {
                    const key = `${item.componentName}_${item.itemName}_${item.periodType || 'termly'}`;
                    if (processedActivityKeys.has(key)) continue;
                    processedActivityKeys.add(key);

                    if (item.paymentType === 'paid_cash') {
                        periodData.activity.cashPaid += item.amountPaid || 0;
                    } else if (item.paymentType === 'brought_item') {
                        periodData.activity.itemsBrought += item.itemsBrought || 0;
                    }
                }
            }

            if (payment.paymentsByPeriodType) {
                for (const period of ['one_time', 'termly', 'yearly']) {
                    const items = payment.paymentsByPeriodType[period] || [];
                    for (const item of items) {
                        const key = `${item.componentName}_${item.itemName}_${period}`;
                        if (processedActivityKeys.has(key)) continue;
                        processedActivityKeys.add(key);

                        if (item.paymentType === 'paid_cash') {
                            periodData.activity.cashPaid += item.amountPaid || 0;
                        } else if (item.paymentType === 'brought_item') {
                            periodData.activity.itemsBrought += item.itemsBrought || 0;
                        }
                    }
                }
            }
        }

        const currentPeriodKey = `${currentYear}_${currentTerm}`;
        if (!periodMap.has(currentPeriodKey)) {
            periodMap.set(currentPeriodKey, {
                periodKey: currentPeriodKey,
                year: currentYear,
                term: currentTerm,
                payments: [],
                tuition: { expected: 0, paid: 0, balance: 0 },
                activity: { cashExpected: 0, cashPaid: 0, cashBalance: 0, itemsRequired: 0, itemsBrought: 0, itemsRemaining: 0 },
                totals: { expected: 0, paid: 0, balance: 0 },
                statusGroups: {},
                hasBalance: false,
                isEmpty: true,
                isFullyPaid: false
            });
        }

        // ================================================================
        // FIX: Compute max term per year and oldest period
        // ================================================================
        const maxTermByYear = {};
        let oldestPeriodKey = null;
        let oldestYear = Infinity;
        let oldestTerm = Infinity;

        for (const [periodKey, periodData] of periodMap) {
            const year = periodData.year;
            const term = periodData.term;
            if (!maxTermByYear[year] || term > maxTermByYear[year]) {
                maxTermByYear[year] = term;
            }
            if (year < oldestYear || (year === oldestYear && term < oldestTerm)) {
                oldestYear = year;
                oldestTerm = term;
                oldestPeriodKey = periodKey;
            }
        }

        console.log('📅 maxTermByYear:', maxTermByYear);
        console.log('📅 oldestPeriodKey:', oldestPeriodKey);

        // ================================================================
        // BUILD STATUS GROUPS MAP (INCLUDES YEARLY ITEMS)
        // ================================================================
        if (feeStructure && feeStructure.activityComponents) {
            const statusGroupsMap = {};

            for (const component of feeStructure.activityComponents) {
                const groupName = component.statusGroupName || component.name || 'Other';
                const periodType = component.periodType || 'termly';

                if (!statusGroupsMap[groupName]) {
                    statusGroupsMap[groupName] = {
                        name: groupName,
                        componentName: component.name,
                        periodType: periodType,
                        items: []
                    };
                }

                for (const item of (component.items || [])) {
                    const itemId = item.id || item.name;

                    // NOTE: We no longer skip removed items here — removal is now
                    // period-aware, so the item must stay available for periods
                    // BEFORE its removal date. Period-level filtering happens below
                    // inside the "PROCESS EACH PERIOD" loop via isItemRemovedForPeriod().

                    const defaultAmount = item.totalAmount || 0;
                    const defaultQuantity = item.quantity || 1;
                    const defaultUnitPrice = item.unitPrice || (defaultAmount / defaultQuantity);
                    const defaultPaymentOption = item.paymentOption || 'either';

                    const customValues = getCustomizedItemValue(
                        student,
                        itemId,
                        item.name,
                        defaultAmount,
                        defaultQuantity,
                        defaultPaymentOption,
                        defaultUnitPrice
                    );

                    const effectiveAmount = customValues.amount;
                    const effectiveQuantity = customValues.quantity;
                    const effectiveUnitPrice = customValues.unitPrice;
                    const effectivePaymentOption = customValues.paymentOption;
                    const isCustomized = customValues.isCustomized;

                    const isTransportation = component.name.toLowerCase().includes('transport') ||
                                            (component.statusGroupName && component.statusGroupName.toLowerCase().includes('transport'));

                    let finalAmount = effectiveAmount;
                    let finalQuantity = effectiveQuantity;
                    let finalUnitPrice = effectiveUnitPrice;

                    if (isTransportation && student.customTransportation) {
                        if (student.customTransportation.hasTransportation === false) {
                            continue;
                        }
                        if (student.customTransportation.amount) {
                            finalAmount = student.customTransportation.amount;
                            finalUnitPrice = finalAmount / (finalQuantity || 1);
                        }
                    }

                    statusGroupsMap[groupName].items.push({
                        id: itemId,
                        name: item.name,
                        totalAmount: finalAmount,
                        quantity: finalQuantity,
                        unitPrice: finalUnitPrice,
                        paymentOption: effectivePaymentOption,
                        periodType: periodType,
                        isCustomized: isCustomized,
                        customReason: customValues.reason,
                        defaultAmount: defaultAmount,
                        defaultQuantity: defaultQuantity,
                        itemName: item.name
                    });
                }
            }

            // ================================================================
            // PROCESS EACH PERIOD WITH FIXED YEARLY/ONE-TIME LOGIC
            // ================================================================
            for (const [periodKey, periodData] of periodMap) {
                const year = periodData.year;
                const term = periodData.term;
                const isFirstTermForPeriod = term === 1;
                const isLatestTermForYear = (term === maxTermByYear[year]);
                const isOldestPeriod = (periodKey === oldestPeriodKey);

                let expectedTuition = feeStructure.tuition || 0;
                if (appliedBursary) {
                    if (appliedBursary.type === 'percentage') {
                        expectedTuition = Math.max(0, expectedTuition - (expectedTuition * appliedBursary.value / 100));
                    } else {
                        expectedTuition = Math.max(0, expectedTuition - appliedBursary.value);
                    }
                }

                periodData.tuition.expected = expectedTuition;
                periodData.tuition.balance = expectedTuition - periodData.tuition.paid;

                let cashExpected = 0;
                let scholasticItemsRequired = 0;
                let scholasticItemsBrought = 0;
                let scholasticItemsRemaining = 0;
                const periodStatusGroups = {};

                for (const [groupName, groupData] of Object.entries(statusGroupsMap)) {
                    const groupItems = [];
                    let groupCashExpected = 0;
                    let groupItemsRequired = 0;
                    let groupCashPaid = 0;
                    let groupItemsBrought = 0;
                    const isScholastic = groupName.toLowerCase().includes('scholastic');

                    for (const item of groupData.items) {
                        const itemPeriodType = item.periodType || 'termly';

                        // ========================================================
                        // NEW: Skip this item for this period (and any period from
                        // its removal date onward) if it was removed for this period
                        // ========================================================
                        if (isItemRemovedForPeriod(student, item.id, year, term)) {
                            continue;
                        }

                        // ========================================================
                        // FIX: Only include items based on period type
                        // ========================================================
                        let shouldInclude = false;
                        if (itemPeriodType === 'termly') {
                            shouldInclude = true;
                        } else if (itemPeriodType === 'one_time') {
                            shouldInclude = isOldestPeriod;
                        } else if (itemPeriodType === 'yearly') {
                            shouldInclude = isLatestTermForYear;
                        }

                        if (!shouldInclude) continue;

                        // ====== Determine which payments to check ======
                        let paymentsToCheck = [];

                        if (itemPeriodType === 'yearly') {
                            // Yearly: check ALL payments in the SAME academic year (all terms)
                            for (const [key, data] of periodMap) {
                                if (data.year === year) {
                                    paymentsToCheck.push(...data.payments);
                                }
                            }
                            console.log(`   Yearly item "${item.name}" (${groupName}) checking ${paymentsToCheck.length} payments in year ${year}`);
                        } else if (itemPeriodType === 'one_time') {
                            // One-time: check ALL periods (forever)
                            for (const data of periodMap.values()) {
                                paymentsToCheck.push(...data.payments);
                            }
                        } else {
                            // termly: check only this period's payments
                            paymentsToCheck = periodData.payments;
                        }

                        // ====== Accumulate cashPaid and itemsBrought ======
                        let itemCashPaid = 0;
                        let itemItemsBrought = 0;
                        const processedKeys = new Set();

                        for (const payment of paymentsToCheck) {
                            if (payment.activityItemPayments) {
                                for (const paidItem of payment.activityItemPayments) {
                                    const key = `${paidItem.componentName}_${paidItem.itemName}_${paidItem.periodType || 'termly'}`;
                                    if (processedKeys.has(key)) continue;
                                    processedKeys.add(key);
                                    if (paidItem.itemName === item.name &&
                                        paidItem.componentName === groupData.componentName) {
                                        if (paidItem.paymentType === 'paid_cash') {
                                            itemCashPaid += paidItem.amountPaid || 0;
                                        } else if (paidItem.paymentType === 'brought_item') {
                                            itemItemsBrought += paidItem.itemsBrought || 0;
                                        }
                                    }
                                }
                            }
                            if (payment.paymentsByPeriodType) {
                                for (const period of ['one_time', 'termly', 'yearly']) {
                                    const periodItems = payment.paymentsByPeriodType[period] || [];
                                    for (const paidItem of periodItems) {
                                        const key = `${paidItem.componentName}_${paidItem.itemName}_${period}`;
                                        if (processedKeys.has(key)) continue;
                                        processedKeys.add(key);
                                        if (paidItem.itemName === item.name &&
                                            paidItem.componentName === groupData.componentName) {
                                            if (paidItem.paymentType === 'paid_cash') {
                                                itemCashPaid += paidItem.amountPaid || 0;
                                            } else if (paidItem.paymentType === 'brought_item') {
                                                itemItemsBrought += paidItem.itemsBrought || 0;
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        const finalItemsBrought = Math.min(itemItemsBrought, item.quantity || 1);
                        console.log(`   Item: ${item.name} (${itemPeriodType}) | cashPaid: ${itemCashPaid} | itemsBrought: ${finalItemsBrought}`);

                        // ====== Compute cashExpected and remaining ======
                        let itemCashExpected = 0;
                        const totalValue = item.totalAmount || 0;
                        const qty = item.quantity || 1;
                        const unitPrice = item.unitPrice || (totalValue / qty);

                        if (item.paymentOption === 'cash_only') {
                            itemCashExpected = totalValue;
                        } else if (item.paymentOption === 'item_only') {
                            itemCashExpected = 0;
                        } else {
                            const remainingQty = Math.max(0, qty - finalItemsBrought);
                            itemCashExpected = remainingQty * unitPrice;
                            if (itemCashExpected > totalValue) itemCashExpected = totalValue;
                        }

                        let isFullyPaid = false;
                        let remainingCash = 0;
                        let remainingItems = 0;
                        if (item.paymentOption === 'cash_only') {
                            remainingCash = Math.max(0, totalValue - itemCashPaid);
                            isFullyPaid = remainingCash === 0;
                        } else if (item.paymentOption === 'item_only') {
                            remainingItems = Math.max(0, qty - finalItemsBrought);
                            isFullyPaid = remainingItems === 0;
                        } else {
                            // OR logic
                            const totalValuePaid = itemCashPaid + (finalItemsBrought * unitPrice);
                            isFullyPaid = totalValuePaid >= totalValue;
                            if (!isFullyPaid) {
                                const cashCoversItems = Math.floor(itemCashPaid / unitPrice);
                                const totalCovered = Math.min(qty, finalItemsBrought + cashCoversItems);
                                remainingItems = Math.max(0, qty - totalCovered);
                                remainingCash = remainingItems * unitPrice;
                            }
                        }

                        groupCashExpected += itemCashExpected;
                        groupCashPaid += Math.min(itemCashPaid, totalValue);
                        // Only count items if the group is Scholastic
                        if (isScholastic) {
                            groupItemsRequired += qty;
                            groupItemsBrought += finalItemsBrought;
                            scholasticItemsRequired += qty;
                            scholasticItemsBrought += finalItemsBrought;
                            scholasticItemsRemaining += remainingItems;
                        }

                        cashExpected += itemCashExpected;

                        groupItems.push({
                            ...item,
                            cashExpected: itemCashExpected,
                            cashPaid: Math.min(itemCashPaid, totalValue),
                            itemsBrought: finalItemsBrought,
                            remainingCash: remainingCash,
                            remainingItems: remainingItems,
                            isFullyPaid: isFullyPaid
                        });
                    }

                    if (groupItems.length > 0) {
                        periodStatusGroups[groupName] = {
                            name: groupName,
                            componentName: groupData.componentName || groupName,
                            periodType: groupData.periodType || 'termly',
                            items: groupItems,
                            cashExpected: groupCashExpected,
                            itemsRequired: groupItemsRequired,
                            cashPaid: groupCashPaid,
                            itemsBrought: groupItemsBrought
                        };
                    }
                }

                periodData.activity.cashExpected = cashExpected;
                periodData.activity.itemsRequired = scholasticItemsRequired;
                periodData.activity.cashPaid = periodData.activity.cashPaid || 0;
                periodData.activity.itemsBrought = scholasticItemsBrought;
                periodData.activity.cashBalance = cashExpected - periodData.activity.cashPaid;
                periodData.activity.itemsRemaining = scholasticItemsRemaining;
                periodData.statusGroups = periodStatusGroups;

                const totalExpected = expectedTuition + cashExpected;
                const totalPaid = periodData.tuition.paid + periodData.activity.cashPaid;
                periodData.totals.expected = totalExpected;
                periodData.totals.paid = totalPaid;
                periodData.totals.balance = totalExpected - totalPaid;

                periodData.hasBalance = periodData.totals.balance > 0 || periodData.activity.itemsRemaining > 0;
                periodData.isFullyPaid = !periodData.hasBalance && periodData.totals.paid > 0;

                if (periodData.payments.length === 0 && totalExpected === 0 && periodData.totals.balance === 0) {
                    periodData.isEmpty = true;
                } else {
                    periodData.isEmpty = false;
                }

                periodData.appliedBursary = appliedBursary;
                periodData.discountDisplay = discountDisplay;
            }
        }

        // ====================================================================
        // CONTINUE WITH RENDERING – REST OF THE FUNCTION
        // ====================================================================
        const sortedPeriods = Array.from(periodMap.entries())
            .map(([key, data]) => ({ key, ...data }))
            .sort((a, b) => {
                if (a.year !== b.year) return b.year - a.year;
                return b.term - a.term;
            });

        let totalPreviousBalance = 0;
        let totalPreviousItems = 0;
        let periodsWithBalance = 0;
        let emptyPeriods = 0;
        let fullyPaidPeriods = 0;

        for (let i = 1; i < sortedPeriods.length; i++) {
            const period = sortedPeriods[i];
            totalPreviousBalance += Math.max(0, period.totals.balance || 0);
            totalPreviousItems += period.activity.itemsRemaining || 0;
            if (period.hasBalance) periodsWithBalance++;
            if (period.isEmpty) emptyPeriods++;
            if (period.isFullyPaid) fullyPaidPeriods++;
        }

        let periodsHtml = '';
        let periodIndex = 0;

        for (const period of sortedPeriods) {
            const isCurrent = period.year === currentYear && period.term === currentTerm;
            periodsHtml += renderPeriodContainer(period, periodIndex, isCurrent, student, feeStructure, '');
            periodIndex++;
        }

        const searchFilterFunction = `
            window.filterItemsInPeriod = function(periodKey, searchTerm) {
                const container = document.getElementById('statusGroupsContainer_' + periodKey);
                if (!container) return;

                const groups = container.querySelectorAll(':scope > div');
                let visibleGroupCount = 0;
                let visibleItemCount = 0;

                groups.forEach(group => {
                    const tbody = group.querySelector('tbody');
                    if (!tbody) return;

                    const rows = tbody.querySelectorAll('tr');
                    let groupHasVisible = false;

                    rows.forEach(row => {
                        const rowText = row.textContent.toLowerCase();
                        if (searchTerm.trim() === '' || rowText.includes(searchTerm.toLowerCase().trim())) {
                            row.style.display = '';
                            groupHasVisible = true;
                            visibleItemCount++;
                        } else {
                            row.style.display = 'none';
                        }
                    });

                    if (groupHasVisible) {
                        group.style.display = '';
                        visibleGroupCount++;
                    } else {
                        group.style.display = 'none';
                    }
                });

                let noResultsMsg = container.querySelector('.no-results-msg');
                if (visibleItemCount === 0 && searchTerm.trim() !== '') {
                    if (!noResultsMsg) {
                        noResultsMsg = document.createElement('div');
                        noResultsMsg.className = 'no-results-msg text-center py-6 text-slate-400 db-fade-in';
                        noResultsMsg.innerHTML = '<i class="fas fa-magnifying-glass text-slate-300 text-2xl mb-2 block"></i><p>No items match "<span class="font-medium">' + searchTerm + '</span>"</p>';
                        container.appendChild(noResultsMsg);
                    }
                    noResultsMsg.style.display = '';
                } else if (noResultsMsg) {
                    noResultsMsg.style.display = 'none';
                }
            };
        `;

        const scriptTag = document.createElement('script');
        scriptTag.textContent = searchFilterFunction;
        document.head.appendChild(scriptTag);

        // ========== BUILD THE CUSTOMIZED ITEMS DISPLAY ==========
       // ========== BUILD THE CUSTOMIZED ITEMS DISPLAY (FIXED) ==========
let customizedItemsHtml = '';
if (student.customItemOverrides && Object.keys(student.customItemOverrides).length > 0) {
    const customizationItems = [];

    // Helper: find custom item name from various sources
    function findCustomItemName(itemId, fallbackName) {
        // 1. Check customItemOverrides for itemName
        if (student.customItemOverrides[itemId]?.itemName) {
            return student.customItemOverrides[itemId].itemName;
        }

        // 2. Search in customGroups (array of groups with items)
        if (Array.isArray(student.customGroups)) {
            for (const group of student.customGroups) {
                if (group.items && Array.isArray(group.items)) {
                    for (const item of group.items) {
                        if (item.id === itemId && item.name) {
                            return item.name;
                        }
                    }
                }
            }
        }

        // 3. Search in customAddedItems (array of custom items)
        if (Array.isArray(student.customAddedItems)) {
            for (const item of student.customAddedItems) {
                if (item.id === itemId && item.name) {
                    return item.name;
                }
            }
        }

        // 4. Search in fee structure (for overrides of existing items)
        if (feeStructure && feeStructure.activityComponents) {
            for (const component of feeStructure.activityComponents) {
                for (const item of (component.items || [])) {
                    const compItemId = item.id || item.name;
                    if (compItemId === itemId || item.name === fallbackName) {
                        return item.name;
                    }
                }
            }
            // Try partial match (remove random suffix)
            const baseId = itemId.replace(/_[a-z0-9]+$/, '');
            for (const component of feeStructure.activityComponents) {
                for (const item of (component.items || [])) {
                    const compItemId = item.id || item.name;
                    if (compItemId === baseId || compItemId.startsWith(baseId + '_')) {
                        return item.name;
                    }
                }
            }
        }

        // 5. Fallback: clean up the ID
        let clean = itemId.replace(/^custom_/, '').replace(/^item_/, '');
        clean = clean.replace(/_[a-z0-9]+$/, '');
        clean = clean.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
        if (clean && clean.length > 2) {
            return clean.charAt(0).toUpperCase() + clean.slice(1);
        }
        return 'Custom Item';
    }

    for (const [itemId, custom] of Object.entries(student.customItemOverrides)) {
        // Get the item name using the helper
        const itemName = findCustomItemName(itemId, custom.itemName || null);

        const defaultAmount = custom.defaultAmount || 0;
        const customAmount = custom.customAmount !== undefined && custom.customAmount !== null ? custom.customAmount : defaultAmount;
        const defaultQuantity = custom.defaultQuantity || 1;
        const customQuantity = custom.customQuantity !== undefined && custom.customQuantity !== null ? custom.customQuantity : defaultQuantity;

        const amountChanged = customAmount !== defaultAmount;
        const qtyChanged = customQuantity !== defaultQuantity;

        customizationItems.push(`
            <div class="db-card p-3 border-orange-100 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                <div class="flex justify-between items-start">
                    <div>
                        <div class="flex items-center gap-2">
                            <p class="font-medium text-slate-700">📦 ${escapeHtml(itemName)}</p>
                            <span class="db-badge bg-orange-50 text-orange-700">⚡ Custom</span>
                        </div>
                        <div class="text-xs text-slate-500 mt-1">
                            ${amountChanged ? `
                                <span class="text-rose-500 line-through font-mono-num">UGX ${formatMoney(defaultAmount)}</span>
                                <span class="text-emerald-600 font-semibold font-mono-num">→ UGX ${formatMoney(customAmount)}</span>
                            ` : `UGX ${formatMoney(defaultAmount)}`}
                            ${qtyChanged ? `
                                <span class="ml-2 text-rose-500 line-through">Qty: ${defaultQuantity}</span>
                                <span class="text-emerald-600 font-semibold">→ ${customQuantity}</span>
                            ` : defaultQuantity > 1 ? `| Qty: ${defaultQuantity}` : ''}
                        </div>
                        ${custom.reason ? `<p class="text-xs text-slate-500 mt-1">📝 ${escapeHtml(custom.reason)}</p>` : ''}
                    </div>
                    <div class="text-right text-xs text-slate-400">
                        ${custom.updatedAt ? `Updated: ${new Date(custom.updatedAt).toLocaleDateString()}` : ''}
                    </div>
                </div>
            </div>
        `);
    }

    customizedItemsHtml = `
        <div class="border-2 border-orange-200 rounded-2xl p-4 bg-orange-50/60 mb-6 db-fade-in">
            <div class="flex justify-between items-center mb-3 flex-wrap gap-2">
                <h4 class="font-display font-bold text-lg flex items-center gap-2 text-slate-800">
                    <div class="w-8 h-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center">
                        <i class="fas fa-sliders-h text-sm"></i>
                    </div>
                    Customized Items (${customizationItems.length})
                </h4>
                <span class="text-xs text-slate-500">Items with student-specific overrides</span>
            </div>
            <div class="space-y-2">
                ${customizationItems.join('')}

                ${student.customTransportation ? `
                    <div class="db-card p-3 border-orange-100 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                        <div class="flex justify-between items-start">
                            <div>
                                <div class="flex items-center gap-2">
                                    <p class="font-medium text-slate-700">🚌 Transportation Fee</p>
                                    <span class="db-badge bg-orange-50 text-orange-700">⚡ Custom</span>
                                </div>
                                <div class="text-xs text-slate-500 mt-1">
                                    ${student.customTransportation.hasTransportation !== false ?
                                        `<span class="text-emerald-600 font-semibold font-mono-num">UGX ${formatMoney(student.customTransportation.amount || 0)}</span>` :
                                        `<span class="text-rose-600">❌ Disabled (Student does not use school transport)</span>`
                                    }
                                </div>
                                ${student.customTransportation.description ? `<p class="text-xs text-slate-500 mt-1">📝 ${escapeHtml(student.customTransportation.description)}</p>` : ''}
                            </div>
                            <div class="text-right text-xs text-slate-400">
                                ${student.customTransportation.updatedAt ? `Updated: ${new Date(student.customTransportation.updatedAt).toLocaleDateString()}` : ''}
                            </div>
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

        // ========== BUILD THE FINAL MODAL HTML ==========
        const modalHtml = `
            <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 overflow-y-auto db-modal-overlay" id="studentDetailsModal">
                <div class="db-app-bg bg-white rounded-3xl p-6 max-w-6xl w-full mx-4 my-8 max-h-[95vh] overflow-y-auto db-scroll db-modal-panel shadow-2xl">
                    <!-- Header -->
                    <div class="flex justify-between items-start mb-4 pb-4 border-b border-slate-100 sticky-top bg-white/95 backdrop-blur z-10">
                        <div>
                            <h2 class="text-2xl font-display font-bold flex items-center gap-2 text-slate-800">
                                <div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                                    <i class="fas fa-user-graduate text-base"></i>
                                </div>
                                Student Profile
                            </h2>
                            <p class="text-sm text-slate-500 mt-1.5">Complete student information across all academic periods</p>
                            <p class="text-xs text-slate-400 mt-0.5">📌 Cash and Items are tracked separately - NO CONVERSION between them</p>
                            <div class="flex flex-wrap gap-1.5 mt-1.5">
                                ${removedCount > 0 ? `<span class="text-xs text-rose-500 font-medium">❌ ${removedCount} item(s) removed for this student (not charged)</span>` : ''}
                                ${periodsWithBalance > 0 ? `<span class="text-xs text-amber-500 font-medium">📋 ${periodsWithBalance} period(s) have outstanding balances</span>` : ''}
                                ${emptyPeriods > 0 ? `<span class="text-xs text-slate-400 font-medium">📋 ${emptyPeriods} period(s) have no data</span>` : ''}
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="printStudentProfileModal()" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all duration-200">
                                <i class="fas fa-print"></i> Print
                            </button>
                            <button onclick="closeModal(); editStudentInfoList('${student.id}')" class="bg-gradient-to-r from-orange-500 to-orange-600 text-white px-3.5 py-2 rounded-xl text-sm font-semibold transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
                                <i class="fas fa-edit"></i> Edit Student
                            </button>
                            <button onclick="closeModal()" class="text-slate-400 text-2xl hover:text-slate-700 transition-colors w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100">&times;</button>
                        </div>
                    </div>

                    <!-- Student Basic Info Card -->
                    <div class="bg-gradient-to-r from-sky-50 via-indigo-50 to-violet-50 rounded-2xl p-5 mb-6 border border-indigo-100">
                        <div class="flex items-center gap-4 flex-wrap">
                            <div class="w-20 h-20 bg-gradient-to-br from-sky-500 via-indigo-500 to-violet-500 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg font-display">
                                ${(student.firstName?.charAt(0) || '')}${(student.lastName?.charAt(0) || '')}
                            </div>
                            <div class="flex-1">
                                <div class="flex justify-between items-start flex-wrap gap-2">
                                    <div>
                                        <h3 class="text-2xl font-display font-bold text-slate-800">${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</h3>
                                        <div class="flex gap-2 mt-1.5 flex-wrap">
                                            <span class="db-badge bg-sky-100 text-sky-700"><i class="fas fa-id-card"></i> ${student.admissionNumber}</span>
                                            <span class="db-badge bg-indigo-100 text-indigo-700"><i class="fas fa-chalkboard"></i> ${currentClass}</span>
                                            <span class="db-badge bg-emerald-100 text-emerald-700"><i class="fas fa-venus-mars"></i> ${student.gender || 'N/A'}</span>
                                            ${student.hasCustomizations ? `<span class="db-badge bg-orange-100 text-orange-700">⚡ ${Object.keys(student.customItemOverrides || {}).length} custom items</span>` : ''}
                                            ${removedCount > 0 ? `<span class="db-badge bg-rose-100 text-rose-700">❌ ${removedCount} removed</span>` : ''}
                                        </div>
                                    </div>
                                    <div class="text-right">
                                        <p class="text-xs text-slate-400 uppercase tracking-wide font-semibold">Enrolled on</p>
                                        <p class="font-semibold text-slate-700">${student.enrolledAt ? new Date(student.enrolledAt).toLocaleDateString() : 'N/A'}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- REMOVED ITEMS BANNER -->
                    ${removedCount > 0 ? `
                        <div class="border-2 border-rose-200 rounded-2xl p-4 bg-rose-50/60 mb-6 db-fade-in">
                            <div class="flex items-start gap-3">
                                <div class="w-9 h-9 rounded-xl bg-rose-100 text-rose-500 flex items-center justify-center flex-shrink-0">
                                    <i class="fas fa-triangle-exclamation"></i>
                                </div>
                                <div>
                                    <h4 class="font-display font-bold text-rose-700">⚠️ ${removedCount} Item(s) Removed for This Student</h4>
                                    <p class="text-sm text-rose-600">The following items will NOT be charged for this student:</p>
                                    <div class="flex flex-wrap gap-2 mt-2">
                                        ${Object.values(removedItems).map(r =>
                                            `<span class="db-badge bg-rose-100 text-rose-700 border border-rose-200">📦 ${escapeHtml(r.itemName || r.itemId)}</span>`
                                        ).join('')}
                                    </div>
                                    <p class="text-xs text-rose-500 mt-2">These items were removed during registration or by an administrator.</p>
                                </div>
                            </div>
                        </div>
                    ` : ''}

                    <!-- ========== CUSTOMIZED ITEMS DISPLAY ========== -->
                    ${customizedItemsHtml}

                    <!-- Two Column Layout for Static Info -->
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                        <div class="space-y-6">
                            ${renderPersonalInfoCard(student)}
                            ${renderParentInfoCard(student)}
                        </div>
                        <div class="space-y-6">
                            ${renderAcademicInfoCard(student, currentClass, classLevel)}

                            <!-- Period Summary -->
                            <div class="db-card overflow-hidden transition-all duration-300 hover:shadow-lg">
                                <div class="db-card-hd px-4 py-3 flex items-center gap-2">
                                    <div class="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center flex-shrink-0">
                                        <i class="fas fa-chart-bar text-sm"></i>
                                    </div>
                                    <h4 class="font-display font-bold text-slate-800">Period Summary</h4>
                                </div>
                                <div class="p-4">
                                    <div class="grid grid-cols-2 gap-3 text-sm">
                                        <div class="bg-sky-50 rounded-xl p-2.5 text-center transition-transform duration-200 hover:scale-[1.03]">
                                            <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Total Periods</p>
                                            <p class="text-xl font-bold font-mono-num text-sky-600">${sortedPeriods.length}</p>
                                        </div>
                                        <div class="bg-emerald-50 rounded-xl p-2.5 text-center transition-transform duration-200 hover:scale-[1.03]">
                                            <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Fully Paid</p>
                                            <p class="text-xl font-bold font-mono-num text-emerald-600">${fullyPaidPeriods}</p>
                                        </div>
                                        <div class="bg-amber-50 rounded-xl p-2.5 text-center transition-transform duration-200 hover:scale-[1.03]">
                                            <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">With Balance</p>
                                            <p class="text-xl font-bold font-mono-num text-amber-600">${periodsWithBalance}</p>
                                        </div>
                                        <div class="bg-slate-50 rounded-xl p-2.5 text-center transition-transform duration-200 hover:scale-[1.03]">
                                            <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Empty Periods</p>
                                            <p class="text-xl font-bold font-mono-num text-slate-600">${emptyPeriods}</p>
                                        </div>
                                    </div>
                                    <div class="mt-3 pt-3 border-t border-slate-100">
                                        <div class="flex justify-between text-sm mb-1">
                                            <span class="text-slate-500">Total Previous Balance:</span>
                                            <span class="font-bold font-mono-num text-rose-600">UGX ${formatMoney(totalPreviousBalance)}</span>
                                        </div>
                                        <div class="flex justify-between text-sm">
                                            <span class="text-slate-500">Total Previous Items:</span>
                                            <span class="font-bold font-mono-num text-orange-600">${totalPreviousItems} items</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Periods Section -->
                    <div class="mt-4">
                        <div class="bg-gradient-to-r from-indigo-50 to-violet-50 rounded-2xl p-4 mb-4 border border-indigo-100">
                            <div class="flex justify-between items-center flex-wrap gap-3">
                                <div>
                                    <h3 class="font-display font-bold text-lg flex items-center gap-2 text-slate-800">
                                        <i class="fas fa-calendar-days text-indigo-500"></i> Academic Periods
                                    </h3>
                                    <p class="text-xs text-slate-500 mt-0.5">Detailed breakdown of fees and payments for each academic period</p>
                                    <p class="text-xs text-slate-400 mt-0.5">📌 Click on each period header to expand/collapse</p>
                                    <p class="text-xs text-slate-400 mt-0.5">🔍 Use the search bar in each period to filter items</p>
                                </div>
                                <div class="flex gap-2">
                                    <button onclick="expandAllPeriods()" class="text-xs bg-white px-3.5 py-1.5 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 font-semibold text-slate-600">
                                        <i class="fas fa-expand"></i> Expand All
                                    </button>
                                    <button onclick="collapseAllPeriods()" class="text-xs bg-white px-3.5 py-1.5 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 font-semibold text-slate-600">
                                        <i class="fas fa-compress"></i> Collapse All
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div class="space-y-4" id="periodsContainer">
                            ${periodsHtml}
                        </div>
                    </div>

                    <!-- Action Buttons -->
                    <div class="flex gap-3 mt-6 pt-4 border-t border-slate-100">
                        <button onclick="closeModal(); makePaymentForStudent('${student.id}')" class="flex-1 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white py-2.5 rounded-xl font-semibold transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5">
                            <i class="fas fa-receipt"></i> Make Payment
                        </button>
                        <button onclick="closeModal()" class="flex-1 bg-slate-100 text-slate-700 py-2.5 rounded-xl font-semibold transition-all duration-200 hover:bg-slate-200">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // ========== MAKE GLOBAL FUNCTIONS FOR PERIOD TOGGLING ==========
        window.togglePeriodContainer = function(collapseId) {
            const element = document.getElementById(collapseId);
            const icon = document.getElementById(`icon_${collapseId}`);

            if (element) {
                element.classList.toggle('hidden');
                if (icon) {
                    icon.classList.toggle('fa-chevron-down');
                    icon.classList.toggle('fa-chevron-up');
                }
            }
        };

        window.expandAllPeriods = function() {
            document.querySelectorAll('[id^="period_"]').forEach(el => {
                el.classList.remove('hidden');
            });
            document.querySelectorAll('[id^="icon_period_"]').forEach(el => {
                el.classList.remove('fa-chevron-down');
                el.classList.add('fa-chevron-up');
            });
        };

        window.collapseAllPeriods = function() {
            document.querySelectorAll('[id^="period_"]').forEach(el => {
                const container = el.closest('.border-2');
                if (container && container.classList.contains('border-indigo-500')) {
                    return;
                }
                el.classList.add('hidden');
            });
            document.querySelectorAll('[id^="icon_period_"]').forEach(el => {
                const container = el.closest('.border-2');
                if (container && container.classList.contains('border-indigo-500')) {
                    return;
                }
                el.classList.remove('fa-chevron-up');
                el.classList.add('fa-chevron-down');
            });
        };

        // ========== MAKE GLOBAL CLOSE MODAL ==========
        window.closeModal = function() {
            const modal = document.querySelector('.fixed.inset-0');
            if (modal) {
                modal.classList.add('db-modal-closing');
                setTimeout(() => modal.remove(), 180);
            }
        };

        window.printStudentProfileModal = function() {
            window.print();
        };

        window.makePaymentForStudent = function(studentId) {
            closeModal();
            const feeLink = document.querySelector('.sidebar-item[onclick*="showFeeManagement"]');
            if (feeLink) feeLink.click();
            else showFeeManagement();
            setTimeout(() => {
                const studentSelect = document.getElementById('collectStudentSelect');
                if (studentSelect) {
                    studentSelect.value = studentId;
                    studentSelect.dispatchEvent(new Event('change'));
                }
                const collectTab = document.querySelector('.fee-tab[data-tab="collect"]');
                if (collectTab) collectTab.click();
            }, 500);
        };

        // ========== INJECT MODAL ENTRANCE ANIMATION (scoped, one-time) ==========
        if (!document.getElementById('studentModalMotionStyles')) {
            const motionStyle = document.createElement('style');
            motionStyle.id = 'studentModalMotionStyles';
            motionStyle.textContent = `
                @keyframes dbModalFadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes dbModalPanelIn { from { opacity: 0; transform: translateY(18px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
                .db-modal-overlay { animation: dbModalFadeIn .2s ease-out; }
                .db-modal-panel { animation: dbModalPanelIn .28s cubic-bezier(.16,1,.3,1); }
                .db-modal-closing { animation: dbModalFadeIn .18s ease-in reverse both; }
                .db-modal-closing .db-modal-panel { animation: dbModalPanelIn .18s ease-in reverse both; }
                @media (prefers-reduced-motion: reduce) {
                    .db-modal-overlay, .db-modal-panel, .db-modal-closing, .db-modal-closing .db-modal-panel { animation: none !important; }
                }
            `;
            document.head.appendChild(motionStyle);
        }

    } catch (error) {
        console.error('Error:', error);
        alert('Error loading student details: ' + error.message);
    }
}
// ==================== MAKE FUNCTIONS GLOBAL ====================
window.viewStudentDetailsList = viewStudentDetailsList;
window.closeModal = function() {
    const modal = document.querySelector('.fixed.inset-0');
    if (modal) modal.remove();
};
window.printStudentProfileModal = function() {
    window.print();
};
window.makePaymentForStudent = function(studentId) {
    closeModal();
    const feeLink = document.querySelector('.sidebar-item[onclick*="showFeeManagement"]');
    if (feeLink) feeLink.click();
    else showFeeManagement();
    setTimeout(() => {
        const studentSelect = document.getElementById('collectStudentSelect');
        if (studentSelect) {
            studentSelect.value = studentId;
            studentSelect.dispatchEvent(new Event('change'));
        }
        const collectTab = document.querySelector('.fee-tab[data-tab="collect"]');
        if (collectTab) collectTab.click();
    }, 500);
};

console.log('✅ viewStudentDetailsList vFINAL - ALL ISSUES FIXED LOADED!');
console.log('   ✅ Items Brought: Counted ONCE (no double counting)');
console.log('   ✅ Cash Expected: Correctly reduced by brought items');
console.log('   ✅ Cash Paid: Only actual cash payments');
console.log('   ✅ Payment History: Shows items brought vs cash paid separately');
console.log('   ✅ "Item Only" items show quantity remaining correctly');
console.log('   ✅ "Cash Only" items show money remaining correctly');
console.log('   ✅ Mixed items show both options when both remain');
console.log('   ✅ Fully paid items show "✓ Paid"');
console.log('   ✅ Removed items are excluded from all totals');


function makePaymentForStudentList(studentId) {
    const feeLink = document.querySelector('.sidebar-item[onclick*="showFeeManagement"]');
    if (feeLink) feeLink.click();
    else if (typeof showFeeManagement === 'function') showFeeManagement();
    setTimeout(() => {
        const studentSelect = document.getElementById('collectStudentSelect');
        if (studentSelect) { studentSelect.value = studentId; studentSelect.dispatchEvent(new Event('change')); }
        const collectTab = document.querySelector('.fee-tab[data-tab="collect"]');
        if (collectTab) collectTab.click();
    }, 500);
}



async function deleteStudentEntryList(studentId) {
    if (confirm('⚠️ Are you sure you want to delete this student? This cannot be undone.')) {
        const res = await fetch(`/api/students/${studentId}`, { method: 'DELETE' });
        if (res.ok) { alert('✅ Student deleted'); showStudentList(); }
        else alert('❌ Delete failed');
    }
}

// ==================== HELPER ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make all functions global
window.showStudentList = showStudentList;
window.toggleSelectAllStudentsList = toggleSelectAllStudentsList;
window.updateSelectedCountList = updateSelectedCountList;
window.selectAllStudentsList = selectAllStudentsList;
window.clearStudentSelectionList = clearStudentSelectionList;
window.exportStudentListData = exportStudentListData;
window.viewStudentDetailsList = viewStudentDetailsList;
window.viewStudentFeeDetailsList = viewStudentFeeDetailsList;
window.makePaymentForStudentList = makePaymentForStudentList;
window.editStudentInfoList = editStudentInfoList;
window.deleteStudentEntryList = deleteStudentEntryList;

console.log('All Students Page v6.0 - Fully Loaded!');

// ==================== RENDER STUDENT TABLE ROWS ====================

function renderStudentTableRows(students, isFirstTerm) {
    if (!students || students.length === 0) {
        return '<tr><td colspan="12" class="text-center p-8 text-gray-500">No students found. Click "Register New Student" to add one.</td></tr>';
    }
    
    return students.map(s => {
        // Determine row highlight
        let rowClass = '';
        if (s.status === 'Critical Overdue') rowClass = 'bg-red-50';
        else if (s.status === 'Credit Balance') rowClass = 'bg-blue-50';
        else if (s.status === 'Fully Paid') rowClass = 'bg-green-50';
        
        // Format currency for display
        const formatAmount = (amount) => {
            const num = Math.round(amount || 0);
            if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
            if (num >= 10000) return `${Math.round(num / 1000)}K`;
            if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
            return num.toLocaleString();
        };
        
        const tuitionDisplay = s.tuitionPaid > 0 ? 
            `<span class="font-semibold">UGX ${formatAmount(s.tuitionPaid)}</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedTuition)}</span>` :
            `<span class="text-gray-400">UGX 0</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedTuition)}</span>`;
        
        const termlyDisplay = s.termlyPaid > 0 ?
            `<span class="font-semibold">UGX ${formatAmount(s.termlyPaid)}</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedTermly)}</span>` :
            `<span class="text-gray-400">UGX 0</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedTermly)}</span>`;
        
        const oneTimeDisplay = s.oneTimePaid > 0 ?
            `<span class="font-semibold">UGX ${formatAmount(s.oneTimePaid)}</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedOneTime)}</span>` :
            `<span class="text-gray-400">UGX 0</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedOneTime)}</span>`;
        
        const yearlyDisplay = s.yearlyPaid > 0 ?
            `<span class="font-semibold">UGX ${formatAmount(s.yearlyPaid)}</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedYearly)}</span>` :
            `<span class="text-gray-400">UGX 0</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedYearly)}</span>`;
        
        // Balance display with color
        let balanceDisplay = '';
        let balanceClass = '';
        if (s.totalBalance < 0) {
            balanceDisplay = `Credit: UGX ${formatAmount(Math.abs(s.totalBalance))}`;
            balanceClass = 'text-blue-600';
        } else if (s.totalBalance > 0) {
            balanceDisplay = `UGX ${formatAmount(s.totalBalance)}`;
            balanceClass = 'text-red-600 font-bold';
        } else {
            balanceDisplay = 'UGX 0';
            balanceClass = 'text-green-600';
        }
        
        return `
            <tr class="border-b hover:bg-gray-50 ${rowClass} student-row"
                data-student-id="${s.id}"
                data-student-name="${(s.firstName + ' ' + s.lastName).toLowerCase()}"
                data-admission="${s.admissionNumber.toLowerCase()}"
                data-class="${s.currentClass}"
                data-level="${s.classLevel}"
                data-status="${s.status}"
                data-parent="${(s.parentName || '').toLowerCase()}">
                <td class="p-2 text-center"><input type="checkbox" class="student-checkbox" value="${s.id}" onchange="updateSelectedCount()"></td>
                <td class="p-2 font-mono text-xs font-semibold">${s.admissionNumber}</td>
                <td class="p-2">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                            ${s.firstName.charAt(0)}${s.lastName.charAt(0)}
                        </div>
                        <div>
                            <p class="font-medium">${escapeHtml(s.firstName)} ${escapeHtml(s.lastName)}</p>
                            <p class="text-xs text-gray-500">${s.gender} | ${s.enrollmentDate ? new Date(s.enrollmentDate).toLocaleDateString() : 'N/A'}</p>
                        </div>
                    </div>
                </td>
                <td class="p-2"><span class="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800">${s.currentClass}</span></td>
                <td class="p-2">
                    <p class="text-sm">${escapeHtml(s.parentName)}</p>
                    <p class="text-xs text-gray-500">📞 ${s.parentPhone}</p>
                </td>
                <td class="p-2 text-right">${tuitionDisplay}</td>
                <td class="p-2 text-right">${termlyDisplay}</td>
                ${isFirstTerm ? `<td class="p-2 text-right">${oneTimeDisplay}</td>` : ''}
                ${isFirstTerm ? `<td class="p-2 text-right">${yearlyDisplay}</td>` : ''}
                <td class="p-2 text-right font-semibold text-green-600">UGX ${formatAmount(s.totalPaid)}</td>
                <td class="p-2 text-right ${balanceClass}">${balanceDisplay}</td>
                <td class="p-2"><span class="px-2 py-0.5 rounded-full text-xs ${s.statusColor}">${s.statusIcon} ${s.status}</span></td>
                <td class="p-2 text-center">
                    <div class="flex justify-center gap-1">
                        <button onclick="viewStudentDetails('${s.id}')" class="text-blue-600 hover:text-blue-800 p-1" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button onclick="viewStudentFeeDetailsEnhanced('${s.id}')" class="text-purple-600 hover:text-purple-800 p-1" title="Fee Details">
                            <i class="fas fa-money-bill-wave"></i>
                        </button>
                        <button onclick="makePaymentForStudent('${s.id}')" class="text-green-600 hover:text-green-800 p-1" title="Make Payment">
                            <i class="fas fa-receipt"></i>
                        </button>
                        <button onclick="editStudentInfo('${s.id}')" class="text-orange-600 hover:text-orange-800 p-1" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="deleteStudentEntry('${s.id}')" class="text-red-600 hover:text-red-800 p-1" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                 </td>
             </tr>
        `;
    }).join('');
}

// ==================== INITIALIZE STUDENT FILTERS ====================

function initializeStudentFilters() {
    const searchInput = document.getElementById('studentSearchInput');
    const classFilter = document.getElementById('classFilterInput');
    const levelFilter = document.getElementById('levelFilterInput');
    const statusFilter = document.getElementById('statusFilterInput');
    
    const applyFilters = () => {
        const searchTerm = (searchInput?.value || '').toLowerCase().trim();
        const classValue = classFilter?.value || '';
        const levelValue = levelFilter?.value || '';
        const statusValue = statusFilter?.value || '';
        
        const rows = document.querySelectorAll('#studentsTableBody .student-row');
        let visibleCount = 0;
        
        rows.forEach(row => {
            const studentName = row.getAttribute('data-student-name') || '';
            const admission = row.getAttribute('data-admission') || '';
            const parent = row.getAttribute('data-parent') || '';
            const studentClass = row.getAttribute('data-class') || '';
            const studentLevel = row.getAttribute('data-level') || '';
            const studentStatus = row.getAttribute('data-status') || '';
            
            let matchesSearch = true;
            if (searchTerm) {
                matchesSearch = studentName.includes(searchTerm) || 
                               admission.includes(searchTerm) || 
                               parent.includes(searchTerm);
            }
            
            let matchesClass = true;
            if (classValue) matchesClass = studentClass === classValue;
            
            let matchesLevel = true;
            if (levelValue) matchesLevel = studentLevel === levelValue;
            
            let matchesStatus = true;
            if (statusValue) matchesStatus = studentStatus === statusValue;
            
            const isVisible = matchesSearch && matchesClass && matchesLevel && matchesStatus;
            row.style.display = isVisible ? '' : 'none';
            if (isVisible) visibleCount++;
        });
        
        const filteredCountSpan = document.getElementById('filteredStudentCount');
        if (filteredCountSpan) filteredCountSpan.innerText = visibleCount;
    };
    
    if (searchInput) {
        searchInput.addEventListener('input', applyFilters);
        searchInput.addEventListener('keyup', applyFilters);
    }
    if (classFilter) classFilter.addEventListener('change', applyFilters);
    if (levelFilter) levelFilter.addEventListener('change', applyFilters);
    if (statusFilter) statusFilter.addEventListener('change', applyFilters);
    
    applyFilters();
}

// ==================== SELECTION FUNCTIONS ====================

let selectedStudentIds = new Set();

function toggleSelectAllStudents() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const checkboxes = document.querySelectorAll('.student-checkbox');
    const isChecked = selectAllCheckbox?.checked || false;
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
        if (isChecked) {
            selectedStudentIds.add(checkbox.value);
        } else {
            selectedStudentIds.delete(checkbox.value);
        }
    });
    updateSelectedCount();
}

function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('.student-checkbox:checked');
    selectedStudentIds.clear();
    checkboxes.forEach(cb => selectedStudentIds.add(cb.value));
    
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const totalCheckboxes = document.querySelectorAll('.student-checkbox').length;
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = selectedStudentIds.size === totalCheckboxes && totalCheckboxes > 0;
        selectAllCheckbox.indeterminate = selectedStudentIds.size > 0 && selectedStudentIds.size < totalCheckboxes;
    }
}

function selectAllStudents() {
    const checkboxes = document.querySelectorAll('.student-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
        selectedStudentIds.add(checkbox.value);
    });
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) selectAllCheckbox.checked = true;
    updateSelectedCount();
}

function clearStudentSelection() {
    const checkboxes = document.querySelectorAll('.student-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    selectedStudentIds.clear();
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    updateSelectedCount();
}

function sendBulkPaymentReminders() {
    if (selectedStudentIds.size === 0) {
        alert('Please select at least one student to send reminders');
        return;
    }
    
    const selectedStudents = window.allStudentsEnhanced?.filter(s => selectedStudentIds.has(s.id)) || [];
    const overdueStudents = selectedStudents.filter(s => s.totalBalance > 0);
    
    if (overdueStudents.length === 0) {
        alert('No overdue balances among selected students');
        return;
    }
    
    let message = `📧 Payment Reminders would be sent to ${overdueStudents.length} students:\n\n`;
    overdueStudents.forEach(s => {
        message += `• ${s.firstName} ${s.lastName} (${s.admissionNumber}) - Balance: UGX ${Math.round(s.totalBalance).toLocaleString()}\n`;
    });
    message += `\nTotal Outstanding: UGX ${overdueStudents.reduce((sum, s) => sum + s.totalBalance, 0).toLocaleString()}`;
    
    alert(message);
}

// ==================== EXPORT ALL STUDENTS DATA ====================

function exportAllStudentsData() {
    const students = window.allStudentsEnhanced || [];
    if (students.length === 0) {
        alert('No students to export');
        return;
    }
    
    const exportData = students.map(s => ({
        'Admission Number': s.admissionNumber,
        'First Name': s.firstName,
        'Last Name': s.lastName,
        'Gender': s.gender,
        'Class': s.currentClass,
        'Parent Name': s.parentName,
        'Parent Phone': s.parentPhone,
        'Parent Email': s.parentEmail,
        'Address': s.address,
        'Fee Structure': s.feeStructureName,
        'Bursary': s.bursaryName || 'None',
        'Discount': s.discountDisplay,
        'Status': s.status,
        
        'Tuition Expected': s.expectedTuition,
        'Tuition Paid': s.tuitionPaid,
        'Tuition Balance': s.tuitionBalance,
        'Tuition Rate': s.tuitionRate + '%',
        
        'Termly Expected': s.expectedTermly,
        'Termly Paid': s.termlyPaid,
        'Termly Balance': s.termlyBalance,
        'Termly Rate': s.termlyRate + '%',
        
        'One-Time Expected': s.expectedOneTime,
        'One-Time Paid': s.oneTimePaid,
        'One-Time Balance': s.oneTimeBalance,
        'One-Time Rate': s.oneTimeRate + '%',
        
        'Yearly Expected': s.expectedYearly,
        'Yearly Paid': s.yearlyPaid,
        'Yearly Balance': s.yearlyBalance,
        'Yearly Rate': s.yearlyRate + '%',
        
        'Total Expected': s.totalExpected,
        'Total Paid': s.totalPaid,
        'Total Balance': s.totalBalance,
        'Total Collection Rate': s.totalRate + '%',
        
        'Payment Count': s.paymentCount,
        'Enrollment Date': new Date(s.enrollmentDate).toLocaleDateString()
    }));
    
    const headers = Object.keys(exportData[0]);
    const csvRows = [headers.join(',')];
    
    for (const row of exportData) {
        const values = headers.map(header => {
            const value = row[header] !== undefined && row[header] !== null ? row[header] : '';
            return `"${String(value).replace(/"/g, '""')}"`;
        });
        csvRows.push(values.join(','));
    }
    
    const csv = csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `all_students_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    alert(`✅ ${students.length} students exported successfully!`);
}

// ==================== HELPER FUNCTIONS ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make functions global
window.showStudentList = showStudentList;
window.toggleSelectAllStudents = toggleSelectAllStudents;
window.updateSelectedCount = updateSelectedCount;
window.selectAllStudents = selectAllStudents;
window.clearStudentSelection = clearStudentSelection;
window.sendBulkPaymentReminders = sendBulkPaymentReminders;
window.exportAllStudentsData = exportAllStudentsData;
window.viewStudentDetails = viewStudentDetails;
window.viewStudentFeeDetailsEnhanced = viewStudentFeeDetailsEnhanced;
window.makePaymentForStudent = makePaymentForStudent;
window.editStudentInfo = editStudentInfo;
window.deleteStudentEntry = deleteStudentEntry;

console.log('All Students Page v5.0 - Hyper-Statistical Version Loaded!');
// ==================== RENDER STUDENT TABLE ROWS ====================

function renderStudentTableRows(students, isFirstTerm) {
    if (!students || students.length === 0) {
        return '<tr><td colspan="12" class="text-center p-8 text-gray-500">No students found. Click "Register New Student" to add one.</td></tr>';
    }
    
    return students.map(s => {
        // Determine row highlight
        let rowClass = '';
        if (s.status === 'Critical Overdue') rowClass = 'bg-red-50';
        else if (s.status === 'Credit Balance') rowClass = 'bg-blue-50';
        else if (s.status === 'Fully Paid') rowClass = 'bg-green-50';
        
        // Format currency for display
        const formatAmount = (amount) => {
            const num = Math.round(amount || 0);
            if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
            if (num >= 10000) return `${Math.round(num / 1000)}K`;
            if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
            return num.toLocaleString();
        };
        
        const tuitionDisplay = s.tuitionPaid > 0 ? 
            `<span class="font-semibold">UGX ${formatAmount(s.tuitionPaid)}</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedTuition)}</span>` :
            `<span class="text-gray-400">UGX 0</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedTuition)}</span>`;
        
        const termlyDisplay = s.termlyPaid > 0 ?
            `<span class="font-semibold">UGX ${formatAmount(s.termlyPaid)}</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedTermly)}</span>` :
            `<span class="text-gray-400">UGX 0</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedTermly)}</span>`;
        
        const oneTimeDisplay = s.oneTimePaid > 0 ?
            `<span class="font-semibold">UGX ${formatAmount(s.oneTimePaid)}</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedOneTime)}</span>` :
            `<span class="text-gray-400">UGX 0</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedOneTime)}</span>`;
        
        const yearlyDisplay = s.yearlyPaid > 0 ?
            `<span class="font-semibold">UGX ${formatAmount(s.yearlyPaid)}</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedYearly)}</span>` :
            `<span class="text-gray-400">UGX 0</span><br><span class="text-xs text-gray-400">/ ${formatAmount(s.expectedYearly)}</span>`;
        
        // Balance display with color
        let balanceDisplay = '';
        let balanceClass = '';
        if (s.totalBalance < 0) {
            balanceDisplay = `Credit: UGX ${formatAmount(Math.abs(s.totalBalance))}`;
            balanceClass = 'text-blue-600';
        } else if (s.totalBalance > 0) {
            balanceDisplay = `UGX ${formatAmount(s.totalBalance)}`;
            balanceClass = 'text-red-600 font-bold';
        } else {
            balanceDisplay = 'UGX 0';
            balanceClass = 'text-green-600';
        }
        
        return `
            <tr class="border-b hover:bg-gray-50 ${rowClass} student-row"
                data-student-id="${s.id}"
                data-student-name="${(s.firstName + ' ' + s.lastName).toLowerCase()}"
                data-admission="${s.admissionNumber.toLowerCase()}"
                data-class="${s.currentClass}"
                data-level="${s.classLevel}"
                data-status="${s.status}"
                data-parent="${(s.parentName || '').toLowerCase()}">
                <td class="p-2 text-center"><input type="checkbox" class="student-checkbox" value="${s.id}" onchange="updateSelectedCount()"></td>
                <td class="p-2 font-mono text-xs font-semibold">${s.admissionNumber}</td>
                <td class="p-2">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                            ${s.firstName.charAt(0)}${s.lastName.charAt(0)}
                        </div>
                        <div>
                            <p class="font-medium">${escapeHtml(s.firstName)} ${escapeHtml(s.lastName)}</p>
                            <p class="text-xs text-gray-500">${s.gender} | ${s.enrollmentDate ? new Date(s.enrollmentDate).toLocaleDateString() : 'N/A'}</p>
                        </div>
                    </div>
                </td>
                <td class="p-2"><span class="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800">${s.currentClass}</span></td>
                <td class="p-2">
                    <p class="text-sm">${escapeHtml(s.parentName)}</p>
                    <p class="text-xs text-gray-500">📞 ${s.parentPhone}</p>
                </td>
                <td class="p-2 text-right">${tuitionDisplay}</td>
                <td class="p-2 text-right">${termlyDisplay}</td>
                ${isFirstTerm ? `<td class="p-2 text-right">${oneTimeDisplay}</td>` : ''}
                ${isFirstTerm ? `<td class="p-2 text-right">${yearlyDisplay}</td>` : ''}
                <td class="p-2 text-right font-semibold text-green-600">UGX ${formatAmount(s.totalPaid)}</td>
                <td class="p-2 text-right ${balanceClass}">${balanceDisplay}</td>
                <td class="p-2"><span class="px-2 py-0.5 rounded-full text-xs ${s.statusColor}">${s.statusIcon} ${s.status}</span></td>
                <td class="p-2 text-center">
                    <div class="flex justify-center gap-1">
                        <button onclick="viewStudentDetails('${s.id}')" class="text-blue-600 hover:text-blue-800 p-1" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button onclick="viewStudentFeeDetailsEnhanced('${s.id}')" class="text-purple-600 hover:text-purple-800 p-1" title="Fee Details">
                            <i class="fas fa-money-bill-wave"></i>
                        </button>
                        <button onclick="makePaymentForStudent('${s.id}')" class="text-green-600 hover:text-green-800 p-1" title="Make Payment">
                            <i class="fas fa-receipt"></i>
                        </button>
                        <button onclick="editStudentInfo('${s.id}')" class="text-orange-600 hover:text-orange-800 p-1" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="deleteStudentEntry('${s.id}')" class="text-red-600 hover:text-red-800 p-1" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                 </td>
             </tr>
        `;
    }).join('');
}

// ==================== INITIALIZE STUDENT FILTERS ====================

function initializeStudentFilters() {
    const searchInput = document.getElementById('studentSearchInput');
    const classFilter = document.getElementById('classFilterInput');
    const levelFilter = document.getElementById('levelFilterInput');
    const statusFilter = document.getElementById('statusFilterInput');
    
    const applyFilters = () => {
        const searchTerm = (searchInput?.value || '').toLowerCase().trim();
        const classValue = classFilter?.value || '';
        const levelValue = levelFilter?.value || '';
        const statusValue = statusFilter?.value || '';
        
        const rows = document.querySelectorAll('#studentsTableBody .student-row');
        let visibleCount = 0;
        
        rows.forEach(row => {
            const studentName = row.getAttribute('data-student-name') || '';
            const admission = row.getAttribute('data-admission') || '';
            const parent = row.getAttribute('data-parent') || '';
            const studentClass = row.getAttribute('data-class') || '';
            const studentLevel = row.getAttribute('data-level') || '';
            const studentStatus = row.getAttribute('data-status') || '';
            
            let matchesSearch = true;
            if (searchTerm) {
                matchesSearch = studentName.includes(searchTerm) || 
                               admission.includes(searchTerm) || 
                               parent.includes(searchTerm);
            }
            
            let matchesClass = true;
            if (classValue) matchesClass = studentClass === classValue;
            
            let matchesLevel = true;
            if (levelValue) matchesLevel = studentLevel === levelValue;
            
            let matchesStatus = true;
            if (statusValue) matchesStatus = studentStatus === statusValue;
            
            const isVisible = matchesSearch && matchesClass && matchesLevel && matchesStatus;
            row.style.display = isVisible ? '' : 'none';
            if (isVisible) visibleCount++;
        });
        
        const filteredCountSpan = document.getElementById('filteredStudentCount');
        if (filteredCountSpan) filteredCountSpan.innerText = visibleCount;
    };
    
    if (searchInput) {
        searchInput.addEventListener('input', applyFilters);
        searchInput.addEventListener('keyup', applyFilters);
    }
    if (classFilter) classFilter.addEventListener('change', applyFilters);
    if (levelFilter) levelFilter.addEventListener('change', applyFilters);
    if (statusFilter) statusFilter.addEventListener('change', applyFilters);
    
    applyFilters();
}

// ==================== SELECTION FUNCTIONS ====================



function toggleSelectAllStudents() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const checkboxes = document.querySelectorAll('.student-checkbox');
    const isChecked = selectAllCheckbox?.checked || false;
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
        if (isChecked) {
            selectedStudentIds.add(checkbox.value);
        } else {
            selectedStudentIds.delete(checkbox.value);
        }
    });
    updateSelectedCount();
}

function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('.student-checkbox:checked');
    selectedStudentIds.clear();
    checkboxes.forEach(cb => selectedStudentIds.add(cb.value));
    
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const totalCheckboxes = document.querySelectorAll('.student-checkbox').length;
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = selectedStudentIds.size === totalCheckboxes && totalCheckboxes > 0;
        selectAllCheckbox.indeterminate = selectedStudentIds.size > 0 && selectedStudentIds.size < totalCheckboxes;
    }
}

function selectAllStudents() {
    const checkboxes = document.querySelectorAll('.student-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
        selectedStudentIds.add(checkbox.value);
    });
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) selectAllCheckbox.checked = true;
    updateSelectedCount();
}

function clearStudentSelection() {
    const checkboxes = document.querySelectorAll('.student-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    selectedStudentIds.clear();
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    updateSelectedCount();
}

function sendBulkPaymentReminders() {
    if (selectedStudentIds.size === 0) {
        alert('Please select at least one student to send reminders');
        return;
    }
    
    const selectedStudents = window.allStudentsEnhanced?.filter(s => selectedStudentIds.has(s.id)) || [];
    const overdueStudents = selectedStudents.filter(s => s.totalBalance > 0);
    
    if (overdueStudents.length === 0) {
        alert('No overdue balances among selected students');
        return;
    }
    
    let message = `📧 Payment Reminders would be sent to ${overdueStudents.length} students:\n\n`;
    overdueStudents.forEach(s => {
        message += `• ${s.firstName} ${s.lastName} (${s.admissionNumber}) - Balance: UGX ${Math.round(s.totalBalance).toLocaleString()}\n`;
    });
    message += `\nTotal Outstanding: UGX ${overdueStudents.reduce((sum, s) => sum + s.totalBalance, 0).toLocaleString()}`;
    
    alert(message);
}

// ==================== EXPORT ALL STUDENTS DATA ====================

function exportAllStudentsData() {
    const students = window.allStudentsEnhanced || [];
    if (students.length === 0) {
        alert('No students to export');
        return;
    }
    
    const exportData = students.map(s => ({
        'Admission Number': s.admissionNumber,
        'First Name': s.firstName,
        'Last Name': s.lastName,
        'Gender': s.gender,
        'Class': s.currentClass,
        'Parent Name': s.parentName,
        'Parent Phone': s.parentPhone,
        'Parent Email': s.parentEmail,
        'Address': s.address,
        'Fee Structure': s.feeStructureName,
        'Bursary': s.bursaryName || 'None',
        'Discount': s.discountDisplay,
        'Status': s.status,
        
        'Tuition Expected': s.expectedTuition,
        'Tuition Paid': s.tuitionPaid,
        'Tuition Balance': s.tuitionBalance,
        'Tuition Rate': s.tuitionRate + '%',
        
        'Termly Expected': s.expectedTermly,
        'Termly Paid': s.termlyPaid,
        'Termly Balance': s.termlyBalance,
        'Termly Rate': s.termlyRate + '%',
        
        'One-Time Expected': s.expectedOneTime,
        'One-Time Paid': s.oneTimePaid,
        'One-Time Balance': s.oneTimeBalance,
        'One-Time Rate': s.oneTimeRate + '%',
        
        'Yearly Expected': s.expectedYearly,
        'Yearly Paid': s.yearlyPaid,
        'Yearly Balance': s.yearlyBalance,
        'Yearly Rate': s.yearlyRate + '%',
        
        'Total Expected': s.totalExpected,
        'Total Paid': s.totalPaid,
        'Total Balance': s.totalBalance,
        'Total Collection Rate': s.totalRate + '%',
        
        'Payment Count': s.paymentCount,
        'Enrollment Date': new Date(s.enrollmentDate).toLocaleDateString()
    }));
    
    const headers = Object.keys(exportData[0]);
    const csvRows = [headers.join(',')];
    
    for (const row of exportData) {
        const values = headers.map(header => {
            const value = row[header] !== undefined && row[header] !== null ? row[header] : '';
            return `"${String(value).replace(/"/g, '""')}"`;
        });
        csvRows.push(values.join(','));
    }
    
    const csv = csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `all_students_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    alert(`✅ ${students.length} students exported successfully!`);
}

// ==================== HELPER FUNCTIONS ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make functions global
window.showStudentList = showStudentList;
window.toggleSelectAllStudents = toggleSelectAllStudents;
window.updateSelectedCount = updateSelectedCount;
window.selectAllStudents = selectAllStudents;
window.clearStudentSelection = clearStudentSelection;
window.sendBulkPaymentReminders = sendBulkPaymentReminders;
window.exportAllStudentsData = exportAllStudentsData;
window.viewStudentDetails = viewStudentDetails;
window.viewStudentFeeDetailsEnhanced = viewStudentFeeDetailsEnhanced;
window.makePaymentForStudent = makePaymentForStudent;
window.editStudentInfo = editStudentInfo;
window.deleteStudentEntry = deleteStudentEntry;

console.log('All Students Page v5.0 - Hyper-Statistical Version Loaded!');

// ==================== RENDER COMPLETE STUDENT ROWS ====================
function renderCompleteStudentRows(students) {
    if (!students || students.length === 0) {
        return '<tr><td colspan="11" class="text-center p-8 text-gray-500">No students found. Click "Register New Student" to add one.</td></tr>';
    }
    
    return students.map(student => {
        const initials = `${student.firstName?.charAt(0) || ''}${student.lastName?.charAt(0) || ''}`.toUpperCase();
        const avatarColors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500'];
        const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];
        
        const feeStructureName = student.feeStructure?.name || 'Not Assigned';
        const bursaryText = student.appliedBursary ? 
            `<br><span class="text-xs text-green-600">🎖️ ${student.appliedBursary.name} (${student.discountDisplay})</span>` : '';
        
        return `
            <tr class="border-b hover:bg-gray-50 student-row" 
                data-student-id="${student.id}"
                data-student-name="${student.firstName} ${student.lastName}".toLowerCase()
                data-admission-number="${student.admissionNumber}"
                data-student-class="${student.currentClass || ''}"
                data-student-status="${student.status}">
                <td class="p-2 font-mono text-xs font-semibold">${student.admissionNumber || 'N/A'}</td>
                <td class="p-2">
                    <div class="flex items-center space-x-2">
                        <div class="w-7 h-7 ${avatarColor} rounded-full flex items-center justify-center text-white text-xs font-bold">${initials || 'S'}</div>
                        <div>
                            <p class="font-medium text-sm">${student.firstName || ''} ${student.lastName || ''}</p>
                            <p class="text-xs text-gray-500">${student.gender || ''}</p>
                        </div>
                    </div>
                </td>
                <td class="p-2"><span class="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800">${student.currentClass || 'Not Assigned'}</span></td>
                <td class="p-2 text-xs">
                    ${feeStructureName}
                    ${bursaryText}
                </td>
                <td class="p-2 text-right">
                    <span class="font-semibold">UGX ${student.tuitionPaid.toLocaleString()}</span>
                    <div class="text-xs text-gray-400">/ ${student.expectedTuition.toLocaleString()}</div>
                    ${student.tuitionBalance > 0 ? `<div class="text-xs text-red-500">Due: UGX ${student.tuitionBalance.toLocaleString()}</div>` : 
                      student.tuitionBalance < 0 ? `<div class="text-xs text-blue-500">Credit: UGX ${Math.abs(student.tuitionBalance).toLocaleString()}</div>` : 
                      `<div class="text-xs text-green-500">✓ Paid</div>`}
                </td>
                <td class="p-2 text-right">
                    <span class="font-semibold">UGX ${student.activityPaid.toLocaleString()}</span>
                    <div class="text-xs text-gray-400">/ ${student.expectedActivityTotal.toLocaleString()}</div>
                    ${student.activityBalance > 0 ? `<div class="text-xs text-orange-500">Due: UGX ${student.activityBalance.toLocaleString()}</div>` : 
                      student.expectedActivityTotal > 0 ? `<div class="text-xs text-green-500">✓ Paid</div>` : ''}
                </td>
                <td class="p-2 text-right">
                    <span class="font-semibold">UGX ${student.developmentPaid.toLocaleString()}</span>
                    <div class="text-xs text-gray-400">/ ${student.expectedDevelopmentTotal.toLocaleString()}</div>
                    ${student.developmentBalance > 0 ? `<div class="text-xs text-orange-500">Due: UGX ${student.developmentBalance.toLocaleString()}</div>` : 
                      student.expectedDevelopmentTotal > 0 ? `<div class="text-xs text-green-500">✓ Paid</div>` : ''}
                </td>
                <td class="p-2 text-right font-semibold text-green-600">UGX ${student.totalPaid.toLocaleString()} </td>
                <td class="p-2 text-right font-bold ${student.totalBalance > 0 ? 'text-red-600' : student.totalBalance < 0 ? 'text-blue-600' : 'text-green-600'}">
                    ${student.totalBalance > 0 ? `UGX ${student.totalBalance.toLocaleString()}` : 
                      student.totalBalance < 0 ? `Credit: UGX ${Math.abs(student.totalBalance).toLocaleString()}` : 'UGX 0'}
                </td>
                <td class="p-2"><span class="px-2 py-0.5 rounded-full text-xs ${student.statusColor}">${student.statusIcon} ${student.status}</span></td>
                <td class="p-2 text-center">
                    <div class="flex justify-center space-x-2">
                        <button onclick="viewStudentDetails('${student.id}')" class="text-blue-600 hover:text-blue-800" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button onclick="viewStudentFeeDetails('${student.id}')" class="text-purple-600 hover:text-purple-800" title="Fee Details">
                            <i class="fas fa-money-bill-wave"></i>
                        </button>
                        <button onclick="makePaymentForStudent('${student.id}')" class="text-green-600 hover:text-green-800" title="Make Payment">
                            <i class="fas fa-receipt"></i>
                        </button>
                        <button onclick="editStudentInfo('${student.id}')" class="text-orange-600 hover:text-orange-800" title="Edit Student">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="deleteStudentEntry('${student.id}')" class="text-red-600 hover:text-red-800" title="Delete Student">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ==================== FILTERS ====================
function initializeFilters() {
    const searchInput = document.getElementById('searchInput');
    const classFilter = document.getElementById('classFilter');
    const statusFilter = document.getElementById('statusFilter');
    
    function filterTable() {
        const searchTerm = searchInput?.value.toLowerCase().trim() || '';
        const classValue = classFilter?.value || '';
        const statusValue = statusFilter?.value || '';
        
        const rows = document.querySelectorAll('#studentsTableBody .student-row');
        let visibleCount = 0;
        
        rows.forEach(row => {
            const studentName = (row.getAttribute('data-student-name') || '').toLowerCase();
            const admissionNumber = (row.getAttribute('data-admission-number') || '').toLowerCase();
            const studentClass = row.getAttribute('data-student-class') || '';
            const studentStatus = row.getAttribute('data-student-status') || '';
            
            let matchesSearch = true;
            if (searchTerm) {
                matchesSearch = studentName.includes(searchTerm) || admissionNumber.includes(searchTerm);
            }
            
            let matchesClass = true;
            if (classValue) {
                matchesClass = studentClass === classValue;
            }
            
            let matchesStatus = true;
            if (statusValue) {
                matchesStatus = studentStatus === statusValue;
            }
            
            const isVisible = matchesSearch && matchesClass && matchesStatus;
            row.style.display = isVisible ? '' : 'none';
            if (isVisible) visibleCount++;
        });
        
        const totalSpan = document.getElementById('statTotalStudents');
        if (totalSpan) totalSpan.innerText = visibleCount;
    }
    
    if (searchInput) {
        searchInput.addEventListener('input', filterTable);
        searchInput.addEventListener('keyup', filterTable);
    }
    if (classFilter) classFilter.addEventListener('change', filterTable);
    if (statusFilter) statusFilter.addEventListener('change', filterTable);
    
    filterTable();
}

// ==================== DELETE STUDENT ====================
async function deleteStudentEntry(studentId) {
    const student = window.allStudentsData?.find(s => s.id === studentId);
    const studentName = student ? `${student.firstName} ${student.lastName}` : 'this student';
    
    if (confirm(`⚠️ Are you sure you want to delete ${studentName}?\n\nThis action cannot be undone.`)) {
        const confirmation = prompt('Type "DELETE" to confirm deletion:');
        if (confirmation === 'DELETE') {
            try {
                const response = await fetch(`/api/students/${studentId}`, { method: 'DELETE' });
                if (response.ok) {
                    alert(`✅ ${studentName} has been deleted successfully`);
                    showStudentList();
                } else {
                    alert('❌ Error deleting student');
                }
            } catch (error) {
                alert('Network error: ' + error.message);
            }
        } else {
            alert('Deletion cancelled');
        }
    }
}

// ==================== MAKE PAYMENT ====================
function makePaymentForStudent(studentId) {
    closeModal();
    const feeLink = document.querySelector('.sidebar-item[onclick*="showFeeManagement"]');
    if (feeLink) {
        feeLink.click();
        setTimeout(() => {
            const studentSelect = document.getElementById('collectStudentSelect');
            if (studentSelect) {
                studentSelect.value = studentId;
                studentSelect.dispatchEvent(new Event('change'));
            }
            const collectTab = document.querySelector('.fee-tab[data-tab="collect"]');
            if (collectTab) collectTab.click();
        }, 500);
    } else {
        showFeeManagement();
        setTimeout(() => {
            const studentSelect = document.getElementById('collectStudentSelect');
            if (studentSelect) {
                studentSelect.value = studentId;
                studentSelect.dispatchEvent(new Event('change'));
            }
        }, 800);
    }
}

// ==================== CLOSE MODAL ====================
function closeModal() {
    const modal = document.querySelector('.fixed.inset-0');
    if (modal) modal.remove();
}

// Make all functions global
window.showStudentList = showStudentList;
window.viewStudentDetails = viewStudentDetails;
window.viewStudentFeeDetails = viewStudentFeeDetails;
window.editStudentInfo = editStudentInfo;
window.deleteStudentEntry = deleteStudentEntry;
window.makePaymentForStudent = makePaymentForStudent;
window.closeModal = closeModal;
// ==================== RENDER STUDENT TABLE ROWS ====================
function renderStudentsTableRows(students) {
    if (!students || students.length === 0) {
        return ' hilab<td colspan="11" class="text-center p-8 text-gray-500">No students found</td></tr>';
    }
    
    return students.map(student => {
        const initials = `${student.firstName?.charAt(0) || ''}${student.lastName?.charAt(0) || ''}`.toUpperCase();
        const avatarColors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500'];
        const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];
        
        const feeStructureName = student.feeStructure?.name || 'Not Assigned';
        const bursaryText = student.appliedBursary ? 
            `<br><span class="text-xs text-green-600">🎖️ ${student.appliedBursary.name} (${student.discountDisplay} - Applied to Tuition only)</span>` : '';
        
        return `
            <tr class="border-b hover:bg-gray-50 student-row" 
                data-student-id="${student.id}"
                data-student-name="${student.firstName} ${student.lastName}".toLowerCase()
                data-admission-number="${student.admissionNumber}"
                data-student-class="${student.currentClass || ''}"
                data-fee-status="${student.statusValue}">
                <td class="p-3 font-mono text-sm">${student.admissionNumber || 'N/A'}</td>
                <td class="p-3">
                    <div class="flex items-center space-x-2">
                        <div class="w-8 h-8 ${avatarColor} rounded-full flex items-center justify-center text-white text-sm font-bold">${initials}</div>
                        <div>
                            <p class="font-medium">${student.firstName || ''} ${student.lastName || ''}</p>
                            <p class="text-xs text-gray-500">${student.enrolledAt ? new Date(student.enrolledAt).toLocaleDateString() : 'N/A'}</p>
                        </div>
                    </div>
                </td>
                <td class="p-3"><span class="px-2 py-1 rounded-full text-xs bg-purple-100 text-purple-800">${student.currentClass || 'Not Assigned'}</span></td>
                <td class="p-3 text-sm">${feeStructureName}${bursaryText}</td>
                <td class="p-3 text-right">
                    <span class="font-semibold">UGX ${student.tuitionPaid.toLocaleString()}</span><br>
                    <span class="text-xs text-gray-500">/ ${student.expectedTuition.toLocaleString()}</span>
                    ${student.tuitionBalance > 0 ? `<div class="text-xs text-red-600">Due: UGX ${student.tuitionBalance.toLocaleString()}</div>` : 
                      student.tuitionBalance < 0 ? `<div class="text-xs text-blue-600">Credit: UGX ${Math.abs(student.tuitionBalance).toLocaleString()}</div>` : 
                      `<div class="text-xs text-green-600">Paid</div>`}
                </td>
                <td class="p-3 text-right">
                    <span class="font-semibold">UGX ${student.activityPaid.toLocaleString()}</span><br>
                    <span class="text-xs text-gray-500">/ ${student.expectedActivityTotal.toLocaleString()}</span>
                    ${student.activityBalance > 0 ? `<div class="text-xs text-orange-600">Due: UGX ${student.activityBalance.toLocaleString()}</div>` : 
                      student.activityBalance <= 0 && student.expectedActivityTotal > 0 ? `<div class="text-xs text-green-600">Paid</div>` : ''}
                </td>
                <td class="p-3 text-right">
                    <span class="font-semibold">UGX ${student.developmentPaid.toLocaleString()}</span><br>
                    <span class="text-xs text-gray-500">/ ${student.expectedDevelopmentTotal.toLocaleString()}</span>
                    ${student.developmentBalance > 0 ? `<div class="text-xs text-orange-600">Due: UGX ${student.developmentBalance.toLocaleString()}</div>` : 
                      student.developmentBalance <= 0 && student.expectedDevelopmentTotal > 0 ? `<div class="text-xs text-green-600">Paid</div>` : ''}
                </td>
                <td class="p-3 text-right font-semibold ${student.totalPaid > 0 ? 'text-green-600' : 'text-gray-500'}">UGX ${student.totalPaid.toLocaleString()}</td>
                <td class="p-3 text-right font-bold ${student.totalBalance > 0 ? 'text-red-600' : student.totalBalance < 0 ? 'text-blue-600' : 'text-green-600'}">
                    ${student.totalBalance > 0 ? `UGX ${student.totalBalance.toLocaleString()}` : 
                      student.totalBalance < 0 ? `(Credit: UGX ${Math.abs(student.totalBalance).toLocaleString()})` : 'UGX 0'}
                </td>
                <td class="p-3"><span class="px-2 py-1 rounded-full text-xs ${student.statusColor}">${student.status}</span></td>
                <td class="p-3">
                    <div class="flex space-x-2">
                        <button onclick="viewStudentDetails('${student.id}')" class="text-blue-600 hover:text-blue-800" title="View Details"><i class="fas fa-eye"></i></button>
                        <button onclick="editStudentInfo('${student.id}')" class="text-green-600 hover:text-green-800" title="Edit Student"><i class="fas fa-edit"></i></button>
                        <button onclick="viewStudentFeeDetails('${student.id}')" class="text-purple-600 hover:text-purple-800" title="Fee Details"><i class="fas fa-money-bill-wave"></i></button>
                        <button onclick="makePaymentForStudent('${student.id}')" class="text-indigo-600 hover:text-indigo-800" title="Make Payment"><i class="fas fa-receipt"></i></button>
                        <button onclick="deleteStudentEntry('${student.id}')" class="text-red-600 hover:text-red-800" title="Delete Student"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ==================== INITIALIZE SEARCH AND FILTERS ====================
function initializeStudentFilters() {
    const searchInput = document.getElementById('searchStudentInput');
    const classFilter = document.getElementById('filterClass');
    const statusFilter = document.getElementById('filterFeeStatus');
    
    function filterStudents() {
        const searchTerm = searchInput?.value.toLowerCase().trim() || '';
        const classValue = classFilter?.value || '';
        const statusValue = statusFilter?.value || '';
        
        const rows = document.querySelectorAll('#studentsTableBody .student-row');
        let visibleCount = 0;
        
        rows.forEach(row => {
            const studentName = (row.getAttribute('data-student-name') || '').toLowerCase();
            const admissionNumber = (row.getAttribute('data-admission-number') || '').toLowerCase();
            const studentClass = row.getAttribute('data-student-class') || '';
            const feeStatus = row.getAttribute('data-fee-status') || '';
            
            // Search match
            let matchesSearch = true;
            if (searchTerm) {
                matchesSearch = studentName.includes(searchTerm) || admissionNumber.includes(searchTerm);
            }
            
            // Class filter match
            let matchesClass = true;
            if (classValue) {
                matchesClass = studentClass === classValue;
            }
            
            // Status filter match
            let matchesStatus = true;
            if (statusValue) {
                matchesStatus = feeStatus === statusValue;
            }
            
            const isVisible = matchesSearch && matchesClass && matchesStatus;
            row.style.display = isVisible ? '' : 'none';
            if (isVisible) visibleCount++;
        });
        
        // Update total count
        const totalSpan = document.getElementById('statTotalStudents');
        if (totalSpan) totalSpan.innerText = visibleCount;
        
        // Show message if no results
        const tbody = document.getElementById('studentsTableBody');
        if (tbody && visibleCount === 0 && rows.length > 0) {
            const existingMsg = document.getElementById('noResultsMsg');
            if (!existingMsg) {
                tbody.insertAdjacentHTML('beforeend', '<tr id="noResultsMsg"><td colspan="11" class="text-center p-8 text-gray-500">No students match your search criteria</td></tr>');
            }
        } else {
            const noResultsMsg = document.getElementById('noResultsMsg');
            if (noResultsMsg) noResultsMsg.remove();
        }
    }
    
    // Add event listeners
    if (searchInput) {
        searchInput.addEventListener('input', filterStudents);
        searchInput.addEventListener('keyup', filterStudents);
    }
    if (classFilter) classFilter.addEventListener('change', filterStudents);
    if (statusFilter) statusFilter.addEventListener('change', filterStudents);
    
    // Initial filter to ensure everything is set
    filterStudents();
}

// ==================== VIEW STUDENT DETAILS ====================


// Helper function to render activity items section
function renderActivityItemsSection(items, title, icon, color) {
    if (!items || items.length === 0) return '';
    
    const totalItems = items.length;
    const paidItems = items.filter(i => i.isPaid).length;
    const totalAmount = items.reduce((sum, i) => sum + i.totalAmount, 0);
    const paidAmount = items.reduce((sum, i) => sum + (i.amountPaid + (i.itemsBrought * i.unitPrice)), 0);
    const bgColor = color === 'purple' ? 'bg-purple-50' : color === 'green' ? 'bg-green-50' : 'bg-orange-50';
    const borderColor = color === 'purple' ? 'border-purple-200' : color === 'green' ? 'border-green-200' : 'border-orange-200';
    
    return `
        <div class="mb-4">
            <h3 class="font-bold text-lg mb-3">${icon} ${title}</h3>
            <div class="${bgColor} border ${borderColor} rounded-lg p-4">
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div class="bg-white rounded p-2 text-center">
                        <p class="text-xs text-gray-500">Total Items</p>
                        <p class="text-xl font-bold">${totalItems}</p>
                    </div>
                    <div class="bg-white rounded p-2 text-center">
                        <p class="text-xs text-gray-500">Paid Items</p>
                        <p class="text-xl font-bold text-green-600">${paidItems}</p>
                    </div>
                    <div class="bg-white rounded p-2 text-center">
                        <p class="text-xs text-gray-500">Total Amount</p>
                        <p class="text-xl font-bold">UGX ${totalAmount.toLocaleString()}</p>
                    </div>
                    <div class="bg-white rounded p-2 text-center">
                        <p class="text-xs text-gray-500">Paid Amount</p>
                        <p class="text-xl font-bold text-green-600">UGX ${paidAmount.toLocaleString()}</p>
                    </div>
                </div>
                
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead class="bg-gray-100">
                            <tr>
                                <th class="p-2">Item</th>
                                <th class="p-2">Component</th>
                                <th class="p-2 text-right">Qty Required</th>
                                <th class="p-2 text-right">Unit Price</th>
                                <th class="p-2 text-right">Total</th>
                                <th class="p-2">Status</th>
                                <th class="p-2">Payment Type</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map(item => `
                                <tr class="border-b">
                                    <td class="p-2">${item.name}</td>
                                    <td class="p-2 text-xs">${item.componentName}</td>
                                    <td class="p-2 text-right">${item.quantity}</td>
                                    <td class="p-2 text-right">UGX ${item.unitPrice.toLocaleString()}</td>
                                    <td class="p-2 text-right">UGX ${item.totalAmount.toLocaleString()}</td>
                                    <td class="p-2">
                                        <span class="px-2 py-0.5 rounded-full text-xs ${item.isPaid ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                                            ${item.isPaid ? '✓ Paid' : '✗ Unpaid'}
                                        </span>
                                    </td>
                                    <td class="p-2">
                                        ${item.paymentType === 'paid_cash' ? '<span class="text-green-600">💵 Cash</span>' : 
                                          item.paymentType === 'brought_item' ? '<span class="text-blue-600">📦 Item Brought</span>' : '-'}
                                     </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}



// ==================== DELETE STUDENT ====================
async function deleteStudentEntry(studentId) {
    if (confirm('⚠️ Are you sure you want to delete this student? This action cannot be undone.')) {
        try {
            const response = await fetch(`/api/students/${studentId}`, { method: 'DELETE' });
            if (response.ok) {
                alert('✅ Student deleted successfully');
                showStudentList();
            } else {
                const error = await response.json();
                alert('❌ Error deleting student: ' + (error.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Network error: ' + error.message);
        }
    }
}

// ==================== VIEW STUDENT FEE DETAILS ====================


// ==================== MAKE PAYMENT FOR STUDENT ====================
function makePaymentForStudent(studentId) {
    closeModal();
    const feeLink = document.querySelector('.sidebar-item[onclick*="showFeeManagement"]');
    if (feeLink) {
        feeLink.click();
        setTimeout(() => {
            const studentSelect = document.getElementById('collectStudentSelect');
            if (studentSelect) {
                studentSelect.value = studentId;
                studentSelect.dispatchEvent(new Event('change'));
            }
            const collectTab = document.querySelector('.fee-tab[data-tab="collect"]');
            if (collectTab) collectTab.click();
        }, 500);
    } else {
        showFeeManagement();
        setTimeout(() => {
            const studentSelect = document.getElementById('collectStudentSelect');
            if (studentSelect) {
                studentSelect.value = studentId;
                studentSelect.dispatchEvent(new Event('change'));
            }
        }, 800);
    }
}

// ==================== EXPORT STUDENTS DATA ====================
function exportStudentsData() {
    const students = window.allStudentsData || [];
    if (students.length === 0) {
        alert('No students to export');
        return;
    }
    
    const exportData = students.map(s => ({
        'Admission Number': s.admissionNumber,
        'First Name': s.firstName,
        'Last Name': s.lastName,
        'Gender': s.gender,
        'Class': s.currentClass,
        'Fee Structure': s.feeStructure?.name || 'Not Assigned',
        'Bursary': s.appliedBursary?.name || 'None',
        'Expected Tuition': s.expectedTuition,
        'Tuition Paid': s.tuitionPaid,
        'Tuition Balance': s.tuitionBalance,
        'Expected Activity': s.expectedActivityTotal,
        'Activity Paid': s.activityPaid,
        'Activity Balance': s.activityBalance,
        'Expected Development': s.expectedDevelopmentTotal,
        'Development Paid': s.developmentPaid,
        'Development Balance': s.developmentBalance,
        'Total Paid': s.totalPaid,
        'Total Expected': s.totalExpected,
        'Balance': s.totalBalance,
        'Status': s.status,
        'Parent Name': s.parentInfo?.name,
        'Parent Phone': s.parentInfo?.phone,
        'Parent Email': s.parentInfo?.email,
        'Address': s.address
    }));
    
    // Create CSV
    const headers = Object.keys(exportData[0]);
    const csvRows = [headers.join(',')];
    
    for (const row of exportData) {
        const values = headers.map(header => {
            const value = row[header] || '';
            return `"${String(value).replace(/"/g, '""')}"`;
        });
        csvRows.push(values.join(','));
    }
    
    const csv = csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `students_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    alert('✅ Students data exported successfully');
}

// ==================== CLOSE MODAL ====================
function closeModal() {
    const modal = document.querySelector('.fixed.inset-0');
    if (modal) modal.remove();
}

// Make all functions globally available
window.showStudentList = showStudentList;
window.viewStudentDetails = viewStudentDetails;
window.editStudentInfo = editStudentInfo;
window.deleteStudentEntry = deleteStudentEntry;
window.viewStudentFeeDetails = viewStudentFeeDetails;
window.makePaymentForStudent = makePaymentForStudent;
window.exportStudentsData = exportStudentsData;
window.closeModal = closeModal;
// ==================== NEW RENDER FUNCTION WITH SEPARATE FEE TYPES ====================
function renderStudentRowSeparate(student) {
    const initials = `${student.firstName?.charAt(0) || ''}${student.lastName?.charAt(0) || ''}`.toUpperCase();
    const avatarColors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500'];
    const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];
    
    const feeStructureName = student.feeStructure?.name || 'Not Assigned';
    
    // Format bursary display correctly
    let bursaryText = '';
    if (student.appliedBursary) {
        if (student.appliedBursary.type === 'percentage') {
            bursaryText = `<br><span class="text-xs text-green-600">🎖️ ${student.appliedBursary.name} (${student.appliedBursary.value}% off - Applied to Tuition only)</span>`;
        } else {
            bursaryText = `<br><span class="text-xs text-green-600">🎖️ ${student.appliedBursary.name} (UGX ${student.appliedBursary.value.toLocaleString()} off - Applied to Tuition only)</span>`;
        }
    }
    
    // Display each fee type SEPARATELY
    const tuitionPaid = student.tuitionPaid || 0;
    const tuitionExpected = student.expectedTuition || 0;
    const tuitionBalance = student.tuitionBalance || (tuitionExpected - tuitionPaid);
    
    const activityPaid = student.activityPaid || 0;
    const activityExpected = student.expectedActivityTotal || 0;
    const activityBalance = activityExpected - activityPaid;
    
    const developmentPaid = student.developmentPaid || 0;
    const developmentExpected = student.expectedDevelopmentTotal || 0;
    const developmentBalance = developmentExpected - developmentPaid;
    
    const totalPaid = tuitionPaid + activityPaid + developmentPaid;
    const totalExpected = tuitionExpected + activityExpected + developmentExpected;
    const totalBalance = totalExpected - totalPaid;
    
    // Determine status based on tuition (since bursary applies to tuition)
    let statusText = 'Good Standing';
    let statusColor = 'bg-green-100 text-green-800';
    
    if (student.isOverpaid) {
        statusText = 'Credit Balance';
        statusColor = 'bg-blue-100 text-blue-800';
    } else if (tuitionBalance > tuitionExpected) {
        statusText = 'Critical Overdue';
        statusColor = 'bg-red-100 text-red-800';
    } else if (tuitionBalance > 0) {
        statusText = 'Payment Due';
        statusColor = 'bg-yellow-100 text-yellow-800';
    } else if (tuitionBalance <= 0 && activityBalance <= 0 && developmentBalance <= 0 && totalPaid > 0) {
        statusText = 'Fully Paid';
        statusColor = 'bg-green-100 text-green-800';
    }
    
    return `
        <tr class="border-b hover:bg-gray-50 ${tuitionBalance > tuitionExpected ? 'bg-red-50' : ''}">
            <td class="p-3 font-mono text-sm">${student.admissionNumber || 'N/A'}</td>
            <td class="p-3">
                <div class="flex items-center space-x-2">
                    <div class="w-8 h-8 ${avatarColor} rounded-full flex items-center justify-center text-white text-sm font-bold">${initials}</div>
                    <div>
                        <p class="font-medium">${student.firstName || ''} ${student.lastName || ''}</p>
                        <p class="text-xs text-gray-500">${student.enrolledAt ? new Date(student.enrolledAt).toLocaleDateString() : 'N/A'}</p>
                    </div>
                </div>
            </td>
            <td class="p-3"><span class="px-2 py-1 rounded-full text-xs bg-purple-100 text-purple-800">${student.currentClass || 'Not Assigned'}</span></td>
            <td class="p-3 text-sm">${feeStructureName}${bursaryText}</td>
            <td class="p-3 text-right">
                <span class="font-semibold">UGX ${tuitionPaid.toLocaleString()}</span><br>
                <span class="text-xs text-gray-500">/ ${tuitionExpected.toLocaleString()}</span>
                ${tuitionBalance > 0 ? `<div class="text-xs text-red-600">Due: UGX ${tuitionBalance.toLocaleString()}</div>` : 
                  tuitionBalance < 0 ? `<div class="text-xs text-blue-600">Credit: UGX ${Math.abs(tuitionBalance).toLocaleString()}</div>` : 
                  `<div class="text-xs text-green-600">Paid</div>`}
            </td>
            <td class="p-3 text-right">
                <span class="font-semibold">UGX ${activityPaid.toLocaleString()}</span><br>
                <span class="text-xs text-gray-500">/ ${activityExpected.toLocaleString()}</span>
                ${activityBalance > 0 ? `<div class="text-xs text-orange-600">Due: UGX ${activityBalance.toLocaleString()}</div>` : 
                  activityBalance <= 0 && activityExpected > 0 ? `<div class="text-xs text-green-600">Paid</div>` : ''}
            </td>
            <td class="p-3 text-right">
                <span class="font-semibold">UGX ${developmentPaid.toLocaleString()}</span><br>
                <span class="text-xs text-gray-500">/ ${developmentExpected.toLocaleString()}</span>
                ${developmentBalance > 0 ? `<div class="text-xs text-orange-600">Due: UGX ${developmentBalance.toLocaleString()}</div>` : 
                  developmentBalance <= 0 && developmentExpected > 0 ? `<div class="text-xs text-green-600">Paid</div>` : ''}
            </td>
            <td class="p-3 text-right font-semibold ${totalPaid > 0 ? 'text-green-600' : 'text-gray-500'}">UGX ${totalPaid.toLocaleString()}</td>
            <td class="p-3 text-right font-bold ${totalBalance > 0 ? 'text-red-600' : totalBalance < 0 ? 'text-blue-600' : 'text-green-600'}">
                ${totalBalance > 0 ? `UGX ${totalBalance.toLocaleString()}` : totalBalance < 0 ? `(Credit: UGX ${Math.abs(totalBalance).toLocaleString()})` : 'UGX 0'}
            </td>
            <td class="p-3"><span class="px-2 py-1 rounded-full text-xs ${statusColor}">${statusText}</span></td>
            <td class="p-3">
                <div class="flex space-x-2">
                    <button onclick="viewStudentSeparateDetails('${student.id}')" class="text-blue-600 hover:text-blue-800" title="View Details"><i class="fas fa-eye"></i></button>
                    <button onclick="viewStudentFeeDetailsSeparate('${student.id}')" class="text-purple-600 hover:text-purple-800" title="Fee Details"><i class="fas fa-money-bill-wave"></i></button>
                    <button onclick="makePaymentForStudentSeparate('${student.id}')" class="text-green-600 hover:text-green-800" title="Make Payment"><i class="fas fa-receipt"></i></button>
                </div>
            </td>
        </tr>
    `;
}

// ==================== UPDATED FEE DETAILS WITH TERM SELECTION ====================
// ==================== COMPLETE CORRECTED FEE DETAILS FUNCTION ====================


// ==================== UPDATE DASHBOARD TO SHOW TERM INFO ====================
// ==================== COMPLETE PROFESSIONAL DASHBOARD PAGE ====================


// ==================== SCHOOL SETUP DETECTION ====================
async function checkSchoolSetup() {
    if (isCheckingSetup) return;
    isCheckingSetup = true;
    
    try {
        const response = await fetch('/api/school');
        const data = await response.json();
        
        const schoolExists = data.school && (
            data.school.schoolName || 
            data.school.name || 
            data.school.address || 
            data.school.phone
        );
        
        const [classesRes, studentsRes, teachersRes] = await Promise.all([
            fetch('/api/school/classes'),
            fetch('/api/students'),
            fetch('/api/teachers')
        ]);
        
        const classes = await classesRes.json();
        const students = await studentsRes.json();
        const teachers = await teachersRes.json();
        
        const hasData = (classes && classes.length > 0) || 
                       (students && students.length > 0) || 
                       (teachers && teachers.length > 0);
        
        if (schoolExists || hasData) {
            currentSchool = data.school || {};
            currentSettings = data.settings;
            
            if (!currentSchool.schoolName && currentSchool.name) {
                currentSchool.schoolName = currentSchool.name;
            } else if (!currentSchool.schoolName) {
                currentSchool.schoolName = currentSchool.address || 'My School';
            }
            
            const setupWizard = document.getElementById('setupWizard');
            if (setupWizard) setupWizard.classList.add('hidden');
            
            const sidebarSchoolName = document.getElementById('sidebarSchoolName');
            if (sidebarSchoolName) {
                sidebarSchoolName.innerText = currentSchool.schoolName ? 
                    currentSchool.schoolName.substring(0, 20) : 'School Name';
            }
            
            showDashboard();
        } else {
            const setupWizard = document.getElementById('setupWizard');
            if (setupWizard) setupWizard.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error checking setup:', error);
        const setupWizard = document.getElementById('setupWizard');
        if (setupWizard) setupWizard.classList.remove('hidden');
    } finally {
        isCheckingSetup = false;
    }
}

// ==================== SCHOOL SETUP FORM ====================
const setupForm = document.getElementById('schoolSetupForm');
if (setupForm) {
    setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const schoolData = {
            schoolName: document.getElementById('setupSchoolName').value,
            name: document.getElementById('setupSchoolName').value,
            phone: document.getElementById('setupPhone').value,
            email: document.getElementById('setupEmail').value,
            address: document.getElementById('setupAddress').value,
            motto: document.getElementById('setupMotto').value || 'Quality Education for All'
        };
        
        if (!schoolData.schoolName || !schoolData.phone || !schoolData.email || !schoolData.address) {
            alert('⚠️ Please fill in all required fields');
            return;
        }
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerText;
        submitBtn.innerText = 'Setting up...';
        submitBtn.disabled = true;
        
        try {
            const response = await fetch('/api/school/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(schoolData)
            });
            
            if (response.ok) {
                await createDefaultClasses();
                await createDefaultSubjects();
                
                alert('✅ School setup completed successfully!');
                
                const setupWizard = document.getElementById('setupWizard');
                if (setupWizard) setupWizard.classList.add('hidden');
                
                const sidebarSchoolName = document.getElementById('sidebarSchoolName');
                if (sidebarSchoolName) {
                    sidebarSchoolName.innerText += schoolData.schoolName.substring(0, 20);
                }
                
                showDashboard();
            } else {
                alert('❌ Error saving school information');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('❌ Error connecting to server');
        } finally {
            submitBtn.innerText = originalText;
            submitBtn.disabled = false;
        }
    });
}

// ==================== DEFAULT DATA CREATION ====================
async function createDefaultClasses() {
    try {
        const classesRes = await fetch('/api/school/classes');
        const existingClasses = await classesRes.json();
        
        if (existingClasses.length > 0) return;
        
        const defaultClasses = [
            { name: 'Baby Class', level: 'Nursery', order: 1 },
            { name: 'Middle Class', level: 'Nursery', order: 2 },
            { name: 'Top Class', level: 'Nursery', order: 3 },
            { name: 'P.1', level: 'LowerPrimary', order: 4 },
            { name: 'P.2', level: 'LowerPrimary', order: 5 },
            { name: 'P.3', level: 'LowerPrimary', order: 6 },
            { name: 'P.4', level: 'UpperPrimary', order: 7 },
            { name: 'P.5', level: 'UpperPrimary', order: 8 },
            { name: 'P.6', level: 'UpperPrimary', order: 9 },
            { name: 'P.7', level: 'UpperPrimary', order: 10 }
        ];
        
        for (const cls of defaultClasses) {
            await fetch('/api/school/classes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cls)
            });
        }
        console.log('Default classes created');
    } catch (error) {
        console.error('Error creating default classes:', error);
    }
}

async function createDefaultSubjects() {
    try {
        const subjectsRes = await fetch('/api/school/subjects');
        const existingSubjects = await subjectsRes.json();
        
        if (existingSubjects.length > 0) return;
        
        const defaultSubjects = [
            { name: 'English', code: 'ENG', category: 'Core' },
            { name: 'Mathematics', code: 'MATH', category: 'Core' },
            { name: 'Science', code: 'SCI', category: 'Core' },
            { name: 'Social Studies', code: 'SST', category: 'Core' },
            { name: 'Religious Education', code: 'RE', category: 'Core' },
            { name: 'Reading', code: 'READ', category: 'Core' },
            { name: 'Writing', code: 'WRIT', category: 'Core' },
            { name: 'Local Language', code: 'LOCL', category: 'Core' },
            { name: 'Agriculture', code: 'AGRI', category: 'Core' },
            { name: 'Art & Craft', code: 'ART', category: 'Elective' },
            { name: 'Physical Education', code: 'PE', category: 'Elective' },
            { name: 'Numeracy', code: 'NUM', category: 'Core' },
            { name: 'Literacy', code: 'LIT', category: 'Core' }
        ];
        
        for (const subject of defaultSubjects) {
            await fetch('/api/school/subjects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(subject)
            });
        }
        console.log('Default subjects created');
    } catch (error) {
        console.error('Error creating default subjects:', error);
    }
}

// ==================== NOTIFICATIONS ====================
function loadNotifications() {
    const saved = localStorage.getItem('notifications');
    if (saved) {
        notifications = JSON.parse(saved);
    } else {
        notifications = [
            { id: 1, message: 'Welcome to Uganda School System!', date: new Date().toISOString(), read: false }
        ];
        saveNotifications();
    }
    updateNotificationBadge();
}

function saveNotifications() {
    localStorage.setItem('notifications', JSON.stringify(notifications));
}

function updateNotificationBadge() {
    const unreadCount = notifications.filter(n => !n.read).length;
    const badge = document.getElementById('notificationCount');
    if (badge) {
        badge.innerText = unreadCount;
        if (unreadCount === 0) {
            badge.classList.add('hidden');
        } else {
            badge.classList.remove('hidden');
        }
    }
}

function addNotification(message) {
    notifications.unshift({
        id: Date.now(),
        message: message,
        date: new Date().toISOString(),
        read: false
    });
    saveNotifications();
    updateNotificationBadge();
}

function showNotifications() {
    const modal = document.getElementById('notificationsModal');
    const list = document.getElementById('notificationsList');
    
    if (notifications.length === 0) {
        list.innerHTML = '<p class="text-gray-500 text-center">No notifications</p>';
    } else {
        list.innerHTML = notifications.map(n => `
            <div class="p-3 border-b ${n.read ? 'bg-white' : 'bg-blue-50'} cursor-pointer" onclick="markNotificationRead(${n.id})">
                <p class="text-sm ${!n.read ? 'font-semibold' : ''}">${n.message}</p>
                <p class="text-xs text-gray-500 mt-1">${new Date(n.date).toLocaleString()}</p>
            </div>
        `).join('');
    }
    
    modal.classList.remove('hidden');
}

function closeNotifications() {
    document.getElementById('notificationsModal').classList.add('hidden');
}

function markNotificationRead(id) {
    const notification = notifications.find(n => n.id === id);
    if (notification) {
        notification.read = true;
        saveNotifications();
        updateNotificationBadge();
        showNotifications();
    }
}

// ==================== COMPLETE PROFESSIONAL DASHBOARD PAGE ====================

// ==================== INITIALIZE ALL CHARTS ====================
function initializeAllCharts(months, monthlyData, weekDays, dailyData, levels, studentCounts, levelNames, levelCollections, paymentMethods, paymentAmounts, overdueData) {
    
    // Chart 1: Monthly Collection Trend (Line Chart)
    const monthlyCtx = document.getElementById('monthlyTrendChart')?.getContext('2d');
    if (monthlyCtx) {
        new Chart(monthlyCtx, {
            type: 'line',
            data: {
                labels: months,
                datasets: [{
                    label: 'Collection (UGX)',
                    data: monthlyData,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#3b82f6',
                    pointBorderColor: '#fff',
                    pointRadius: 5,
                    pointHoverRadius: 7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'UGX ' + context.raw.toLocaleString();
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                if (value >= 1000000) return 'UGX ' + (value / 1000000).toFixed(1) + 'M';
                                if (value >= 1000) return 'UGX ' + (value / 1000).toFixed(0) + 'K';
                                return 'UGX ' + value;
                            }
                        },
                        title: { display: true, text: 'Amount (UGX)' }
                    },
                    x: { title: { display: true, text: 'Month' } }
                }
            }
        });
    }
    
    // Chart 2: Weekly Collection (Bar Chart)
    const weeklyCtx = document.getElementById('weeklyBarChart')?.getContext('2d');
    if (weeklyCtx) {
        new Chart(weeklyCtx, {
            type: 'bar',
            data: {
                labels: weekDays,
                datasets: [{
                    label: 'Daily Collection (UGX)',
                    data: dailyData,
                    backgroundColor: '#10b981',
                    borderRadius: 8,
                    barPercentage: 0.7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'UGX ' + context.raw.toLocaleString();
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                if (value >= 1000000) return 'UGX ' + (value / 1000000).toFixed(1) + 'M';
                                if (value >= 1000) return 'UGX ' + (value / 1000).toFixed(0) + 'K';
                                return 'UGX ' + value;
                            }
                        },
                        title: { display: true, text: 'Amount (UGX)' }
                    },
                    x: { title: { display: true, text: 'Day' } }
                }
            }
        });
    }
    
    // Chart 3: Student Distribution by Level (Bar Chart)
    const levelDistCtx = document.getElementById('levelDistributionChart')?.getContext('2d');
    if (levelDistCtx) {
        new Chart(levelDistCtx, {
            type: 'bar',
            data: {
                labels: levels,
                datasets: [{
                    label: 'Number of Students',
                    data: studentCounts,
                    backgroundColor: ['#ec489a', '#3b82f6', '#8b5cf6'],
                    borderRadius: 8,
                    barPercentage: 0.6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.raw + ' students';
                            }
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 }, title: { display: true, text: 'Number of Students' } },
                    x: { title: { display: true, text: 'Education Level' } }
                }
            }
        });
    }
    
    // Chart 4: Fee Collection by Level (Bar Chart)
    const levelCollectionCtx = document.getElementById('levelCollectionChart')?.getContext('2d');
    if (levelCollectionCtx) {
        new Chart(levelCollectionCtx, {
            type: 'bar',
            data: {
                labels: levelNames,
                datasets: [{
                    label: 'Fee Collection (UGX)',
                    data: levelCollections,
                    backgroundColor: ['#ec489a', '#3b82f6', '#8b5cf6'],
                    borderRadius: 8,
                    barPercentage: 0.6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'UGX ' + context.raw.toLocaleString();
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                if (value >= 1000000) return 'UGX ' + (value / 1000000).toFixed(1) + 'M';
                                if (value >= 1000) return 'UGX ' + (value / 1000).toFixed(0) + 'K';
                                return 'UGX ' + value;
                            }
                        },
                        title: { display: true, text: 'Amount (UGX)' }
                    },
                    x: { title: { display: true, text: 'Education Level' } }
                }
            }
        });
    }
    
    // Chart 5: Payment Methods Breakdown (Bar Chart)
    const paymentCtx = document.getElementById('paymentMethodsChart')?.getContext('2d');
    if (paymentCtx) {
        new Chart(paymentCtx, {
            type: 'bar',
            data: {
                labels: paymentMethods,
                datasets: [{
                    label: 'Amount Collected (UGX)',
                    data: paymentAmounts,
                    backgroundColor: '#f59e0b',
                    borderRadius: 8,
                    barPercentage: 0.7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const total = paymentAmounts.reduce((a, b) => a + b, 0);
                                const percentage = total > 0 ? ((context.raw / total) * 100).toFixed(1) : 0;
                                return 'UGX ' + context.raw.toLocaleString() + ' (' + percentage + '%)';
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                if (value >= 1000000) return 'UGX ' + (value / 1000000).toFixed(1) + 'M';
                                if (value >= 1000) return 'UGX ' + (value / 1000).toFixed(0) + 'K';
                                return 'UGX ' + value;
                            }
                        },
                        title: { display: true, text: 'Amount (UGX)' }
                    },
                    x: { title: { display: true, text: 'Payment Method' } }
                }
            }
        });
    }
    
    // Chart 6: Overdue by Class (Bar Chart)
    if (overdueData.length > 0) {
        const overdueLabels = overdueData.map(d => d.name);
        const overdueValues = overdueData.map(d => d.overdue);
        
        const overdueCtx = document.getElementById('overdueByClassChart')?.getContext('2d');
        if (overdueCtx) {
            new Chart(overdueCtx, {
                type: 'bar',
                data: {
                    labels: overdueLabels,
                    datasets: [{
                        label: 'Outstanding Balance (UGX)',
                        data: overdueValues,
                        backgroundColor: '#ef4444',
                        borderRadius: 8,
                        barPercentage: 0.7
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return 'UGX ' + context.raw.toLocaleString();
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function(value) {
                                    if (value >= 1000000) return 'UGX ' + (value / 1000000).toFixed(1) + 'M';
                                    if (value >= 1000) return 'UGX ' + (value / 1000).toFixed(0) + 'K';
                                    return 'UGX ' + value;
                                }
                            },
                            title: { display: true, text: 'Amount (UGX)' }
                        },
                        x: { title: { display: true, text: 'Class' } }
                    }
                }
            });
        }
    } else {
        const overdueCtx = document.getElementById('overdueByClassChart')?.getContext('2d');
        if (overdueCtx) {
            new Chart(overdueCtx, {
                type: 'bar',
                data: {
                    labels: ['No Overdue'],
                    datasets: [{
                        label: 'Outstanding Balance',
                        data: [0],
                        backgroundColor: '#10b981'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: function() {
                                    return 'No outstanding balances! 🎉';
                                }
                            }
                        }
                    }
                }
            });
        }
    }
}

// Helper function to view student fee details
// ==================== COMPLETE CORRECTED FEE DETAILS FUNCTION ====================


function renderTermCardFee(term, paidAmount, expectedAmount, studentId) {
    const status = paidAmount >= expectedAmount ? 'Paid' : paidAmount > 0 ? 'Partial' : 'Unpaid';
    const statusColor = status === 'Paid' ? 'bg-green-100 text-green-800' : status === 'Partial' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
    const balance = expectedAmount - paidAmount;
    
    return `
        <div class="border rounded-lg p-3">
            <div class="flex justify-between items-center mb-2"><span class="font-semibold">Term ${term}</span><span class="px-2 py-1 rounded-full text-xs ${statusColor}">${status}</span></div>
            <div class="flex justify-between text-sm"><span>Paid:</span><span class="font-semibold">UGX ${paidAmount.toLocaleString()}</span></div>
            <div class="flex justify-between text-sm"><span>Expected:</span><span>UGX ${expectedAmount.toLocaleString()}</span></div>
            <div class="flex justify-between text-sm mt-2 pt-2 border-t"><span>Balance:</span><span class="font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'}">UGX ${Math.abs(balance).toLocaleString()}</span></div>
            ${balance > 0 ? `<button onclick="makePaymentForTerm('${studentId}', ${term})" class="mt-3 w-full text-sm bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700">Pay Term ${term} Balance</button>` : '<span class="text-xs text-green-600 mt-2 block text-center">✓ Fully Paid</span>'}
        </div>
    `;
}

// ==================== COMPLETE REGISTER STUDENT PAGE ====================
// ==================== UPDATED STUDENT REGISTRATION WITH FEE STRUCTURE & BURSARY ====================
// ==================== COMPLETE STUDENT REGISTRATION ====================
// Version: 3.0 - Works with One-Time, Termly, Yearly Fee Structures

// ==================== CORRECTED STUDENT REGISTRATION FORM ====================
// Version: 4.0 - Tuition and Activity Fees are SEPARATE

// ==================== CORRECTED STUDENT REGISTRATION FORM ====================
// Version: 4.0 - Tuition and Activity Fees are SEPARATE

// ==================== COMPLETELY REBUILT REGISTRATION FORM ====================

// ==================== COMPLETE REBUILT STUDENT REGISTRATION ====================
// Version: 7.0 - With Custom Bursary and Status Group Summary

// ==================== UPDATED STUDENT REGISTRATION WITH ITEM CUSTOMIZATION ====================

/* ============================================================================
   STUDENT REGISTRATION — restyled
   Design tokens:
     ink #111827 · muted #6B7280 · canvas #F7F8FB
     indigo #4F46E5 (primary/personal) · teal #0D9488 (parent)
     violet #7C3AED (academic) · amber #D97706 (fees)
     rose #E11D48 (destructive) · emerald #10B981 (success)
     Display/emphasis face: Sora · UI/body face: Inter
   Behavior, element IDs, function names, API calls and the data shape
   are unchanged from the original — this is a visual/UX pass only.
   ============================================================================ */
// ============================================================================
// STUDENT REGISTRATION — MODERN EDITION
// Version: 4.0 — "Enrollment ticket" identity (perforated admission stub),
// same teal/indigo/gold/rose language as dashboard.js, full motion system.
// All business logic (validation, customization, fee bar math, submit flow)
// is unchanged from the version supplied — only presentation + the missing
// supporting helpers (styleBlock, toast/modal, stepper) are added.
// ============================================================================

async function showStudentRegistration() {
    console.log('showStudentRegistration called - v6.0 (Default-Removed Items + Fuzzy Search/Filter edition)');
    if (typeof injectDashboardDesignSystem === 'function') injectDashboardDesignSystem();

    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) pageTitle.innerHTML = '<i class="fas fa-user-plus mr-2"></i>Register Student';

    const mainContent = document.getElementById('mainContent');
    if (mainContent) {
        mainContent.innerHTML = `
            <div class="sr-loading-wrap">
                <div class="sr-loading-ring"></div>
                <p class="sr-loading-text">Preparing registration form…</p>
            </div>
        `;
    }

    try {
        // Fetch all required data
        const [classesRes, feeStructuresRes, feeBursariesRes, studentsRes] = await Promise.all([
            fetch('/api/school/classes'),
            fetch('/api/fee/structures'),
            fetch('/api/fee/bursaries'),
            fetch('/api/students')
        ]);

        const classes = await classesRes.json();
        let feeStructures = await feeStructuresRes.json();
        const feeBursaries = await feeBursariesRes.json();
        const students = await studentsRes.json();

        // Get next admission number
        const currentYear = new Date().getFullYear();
        const nextAdmissionNumber = `STU${currentYear}${String(students.length + 1).padStart(4, '0')}`;

        // Store data globally
        window.registrationFeeStructures = feeStructures;
        window.registrationFeeBursaries = feeBursaries;
        window.registrationClasses = classes;

        // Initialize customizations storage
        window.tempItemCustomizations = {};
        window.tempRemovedItems = {};
        window.srComponentGroups = {};

        // Item search / status-group filter state (reset per fee-structure load)
        window.srItemsFilter = { query: '', groupFilter: 'all' };
        let srItemsSearchDebounceHandle = null;

        // Ensure supporting UI helpers exist (toast + confirm modal), without
        // clobbering any app-wide versions that may already be defined.
        ensureSharedUiHelpers();

        // ========== FUZZY SEARCH HELPERS ==========
        // Levenshtein edit distance (classic DP implementation) — counts the
        // minimum number of single-character insertions, deletions, or
        // substitutions needed to turn `a` into `b`.
        function levenshteinDistance(a, b) {
            a = a || ''; b = b || '';
            const m = a.length, n = b.length;
            if (m === 0) return n;
            if (n === 0) return m;

            let prevRow = new Array(n + 1);
            let currRow = new Array(n + 1);
            for (let j = 0; j <= n; j++) prevRow[j] = j;

            for (let i = 1; i <= m; i++) {
                currRow[0] = i;
                for (let j = 1; j <= n; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    currRow[j] = Math.min(
                        currRow[j - 1] + 1,
                        prevRow[j] + 1,
                        prevRow[j - 1] + cost
                    );
                }
                [prevRow, currRow] = [currRow, prevRow];
            }
            return prevRow[n];
        }

        function fuzzyWordScore(query, word) {
            if (!query || !word) return 0;
            if (word === query) return 1;
            if (word.startsWith(query)) return 0.95;
            if (word.includes(query)) return 0.85;

            const dist = levenshteinDistance(query, word);
            const maxLen = Math.max(query.length, word.length);
            if (maxLen === 0) return 0;
            return Math.max(0, 1 - dist / maxLen);
        }

        // Fuzzy-matches a search query against an item name, tolerant of
        // typos, missing letters, or partial words.
        function fuzzyTextMatch(query, text, threshold = 0.6) {
            const q = (query || '').toLowerCase().trim();
            const t = (text || '').toLowerCase().trim();
            if (!q) return true;
            if (!t) return false;

            if (t.includes(q)) return true;

            if (q.length < 3) {
                return t.split(/\s+/).some(word => word.startsWith(q));
            }

            const fullScore = fuzzyWordScore(q, t);
            if (fullScore >= threshold) return true;

            const words = t.split(/\s+/).filter(Boolean);
            return words.some(word => fuzzyWordScore(q, word) >= threshold);
        }

        function highlightMatch(text, query) {
            if (!query) return escapeHtmlSafe(text);
            const escaped = escapeHtmlSafe(text);
            const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            try {
                return escaped.replace(new RegExp(`(${escapedQuery})`, 'ig'), '<mark>$1</mark>');
            } catch (_) {
                return escaped;
            }
        }

        const html = `
            ${styleBlock()}
            <div class="sr-page max-w-6xl mx-auto" id="srPage">

                <!-- Header -->
                <div class="sr-hero">
                    <div class="sr-hero-edge"></div>
                    <div class="sr-hero-inner">
                        <div>
                            <p class="sr-hero-eyebrow">New enrollment</p>
                            <h1 class="sr-hero-title">Student Registration</h1>
                            <p class="sr-hero-sub">Fields marked <span class="sr-req">*</span> are required.</p>
                        </div>
                        <div class="sr-admission-chip" title="This number is reserved for the next student registered">
                            <div class="sr-admission-chip-notch sr-admission-chip-notch-l"></div>
                            <div class="sr-admission-chip-notch sr-admission-chip-notch-r"></div>
                            <p class="sr-admission-label"><i class="fas fa-ticket"></i> Next admission no.</p>
                            <p class="sr-admission-value">${nextAdmissionNumber}</p>
                        </div>
                    </div>

                    <!-- Stepper -->
                    <nav class="sr-stepper" id="srStepper" aria-label="Registration sections">
                        ${['Personal', 'Parent / Guardian', 'Academic', 'Fees'].map((label, i) => `
                            <button type="button" class="sr-step" data-step-target="srSection${i + 1}" data-step-index="${i}">
                                <span class="sr-step-num">${i + 1}</span>
                                <span class="sr-step-label">${label}</span>
                            </button>
                        `).join('<span class="sr-step-line"></span>')}
                        <span class="sr-step-progress" id="srStepProgress"></span>
                    </nav>
                </div>

                <form id="studentRegForm" class="sr-form" onsubmit="return false;">

                    <!-- Personal Information -->
                    <section id="srSection1" class="sr-card sr-in" style="--sr-accent:#4F5FE8; --sr-delay:0ms">
                        <header class="sr-card-head">
                            <span class="sr-card-icon"><i class="fas fa-user-circle"></i></span>
                            <div>
                                <h2 class="sr-card-title">Personal Information</h2>
                                <p class="sr-card-sub">Who is enrolling</p>
                            </div>
                        </header>
                        <div class="sr-card-body">
                            <div class="sr-grid sr-grid-3">
                                <div class="sr-field">
                                    <label class="sr-label">First Name <span class="sr-req">*</span></label>
                                    <input type="text" id="firstName" class="sr-input">
                                </div>
                                <div class="sr-field">
                                    <label class="sr-label">Last Name <span class="sr-req">*</span></label>
                                    <input type="text" id="lastName" class="sr-input">
                                </div>
                                <div class="sr-field">
                                    <label class="sr-label">Date of Birth</label>
                                    <input type="date" id="dob" class="sr-input">
                                </div>
                                <div class="sr-field">
                                    <label class="sr-label">Gender <span class="sr-req">*</span></label>
                                    <select id="gender" class="sr-input">
                                        <option value="">Select</option>
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                    </select>
                                </div>
                                <div class="sr-field">
                                    <label class="sr-label">Place of Birth</label>
                                    <input type="text" id="birthPlace" class="sr-input">
                                </div>
                                <div class="sr-field">
                                    <label class="sr-label">Nationality</label>
                                    <select id="nationality" class="sr-input">
                                        <option value="Ugandan">Ugandan</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </section>

                    <!-- Parent Information -->
                    <section id="srSection2" class="sr-card sr-in" style="--sr-accent:#0E9C8E; --sr-delay:70ms">
                        <header class="sr-card-head">
                            <span class="sr-card-icon"><i class="fas fa-users"></i></span>
                            <div>
                                <h2 class="sr-card-title">Parent / Guardian Information</h2>
                                <p class="sr-card-sub">Primary contact for this student</p>
                            </div>
                        </header>
                        <div class="sr-card-body">
                            <div class="sr-grid sr-grid-2">
                                <div class="sr-field">
                                    <label class="sr-label">Parent Name <span class="sr-req">*</span></label>
                                    <input type="text" id="parentName" class="sr-input">
                                </div>
                                <div class="sr-field">
                                    <label class="sr-label">Relationship</label>
                                    <select id="relationship" class="sr-input">
                                        <option value="Parent">Parent</option>
                                        <option value="Guardian">Guardian</option>
                                        <option value="Relative">Relative</option>
                                    </select>
                                </div>
                                <div class="sr-field">
                                    <label class="sr-label">Phone Number <span class="sr-req">*</span></label>
                                    <input type="tel" id="parentPhone" class="sr-input" placeholder="07XX XXX XXX">
                                </div>
                                <div class="sr-field">
                                    <label class="sr-label">Alternative Phone</label>
                                    <input type="tel" id="parentAltPhone" class="sr-input">
                                </div>
                                <div class="sr-field">
                                    <label class="sr-label">Email</label>
                                    <input type="email" id="parentEmail" class="sr-input">
                                </div>
                                <div class="sr-field">
                                    <label class="sr-label">Occupation</label>
                                    <input type="text" id="parentOccupation" class="sr-input">
                                </div>
                                <div class="sr-field sr-span-2">
                                    <label class="sr-label">Address <span class="sr-req">*</span></label>
                                    <textarea id="address" rows="2" class="sr-input"></textarea>
                                </div>
                            </div>
                        </div>
                    </section>

                    <!-- Academic Information -->
                    <section id="srSection3" class="sr-card sr-in" style="--sr-accent:#7C6BEF; --sr-delay:140ms">
                        <header class="sr-card-head">
                            <span class="sr-card-icon"><i class="fas fa-graduation-cap"></i></span>
                            <div>
                                <h2 class="sr-card-title">Academic Information</h2>
                                <p class="sr-card-sub">Class placement and admission details</p>
                            </div>
                        </header>
                        <div class="sr-card-body">
                            <div class="sr-grid sr-grid-2">
                                <div class="sr-field">
                                    <label class="sr-label">Class <span class="sr-req">*</span></label>
                                    <select id="classId" class="sr-input" onchange="updateRegistrationFeeStructures()">
                                        <option value="">Select Class</option>
                                        ${classes.map(c => `<option value="${c.id}" data-level="${c.level}">${c.name}</option>`).join('')}
                                    </select>
                                </div>
                                <div class="sr-field">
                                    <label class="sr-label">Previous School</label>
                                    <input type="text" id="previousSchool" class="sr-input">
                                </div>
                                <div class="sr-field">
                                    <label class="sr-label">Admission Type</label>
                                    <select id="admissionType" class="sr-input">
                                        <option value="New">New Admission</option>
                                        <option value="Transfer">Transfer</option>
                                        <option value="Re-admission">Re-admission</option>
                                    </select>
                                </div>
                                <div class="sr-field">
                                    <label class="sr-label">Enrollment Date</label>
                                    <input type="date" id="enrollmentDate" value="${new Date().toISOString().split('T')[0]}" class="sr-input">
                                </div>
                            </div>
                        </div>
                    </section>

                    <!-- Fee Assignment -->
                    <section id="srSection4" class="sr-card sr-in" style="--sr-accent:#DB9A2C; --sr-delay:210ms">
                        <header class="sr-card-head">
                            <span class="sr-card-icon"><i class="fas fa-money-bill-wave"></i></span>
                            <div>
                                <h2 class="sr-card-title">Fee Assignment</h2>
                                <p class="sr-card-sub">Select a fee structure — all items start removed until you restore them</p>
                            </div>
                        </header>
                        <div class="sr-card-body">
                            <div class="sr-grid sr-grid-2">
                                <div class="sr-field">
                                    <label class="sr-label">Fee Structure <span class="sr-req">*</span></label>
                                    <select id="feeStructureId" class="sr-input" onchange="loadFeeStructureItemsForCustomization()">
                                        <option value="">-- Select Fee Structure --</option>
                                        ${feeStructures.filter(f => f.isActive !== false).map(f => `
                                            <option value="${f.id}" data-structure='${JSON.stringify(f).replace(/'/g, "&#39;")}'>
                                                ${f.name} - UGX ${(f.tuition || 0).toLocaleString()}/term (${f.level === 'Nursery' ? 'Nursery' : f.level === 'LowerPrimary' ? 'Lower Primary' : 'Upper Primary'})
                                            </option>
                                        `).join('')}
                                    </select>
                                </div>
                                <div class="sr-field">
                                    <label class="sr-label">Bursary (Optional)</label>
                                    <div class="sr-inline-fields">
                                        <select id="bursaryId" class="sr-input">
                                            <option value="">None</option>
                                            ${feeBursaries.filter(b => b.isActive).map(b => `
                                                <option value="${b.id}" data-type="${b.type}" data-value="${b.value}" data-name="${b.name}">${b.name} (${b.type === 'percentage' ? b.value + '% off' : 'UGX ' + b.value.toLocaleString() + ' off'})</option>
                                            `).join('')}
                                            <option value="custom">Custom Bursary (enter amount)</option>
                                        </select>
                                        <div id="customBursaryContainer" class="hidden sr-custom-bursary">
                                            <input type="number" id="customBursaryAmount" placeholder="Amount (UGX)" class="sr-input sr-input-sm">
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- ITEMS FOR CUSTOMIZATION -->
                            <div id="itemsCustomizationContainer" class="hidden sr-items-panel">
                                <div class="sr-items-panel-head">
                                    <div>
                                        <h3><i class="fas fa-sliders-h"></i> Activate items for this student</h3>
                                        <span class="sr-items-panel-hint">Every item starts <strong>removed</strong> (not billed). Restore a whole group or individual items to charge them. Tuition always bills.</span>
                                    </div>
                                    <div class="sr-group-actions-buttons">
                                        <button type="button" class="sr-btn sr-btn-sm sr-btn-success" onclick="restoreAllRegistrationItems()">
                                            <i class="fas fa-undo"></i> Restore all
                                        </button>
                                        <button type="button" class="sr-btn sr-btn-sm sr-btn-ghost" onclick="removeAllRegistrationItems()">
                                            <i class="fas fa-trash"></i> Remove all
                                        </button>
                                    </div>
                                </div>

                                <!-- SEARCH & STATUS GROUP FILTER -->
                                <div class="sr-items-filter-bar">
                                    <div class="sr-items-filter-search">
                                        <i class="fas fa-magnifying-glass"></i>
                                        <input type="text" id="srItemsSearchInput" class="sr-input" placeholder="Search items… (typo-tolerant)" autocomplete="off">
                                        <button type="button" id="srItemsSearchClear" class="sr-search-clear hidden" title="Clear search"><i class="fas fa-xmark"></i></button>
                                    </div>
                                    <div class="sr-items-filter-group">
                                        <select id="srItemsGroupFilter" class="sr-input">
                                            <option value="all">All status groups</option>
                                        </select>
                                    </div>
                                    <span class="sr-items-filter-count" id="srItemsFilterCount"></span>
                                </div>

                                <div id="itemsCustomizationList" class="sr-items-list">
                                    <div class="sr-empty-state" id="emptyItemsMsg">
                                        <i class="fas fa-inbox"></i>
                                        <p>Select a fee structure to see items</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <!-- Submit Buttons -->
                    <div class="sr-actions">
                        <button type="button" onclick="resetRegistrationFormFields()" class="sr-btn sr-btn-ghost">
                            <i class="fas fa-undo"></i> Reset
                        </button>
                        <button type="button" id="registerBtn" class="sr-btn sr-btn-primary">
                            <i class="fas fa-save"></i> Register Student
                        </button>
                    </div>
                </form>

                <!-- Sticky live fee summary -->
                <div id="srFeeBar" class="sr-fee-bar hidden">
                    <div class="sr-fee-bar-perf"></div>
                    <div class="sr-fee-bar-inner">
                        <div class="sr-fee-bar-info">
                            <span class="sr-fee-bar-label">Estimated total <span class="sr-fee-bar-tag">this term</span></span>
                            <span class="sr-fee-bar-meta" id="srFeeBarMeta"></span>
                        </div>
                        <div class="sr-fee-bar-amount">
                            UGX <span id="srFeeBarValue">0</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('mainContent').innerHTML = html;
        initStepperAndScrollSpy();

        // ========== Update registration fee structures ==========
        function updateRegistrationFeeStructures() {
            console.log('updateRegistrationFeeStructures called');

            const classSelect = document.getElementById('classId');
            const selectedOption = classSelect?.options[classSelect.selectedIndex];
            const level = selectedOption?.dataset?.level;
            const feeSelect = document.getElementById('feeStructureId');

            if (!feeSelect) {
                console.warn('Fee structure select element not found');
                return;
            }

            if (!level || !window.registrationFeeStructures) {
                feeSelect.innerHTML = '<option value="">-- Select Fee Structure --</option>';
                hideFeeBar();
                return;
            }

            const available = window.registrationFeeStructures.filter(fs => fs.level === level && fs.isActive !== false);

            if (available.length === 0) {
                feeSelect.innerHTML = '<option value="">No fee structures for this level</option>';
                hideFeeBar();
                return;
            }

            feeSelect.innerHTML = '<option value="">-- Select Fee Structure --</option>';
            available.forEach(fs => {
                const option = document.createElement('option');
                option.value = fs.id;
                const tuition = fs.tuition || 0;
                option.textContent = `${fs.name} - Tuition: UGX ${tuition.toLocaleString()}`;
                option.dataset.tuition = tuition;
                option.dataset.structure = JSON.stringify(fs);
                feeSelect.appendChild(option);
            });
        }

        // ========== Populate the status-group filter dropdown for the current structure ==========
        function populateGroupFilterOptions(feeStructure) {
            const select = document.getElementById('srItemsGroupFilter');
            if (!select) return;
            const groups = (feeStructure?.activityComponents || []).filter(c => c.items && c.items.length);
            select.innerHTML = `<option value="all">All status groups (${groups.length})</option>` +
                groups.map(c => `<option value="${escapeHtmlSafe(c.name)}">${escapeHtmlSafe(c.name)} (${c.items.length})</option>`).join('');
            select.value = window.srItemsFilter.groupFilter;
        }

        function updateFilterCountDisplay(shown, total) {
            const el = document.getElementById('srItemsFilterCount');
            if (!el) return;
            const { query, groupFilter } = window.srItemsFilter;
            el.textContent = (query || groupFilter !== 'all')
                ? `Showing ${shown} of ${total} item(s)`
                : `${total} item(s)`;
        }

        // ========== Load fee structure items for customization ==========
        // v6.0: EVERY item starts REMOVED by default. The bursar must explicitly
        // restore a whole group or individual items before they will be billed.
        // Also resets the search/filter state for the newly selected structure.
        function loadFeeStructureItemsForCustomization() {
            console.log('loadFeeStructureItemsForCustomization called (default-removed mode)');

            const feeSelect = document.getElementById('feeStructureId');
            const container = document.getElementById('itemsCustomizationContainer');
            const list = document.getElementById('itemsCustomizationList');

            if (!feeSelect || !container || !list) {
                console.warn('Required elements not found');
                return;
            }

            if (!feeSelect.value) {
                container.classList.add('hidden');
                hideFeeBar();
                return;
            }

            container.classList.remove('hidden');
            container.classList.add('sr-in');

            const selectedOption = feeSelect.options[feeSelect.selectedIndex];
            let feeStructure = null;
            try {
                feeStructure = JSON.parse(selectedOption.dataset.structure);
            } catch (e) {
                feeStructure = { activityComponents: [] };
            }

            window.srCurrentFeeStructure = feeStructure;

            // Clear existing customizations, group map, and filters
            window.tempItemCustomizations = {};
            window.tempRemovedItems = {};
            window.srComponentGroups = {};
            window.srItemsFilter = { query: '', groupFilter: 'all' };

            const searchInput = document.getElementById('srItemsSearchInput');
            if (searchInput) searchInput.value = '';
            document.getElementById('srItemsSearchClear')?.classList.add('hidden');

            const activityComponents = feeStructure.activityComponents || [];

            // ========== PASS 1: auto-remove every item by default ==========
            // New student = no payment history yet, so nothing should be billed
            // until the bursar explicitly restores a group or an item.
            for (const component of activityComponents) {
                if (!component.items || component.items.length === 0) continue;
                for (const item of component.items) {
                    const itemId = item.id || item.name;
                    window.tempRemovedItems[itemId] = true;
                }
            }

            populateGroupFilterOptions(feeStructure);
            renderItemsList();
            recalcFeeBar();
        }

        // ========== Render the items list, applying current search/group filter ==========
        // This is the single source of truth for what's shown — called on
        // initial fee-structure load, and again whenever the search box or
        // group filter changes (does NOT reset removal state).
        function renderItemsList() {
            const list = document.getElementById('itemsCustomizationList');
            if (!list) return;

            const feeStructure = window.srCurrentFeeStructure;
            if (!feeStructure || !feeStructure.activityComponents || feeStructure.activityComponents.length === 0) {
                list.innerHTML = `
                    <div class="sr-empty-state">
                        <i class="fas fa-inbox"></i>
                        <p>No items found in this fee structure</p>
                    </div>
                `;
                updateFilterCountDisplay(0, 0);
                return;
            }

            const { query, groupFilter } = window.srItemsFilter;
            window.srComponentGroups = {}; // rebuilt each render pass (only for currently-rendered groups)

            const accentFor = (periodType) =>
                periodType === 'one_time' ? { c: '#7C6BEF', label: 'One-time' } :
                periodType === 'termly' ? { c: '#0E9C8E', label: 'Termly' } :
                { c: '#DB9A2C', label: 'Yearly' };

            let itemsHtml = '';
            let hasAnyItems = false;
            let totalItemCount = 0;
            let renderedItemCount = 0;
            let cardIndex = 0;
            let componentIndex = 0;

            for (const component of feeStructure.activityComponents) {
                if (!component.items || component.items.length === 0) continue;
                hasAnyItems = true;
                totalItemCount += component.items.length;

                const groupIndex = componentIndex++;
                const fullItemIds = component.items.map(item => item.id || item.name);

                // status-group filter: skip this whole component if it doesn't match
                if (groupFilter !== 'all' && component.name !== groupFilter) continue;

                // live search filter: only render items whose name matches the query
                const itemsToRender = query
                    ? component.items.filter(item => fuzzyTextMatch(query, item.name, 0.62))
                    : component.items;

                if (itemsToRender.length === 0) continue;

                // Register the FULL group (not just filtered items) so whole-group
                // Restore/Remove actions still operate on every item in the group.
                window.srComponentGroups[groupIndex] = fullItemIds;
                renderedItemCount += itemsToRender.length;

                const { c: accent, label: periodLabel } = accentFor(component.periodType);

                itemsHtml += `
                    <div class="sr-component sr-in" style="--sr-accent:${accent}; --sr-delay:${cardIndex * 40}ms" data-group-index="${groupIndex}">
                        <div class="sr-component-head">
                            <span class="sr-period-chip" style="--sr-accent:${accent}">${periodLabel}</span>
                            <h4>${escapeHtmlSafe(component.name)}</h4>
                            <span class="sr-component-total">UGX ${(component.totalAmount || 0).toLocaleString()}</span>
                        </div>
                        <div class="sr-group-actions" id="groupActions_${groupIndex}">
                            ${renderGroupActionButtons(groupIndex)}
                        </div>
                        <div class="sr-component-items" id="groupItems_${groupIndex}">
                            ${itemsToRender.map(item => {
                                cardIndex++;
                                const itemId = item.id || item.name;
                                const defaultAmount = item.totalAmount || 0;
                                const defaultQuantity = item.quantity || 1;
                                const paymentOption = item.paymentOption || 'either';

                                return renderItemRow({
                                    itemId, itemName: item.name, componentName: component.name,
                                    periodType: component.periodType, defaultAmount, defaultQuantity, paymentOption,
                                    highlightQuery: query
                                });
                            }).join('')}
                        </div>
                    </div>
                `;
            }

            if (!hasAnyItems) {
                list.innerHTML = `
                    <div class="sr-empty-state">
                        <i class="fas fa-inbox"></i>
                        <p>No items found in this fee structure</p>
                    </div>
                `;
                updateFilterCountDisplay(0, 0);
                return;
            }

            updateFilterCountDisplay(renderedItemCount, totalItemCount);

            if (renderedItemCount === 0) {
                const parts = [];
                if (query) parts.push(`matching "${escapeHtmlSafe(document.getElementById('srItemsSearchInput')?.value.trim() || query)}"`);
                if (groupFilter !== 'all') parts.push(`in "${escapeHtmlSafe(groupFilter)}"`);
                const msg = parts.length ? `No items found ${parts.join(' ')}` : 'No items found';
                list.innerHTML = `
                    <div class="sr-empty-state">
                        <i class="fas fa-magnifying-glass"></i>
                        <p>${msg}</p>
                        <button type="button" class="sr-btn sr-btn-sm sr-btn-ghost" onclick="clearRegistrationItemsFilters()" style="margin-top:10px;">Clear filters</button>
                    </div>
                `;
                return;
            }

            list.innerHTML = itemsHtml;
        }

        // ========== Filter bar wiring ==========
        function applyItemsFilter() {
            window.srItemsFilter.query = document.getElementById('srItemsSearchInput')?.value.trim().toLowerCase() || '';
            window.srItemsFilter.groupFilter = document.getElementById('srItemsGroupFilter')?.value || 'all';
            document.getElementById('srItemsSearchClear')?.classList.toggle('hidden', !window.srItemsFilter.query);
            renderItemsList();
        }

        window.clearRegistrationItemsFilters = function () {
            window.srItemsFilter = { query: '', groupFilter: 'all' };
            const searchInput = document.getElementById('srItemsSearchInput');
            if (searchInput) searchInput.value = '';
            const groupSelect = document.getElementById('srItemsGroupFilter');
            if (groupSelect) groupSelect.value = 'all';
            document.getElementById('srItemsSearchClear')?.classList.add('hidden');
            renderItemsList();
        };

        // ========== Group status helper ==========
        function getGroupStatus(groupIndex) {
            const itemIds = window.srComponentGroups?.[groupIndex] || [];
            if (itemIds.length === 0) return { removedCount: 0, total: 0, allRemoved: false, noneRemoved: true };
            const removedCount = itemIds.filter(id => window.tempRemovedItems[id]).length;
            return {
                removedCount,
                total: itemIds.length,
                allRemoved: removedCount === itemIds.length,
                noneRemoved: removedCount === 0
            };
        }

        // ========== Render the group-level Restore/Remove buttons ==========
        function renderGroupActionButtons(groupIndex) {
            const { removedCount, total, allRemoved, noneRemoved } = getGroupStatus(groupIndex);

            let statusText = '';
            if (allRemoved) statusText = `<span class="sr-tag sr-tag-rose">All ${total} item(s) removed</span>`;
            else if (noneRemoved) statusText = `<span class="sr-tag sr-tag-green">All ${total} item(s) active</span>`;
            else statusText = `<span class="sr-tag sr-tag-amber">${removedCount}/${total} removed</span>`;

            return `
                <div class="sr-group-actions-inner">
                    ${statusText}
                    <div class="sr-group-actions-buttons">
                        ${!noneRemoved ? `
                            <button type="button" class="sr-btn sr-btn-sm sr-btn-success" onclick="restoreGroupItems(${groupIndex})">
                                <i class="fas fa-undo"></i> Restore whole group
                            </button>
                        ` : ''}
                        ${!allRemoved ? `
                            <button type="button" class="sr-btn sr-btn-sm sr-btn-ghost" onclick="removeGroupItems(${groupIndex})">
                                <i class="fas fa-trash"></i> Remove whole group
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        function refreshGroupActions(groupIndex) {
            const el = document.getElementById(`groupActions_${groupIndex}`);
            if (el) el.innerHTML = renderGroupActionButtons(groupIndex);
        }

        // ========== Render a single item row (used on initial load and restore) ==========
        function renderItemRow({ itemId, itemName, componentName, periodType, defaultAmount, defaultQuantity, paymentOption, highlightQuery }) {
            const custom = window.tempItemCustomizations[itemId] || {};
            const isRemoved = !!window.tempRemovedItems[itemId];
            const nameDisplay = highlightQuery ? highlightMatch(itemName, highlightQuery) : escapeHtmlSafe(itemName);

            const paymentBadge =
                paymentOption === 'cash_only' ? '<span class="sr-tag sr-tag-blue">Cash only</span>' :
                paymentOption === 'item_only' ? '<span class="sr-tag sr-tag-green">Item only</span>' :
                '<span class="sr-tag sr-tag-violet">Cash or item</span>';

            return `
                <div class="sr-item ${isRemoved ? 'sr-item-removed' : ''}"
                     data-item-id="${itemId}" data-item-name="${escapeHtmlSafe(itemName)}"
                     data-component-name="${escapeHtmlSafe(componentName)}" data-period-type="${periodType}"
                     data-default-amount="${defaultAmount}" data-default-quantity="${defaultQuantity}"
                     data-payment-option="${paymentOption}">
                    <div class="sr-item-top">
                        <div class="sr-item-info">
                            <div class="sr-item-name-row">
                                <span class="sr-item-name ${isRemoved ? 'sr-strike' : ''}">${nameDisplay}</span>
                                ${paymentBadge}
                                ${custom.isCustomized && !isRemoved ? '<span class="sr-tag sr-tag-amber sr-badge-pop">Custom</span>' : ''}
                                ${isRemoved ? '<span class="sr-tag sr-tag-rose sr-badge-pop">Not activated</span>' : ''}
                            </div>
                            <p class="sr-item-meta ${isRemoved ? 'sr-strike' : ''}">Default: UGX ${defaultAmount.toLocaleString()} · Qty ${defaultQuantity}</p>
                            ${custom.isCustomized && !isRemoved ? `<p class="sr-item-custom-meta">Custom: UGX ${(custom.customAmount ?? defaultAmount).toLocaleString()}${custom.customQuantity ? ` · Qty ${custom.customQuantity}` : ''}</p>` : ''}
                            ${isRemoved ? `<p class="sr-item-removed-meta">Not yet activated — click Restore to bill this item</p>` : ''}
                        </div>
                        <div class="sr-item-actions">
                            ${!isRemoved ? `
                                <button type="button" class="sr-icon-btn sr-icon-btn-blue" title="Customize"
                                        onclick="toggleItemCustomizationForm('${itemId}', '${escapeHtmlSafe(itemName)}', '${escapeHtmlSafe(componentName)}', '${periodType}', ${defaultAmount}, ${defaultQuantity}, '${paymentOption}')">
                                    <i class="fas ${custom.isCustomized ? 'fa-edit' : 'fa-sliders-h'}"></i>
                                </button>
                                <button type="button" class="sr-icon-btn sr-icon-btn-rose" title="Remove for this student"
                                        onclick="confirmRemoveItem('${itemId}', '${escapeHtmlSafe(itemName)}', '${escapeHtmlSafe(componentName)}')">
                                    <i class="fas fa-trash"></i>
                                </button>
                            ` : `
                                <button type="button" class="sr-icon-btn sr-icon-btn-green" title="Restore"
                                        onclick="restoreRemovedItem('${itemId}')">
                                    <i class="fas fa-undo"></i> Restore
                                </button>
                            `}
                        </div>
                    </div>

                    <div id="customForm_${itemId}" class="sr-custom-form hidden">
                        <div class="sr-grid sr-grid-3">
                            <div class="sr-field">
                                <label class="sr-label">Custom Amount (UGX)</label>
                                <input type="number" id="customAmount_${itemId}" class="sr-input sr-input-sm"
                                       placeholder="Leave blank for default" min="0" step="1000"
                                       value="${custom.customAmount ?? ''}">
                            </div>
                            ${(paymentOption === 'item_only' || paymentOption === 'either') ? `
                                <div class="sr-field">
                                    <label class="sr-label">Custom Quantity</label>
                                    <input type="number" id="customQuantity_${itemId}" class="sr-input sr-input-sm"
                                           placeholder="Leave blank for default" min="1" step="1"
                                           value="${custom.customQuantity ?? ''}">
                                </div>
                            ` : `<input type="hidden" id="customQuantity_${itemId}" value="">`}
                            <div class="sr-field">
                                <label class="sr-label">Reason (optional)</label>
                                <input type="text" id="customReason_${itemId}" class="sr-input sr-input-sm"
                                       placeholder="Why customize?" value="${custom.reason || ''}">
                            </div>
                        </div>
                        <div class="sr-custom-form-actions">
                            <button type="button" class="sr-btn sr-btn-sm sr-btn-success" onclick="saveItemCustomizationTemp('${itemId}')">
                                <i class="fas fa-check"></i> Apply
                            </button>
                            ${custom.isCustomized ? `
                                <button type="button" class="sr-btn sr-btn-sm sr-btn-amber" onclick="removeItemCustomizationTemp('${itemId}')">
                                    <i class="fas fa-times"></i> Clear custom
                                </button>
                            ` : ''}
                            <button type="button" class="sr-btn sr-btn-sm sr-btn-ghost" onclick="toggleItemCustomizationForm('${itemId}')">Close</button>
                        </div>
                    </div>
                </div>
            `;
        }

        // Re-render one item row in place (keeps DOM diffing simple & animatable)
        // Also refreshes the parent group's action buttons/badge to stay in sync.
        function refreshItemRow(itemId) {
            const el = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`);
            if (!el) return;
            const d = el.dataset;
            const parentGroup = el.closest('[data-group-index]');
            const groupIndex = parentGroup ? parseInt(parentGroup.dataset.groupIndex) : null;

            const html = renderItemRow({
                itemId, itemName: d.itemName, componentName: d.componentName, periodType: d.periodType,
                defaultAmount: parseFloat(d.defaultAmount) || 0, defaultQuantity: parseInt(d.defaultQuantity) || 1,
                paymentOption: d.paymentOption, highlightQuery: window.srItemsFilter?.query || ''
            });
            const wrapper = document.createElement('div');
            wrapper.innerHTML = html.trim();
            const newEl = wrapper.firstChild;
            newEl.classList.add('sr-refresh-pulse');
            el.replaceWith(newEl);

            if (groupIndex !== null && !isNaN(groupIndex)) {
                refreshGroupActions(groupIndex);
            }
        }

        // ========== Confirm remove item (custom modal, animated) ==========
        window.confirmRemoveItem = async function (itemId, itemName, componentName) {
            const ok = await window.showConfirmModal({
                tone: 'danger',
                title: `Remove "${itemName}"?`,
                message: `This will remove it from ${componentName} for this student only. It will not be charged.`,
                confirmLabel: 'Remove item'
            });
            if (!ok) return;

            window.tempRemovedItems[itemId] = true;
            delete window.tempItemCustomizations[itemId];

            const el = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`);
            if (el) {
                el.classList.add('sr-item-leaving');
                setTimeout(() => refreshItemRow(itemId), 180);
            } else {
                refreshItemRow(itemId);
            }

            recalcFeeBar();
            window.showToast(`Removed "${itemName}" for this student`, 'info');
        };

        // ========== Restore removed item ==========
        window.restoreRemovedItem = async function (itemId) {
            const ok = await window.showConfirmModal({
                tone: 'success',
                title: 'Restore this item?',
                message: 'It will be charged according to the fee structure.',
                confirmLabel: 'Restore'
            });
            if (!ok) return;

            delete window.tempRemovedItems[itemId];
            refreshItemRow(itemId);
            recalcFeeBar();
            window.showToast('Item restored — it will be billed', 'success');
        };

        // ========== Restore / remove an entire status group ==========
        window.restoreGroupItems = async function (groupIndex) {
            const itemIds = window.srComponentGroups?.[groupIndex] || [];
            if (itemIds.length === 0) return;

            const ok = await window.showConfirmModal({
                tone: 'success',
                title: 'Restore this whole group?',
                message: `All ${itemIds.length} item(s) in this group will be billed for this student.`,
                confirmLabel: 'Restore group'
            });
            if (!ok) return;

            itemIds.forEach(id => delete window.tempRemovedItems[id]);
            renderItemsList();
            recalcFeeBar();
            window.showToast('Group restored — all items in it will be billed', 'success');
        };

        window.removeGroupItems = async function (groupIndex) {
            const itemIds = window.srComponentGroups?.[groupIndex] || [];
            if (itemIds.length === 0) return;

            const ok = await window.showConfirmModal({
                tone: 'danger',
                title: 'Remove this whole group?',
                message: `All ${itemIds.length} item(s) in this group will not be charged to this student.`,
                confirmLabel: 'Remove group'
            });
            if (!ok) return;

            itemIds.forEach(id => { window.tempRemovedItems[id] = true; delete window.tempItemCustomizations[id]; });
            renderItemsList();
            recalcFeeBar();
            window.showToast('Group removed — nothing in it will be billed', 'info');
        };

        // ========== Restore / remove everything across all groups ==========
        // NOTE: uses the FULL fee-structure item set (not just what's currently
        // filtered/visible), so "Restore all" / "Remove all" always act on the
        // whole fee structure regardless of an active search or group filter.
        function getAllItemIdsInStructure() {
            const fs = window.srCurrentFeeStructure;
            if (!fs || !fs.activityComponents) return [];
            const ids = [];
            for (const comp of fs.activityComponents) {
                for (const item of (comp.items || [])) {
                    ids.push(item.id || item.name);
                }
            }
            return ids;
        }

        window.restoreAllRegistrationItems = async function () {
            const allIds = getAllItemIdsInStructure();
            if (allIds.length === 0) return;

            const ok = await window.showConfirmModal({
                tone: 'success',
                title: 'Restore all items?',
                message: `All ${allIds.length} item(s) across every group will be billed for this student.`,
                confirmLabel: 'Restore all'
            });
            if (!ok) return;

            allIds.forEach(id => delete window.tempRemovedItems[id]);
            renderItemsList();
            recalcFeeBar();
            window.showToast('All items restored', 'success');
        };

        window.removeAllRegistrationItems = async function () {
            const allIds = getAllItemIdsInStructure();
            if (allIds.length === 0) return;

            const ok = await window.showConfirmModal({
                tone: 'danger',
                title: 'Remove all items?',
                message: `All ${allIds.length} item(s) across every group will not be charged. Only tuition will bill.`,
                confirmLabel: 'Remove all'
            });
            if (!ok) return;

            allIds.forEach(id => { window.tempRemovedItems[id] = true; delete window.tempItemCustomizations[id]; });
            renderItemsList();
            recalcFeeBar();
            window.showToast('All items removed', 'info');
        };

        // ========== Toggle item customization form ==========
        window.toggleItemCustomizationForm = function (itemId, itemName, componentName, periodType, defaultAmount, defaultQuantity, paymentOption) {
            if (window.tempRemovedItems[itemId]) {
                window.showToast('This item is not activated — restore it before customizing', 'warning');
                return;
            }

            const form = document.getElementById(`customForm_${itemId}`);
            if (!form) return;

            const opening = form.classList.contains('hidden');
            // Close any other open form first
            document.querySelectorAll('.sr-custom-form').forEach(f => { if (f !== form) f.classList.add('hidden'); });

            form.classList.toggle('hidden', !opening);
            if (opening) {
                form.classList.remove('sr-slide-down');
                void form.offsetWidth; // restart animation
                form.classList.add('sr-slide-down');
                const amountField = document.getElementById(`customAmount_${itemId}`);
                if (amountField) amountField.focus();
            }
        };

        // ========== Save item customization ==========
        window.saveItemCustomizationTemp = function (itemId) {
            if (window.tempRemovedItems[itemId]) {
                window.showToast('This item is not activated and cannot be customized', 'warning');
                return;
            }

            const amount = document.getElementById(`customAmount_${itemId}`)?.value;
            const quantity = document.getElementById(`customQuantity_${itemId}`)?.value;
            const reason = document.getElementById(`customReason_${itemId}`)?.value;

            if (!amount && !quantity) {
                window.showToast('Enter at least a custom amount or quantity', 'warning');
                return;
            }

            const el = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`);
            const itemName = el?.dataset?.itemName || itemId;

            window.tempItemCustomizations[itemId] = {
                itemId,
                itemName,
                customAmount: amount && amount !== '' ? parseFloat(amount) : null,
                customQuantity: quantity && quantity !== '' ? parseInt(quantity) : null,
                reason: reason || '',
                isCustomized: true,
                updatedAt: new Date().toISOString()
            };

            refreshItemRow(itemId);
            recalcFeeBar();
            window.showToast(`Customized "${itemName}"`, 'success');
        };

        // ========== Remove item customization ==========
        window.removeItemCustomizationTemp = async function (itemId) {
            const ok = await window.showConfirmModal({
                tone: 'warning',
                title: 'Clear this customization?',
                message: 'The item will revert to its default amount and quantity.',
                confirmLabel: 'Clear'
            });
            if (!ok) return;

            delete window.tempItemCustomizations[itemId];
            refreshItemRow(itemId);
            recalcFeeBar();
            window.showToast('Customization cleared', 'info');
        };

        // ========== Reset form ==========
        function resetRegistrationFormFields() {
            const fields = ['firstName', 'lastName', 'dob', 'gender', 'birthPlace', 'nationality',
                'parentName', 'relationship', 'parentPhone', 'parentAltPhone', 'parentEmail',
                'parentOccupation', 'address', 'classId', 'previousSchool', 'admissionType',
                'enrollmentDate', 'feeStructureId', 'bursaryId'];

            fields.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });

            document.getElementById('customBursaryContainer')?.classList.add('hidden');
            const customBursaryAmount = document.getElementById('customBursaryAmount');
            if (customBursaryAmount) customBursaryAmount.value = '';

            document.getElementById('itemsCustomizationContainer')?.classList.add('hidden');

            window.tempItemCustomizations = {};
            window.tempRemovedItems = {};
            window.srComponentGroups = {};
            window.srItemsFilter = { query: '', groupFilter: 'all' };
            hideFeeBar();

            window.showToast('Form has been reset', 'info');
        }

        // ========== Submit ==========
        async function submitStudentRegistrationWithCustomizations() {
            console.log('submitStudentRegistrationWithCustomizations called');

            const firstName = document.getElementById('firstName')?.value?.trim() || '';
            const lastName = document.getElementById('lastName')?.value?.trim() || '';
            const dob = document.getElementById('dob')?.value || '';
            const gender = document.getElementById('gender')?.value || '';
            const birthPlace = document.getElementById('birthPlace')?.value || '';
            const nationality = document.getElementById('nationality')?.value || 'Ugandan';

            const parentName = document.getElementById('parentName')?.value?.trim() || '';
            const relationship = document.getElementById('relationship')?.value || 'Parent';
            const parentPhone = document.getElementById('parentPhone')?.value?.trim() || '';
            const parentAltPhone = document.getElementById('parentAltPhone')?.value || '';
            const parentEmail = document.getElementById('parentEmail')?.value || '';
            const parentOccupation = document.getElementById('parentOccupation')?.value || '';
            const address = document.getElementById('address')?.value?.trim() || '';

            const classId = document.getElementById('classId')?.value || '';
            const previousSchool = document.getElementById('previousSchool')?.value || '';
            const admissionType = document.getElementById('admissionType')?.value || 'New';
            const enrollmentDate = document.getElementById('enrollmentDate')?.value || new Date().toISOString().split('T')[0];

            const feeStructureId = document.getElementById('feeStructureId')?.value || '';

            const bursarySelect = document.getElementById('bursaryId');
            let bursaryId = null;
            let customBursaryAmount = null;

            if (bursarySelect) {
                if (bursarySelect.value === 'custom') {
                    customBursaryAmount = parseInt(document.getElementById('customBursaryAmount')?.value) || 0;
                    if (customBursaryAmount > 0) bursaryId = 'custom';
                } else if (bursarySelect.value && bursarySelect.value !== '') {
                    bursaryId = bursarySelect.value;
                }
            }

            const errors = [];
            if (!firstName) errors.push('First Name');
            if (!lastName) errors.push('Last Name');
            if (!gender) errors.push('Gender');
            if (!parentName) errors.push('Parent Name');
            if (!parentPhone) errors.push('Parent Phone');
            if (!address) errors.push('Address');
            if (!classId) errors.push('Class');
            if (!feeStructureId) errors.push('Fee Structure');

            if (errors.length > 0) {
                window.showToast(`Missing required fields: ${errors.join(', ')}`, 'warning');
                jumpToFirstError(errors);
                return;
            }

            const phoneRegex = /^[0-9]{10,13}$/;
            if (!phoneRegex.test(parentPhone.replace(/[^0-9]/g, ''))) {
                window.showToast('Enter a valid phone number (10–13 digits)', 'warning');
                return;
            }

            const studentData = {
                firstName, lastName, dateOfBirth: dob, gender,
                birthPlace, nationality,
                parentName, relationship, parentPhone, parentAltPhone, parentEmail, parentOccupation,
                address,
                enrollmentClass: classId,
                previousSchool, admissionType, enrollmentDate,
                feeStructureId,
                bursaryId: bursaryId === 'custom' ? null : bursaryId,
                customBursaryAmount: customBursaryAmount > 0 ? customBursaryAmount : null,
                customItemOverrides: window.tempItemCustomizations || {},
                // Everything still marked removed at submit time (i.e. never restored
                // by the bursar) is sent as removedItems, so it won't be billed.
                removedItems: window.tempRemovedItems || {}
            };

            console.log('Submitting student data with customizations:', studentData);
            console.log(`  -> ${Object.keys(studentData.removedItems).length} item(s) still removed (not billed)`);
            console.log(`  -> ${Object.keys(studentData.customItemOverrides).length} item(s) customized`);

            const submitBtn = document.getElementById('registerBtn');
            if (!submitBtn) return;

            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registering…';
            submitBtn.disabled = true;
            submitBtn.classList.add('sr-btn-loading');

            try {
                const response = await fetch('/api/students/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(studentData)
                });

                const result = await response.json();

                if (response.ok) {
                    const customCount = Object.keys(window.tempItemCustomizations || {}).length;
                    const removedCount = Object.keys(window.tempRemovedItems || {}).length;
                    const totalItemCount = getAllItemIdsInStructure().length;
                    const activeCount = totalItemCount - removedCount;

                    let successMsg = `${firstName} ${lastName} registered — admission no. ${result.student.admissionNumber}`;
                    successMsg += ` · ${activeCount}/${totalItemCount} item(s) activated`;
                    if (customCount > 0) successMsg += ` · ${customCount} customized`;
                    if (customBursaryAmount > 0) successMsg += ` · custom bursary UGX ${customBursaryAmount.toLocaleString()}`;

                    window.showToast(successMsg, 'success', 6000);
                    resetRegistrationFormFields();

                    const viewList = await window.showConfirmModal({
                        tone: 'success',
                        title: 'Student registered',
                        message: 'View the student list now?',
                        confirmLabel: 'View list',
                        cancelLabel: 'Register another'
                    });

                    if (viewList && typeof showStudentList === 'function') {
                        showStudentList();
                    } else {
                        showStudentRegistration();
                    }
                } else {
                    window.showToast('Registration failed: ' + (result.error || 'Unknown error'), 'error');
                }
            } catch (error) {
                console.error('Network error:', error);
                window.showToast('Network error: ' + error.message, 'error');
            } finally {
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
                submitBtn.classList.remove('sr-btn-loading');
            }
        }

        function jumpToFirstError(errors) {
            const map = {
                'First Name': 'srSection1', 'Last Name': 'srSection1', 'Gender': 'srSection1',
                'Parent Name': 'srSection2', 'Parent Phone': 'srSection2', 'Address': 'srSection2',
                'Class': 'srSection3',
                'Fee Structure': 'srSection4'
            };
            const target = map[errors[0]];
            if (target) scrollToSection(target);
        }

        // ========== Fee bar (signature live summary) ==========
        // Only tuition + items the bursar has RESTORED count toward the total,
        // since everything starts removed. Uses the FULL fee structure (not
        // filtered view) so search/filter never affects the computed total.
        function hideFeeBar() {
            document.getElementById('srFeeBar')?.classList.add('hidden');
        }

        function recalcFeeBar() {
            const fs = window.srCurrentFeeStructure;
            const feeSelect = document.getElementById('feeStructureId');
            const bar = document.getElementById('srFeeBar');
            if (!fs || !feeSelect?.value || !bar) { hideFeeBar(); return; }

            let total = fs.tuition || 0;
            let removedCount = 0;
            let activeCount = 0;
            let customCount = 0;

            (fs.activityComponents || []).forEach(component => {
                (component.items || []).forEach(item => {
                    const itemId = item.id || item.name;
                    if (window.tempRemovedItems[itemId]) { removedCount++; return; }

                    activeCount++;
                    const custom = window.tempItemCustomizations[itemId];
                    if (custom && custom.isCustomized) {
                        customCount++;
                        if (custom.customAmount != null) {
                            total += custom.customAmount;
                        } else if (custom.customQuantity != null) {
                            const unit = (item.totalAmount || 0) / (item.quantity || 1);
                            total += unit * custom.customQuantity;
                        } else {
                            total += item.totalAmount || 0;
                        }
                    } else {
                        total += item.totalAmount || 0;
                    }
                });
            });

            const bursarySelect = document.getElementById('bursaryId');
            if (bursarySelect?.value && bursarySelect.value !== 'custom') {
                const opt = bursarySelect.options[bursarySelect.selectedIndex];
                const type = opt?.dataset?.type;
                const value = parseFloat(opt?.dataset?.value) || 0;
                if (type === 'percentage') total -= total * (value / 100);
                else total -= value;
            } else if (bursarySelect?.value === 'custom') {
                const custom = parseInt(document.getElementById('customBursaryAmount')?.value) || 0;
                total -= custom;
            }
            total = Math.max(0, Math.round(total));

            bar.classList.remove('hidden');
            const metaEl = document.getElementById('srFeeBarMeta');
            let metaText = `Tuition only · ${removedCount} item(s) not yet activated`;
            if (activeCount > 0) {
                const bits = [`${activeCount} item(s) activated`];
                if (customCount) bits.push(`${customCount} customized`);
                if (removedCount) bits.push(`${removedCount} not activated`);
                metaText = bits.join(' · ');
            }
            if (metaEl) metaEl.textContent = metaText;

            animateFeeValue(total);
        }

        let srFeeBarCurrent = 0;
        function animateFeeValue(target) {
            const el = document.getElementById('srFeeBarValue');
            if (!el) return;
            const start = srFeeBarCurrent;
            const diff = target - start;
            const duration = 420;
            const startTime = performance.now();

            function tick(now) {
                const p = Math.min(1, (now - startTime) / duration);
                const eased = 1 - Math.pow(1 - p, 3);
                const value = Math.round(start + diff * eased);
                el.textContent = value.toLocaleString();
                if (p < 1) requestAnimationFrame(tick);
                else srFeeBarCurrent = target;
            }
            requestAnimationFrame(tick);

            const barInner = el.closest('.sr-fee-bar-amount');
            if (barInner) {
                barInner.classList.remove('sr-pulse');
                void barInner.offsetWidth;
                barInner.classList.add('sr-pulse');
            }
        }

        // ========== Attach globals ==========
        window.updateRegistrationFeeStructures = updateRegistrationFeeStructures;
        window.loadFeeStructureItemsForCustomization = loadFeeStructureItemsForCustomization;
        window.resetRegistrationFormFields = resetRegistrationFormFields;
        window.submitStudentRegistrationWithCustomizations = submitStudentRegistrationWithCustomizations;

        document.getElementById('registerBtn')?.addEventListener('click', submitStudentRegistrationWithCustomizations);

        const bursarySelect = document.getElementById('bursaryId');
        if (bursarySelect) {
            bursarySelect.addEventListener('change', function () {
                const customContainer = document.getElementById('customBursaryContainer');
                if (customContainer) {
                    if (this.value === 'custom') {
                        customContainer.classList.remove('hidden');
                        document.getElementById('customBursaryAmount')?.focus();
                    } else {
                        customContainer.classList.add('hidden');
                    }
                }
                recalcFeeBar();
            });
        }
        document.getElementById('customBursaryAmount')?.addEventListener('input', () => recalcFeeBar());

        const classSelect = document.getElementById('classId');
        if (classSelect) {
            classSelect.addEventListener('change', () => window.updateRegistrationFeeStructures());
        }

        const feeSelect = document.getElementById('feeStructureId');
        if (feeSelect) {
            feeSelect.addEventListener('change', () => window.loadFeeStructureItemsForCustomization());
        }

        // ========== Search / status-group filter listeners ==========
        document.getElementById('srItemsSearchInput')?.addEventListener('input', () => {
            clearTimeout(srItemsSearchDebounceHandle);
            srItemsSearchDebounceHandle = setTimeout(applyItemsFilter, 150);
        });
        document.getElementById('srItemsSearchInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.target.value = '';
                applyItemsFilter();
            }
        });
        document.getElementById('srItemsGroupFilter')?.addEventListener('change', applyItemsFilter);
        document.getElementById('srItemsSearchClear')?.addEventListener('click', () => {
            const input = document.getElementById('srItemsSearchInput');
            if (input) input.value = '';
            applyItemsFilter();
        });

        console.log('showStudentRegistration rendered successfully (v6.0 - default-removed items + fuzzy search/filter)');

    } catch (error) {
        console.error('Error:', error);
        const mainContent = document.getElementById('mainContent');
        if (mainContent) {
            mainContent.innerHTML = `
                ${styleBlock()}
                <div class="sr-error-state">
                    <i class="fas fa-triangle-exclamation"></i>
                    <p>${error.message}</p>
                    <button onclick="showStudentRegistration()" class="sr-btn sr-btn-primary">Retry</button>
                </div>
            `;
        }
    }
}

// ============================================================================
// SUPPORTING INFRASTRUCTURE
// (styleBlock, toast/confirm-modal system, stepper + scrollspy, html escape)
// ============================================================================

// ---------------------------------------------------------------------------
// escapeHtmlSafe — used when interpolating text into onclick="" attribute
// strings, so quotes/HTML in names never break markup.
// ---------------------------------------------------------------------------
function escapeHtmlSafe(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// scrollToSection — smooth-scrolls to a card and gives it a brief highlight
// ring so the person can see exactly what needs attention (used by the
// stepper nav and by jumpToFirstError on validation failure).
// ---------------------------------------------------------------------------
function scrollToSection(sectionId) {
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('sr-card-flash');
    void el.offsetWidth;
    el.classList.add('sr-card-flash');
    setTimeout(() => el.classList.remove('sr-card-flash'), 1400);
}

// ---------------------------------------------------------------------------
// initStepperAndScrollSpy — wires the pill nav at the top of the form:
// clicking a step scrolls to that section; scrolling the page updates which
// step is marked active via IntersectionObserver, and slides an underline
// indicator beneath the active pill.
// ---------------------------------------------------------------------------
function initStepperAndScrollSpy() {
    const stepper = document.getElementById('srStepper');
    if (!stepper) return;

    const steps = Array.from(stepper.querySelectorAll('.sr-step'));
    const progress = document.getElementById('srStepProgress');

    function setActive(index) {
        steps.forEach((s, i) => s.classList.toggle('sr-step-active', i === index));
        const activeStep = steps[index];
        if (activeStep && progress) {
            const stepperRect = stepper.getBoundingClientRect();
            const rect = activeStep.getBoundingClientRect();
            progress.style.width = rect.width + 'px';
            progress.style.transform = `translateX(${rect.left - stepperRect.left}px)`;
        }
    }

    steps.forEach((step, i) => {
        step.addEventListener('click', () => {
            const targetId = step.dataset.stepTarget;
            scrollToSection(targetId);
            setActive(i);
        });
    });

    // Scrollspy via IntersectionObserver
    const sections = steps
        .map(s => document.getElementById(s.dataset.stepTarget))
        .filter(Boolean);

    if ('IntersectionObserver' in window && sections.length) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const idx = sections.findIndex(s => s.id === entry.target.id);
                    if (idx !== -1) setActive(idx);
                }
            });
        }, { rootMargin: '-35% 0px -55% 0px', threshold: 0 });

        sections.forEach(s => observer.observe(s));
    }

    // Initial state + keep underline aligned on resize
    setTimeout(() => setActive(0), 60);
    window.addEventListener('resize', () => {
        const activeIdx = steps.findIndex(s => s.classList.contains('sr-step-active'));
        setActive(activeIdx === -1 ? 0 : activeIdx);
    });
}

// ---------------------------------------------------------------------------
// ensureSharedUiHelpers — defines window.showToast and window.showConfirmModal
// only if the host app hasn't already defined its own (so this file can drop
// into any page without clobbering an existing notification system).
// ---------------------------------------------------------------------------
function ensureSharedUiHelpers() {
    if (typeof injectDashboardDesignSystem === 'function') injectDashboardDesignSystem();
    injectSrRuntimeStyles();

    if (typeof window.showToast !== 'function') {
        window.showToast = function (message, type, duration) {
            type = type || 'success';
            duration = duration || 4000;

            const config = {
                success: { bg: '#0E9C8E', icon: 'fa-circle-check' },
                error: { bg: '#E45B6B', icon: 'fa-circle-exclamation' },
                warning: { bg: '#DB9A2C', icon: 'fa-triangle-exclamation' },
                info: { bg: '#4F5FE8', icon: 'fa-circle-info' }
            };
            const c = config[type] || config.success;

            let stack = document.getElementById('srToastStack');
            if (!stack) {
                stack = document.createElement('div');
                stack.id = 'srToastStack';
                stack.className = 'sr-toast-stack';
                document.body.appendChild(stack);
            }

            const toast = document.createElement('div');
            toast.className = 'sr-toast';
            toast.style.setProperty('--sr-toast-bg', c.bg);
            toast.innerHTML = `<i class="fas ${c.icon}"></i><span>${message}</span>`;
            stack.appendChild(toast);

            requestAnimationFrame(() => toast.classList.add('sr-toast-in'));

            setTimeout(() => {
                toast.classList.remove('sr-toast-in');
                toast.classList.add('sr-toast-out');
                setTimeout(() => toast.remove(), 260);
            }, duration);
        };
    }

    if (typeof window.showConfirmModal !== 'function') {
        window.showConfirmModal = function ({ tone = 'info', title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel' } = {}) {
            return new Promise((resolve) => {
                const toneConfig = {
                    danger: { icon: 'fa-trash', color: '#E45B6B' },
                    success: { icon: 'fa-circle-check', color: '#0E9C8E' },
                    warning: { icon: 'fa-triangle-exclamation', color: '#DB9A2C' },
                    info: { icon: 'fa-circle-info', color: '#4F5FE8' }
                };
                const t = toneConfig[tone] || toneConfig.info;

                const overlay = document.createElement('div');
                overlay.className = 'sr-modal-overlay';
                overlay.innerHTML = `
                    <div class="sr-modal" style="--sr-modal-color:${t.color}">
                        <div class="sr-modal-icon"><i class="fas ${t.icon}"></i></div>
                        <h3 class="sr-modal-title">${title}</h3>
                        ${message ? `<p class="sr-modal-message">${message}</p>` : ''}
                        <div class="sr-modal-actions">
                            <button type="button" class="sr-btn sr-btn-ghost" data-action="cancel">${cancelLabel}</button>
                            <button type="button" class="sr-btn sr-btn-modal-confirm" style="--sr-modal-color:${t.color}" data-action="confirm">${confirmLabel}</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);
                requestAnimationFrame(() => overlay.classList.add('sr-modal-in'));

                function close(result) {
                    overlay.classList.remove('sr-modal-in');
                    overlay.classList.add('sr-modal-out');
                    setTimeout(() => overlay.remove(), 200);
                    resolve(result);
                }

                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) close(false);
                    const action = e.target.closest('[data-action]')?.dataset?.action;
                    if (action === 'confirm') close(true);
                    if (action === 'cancel') close(false);
                });

                const onKey = (e) => {
                    if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', onKey); }
                    if (e.key === 'Enter') { close(true); document.removeEventListener('keydown', onKey); }
                };
                document.addEventListener('keydown', onKey);
            });
        };
    }
}

// ---------------------------------------------------------------------------
// injectSrRuntimeStyles — the toast stack & modal overlay live outside
// #mainContent (appended to <body>), so their CSS is injected globally once,
// separately from styleBlock() which is scoped to the registration page.
// ---------------------------------------------------------------------------
function injectSrRuntimeStyles() {
    if (document.getElementById('sr-runtime-styles')) return;
    const style = document.createElement('style');
    style.id = 'sr-runtime-styles';
    style.textContent = `
        .sr-toast-stack{ position:fixed; bottom:20px; right:20px; z-index:9999; display:flex; flex-direction:column; gap:10px; align-items:flex-end; }
        .sr-toast{
            background:var(--sr-toast-bg,#0E9C8E); color:#fff; padding:13px 18px; border-radius:14px;
            font-family:'Inter',ui-sans-serif,system-ui,sans-serif; font-size:13.5px; font-weight:500;
            display:flex; align-items:center; gap:10px; box-shadow:0 18px 34px -14px rgba(15,23,42,.35);
            max-width:380px; opacity:0; transform:translateX(24px) scale(.96); transition:opacity .25s ease, transform .25s cubic-bezier(.34,1.56,.64,1);
        }
        .sr-toast i{ font-size:15px; flex-shrink:0; }
        .sr-toast-in{ opacity:1; transform:translateX(0) scale(1); }
        .sr-toast-out{ opacity:0; transform:translateX(12px) scale(.97); }

        .sr-modal-overlay{
            position:fixed; inset:0; background:rgba(11,19,36,.55); backdrop-filter:blur(6px);
            display:flex; align-items:center; justify-content:center; z-index:9999; padding:16px;
            opacity:0; transition:opacity .2s ease;
        }
        .sr-modal-overlay.sr-modal-in{ opacity:1; }
        .sr-modal-overlay.sr-modal-out{ opacity:0; }
        .sr-modal{
            background:#fff; border-radius:22px; padding:30px 28px 24px; max-width:400px; width:100%;
            text-align:center; box-shadow:0 30px 60px -20px rgba(15,23,42,.4);
            transform:translateY(14px) scale(.96); transition:transform .25s cubic-bezier(.34,1.56,.64,1);
            font-family:'Inter',ui-sans-serif,system-ui,sans-serif;
        }
        .sr-modal-overlay.sr-modal-in .sr-modal{ transform:translateY(0) scale(1); }
        .sr-modal-icon{
            width:52px; height:52px; border-radius:16px; background:color-mix(in srgb, var(--sr-modal-color) 12%, white);
            color:var(--sr-modal-color); display:flex; align-items:center; justify-content:center; font-size:20px;
            margin:0 auto 14px;
        }
        .sr-modal-title{ font-family:'Sora',sans-serif; font-weight:700; font-size:17px; color:#0B1324; }
        .sr-modal-message{ font-size:13.5px; color:#64748B; margin-top:8px; line-height:1.5; }
        .sr-modal-actions{ display:flex; gap:10px; margin-top:22px; }
        .sr-modal-actions .sr-btn{ flex:1; justify-content:center; }
        .sr-btn-modal-confirm{ background:var(--sr-modal-color); color:#fff; border:none; }
        .sr-btn-modal-confirm:hover{ filter:brightness(.92); }
    `;
    document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// styleBlock — page-scoped CSS for the registration form. Identity: an
// "enrollment ticket" — the admission-number chip is a perforated stub (like
// tearing a ticket at registration), echoing the receipt-edge hero used
// elsewhere in the app. Section accents (indigo/teal/violet/gold) code the
// four steps so the eye tracks progress by color, not just number.
// ---------------------------------------------------------------------------
function styleBlock() {
    return `
    <style>
        .sr-page{ font-family:'Inter',ui-sans-serif,system-ui,sans-serif; color:#0B1324; padding-bottom:100px; }
        .hidden{ display:none !important; }

        /* ================= LOADING ================= */
        .sr-loading-wrap{ display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:60vh; gap:16px; }
        .sr-loading-ring{ width:44px; height:44px; border-radius:50%; border:3px solid #E7ECF3; border-top-color:#0E9C8E; animation:sr-spin .8s linear infinite; }
        .sr-loading-text{ font-family:'Inter',sans-serif; color:#94A3B8; font-size:13.5px; }
        @keyframes sr-spin{ to{ transform:rotate(360deg); } }

        /* ================= ERROR ================= */
        .sr-error-state{ display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:50vh; gap:14px; text-align:center; padding:20px; }
        .sr-error-state i{ font-size:38px; color:#E45B6B; }
        .sr-error-state p{ color:#64748B; font-size:14px; max-width:360px; }

        /* ================= HERO ================= */
        .sr-hero{
            position:relative; background:linear-gradient(115deg,#0B7A70 0%, #0E9C8E 42%, #4F5FE8 100%);
            border-radius:26px; padding:30px 30px 20px; color:#fff; overflow:hidden;
            box-shadow:0 20px 45px -18px rgba(15,23,42,.35); margin-bottom:26px;
        }
        .sr-hero-edge{
            position:absolute; left:0; right:0; bottom:-1px; height:14px;
            background:
              linear-gradient(135deg, transparent 66.6%, #F3F6FB 33.4%) 0 0/14px 14px,
              linear-gradient(-135deg, transparent 66.6%, #F3F6FB 33.4%) 0 0/14px 14px;
            background-repeat:repeat-x;
        }
        .sr-hero-inner{ display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:18px; position:relative; z-index:1; }
        .sr-hero-eyebrow{ font-family:'Sora',sans-serif; font-weight:700; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:rgba(255,255,255,.72); }
        .sr-hero-title{ font-family:'Sora',sans-serif; font-weight:800; font-size:28px; letter-spacing:-.01em; margin-top:2px; }
        .sr-hero-sub{ font-size:13px; color:rgba(255,255,255,.82); margin-top:6px; }
        .sr-req{ color:#FDBA74; font-weight:700; }

        /* Admission chip — perforated ticket stub */
        .sr-admission-chip{
            position:relative; background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.28);
            border-radius:14px; padding:12px 22px; backdrop-filter:blur(6px); text-align:right; min-width:220px;
        }
        .sr-admission-chip-notch{
            position:absolute; top:50%; width:16px; height:16px; background:#0E9C8E; border-radius:50%; transform:translateY(-50%);
        }
        .sr-admission-chip-notch-l{ left:-8px; }
        .sr-admission-chip-notch-r{ right:-8px; }
        .sr-admission-chip::after{
            content:''; position:absolute; left:14px; right:14px; top:50%; border-top:1.5px dashed rgba(255,255,255,.35); transform:translateY(-50%); z-index:0;
        }
        .sr-admission-label{ font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:rgba(255,255,255,.75); position:relative; z-index:1; display:flex; gap:6px; align-items:center; justify-content:flex-end; }
        .sr-admission-value{ font-family:'JetBrains Mono',ui-monospace,monospace; font-weight:700; font-size:18px; margin-top:2px; position:relative; z-index:1; }

        /* ================= STEPPER ================= */
        .sr-stepper{ position:relative; display:flex; align-items:center; margin-top:22px; padding-top:16px; border-top:1px solid rgba(255,255,255,.18); flex-wrap:wrap; gap:2px; }
        .sr-step{
            display:flex; align-items:center; gap:8px; background:none; border:none; color:rgba(255,255,255,.65);
            font-family:'Inter',sans-serif; font-size:12.5px; font-weight:600; padding:7px 12px; border-radius:10px; cursor:pointer;
            transition:color .2s ease, background .2s ease;
        }
        .sr-step:hover{ color:#fff; background:rgba(255,255,255,.08); }
        .sr-step-num{
            width:20px; height:20px; border-radius:50%; background:rgba(255,255,255,.16); display:flex; align-items:center; justify-content:center;
            font-size:11px; font-weight:700; flex-shrink:0; transition:background .2s ease, color .2s ease;
        }
        .sr-step-active{ color:#fff; }
        .sr-step-active .sr-step-num{ background:#fff; color:#0B7A70; }
        .sr-step-line{ width:20px; height:1px; background:rgba(255,255,255,.2); flex-shrink:0; }
        .sr-step-progress{ position:absolute; bottom:-1px; left:0; height:2px; background:#FDBA74; border-radius:2px; transition:transform .3s cubic-bezier(.65,0,.35,1), width .3s cubic-bezier(.65,0,.35,1); }

        /* ================= FORM / CARDS ================= */
        .sr-form{ display:flex; flex-direction:column; gap:18px; }
        .sr-card{
            background:#fff; border:1px solid #E7ECF3; border-radius:20px; overflow:hidden;
            border-top:3px solid var(--sr-accent,#4F5FE8);
            opacity:0; transform:translateY(10px); animation:sr-card-in .5s cubic-bezier(.22,1,.36,1) forwards;
            animation-delay:var(--sr-delay,0ms);
        }
        @keyframes sr-card-in{ to{ opacity:1; transform:translateY(0); } }
        .sr-card-flash{ animation:sr-flash-ring 1.4s ease; }
        @keyframes sr-flash-ring{
            0%{ box-shadow:0 0 0 0 color-mix(in srgb, var(--sr-accent,#4F5FE8) 45%, transparent); }
            60%{ box-shadow:0 0 0 8px color-mix(in srgb, var(--sr-accent,#4F5FE8) 0%, transparent); }
            100%{ box-shadow:0 0 0 0 transparent; }
        }
        .sr-card-head{ display:flex; align-items:center; gap:12px; padding:18px 22px; border-bottom:1px solid #F1F5F9; }
        .sr-card-icon{
            width:38px; height:38px; border-radius:12px; flex-shrink:0; display:flex; align-items:center; justify-content:center;
            background:color-mix(in srgb, var(--sr-accent,#4F5FE8) 12%, white); color:var(--sr-accent,#4F5FE8); font-size:15px;
        }
        .sr-card-title{ font-family:'Sora',sans-serif; font-weight:700; font-size:15.5px; color:#0B1324; }
        .sr-card-sub{ font-size:12px; color:#94A3B8; margin-top:1px; }
        .sr-card-body{ padding:20px 22px 22px; }

        /* ================= FIELDS ================= */
        .sr-grid{ display:grid; gap:16px; }
        .sr-grid-2{ grid-template-columns:repeat(2,1fr); }
        .sr-grid-3{ grid-template-columns:repeat(3,1fr); }
        @media (max-width:720px){ .sr-grid-2, .sr-grid-3{ grid-template-columns:1fr; } }
        .sr-span-2{ grid-column:span 2; }
        @media (max-width:720px){ .sr-span-2{ grid-column:span 1; } }
        .sr-field{ display:flex; flex-direction:column; gap:6px; }
        .sr-label{ font-size:12px; font-weight:600; color:#475569; }
        .sr-input{
            border:1.5px solid #E7ECF3; border-radius:12px; padding:10px 13px; font-size:13.5px; font-family:'Inter',sans-serif;
            color:#0B1324; background:#fff; transition:border-color .15s ease, box-shadow .15s ease; outline:none; width:100%;
        }
        .sr-input:focus{ border-color:var(--sr-accent,#0E9C8E); box-shadow:0 0 0 3px color-mix(in srgb, var(--sr-accent,#0E9C8E) 15%, transparent); }
        .sr-input-sm{ padding:8px 11px; font-size:12.5px; }
        textarea.sr-input{ resize:vertical; }
        .sr-inline-fields{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
        .sr-custom-bursary{ flex:1; min-width:160px; }

        /* ================= ITEMS PANEL ================= */
        .sr-items-panel{ margin-top:22px; padding-top:20px; border-top:1px dashed #E7ECF3; opacity:0; animation:sr-card-in .4s ease forwards; }
        .sr-items-panel-head{ display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:6px; margin-bottom:14px; }
        .sr-items-panel-head h3{ font-family:'Sora',sans-serif; font-weight:700; font-size:14px; color:#0B1324; display:flex; align-items:center; gap:7px; }
        .sr-items-panel-head h3 i{ color:#DB9A2C; }
        .sr-items-panel-hint{ font-size:11.5px; color:#94A3B8; }
        .sr-items-list{ display:flex; flex-direction:column; gap:14px; }

        .sr-empty-state{ text-align:center; padding:34px 10px; color:#CBD5E1; }
        .sr-empty-state i{ font-size:28px; margin-bottom:8px; display:block; }
        .sr-empty-state p{ font-size:13px; color:#94A3B8; }

        .sr-component{ background:#F8FAFC; border-radius:16px; padding:14px 16px; border-left:3px solid var(--sr-accent,#0E9C8E); }
        .sr-component-head{ display:flex; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap; }
        .sr-component-head h4{ font-family:'Sora',sans-serif; font-weight:700; font-size:13.5px; color:#0B1324; flex:1; }
        .sr-component-total{ font-family:'JetBrains Mono',monospace; font-size:12.5px; font-weight:600; color:#475569; }
        .sr-period-chip{
            font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; padding:3px 9px; border-radius:999px;
            background:color-mix(in srgb, var(--sr-accent,#0E9C8E) 14%, white); color:var(--sr-accent,#0E9C8E);
        }
        .sr-component-items{ display:flex; flex-direction:column; gap:8px; }

        .sr-item{
            background:#fff; border:1px solid #EEF1F6; border-radius:14px; padding:13px 15px;
            transition:border-color .2s ease, box-shadow .2s ease, opacity .18s ease, transform .18s ease;
        }
        .sr-item:hover{ box-shadow:0 8px 18px -12px rgba(15,23,42,.18); }
        .sr-item-removed{ background:#FFF5F5; border-color:#FCE4E4; opacity:.75; }
        .sr-item-leaving{ opacity:0; transform:scale(.97); }
        .sr-item-top{ display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; }
        .sr-item-info{ flex:1; min-width:200px; }
        .sr-item-name-row{ display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
        .sr-item-name{ font-weight:600; font-size:13.5px; color:#0B1324; }
        .sr-item-meta{ font-size:11.5px; color:#94A3B8; margin-top:3px; }
        .sr-item-custom-meta{ font-size:11.5px; color:#DB9A2C; font-weight:600; margin-top:2px; }
        .sr-item-removed-meta{ font-size:11.5px; color:#E45B6B; font-weight:600; margin-top:2px; }

        .sr-tag{ font-size:10px; font-weight:700; padding:2.5px 8px; border-radius:999px; text-transform:uppercase; letter-spacing:.03em; }
        .sr-tag-blue{ background:#EFF6FF; color:#2563EB; }
        .sr-tag-green{ background:#ECFDF5; color:#0E9C8E; }
        .sr-tag-violet{ background:#F3F0FF; color:#7C6BEF; }
        .sr-tag-amber{ background:#FFFBEB; color:#B45309; }
        .sr-tag-rose{ background:#FFF1F2; color:#E11D48; }
        .sr-badge-pop{ animation:sr-pop .35s cubic-bezier(.34,1.56,.64,1); }
        @keyframes sr-pop{ 0%{ transform:scale(0.6); opacity:0; } 100%{ transform:scale(1); opacity:1; } }

        .sr-item-actions{ display:flex; gap:6px; flex-shrink:0; }
        .sr-icon-btn{
            width:32px; height:32px; border-radius:10px; border:none; display:flex; align-items:center; justify-content:center;
            font-size:12.5px; cursor:pointer; transition:transform .15s ease, background .15s ease, color .15s ease; gap:6px;
        }
        .sr-icon-btn:hover{ transform:translateY(-1px); }
        .sr-icon-btn-blue{ background:#EFF6FF; color:#2563EB; }
        .sr-icon-btn-blue:hover{ background:#2563EB; color:#fff; }
        .sr-icon-btn-rose{ background:#FFF1F2; color:#E11D48; }
        .sr-icon-btn-rose:hover{ background:#E11D48; color:#fff; }
        .sr-icon-btn-green{ background:#ECFDF5; color:#0E9C8E; width:auto; padding:0 12px; font-size:11.5px; font-weight:700; }
        .sr-icon-btn-green:hover{ background:#0E9C8E; color:#fff; }

        .sr-custom-form{ margin-top:12px; padding-top:12px; border-top:1px dashed #E7ECF3; overflow:hidden; }
        .sr-slide-down{ animation:sr-slide-down .28s cubic-bezier(.22,1,.36,1); }
        @keyframes sr-slide-down{ from{ opacity:0; transform:translateY(-6px); max-height:0; } to{ opacity:1; transform:translateY(0); max-height:200px; } }
        .sr-custom-form-actions{ display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }

        .sr-refresh-pulse{ animation:sr-refresh-pulse .5s ease; }
        @keyframes sr-refresh-pulse{ 0%{ background:#FFFBEB; } 100%{ background:transparent; } }

        /* ================= BUTTONS ================= */
        .sr-btn{
            display:inline-flex; align-items:center; gap:8px; font-family:'Inter',sans-serif; font-weight:600; font-size:13px;
            padding:10px 18px; border-radius:12px; border:1.5px solid transparent; cursor:pointer; transition:all .15s ease; white-space:nowrap;
        }
        .sr-btn-sm{ padding:7px 13px; font-size:12px; border-radius:9px; }
        .sr-btn-primary{ background:linear-gradient(115deg,#0B7A70,#0E9C8E); color:#fff; box-shadow:0 10px 22px -10px rgba(14,156,142,.55); }
        .sr-btn-primary:hover{ transform:translateY(-1px); box-shadow:0 14px 26px -10px rgba(14,156,142,.6); }
        .sr-btn-primary:active{ transform:translateY(0); }
        .sr-btn-loading{ opacity:.75; pointer-events:none; }
        .sr-btn-ghost{ background:#fff; color:#64748B; border-color:#E7ECF3; }
        .sr-btn-ghost:hover{ background:#F8FAFC; color:#334155; }
        .sr-btn-success{ background:#0E9C8E; color:#fff; }
        .sr-btn-success:hover{ background:#0B7A70; }
        .sr-btn-amber{ background:#FFFBEB; color:#B45309; }
        .sr-btn-amber:hover{ background:#FEF3C7; }

        .sr-actions{ display:flex; justify-content:flex-end; gap:10px; padding:4px 2px 40px; }
        @media (max-width:520px){ .sr-actions{ flex-direction:column-reverse; } .sr-actions .sr-btn{ justify-content:center; width:100%; } }

        /* ================= STICKY FEE BAR ================= */
        .sr-fee-bar{
            position:fixed; left:50%; bottom:22px; transform:translateX(-50%); z-index:40; width:min(560px, calc(100% - 32px));
            background:#0B1324; color:#fff; border-radius:18px; overflow:hidden; box-shadow:0 24px 48px -16px rgba(11,19,36,.55);
            animation:sr-feebar-in .4s cubic-bezier(.22,1,.36,1);
        }
        @keyframes sr-feebar-in{ from{ opacity:0; transform:translateX(-50%) translateY(16px); } to{ opacity:1; transform:translateX(-50%) translateY(0); } }
        .sr-fee-bar-perf{
            height:8px; background-image:radial-gradient(circle, #0B1324 2.5px, transparent 2.6px); background-size:14px 14px; background-position:center;
            background-color:#F3F6FB;
        }
        .sr-fee-bar-inner{ display:flex; justify-content:space-between; align-items:center; padding:14px 22px; gap:16px; }
        .sr-fee-bar-info{ display:flex; flex-direction:column; gap:2px; }
        .sr-fee-bar-label{ font-size:11px; font-weight:600; color:rgba(255,255,255,.6); text-transform:uppercase; letter-spacing:.04em; display:flex; align-items:center; gap:6px; }
        .sr-fee-bar-tag{ background:rgba(255,255,255,.12); padding:1px 7px; border-radius:999px; font-size:9.5px; letter-spacing:.02em; }
        .sr-fee-bar-meta{ font-size:11.5px; color:#FDBA74; font-weight:600; }
        .sr-fee-bar-amount{ font-family:'JetBrains Mono',monospace; font-size:20px; font-weight:700; white-space:nowrap; }
        .sr-pulse{ animation:sr-amount-pulse .42s ease; }
        @keyframes sr-amount-pulse{ 0%{ color:#5EEAD4; } 100%{ color:#fff; } }

        @media (prefers-reduced-motion: reduce){
            .sr-card, .sr-items-panel, .sr-component, .sr-item, .sr-toast, .sr-modal, .sr-fee-bar, .sr-badge-pop, .sr-refresh-pulse, .sr-pulse{
                animation:none !important; transition:none !important; opacity:1 !important; transform:none !important;
            }
        }
    </style>
    `;
}

window.showStudentRegistration = showStudentRegistration;
window.escapeHtmlSafe = escapeHtmlSafe;
window.scrollToSection = scrollToSection;
window.initStepperAndScrollSpy = initStepperAndScrollSpy;
window.ensureSharedUiHelpers = ensureSharedUiHelpers;
window.styleBlock = styleBlock;
/* ============================================================================
   Shared UI helpers: toast + confirm modal + stepper/scrollspy + style block
   Defined defensively so they don't clash if the host app already has them.
   ============================================================================ */

function ensureSharedUiHelpers() {
    if (typeof window.showToast !== 'function') {
        window.showToast = function (message, type = 'info', duration = 3200) {
            let host = document.getElementById('srToastHost');
            if (!host) {
                host = document.createElement('div');
                host.id = 'srToastHost';
                host.className = 'sr-toast-host';
                document.body.appendChild(host);
            }
            const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
            const toast = document.createElement('div');
            toast.className = `sr-toast sr-toast-${type}`;
            toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
            host.appendChild(toast);
            requestAnimationFrame(() => toast.classList.add('sr-toast-in'));
            setTimeout(() => {
                toast.classList.remove('sr-toast-in');
                toast.classList.add('sr-toast-out');
                setTimeout(() => toast.remove(), 220);
            }, duration);
        };
    }

    if (typeof window.showConfirmModal !== 'function') {
        window.showConfirmModal = function ({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'default' }) {
            return new Promise(resolve => {
                const overlay = document.createElement('div');
                overlay.className = 'sr-modal-overlay';
                overlay.innerHTML = `
                    <div class="sr-modal sr-modal-${tone}" role="dialog" aria-modal="true">
                        <h3>${title}</h3>
                        <p>${message}</p>
                        <div class="sr-modal-actions">
                            <button type="button" class="sr-btn sr-btn-ghost" data-act="cancel">${cancelLabel}</button>
                            <button type="button" class="sr-btn ${tone === 'danger' ? 'sr-btn-danger' : 'sr-btn-primary'}" data-act="confirm">${confirmLabel}</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);
                requestAnimationFrame(() => overlay.classList.add('sr-modal-in'));

                function close(result) {
                    overlay.classList.remove('sr-modal-in');
                    overlay.classList.add('sr-modal-out');
                    setTimeout(() => overlay.remove(), 180);
                    resolve(result);
                }

                overlay.querySelector('[data-act="cancel"]').onclick = () => close(false);
                overlay.querySelector('[data-act="confirm"]').onclick = () => close(true);
                overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
                document.addEventListener('keydown', function esc(e) {
                    if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', esc); }
                });
            });
        };
    }
}

function escapeHtmlSafe(str) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(str);
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

function scrollToSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initStepperAndScrollSpy() {
    const stepper = document.getElementById('srStepper');
    if (!stepper) return;

    stepper.querySelectorAll('.sr-step').forEach(btn => {
        btn.addEventListener('click', () => scrollToSection(btn.dataset.stepTarget));
    });

    const sections = ['srSection1', 'srSection2', 'srSection3', 'srSection4']
        .map(id => document.getElementById(id)).filter(Boolean);

    if (!('IntersectionObserver' in window) || sections.length === 0) return;

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const index = sections.indexOf(entry.target);
                stepper.querySelectorAll('.sr-step').forEach((btn, i) => {
                    btn.classList.toggle('sr-step-active', i === index);
                    btn.classList.toggle('sr-step-done', i < index);
                });
            }
        });
    }, { rootMargin: '-40% 0px -50% 0px', threshold: 0 });

    sections.forEach(s => observer.observe(s));
}

function styleBlock() {
    return `
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');

        .sr-page { font-family: 'Inter', system-ui, sans-serif; color: #111827; padding-bottom: 96px; }
        .sr-page h1, .sr-page h2, .sr-page h3, .sr-page h4 { font-family: 'Sora', 'Inter', sans-serif; }
        .sr-req { color: #E11D48; }

        .sr-loading-wrap { display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 80px 0; gap: 16px; }
        .sr-loading-ring { width: 40px; height: 40px; border-radius: 50%; border: 3px solid #E5E7EB; border-top-color: #4F46E5; animation: sr-spin 0.8s linear infinite; }
        .sr-loading-text { color: #6B7280; font-size: 14px; }
        @keyframes sr-spin { to { transform: rotate(360deg); } }

        .sr-hero { background: linear-gradient(135deg, #4338CA 0%, #4F46E5 55%, #6D28D9 100%); border-radius: 20px; padding: 28px 28px 20px; color: #fff; box-shadow: 0 12px 30px -12px rgba(79,70,229,0.45); }
        .sr-hero-inner { display:flex; justify-content:space-between; align-items:flex-start; gap: 16px; flex-wrap: wrap; }
        .sr-hero-eyebrow { text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; font-weight: 600; opacity: 0.75; margin: 0 0 4px; }
        .sr-hero-title { font-size: 26px; font-weight: 700; margin: 0 0 6px; }
        .sr-hero-sub { font-size: 13px; opacity: 0.85; margin: 0; }
        .sr-admission-chip { background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.22); border-radius: 12px; padding: 10px 16px; backdrop-filter: blur(6px); }
        .sr-admission-label { font-size: 11px; opacity: 0.8; margin: 0; }
        .sr-admission-value { font-size: 19px; font-weight: 700; margin: 2px 0 0; font-family: 'Sora', sans-serif; }

        .sr-stepper { display:flex; align-items:center; margin-top: 22px; overflow-x:auto; }
        .sr-step { display:flex; align-items:center; gap: 8px; background:none; border:none; color: rgba(255,255,255,0.65); cursor:pointer; padding: 6px 4px; white-space:nowrap; transition: color 0.2s ease; }
        .sr-step:hover { color: #fff; }
        .sr-step-num { width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid currentColor; display:flex; align-items:center; justify-content:center; font-size: 12px; font-weight: 600; transition: all 0.25s ease; }
        .sr-step-label { font-size: 13px; font-weight: 500; }
        .sr-step-line { flex: 1; height: 1px; background: rgba(255,255,255,0.25); margin: 0 6px; min-width: 20px; }
        .sr-step-active { color: #fff; }
        .sr-step-active .sr-step-num { background: #fff; color: #4338CA; border-color: #fff; transform: scale(1.08); }
        .sr-step-done .sr-step-num { background: rgba(255,255,255,0.9); color: #4338CA; border-color: #fff; }

        .sr-in { opacity: 0; transform: translateY(14px); animation: sr-rise 0.5s cubic-bezier(.22,1,.36,1) forwards; animation-delay: var(--sr-delay, 0ms); }
        @keyframes sr-rise { to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) { .sr-in { animation: none; opacity: 1; transform: none; } }

        .sr-form { margin-top: 20px; display:flex; flex-direction:column; gap: 18px; }
        .sr-card { background: #fff; border-radius: 16px; border: 1px solid #E5E7EB; box-shadow: 0 1px 2px rgba(16,24,40,0.04); overflow: hidden; scroll-margin-top: 20px; }
        .sr-card-head { display:flex; align-items:center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid #F1F2F6; border-left: 3px solid var(--sr-accent); }
        .sr-card-icon { width: 38px; height: 38px; border-radius: 10px; background: color-mix(in srgb, var(--sr-accent) 12%, white); color: var(--sr-accent); display:flex; align-items:center; justify-content:center; font-size: 16px; flex-shrink:0; }
        .sr-card-title { font-size: 16px; font-weight: 600; margin: 0; }
        .sr-card-sub { font-size: 12.5px; color: #6B7280; margin: 2px 0 0; }
        .sr-card-body { padding: 20px; }

        .sr-grid { display:grid; gap: 16px; }
        .sr-grid-2 { grid-template-columns: repeat(2, 1fr); }
        .sr-grid-3 { grid-template-columns: repeat(3, 1fr); }
        .sr-span-2 { grid-column: span 2; }
        @media (max-width: 768px) { .sr-grid-2, .sr-grid-3 { grid-template-columns: 1fr; } .sr-span-2 { grid-column: span 1; } }

        .sr-field { display:flex; flex-direction:column; gap: 6px; }
        .sr-label { font-size: 12.5px; font-weight: 500; color: #374151; }
        .sr-input { width: 100%; border: 1px solid #D1D5DB; border-radius: 10px; padding: 9px 12px; font-size: 13.5px; font-family: 'Inter', sans-serif; color: #111827; background: #fff; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
        .sr-input:hover { border-color: #B4B9C4; }
        .sr-input:focus { outline: none; border-color: #4F46E5; box-shadow: 0 0 0 3px rgba(79,70,229,0.14); }
        .sr-input-sm { padding: 7px 10px; font-size: 13px; }
        .sr-inline-fields { display:flex; gap: 8px; align-items:flex-start; }
        .sr-inline-fields .sr-input { flex: 1; }

        .sr-items-panel { margin-top: 18px; border: 1px solid #FDE4C0; background: #FFFBF3; border-radius: 14px; padding: 18px; }
        .sr-items-panel-head { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap: 6px; margin-bottom: 4px; }
        .sr-items-panel-head h3 { font-size: 14.5px; font-weight: 600; margin:0; display:flex; align-items:center; gap: 8px; color: #92400E; }
        .sr-items-panel-hint { font-size: 12px; color: #A16207; }
        .sr-items-list { margin-top: 14px; display:flex; flex-direction:column; gap: 14px; max-height: 420px; overflow-y:auto; padding-right: 4px; }

        .sr-empty-state { text-align:center; color: #9CA3AF; padding: 36px 0; }
        .sr-empty-state i { font-size: 26px; margin-bottom: 8px; display:block; }

        .sr-component { border-radius: 12px; border: 1px solid #EEE1CC; background: #fff; padding: 14px; border-left: 3px solid var(--sr-accent); }
        .sr-component-head { display:flex; align-items:center; gap: 10px; margin-bottom: 10px; }
        .sr-component-head h4 { flex:1; font-size: 13.5px; font-weight: 600; margin:0; }
        .sr-period-chip { font-size: 10.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px; color: var(--sr-accent); background: color-mix(in srgb, var(--sr-accent) 14%, white); }
        .sr-component-total { font-size: 13px; font-weight: 600; color: #92400E; font-family: 'Sora', sans-serif; }
        .sr-component-items { display:flex; flex-direction:column; gap: 10px; }

        .sr-item { background: #fff; border: 1px solid #E5E7EB; border-radius: 10px; padding: 12px; transition: all 0.25s ease; }
        .sr-item-removed { background: #FEF2F2; border-color: #FCA5A5; opacity: 0.85; }
        .sr-item-leaving { transform: scale(0.98); opacity: 0.4; }
        .sr-item-top { display:flex; justify-content:space-between; gap: 10px; align-items:flex-start; }
        .sr-item-name-row { display:flex; align-items:center; gap: 6px; flex-wrap:wrap; }
        .sr-item-name { font-size: 13.5px; font-weight: 500; }
        .sr-item-removed .sr-item-name { text-decoration: line-through; color: #9CA3AF; }
        .sr-item-meta { font-size: 11.5px; color: #6B7280; margin: 3px 0 0; }
        .sr-item-custom-meta { font-size: 11.5px; color: #B45309; margin: 2px 0 0; }
        .sr-item-removed-meta { font-size: 11.5px; color: #DC2626; margin: 2px 0 0; }
        .sr-item-actions { display:flex; gap: 6px; flex-shrink:0; }

        .sr-tag { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
        .sr-tag-blue { background:#DBEAFE; color:#1D4ED8; }
        .sr-tag-green { background:#D1FAE5; color:#047857; }
        .sr-tag-violet { background:#EDE9FE; color:#6D28D9; }
        .sr-tag-amber { background:#FEF3C7; color:#B45309; }
        .sr-tag-rose { background:#FFE4E6; color:#BE123C; }
        .sr-badge-pop { animation: sr-pop 0.3s cubic-bezier(.34,1.56,.64,1); }
        @keyframes sr-pop { 0% { transform: scale(0.5); opacity:0; } 100% { transform: scale(1); opacity:1; } }

        .sr-icon-btn { width: 30px; height: 30px; border-radius: 8px; border: none; display:flex; align-items:center; justify-content:center; font-size: 12.5px; cursor:pointer; transition: transform 0.15s ease, background 0.15s ease; }
        .sr-icon-btn:hover { transform: translateY(-1px); }
        .sr-icon-btn:active { transform: scale(0.94); }
        .sr-icon-btn-blue { background:#EFF3FF; color:#3730A3; }
        .sr-icon-btn-blue:hover { background:#E0E7FF; }
        .sr-icon-btn-rose { background:#FFF1F2; color:#BE123C; }
        .sr-icon-btn-rose:hover { background:#FFE4E6; }
        .sr-icon-btn-green { background:#ECFDF5; color:#047857; font-size:11.5px; padding: 0 10px; width:auto; gap:6px; }
        .sr-icon-btn-green:hover { background:#D1FAE5; }

        .sr-custom-form { margin-top: 12px; padding-top: 12px; border-top: 1px dashed #E5E7EB; overflow: hidden; }
        .sr-slide-down { animation: sr-slide 0.28s ease; }
        @keyframes sr-slide { from { max-height:0; opacity:0; } to { max-height:200px; opacity:1; } }
        .sr-custom-form-actions { display:flex; gap: 8px; margin-top: 10px; flex-wrap:wrap; }
        .sr-refresh-pulse { animation: sr-refresh 0.4s ease; }
        @keyframes sr-refresh { 0% { background: #FEF9C3; } 100% { background: transparent; } }

        .sr-custom-bursary { flex-shrink:0; width: 130px; }

        .sr-btn { display:inline-flex; align-items:center; gap: 8px; border-radius: 10px; padding: 10px 18px; font-size: 13.5px; font-weight: 600; border: none; cursor:pointer; transition: transform 0.12s ease, box-shadow 0.15s ease, background 0.15s ease; }
        .sr-btn:active { transform: scale(0.97); }
        .sr-btn-sm { padding: 6px 12px; font-size: 12px; }
        .sr-btn-ghost { background: #F3F4F6; color: #374151; }
        .sr-btn-ghost:hover { background: #E5E7EB; }
        .sr-btn-primary { background: #4F46E5; color: #fff; box-shadow: 0 6px 16px -6px rgba(79,70,229,0.5); }
        .sr-btn-primary:hover { background: #4338CA; }
        .sr-btn-danger { background:#E11D48; color:#fff; }
        .sr-btn-danger:hover { background:#BE123C; }
        .sr-btn-success { background:#10B981; color:#fff; }
        .sr-btn-success:hover { background:#059669; }
        .sr-btn-amber { background:#D97706; color:#fff; }
        .sr-btn-amber:hover { background:#B45309; }
        .sr-btn-loading { opacity: 0.85; cursor: progress; }

        .sr-actions { display:flex; justify-content:flex-end; gap: 10px; padding-bottom: 8px; }

        .sr-fee-bar { position: sticky; bottom: 16px; margin-top: 8px; z-index: 30; animation: sr-rise 0.35s ease; }
        .sr-fee-bar-inner { background: #111827; color: #fff; border-radius: 14px; padding: 14px 20px; display:flex; justify-content:space-between; align-items:center; box-shadow: 0 16px 32px -12px rgba(0,0,0,0.35); }
        .sr-fee-bar-info { display:flex; flex-direction:column; gap: 2px; }
        .sr-fee-bar-label { font-size: 12px; color: #9CA3AF; font-weight: 500; }
        .sr-fee-bar-tag { color: #6B7280; }
        .sr-fee-bar-meta { font-size: 11.5px; color: #D97706; }
        .sr-fee-bar-amount { font-family: 'Sora', sans-serif; font-size: 20px; font-weight: 700; }
        .sr-pulse { animation: sr-flash 0.4s ease; }
        @keyframes sr-flash { 0% { color: #FDE68A; } 100% { color: #fff; } }

        .sr-toast-host { position: fixed; top: 20px; right: 20px; display:flex; flex-direction:column; gap: 10px; z-index: 200; }
        .sr-toast { display:flex; align-items:center; gap: 10px; background:#111827; color:#fff; padding: 12px 16px; border-radius: 10px; font-size: 13px; max-width: 340px; box-shadow: 0 12px 24px -8px rgba(0,0,0,0.3); transform: translateX(120%); opacity:0; transition: all 0.22s cubic-bezier(.22,1,.36,1); }
        .sr-toast-in { transform: translateX(0); opacity:1; }
        .sr-toast-out { transform: translateX(120%); opacity:0; }
        .sr-toast-success i { color:#34D399; } .sr-toast-error i { color:#FB7185; }
        .sr-toast-warning i { color:#FBBF24; } .sr-toast-info i { color:#60A5FA; }

        .sr-modal-overlay { position: fixed; inset:0; background: rgba(17,24,39,0.45); display:flex; align-items:center; justify-content:center; z-index: 300; opacity:0; transition: opacity 0.18s ease; backdrop-filter: blur(2px); }
        .sr-modal-in { opacity:1; }
        .sr-modal-out { opacity:0; }
        .sr-modal { background:#fff; border-radius: 16px; padding: 22px; width: 360px; max-width: 90vw; transform: translateY(10px) scale(0.97); transition: transform 0.18s ease; box-shadow: 0 24px 48px -12px rgba(0,0,0,0.3); }
        .sr-modal-in .sr-modal { transform: translateY(0) scale(1); }
        .sr-modal h3 { font-size: 15.5px; font-weight: 600; margin: 0 0 8px; }
        .sr-modal p { font-size: 13px; color: #6B7280; margin: 0 0 18px; line-height:1.5; }
        .sr-modal-actions { display:flex; justify-content:flex-end; gap: 8px; }

        .sr-error-state { text-align:center; padding: 60px 20px; color:#DC2626; }
        .sr-error-state i { font-size: 30px; margin-bottom: 12px; display:block; }
        .sr-error-state p { margin-bottom: 16px; }
    </style>
    `;
}

// ==================== HELPER FUNCTIONS ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500';
    toast.className = `fixed bottom-4 right-4 ${bgColor} text-white px-4 py-2 rounded-lg shadow-lg z-50`;
    toast.innerHTML = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Make all functions global
window.showStudentRegistration = showStudentRegistration;
window.resetRegistrationFormFields = function() {
    // Reset all form fields
    const fields = ['firstName', 'lastName', 'dob', 'gender', 'birthPlace', 'nationality',
                   'parentName', 'relationship', 'parentPhone', 'parentAltPhone', 'parentEmail', 
                   'parentOccupation', 'address', 'classId', 'previousSchool', 'admissionType', 
                   'enrollmentDate', 'feeStructureId', 'bursaryId'];
    
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (el.tagName === 'SELECT') {
                el.value = '';
            } else {
                el.value = '';
            }
        }
    });
    
    const customBursaryContainer = document.getElementById('customBursaryContainer');
    if (customBursaryContainer) customBursaryContainer.classList.add('hidden');
    
    const customBursaryAmount = document.getElementById('customBursaryAmount');
    if (customBursaryAmount) customBursaryAmount.value = '';
    
    const feePreview = document.getElementById('feePreviewContainer');
    if (feePreview) feePreview.classList.add('hidden');
    
    const itemsContainer = document.getElementById('itemsCustomizationContainer');
    if (itemsContainer) itemsContainer.classList.add('hidden');
    
    window.tempItemCustomizations = {};
    window.tempRemovedItems = {};
    
    showToast('Form has been reset', 'info');
};

console.log('✅ showStudentRegistration with Remove Item Feature loaded successfully!');

// ==================== TOGGLE TRANSPORTATION EDITOR ====================

function toggleTransportationEditor() {
    const editor = document.getElementById('transportationFeeEditor');
    const icon = editor?.querySelector('.fa-chevron-up, .fa-chevron-down');
    const content = editor?.querySelector('.space-y-3:not(.flex)');
    
    if (editor && content) {
        if (content.classList.contains('hidden')) {
            content.classList.remove('hidden');
            if (icon) {
                icon.classList.remove('fa-chevron-down');
                icon.classList.add('fa-chevron-up');
            }
        } else {
            content.classList.add('hidden');
            if (icon) {
                icon.classList.remove('fa-chevron-up');
                icon.classList.add('fa-chevron-down');
            }
        }
    }
}

// ==================== TOGGLE TRANSPORTATION FIELDS ====================

function toggleTransportationFields() {
    const hasTransport = document.getElementById('hasTransportation');
    const fields = document.getElementById('transportationFields');
    const customAmount = document.getElementById('customTransportationAmount');
    const transportDisplay = document.getElementById('transportationDisplayAmount');
    const activityTotalDisplay = document.getElementById('activityTotalDisplay');
    
    if (hasTransport && hasTransport.checked) {
        fields.classList.remove('hidden');
        if (customAmount && window.currentTransportationInfo) {
            customAmount.value = window.currentTransportationInfo.defaultAmount;
            if (transportDisplay) {
                transportDisplay.innerHTML = `UGX ${window.currentTransportationInfo.defaultAmount.toLocaleString()}`;
            }
            if (activityTotalDisplay && window.currentTransportationInfo) {
                const currentTotal = parseInt(activityTotalDisplay.innerHTML.replace(/[^0-9]/g, '')) || 0;
                const newTotal = currentTotal + window.currentTransportationInfo.defaultAmount;
                activityTotalDisplay.innerHTML = `UGX ${newTotal.toLocaleString()}`;
            }
        }
    } else {
        fields.classList.add('hidden');
        if (customAmount) {
            const removedAmount = parseInt(customAmount.value) || 0;
            customAmount.value = '0';
            if (transportDisplay) {
                transportDisplay.innerHTML = `UGX 0 (Disabled)`;
            }
            if (activityTotalDisplay && removedAmount > 0) {
                const currentTotal = parseInt(activityTotalDisplay.innerHTML.replace(/[^0-9]/g, '')) || 0;
                const newTotal = Math.max(0, currentTotal - removedAmount);
                activityTotalDisplay.innerHTML = `UGX ${newTotal.toLocaleString()}`;
            }
        }
    }
}

// ==================== TOGGLE REGISTRATION STATUS GROUP ====================

function toggleRegistrationStatusGroup(collapseId) {
    const detailsDiv = document.getElementById(collapseId);
    const icon = document.getElementById(`${collapseId}_icon`);
    
    if (detailsDiv) {
        if (detailsDiv.classList.contains('hidden')) {
            detailsDiv.classList.remove('hidden');
            if (icon) {
                icon.classList.remove('fa-chevron-down');
                icon.classList.add('fa-chevron-up');
            }
        } else {
            detailsDiv.classList.add('hidden');
            if (icon) {
                icon.classList.remove('fa-chevron-up');
                icon.classList.add('fa-chevron-down');
            }
        }
    }
}

// ==================== SUBMIT STUDENT REGISTRATION ====================

async function submitStudentRegistrationNew() {
    console.log('submitStudentRegistrationNew called');
    
    // Get form values
    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const dob = document.getElementById('dob').value;
    const gender = document.getElementById('gender').value;
    const birthPlace = document.getElementById('birthPlace').value;
    const nationality = document.getElementById('nationality').value;
    
    const parentName = document.getElementById('parentName').value.trim();
    const relationship = document.getElementById('relationship').value;
    const parentPhone = document.getElementById('parentPhone').value.trim();
    const parentAltPhone = document.getElementById('parentAltPhone').value;
    const parentEmail = document.getElementById('parentEmail').value;
    const parentOccupation = document.getElementById('parentOccupation').value;
    const address = document.getElementById('address').value.trim();
    
    const classId = document.getElementById('classId').value;
    const previousSchool = document.getElementById('previousSchool').value;
    const admissionType = document.getElementById('admissionType').value;
    const enrollmentDate = document.getElementById('enrollmentDate').value;
    
    const feeStructureId = document.getElementById('feeStructureId').value;
    
    // Handle bursary (either selected or custom)
    const bursarySelect = document.getElementById('bursaryId');
    let bursaryId = null;
    let customBursaryAmount = null;
    
    // In submitStudentRegistrationNew function, add this before sending:

// Get custom transportation data
const hasTransportationCheck = document.getElementById('hasTransportation');
const customTransportAmount = document.getElementById('customTransportationAmount');

let customTransportationData = null;
if (hasTransportationCheck) {
    customTransportationData = {
        hasTransportation: hasTransportationCheck.checked,
        amount: hasTransportationCheck.checked ? (parseInt(customTransportAmount?.value) || 0) : null,
        itemId: window.currentTransportationInfo?.itemId || null,
        componentId: window.currentTransportationInfo?.componentId || null
    };
}

// Add to studentData
studentData.customTransportation = customTransportationData;

    if (bursarySelect.value === 'custom') {
        customBursaryAmount = parseInt(document.getElementById('customBursaryAmount')?.value) || 0;
        if (customBursaryAmount > 0) {
            bursaryId = 'custom';
        }
    } else if (bursarySelect.value && bursarySelect.value !== '') {
        bursaryId = bursarySelect.value;
    }
    
    // Handle transportation fee customization
    const hasTransportation = document.getElementById('hasTransportation')?.checked || false;
    let customTransportationAmount = null;
    let transportationItemId = null;
    let transportationComponentId = null;
    
    if (hasTransportation && window.currentTransportationInfo) {
        customTransportationAmount = parseInt(document.getElementById('customTransportationAmount')?.value) || 0;
        transportationItemId = window.currentTransportationInfo.itemId;
        transportationComponentId = window.currentTransportationInfo.componentId;
    } else if (window.currentTransportationInfo) {
        customTransportationAmount = -1; // Special flag to remove transportation
        transportationItemId = window.currentTransportationInfo.itemId;
        transportationComponentId = window.currentTransportationInfo.componentId;
    }
    
    // Validate required fields
    const errors = [];
    if (!firstName) errors.push('First Name');
    if (!lastName) errors.push('Last Name');
    if (!gender) errors.push('Gender');
    if (!parentName) errors.push('Parent Name');
    if (!parentPhone) errors.push('Parent Phone');
    if (!address) errors.push('Address');
    if (!classId) errors.push('Class');
    if (!feeStructureId) errors.push('Fee Structure');
    
    if (errors.length > 0) {
        alert(`⚠️ Please fill in the following required fields:\n- ${errors.join('\n- ')}`);
        return;
    }
    
    // Phone validation
    const phoneRegex = /^[0-9]{10,13}$/;
    if (!phoneRegex.test(parentPhone.replace(/[^0-9]/g, ''))) {
        alert('⚠️ Please enter a valid phone number (10-13 digits)');
        return;
    }
    
    // Prepare data
    const studentData = {
        firstName, lastName, dateOfBirth: dob, gender,
        birthPlace, nationality,
        parentName, relationship, parentPhone, parentAltPhone, parentEmail, parentOccupation,
        address,
        enrollmentClass: classId,
        previousSchool, admissionType, enrollmentDate,
        feeStructureId,
        bursaryId: bursaryId === 'custom' ? null : bursaryId,
        customBursaryAmount: customBursaryAmount > 0 ? customBursaryAmount : null,
        customTransportation: {
            hasTransportation: hasTransportation,
            amount: customTransportationAmount,
            itemId: transportationItemId,
            componentId: transportationComponentId
        }
    };
    
    console.log('Submitting student data:', studentData);
    
    const submitBtn = document.getElementById('registerBtn');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registering...';
    submitBtn.disabled = true;
    
    try {
        const response = await fetch('/api/students/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(studentData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            let successMsg = `✅ Student ${firstName} ${lastName} registered successfully!\nAdmission Number: ${result.student.admissionNumber}`;
            if (customBursaryAmount > 0) {
                successMsg += `\n\n🎖️ Custom Bursary Applied: UGX ${customBursaryAmount.toLocaleString()} off tuition`;
            }
            if (customTransportationAmount && customTransportationAmount > 0) {
                successMsg += `\n\n🚌 Transportation Fee: UGX ${customTransportationAmount.toLocaleString()} per term`;
            } else if (hasTransportation === false) {
                successMsg += `\n\n🚌 Transportation Fee: Removed (Student does not use school transport)`;
            }
            alert(successMsg);
            
            // Reset form
            document.getElementById('studentRegForm').reset();
            document.getElementById('feePreviewContainer').classList.add('hidden');
            document.getElementById('customBursaryContainer').classList.add('hidden');
            document.getElementById('transportationFeeEditor').classList.add('hidden');
            
            // Ask what to do next
            const action = confirm('Do you want to view the student list?');
            if (action) {
                showStudentList();
            } else {
                showStudentRegistration();
            }
        } else {
            alert('❌ Registration failed: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Network error:', error);
        alert('❌ Network error: ' + error.message);
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

// ==================== RESET REGISTRATION FORM ====================

function resetRegistrationFormFields() {
    document.getElementById('studentRegForm').reset();
    document.getElementById('feePreviewContainer').classList.add('hidden');
    document.getElementById('customBursaryContainer').classList.add('hidden');
    document.getElementById('transportationFeeEditor').classList.add('hidden');
    showToast('Form has been reset', 'info');
}

// ==================== SHOW TOAST ====================

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
    toast.className = `fixed bottom-4 right-4 ${bgColor} text-white px-4 py-2 rounded-lg shadow-lg z-50`;
    toast.innerHTML = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ==================== ESCAPE HTML ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make functions global
window.showStudentRegistration = showStudentRegistration;
window.updateRegistrationFeeStructures = updateRegistrationFeeStructures;
window.updateRegistrationFeePreview = updateRegistrationFeePreview;
window.toggleTransportationEditor = toggleTransportationEditor;
window.toggleTransportationFields = toggleTransportationFields;
window.toggleRegistrationStatusGroup = toggleRegistrationStatusGroup;
window.submitStudentRegistrationNew = submitStudentRegistrationNew;
window.resetRegistrationFormFields = resetRegistrationFormFields;
window.showToast = showToast;

// ==================== TOGGLE TRANSPORTATION FIELDS ====================

function toggleTransportationFields() {
    const hasTransport = document.getElementById('hasTransportation');
    const fields = document.getElementById('transportationFields');
    const customAmount = document.getElementById('customTransportationAmount');
    const transportDisplay = document.getElementById('transportationDisplayAmount');
    const activityTotalDisplay = document.getElementById('activityTotalDisplay');
    
    if (hasTransport && hasTransport.checked) {
        fields.classList.remove('hidden');
        if (customAmount && window.currentTransportationInfo) {
            customAmount.value = window.currentTransportationInfo.defaultAmount;
            if (transportDisplay) {
                transportDisplay.innerHTML = `UGX ${window.currentTransportationInfo.defaultAmount.toLocaleString()}`;
            }
            // Update activity total
            const baseActivityTotal = (parseInt(activityTotalDisplay?.innerHTML?.replace(/[^0-9]/g, '') || 0) + window.currentTransportationInfo.defaultAmount);
            if (activityTotalDisplay) {
                activityTotalDisplay.innerHTML = `UGX ${baseActivityTotal.toLocaleString()}`;
            }
        }
    } else {
        fields.classList.add('hidden');
        if (customAmount) {
            customAmount.value = '0';
        }
        if (transportDisplay) {
            transportDisplay.innerHTML = `UGX 0 (Disabled)`;
        }
    }
}

// ==================== TOGGLE REGISTRATION STATUS GROUP ====================

function toggleRegistrationStatusGroup(collapseId) {
    const detailsDiv = document.getElementById(collapseId);
    const icon = document.getElementById(`${collapseId}_icon`);
    
    if (detailsDiv) {
        if (detailsDiv.classList.contains('hidden')) {
            detailsDiv.classList.remove('hidden');
            if (icon) {
                icon.classList.remove('fa-chevron-down');
                icon.classList.add('fa-chevron-up');
            }
        } else {
            detailsDiv.classList.add('hidden');
            if (icon) {
                icon.classList.remove('fa-chevron-up');
                icon.classList.add('fa-chevron-down');
            }
        }
    }
}

// ==================== TOGGLE REGISTRATION STATUS GROUP ====================

function toggleRegistrationStatusGroup(collapseId) {
    const detailsDiv = document.getElementById(collapseId);
    const icon = document.getElementById(`${collapseId}_icon`);
    
    if (detailsDiv) {
        if (detailsDiv.classList.contains('hidden')) {
            detailsDiv.classList.remove('hidden');
            if (icon) {
                icon.classList.remove('fa-chevron-down');
                icon.classList.add('fa-chevron-up');
            }
        } else {
            detailsDiv.classList.add('hidden');
            if (icon) {
                icon.classList.remove('fa-chevron-up');
                icon.classList.add('fa-chevron-down');
            }
        }
    }
}

// Make the function global
window.toggleRegistrationStatusGroup = toggleRegistrationStatusGroup;

// ==================== SUBMIT STUDENT REGISTRATION ====================

// ==================== COMPLETE REBUILT SUBMIT STUDENT REGISTRATION ====================
// Version: 4.0 - With Custom Bursary and Custom Transportation

async function submitStudentRegistrationNew() {
    console.log('submitStudentRegistrationNew called - Version 4.0');
    
    // Get form values
    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const dob = document.getElementById('dob').value;
    const gender = document.getElementById('gender').value;
    const birthPlace = document.getElementById('birthPlace').value;
    const nationality = document.getElementById('nationality').value;
    
    const parentName = document.getElementById('parentName').value.trim();
    const relationship = document.getElementById('relationship').value;
    const parentPhone = document.getElementById('parentPhone').value.trim();
    const parentAltPhone = document.getElementById('parentAltPhone').value;
    const parentEmail = document.getElementById('parentEmail').value;
    const parentOccupation = document.getElementById('parentOccupation').value;
    const address = document.getElementById('address').value.trim();
    
    const classId = document.getElementById('classId').value;
    const previousSchool = document.getElementById('previousSchool').value;
    const admissionType = document.getElementById('admissionType').value;
    const enrollmentDate = document.getElementById('enrollmentDate').value;
    
    const feeStructureId = document.getElementById('feeStructureId').value;
    
    // ==================== HANDLE BURSARY ====================
    const bursarySelect = document.getElementById('bursaryId');
    let bursaryId = null;
    let customBursaryAmount = null;
    
    if (bursarySelect.value === 'custom') {
        customBursaryAmount = parseInt(document.getElementById('customBursaryAmount')?.value) || 0;
        if (customBursaryAmount > 0) {
            bursaryId = 'custom';
            console.log('Custom bursary amount:', customBursaryAmount);
        }
    } else if (bursarySelect.value && bursarySelect.value !== '') {
        bursaryId = bursarySelect.value;
        console.log('Selected bursary ID:', bursaryId);
    }
    
    // ==================== HANDLE CUSTOM TRANSPORTATION ====================
    const hasTransportationCheck = document.getElementById('hasTransportation');
    const customTransportAmount = document.getElementById('customTransportationAmount');
    const transportationFields = document.getElementById('transportationFields');
    
    let customTransportationData = null;
    
    // Check if transportation editor exists and is visible
    if (hasTransportationCheck && window.currentTransportationInfo) {
        const hasTransportation = hasTransportationCheck.checked;
        const transportAmount = hasTransportation ? (parseInt(customTransportAmount?.value) || 0) : null;
        
        customTransportationData = {
            hasTransportation: hasTransportation,
            amount: transportAmount,
            itemId: window.currentTransportationInfo.itemId || null,
            componentId: window.currentTransportationInfo.componentId || null,
            componentName: window.currentTransportationInfo.componentName || null,
            itemName: window.currentTransportationInfo.itemName || null,
            defaultAmount: window.currentTransportationInfo.defaultAmount || 0
        };
        
        console.log('Custom transportation data being saved:', customTransportationData);
        
        // Validate transportation amount if applicable
        if (hasTransportation && transportAmount <= 0) {
            alert('⚠️ Please enter a valid transportation fee amount or uncheck if student does not use school transport');
            return;
        }
    } else {
        console.log('No transportation info found for this fee structure');
    }
    
    // ==================== VALIDATE REQUIRED FIELDS ====================
    const errors = [];
    if (!firstName) errors.push('First Name');
    if (!lastName) errors.push('Last Name');
    if (!gender) errors.push('Gender');
    if (!parentName) errors.push('Parent Name');
    if (!parentPhone) errors.push('Parent Phone');
    if (!address) errors.push('Address');
    if (!classId) errors.push('Class');
    if (!feeStructureId) errors.push('Fee Structure');
    
    if (errors.length > 0) {
        alert(`⚠️ Please fill in the following required fields:\n- ${errors.join('\n- ')}`);
        return;
    }
    
    // ==================== PHONE VALIDATION ====================
    const phoneRegex = /^[0-9]{10,13}$/;
    if (!phoneRegex.test(parentPhone.replace(/[^0-9]/g, ''))) {
        alert('⚠️ Please enter a valid phone number (10-13 digits)');
        return;
    }
    
    // ==================== PREPARE STUDENT DATA ====================
    const studentData = {
        firstName: firstName,
        lastName: lastName,
        dateOfBirth: dob,
        gender: gender,
        birthPlace: birthPlace,
        nationality: nationality,
        parentName: parentName,
        relationship: relationship,
        parentPhone: parentPhone,
        parentAltPhone: parentAltPhone,
        parentEmail: parentEmail,
        parentOccupation: parentOccupation,
        address: address,
        enrollmentClass: classId,
        previousSchool: previousSchool,
        admissionType: admissionType,
        enrollmentDate: enrollmentDate,
        feeStructureId: feeStructureId,
        bursaryId: bursaryId === 'custom' ? null : bursaryId,
        customBursaryAmount: customBursaryAmount > 0 ? customBursaryAmount : null,
        customTransportation: customTransportationData
    };
    
    console.log('Final student data being submitted:', JSON.stringify(studentData, null, 2));
    
    // ==================== SUBMIT TO SERVER ====================
    const submitBtn = document.getElementById('registerBtn');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registering...';
    submitBtn.disabled = true;
    
    try {
        const response = await fetch('/api/students/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(studentData)
        });
        
        const result = await response.json();
        console.log('Server response:', result);
        
        if (response.ok) {
            // Build success message
            let successMsg = `✅ Student ${firstName} ${lastName} registered successfully!\n\n📋 Admission Number: ${result.student.admissionNumber}\n`;
            
            if (customBursaryAmount > 0) {
                successMsg += `\n🎖️ Custom Bursary Applied: UGX ${customBursaryAmount.toLocaleString()} off tuition`;
            }
            
            if (customTransportationData) {
                if (customTransportationData.hasTransportation) {
                    successMsg += `\n🚌 Transportation Fee: UGX ${customTransportationData.amount.toLocaleString()} per term`;
                } else {
                    successMsg += `\n🚌 Transportation Fee: Removed (Student does not use school transport)`;
                }
            }
            
            alert(successMsg);
            
            // Reset form
            resetRegistrationFormFields();
            
            // Clear transportation editor
            if (window.currentTransportationInfo) {
                window.currentTransportationInfo = null;
            }
            
            // Ask what to do next
            const action = confirm('Do you want to view the student list?');
            if (action) {
                showStudentList();
            } else {
                showStudentRegistration();
            }
        } else {
            alert('❌ Registration failed: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Network error:', error);
        alert('❌ Network error: ' + error.message);
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

// ==================== RESET REGISTRATION FORM ====================

function resetRegistrationFormFields() {
    // Reset personal info
    const firstName = document.getElementById('firstName');
    const lastName = document.getElementById('lastName');
    const dob = document.getElementById('dob');
    const gender = document.getElementById('gender');
    const birthPlace = document.getElementById('birthPlace');
    const nationality = document.getElementById('nationality');
    
    if (firstName) firstName.value = '';
    if (lastName) lastName.value = '';
    if (dob) dob.value = '';
    if (gender) gender.value = '';
    if (birthPlace) birthPlace.value = '';
    if (nationality) nationality.value = 'Ugandan';
    
    // Reset parent info
    const parentName = document.getElementById('parentName');
    const relationship = document.getElementById('relationship');
    const parentPhone = document.getElementById('parentPhone');
    const parentAltPhone = document.getElementById('parentAltPhone');
    const parentEmail = document.getElementById('parentEmail');
    const parentOccupation = document.getElementById('parentOccupation');
    const address = document.getElementById('address');
    
    if (parentName) parentName.value = '';
    if (relationship) relationship.value = 'Parent';
    if (parentPhone) parentPhone.value = '';
    if (parentAltPhone) parentAltPhone.value = '';
    if (parentEmail) parentEmail.value = '';
    if (parentOccupation) parentOccupation.value = '';
    if (address) address.value = '';
    
    // Reset academic info
    const classId = document.getElementById('classId');
    const previousSchool = document.getElementById('previousSchool');
    const admissionType = document.getElementById('admissionType');
    const enrollmentDate = document.getElementById('enrollmentDate');
    
    if (classId) classId.value = '';
    if (previousSchool) previousSchool.value = '';
    if (admissionType) admissionType.value = 'New';
    if (enrollmentDate) enrollmentDate.value = new Date().toISOString().split('T')[0];
    
    // Reset fee structure
    const feeStructureId = document.getElementById('feeStructureId');
    const bursaryId = document.getElementById('bursaryId');
    if (feeStructureId) feeStructureId.innerHTML = '<option value="">Select Fee Structure</option>';
    if (bursaryId) bursaryId.value = '';
    
    // Reset custom bursary
    const customBursaryContainer = document.getElementById('customBursaryContainer');
    const customBursaryAmount = document.getElementById('customBursaryAmount');
    if (customBursaryContainer) customBursaryContainer.classList.add('hidden');
    if (customBursaryAmount) customBursaryAmount.value = '';
    
    // Reset transportation editor
    const transportationEditor = document.getElementById('transportationFeeEditor');
    const hasTransportation = document.getElementById('hasTransportation');
    const customTransportAmount = document.getElementById('customTransportationAmount');
    const transportationFields = document.getElementById('transportationFields');
    
    if (transportationEditor) transportationEditor.classList.add('hidden');
    if (hasTransportation) hasTransportation.checked = false;
    if (customTransportAmount) customTransportAmount.value = '';
    if (transportationFields) transportationFields.classList.add('hidden');
    
    // Reset fee preview
    const feePreview = document.getElementById('feePreviewContainer');
    if (feePreview) feePreview.classList.add('hidden');
    
    // Clear global variables
    window.currentTransportationInfo = null;
    window.activityGroupsData = [];
    
    showToast('Form has been reset', 'info');
}

// ==================== SHOW TOAST ====================

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
    toast.className = `fixed bottom-4 right-4 ${bgColor} text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-bounce`;
    toast.innerHTML = `
        <div class="flex items-center gap-2">
            <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// ==================== ESCAPE HTML ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make functions global
window.submitStudentRegistrationNew = submitStudentRegistrationNew;
window.resetRegistrationFormFields = resetRegistrationFormFields;
window.showToast = showToast;

// ==================== RESET REGISTRATION FORM ====================

function resetRegistrationFormFields() {
    document.getElementById('studentRegForm').reset();
    document.getElementById('feePreviewContainer').classList.add('hidden');
    document.getElementById('customBursaryContainer').classList.add('hidden');
    showToast('Form has been reset', 'info');
}

// ==================== SHOW TOAST ====================

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
    toast.className = `fixed bottom-4 right-4 ${bgColor} text-white px-4 py-2 rounded-lg shadow-lg z-50`;
    toast.innerHTML = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Make functions global
window.showStudentRegistration = showStudentRegistration;
window.updateRegistrationFeeStructures = updateRegistrationFeeStructures;
window.updateRegistrationFeePreview = updateRegistrationFeePreview;
window.submitStudentRegistrationNew = submitStudentRegistrationNew;
window.resetRegistrationFormFields = resetRegistrationFormFields;
window.showToast = showToast;

// ==================== UPDATE FEE STRUCTURES LIST ====================

function updateFeeStructuresList() {
    const classSelect = document.getElementById('classId');
    const selectedOption = classSelect.options[classSelect.selectedIndex];
    const level = selectedOption?.dataset?.level;
    const feeSelect = document.getElementById('feeStructureId');
    
    if (!level || !window.feeStructuresList) {
        feeSelect.innerHTML = '<option value="">-- Select Fee Structure --</option>';
        document.getElementById('feePreviewContainer').classList.add('hidden');
        return;
    }
    
    // Filter fee structures by level
    const available = window.feeStructuresList.filter(fs => fs.level === level && fs.isActive !== false);
    
    if (available.length === 0) {
        feeSelect.innerHTML = '<option value="">No fee structures for this level</option>';
        document.getElementById('feePreviewContainer').classList.add('hidden');
        return;
    }
    
    feeSelect.innerHTML = '<option value="">-- Select Fee Structure --</option>';
    available.forEach(fs => {
        const option = document.createElement('option');
        option.value = fs.id;
        option.textContent = `${fs.name} - Tuition: UGX ${(fs.tuition || 0).toLocaleString()}`;
        option.dataset.tuition = fs.tuition || 0;
        option.dataset.activityTotal = (fs.activityComponents || []).reduce((sum, c) => sum + (c.totalAmount || 0), 0);
        option.dataset.activityComponents = JSON.stringify(fs.activityComponents || []);
        feeSelect.appendChild(option);
    });
    
    updateFeePreviewDisplay();
}

// ==================== UPDATE FEE PREVIEW DISPLAY ====================

function updateFeePreviewDisplay() {
    const feeSelect = document.getElementById('feeStructureId');
    const bursarySelect = document.getElementById('bursaryId');
    const previewContainer = document.getElementById('feePreviewContainer');
    
    if (!feeSelect || !feeSelect.value) {
        previewContainer.classList.add('hidden');
        return;
    }
    
    const selectedOption = feeSelect.options[feeSelect.selectedIndex];
    let tuition = parseInt(selectedOption.dataset.tuition) || 0;
    const activityTotal = parseInt(selectedOption.dataset.activityTotal) || 0;
    
    // Parse activity components for breakdown display
    let activityComponents = [];
    try {
        activityComponents = JSON.parse(selectedOption.dataset.activityComponents || '[]');
    } catch(e) {}
    
    // Apply bursary to TUITION ONLY
    let discountAmount = 0;
    let discountText = '';
    let appliedBursary = null;
    
    if (bursarySelect && bursarySelect.value) {
        const bursary = window.feeBursariesList?.find(b => b.id === bursarySelect.value);
        if (bursary) {
            appliedBursary = bursary;
            if (bursary.type === 'percentage') {
                discountAmount = (tuition * bursary.value) / 100;
                discountText = `${bursary.value}% off (-UGX ${discountAmount.toLocaleString()})`;
            } else {
                discountAmount = bursary.value;
                discountText = `UGX ${bursary.value.toLocaleString()} off`;
            }
            tuition = Math.max(0, tuition - discountAmount);
        }
    }
    
    // Update display
    document.getElementById('displayTuition').innerHTML = `UGX ${tuition.toLocaleString()}`;
    document.getElementById('displayActivity').innerHTML = `UGX ${activityTotal.toLocaleString()}`;
    
    const bursaryInfoDiv = document.getElementById('displayBursaryInfo');
    if (appliedBursary && discountAmount > 0) {
        bursaryInfoDiv.innerHTML = `<i class="fas fa-ticket-alt"></i> Bursary: ${appliedBursary.name} (${discountText})`;
        bursaryInfoDiv.classList.remove('hidden');
    } else {
        bursaryInfoDiv.classList.add('hidden');
    }
    
    // Build activity breakdown display
    const breakdownDiv = document.getElementById('displayActivityBreakdown');
    if (activityComponents.length > 0) {
        const oneTime = activityComponents.filter(c => c.periodType === 'one_time');
        const termly = activityComponents.filter(c => c.periodType === 'termly');
        const yearly = activityComponents.filter(c => c.periodType === 'yearly');
        
        let breakdownHtml = [];
        if (oneTime.length > 0) breakdownHtml.push(`⭐ One-Time: ${oneTime.length} item(s)`);
        if (termly.length > 0) breakdownHtml.push(`📅 Termly: ${termly.length} item(s)`);
        if (yearly.length > 0) breakdownHtml.push(`📆 Yearly: ${yearly.length} item(s)`);
        breakdownDiv.innerHTML = breakdownHtml.join(' | ');
    } else {
        breakdownDiv.innerHTML = 'No activity items';
    }
    
    previewContainer.classList.remove('hidden');
}

// ==================== SUBMIT STUDENT REGISTRATION ====================

async function submitStudentRegistration() {
    console.log('submitStudentRegistration called');
    
    // Get all form values
    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const dob = document.getElementById('dob').value;
    const gender = document.getElementById('gender').value;
    const birthPlace = document.getElementById('birthPlace').value;
    const nationality = document.getElementById('nationality').value;
    
    const parentName = document.getElementById('parentName').value.trim();
    const relationship = document.getElementById('relationship').value;
    const parentPhone = document.getElementById('parentPhone').value.trim();
    const parentAltPhone = document.getElementById('parentAltPhone').value;
    const parentEmail = document.getElementById('parentEmail').value;
    const parentOccupation = document.getElementById('parentOccupation').value;
    const address = document.getElementById('address').value.trim();
    
    const classId = document.getElementById('classId').value;
    const previousSchool = document.getElementById('previousSchool').value;
    const admissionType = document.getElementById('admissionType').value;
    const enrollmentDate = document.getElementById('enrollmentDate').value;
    
    const feeStructureId = document.getElementById('feeStructureId').value;
    const bursaryId = document.getElementById('bursaryId').value || null;
    
    // Validate required fields
    const errors = [];
    if (!firstName) errors.push('First Name');
    if (!lastName) errors.push('Last Name');
    if (!gender) errors.push('Gender');
    if (!parentName) errors.push('Parent Name');
    if (!parentPhone) errors.push('Parent Phone');
    if (!address) errors.push('Address');
    if (!classId) errors.push('Class');
    if (!feeStructureId) errors.push('Fee Structure');
    
    if (errors.length > 0) {
        alert(`⚠️ Please fill in the following required fields:\n- ${errors.join('\n- ')}`);
        return;
    }
    
    // Phone validation
    const phoneRegex = /^[0-9]{10,13}$/;
    if (!phoneRegex.test(parentPhone.replace(/[^0-9]/g, ''))) {
        alert('⚠️ Please enter a valid phone number (10-13 digits)');
        return;
    }
    
    // Prepare data
   // In submitStudentRegistrationNew function, update the studentData object:

const studentData = {
    firstName, lastName, dateOfBirth: dob, gender,
    birthPlace, nationality,
    parentName, relationship, parentPhone, parentAltPhone, parentEmail, parentOccupation,
    address,
    enrollmentClass: classId,
    previousSchool, admissionType, enrollmentDate,
    feeStructureId,
    bursaryId: bursaryId === 'custom' ? null : bursaryId,
    customBursaryAmount: customBursaryAmount > 0 ? customBursaryAmount : null  // ADD THIS LINE
};
    
    console.log('Submitting student data:', studentData);
    
    const submitBtn = document.getElementById('registerBtn');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registering...';
    submitBtn.disabled = true;
    
    try {
        const response = await fetch('/api/students/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(studentData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            alert(`✅ Student ${firstName} ${lastName} registered successfully!\nAdmission Number: ${result.student.admissionNumber}`);
            
            // Reset form
            document.getElementById('studentRegForm').reset();
            document.getElementById('feePreviewContainer').classList.add('hidden');
            
            // Ask what to do next
            const action = confirm('Do you want to view the student list?');
            if (action) {
                showStudentList();
            } else {
                showStudentRegistration();
            }
        } else {
            alert('❌ Registration failed: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Network error:', error);
        alert('❌ Network error: ' + error.message);
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

function resetRegistrationFormFields() {
    document.getElementById('studentRegForm').reset();
    document.getElementById('feePreviewContainer').classList.add('hidden');
    showToast('Form has been reset', 'info');
}

function showToast(message, type) {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-4 right-4 ${type === 'success' ? 'bg-green-500' : 'bg-blue-500'} text-white px-4 py-2 rounded-lg shadow-lg z-50`;
    toast.innerHTML = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Make functions global
window.showStudentRegistration = showStudentRegistration;
window.updateFeeStructuresList = updateFeeStructuresList;
window.updateFeePreviewDisplay = updateFeePreviewDisplay;
window.submitStudentRegistration = submitStudentRegistration;
window.resetRegistrationFormFields = resetRegistrationFormFields;

// ==================== UPDATE FEE STRUCTURES BY CLASS ====================

function updateFeeStructuresByClass() {
    const classSelect = document.getElementById('classId');
    const selectedOption = classSelect.options[classSelect.selectedIndex];
    const level = selectedOption?.dataset?.level;
    
    const feeSelect = document.getElementById('feeStructureId');
    
    if (!level || !window.feeStructuresDataGlobal) {
        if (feeSelect) {
            feeSelect.innerHTML = '<option value="">Select Fee Structure</option>';
        }
        const feePreview = document.getElementById('feePreview');
        if (feePreview) feePreview.classList.add('hidden');
        return;
    }
    
    const availableStructures = window.feeStructuresDataGlobal.filter(f => f.level === level && f.isActive !== false);
    
    if (!feeSelect) return;
    
    if (availableStructures.length === 0) {
        feeSelect.innerHTML = '<option value="">No fee structures available for this level</option>';
        const feePreview = document.getElementById('feePreview');
        if (feePreview) feePreview.classList.add('hidden');
        return;
    }
    
    feeSelect.innerHTML = '<option value="">Select Fee Structure</option>';
    availableStructures.forEach(fs => {
        const option = document.createElement('option');
        option.value = fs.id;
        option.textContent = `${fs.name} - Tuition: UGX ${(fs.tuition || 0).toLocaleString()}`;
        option.dataset.tuition = fs.tuition || 0;
        option.dataset.activityTotal = fs.activityTotal || 0;
        option.dataset.oneTimeActivities = JSON.stringify(fs.oneTimeActivities || []);
        option.dataset.termlyActivities = JSON.stringify(fs.termlyActivities || []);
        option.dataset.yearlyActivities = JSON.stringify(fs.yearlyActivities || []);
        feeSelect.appendChild(option);
    });
    
    updateFeePreview();
}

// ==================== UPDATE FEE PREVIEW - SEPARATE DISPLAY ====================

function updateFeePreview() {
    const feeSelect = document.getElementById('feeStructureId');
    const bursarySelect = document.getElementById('bursaryId');
    const previewDiv = document.getElementById('feePreview');
    
    if (!feeSelect || !feeSelect.value) {
        if (previewDiv) previewDiv.classList.add('hidden');
        return;
    }
    
    const selectedOption = feeSelect.options[feeSelect.selectedIndex];
    let tuition = parseInt(selectedOption.dataset.tuition) || 0;
    const activityTotal = parseInt(selectedOption.dataset.activityTotal) || 0;
    
    // Get activity breakdown for display
    let oneTimeActivities = [];
    let termlyActivities = [];
    let yearlyActivities = [];
    try {
        oneTimeActivities = JSON.parse(selectedOption.dataset.oneTimeActivities || '[]');
        termlyActivities = JSON.parse(selectedOption.dataset.termlyActivities || '[]');
        yearlyActivities = JSON.parse(selectedOption.dataset.yearlyActivities || '[]');
    } catch(e) {}
    
    let discountAmount = 0;
    let discountText = 'None';
    let appliedBursaryName = '';
    
    // Apply bursary to TUITION ONLY
    if (bursarySelect && bursarySelect.value) {
        const selectedBursary = window.feeBursariesDataGlobal?.find(b => b.id === bursarySelect.value);
        if (selectedBursary) {
            appliedBursaryName = selectedBursary.name;
            if (selectedBursary.type === 'percentage') {
                discountAmount = (tuition * selectedBursary.value) / 100;
                discountText = `${selectedBursary.value}% off`;
            } else {
                discountAmount = selectedBursary.value;
                discountText = `UGX ${selectedBursary.value.toLocaleString()} off`;
            }
            tuition = Math.max(0, tuition - discountAmount);
        }
    }
    
    // Build activity items breakdown text
    let activityItemsText = [];
    if (oneTimeActivities.length > 0) {
        activityItemsText.push(`⭐ One-Time: ${oneTimeActivities.length} item(s)`);
    }
    if (termlyActivities.length > 0) {
        activityItemsText.push(`📅 Termly: ${termlyActivities.length} item(s)`);
    }
    if (yearlyActivities.length > 0) {
        activityItemsText.push(`📆 Yearly: ${yearlyActivities.length} item(s)`);
    }
    
    // Update display
    const previewTuition = document.getElementById('previewTuition');
    const previewActivity = document.getElementById('previewActivity');
    const bursaryDiscountDisplay = document.getElementById('bursaryDiscountDisplay');
    const activityBreakdown = document.getElementById('activityBreakdown');
    
    if (previewTuition) previewTuition.innerHTML = `UGX ${tuition.toLocaleString()}`;
    if (previewActivity) previewActivity.innerHTML = `UGX ${activityTotal.toLocaleString()}`;
    
    if (bursaryDiscountDisplay && discountAmount > 0) {
        bursaryDiscountDisplay.classList.remove('hidden');
        bursaryDiscountDisplay.innerHTML = `<i class="fas fa-ticket-alt"></i> Bursary (${appliedBursaryName}): -UGX ${discountAmount.toLocaleString()} applied to Tuition only`;
    } else if (bursaryDiscountDisplay) {
        bursaryDiscountDisplay.classList.add('hidden');
    }
    
    if (activityBreakdown) {
        if (activityItemsText.length > 0) {
            activityBreakdown.innerHTML = activityItemsText.join(' | ');
        } else {
            activityBreakdown.innerHTML = 'No activity items';
        }
    }
    
    if (previewDiv) previewDiv.classList.remove('hidden');
}

// ==================== HANDLE STUDENT REGISTRATION - WORKING VERSION ====================

async function handleStudentRegistration(e) {
    e.preventDefault();
    console.log('handleStudentRegistration called');
    
    // Get form values
    const firstName = document.getElementById('firstName')?.value.trim();
    const lastName = document.getElementById('lastName')?.value.trim();
    const dateOfBirth = document.getElementById('dob')?.value;
    const gender = document.getElementById('gender')?.value;
    const birthPlace = document.getElementById('birthPlace')?.value;
    const nationality = document.getElementById('nationality')?.value;
    
    const parentName = document.getElementById('parentName')?.value.trim();
    const relationship = document.getElementById('relationship')?.value;
    const parentPhone = document.getElementById('parentPhone')?.value.trim();
    const parentAltPhone = document.getElementById('parentAltPhone')?.value;
    const parentEmail = document.getElementById('parentEmail')?.value;
    const parentOccupation = document.getElementById('parentOccupation')?.value;
    const address = document.getElementById('address')?.value.trim();
    
    const enrollmentClass = document.getElementById('classId')?.value;
    const previousSchool = document.getElementById('previousSchool')?.value;
    const admissionType = document.getElementById('admissionType')?.value;
    const enrollmentDate = document.getElementById('enrollmentDate')?.value;
    
    const feeStructureId = document.getElementById('feeStructureId')?.value;
    const bursaryId = document.getElementById('bursaryId')?.value || null;
    
    // Validation
    if (!firstName || !lastName || !gender || !parentName || !parentPhone || !address || !enrollmentClass || !feeStructureId) {
        alert('⚠️ Please fill in all required fields marked with *');
        return;
    }
    
    // Phone validation
    const phoneRegex = /^[0-9]{10,13}$/;
    if (!phoneRegex.test(parentPhone.replace(/[^0-9]/g, ''))) {
        alert('⚠️ Please enter a valid phone number');
        return;
    }
    
    const submitBtn = document.querySelector('#studentRegForm button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registering...';
    submitBtn.disabled = true;
    
    try {
        // Get the selected fee structure to get tuition amount
        const feeSelect = document.getElementById('feeStructureId');
        const selectedOption = feeSelect.options[feeSelect.selectedIndex];
        const tuitionAmount = parseInt(selectedOption?.dataset?.tuition) || 0;
        
        // Step 1: Register the student
        const studentData = {
            firstName,
            lastName,
            dateOfBirth,
            gender,
            birthPlace,
            nationality,
            parentInfo: {
                name: parentName,
                relationship: relationship,
                phone: parentPhone,
                altPhone: parentAltPhone,
                email: parentEmail,
                occupation: parentOccupation
            },
            address,
            enrollmentClass,
            previousSchool,
            admissionType,
            enrollmentDate,
            feeStructureId,
            bursaryId,
            studentPhoto: window.studentPhotoBase64 || null,
            academicYear: currentAcademicSettings?.currentYear || new Date().getFullYear()
        };
        
        console.log('Sending student data:', studentData);
        
        const response = await fetch('/api/students/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(studentData)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to register student');
        }
        
        const result = await response.json();
        const newStudentId = result.student.id;
        
        // Step 2: Save fee assignment separately
        const assignmentResponse = await fetch('/api/student-fee-assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                studentId: newStudentId,
                feeStructureId: feeStructureId,
                bursaryId: bursaryId
            })
        });
        
        if (!assignmentResponse.ok) {
            console.warn('Fee assignment may not have saved properly');
        }
        
        alert(`✅ Student ${firstName} ${lastName} registered successfully!\nAdmission Number: ${result.student.admissionNumber}\nTuition Fee: UGX ${tuitionAmount.toLocaleString()}\nActivity Fee: To be collected separately`);
        
        // Reset form
        resetRegistrationForm();
        
        // Ask if user wants to view student list
        if (confirm('Do you want to view the student list?')) {
            showStudentList();
        } else if (confirm('Do you want to register another student?')) {
            showStudentRegistration();
        }
        
    } catch (error) {
        console.error('Error:', error);
        alert('❌ Error registering student: ' + error.message);
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

// ==================== RESET REGISTRATION FORM ====================

function resetRegistrationForm() {
    // Reset personal info
    const firstName = document.getElementById('firstName');
    const lastName = document.getElementById('lastName');
    const dob = document.getElementById('dob');
    const gender = document.getElementById('gender');
    const birthPlace = document.getElementById('birthPlace');
    const nationality = document.getElementById('nationality');
    
    if (firstName) firstName.value = '';
    if (lastName) lastName.value = '';
    if (dob) dob.value = '';
    if (gender) gender.value = '';
    if (birthPlace) birthPlace.value = '';
    if (nationality) nationality.value = 'Ugandan';
    
    // Reset parent info
    const parentName = document.getElementById('parentName');
    const relationship = document.getElementById('relationship');
    const parentPhone = document.getElementById('parentPhone');
    const parentAltPhone = document.getElementById('parentAltPhone');
    const parentEmail = document.getElementById('parentEmail');
    const parentOccupation = document.getElementById('parentOccupation');
    const address = document.getElementById('address');
    
    if (parentName) parentName.value = '';
    if (relationship) relationship.value = 'Parent';
    if (parentPhone) parentPhone.value = '';
    if (parentAltPhone) parentAltPhone.value = '';
    if (parentEmail) parentEmail.value = '';
    if (parentOccupation) parentOccupation.value = '';
    if (address) address.value = '';
    
    // Reset academic info
    const classId = document.getElementById('classId');
    const previousSchool = document.getElementById('previousSchool');
    const admissionType = document.getElementById('admissionType');
    const enrollmentDate = document.getElementById('enrollmentDate');
    
    if (classId) classId.value = '';
    if (previousSchool) previousSchool.value = '';
    if (admissionType) admissionType.value = 'New';
    if (enrollmentDate) enrollmentDate.value = new Date().toISOString().split('T')[0];
    
    // Reset fee structure
    const feeStructureId = document.getElementById('feeStructureId');
    const bursaryId = document.getElementById('bursaryId');
    if (feeStructureId) feeStructureId.innerHTML = '<option value="">Select Fee Structure</option>';
    if (bursaryId) bursaryId.value = '';
    
    // Reset photo
    removeStudentPhoto();
    
    // Hide fee preview
    const feePreview = document.getElementById('feePreview');
    if (feePreview) feePreview.classList.add('hidden');
    
    // Clear global photo variable
    window.studentPhotoBase64 = '';
    
    showToast('Form has been reset', 'info');
}

// ==================== PHOTO FUNCTIONS ====================

function previewStudentPhoto(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('photoPreview');
            const placeholder = document.getElementById('photoPlaceholder');
            const removeBtn = document.getElementById('removePhotoBtn');
            
            window.studentPhotoBase64 = e.target.result;
            
            if (preview) {
                preview.src = e.target.result;
                preview.classList.remove('hidden');
                if (placeholder) placeholder.classList.add('hidden');
            }
            if (removeBtn) {
                removeBtn.classList.remove('hidden');
            }
        };
        reader.readAsDataURL(file);
    }
}

function removeStudentPhoto() {
    const preview = document.getElementById('photoPreview');
    const placeholder = document.getElementById('photoPlaceholder');
    const removeBtn = document.getElementById('removePhotoBtn');
    const fileInput = document.getElementById('studentPhoto');
    
    window.studentPhotoBase64 = '';
    
    if (preview) {
        preview.src = '';
        preview.classList.add('hidden');
    }
    if (placeholder) {
        placeholder.classList.remove('hidden');
    }
    if (removeBtn) {
        removeBtn.classList.add('hidden');
    }
    if (fileInput) {
        fileInput.value = '';
    }
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
    toast.className = `fixed bottom-4 right-4 ${bgColor} text-white px-6 py-3 rounded-lg shadow-lg z-50`;
    toast.innerHTML = `
        <div class="flex items-center gap-3">
            <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Make functions global
window.showStudentRegistration = showStudentRegistration;
window.updateFeeStructuresByClass = updateFeeStructuresByClass;
window.updateFeePreview = updateFeePreview;
window.resetRegistrationForm = resetRegistrationForm;
window.previewStudentPhoto = previewStudentPhoto;
window.removeStudentPhoto = removeStudentPhoto;
window.showToast = showToast;

// ==================== UPDATE FEE STRUCTURES BY CLASS ====================

function updateFeeStructuresByClass() {
    const classSelect = document.getElementById('classId');
    const selectedOption = classSelect.options[classSelect.selectedIndex];
    const level = selectedOption?.dataset?.level;
    
    const feeSelect = document.getElementById('feeStructureId');
    
    if (!level || !window.feeStructuresDataGlobal) {
        if (feeSelect) {
            feeSelect.innerHTML = '<option value="">Select Fee Structure</option>';
        }
        const feePreview = document.getElementById('feePreview');
        if (feePreview) feePreview.classList.add('hidden');
        return;
    }
    
    const availableStructures = window.feeStructuresDataGlobal.filter(f => f.level === level && f.isActive !== false);
    
    if (!feeSelect) return;
    
    if (availableStructures.length === 0) {
        feeSelect.innerHTML = '<option value="">No fee structures available for this level</option>';
        const feePreview = document.getElementById('feePreview');
        if (feePreview) feePreview.classList.add('hidden');
        return;
    }
    
    feeSelect.innerHTML = '<option value="">Select Fee Structure</option>';
    availableStructures.forEach(fs => {
        const option = document.createElement('option');
        option.value = fs.id;
        option.textContent = `${fs.name} - Tuition: UGX ${(fs.tuition || 0).toLocaleString()}`;
        option.dataset.tuition = fs.tuition || 0;
        option.dataset.activityTotal = fs.activityTotal || 0;
        option.dataset.oneTimeActivities = JSON.stringify(fs.oneTimeActivities || []);
        option.dataset.termlyActivities = JSON.stringify(fs.termlyActivities || []);
        option.dataset.yearlyActivities = JSON.stringify(fs.yearlyActivities || []);
        feeSelect.appendChild(option);
    });
    
    updateFeePreview();
}

// ==================== UPDATE FEE PREVIEW - SEPARATE DISPLAY ====================

function updateFeePreview() {
    const feeSelect = document.getElementById('feeStructureId');
    const bursarySelect = document.getElementById('bursaryId');
    const previewDiv = document.getElementById('feePreview');
    
    if (!feeSelect || !feeSelect.value) {
        if (previewDiv) previewDiv.classList.add('hidden');
        return;
    }
    
    const selectedOption = feeSelect.options[feeSelect.selectedIndex];
    let tuition = parseInt(selectedOption.dataset.tuition) || 0;
    const activityTotal = parseInt(selectedOption.dataset.activityTotal) || 0;
    
    // Get activity breakdown for display
    let oneTimeActivities = [];
    let termlyActivities = [];
    let yearlyActivities = [];
    try {
        oneTimeActivities = JSON.parse(selectedOption.dataset.oneTimeActivities || '[]');
        termlyActivities = JSON.parse(selectedOption.dataset.termlyActivities || '[]');
        yearlyActivities = JSON.parse(selectedOption.dataset.yearlyActivities || '[]');
    } catch(e) {}
    
    let discountAmount = 0;
    let discountText = 'None';
    let appliedBursaryName = '';
    
    // Apply bursary to TUITION ONLY
    if (bursarySelect && bursarySelect.value) {
        const selectedBursary = window.feeBursariesDataGlobal?.find(b => b.id === bursarySelect.value);
        if (selectedBursary) {
            appliedBursaryName = selectedBursary.name;
            if (selectedBursary.type === 'percentage') {
                discountAmount = (tuition * selectedBursary.value) / 100;
                discountText = `${selectedBursary.value}% off`;
            } else {
                discountAmount = selectedBursary.value;
                discountText = `UGX ${selectedBursary.value.toLocaleString()} off`;
            }
            tuition = Math.max(0, tuition - discountAmount);
        }
    }
    
    // Build activity items breakdown text
    let activityItemsText = [];
    if (oneTimeActivities.length > 0) {
        activityItemsText.push(`⭐ One-Time: ${oneTimeActivities.length} item(s)`);
    }
    if (termlyActivities.length > 0) {
        activityItemsText.push(`📅 Termly: ${termlyActivities.length} item(s)`);
    }
    if (yearlyActivities.length > 0) {
        activityItemsText.push(`📆 Yearly: ${yearlyActivities.length} item(s)`);
    }
    
    // Update display
    const previewTuition = document.getElementById('previewTuition');
    const previewActivity = document.getElementById('previewActivity');
    const bursaryDiscountDisplay = document.getElementById('bursaryDiscountDisplay');
    const activityBreakdown = document.getElementById('activityBreakdown');
    
    if (previewTuition) previewTuition.innerHTML = `UGX ${tuition.toLocaleString()}`;
    if (previewActivity) previewActivity.innerHTML = `UGX ${activityTotal.toLocaleString()}`;
    
    if (bursaryDiscountDisplay && discountAmount > 0) {
        bursaryDiscountDisplay.classList.remove('hidden');
        bursaryDiscountDisplay.innerHTML = `<i class="fas fa-ticket-alt"></i> Bursary (${appliedBursaryName}): -UGX ${discountAmount.toLocaleString()} applied to Tuition only`;
    } else if (bursaryDiscountDisplay) {
        bursaryDiscountDisplay.classList.add('hidden');
    }
    
    if (activityBreakdown) {
        if (activityItemsText.length > 0) {
            activityBreakdown.innerHTML = activityItemsText.join(' | ');
        } else {
            activityBreakdown.innerHTML = 'No activity items';
        }
    }
    
    if (previewDiv) previewDiv.classList.remove('hidden');
}

// ==================== HANDLE STUDENT REGISTRATION - WORKING VERSION ====================

async function handleStudentRegistration(e) {
    e.preventDefault();
    console.log('handleStudentRegistration called');
    
    // Get form values
    const firstName = document.getElementById('firstName')?.value.trim();
    const lastName = document.getElementById('lastName')?.value.trim();
    const dateOfBirth = document.getElementById('dob')?.value;
    const gender = document.getElementById('gender')?.value;
    const birthPlace = document.getElementById('birthPlace')?.value;
    const nationality = document.getElementById('nationality')?.value;
    
    const parentName = document.getElementById('parentName')?.value.trim();
    const relationship = document.getElementById('relationship')?.value;
    const parentPhone = document.getElementById('parentPhone')?.value.trim();
    const parentAltPhone = document.getElementById('parentAltPhone')?.value;
    const parentEmail = document.getElementById('parentEmail')?.value;
    const parentOccupation = document.getElementById('parentOccupation')?.value;
    const address = document.getElementById('address')?.value.trim();
    
    const enrollmentClass = document.getElementById('classId')?.value;
    const previousSchool = document.getElementById('previousSchool')?.value;
    const admissionType = document.getElementById('admissionType')?.value;
    const enrollmentDate = document.getElementById('enrollmentDate')?.value;
    
    const feeStructureId = document.getElementById('feeStructureId')?.value;
    const bursaryId = document.getElementById('bursaryId')?.value || null;
    
    // Validation
    if (!firstName || !lastName || !gender || !parentName || !parentPhone || !address || !enrollmentClass || !feeStructureId) {
        alert('⚠️ Please fill in all required fields marked with *');
        return;
    }
    
    // Phone validation
    const phoneRegex = /^[0-9]{10,13}$/;
    if (!phoneRegex.test(parentPhone.replace(/[^0-9]/g, ''))) {
        alert('⚠️ Please enter a valid phone number');
        return;
    }
    
    const submitBtn = document.querySelector('#studentRegForm button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registering...';
    submitBtn.disabled = true;
    
    try {
        // Get the selected fee structure to get tuition amount
        const feeSelect = document.getElementById('feeStructureId');
        const selectedOption = feeSelect.options[feeSelect.selectedIndex];
        const tuitionAmount = parseInt(selectedOption?.dataset?.tuition) || 0;
        
        // Step 1: Register the student
        const studentData = {
            firstName,
            lastName,
            dateOfBirth,
            gender,
            birthPlace,
            nationality,
            parentInfo: {
                name: parentName,
                relationship: relationship,
                phone: parentPhone,
                altPhone: parentAltPhone,
                email: parentEmail,
                occupation: parentOccupation
            },
            address,
            enrollmentClass,
            previousSchool,
            admissionType,
            enrollmentDate,
            feeStructureId,
            bursaryId,
            studentPhoto: window.studentPhotoBase64 || null,
            academicYear: currentAcademicSettings?.currentYear || new Date().getFullYear()
        };
        
        console.log('Sending student data:', studentData);
        
        const response = await fetch('/api/students/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(studentData)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to register student');
        }
        
        const result = await response.json();
        const newStudentId = result.student.id;
        
        // Step 2: Save fee assignment separately
        const assignmentResponse = await fetch('/api/student-fee-assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                studentId: newStudentId,
                feeStructureId: feeStructureId,
                bursaryId: bursaryId
            })
        });
        
        if (!assignmentResponse.ok) {
            console.warn('Fee assignment may not have saved properly');
        }
        
        alert(`✅ Student ${firstName} ${lastName} registered successfully!\nAdmission Number: ${result.student.admissionNumber}\nTuition Fee: UGX ${tuitionAmount.toLocaleString()}\nActivity Fee: To be collected separately`);
        
        // Reset form
        resetRegistrationForm();
        
        // Ask if user wants to view student list
        if (confirm('Do you want to view the student list?')) {
            showStudentList();
        } else if (confirm('Do you want to register another student?')) {
            showStudentRegistration();
        }
        
    } catch (error) {
        console.error('Error:', error);
        alert('❌ Error registering student: ' + error.message);
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

// ==================== RESET REGISTRATION FORM ====================

function resetRegistrationForm() {
    // Reset personal info
    const firstName = document.getElementById('firstName');
    const lastName = document.getElementById('lastName');
    const dob = document.getElementById('dob');
    const gender = document.getElementById('gender');
    const birthPlace = document.getElementById('birthPlace');
    const nationality = document.getElementById('nationality');
    
    if (firstName) firstName.value = '';
    if (lastName) lastName.value = '';
    if (dob) dob.value = '';
    if (gender) gender.value = '';
    if (birthPlace) birthPlace.value = '';
    if (nationality) nationality.value = 'Ugandan';
    
    // Reset parent info
    const parentName = document.getElementById('parentName');
    const relationship = document.getElementById('relationship');
    const parentPhone = document.getElementById('parentPhone');
    const parentAltPhone = document.getElementById('parentAltPhone');
    const parentEmail = document.getElementById('parentEmail');
    const parentOccupation = document.getElementById('parentOccupation');
    const address = document.getElementById('address');
    
    if (parentName) parentName.value = '';
    if (relationship) relationship.value = 'Parent';
    if (parentPhone) parentPhone.value = '';
    if (parentAltPhone) parentAltPhone.value = '';
    if (parentEmail) parentEmail.value = '';
    if (parentOccupation) parentOccupation.value = '';
    if (address) address.value = '';
    
    // Reset academic info
    const classId = document.getElementById('classId');
    const previousSchool = document.getElementById('previousSchool');
    const admissionType = document.getElementById('admissionType');
    const enrollmentDate = document.getElementById('enrollmentDate');
    
    if (classId) classId.value = '';
    if (previousSchool) previousSchool.value = '';
    if (admissionType) admissionType.value = 'New';
    if (enrollmentDate) enrollmentDate.value = new Date().toISOString().split('T')[0];
    
    // Reset fee structure
    const feeStructureId = document.getElementById('feeStructureId');
    const bursaryId = document.getElementById('bursaryId');
    if (feeStructureId) feeStructureId.innerHTML = '<option value="">Select Fee Structure</option>';
    if (bursaryId) bursaryId.value = '';
    
    // Reset photo
    removeStudentPhoto();
    
    // Hide fee preview
    const feePreview = document.getElementById('feePreview');
    if (feePreview) feePreview.classList.add('hidden');
    
    // Clear global photo variable
    window.studentPhotoBase64 = '';
    
    showToast('Form has been reset', 'info');
}

// ==================== PHOTO FUNCTIONS ====================

function previewStudentPhoto(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('photoPreview');
            const placeholder = document.getElementById('photoPlaceholder');
            const removeBtn = document.getElementById('removePhotoBtn');
            
            window.studentPhotoBase64 = e.target.result;
            
            if (preview) {
                preview.src = e.target.result;
                preview.classList.remove('hidden');
                if (placeholder) placeholder.classList.add('hidden');
            }
            if (removeBtn) {
                removeBtn.classList.remove('hidden');
            }
        };
        reader.readAsDataURL(file);
    }
}

function removeStudentPhoto() {
    const preview = document.getElementById('photoPreview');
    const placeholder = document.getElementById('photoPlaceholder');
    const removeBtn = document.getElementById('removePhotoBtn');
    const fileInput = document.getElementById('studentPhoto');
    
    window.studentPhotoBase64 = '';
    
    if (preview) {
        preview.src = '';
        preview.classList.add('hidden');
    }
    if (placeholder) {
        placeholder.classList.remove('hidden');
    }
    if (removeBtn) {
        removeBtn.classList.add('hidden');
    }
    if (fileInput) {
        fileInput.value = '';
    }
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
    toast.className = `fixed bottom-4 right-4 ${bgColor} text-white px-6 py-3 rounded-lg shadow-lg z-50`;
    toast.innerHTML = `
        <div class="flex items-center gap-3">
            <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Make functions global
window.showStudentRegistration = showStudentRegistration;
window.updateFeeStructuresByClass = updateFeeStructuresByClass;
window.updateFeePreview = updateFeePreview;
window.resetRegistrationForm = resetRegistrationForm;
window.previewStudentPhoto = previewStudentPhoto;
window.removeStudentPhoto = removeStudentPhoto;
window.showToast = showToast;

// ==================== STUDENT PHOTO FUNCTIONS ====================

let studentPhotoBase64 = '';

function previewStudentPhoto(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('photoPreview');
            const placeholder = document.getElementById('photoPlaceholder');
            const removeBtn = document.getElementById('removePhotoBtn');
            
            studentPhotoBase64 = e.target.result;
            
            if (preview) {
                preview.src = e.target.result;
                preview.classList.remove('hidden');
                placeholder.classList.add('hidden');
            }
            if (removeBtn) {
                removeBtn.classList.remove('hidden');
            }
        };
        reader.readAsDataURL(file);
    }
}

function removeStudentPhoto() {
    const preview = document.getElementById('photoPreview');
    const placeholder = document.getElementById('photoPlaceholder');
    const removeBtn = document.getElementById('removePhotoBtn');
    const fileInput = document.getElementById('studentPhoto');
    
    studentPhotoBase64 = '';
    
    if (preview) {
        preview.src = '';
        preview.classList.add('hidden');
    }
    if (placeholder) {
        placeholder.classList.remove('hidden');
    }
    if (removeBtn) {
        removeBtn.classList.add('hidden');
    }
    if (fileInput) {
        fileInput.value = '';
    }
}

// ==================== FEE STRUCTURE FUNCTIONS ====================

// ==================== CORRECTED FEE STRUCTURE FUNCTIONS FOR REGISTRATION ====================

function updateFeeStructuresByClass() {
    console.log('=== updateFeeStructuresByClass called ===');
    
    const classSelect = document.getElementById('classId');
    const selectedOption = classSelect.options[classSelect.selectedIndex];
    const level = selectedOption?.dataset?.level;
    
    console.log('Selected class:', classSelect.value);
    console.log('Selected class name:', selectedOption?.text);
    console.log('Extracted level:', level);
    
    const feeSelect = document.getElementById('feeStructureId');
    
    if (!level || !window.feeStructuresDataGlobal) {
        console.log('No level or feeStructuresDataGlobal missing');
        if (feeSelect) {
            feeSelect.innerHTML = '<option value="">Select Fee Structure</option>';
        }
        const feePreview = document.getElementById('feePreview');
        if (feePreview) feePreview.classList.add('hidden');
        return;
    }
    
    console.log('All fee structures:', window.feeStructuresDataGlobal);
    
    // Filter fee structures by level - case insensitive match
    // Replace the filter line with this more flexible version:
const availableStructures = window.feeStructuresDataGlobal.filter(f => {
    const fsLevel = (f.level || '').toLowerCase().trim();
    const classLevel = level.toLowerCase().trim();
    
    // Also check by class name if level doesn't match
    const selectedClassName = (selectedOption?.text || '').toLowerCase();
    let matchesByName = false;
    if (selectedClassName.includes('baby') || selectedClassName.includes('middle') || selectedClassName.includes('top')) {
        matchesByName = fsLevel === 'nursery';
    } else if (selectedClassName.includes('p.1') || selectedClassName.includes('p.2') || selectedClassName.includes('p.3')) {
        matchesByName = fsLevel === 'lowerprimary';
    } else if (selectedClassName.includes('p.4') || selectedClassName.includes('p.5') || selectedClassName.includes('p.6') || selectedClassName.includes('p.7')) {
        matchesByName = fsLevel === 'upperprimary';
    }
    
    return (fsLevel === classLevel || matchesByName) && f.isActive !== false;
});
    
    console.log('Filtered available structures for level', level, ':', availableStructures);
    
    if (!feeSelect) return;
    
    if (availableStructures.length === 0) {
        console.log('No fee structures found for level:', level);
        feeSelect.innerHTML = '<option value="">No fee structures available for this level</option>';
        const feePreview = document.getElementById('feePreview');
        if (feePreview) feePreview.classList.add('hidden');
        return;
    }
    
    feeSelect.innerHTML = '<option value="">Select Fee Structure</option>';
    availableStructures.forEach(fs => {
        const option = document.createElement('option');
        option.value = fs.id;
        
        // Calculate totals for display
        const oneTimeTotal = (fs.oneTimeActivities || []).reduce((sum, c) => sum + (c.totalAmount || 0), 0);
        const termlyTotal = (fs.termlyActivities || []).reduce((sum, c) => sum + (c.totalAmount || 0), 0);
        const yearlyTotal = (fs.yearlyActivities || []).reduce((sum, c) => sum + (c.totalAmount || 0), 0);
        const total = (fs.tuition || 0) + oneTimeTotal + termlyTotal + yearlyTotal;
        
        option.textContent = `${fs.name} - UGX ${total.toLocaleString()}/term`;
        option.dataset.tuition = fs.tuition || 0;
        option.dataset.oneTimeTotal = oneTimeTotal;
        option.dataset.termlyTotal = termlyTotal;
        option.dataset.yearlyTotal = yearlyTotal;
        option.dataset.fs = JSON.stringify(fs);
        feeSelect.appendChild(option);
        
        console.log('Added option:', fs.name, 'total:', total, 'level:', fs.level);
    });
    
    console.log('Fee select now has', feeSelect.options.length, 'options');
    
    updateFeePreview();
}

function updateFeePreview() {
    console.log('=== updateFeePreview called ===');
    
    const feeSelect = document.getElementById('feeStructureId');
    const bursarySelect = document.getElementById('bursaryId');
    const previewDiv = document.getElementById('feePreview');
    const previewContent = document.getElementById('feePreviewContent');
    
    if (!feeSelect || !feeSelect.value || !previewContent) {
        if (previewDiv) previewDiv.classList.add('hidden');
        return;
    }
    
    const selectedOption = feeSelect.options[feeSelect.selectedIndex];
    const tuition = parseInt(selectedOption.dataset.tuition) || 0;
    const oneTimeTotal = parseInt(selectedOption.dataset.oneTimeTotal) || 0;
    const termlyTotal = parseInt(selectedOption.dataset.termlyTotal) || 0;
    const yearlyTotal = parseInt(selectedOption.dataset.yearlyTotal) || 0;
    
    console.log('Fee selected - Tuition:', tuition, 'OneTime:', oneTimeTotal, 'Termly:', termlyTotal, 'Yearly:', yearlyTotal);
    
    let discountedTuition = tuition;
    let discountAmount = 0;
    let discountText = 'None';
    let appliedBursaryName = '';
    
    if (bursarySelect && bursarySelect.value) {
        const selectedBursary = window.feeBursariesDataGlobal?.find(b => b.id === bursarySelect.value);
        if (selectedBursary) {
            appliedBursaryName = selectedBursary.name;
            if (selectedBursary.type === 'percentage') {
                discountAmount = (tuition * selectedBursary.value) / 100;
                discountText = `${selectedBursary.value}% off`;
            } else {
                discountAmount = selectedBursary.value;
                discountText = `UGX ${selectedBursary.value.toLocaleString()} off`;
            }
            discountedTuition = Math.max(0, tuition - discountAmount);
        }
    }
    
    const totalPayable = discountedTuition + oneTimeTotal + termlyTotal + yearlyTotal;
    const { currentTerm } = currentAcademicSettings;
    const isFirstTerm = currentTerm === 1;
    
    // Build the preview HTML
    let oneTimeHtml = '';
    if (oneTimeTotal > 0) {
        oneTimeHtml = `
            <div class="bg-purple-100 rounded-lg p-3 text-center">
                <p class="text-sm font-semibold text-purple-700">⭐ One-Time Fees</p>
                <p class="text-xl font-bold text-purple-600">UGX ${oneTimeTotal.toLocaleString()}</p>
                <p class="text-xs text-gray-500">${isFirstTerm ? 'Charged this term' : 'Not charged this term'}</p>
            </div>
        `;
    }
    
    let termlyHtml = '';
    if (termlyTotal > 0) {
        termlyHtml = `
            <div class="bg-green-100 rounded-lg p-3 text-center">
                <p class="text-sm font-semibold text-green-700">📅 Termly Fees</p>
                <p class="text-xl font-bold text-green-600">UGX ${termlyTotal.toLocaleString()}</p>
                <p class="text-xs text-gray-500">Per Term</p>
            </div>
        `;
    }
    
    let yearlyHtml = '';
    if (yearlyTotal > 0) {
        yearlyHtml = `
            <div class="bg-orange-100 rounded-lg p-3 text-center">
                <p class="text-sm font-semibold text-orange-700">📆 Yearly Fees</p>
                <p class="text-xl font-bold text-orange-600">UGX ${yearlyTotal.toLocaleString()}</p>
                <p class="text-xs text-gray-500">${isFirstTerm ? 'Charged this term' : 'Not charged this term'}</p>
            </div>
        `;
    }
    
    previewContent.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <div class="bg-blue-100 rounded-lg p-3 text-center">
                <p class="text-sm font-semibold text-blue-700">💰 Tuition Fee</p>
                <p class="text-xl font-bold text-blue-600">UGX ${tuition.toLocaleString()}</p>
                ${discountAmount > 0 ? `
                    <p class="text-xs text-green-600">After ${discountText}: UGX ${discountedTuition.toLocaleString()}</p>
                ` : ''}
                <p class="text-xs text-gray-500">Per Term</p>
            </div>
            ${oneTimeHtml}
            ${termlyHtml}
            ${yearlyHtml}
        </div>
        <div class="bg-gradient-to-r from-purple-100 to-pink-100 rounded-lg p-3">
            <div class="flex justify-between items-center">
                <span class="font-bold text-lg">TOTAL PAYABLE ${isFirstTerm ? 'THIS TERM' : 'PER TERM'}:</span>
                <span class="font-bold text-xl text-purple-700">UGX ${totalPayable.toLocaleString()}</span>
            </div>
            <p class="text-xs text-gray-600 mt-1 text-center">
                <i class="fas fa-info-circle"></i> 
                ${isFirstTerm ? 'First term includes One-time and Yearly fees' : 'Only Tuition and Termly fees are charged this term'}
            </p>
            <p class="text-xs text-gray-500 mt-1 text-center">* Bursaries apply to Tuition fee only</p>
        </div>
    `;
    
    if (previewDiv) previewDiv.classList.remove('hidden');
    console.log('Fee preview updated successfully');
}

// Also add a debug function to check what fee structures are loaded
function debugFeeStructures() {
    console.log('=== DEBUG FEE STRUCTURES ===');
    console.log('window.feeStructuresDataGlobal:', window.feeStructuresDataGlobal);
    if (window.feeStructuresDataGlobal) {
        window.feeStructuresDataGlobal.forEach(fs => {
            console.log('Fee structure:', fs.name, 'Level:', fs.level, 'Active:', fs.isActive);
        });
    }
    console.log('window.classesDataGlobal:', window.classesDataGlobal);
    if (window.classesDataGlobal) {
        window.classesDataGlobal.forEach(c => {
            console.log('Class:', c.name, 'Level:', c.level);
        });
    }
}

// Call debug when registration page loads
// Add this line inside showStudentRegistration after setting window.feeStructuresDataGlobal
// debugFeeStructures();

function updateFeePreview() {
    const feeSelect = document.getElementById('feeStructureId');
    const bursarySelect = document.getElementById('bursaryId');
    const previewDiv = document.getElementById('feePreview');
    const previewContent = document.getElementById('feePreviewContent');
    
    if (!feeSelect || !feeSelect.value || !previewContent) {
        if (previewDiv) previewDiv.classList.add('hidden');
        return;
    }
    
    const selectedOption = feeSelect.options[feeSelect.selectedIndex];
    const tuition = parseInt(selectedOption.dataset.tuition) || 0;
    const oneTimeTotal = parseInt(selectedOption.dataset.oneTimeTotal) || 0;
    const termlyTotal = parseInt(selectedOption.dataset.termlyTotal) || 0;
    const yearlyTotal = parseInt(selectedOption.dataset.yearlyTotal) || 0;
    
    let discountedTuition = tuition;
    let discountAmount = 0;
    let discountText = 'None';
    let appliedBursaryName = '';
    
    if (bursarySelect && bursarySelect.value) {
        const selectedBursary = window.feeBursariesDataGlobal?.find(b => b.id === bursarySelect.value);
        if (selectedBursary) {
            appliedBursaryName = selectedBursary.name;
            if (selectedBursary.type === 'percentage') {
                discountAmount = (tuition * selectedBursary.value) / 100;
                discountText = `${selectedBursary.value}% off`;
            } else {
                discountAmount = selectedBursary.value;
                discountText = `UGX ${selectedBursary.value.toLocaleString()} off`;
            }
            discountedTuition = Math.max(0, tuition - discountAmount);
        }
    }
    
    const totalPayable = discountedTuition + oneTimeTotal + termlyTotal + yearlyTotal;
    const { currentTerm } = currentAcademicSettings;
    const isFirstTerm = currentTerm === 1;
    
    previewContent.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div class="bg-blue-100 rounded-lg p-3 text-center">
                <p class="text-sm font-semibold text-blue-700">💰 Tuition Fee</p>
                <p class="text-xl font-bold text-blue-600">UGX ${tuition.toLocaleString()}</p>
                ${discountAmount > 0 ? `
                    <p class="text-xs text-green-600">After ${discountText}: UGX ${discountedTuition.toLocaleString()}</p>
                ` : ''}
                <p class="text-xs text-gray-500">Per Term</p>
            </div>
            <div class="bg-purple-100 rounded-lg p-3 text-center">
                <p class="text-sm font-semibold text-purple-700">⭐ One-Time Fees</p>
                <p class="text-xl font-bold text-purple-600">UGX ${oneTimeTotal.toLocaleString()}</p>
                <p class="text-xs text-gray-500">${isFirstTerm ? 'Charged this term' : 'Not charged this term'}</p>
            </div>
            <div class="bg-green-100 rounded-lg p-3 text-center">
                <p class="text-sm font-semibold text-green-700">📅 Termly Fees</p>
                <p class="text-xl font-bold text-green-600">UGX ${termlyTotal.toLocaleString()}</p>
                <p class="text-xs text-gray-500">Per Term</p>
            </div>
            <div class="bg-orange-100 rounded-lg p-3 text-center">
                <p class="text-sm font-semibold text-orange-700">📆 Yearly Fees</p>
                <p class="text-xl font-bold text-orange-600">UGX ${yearlyTotal.toLocaleString()}</p>
                <p class="text-xs text-gray-500">${isFirstTerm ? 'Charged this term' : 'Not charged this term'}</p>
            </div>
        </div>
        <div class="bg-gradient-to-r from-purple-100 to-pink-100 rounded-lg p-3 mt-3">
            <div class="flex justify-between items-center">
                <span class="font-bold text-lg">TOTAL PAYABLE ${isFirstTerm ? 'THIS TERM' : 'PER TERM'}:</span>
                <span class="font-bold text-xl text-purple-700">UGX ${totalPayable.toLocaleString()}</span>
            </div>
            <p class="text-xs text-gray-600 mt-1 text-center">
                <i class="fas fa-info-circle"></i> 
                ${isFirstTerm ? 'First term includes One-time and Yearly fees' : 'Only Tuition and Termly fees are charged this term'}
            </p>
            <p class="text-xs text-gray-500 mt-1 text-center">* Bursaries apply to Tuition fee only</p>
        </div>
    `;
    
    if (previewDiv) previewDiv.classList.remove('hidden');
}

// ==================== RESET REGISTRATION FORM ====================

function resetRegistrationForm() {
    // Reset personal info
    document.getElementById('firstName').value = '';
    document.getElementById('lastName').value = '';
    document.getElementById('dob').value = '';
    document.getElementById('gender').value = '';
    document.getElementById('birthPlace').value = '';
    document.getElementById('nationality').value = 'Ugandan';
    
    // Reset parent info
    document.getElementById('parentName').value = '';
    document.getElementById('relationship').value = 'Parent';
    document.getElementById('parentPhone').value = '';
    document.getElementById('parentAltPhone').value = '';
    document.getElementById('parentEmail').value = '';
    document.getElementById('parentOccupation').value = '';
    document.getElementById('address').value = '';
    
    // Reset academic info
    document.getElementById('classId').value = '';
    document.getElementById('previousSchool').value = '';
    document.getElementById('admissionType').value = 'New';
    document.getElementById('enrollmentDate').value = new Date().toISOString().split('T')[0];
    
    // Reset fee structure
    document.getElementById('feeStructureId').innerHTML = '<option value="">Select Fee Structure</option>';
    document.getElementById('bursaryId').value = '';
    
    // Reset photo
    removeStudentPhoto();
    
    // Hide fee preview
    const feePreview = document.getElementById('feePreview');
    if (feePreview) feePreview.classList.add('hidden');
    
    showToast('Form has been reset', 'info');
}

// ==================== HANDLE STUDENT REGISTRATION ====================

// ==================== COMPLETE WORKING STUDENT REGISTRATION WITH FEE ASSIGNMENT ====================

async function handleStudentRegistration(e) {
    e.preventDefault();
    
    // Get form values - FIXED: removed duplicate 'document'
    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const dateOfBirth = document.getElementById('dob').value;
    const gender = document.getElementById('gender').value;
    const birthPlace = document.getElementById('birthPlace').value;
    const nationality = document.getElementById('nationality').value;
    
    const parentName = document.getElementById('parentName').value.trim();
    const relationship = document.getElementById('relationship').value;
    const parentPhone = document.getElementById('parentPhone').value.trim();
    const parentAltPhone = document.getElementById('parentAltPhone').value;
    const parentEmail = document.getElementById('parentEmail').value;
    const parentOccupation = document.getElementById('parentOccupation').value;
    const address = document.getElementById('address').value.trim();
    
    const bloodGroup = document.getElementById('bloodGroup').value;
    const allergies = document.getElementById('allergies').value;
    const medicalConditions = document.getElementById('medicalConditions').value;
    const emergencyContact = document.getElementById('emergencyContact').value;
    
    const enrollmentClass = document.getElementById('classId').value;
    const previousSchool = document.getElementById('previousSchool').value;
    const admissionType = document.getElementById('admissionType').value;
    const enrollmentDate = document.getElementById('enrollmentDate').value;
    
    const feeStructureId = document.getElementById('feeStructureId').value;
    const bursaryId = document.getElementById('bursaryId').value || null;
    
    // Validation
    if (!firstName || !lastName || !gender || !parentName || !parentPhone || !address || !enrollmentClass || !feeStructureId) {
        alert('⚠️ Please fill in all required fields marked with *');
        return;
    }
    
    // Phone validation
    const phoneRegex = /^[0-9]{10,13}$/;
    if (!phoneRegex.test(parentPhone.replace(/[^0-9]/g, ''))) {
        alert('⚠️ Please enter a valid phone number');
        return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registering...';
    submitBtn.disabled = true;
    
    try {
        // Register the student
        const studentData = {
            firstName,
            lastName,
            dateOfBirth,
            gender,
            birthPlace,
            nationality,
            parentName,
            relationship,
            parentPhone,
            parentAltPhone,
            parentEmail,
            parentOccupation,
            address,
            bloodGroup,
            allergies,
            medicalConditions,
            emergencyContact,
            enrollmentClass,
            previousSchool,
            admissionType,
            enrollmentDate,
            feeStructureId,
            bursaryId,
            studentPhoto: studentPhotoBase64 || null,
            academicYear: currentAcademicSettings?.currentYear || new Date().getFullYear()
        };
        
        const response = await fetch('/api/students/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(studentData)
        });
        
        if (response.ok) {
            const result = await response.json();
            const newStudentId = result.student.id;
            
            // Save fee assignment separately
            await fetch('/api/student-fee-assignments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId: newStudentId,
                    feeStructureId: feeStructureId,
                    bursaryId: bursaryId
                })
            });
            
            alert(`✅ Student ${firstName} ${lastName} registered successfully!\nAdmission Number: ${result.student.admissionNumber}`);
            
            // Reset form
            resetRegistrationForm();
            
            // Ask if user wants to view student list
            if (confirm('Do you want to view the student list?')) {
                showStudentList();
            } else if (confirm('Do you want to register another student?')) {
                showStudentRegistration();
            }
        } else {
            const error = await response.json();
            alert('❌ Error registering student: ' + (error.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Network error: ' + error.message);
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

// ==================== SIMPLE WORKING FEE COLLECTION FORM ====================


function calculateSimpleTotal() {
    const tuition = parseInt(document.getElementById('tuitionAmount')?.value) || 0;
    
    const summaryTuition = document.getElementById('summaryTuition');
    const summaryTotal = document.getElementById('summaryTotal');
    const outstandingSpan = document.getElementById('outstandingAfter');
    
    if (summaryTuition) summaryTuition.innerHTML = `UGX ${tuition.toLocaleString()}`;
    if (summaryTotal) summaryTotal.innerHTML = `UGX ${tuition.toLocaleString()}`;
    
    const expected = window.currentExpectedTuition || 0;
    const currentPaid = window.currentTotalPaid || 0;
    const totalAfterPayment = currentPaid + tuition;
    const balanceAfter = expected - totalAfterPayment;
    
    if (outstandingSpan) {
        if (balanceAfter > 0) {
            outstandingSpan.innerHTML = `UGX ${balanceAfter.toLocaleString()}`;
            outstandingSpan.className = 'font-bold text-xl text-red-600';
        } else if (balanceAfter < 0) {
            outstandingSpan.innerHTML = `Credit: UGX ${Math.abs(balanceAfter).toLocaleString()}`;
            outstandingSpan.className = 'font-bold text-xl text-blue-600';
        } else {
            outstandingSpan.innerHTML = 'Fully Paid';
            outstandingSpan.className = 'font-bold text-xl text-green-600';
        }
    }
}

function setFullTuitionAmountSimple() {
    const checkbox = document.getElementById('fullTuitionCheck');
    const tuitionInput = document.getElementById('tuitionAmount');
    if (checkbox?.checked && tuitionInput) {
        tuitionInput.value = tuitionInput.max;
        calculateSimpleTotal();
    } else if (tuitionInput) {
        tuitionInput.value = 0;
        calculateSimpleTotal();
    }
}

function resetSimpleCollectionForm() {
    const tuitionInput = document.getElementById('tuitionAmount');
    if (tuitionInput) tuitionInput.value = '0';
    
    const fullTuitionCheck = document.getElementById('fullTuitionCheck');
    if (fullTuitionCheck) fullTuitionCheck.checked = false;
    
    const paymentReference = document.getElementById('paymentReference');
    const paymentNotes = document.getElementById('paymentNotes');
    if (paymentReference) paymentReference.value = '';
    if (paymentNotes) paymentNotes.value = '';
    
    calculateSimpleTotal();
}

async function submitSimpleFeeCollection(student, feeStructure, currentYear, currentTerm) {
    const tuitionPaid = parseInt(document.getElementById('tuitionAmount')?.value) || 0;
    const method = document.getElementById('paymentMethodSelect')?.value || 'cash';
    const reference = document.getElementById('paymentReference')?.value || '';
    const notes = document.getElementById('paymentNotes')?.value || '';
    
    if (tuitionPaid <= 0) {
        alert('Please enter an amount to pay');
        return;
    }
    
    const submitBtn = document.querySelector('#collectionForm button[type="submit"]');
    const originalText = submitBtn.innerText;
    submitBtn.innerText = 'Processing...';
    submitBtn.disabled = true;
    
    try {
        const response = await fetch('/api/fee/payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                studentId: student.id,
                studentName: `${student.firstName} ${student.lastName}`,
                admissionNumber: student.admissionNumber,
                term: currentTerm,
                academicYear: currentYear.toString(),
                feeStructureId: feeStructure.id,
                feeStructureName: feeStructure.name,
                amount: tuitionPaid,
                method: method,
                reference: reference,
                notes: notes
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            const newBalance = (window.currentExpectedTuition || 0) - (window.currentTotalPaid + tuitionPaid);
            
            if (newBalance <= 0) {
                alert(`✅ Payment recorded!\nReceipt: ${result.receiptNumber}\nAmount: UGX ${tuitionPaid.toLocaleString()}\n\n🎉 Student is now FULLY PAID!`);
            } else {
                alert(`✅ Payment recorded!\nReceipt: ${result.receiptNumber}\nAmount: UGX ${tuitionPaid.toLocaleString()}\nRemaining balance: UGX ${newBalance.toLocaleString()}`);
            }
            showFeeManagement();
        } else {
            const error = await response.json();
            alert('❌ Error: ' + (error.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Payment error:', error);
        alert('Network error: ' + error.message);
    } finally {
        submitBtn.innerText = originalText;
        submitBtn.disabled = false;
    }
}

// Make functions global
window.calculateSimpleTotal = calculateSimpleTotal;
window.setFullTuitionAmountSimple = setFullTuitionAmountSimple;
window.resetSimpleCollectionForm = resetSimpleCollectionForm;
// ==================== TOAST NOTIFICATION ====================

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
    toast.className = `fixed bottom-4 right-4 ${bgColor} text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-bounce`;
    toast.innerHTML = `
        <div class="flex items-center gap-3">
            <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Make functions global
window.showStudentRegistration = showStudentRegistration;
window.updateFeeStructuresByClass = updateFeeStructuresByClass;
window.updateFeePreview = updateFeePreview;
window.resetRegistrationForm = resetRegistrationForm;
window.previewStudentPhoto = previewStudentPhoto;
window.removeStudentPhoto = removeStudentPhoto;
window.showToast = showToast;


// ==================== FEE STRUCTURE FUNCTIONS ====================
function updateFeeStructuresByClass() {
    console.log('=== updateFeeStructuresByClass called ===');
    
    const classSelect = document.getElementById('classId');
    const selectedOption = classSelect.options[classSelect.selectedIndex];
    const level = selectedOption?.dataset?.level;
    
    console.log('Selected class:', classSelect.value);
    console.log('Selected class name:', selectedOption?.text);
    console.log('Extracted level:', level);
    
    const feeSelect = document.getElementById('feeStructureId');
    
    if (!level || !window.feeStructuresDataGlobal) {
        console.log('No level or feeStructuresDataGlobal missing. level:', level, 'feeStructuresDataGlobal:', window.feeStructuresDataGlobal);
        if (feeSelect) {
            feeSelect.innerHTML = '<option value="">Select Fee Structure</option>';
        }
        const feePreview = document.getElementById('feePreview');
        if (feePreview) feePreview.classList.add('hidden');
        return;
    }
    
    console.log('All fee structures:', window.feeStructuresDataGlobal);
    
    const availableStructures = window.feeStructuresDataGlobal.filter(f => f.level === level && f.isActive !== false);
    
    console.log('Filtered available structures for level', level, ':', availableStructures);
    
    if (!feeSelect) return;
    
    if (availableStructures.length === 0) {
        console.log('No fee structures found for level:', level);
        feeSelect.innerHTML = '<option value="">No fee structures available for this level</option>';
        const feePreview = document.getElementById('feePreview');
        if (feePreview) feePreview.classList.add('hidden');
        return;
    }
    
    feeSelect.innerHTML = '<option value="">Select Fee Structure</option>';
    availableStructures.forEach(fs => {
        const option = document.createElement('option');
        option.value = fs.id;
        // Calculate totals for display
        const oneTimeTotal = (fs.oneTimeActivities || []).reduce((sum, c) => sum + (c.totalAmount || 0), 0);
        const termlyTotal = (fs.termlyActivities || []).reduce((sum, c) => sum + (c.totalAmount || 0), 0);
        const yearlyTotal = (fs.yearlyActivities || []).reduce((sum, c) => sum + (c.totalAmount || 0), 0);
        const total = (fs.tuition || 0) + oneTimeTotal + termlyTotal + yearlyTotal;
        
        option.textContent = `${fs.name} - UGX ${total.toLocaleString()}/term`;
        option.dataset.tuition = fs.tuition || 0;
        option.dataset.oneTimeTotal = oneTimeTotal;
        option.dataset.termlyTotal = termlyTotal;
        option.dataset.yearlyTotal = yearlyTotal;
        option.dataset.fs = JSON.stringify(fs);
        feeSelect.appendChild(option);
        
        console.log('Added option:', fs.name, 'total:', total);
    });
    
    console.log('Fee select now has', feeSelect.options.length, 'options');
    
    updateFeePreview();
}

function updateFeePreview() {
    const selectedFeeRadio = document.querySelector('input[name="feeStructure"]:checked');
    const selectedBursaryId = document.getElementById('bursarySelect') ? document.getElementById('bursarySelect').value : null;
    const registrationPaidRadio = document.querySelector('input[name="registrationPaid"]:checked');
    const registrationPaid = registrationPaidRadio ? registrationPaidRadio.value === 'paid' : false;
    
    if (!selectedFeeRadio) return;
    
    const selectedFee = window.feeStructuresDataGlobal.find(f => f.id === selectedFeeRadio.value);
    const bursary = selectedBursaryId ? window.feeBursariesDataGlobal.find(b => b.id === selectedBursaryId) : null;
    
    let discountedAmount = selectedFee ? selectedFee.total : 0;
    let bursaryText = 'None';
    
    if (bursary) {
        bursaryText = `${bursary.name} (${bursary.type === 'percentage' ? `${bursary.value}% off` : `UGX ${bursary.value.toLocaleString()} off`})`;
        if (bursary.type === 'percentage') discountedAmount = discountedAmount - (discountedAmount * bursary.value / 100);
        else discountedAmount = discountedAmount - bursary.value;
    }
    
    const previewFeeName = document.getElementById('previewFeeName');
    const previewFeeAmount = document.getElementById('previewFeeAmount');
    const previewBursary = document.getElementById('previewBursary');
    const previewDiscounted = document.getElementById('previewDiscounted');
    const previewRegStatus = document.getElementById('previewRegStatus');
    
    if (previewFeeName) previewFeeName.innerText = selectedFee ? selectedFee.name : '-';
    if (previewFeeAmount) previewFeeAmount.innerHTML = `UGX ${(selectedFee ? selectedFee.total : 0).toLocaleString()}/term`;
    if (previewBursary) previewBursary.innerHTML = bursaryText;
    if (previewDiscounted) previewDiscounted.innerHTML = `UGX ${discountedAmount.toLocaleString()}/term`;
    if (previewRegStatus) previewRegStatus.innerHTML = registrationPaid ? '✅ Paid' : '⏳ Pending';
}

window.updateFeeStructuresByClass = updateFeeStructuresByClass;
window.updateFeePreview = updateFeePreview;
window.showStudentRegistration = showStudentRegistration;

// ==================== COMPLETE ALL STUDENTS PAGE ====================


// ==================== NEW RENDER FUNCTION FOR CURRENT TERM ONLY ====================
function renderCurrentTermStudentRow(student) {
    const initials = `${student.firstName?.charAt(0) || ''}${student.lastName?.charAt(0) || ''}`.toUpperCase();
    const avatarColors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500'];
    const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];
    
    const feeStructureName = student.feeStructure?.name || 'Not Assigned';
    const bursaryText = student.appliedBursary ? `<br><span class="text-xs text-green-600">🎖️ ${student.appliedBursary.name} (${student.appliedBursary.value}% off)</span>` : '';
    
    const expected = student.expectedPerTerm || 0;
    const paid = student.currentTermPaid || 0;
    const balance = student.currentTermBalance || (expected - paid);
    
    let statusText = 'Good Standing';
    let statusColor = 'bg-green-100 text-green-800';
    if (balance > expected) {
        statusText = 'Critical Overdue';
        statusColor = 'bg-red-100 text-red-800';
    } else if (balance > 0) {
        statusText = 'Partial Payment';
        statusColor = 'bg-yellow-100 text-yellow-800';
    } else if (balance < 0) {
        statusText = 'Overpaid';
        statusColor = 'bg-blue-100 text-blue-800';
    }
    
    return `
        <tr class="border-b hover:bg-gray-50 ${balance > expected ? 'bg-red-50' : ''}">
            <td class="p-3 font-mono text-sm">${student.admissionNumber}</td>
            <td class="p-3">
                <div class="flex items-center space-x-2">
                    <div class="w-8 h-8 ${avatarColor} rounded-full flex items-center justify-center text-white text-sm font-bold">${initials}</div>
                    <div>
                        <p class="font-medium">${student.firstName} ${student.lastName}</p>
                        <p class="text-xs text-gray-500">${student.enrolledAt ? new Date(student.enrolledAt).toLocaleDateString() : 'N/A'}</p>
                    </div>
                </div>
            </td>
            <td class="p-3"><span class="px-2 py-1 rounded-full text-xs bg-purple-100 text-purple-800">${student.currentClass || 'Not Assigned'}</span></td>
            <td class="p-3 text-sm">${feeStructureName}${bursaryText}</td>
            <td class="p-3 text-right font-semibold">UGX ${expected.toLocaleString()}</td>
            <td class="p-3 text-right">UGX ${paid.toLocaleString()}</td>
            <td class="p-3 text-right font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'}">UGX ${Math.abs(balance).toLocaleString()} ${balance > 0 ? '(Due)' : '(Overpaid)'}</td>
            <td class="p-3"><span class="px-2 py-1 rounded-full text-xs ${statusColor}">${statusText}</span></td>
            <td class="p-3">
                <div class="flex space-x-2">
                    <button onclick="viewStudentDetails('${student.id}')" class="text-blue-600 hover:text-blue-800" title="View Details"><i class="fas fa-eye"></i></button>
                    <button onclick="viewStudentFeeDetails('${student.id}')" class="text-purple-600 hover:text-purple-800" title="Fee Details"><i class="fas fa-money-bill-wave"></i></button>
                    <button onclick="makePaymentForStudent('${student.id}')" class="text-green-600 hover:text-green-800" title="Make Payment"><i class="fas fa-receipt"></i></button>
                </div>
            </td>
        <tr>
    `;
}

function renderStudentRow(student) {
    const initials = `${student.firstName?.charAt(0) || ''}${student.lastName?.charAt(0) || ''}`.toUpperCase();
    const avatarColors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500'];
    const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];
    
    const feeStructureName = student.feeStructure?.name || 'Not Assigned';
    
    // Format bursary display correctly
    let bursaryText = '';
    if (student.appliedBursary) {
        if (student.appliedBursary.type === 'percentage') {
            bursaryText = `<br><span class="text-xs text-green-600">🎖️ ${student.appliedBursary.name} (${student.appliedBursary.value}% off)</span>`;
        } else {
            bursaryText = `<br><span class="text-xs text-green-600">🎖️ ${student.appliedBursary.name} (UGX ${student.appliedBursary.value.toLocaleString()} off)</span>`;
        }
    }
    
    // Calculate totals safely - using the separated fields from enhancedStudents
    const expectedTuition = student.expectedTuition || 0;
    const expectedActivity = student.expectedActivityTotal || 0;
    const expectedDevelopment = student.expectedDevelopmentTotal || 0;
    const totalExpected = expectedTuition + expectedActivity + expectedDevelopment;
    
    const tuitionPaid = student.tuitionPaid || 0;
    const activityPaid = student.activityPaid || 0;
    const developmentPaid = student.developmentPaid || 0;
    const totalPaid = tuitionPaid + activityPaid + developmentPaid;
    
    const totalBalance = student.totalBalance || (totalExpected - totalPaid);
    
    let displayBalance = '';
    let balanceClass = '';
    if (totalBalance < 0) {
        displayBalance = `(Credit: UGX ${Math.abs(totalBalance).toLocaleString()})`;
        balanceClass = 'text-blue-600';
    } else if (totalBalance > 0) {
        displayBalance = `UGX ${totalBalance.toLocaleString()} (Due)`;
        balanceClass = 'text-red-600';
    } else {
        displayBalance = 'UGX 0 (Paid)';
        balanceClass = 'text-green-600';
    }
    
    // Get status safely
    const status = student.status || 'Partial Payment';
    const statusColor = student.statusColor || 'bg-yellow-100 text-yellow-800';
    
    return `
        <tr class="border-b hover:bg-gray-50 ${totalBalance < 0 ? 'bg-blue-50' : totalBalance > totalExpected ? 'bg-red-50' : ''}">
            <td class="p-3 font-mono text-sm">${student.admissionNumber || 'N/A'}</td>
            <td class="p-3">
                <div class="flex items-center space-x-2">
                    <div class="w-8 h-8 ${avatarColor} rounded-full flex items-center justify-center text-white text-sm font-bold">${initials}</div>
                    <div>
                        <p class="font-medium">${student.firstName || ''} ${student.lastName || ''}</p>
                        <p class="text-xs text-gray-500">${student.enrolledAt ? new Date(student.enrolledAt).toLocaleDateString() : 'N/A'}</p>
                    </div>
                </div>
            </td>
            <td class="p-3"><span class="px-2 py-1 rounded-full text-xs bg-purple-100 text-purple-800">${student.currentClass || 'Not Assigned'}</span></td>
            <td class="p-3 text-sm">${feeStructureName}${bursaryText}</td>
            <td class="p-3 text-right font-semibold">UGX ${isNaN(totalExpected) ? 0 : totalExpected.toLocaleString()}</td>
            <td class="p-3 text-right ${totalPaid > 0 ? 'text-green-600 font-semibold' : 'text-gray-500'}">UGX ${isNaN(totalPaid) ? 0 : totalPaid.toLocaleString()}</td>
            <td class="p-3 text-right font-bold ${balanceClass}">${displayBalance}</td>
            <td class="p-3"><span class="px-2 py-1 rounded-full text-xs ${statusColor}">${status}</span></td>
            <td class="p-3">
                <div class="flex space-x-2">
                    <button onclick="viewStudentDetails('${student.id}')" class="text-blue-600 hover:text-blue-800" title="View Details"><i class="fas fa-eye"></i></button>
                    <button onclick="viewStudentFeeDetails('${student.id}')" class="text-purple-600 hover:text-purple-800" title="Fee Details"><i class="fas fa-money-bill-wave"></i></button>
                    <button onclick="makePaymentForStudent('${student.id}')" class="text-green-600 hover:text-green-800" title="Make Payment"><i class="fas fa-receipt"></i></button>
                </div>
            </td>
        </tr>
    `;
}
function renderStudentListWithFee(students, classes, feeStructures) {
    const totalStudents = students.length;
    const maleCount = students.filter(s => s.gender === 'Male').length;
    const femaleCount = students.filter(s => s.gender === 'Female').length;
    const activeCount = students.filter(s => s.status === 'Active').length;
    const criticalOverdue = students.filter(s => s.overdueStatus === 'Critical').length;
    const warningOverdue = students.filter(s => s.overdueStatus === 'Warning').length;
    const totalOutstanding = students.reduce((sum, s) => sum + (s.balance > 0 ? s.balance : 0), 0);
    
    const html = `
        <div class="space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl p-4 text-white">
                    <div class="flex items-center justify-between">
                        <div><p class="text-sm opacity-90">Total Students</p><p class="text-2xl font-bold">${totalStudents}</p></div>
                        <i class="fas fa-users text-3xl opacity-50"></i>
                    </div>
                </div>
                <div class="bg-gradient-to-r from-green-500 to-green-600 rounded-xl p-4 text-white">
                    <div class="flex items-center justify-between">
                        <div><p class="text-sm opacity-90">Active Students</p><p class="text-2xl font-bold">${activeCount}</p></div>
                        <i class="fas fa-user-check text-3xl opacity-50"></i>
                    </div>
                </div>
                <div class="bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl p-4 text-white">
                    <div class="flex items-center justify-between">
                        <div><p class="text-sm opacity-90">Outstanding Balance</p><p class="text-2xl font-bold">UGX ${totalOutstanding.toLocaleString()}</p></div>
                        <i class="fas fa-exclamation-triangle text-3xl opacity-50"></i>
                    </div>
                </div>
                <div class="bg-gradient-to-r from-red-500 to-red-600 rounded-xl p-4 text-white">
                    <div class="flex items-center justify-between">
                        <div><p class="text-sm opacity-90">Overdue Students</p><p class="text-2xl font-bold">${criticalOverdue + warningOverdue}</p></div>
                        <i class="fas fa-bell text-3xl opacity-50"></i>
                    </div>
                </div>
            </div>
            
            <div class="bg-white rounded-xl shadow-sm p-4">
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div class="relative"><i class="fas fa-search absolute left-3 top-3 text-gray-400"></i><input type="text" id="searchInput" placeholder="Search by name, admission number..." class="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"></div>
                    <div><select id="classFilter" class="w-full border rounded-lg px-3 py-2"><option value="">All Classes</option>${classes.map(c => `<option value="${c.name}">${c.name}</option>`).join('')}</select></div>
                    <div><select id="feeStatusFilter" class="w-full border rounded-lg px-3 py-2"><option value="">All Fee Status</option><option value="paid">Fully Paid</option><option value="partial">Partial Payment</option><option value="overdue">Overdue</option><option value="critical">Critical Overdue</option></select></div>
                    <div><button onclick="showFeeSummaryReport()" class="w-full bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700"><i class="fas fa-chart-line"></i> Fee Summary Report</button></div>
                </div>
                
                <div class="flex justify-between items-center mt-4 pt-4 border-t">
                    <div class="flex items-center space-x-4">
                        <button onclick="toggleSelectAll()" class="text-blue-600 hover:text-blue-800 text-sm"><i class="fas fa-check-square"></i> Select All</button>
                        <button onclick="exportSelectedStudents()" class="text-green-600 hover:text-green-800 text-sm"><i class="fas fa-download"></i> Export Selected</button>
                        <button onclick="sendBulkReminders()" class="text-red-600 hover:text-red-800 text-sm"><i class="fas fa-bell"></i> Send Reminders</button>
                    </div>
                    <div><button onclick="showStudentRegistration()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"><i class="fas fa-plus"></i> Register New Student</button></div>
                </div>
            </div>
            
            <div class="bg-white rounded-xl shadow-sm overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full" id="studentsTable">
                        <thead class="bg-gray-100">
                            <tr><th class="p-3 text-left w-12"><input type="checkbox" id="selectAllCheckbox" onchange="toggleSelectAll()"></th><th class="p-3 text-left">Admission No.</th><th class="p-3 text-left">Student Name</th><th class="p-3 text-left">Class</th><th class="p-3 text-left">Fee Structure</th><th class="p-3 text-right">Expected/term</th><th class="p-3 text-right">Term 1</th><th class="p-3 text-right">Term 2</th><th class="p-3 text-right">Term 3</th><th class="p-3 text-right">Total Paid</th><th class="p-3 text-right">Balance</th><th class="p-3 text-left">Status</th><th class="p-3 text-center">Actions</th></tr>
                        </thead>
                        <tbody id="studentsTableBody">
                            ${students.map(student => renderStudentRowWithFee(student)).join('')}
                        </tbody>
                    </table>
                </div>
                
                <div class="border-t p-4 flex justify-between items-center">
                    <div class="text-sm text-gray-600">Showing <span id="showingStart">1</span> to <span id="showingEnd">${Math.min(10, students.length)}</span> of <span id="totalCount">${students.length}</span> students</div>
                    <div class="flex gap-2" id="paginationControls"><button onclick="previousPage()" class="px-3 py-1 border rounded hover:bg-gray-50">Previous</button><span id="pageInfo" class="px-3 py-1">Page 1</span><button onclick="nextPage()" class="px-3 py-1 border rounded hover:bg-gray-50">Next</button></div>
                </div>
            </div>
            
            ${criticalOverdue > 0 ? `
                <div class="bg-red-50 border-l-4 border-red-500 rounded-lg p-4">
                    <div class="flex items-center"><div class="flex-shrink-0"><i class="fas fa-exclamation-circle text-red-500 text-xl"></i></div><div class="ml-3"><h3 class="text-sm font-medium text-red-800">Critical Overdue Alert</h3><div class="mt-1 text-sm text-red-700"><p>${criticalOverdue} student(s) have outstanding balances exceeding their termly fees. Please follow up immediately.</p></div></div><div class="ml-auto"><button onclick="filterCriticalOverdue()" class="bg-red-600 text-white px-3 py-1 rounded text-sm">View All</button></div></div>
                </div>
            ` : ''}
        </div>
    `;
    
    const mainContent = document.getElementById('mainContent');
    if (mainContent) {
        mainContent.innerHTML = html;
        initializeStudentFilters();
    }
}

function renderStudentRowWithFee(student) {
    const initials = `${student.firstName?.charAt(0) || ''}${student.lastName?.charAt(0) || ''}`.toUpperCase();
    const avatarColors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500'];
    const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];
    
    // Calculate fee data if not already present
    const expectedPerTerm = student.expectedPerTerm || 0;
    const term1Paid = student.term1Paid || 0;
    const term2Paid = student.term2Paid || 0;
    const term3Paid = student.term3Paid || 0;
    const totalPaid = term1Paid + term2Paid + term3Paid;
    const totalExpected = expectedPerTerm * 3;
    const balance = totalExpected - totalPaid;
    
    const term1Status = term1Paid >= expectedPerTerm ? 'Paid' : term1Paid > 0 ? 'Parti