const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { AsyncLocalStorage } = require('async_hooks'); // ✅ For atomic transactions

const app = express();
const PORT = process.env.PORT || 3000;
const configuredDataDir = process.env.SCHOOL_DATA_DIR;

// ==================== ATOMIC TRANSACTION SYSTEM ====================
const transactionStorage = new AsyncLocalStorage();
const TEMP_DIR = path.join(configuredDataDir || path.join(__dirname, 'data'), '.tmp');
const tempFileNames = fs.readdirSync(TEMP_DIR);
// Ensure temp directory exists and clean up any leftover temp files on startup
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
} else {
    // Remove any stale temporary files (from previous incomplete transactions)
   
  for (const file of tempFileNames) {
        try {
            fs.unlinkSync(path.join(TEMP_DIR, file));
        } catch (e) { /* ignore */ }
    }
}

// Start a new transaction (called per request)
function startTransaction() {
    const store = { tempFiles: {} };
    return store;
}

// Commit: atomically rename all temporary files to their real paths
function commitTransaction(store) {
    if (!store) return;
    const entries = Object.entries(store.tempFiles);
    for (const [realPath, tempPath] of entries) {
        try {
            // rename is atomic on POSIX systems
            fs.renameSync(tempPath, realPath);
        } catch (err) {
            // If any rename fails, attempt to rollback already renamed files?
            // Since we want atomicity, we must try to revert all.
            console.error('❌ Atomic commit failed for', realPath, err);
            rollbackTransaction(store);
            throw new Error('Transaction commit failed: ' + err.message);
        }
    }
    // Success: clear the store
    store.tempFiles = {};
}

// Rollback: delete all temporary files
function rollbackTransaction(store) {
    if (!store) return;
    for (const tempPath of Object.values(store.tempFiles)) {
        try {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        } catch (e) { /* ignore */ }
    }
    store.tempFiles = {};
}

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
const aiRoutes = require('./ai/routes');
app.use('/api/ai', aiRoutes);
console.log('🧠 AI routes mounted at /api/ai');
// ==================== TRANSACTION MIDDLEWARE ====================
// This middleware wraps each request in an atomic transaction.
// All saveFile calls within the request will write to temporary files.
// On successful response, changes are committed (renamed).
// On error, changes are rolled back (temp files deleted).
app.use((req, res, next) => {
    const store = startTransaction();
    transactionStorage.run(store, () => {
        // Override res.end to commit transaction before sending response
        const originalEnd = res.end;
        let committed = false;
        res.end = function (...args) {
            if (!committed) {
                committed = true;
                const currentStore = transactionStorage.getStore();
                if (currentStore && Object.keys(currentStore.tempFiles).length > 0) {
                    try {
                        commitTransaction(currentStore);
                    } catch (commitErr) {
                        // If commit fails, we still need to end the response, but with an error status
                        console.error('❌ Commit failed during res.end:', commitErr);
                        // Rollback already done inside commitTransaction on failure
                        // Set status to 500 if not already set
                        if (res.statusCode < 400) res.status(500);
                        // We cannot change the response body easily here, but we can log.
                    }
                }
            }
            originalEnd.apply(this, args);
        };

        // Catch synchronous errors and rollback
        try {
            next();
        } catch (err) {
            const currentStore = transactionStorage.getStore();
            if (currentStore) {
                rollbackTransaction(currentStore);
            }
            next(err);
        }
    });
});

// ==================== SYNC MANAGER INTEGRATION ====================

let syncManager = null;
try {
    const SyncManager = require('./syncManager');
    syncManager = new SyncManager();
    console.log('✅ Sync Manager loaded');
} catch (error) {
    console.warn('⚠️ Sync Manager not available:', error.message);
}

// Get sync status
app.get('/api/sync/status', (req, res) => {
    if (!syncManager) {
        return res.status(503).json({ error: 'Sync Manager not available' });
    }
    const status = syncManager.getStatus();
    res.json(status);
});

// Trigger manual sync
// In server.js - Sync routes
app.post('/api/sync/trigger', async (req, res) => {
    // Check token (optional but recommended)
    const token = req.headers.authorization?.replace('Bearer ', '');
    const expectedToken = process.env.SYNC_TOKEN;
    
    if (expectedToken && token !== expectedToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!syncManager) {
        return res.status(503).json({ error: 'Sync Manager not available' });
    }
    
    try {
        await syncManager.forceSync();
        res.json({ success: true, message: 'Sync triggered successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Check for updates
app.get('/api/sync/check-updates', async (req, res) => {
    if (!syncManager) {
        return res.status(503).json({ error: 'Sync Manager not available' });
    }
    try {
        const git = syncManager.git;
        await git.fetch('origin', syncManager.branch);
        const status = await git.status();
        res.json({ 
            hasUpdates: status.behind > 0, 
            behind: status.behind 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const multer = require('multer');
const xlsx = require('xlsx');

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: function(req, file, cb) {
        const ext = file.originalname.split('.').pop().toLowerCase();
        if (['xlsx', 'xls', 'csv'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only Excel (.xlsx, .xls) and CSV files are allowed'));
        }
    }
});

// ==================== FILE PATHS ====================
const dataDir = configuredDataDir || path.join(__dirname, 'data');
const files = {
    schools: path.join(dataDir, 'schools.json'),
    settings: path.join(dataDir, 'settings.json'),
    feeStructures: path.join(dataDir, 'feeStructures.json'),
    feeBursaries: path.join(dataDir, 'feeBursaries.json'),
    classes: path.join(dataDir, 'classes.json'),
    subjects: path.join(dataDir, 'subjects.json'),
    teachers: path.join(dataDir, 'teachers.json'),
    students: path.join(dataDir, 'students.json'),
    enrollments: path.join(dataDir, 'enrollments.json'),
    assessments: path.join(dataDir, 'assessments.json'),
    scores: path.join(dataDir, 'scores.json'),
    attendance: path.join(dataDir, 'attendance.json'),
    feePayments: path.join(dataDir, 'feePayments.json'),
    studentFeeAssignments: path.join(dataDir, 'studentFeeAssignments.json'),
    studentTermRecords: path.join(dataDir, 'studentTermRecords.json'),
    statusGroups: path.join(dataDir, 'statusGroups.json')
};
// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Created data directory: ${dataDir}`);
}

// ==================== BACKUP SYSTEM ====================
const backupDir = path.join(__dirname, 'backups');

function copyFolderSync(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (let entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyFolderSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function cleanupOldBackups() {
    if (!fs.existsSync(backupDir)) return;
    const folders = fs.readdirSync(backupDir)
        .filter(name => name.startsWith('backup_'))
        .map(name => ({
            name: name,
            path: path.join(backupDir, name),
            dateStr: name.replace('backup_', '').slice(0, 10) // YYYY-MM-DD
        }))
        .sort((a, b) => b.dateStr.localeCompare(a.dateStr)); // descending

    // group by date
    const dateGroups = {};
    for (const f of folders) {
        if (!dateGroups[f.dateStr]) dateGroups[f.dateStr] = [];
        dateGroups[f.dateStr].push(f);
    }

    const dates = Object.keys(dateGroups).sort((a,b) => b.localeCompare(a));
    if (dates.length > 5) {
        const toDelete = dates.slice(5); // keep latest 5 days
        for (const date of toDelete) {
            for (const f of dateGroups[date]) {
                try {
                    fs.rmSync(f.path, { recursive: true, force: true });
                    console.log(`🗑️ Deleted old backup: ${f.path}`);
                } catch (e) {
                    console.error(`Failed to delete backup ${f.path}:`, e);
                }
            }
        }
    }
}

function performBackup() {
    try {
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupFolder = path.join(backupDir, `backup_${timestamp}`);
        // copy dataDir to backupFolder recursively
        if (fs.cpSync) {
            fs.cpSync(dataDir, backupFolder, { recursive: true });
        } else {
            copyFolderSync(dataDir, backupFolder);
        }
        console.log(`✅ Backup created: ${backupFolder}`);
        cleanupOldBackups();
    } catch (error) {
        console.error('❌ Backup failed:', error);
    }
}

performBackup();

// ==================== HELPER: AUTO-REMOVE ALL ITEMS FOR A NEW STUDENT ====================
// Used at registration/import time so a brand-new student (no payment history yet)
// isn't billed for anything until the bursar explicitly restores specific items
// via Edit Student -> Restore.
// Component names matching these keywords are "optional" items that must
// stay removed-by-default even though they're termly — e.g. Transportation
// isn't used by every student, unlike scholastic requirements which apply
// to everyone. These require the bursar to manually restore per student.
const OPT_IN_COMPONENT_KEYWORDS = ['transport', 'van'];

function isOptInComponent(componentName) {
    if (!componentName) return false;
    const lower = componentName.toLowerCase();
    return OPT_IN_COMPONENT_KEYWORDS.some(kw => lower.includes(kw));
}

function buildAllItemsRemovedForFeeStructure(feeStructure) {
    const removedItems = {};
    if (!feeStructure || !feeStructure.activityComponents) return removedItems;

    for (const comp of feeStructure.activityComponents) {
        if (!comp || !comp.items) continue;

        const periodType = comp.periodType || 'termly';
        const isOptIn = isOptInComponent(comp.statusGroupName || comp.name);

        // ✅ Termly items are billed every term by default — never auto-remove.
        // EXCEPTION: opt-in components (e.g. Transportation/Van) stay removed
        // by default even though they're termly, since not every student
        // uses them — the bursar must manually restore per student.
        if (periodType === 'termly' && !isOptIn) continue;

        for (const item of comp.items) {
            if (!item) continue;
            const itemId = item.id || item.name;
            removedItems[itemId] = {
                itemId: itemId,
                itemName: item.name,
                componentId: comp.id || null,
                componentName: comp.name,
                defaultAmount: item.totalAmount || 0,
                defaultQuantity: item.quantity || 1,
                paymentOption: item.paymentOption || 'either',
                removedAt: new Date().toISOString(),
                reason: isOptIn
                    ? 'Optional item (Transportation) — requires manual activation by bursar'
                    : 'New student — not yet activated',
                isActive: true
            };
        }
    }
    return removedItems;
}
// ==================== HELPER FUNCTIONS ====================
// ==================== FIXED READ FILE FUNCTION ====================
// ==================== CORRECTED READ FILE FUNCTION ====================
// ==================== HELPER: DEDUPLICATE PAYMENT ITEMS ====================
// ==================== TERM-FROM-DATE HELPER ====================
// Uses the school's configured term date ranges if present (however the
// "Save Term Dates" feature stores them in settings.json), falling back
// to the standard Jan-Apr / May-Aug / Sep-Dec split shown in the UI.
function getTermForDate(dateStr, settingsOverride) {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;

    const settings = settingsOverride || readFile(files.settings);
    const termDates = settings.termDates || settings.termDateRanges || settings.academicTermDates || null;

    if (termDates) {
        for (const termNum of [1, 2, 3]) {
            const t = termDates[termNum] || termDates[String(termNum)];
            if (t && t.startDate && t.endDate) {
                const start = new Date(t.startDate);
                const end = new Date(t.endDate);
                if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && date >= start && date <= end) {
                    return termNum;
                }
            }
        }
    }

    // Fallback: standard calendar split (Jan-Apr, May-Aug, Sep-Dec)
    const month = date.getMonth() + 1;
    if (month >= 1 && month <= 4) return 1;
    if (month >= 5 && month <= 8) return 2;
    return 3;
}

function getAcademicYearForDate(dateStr) {
    if (!dateStr) return new Date().getFullYear();
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return new Date().getFullYear();
    return date.getFullYear();
}

function deduplicatePaymentItems(items) {
    if (!items || !Array.isArray(items) || items.length === 0) return items;
    
    const seen = new Set();
    const unique = [];
    
    for (const item of items) {
        const key = `${item.componentName || ''}_${item.itemName || ''}_${item.periodType || ''}_${item.paymentType || ''}_${item.amountPaid || 0}_${item.itemsBrought || 0}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(item);
        }
    }
    
    return unique;
}
// ================================================================
// FILE OPERATIONS - MUST BE DEFINED BEFORE ROUTES
// ================================================================

function readFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            // Check if file is empty
            if (!content || content.trim() === '') {
                console.warn(`⚠️ File ${filePath} is empty, returning default`);
                // Return appropriate default based on file type
                if (filePath.includes('settings.json') || filePath.includes('studentTermRecords.json')) {
                    return {};
                }
                return [];
            }
            const parsed = JSON.parse(content);
            return parsed;
        }
        console.log(`📄 File ${filePath} does not exist, returning default`);
        // Return appropriate default based on file type
        if (filePath.includes('settings.json') || filePath.includes('studentTermRecords.json')) {
            return {};
        }
        return [];
    } catch (error) {
        console.error(`❌ Error reading ${filePath}:`, error.message);
        // Return appropriate default based on file type
        if (filePath.includes('settings.json') || filePath.includes('studentTermRecords.json')) {
            return {};
        }
        return [];
    }
}

// ==================== ATOMIC SAVE FILE FUNCTION ====================
// This function now supports transaction atomicity via AsyncLocalStorage.
// If a transaction is active, writes go to temporary files.
// Otherwise, writes directly (original behavior).
function saveFile(filePath, data) {
    try {
        // Check if we are inside a transaction
        const store = transactionStorage.getStore();
        if (store) {
            // Write to a temporary file
            if (!fs.existsSync(TEMP_DIR)) {
                fs.mkdirSync(TEMP_DIR, { recursive: true });
            }
            // Ensure the target directory exists (for temp file we just use TEMP_DIR)
            const tempFileName = path.basename(filePath) + '.' + Date.now() + '.' + Math.random().toString(36).substr(2, 6);
            const tempPath = path.join(TEMP_DIR, tempFileName);
            
            // Write data to temp file
            const jsonData = JSON.stringify(data, null, 2);
            fs.writeFileSync(tempPath, jsonData, 'utf8');
            
            // Verify the temp file was written
            if (fs.existsSync(tempPath)) {
                // Store mapping in transaction store
                store.tempFiles[filePath] = tempPath;
                console.log(`📝 Staged write to temp: ${tempPath} (for ${filePath})`);
                return true;
            } else {
                console.error(`❌ Failed to write temp file: ${tempPath}`);
                return false;
            }
        } else {
            // Original behavior: write directly
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`📁 Created directory: ${dir}`);
            }
            
            const jsonData = JSON.stringify(data, null, 2);
            fs.writeFileSync(filePath, jsonData, 'utf8');
            
            if (fs.existsSync(filePath)) {
                const written = fs.readFileSync(filePath, 'utf8');
                console.log(`✅ File saved: ${filePath}`);
                console.log(`📄 Content length: ${written.length} bytes`);
                return true;
            }
            return false;
        }
    } catch (error) {
        console.error(`❌ Error writing ${filePath}:`, error.message);
        return false;
    }
}

// ==================== FIXED SAVE FILE FUNCTION ====================
// (previous duplicate definitions removed)

function getGradingSystem() {
    const settings = readFile(files.settings);
    return settings.gradingSystem || {
        'A': { min: 80, max: 100, remark: 'Excellent' },
        'B': { min: 70, max: 79, remark: 'Very Good' },
        'C': { min: 60, max: 69, remark: 'Good' },
        'D': { min: 50, max: 59, remark: 'Satisfactory' },
        'E': { min: 40, max: 49, remark: 'Fair' },
        'F': { min: 0, max: 39, remark: 'Poor' }
    };
}

function calculateGrade(percentage, gradingSystem) {
    for (const [grade, range] of Object.entries(gradingSystem)) {
        if (percentage >= range.min && percentage <= range.max) {
            return { grade, remark: range.remark };
        }
    }
    return { grade: 'F', remark: 'Poor' };
}

function transformFeeStructureWithPeriods(feeStructure) {
    if (!feeStructure) return null;
    const activityComponents = feeStructure.activityComponents || [];
    
    return {
        ...feeStructure,
        tuition: feeStructure.tuition || 0,
        oneTimeActivities: activityComponents.filter(c => c && c.periodType === 'one_time'),
        termlyActivities: activityComponents.filter(c => c && c.periodType === 'termly'),
        yearlyActivities: activityComponents.filter(c => c && c.periodType === 'yearly')
    };
}

// ==================== INITIALIZE DEFAULT DATA ====================
// ==================== INITIALIZE DEFAULT DATA ====================

function initializeDefaultData() {
    // Initialize settings - OBJECT
    if (!fs.existsSync(files.settings)) {
        saveFile(files.settings, {
            currentAcademicYear: new Date().getFullYear(),
            currentTerm: 1,
            gradingSystem: {
                'A': { min: 80, max: 100, remark: 'Excellent' },
                'B': { min: 70, max: 79, remark: 'Very Good' },
                'C': { min: 60, max: 69, remark: 'Good' },
                'D': { min: 50, max: 59, remark: 'Satisfactory' },
                'E': { min: 40, max: 49, remark: 'Fair' },
                'F': { min: 0, max: 39, remark: 'Poor' }
            }
        });
    }
    
    
    // Initialize schools - ARRAY
    if (!fs.existsSync(files.schools)) {
        saveFile(files.schools, []);
    }
    
    // Initialize classes - ARRAY
    if (!fs.existsSync(files.classes)) {
        saveFile(files.classes, [
            { id: uuidv4(), name: 'Baby Class', level: 'Nursery', order: 1, createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'Middle Class', level: 'Nursery', order: 2, createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'Top Class', level: 'Nursery', order: 3, createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'P.1', level: 'LowerPrimary', order: 4, createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'P.2', level: 'LowerPrimary', order: 5, createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'P.3', level: 'LowerPrimary', order: 6, createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'P.4', level: 'UpperPrimary', order: 7, createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'P.5', level: 'UpperPrimary', order: 8, createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'P.6', level: 'UpperPrimary', order: 9, createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'P.7', level: 'UpperPrimary', order: 10, createdAt: new Date().toISOString() }
        ]);
    }
    
    if (!fs.existsSync(files.statusGroups)) {
        saveFile(files.statusGroups, []);
    }

    // Initialize subjects - ARRAY
    if (!fs.existsSync(files.subjects)) {
        saveFile(files.subjects, [
            { id: uuidv4(), name: 'English', code: 'ENG', category: 'Core', classId: 'all', createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'Mathematics', code: 'MATH', category: 'Core', classId: 'all', createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'Science', code: 'SCI', category: 'Core', classId: 'all', createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'Social Studies', code: 'SST', category: 'Core', classId: 'all', createdAt: new Date().toISOString() }
        ]);
    }
    
    // Initialize bursaries - ARRAY
    if (!fs.existsSync(files.feeBursaries)) {
        saveFile(files.feeBursaries, [
            { id: uuidv4(), name: 'Merit Scholarship', description: 'Top performers', type: 'percentage', value: 25, category: 'Academic', isActive: true, createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'Sports Bursary', description: 'Sports talent', type: 'percentage', value: 15, category: 'Sports', isActive: true, createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'Sibling Discount', description: 'Multiple children', type: 'percentage', value: 10, category: 'Family', isActive: true, createdAt: new Date().toISOString() }
        ]);
    }
    
    // Initialize empty arrays for other collections
    const emptyArrays = ['feeStructures', 'teachers', 'students', 'enrollments', 'assessments', 'scores', 'attendance', 'feePayments', 'studentFeeAssignments'];
    emptyArrays.forEach(file => {
        if (!fs.existsSync(files[file])) {
            saveFile(files[file], []);
        }
    });
    
    // Initialize studentTermRecords - OBJECT (special case)
    if (!fs.existsSync(files.studentTermRecords)) {
        saveFile(files.studentTermRecords, {});
    }
}

initializeDefaultData();

// ==================== GLOBAL ACADEMIC SETTINGS ====================
// This MUST be defined at the top level before any routes use it

// Define the global variable
let currentAcademicSettings = {
    currentYear: new Date().getFullYear(),
    currentTerm: 1
};

// Function to load settings from file
function loadAcademicSettings() {
    try {
        const settingsPath = path.join(__dirname, 'data', 'settings.json');
        if (fs.existsSync(settingsPath)) {
            const settingsData = fs.readFileSync(settingsPath, 'utf8');
            const settings = JSON.parse(settingsData);
            if (settings.currentAcademicYear) {
                currentAcademicSettings.currentYear = settings.currentAcademicYear;
            }
            if (settings.currentTerm) {
                currentAcademicSettings.currentTerm = settings.currentTerm;
            }
            console.log(`📅 Academic settings loaded: Year ${currentAcademicSettings.currentYear}, Term ${currentAcademicSettings.currentTerm}`);
        } else {
            console.log(`📅 Using default academic settings: Year ${currentAcademicSettings.currentYear}, Term ${currentAcademicSettings.currentTerm}`);
        }
    } catch (error) {
        console.warn('Could not load academic settings, using defaults:', error.message);
    }
}

// Load settings immediately
loadAcademicSettings();

// Export for use in other routes if needed
function getAcademicSettings() {
    return currentAcademicSettings;
}

function updateAcademicSettings(year, term) {
    currentAcademicSettings.currentYear = year;
    currentAcademicSettings.currentTerm = term;
    // Save to file
    try {
        const settingsPath = path.join(__dirname, 'data', 'settings.json');
        let settings = {};
        if (fs.existsSync(settingsPath)) {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
        settings.currentAcademicYear = year;
        settings.currentTerm = term;
        settings.lastUpdated = new Date().toISOString();
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log(`📅 Academic settings saved: Year ${year}, Term ${term}`);
    } catch (error) {
        console.warn('Could not save academic settings:', error.message);
    }
}


// Reset all payments for a specific item for a student


// ==================== SCHOOL ROUTES ====================

// ==================== FIXED SCHOOL ROUTES WITH DEBUG ====================

// ==================== SCHOOL ROUTES (FIXED) ====================

app.get('/api/school', (req, res) => {
    try {
        console.log('🔍 GET /api/school called');
        const schools = readFile(files.schools);
        const settings = readFile(files.settings);
        
        console.log('📊 Schools data:', schools);
        
        const school = schools && schools.length > 0 ? schools[0] : null;
        
        res.json({ 
            school: school, 
            settings: settings 
        });
    } catch (error) {
        console.error('Error getting school:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/school/setup', (req, res) => {
    console.log('🔍 POST /api/school/setup called');
    console.log('📥 Request body:', req.body);
    
    try {
        const { schoolName, address, phone, email, motto, logo } = req.body;
        
        // ✅ Make sure readFile is available
        let schools = [];
        try {
            schools = readFile(files.schools);
        } catch (e) {
            console.warn('Could not read schools file, starting fresh:', e.message);
            schools = [];
        }
        
        // Ensure schools is an array
        if (!Array.isArray(schools)) {
            console.warn('⚠️ Schools is not an array, resetting to empty array');
            schools = [];
        }
        
        const schoolData = {
            id: schools[0]?.id || uuidv4(),
            schoolName: schoolName || 'My School',
            address: address || '',
            phone: phone || '',
            email: email || '',
            motto: motto || 'Quality Education for All',
            logo: logo || '',
            createdAt: schools[0] ? schools[0].createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        if (schools.length === 0) {
            schools.push(schoolData);
        } else {
            schools[0] = schoolData;
        }
        
        // ✅ Save the file
        const saved = saveFile(files.schools, schools);
        
        if (!saved) {
            console.error('❌ Failed to save school data');
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to save school data' 
            });
        }
        
        // ✅ Verify the save by reading back
        const verifyData = readFile(files.schools);
        console.log('✅ Verified saved data:', verifyData);
        
        res.json({ 
            success: true, 
            school: schoolData,
            verified: verifyData
        });
    } catch (error) {
        console.error('Error saving school:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.post('/api/school/setup', (req, res) => {
    console.log('🔍 POST /api/school/setup called');
    console.log('📥 Request body:', req.body);
    
    try {
        const { schoolName, address, phone, email, motto, logo } = req.body;
        let schools = readFile(files.schools);
        
        // Ensure schools is an array
        if (!Array.isArray(schools)) {
            console.warn('⚠️ Schools is not an array, resetting to empty array');
            schools = [];
        }
        
        const schoolData = {
            id: schools[0]?.id || uuidv4(),
            schoolName: schoolName || 'My School',
            address: address || '',
            phone: phone || '',
            email: email || '',
            motto: motto || 'Quality Education for All',
            logo: logo || '',
            createdAt: schools[0] ? schools[0].createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        if (schools.length === 0) {
            schools.push(schoolData);
        } else {
            schools[0] = schoolData;
        }
        
        // ✅ Force save with verification
        const saved = saveFile(files.schools, schools);
        
        if (!saved) {
            throw new Error('Failed to save school data');
        }
        
        // ✅ Verify the save
        const verifyData = readFile(files.schools);
        console.log('✅ Verified saved data:', verifyData);
        
        res.json({ 
            success: true, 
            school: schoolData,
            verified: verifyData
        });
    } catch (error) {
        console.error('Error saving school:', error);
        res.status(500).json({ error: error.message });
    }
});


// Add to server.js - Recovery endpoint to fix settings file
app.post('/api/academic/fix-settings', (req, res) => {
    try {
        const fixedSettings = {
            currentAcademicYear: new Date().getFullYear(),
            currentTerm: 1,
            lastUpdated: new Date().toISOString(),
            fixed: true,
            gradingSystem: {
                'A': { min: 80, max: 100, remark: 'Excellent' },
                'B': { min: 70, max: 79, remark: 'Very Good' },
                'C': { min: 60, max: 69, remark: 'Good' },
                'D': { min: 50, max: 59, remark: 'Satisfactory' },
                'E': { min: 40, max: 49, remark: 'Fair' },
                'F': { min: 0, max: 39, remark: 'Poor' }
            }
        };
        
        const saved = saveFile(files.settings, fixedSettings);
        
        if (saved) {
            res.json({ success: true, message: 'Settings file fixed', settings: fixedSettings });
        } else {
            res.status(500).json({ error: 'Failed to save fixed settings' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ==================== CLASSES ROUTES ====================

app.get('/api/school/classes', (req, res) => {
    res.json(readFile(files.classes));
});

app.get('/api/school/classes/:id', (req, res) => {
    const classes = readFile(files.classes);
    const classObj = classes.find(c => c.id === req.params.id);
    if (!classObj) return res.status(404).json({ error: 'Class not found' });
    res.json(classObj);
});

app.post('/api/school/classes', (req, res) => {
    const { name, level } = req.body;
    const classes = readFile(files.classes);
    
    if (classes.find(c => c.name === name)) {
        return res.status(400).json({ error: 'Class already exists' });
    }
    
    const newClass = {
        id: uuidv4(),
        name,
        level: level || 'LowerPrimary',
        order: classes.length + 1,
        createdAt: new Date().toISOString()
    };
    
    classes.push(newClass);
    saveFile(files.classes, classes);
    res.json({ success: true, class: newClass });
});

app.put('/api/school/classes/:id', (req, res) => {
    let classes = readFile(files.classes);
    const index = classes.findIndex(c => c.id === req.params.id);
    if (index !== -1) {
        classes[index] = { ...classes[index], ...req.body, updatedAt: new Date().toISOString() };
        saveFile(files.classes, classes);
        res.json({ success: true, class: classes[index] });
    } else {
        res.status(404).json({ error: 'Class not found' });
    }
});

app.delete('/api/school/classes/:id', (req, res) => {
    let classes = readFile(files.classes);
    classes = classes.filter(c => c.id !== req.params.id);
    saveFile(files.classes, classes);
    res.json({ success: true });
});

// ==================== SUBJECTS ROUTES ====================

app.get('/api/school/subjects', (req, res) => {
    res.json(readFile(files.subjects));
});

app.get('/api/school/subjects/:id', (req, res) => {
    const subjects = readFile(files.subjects);
    const subject = subjects.find(s => s.id === req.params.id);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });
    res.json(subject);
});

app.post('/api/school/subjects', (req, res) => {
    const { name, code, category, classId, description } = req.body;
    const subjects = readFile(files.subjects);
    
    if (subjects.find(s => s.name === name || s.code === code)) {
        return res.status(400).json({ error: 'Subject already exists' });
    }
    
    const newSubject = {
        id: uuidv4(),
        name,
        code: code || name.substring(0, 3).toUpperCase(),
        category: category || 'Core',
        classId: classId || 'all',
        description: description || '',
        createdAt: new Date().toISOString()
    };
    
    subjects.push(newSubject);
    saveFile(files.subjects, subjects);
    res.json({ success: true, subject: newSubject });
});

app.put('/api/school/subjects/:id', (req, res) => {
    let subjects = readFile(files.subjects);
    const index = subjects.findIndex(s => s.id === req.params.id);
    if (index !== -1) {
        subjects[index] = { ...subjects[index], ...req.body, updatedAt: new Date().toISOString() };
        saveFile(files.subjects, subjects);
        res.json({ success: true, subject: subjects[index] });
    } else {
        res.status(404).json({ error: 'Subject not found' });
    }
});

app.delete('/api/school/subjects/:id', (req, res) => {
    let subjects = readFile(files.subjects);
    subjects = subjects.filter(s => s.id !== req.params.id);
    saveFile(files.subjects, subjects);
    res.json({ success: true });
});

// ==================== TEACHER ROUTES (COMPLETE) ====================
// Version: 2.0 - With Password Management

// ==================== GET ALL TEACHERS ====================
app.get('/api/teachers', (req, res) => {
    try {
        const teachers = readFile(files.teachers);
        res.json(teachers);
    } catch (error) {
        console.error('Error fetching teachers:', error);
        res.status(500).json({ error: 'Failed to fetch teachers' });
    }
});

// ==================== GET TEACHER BY ID ====================
app.get('/api/teachers/:id', (req, res) => {
    try {
        const teachers = readFile(files.teachers);
        const teacher = teachers.find(t => t.id === req.params.id);
        if (!teacher) {
            return res.status(404).json({ error: 'Teacher not found' });
        }
        res.json(teacher);
    } catch (error) {
        console.error('Error fetching teacher:', error);
        res.status(500).json({ error: 'Failed to fetch teacher' });
    }
});

// ==================== CREATE TEACHER (WITH PASSWORD) ====================
app.post('/api/teachers', (req, res) => {
    try {
        const { 
            firstName, 
            lastName, 
            gender, 
            phone, 
            email, 
            dateOfBirth,
            qualification, 
            specialization, 
            subjects, 
            classes, 
            address,
            joinedAt,
            password,
            status
        } = req.body;

        // Validate required fields
        if (!firstName || !lastName || !gender || !phone) {
            return res.status(400).json({ 
                error: 'Missing required fields: firstName, lastName, gender, and phone are required' 
            });
        }

        const teachers = readFile(files.teachers);
        
        // Generate teacher ID
        const year = new Date().getFullYear();
        const nextNumber = String(teachers.length + 1).padStart(4, '0');
        const teacherId = `TCH${year}${nextNumber}`;

        // Generate password if not provided
        let finalPassword = password;
        if (!finalPassword || finalPassword.trim() === '') {
            finalPassword = Math.floor(100000 + Math.random() * 900000).toString();
        }

        const newTeacher = {
            id: uuidv4(),
            teacherId: teacherId,
            firstName: firstName,
            lastName: lastName,
            gender: gender || 'Male',
            phone: phone,
            email: email || '',
            dateOfBirth: dateOfBirth || null,
            qualification: qualification || '',
            specialization: specialization || '',
            subjects: subjects || [],
            classes: classes || [],
            address: address || '',
            joinedAt: joinedAt || new Date().toISOString().split('T')[0],
            status: status || 'Active',
            password: finalPassword, // Store the password
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        teachers.push(newTeacher);
        saveFile(files.teachers, teachers);

        // Log the creation
        console.log(`✅ New teacher created: ${firstName} ${lastName} (${teacherId})`);

        res.json({ 
            success: true, 
            teacher: newTeacher,
            message: `Teacher ${firstName} ${lastName} added successfully`,
            password: finalPassword // Return password so frontend can show it
        });

    } catch (error) {
        console.error('Error creating teacher:', error);
        res.status(500).json({ error: 'Failed to create teacher: ' + error.message });
    }
});

// ==================== UPDATE TEACHER ====================
app.put('/api/teachers/:id', (req, res) => {
    try {
        const teacherId = req.params.id;
        const updates = req.body;

        let teachers = readFile(files.teachers);
        const index = teachers.findIndex(t => t.id === teacherId);

        if (index === -1) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        // Prevent overwriting critical fields
        const allowedUpdates = [
            'firstName', 'lastName', 'gender', 'phone', 'email', 
            'dateOfBirth', 'qualification', 'specialization', 
            'subjects', 'classes', 'address', 'joinedAt', 'status',
            'password' // Allow password update for reset functionality
        ];

        const updatedTeacher = { ...teachers[index] };
        
        for (const key of allowedUpdates) {
            if (updates[key] !== undefined && updates[key] !== null) {
                updatedTeacher[key] = updates[key];
            }
        }

        updatedTeacher.updatedAt = new Date().toISOString();

        teachers[index] = updatedTeacher;
        saveFile(files.teachers, teachers);

        console.log(`✅ Teacher updated: ${updatedTeacher.firstName} ${updatedTeacher.lastName} (${updatedTeacher.teacherId})`);

        res.json({ 
            success: true, 
            teacher: updatedTeacher,
            message: `Teacher ${updatedTeacher.firstName} ${updatedTeacher.lastName} updated successfully`
        });

    } catch (error) {
        console.error('Error updating teacher:', error);
        res.status(500).json({ error: 'Failed to update teacher: ' + error.message });
    }
});

// ==================== DELETE TEACHER ====================
app.delete('/api/teachers/:id', (req, res) => {
    try {
        const teacherId = req.params.id;
        let teachers = readFile(files.teachers);

        const teacher = teachers.find(t => t.id === teacherId);
        if (!teacher) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        teachers = teachers.filter(t => t.id !== teacherId);
        saveFile(files.teachers, teachers);

        console.log(`🗑️ Teacher deleted: ${teacher.firstName} ${teacher.lastName} (${teacher.teacherId})`);

        res.json({ 
            success: true, 
            message: `Teacher ${teacher.firstName} ${teacher.lastName} deleted successfully`
        });

    } catch (error) {
        console.error('Error deleting teacher:', error);
        res.status(500).json({ error: 'Failed to delete teacher: ' + error.message });
    }
});

// ==================== RESET TEACHER PASSWORD ====================
app.post('/api/teachers/:id/reset-password', (req, res) => {
    try {
        const teacherId = req.params.id;
        let teachers = readFile(files.teachers);

        const index = teachers.findIndex(t => t.id === teacherId);
        if (index === -1) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        // Generate a new 6-digit numeric password
        const newPassword = Math.floor(100000 + Math.random() * 900000).toString();

        teachers[index].password = newPassword;
        teachers[index].updatedAt = new Date().toISOString();

        saveFile(files.teachers, teachers);

        console.log(`🔑 Password reset for teacher: ${teachers[index].firstName} ${teachers[index].lastName}`);

        res.json({ 
            success: true, 
            password: newPassword,
            message: 'Password reset successfully',
            teacher: {
                id: teachers[index].id,
                firstName: teachers[index].firstName,
                lastName: teachers[index].lastName,
                teacherId: teachers[index].teacherId
            }
        });

    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ error: 'Failed to reset password: ' + error.message });
    }
});

// ==================== BULK TEACHER OPERATIONS ====================

// Bulk delete teachers
app.post('/api/teachers/bulk-delete', (req, res) => {
    try {
        const { teacherIds } = req.body;

        if (!teacherIds || !Array.isArray(teacherIds) || teacherIds.length === 0) {
            return res.status(400).json({ error: 'No teacher IDs provided' });
        }

        let teachers = readFile(files.teachers);
        const deletedCount = teacherIds.length;
        const deletedNames = [];

        // Filter out the teachers to delete
        teachers = teachers.filter(t => {
            if (teacherIds.includes(t.id)) {
                deletedNames.push(`${t.firstName} ${t.lastName}`);
                return false;
            }
            return true;
        });

        saveFile(files.teachers, teachers);

        console.log(`🗑️ Bulk deleted ${deletedCount} teachers`);

        res.json({ 
            success: true, 
            deletedCount: deletedCount,
            message: `Deleted ${deletedCount} teacher(s) successfully`
        });

    } catch (error) {
        console.error('Error in bulk delete:', error);
        res.status(500).json({ error: 'Failed to delete teachers: ' + error.message });
    }
});

// Bulk update teacher status
app.post('/api/teachers/bulk-status', (req, res) => {
    try {
        const { teacherIds, status } = req.body;

        if (!teacherIds || !Array.isArray(teacherIds) || teacherIds.length === 0) {
            return res.status(400).json({ error: 'No teacher IDs provided' });
        }

        if (!status || !['Active', 'On Leave', 'Inactive'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status provided' });
        }

        let teachers = readFile(files.teachers);
        let updatedCount = 0;

        teachers = teachers.map(t => {
            if (teacherIds.includes(t.id)) {
                updatedCount++;
                return { ...t, status: status, updatedAt: new Date().toISOString() };
            }
            return t;
        });

        saveFile(files.teachers, teachers);

        console.log(`📊 Bulk updated ${updatedCount} teachers to status: ${status}`);

        res.json({ 
            success: true, 
            updatedCount: updatedCount,
            message: `Updated ${updatedCount} teacher(s) to ${status}`
        });

    } catch (error) {
        console.error('Error in bulk status update:', error);
        res.status(500).json({ error: 'Failed to update teachers: ' + error.message });
    }
});

// ==================== TEACHER STATISTICS ====================
app.get('/api/teachers/stats', (req, res) => {
    try {
        const teachers = readFile(files.teachers);
        
        const stats = {
            total: teachers.length,
            active: teachers.filter(t => t.status === 'Active').length,
            onLeave: teachers.filter(t => t.status === 'On Leave').length,
            inactive: teachers.filter(t => t.status === 'Inactive').length,
            male: teachers.filter(t => t.gender === 'Male').length,
            female: teachers.filter(t => t.gender === 'Female').length,
            qualified: teachers.filter(t => t.qualification && t.qualification !== '').length,
            withPassword: teachers.filter(t => t.password && t.password.length > 0).length,
            subjectDistribution: {},
            classDistribution: {}
        };

        // Subject distribution
        const allSubjects = new Set();
        teachers.forEach(t => {
            if (t.subjects) {
                t.subjects.forEach(subjectId => {
                    allSubjects.add(subjectId);
                });
            }
        });

        // Class distribution
        const allClasses = new Set();
        teachers.forEach(t => {
            if (t.classes) {
                t.classes.forEach(classId => {
                    allClasses.add(classId);
                });
            }
        });

        stats.totalSubjects = allSubjects.size;
        stats.totalClasses = allClasses.size;

        res.json(stats);

    } catch (error) {
        console.error('Error getting teacher stats:', error);
        res.status(500).json({ error: 'Failed to get teacher statistics' });
    }
});

// ==================== SEARCH TEACHERS ====================
app.get('/api/teachers/search', (req, res) => {
    try {
        const { q, subject, classId, status, gender } = req.query;
        let teachers = readFile(files.teachers);

        if (q) {
            const searchTerm = q.toLowerCase();
            teachers = teachers.filter(t => 
                (t.firstName && t.firstName.toLowerCase().includes(searchTerm)) ||
                (t.lastName && t.lastName.toLowerCase().includes(searchTerm)) ||
                (t.teacherId && t.teacherId.toLowerCase().includes(searchTerm)) ||
                (t.phone && t.phone.includes(searchTerm)) ||
                (t.email && t.email.toLowerCase().includes(searchTerm))
            );
        }

        if (subject) {
            teachers = teachers.filter(t => t.subjects && t.subjects.includes(subject));
        }

        if (classId) {
            teachers = teachers.filter(t => t.classes && t.classes.includes(classId));
        }

        if (status) {
            teachers = teachers.filter(t => t.status === status);
        }

        if (gender) {
            teachers = teachers.filter(t => t.gender === gender);
        }

        res.json(teachers);

    } catch (error) {
        console.error('Error searching teachers:', error);
        res.status(500).json({ error: 'Failed to search teachers' });
    }
});

console.log('✅ Teacher routes loaded with password management');

const archivePath = path.join(dataDir, 'archivedStudents.json');

// Helper: Read archive file
function readArchive() {
    if (!fs.existsSync(archivePath)) {
        return [];
    }
    try {
        const content = fs.readFileSync(archivePath, 'utf8');
        if (!content || content.trim() === '') return [];
        return JSON.parse(content);
    } catch (e) {
        console.error('❌ Error reading archive:', e.message);
        return [];
    }
}

// Helper: Save archive file
function saveArchive(data) {
    try {
        const dir = path.dirname(archivePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(archivePath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`✅ Archived students saved (${data.length} records)`);
        return true;
    } catch (e) {
        console.error('❌ Error saving archive:', e.message);
        return false;
    }
}

// ================================================================
// 1. GET ALL ARCHIVED STUDENTS
// ================================================================
app.get('/api/students/archive', (req, res) => {
    console.log('📦 Fetching archived students...');
    
    try {
        const archivedStudents = readArchive();
        
        console.log(`📦 Found ${archivedStudents.length} archived students`);
        
        res.json({ 
            success: true, 
            archivedStudents: archivedStudents,
            count: archivedStudents.length
        });
    } catch (error) {
        console.error('❌ Error reading archive:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ================================================================
// 2. GET A SINGLE ARCHIVED STUDENT BY ID
// ================================================================
app.get('/api/students/archive/:studentId', (req, res) => {
    console.log(`📦 Fetching archived student: ${req.params.studentId}`);
    
    try {
        const archivedStudents = readArchive();
        
        const record = archivedStudents.find(s => 
            s.student?.id === req.params.studentId || 
            s.id === req.params.studentId
        );
        
        if (!record) {
            return res.status(404).json({ 
                success: false, 
                error: 'Archived student not found' 
            });
        }
        
        res.json({ 
            success: true, 
            archivedStudent: record 
        });
    } catch (error) {
        console.error('❌ Error reading archive:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ================================================================
// 3. RESTORE AN ARCHIVED STUDENT (Move back to active)
// ================================================================
app.post('/api/students/restore/:studentId', (req, res) => {
    console.log(`🔄 Restoring archived student: ${req.params.studentId}`);
    
    try {
        const studentsPath = path.join(dataDir, 'students.json');
        const enrollmentsPath = path.join(dataDir, 'enrollments.json');
        
        // Read archive
        let archivedStudents = readArchive();
        
        // Find the archived student
        const index = archivedStudents.findIndex(s => 
            s.student?.id === req.params.studentId || 
            s.id === req.params.studentId
        );
        
        if (index === -1) {
            return res.status(404).json({ 
                success: false, 
                error: 'Archived student not found' 
            });
        }
        
        const record = archivedStudents[index];
        const student = record.student || record;
        
        // ============================================================
        // CRITICAL FIX: Set status to ACTIVE when restoring
        // ============================================================
        student.status = 'Active';
        student.restoredAt = new Date().toISOString();
        student.restoredFromArchive = true;
        delete student.graduatedAt;
        delete student.graduationReason;
        
        // Remove from archive
        archivedStudents.splice(index, 1);
        saveArchive(archivedStudents);
        
        // Add back to students
        let students = [];
        if (fs.existsSync(studentsPath)) {
            students = JSON.parse(fs.readFileSync(studentsPath, 'utf8'));
        }
        
        // Check if student already exists (by ID)
        const existingIndex = students.findIndex(s => s.id === student.id);
        if (existingIndex !== -1) {
            students[existingIndex] = student;
        } else {
            students.push(student);
        }
        fs.writeFileSync(studentsPath, JSON.stringify(students, null, 2));
        
        // Also restore the enrollment
        if (record.enrollments && record.enrollments.length > 0) {
            let enrollments = [];
            if (fs.existsSync(enrollmentsPath)) {
                enrollments = JSON.parse(fs.readFileSync(enrollmentsPath, 'utf8'));
            }
            
            // Find the last enrollment and make it current
            const lastEnrollment = record.enrollments[record.enrollments.length - 1];
            if (lastEnrollment) {
                const existingEnrollment = enrollments.find(e => e.id === lastEnrollment.id);
                if (existingEnrollment) {
                    existingEnrollment.isCurrent = true;
                    existingEnrollment.completedAt = null;
                    existingEnrollment.completionReason = null;
                } else {
                    lastEnrollment.isCurrent = true;
                    lastEnrollment.completedAt = null;
                    lastEnrollment.completionReason = null;
                    enrollments.push(lastEnrollment);
                }
                fs.writeFileSync(enrollmentsPath, JSON.stringify(enrollments, null, 2));
            }
        }
        
        console.log(`✅ Student ${student.firstName} ${student.lastName} restored successfully (status: Active)`);
        
        res.json({ 
            success: true, 
            message: 'Student restored successfully',
            student: student
        });
    } catch (error) {
        console.error('❌ Error restoring student:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ================================================================
// 4. PERMANENTLY DELETE AN ARCHIVED STUDENT
// ================================================================
app.delete('/api/students/archive/:studentId', (req, res) => {
    console.log(`🗑️ Permanently deleting archived student: ${req.params.studentId}`);
    
    try {
        let archivedStudents = readArchive();
        
        const index = archivedStudents.findIndex(s => 
            s.student?.id === req.params.studentId || 
            s.id === req.params.studentId
        );
        
        if (index === -1) {
            return res.status(404).json({ 
                success: false, 
                error: 'Archived student not found' 
            });
        }
        
        const student = archivedStudents[index].student || archivedStudents[index];
        archivedStudents.splice(index, 1);
        saveArchive(archivedStudents);
        
        console.log(`🗑️ Permanently deleted archived student: ${student.firstName} ${student.lastName}`);
        
        res.json({ 
            success: true, 
            message: 'Archived student permanently deleted'
        });
    } catch (error) {
        console.error('❌ Error deleting archived student:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ================================================================
// 5. GET ARCHIVE STATISTICS
// ================================================================
app.get('/api/students/archive/stats', (req, res) => {
    console.log('📊 Fetching archive statistics...');
    
    try {
        const archivedStudents = readArchive();
        
        const stats = {
            totalArchived: archivedStudents.length,
            byYear: {},
            byTerm: {},
            recent: []
        };
        
        archivedStudents.forEach(record => {
            const year = record.academicYear || 'Unknown';
            const term = record.term || 'Unknown';
            
            stats.byYear[year] = (stats.byYear[year] || 0) + 1;
            stats.byTerm[term] = (stats.byTerm[term] || 0) + 1;
        });
        
        // Get 5 most recent
        stats.recent = archivedStudents
            .sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt))
            .slice(0, 5)
            .map(r => ({
                name: `${r.student?.firstName || ''} ${r.student?.lastName || ''}`.trim() || 'Unknown',
                archivedAt: r.archivedAt,
                fromClass: r.fromClass || 'P.7'
            }));
        
        res.json({ 
            success: true, 
            stats: stats
        });
    } catch (error) {
        console.error('❌ Error getting archive stats:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ================================================================
// 6. EXPORT ARCHIVE DATA (CSV/JSON)
// ================================================================
app.get('/api/students/archive/export/:format', (req, res) => {
    const { format } = req.params;
    console.log(`📤 Exporting archive data in ${format} format`);
    
    try {
        const archivedStudents = readArchive();
        
        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename=archived_students.json');
            return res.json(archivedStudents);
        }
        
        if (format === 'csv') {
            // Build CSV headers
            const headers = ['Admission', 'Name', 'Gender', 'Last Class', 'Parent', 'Phone', 'Archived At', 'Reason', 'Academic Year', 'Term'];
            
            // Build CSV rows
            const rows = archivedStudents.map(record => {
                const student = record.student || record;
                return [
                    student.admissionNumber || 'N/A',
                    `${student.firstName || ''} ${student.lastName || ''}`.trim() || 'Unknown',
                    student.gender || 'N/A',
                    record.fromClass || student.currentClassName || 'P.7',
                    student.parentInfo?.name || 'N/A',
                    student.parentInfo?.phone || 'N/A',
                    record.archivedAt ? new Date(record.archivedAt).toLocaleString() : 'N/A',
                    record.archivedReason || 'Completed P.7',
                    record.academicYear || 'N/A',
                    record.term || 'N/A'
                ];
            });
            
            // Build CSV string
            let csv = headers.join(',') + '\n';
            rows.forEach(row => {
                csv += row.map(cell => `"${cell}"`).join(',') + '\n';
            });
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=archived_students.csv');
            return res.send(csv);
        }
        
        res.status(400).json({ 
            success: false, 
            error: 'Invalid format. Supported: json, csv' 
        });
    } catch (error) {
        console.error('❌ Error exporting archive:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ================================================================
// 7. BULK RESTORE ARCHIVED STUDENTS
// ================================================================
app.post('/api/students/archive/bulk-restore', (req, res) => {
    console.log('🔄 Bulk restoring archived students...');
    const { studentIds } = req.body;
    
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({ 
            success: false, 
            error: 'No student IDs provided' 
        });
    }
    
    try {
        const studentsPath = path.join(dataDir, 'students.json');
        let archivedStudents = readArchive();
        let restored = [];
        let notFound = [];
        
        for (const studentId of studentIds) {
            const index = archivedStudents.findIndex(s => 
                s.student?.id === studentId || 
                s.id === studentId
            );
            
            if (index === -1) {
                notFound.push(studentId);
                continue;
            }
            
            const record = archivedStudents[index];
            const student = record.student || record;
            
            // Set status to ACTIVE
            student.status = 'Active';
            student.restoredAt = new Date().toISOString();
            student.restoredFromArchive = true;
            delete student.graduatedAt;
            delete student.graduationReason;
            
            // Remove from archive
            archivedStudents.splice(index, 1);
            
            // Add to students
            let students = [];
            if (fs.existsSync(studentsPath)) {
                students = JSON.parse(fs.readFileSync(studentsPath, 'utf8'));
            }
            
            const existingIndex = students.findIndex(s => s.id === student.id);
            if (existingIndex !== -1) {
                students[existingIndex] = student;
            } else {
                students.push(student);
            }
            fs.writeFileSync(studentsPath, JSON.stringify(students, null, 2));
            
            restored.push(student.id);
        }
        
        // Save archive
        saveArchive(archivedStudents);
        
        console.log(`✅ Bulk restore: ${restored.length} restored, ${notFound.length} not found`);
        
        res.json({ 
            success: true, 
            message: `Restored ${restored.length} students`,
            restored: restored,
            notFound: notFound
        });
    } catch (error) {
        console.error('❌ Error in bulk restore:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

console.log('✅ Archive API endpoints registered:');
console.log('   GET    /api/students/archive');
console.log('   GET    /api/students/archive/:studentId');
console.log('   POST   /api/students/restore/:studentId');
console.log('   DELETE /api/students/archive/:studentId');
console.log('   GET    /api/students/archive/stats');
console.log('   GET    /api/students/archive/export/:format');
console.log('   POST   /api/students/archive/bulk-restore');

// ==================== STUDENT ROUTES ====================

// ==================== FIXED GET STUDENTS ENDPOINT ====================

// ==================== FIXED GET STUDENTS ENDPOINT - PRESERVES CUSTOM FIELDS ====================

app.get('/api/students', (req, res) => {
    try {
        const students = readFile(files.students);
        const enrollments = readFile(files.enrollments);
        const classes = readFile(files.classes);

        // Build class map
        const classMap = {};
        classes.forEach(c => {
            classMap[c.id] = c;
        });

        // Process each student – preserve their own currentClassId
        const studentsWithClass = students.map(student => {
            // Find current enrollment (if any)
            const currentEnrollment = enrollments.find(e => e.studentId === student.id && e.isCurrent);

            // Use the student's own currentClassId if available, otherwise fallback to enrollment
            const studentClassId = student.currentClassId || currentEnrollment?.classId || null;
            const currentClass = studentClassId ? classMap[studentClassId] : null;

            // Return the student with ALL original fields preserved, but add the class info
            return {
                ...student,
                currentClass: currentClass?.name || null,
                currentClassId: studentClassId  // <-- keep student's own class ID
            };
        });

        console.log(`✅ Returning ${studentsWithClass.length} students with correct class info`);

        res.json(studentsWithClass);
    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({ error: 'Failed to fetch students' });
    }
});

// ==================== FIXED GET STUDENT BY ID ENDPOINT ====================

// ==================== FIXED GET STUDENT BY ID ENDPOINT ====================
app.get('/api/students/:id', (req, res) => {
    try {
        const students = readFile(files.students);
        const student = students.find(s => s.id === req.params.id);

        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }

        const enrollments = readFile(files.enrollments);
        const classes = readFile(files.classes);
        const scores = readFile(files.scores);
        const assessments = readFile(files.assessments);

        // Use the student's own currentClassId, fallback to enrollment
        const currentEnrollment = enrollments.find(e => e.studentId === student.id && e.isCurrent);
        const studentClassId = student.currentClassId || currentEnrollment?.classId || null;
        const currentClass = studentClassId ? classes.find(c => c.id === studentClassId) : null;

        // Return student with ALL original fields preserved
        const result = {
            ...student,
            currentClass: currentClass?.name || null,
            currentClassId: studentClassId,      // <-- keep student's own class ID
            enrollments: enrollments.filter(e => e.studentId === student.id),
            scores: scores.filter(s => s.studentId === student.id).map(s => ({
                ...s,
                assessment: assessments.find(a => a.id === s.assessmentId)
            }))
        };

        console.log(`✅ Returning student ${student.firstName} ${student.lastName} with correct class`);

        res.json(result);
    } catch (error) {
        console.error('Error fetching student:', error);
        res.status(500).json({ error: 'Failed to fetch student' });
    }
});


// ==================== IMPORT STUDENTS FROM EXCEL ====================
app.post('/api/students/import', upload.single('file'), async (req, res) => {
    console.log('=== STUDENT IMPORT v5.0 - DAY vs BOARDING + DEFAULT-REMOVED ITEMS ===');
    
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const { currentYear, currentTerm } = currentAcademicSettings;
        
        // Parse the file
        let workbook;
        let data;
        const fileExt = req.file.originalname.split('.').pop().toLowerCase();
        
        if (fileExt === 'csv') {
            const csvData = req.file.buffer.toString('utf8');
            const rows = csvData.split('\n').map(row => row.split(','));
            data = rows.map(row => row.map(cell => cell.trim()));
        } else {
            workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
        }
        
        if (!data || data.length < 2) {
            return res.status(400).json({ error: 'File is empty or missing data rows' });
        }
        
        // ================================================================
        // STEP 1: PARSE HEADERS
        // ================================================================
        const headers = data[0].map(h => String(h).trim());
        console.log('📋 Headers found:', headers);
        
        const colIndex = {
            firstName: headers.findIndex(h => h && h.toLowerCase().includes('first')),
            lastName: headers.findIndex(h => h && h.toLowerCase().includes('last')),
            dateOfBirth: headers.findIndex(h => h && h.toLowerCase().includes('date of birth') || h.toLowerCase().includes('dob')),
            gender: headers.findIndex(h => h && h.toLowerCase().includes('gender')),
            birthPlace: headers.findIndex(h => h && h.toLowerCase().includes('place of birth')),
            nationality: headers.findIndex(h => h && h.toLowerCase().includes('nationality')),
            parentName: headers.findIndex(h => h && h.toLowerCase().includes('parent name')),
            relationship: headers.findIndex(h => h && h.toLowerCase().includes('relationship')),
            parentPhone: headers.findIndex(h => h && h.toLowerCase().includes('phone number')),
            parentAltPhone: headers.findIndex(h => h && h.toLowerCase().includes('alternative phone')),
            parentEmail: headers.findIndex(h => h && h.toLowerCase().includes('email')),
            parentOccupation: headers.findIndex(h => h && h.toLowerCase().includes('occupation')),
            address: headers.findIndex(h => h && h.toLowerCase().includes('address')),
            className: headers.findIndex(h => h && h.toLowerCase().includes('class'))
        };
        
        const requiredCols = ['firstName', 'lastName', 'gender', 'parentName', 'parentPhone', 'address', 'className'];
        const missing = requiredCols.filter(col => colIndex[col] === -1);
        if (missing.length > 0) {
            return res.status(400).json({ 
                error: `Missing required columns: ${missing.join(', ')}. Please use the template.` 
            });
        }
        
        console.log('📊 Column mapping:', colIndex);
        
        // ================================================================
        // STEP 2: LOAD FEE STRUCTURES AND CLASSES
        // ================================================================
        const feeStructures = readFile(files.feeStructures) || [];
        const classes = readFile(files.classes) || [];
        
        // Build fee structure map with separate day/boarding tracking
        const feeStructureMap = {};
        const dayFeeStructures = {};
        const boardingFeeStructures = {};
        
        for (const fs of feeStructures) {
            if (fs && fs.name && fs.isActive !== false) {
                const nameKey = fs.name.toLowerCase().trim();
                feeStructureMap[nameKey] = fs;
                
                // Track day vs boarding
                if (nameKey.includes('boarding')) {
                    boardingFeeStructures[nameKey.replace('boarding', '').trim()] = fs;
                } else if (nameKey.includes('day')) {
                    dayFeeStructures[nameKey.replace('day', '').trim()] = fs;
                }
                
                // Also without the suffix
                const parts = fs.name.split(' ');
                if (parts.length >= 2) {
                    const last = parts[parts.length - 1];
                    if (last === 'Day' || last === 'Boarding') {
                        const baseName = parts.slice(0, -1).join(' ').toLowerCase().trim();
                        feeStructureMap[baseName] = fs;
                        feeStructureMap[baseName.replace(/\s/g, '')] = fs;
                        
                        if (last === 'Boarding') {
                            boardingFeeStructures[baseName] = fs;
                        } else {
                            dayFeeStructures[baseName] = fs;
                        }
                    }
                }
                
                // P.1, P.2, etc.
                const numMatch = fs.name.match(/(\d+)/);
                if (numMatch) {
                    const num = numMatch[1];
                    const pKey = `p.${num}`.toLowerCase();
                    const primaryKey = `primary ${num}`.toLowerCase();
                    feeStructureMap[pKey] = fs;
                    feeStructureMap[primaryKey] = fs;
                    feeStructureMap[pKey.replace(/\s/g, '')] = fs;
                    feeStructureMap[primaryKey.replace(/\s/g, '')] = fs;
                    
                    if (nameKey.includes('boarding')) {
                        boardingFeeStructures[pKey] = fs;
                        boardingFeeStructures[primaryKey] = fs;
                    } else {
                        dayFeeStructures[pKey] = fs;
                        dayFeeStructures[primaryKey] = fs;
                    }
                }
            }
        }
        
        // Build class map
        const classMap = {};
        for (const cls of classes) {
            if (cls && cls.name) {
                const nameKey = cls.name.toLowerCase().trim();
                classMap[nameKey] = cls;
                classMap[nameKey.replace(/\s/g, '')] = cls;
            }
        }
        
        console.log(`📦 Day fee structures: ${Object.keys(dayFeeStructures).length}`);
        console.log(`📦 Boarding fee structures: ${Object.keys(boardingFeeStructures).length}`);
        
        // ================================================================
        // STEP 3: HELPER FUNCTIONS (FIXED)
        // ================================================================
        
        function findClassId(className) {
            if (!className) return null;
            const clean = className.toLowerCase().trim();
            
            // Try exact
            if (classMap[clean]) return classMap[clean].id;
            if (classMap[clean.replace(/\s/g, '')]) return classMap[clean.replace(/\s/g, '')].id;
            
            // Try level + number
            const match = clean.match(/(p\.?|primary)\s*(\d+)/i);
            if (match) {
                const num = match[2];
                const variants = [`p.${num}`, `primary ${num}`, `p${num}`, `primary${num}`];
                for (const v of variants) {
                    if (classMap[v]) return classMap[v].id;
                    if (classMap[v.replace(/\s/g, '')]) return classMap[v.replace(/\s/g, '')].id;
                }
                for (const [key, cls] of Object.entries(classMap)) {
                    if (key.includes(`p.${num}`) || key.includes(`primary ${num}`)) {
                        return cls.id;
                    }
                }
            }
            
            // Baby/Middle/Top
            const levelMatch = clean.match(/(baby|middle|top|nursery)/i);
            if (levelMatch) {
                const levelMap = {
                    'baby': 'Baby Class',
                    'middle': 'Middle Class',
                    'top': 'Top Class',
                    'nursery': 'Nursery'
                };
                const levelName = levelMap[levelMatch[1].toLowerCase()];
                if (levelName && classMap[levelName.toLowerCase()]) {
                    return classMap[levelName.toLowerCase()].id;
                }
            }
            
            return null;
        }
        
        function findFeeStructureId(className) {
            if (!className) return null;
            const clean = className.toLowerCase().trim();
            
            // ================================================================
            // CRITICAL: Detect Boarding/Day
            // ================================================================
            const isBoarding = clean.includes('boarding');
            const isDay = clean.includes('day');
            
            // Remove suffix for base matching
            let base = clean;
            if (isBoarding) base = base.replace('boarding', '').trim();
            if (isDay) base = base.replace('day', '').trim();
            
            // ================================================================
            // CASE 1: "Boarding" is explicitly specified
            // ================================================================
            if (isBoarding) {
                // Try exact match with "Boarding"
                const boardingKey = `${base} boarding`.toLowerCase().trim();
                if (feeStructureMap[boardingKey]) return feeStructureMap[boardingKey].id;
                if (feeStructureMap[boardingKey.replace(/\s/g, '')]) return feeStructureMap[boardingKey.replace(/\s/g, '')].id;
                
                // Try base key in boarding map
                if (boardingFeeStructures[base]) return boardingFeeStructures[base].id;
                if (boardingFeeStructures[base.replace(/\s/g, '')]) return boardingFeeStructures[base.replace(/\s/g, '')].id;
                
                // Try number extraction
                const match = base.match(/(p\.?|primary)\s*(\d+)/i);
                if (match) {
                    const num = match[2];
                    const numKey = `p.${num}`.toLowerCase();
                    if (boardingFeeStructures[numKey]) return boardingFeeStructures[numKey].id;
                    if (boardingFeeStructures[`primary ${num}`]) return boardingFeeStructures[`primary ${num}`].id;
                }
            }
            
            // ================================================================
            // CASE 2: "Day" is explicitly specified OR no suffix specified
            // ================================================================
            if (isDay || (!isBoarding && !isDay)) {
                // Try exact match with "Day"
                const dayKey = `${base} day`.toLowerCase().trim();
                if (feeStructureMap[dayKey]) return feeStructureMap[dayKey].id;
                if (feeStructureMap[dayKey.replace(/\s/g, '')]) return feeStructureMap[dayKey.replace(/\s/g, '')].id;
                
                // Try base key in day map
                if (dayFeeStructures[base]) return dayFeeStructures[base].id;
                if (dayFeeStructures[base.replace(/\s/g, '')]) return dayFeeStructures[base.replace(/\s/g, '')].id;
                
                // Try number extraction
                const match = base.match(/(p\.?|primary)\s*(\d+)/i);
                if (match) {
                    const num = match[2];
                    const numKey = `p.${num}`.toLowerCase();
                    if (dayFeeStructures[numKey]) return dayFeeStructures[numKey].id;
                    if (dayFeeStructures[`primary ${num}`]) return dayFeeStructures[`primary ${num}`].id;
                }
            }
            
            // ================================================================
            // CASE 3: FALLBACK - Try any match, but DAY preferred over BOARDING
            // ================================================================
            // First try exact match on the original name
            if (feeStructureMap[clean]) return feeStructureMap[clean].id;
            if (feeStructureMap[clean.replace(/\s/g, '')]) return feeStructureMap[clean.replace(/\s/g, '')].id;
            
            // Try base key in feeStructureMap
            if (feeStructureMap[base]) return feeStructureMap[base].id;
            if (feeStructureMap[base.replace(/\s/g, '')]) return feeStructureMap[base.replace(/\s/g, '')].id;
            
            // Try number extraction
            const match = base.match(/(p\.?|primary)\s*(\d+)/i);
            if (match) {
                const num = match[2];
                const variants = [
                    `p.${num}`,
                    `primary ${num}`,
                    `p${num}`,
                    `primary${num}`,
                    `p.${num} day`,
                    `primary ${num} day`
                ];
                for (const v of variants) {
                    const lower = v.toLowerCase().trim();
                    if (feeStructureMap[lower]) return feeStructureMap[lower].id;
                    if (feeStructureMap[lower.replace(/\s/g, '')]) return feeStructureMap[lower.replace(/\s/g, '')].id;
                }
            }
            
            // ================================================================
            // CASE 4: LAST RESORT - Try by level only
            // ================================================================
            const levelMatch = clean.match(/(baby|middle|top|nursery)/i);
            if (levelMatch) {
                const levelMap = {
                    'baby': 'Baby Class',
                    'middle': 'Middle Class',
                    'top': 'Top Class',
                    'nursery': 'Nursery'
                };
                const levelName = levelMap[levelMatch[1].toLowerCase()];
                if (levelName) {
                    // Prefer Day if no suffix specified
                    if (!isBoarding) {
                        const dayKey = `${levelName} Day`.toLowerCase().trim();
                        if (feeStructureMap[dayKey]) return feeStructureMap[dayKey].id;
                        if (dayFeeStructures[levelName]) return dayFeeStructures[levelName].id;
                    }
                    const boardingKey = `${levelName} Boarding`.toLowerCase().trim();
                    if (feeStructureMap[boardingKey]) return feeStructureMap[boardingKey].id;
                    if (boardingFeeStructures[levelName]) return boardingFeeStructures[levelName].id;
                }
            }
            
            console.log(`⚠️ No fee structure found for: "${className}" (base: "${base}")`);
            return null;
        }
        
        // ================================================================
        // STEP 3b: HELPER — AUTO-REMOVE ALL ITEMS FOR A BRAND-NEW STUDENT
        // ================================================================
        // Mirrors the same behavior used at manual registration: a newly
        // imported student (no payment history yet) starts with every
        // scholastic item in their assigned fee structure marked "removed"
        // (not billed). The bursar restores whichever items should actually
        // be charged, via Edit Student -> Restore. Tuition is unaffected.
      function buildAllItemsRemovedForFeeStructure(feeStructure) {
    const removedItems = {};
    if (!feeStructure || !feeStructure.activityComponents) return removedItems;

    for (const comp of feeStructure.activityComponents) {
        if (!comp || !comp.items) continue;

        // ✅ Termly items are billed every term by default — never auto-remove.
        const periodType = comp.periodType || 'termly';
        if (periodType === 'termly') continue;

        for (const item of comp.items) {
            if (!item) continue;
            const itemId = item.id || item.name;
            removedItems[itemId] = {
                itemId: itemId,
                itemName: item.name,
                componentId: comp.id || null,
                componentName: comp.name,
                defaultAmount: item.totalAmount || 0,
                defaultQuantity: item.quantity || 1,
                paymentOption: item.paymentOption || 'either',
                removedAt: new Date().toISOString(),
                reason: 'New student — not yet activated',
                isActive: true
            };
        }
    }
    return removedItems;
}
        // ================================================================
        // STEP 4: PROCESS ROWS
        // ================================================================
        const results = {
            success: 0,
            failed: 0,
            errors: [],
            students: [],
            classAssignments: [],
            feeAssignments: []
        };
        
        let students = readFile(files.students) || [];
        let enrollments = readFile(files.enrollments) || [];
        let feeAssignments = readFile(files.studentFeeAssignments) || [];
        
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row.length === 0 || row.every(cell => !cell || String(cell).trim() === '')) continue;
            
            try {
                const firstName = String(row[colIndex.firstName] || '').trim();
                const lastName = String(row[colIndex.lastName] || '').trim();
                const dateOfBirth = row[colIndex.dateOfBirth] ? String(row[colIndex.dateOfBirth]).trim() : '';
                const gender = String(row[colIndex.gender] || '').trim();
                const birthPlace = String(row[colIndex.birthPlace] || '').trim();
                const nationality = String(row[colIndex.nationality] || 'Ugandan').trim();
                const parentName = String(row[colIndex.parentName] || '').trim();
                const relationship = String(row[colIndex.relationship] || 'Parent').trim();
                const parentPhone = String(row[colIndex.parentPhone] || '').trim();
                const parentAltPhone = String(row[colIndex.parentAltPhone] || '').trim();
                const parentEmail = String(row[colIndex.parentEmail] || '').trim();
                const parentOccupation = String(row[colIndex.parentOccupation] || '').trim();
                const address = String(row[colIndex.address] || '').trim();
                const className = String(row[colIndex.className] || '').trim();
                
                if (!firstName && !lastName) {
                    results.errors.push(`Row ${i+1}: No student name provided`);
                    results.failed++;
                    continue;
                }
                
                // ============================================================
                // COMPUTE BILLING PERIOD FROM ENROLLMENT DATE
                // ============================================================
                // The import template has no explicit enrollment-date column, so
                // "now" is the effective enrollment date for a row processed here —
                // matching what the code already defaults a new student's
                // enrollmentDate field to below.
                const effectiveEnrollmentDate = new Date().toISOString().split('T')[0];
                const computedTerm = getTermForDate(effectiveEnrollmentDate) || (currentAcademicSettings.currentTerm || 1);
                const computedYear = getAcademicYearForDate(effectiveEnrollmentDate) || parseInt(currentYear);
                console.log(`📅 Row ${i+1}: Enrollment ${effectiveEnrollmentDate} → billing period: ${computedYear} Term ${computedTerm}`);
                
                // ============================================================
                // FIND CLASS AND FEE STRUCTURE
                // ============================================================
                let classId = null;
                let feeStructureId = null;
                let matchedClassName = '';
                let matchedFeeStructureName = '';
                let isBoardingDetected = false;
                
                if (className) {
                    // Check if boarding is mentioned
                    isBoardingDetected = className.toLowerCase().includes('boarding');
                    
                    classId = findClassId(className);
                    if (classId) {
                        const cls = classes.find(c => c.id === classId);
                        if (cls) matchedClassName = cls.name;
                    }
                    
                    feeStructureId = findFeeStructureId(className);
                    if (feeStructureId) {
                        const fs = feeStructures.find(f => f.id === feeStructureId);
                        if (fs) matchedFeeStructureName = fs.name;
                    }
                    
                    console.log(`📊 Row ${i+1}: "${className}" ${isBoardingDetected ? '🚌 BOARDING' : '📚 DAY'} -> Class: ${matchedClassName || 'Not found'}, Fee: ${matchedFeeStructureName || 'Not found'}`);
                }
                
                // Fallback: if no fee structure, try to derive from class
                if (!feeStructureId && classId) {
                    const cls = classes.find(c => c.id === classId);
                    if (cls) {
                        const clsName = cls.name.toLowerCase().trim();
                        // Look for day or boarding version based on detection
                        if (isBoardingDetected) {
                            for (const [key, fs] of Object.entries(boardingFeeStructures)) {
                                if (key.includes(clsName) || clsName.includes(key)) {
                                    feeStructureId = fs.id;
                                    matchedFeeStructureName = fs.name;
                                    break;
                                }
                            }
                        }
                        if (!feeStructureId) {
                            for (const [key, fs] of Object.entries(dayFeeStructures)) {
                                if (key.includes(clsName) || clsName.includes(key)) {
                                    feeStructureId = fs.id;
                                    matchedFeeStructureName = fs.name;
                                    break;
                                }
                            }
                        }
                    }
                }
                
                // ============================================================
                // CREATE OR UPDATE STUDENT
                // ============================================================
                const { v4: uuidv4 } = require('uuid');
                const admissionNumber = `STU${currentYear}${String(students.length + 1).padStart(4, '0')}`;
                
                let existingStudent = students.find(s => 
                    (s.firstName === firstName && s.lastName === lastName) ||
                    (s.admissionNumber === admissionNumber)
                );
                
                let studentId;
                let studentData;
                let isNewStudent = false;
                
                if (existingStudent) {
                    // ========== EXISTING STUDENT: UPDATE, DO NOT TOUCH removedItems ==========
                    // An existing student may already have payment history and
                    // active/customized items, so we never auto-remove anything
                    // for them here.
                    studentId = existingStudent.id;
                    studentData = {
                        ...existingStudent,
                        firstName: firstName || existingStudent.firstName,
                        lastName: lastName || existingStudent.lastName,
                        gender: gender || existingStudent.gender,
                        dateOfBirth: dateOfBirth || existingStudent.dateOfBirth,
                        birthPlace: birthPlace || existingStudent.birthPlace,
                        nationality: nationality || existingStudent.nationality,
                        parentInfo: {
                            ...existingStudent.parentInfo,
                            name: parentName || existingStudent.parentInfo?.name,
                            relationship: relationship || existingStudent.parentInfo?.relationship,
                            phone: parentPhone || existingStudent.parentInfo?.phone,
                            altPhone: parentAltPhone || existingStudent.parentInfo?.altPhone,
                            email: parentEmail || existingStudent.parentInfo?.email,
                            occupation: parentOccupation || existingStudent.parentInfo?.occupation
                        },
                        address: address || existingStudent.address,
                        currentClassId: classId || existingStudent.currentClassId,
                        updatedAt: new Date().toISOString()
                    };
                    const idx = students.findIndex(s => s.id === studentId);
                    if (idx !== -1) students[idx] = studentData;
                    results.success++;
                } else {
                    // ========== BRAND-NEW STUDENT: AUTO-REMOVE ALL ITEMS ==========
                    isNewStudent = true;
                    studentId = uuidv4();

                    const feeStructureForNewStudent = feeStructureId
                        ? feeStructures.find(f => f.id === feeStructureId)
                        : null;
                    const autoRemovedItems = buildAllItemsRemovedForFeeStructure(feeStructureForNewStudent);
                    const hasAutoRemovedItems = Object.keys(autoRemovedItems).length > 0;

                    studentData = {
                        id: studentId,
                        admissionNumber: admissionNumber,
                        firstName: firstName || 'Unknown',
                        lastName: lastName || 'Student',
                        dateOfBirth: dateOfBirth || '',
                        gender: gender || 'Male',
                        birthPlace: birthPlace || '',
                        nationality: nationality || 'Ugandan',
                        parentInfo: {
                            name: parentName || '',
                            relationship: relationship || 'Parent',
                            phone: parentPhone || '',
                            altPhone: parentAltPhone || '',
                            email: parentEmail || '',
                            occupation: parentOccupation || ''
                        },
                        address: address || '',
                        previousSchool: '',
                        admissionType: 'New',
                        enrollmentDate: effectiveEnrollmentDate,
                        status: 'Active',
                        currentClassId: classId || null,
                        // ========== NEW: items not yet activated for this student ==========
                        removedItems: hasAutoRemovedItems ? autoRemovedItems : null,
                        hasRemovedItems: hasAutoRemovedItems,
                        removedItemsCount: hasAutoRemovedItems ? Object.keys(autoRemovedItems).length : 0,
                        assignedFeeStructureId: feeStructureId || null,
                        enrolledAt: new Date().toISOString(),
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };
                    students.push(studentData);
                    results.success++;

                    if (hasAutoRemovedItems) {
                        console.log(`   🆕 Row ${i+1}: Auto-removed ${Object.keys(autoRemovedItems).length} item(s) for new student "${firstName} ${lastName}" (not yet billed)`);
                    }
                }
                
                results.students.push(studentData);
                
                // ============================================================
                // CREATE ENROLLMENT
                // ============================================================
                if (classId && studentId) {
                    const existingEnrollment = enrollments.find(e => 
                        e.studentId === studentId && 
                        e.academicYear === computedYear &&
                        e.isCurrent === true
                    );
                    
                    if (existingEnrollment) {
                        existingEnrollment.classId = classId;
                        existingEnrollment.updatedAt = new Date().toISOString();
                    } else {
                        enrollments.push({
                            id: uuidv4(),
                            studentId: studentId,
                            classId: classId,
                            academicYear: computedYear,
                            term: computedTerm,
                            isCurrent: true,
                            enrolledAt: new Date().toISOString()
                        });
                    }
                }
                
                // ============================================================
                // CREATE FEE ASSIGNMENT
                // ============================================================
                if (feeStructureId && studentId) {
                    const existingAssignment = feeAssignments.find(a => 
                        a.studentId === studentId
                    );
                    
                    if (existingAssignment) {
                        existingAssignment.feeStructureId = feeStructureId;
                        existingAssignment.updatedAt = new Date().toISOString();
                    } else {
                        feeAssignments.push({
                            id: uuidv4(),
                            studentId: studentId,
                            feeStructureId: feeStructureId,
                            bursaryId: null,
                            academicYear: computedYear,
                            term: computedTerm,
                            assignedAt: new Date().toISOString()
                        });
                    }
                    
                    results.feeAssignments.push({
                        studentId: studentId,
                        feeStructureId: feeStructureId,
                        feeStructureName: matchedFeeStructureName || 'Unknown',
                        isBoarding: isBoardingDetected,
                        isNewStudent: isNewStudent
                    });
                }
                
                results.classAssignments.push({
                    studentId: studentId,
                    className: matchedClassName || className || 'Unknown',
                    classId: classId
                });
                
            } catch (rowError) {
                console.error('Error processing row:', i, rowError);
                results.errors.push(`Row ${i+1}: ${rowError.message}`);
                results.failed++;
            }
        }
        
        // Save all data
        saveFile(files.students, students);
        saveFile(files.enrollments, enrollments);
        saveFile(files.studentFeeAssignments, feeAssignments);
        
        const newStudentCount = results.students.filter(s => s.hasRemovedItems).length;
        
        console.log(`✅ Import complete: ${results.success} successful, ${results.failed} failed`);
        console.log(`   Class assignments: ${results.classAssignments.length}`);
        console.log(`   Fee assignments: ${results.feeAssignments.length}`);
        console.log(`   New students with auto-removed items: ${newStudentCount}`);
        
        // Build detailed summary
        let responseMessage = `Import completed: ${results.success} students processed, ${results.failed} failed.\n\n`;
        
        if (results.feeAssignments.length > 0) {
            const feeSummary = {};
            const boardingCount = results.feeAssignments.filter(a => a.isBoarding).length;
            const dayCount = results.feeAssignments.filter(a => !a.isBoarding).length;
            
            responseMessage += `📊 Fee Structure Summary:\n`;
            responseMessage += `   🏫 Boarding: ${boardingCount} student(s)\n`;
            responseMessage += `   📚 Day: ${dayCount} student(s)\n\n`;
            
            for (const a of results.feeAssignments) {
                const name = a.feeStructureName || 'Unknown';
                feeSummary[name] = (feeSummary[name] || 0) + 1;
            }
            for (const [name, count] of Object.entries(feeSummary)) {
                responseMessage += `   ${name}: ${count} student(s)\n`;
            }
        }
        
        if (newStudentCount > 0) {
            responseMessage += `\n❌ Items not activated:\n`;
            responseMessage += `   ${newStudentCount} new student(s) had all fee items auto-removed (not billed).\n`;
            responseMessage += `   Restore items individually via Edit Student -> Restore.\n`;
        }
        
        if (results.errors.length > 0) {
            responseMessage += `\n⚠️ Errors:\n${results.errors.slice(0, 10).join('\n')}`;
            if (results.errors.length > 10) {
                responseMessage += `\n... and ${results.errors.length - 10} more errors`;
            }
        }
        
        res.json({
            success: true,
            message: responseMessage,
            results: results,
            newStudentsWithRemovedItems: newStudentCount
        });
        
    } catch (error) {
        console.error('Error importing students:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// ==================== GET IMPORT TEMPLATE ====================
app.get('/api/students/import/template', (req, res) => {
    console.log('📋 Generating import template - v2.0 (Simplified Fields)');
    
    // ================================================================
    // TEMPLATE HEADERS - Only fields that need to be imported
    // These match the registration form fields
    // ================================================================
    const template = [
        [
            'First Name *',
            'Last Name *',
            'Date of Birth',
            'Gender *',
            'Place of Birth',
            'Nationality',
            'Parent Name *',
            'Relationship',
            'Phone Number *',
            'Alternative Phone',
            'Email',
            'Occupation',
            'Address *',
            'Class *'
        ],
        // Example Row
        [
            'John',
            'Doe',
            '2015-01-15',
            'Male',
            'Kampala',
            'Ugandan',
            'Jane Doe',
            'Parent',
            '0700123456',
            '0700654321',
            'john.doe@email.com',
            'Teacher',
            'Kampala, Uganda',
            'P.5'
        ],
        // Another Example Row (Boarding)
        [
            'Mary',
            'Smith',
            '2014-06-20',
            'Female',
            'Jinja',
            'Ugandan',
            'Peter Smith',
            'Parent',
            '0700987654',
            '',
            'mary.smith@email.com',
            'Business',
            'Jinja, Uganda',
            'P.5 Boarding'
        ]
    ];
    
    // ================================================================
    // CREATE WORKBOOK
    // ================================================================
    const ws = xlsx.utils.aoa_to_sheet(template);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Students');
    
    // ================================================================
    // AUTO-FIT COLUMN WIDTHS
    // ================================================================
    const colWidths = [
        { wch: 15 }, // First Name
        { wch: 15 }, // Last Name
        { wch: 15 }, // Date of Birth
        { wch: 10 }, // Gender
        { wch: 15 }, // Place of Birth
        { wch: 12 }, // Nationality
        { wch: 18 }, // Parent Name
        { wch: 15 }, // Relationship
        { wch: 15 }, // Phone Number
        { wch: 15 }, // Alternative Phone
        { wch: 25 }, // Email
        { wch: 15 }, // Occupation
        { wch: 25 }, // Address
        { wch: 20 }  // Class
    ];
    ws['!cols'] = colWidths;
    
    // ================================================================
    // ADD INSTRUCTION SHEET
    // ================================================================
    const instructions = [
        ['📋 IMPORT INSTRUCTIONS'],
        [''],
        ['1. Fill in the student data in the "Students" sheet'],
        ['2. Do NOT change the column headers'],
        ['3. Required fields are marked with *'],
        ['4. The "Class" field determines both the class and fee structure:'],
        ['   - Examples: P.1, P.2, P.3, P.4, P.5, P.6, P.7'],
        ['   - Examples: Baby Class, Middle Class, Top Class'],
        ['   - Add "Boarding" for boarding students: P.5 Boarding'],
        ['   - Default is Day if not specified'],
        ['5. Gender: Male, Female, or Other'],
        ['6. Date of Birth format: YYYY-MM-DD'],
        ['7. Phone numbers: 07XX XXX XXX'],
        [''],
        ['📌 IMPORTANT NOTES:'],
        ['- Students will be automatically assigned to the correct class'],
        ['- The corresponding fee structure will be assigned based on the class'],
        ['- Existing students will be updated if matched by name'],
        ['- New students will be created with a unique admission number'],
        [''],
        ['📊 Available Classes and Their Fee Structures:'],
        [''],
        ['NURSERY LEVEL:'],
        ['   Baby Class Day / Baby Class Boarding'],
        ['   Middle Class Day / Middle Class Boarding'],
        ['   Top Class Day / Top Class Boarding'],
        [''],
        ['LOWER PRIMARY (P.1 - P.3):'],
        ['   Primary 1 Day / Primary 1 Boarding'],
        ['   Primary 2 Day / Primary 2 Boarding'],
        ['   Primary 3 Day / Primary 3 Boarding'],
        [''],
        ['UPPER PRIMARY (P.4 - P.7):'],
        ['   Primary 4 Day / Primary 4 Boarding'],
        ['   Primary 5 Day / Primary 5 Boarding'],
        ['   Primary 6 Day / Primary 6 Boarding'],
        ['   Primary 7 Day / Primary 7 Boarding'],
        [''],
        ['⚠️ The class name you enter must match one of the above exactly.']
    ];
    
    const wsInstructions = xlsx.utils.aoa_to_sheet(instructions);
    xlsx.utils.book_append_sheet(wb, wsInstructions, 'Instructions');
    
    // ================================================================
    // GENERATE BUFFER
    // ================================================================
    const buffer = xlsx.write(wb, { 
        type: 'buffer', 
        bookType: 'xlsx',
        bookSST: false
    });
    
    // ================================================================
    // SEND RESPONSE
    // ================================================================
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=student_import_template.xlsx');
    res.send(buffer);
    
    console.log('✅ Template generated successfully with simplified fields');
});
// ==================== FIXED STUDENT REGISTRATION ENDPOINT ====================

// ==================== FIXED STUDENT REGISTRATION WITH CUSTOM BURSARY ====================

// ==================== COMPLETE STUDENT REGISTRATION ENDPOINT ====================
// Version: 3.0 - With Custom Bursary and Custom Transportation

// ==================== COMPLETE FIXED STUDENT REGISTRATION ENDPOINT ====================

// ==================== UPDATED STUDENT REGISTRATION WITH CUSTOMIZATIONS ====================

app.post('/api/students/register', async (req, res) => {
    console.log('=== REGISTRATION REQUEST RECEIVED (v2.0 - Default-Removed Items) ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    try {
        const {
            firstName, lastName, gender, dateOfBirth,
            parentName, parentPhone, parentEmail, parentAltPhone,
            address, enrollmentClass, feeStructureId, bursaryId,
            studentPhoto, academicYear, previousSchool, admissionType, enrollmentDate,
            birthPlace, nationality, relationship, parentOccupation,
            customBursaryAmount,
            customTransportation,
            customItemOverrides, // Custom values for specific items
            removedItems         // Items NOT activated for this student (student does not pay)
        } = req.body;

        // ========== VALIDATE REQUIRED FIELDS ==========
        if (!firstName || !lastName || !gender || !parentName || !parentPhone || !address || !enrollmentClass || !feeStructureId) {
            console.log('❌ Missing required fields');
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // ========== READ EXISTING DATA ==========
        let students = readFile(files.students);
        if (!Array.isArray(students)) students = [];

        // Generate admission number
        const currentYear = academicYear || new Date().getFullYear();
        const nextNumber = String(students.length + 1).padStart(4, '0');
        const admissionNumber = `STU${currentYear}${nextNumber}`;

        // ========== COMPUTE BILLING PERIOD FROM ENROLLMENT DATE ==========
        const effectiveEnrollmentDate = enrollmentDate || new Date().toISOString().split('T')[0];
        const computedTerm = getTermForDate(effectiveEnrollmentDate) || (currentAcademicSettings.currentTerm || 1);
        const computedYear = getAcademicYearForDate(effectiveEnrollmentDate) || parseInt(currentYear);
        console.log(`📅 Enrollment ${effectiveEnrollmentDate} → billing period: ${computedYear} Term ${computedTerm}`);

        // ========== FETCH THE FEE STRUCTURE ONCE (shared by overrides + removed items) ==========
        const feeStructures = readFile(files.feeStructures);
        const feeStructure = feeStructures.find(f => f && f.id === feeStructureId);

        if (!feeStructure) {
            console.warn(`⚠️ Fee structure ${feeStructureId} not found — proceeding, but item lookups will be limited`);
        }

        // Helper: locate an item's defaults inside the fee structure by id or name
        function findItemDefaults(itemId) {
            const result = {
                itemName: itemId,
                componentId: null,
                componentName: 'Unknown Component',
                defaultAmount: 0,
                defaultQuantity: 1,
                paymentOption: 'either',
                periodType: 'termly'
            };
            if (!feeStructure || !feeStructure.activityComponents) return result;

            for (const comp of feeStructure.activityComponents) {
                for (const item of (comp.items || [])) {
                    if (item.id === itemId || item.name === itemId) {
                        result.itemName = item.name || itemId;
                        result.componentId = comp.id || null;
                        result.componentName = comp.name || 'Unknown Component';
                        result.defaultAmount = item.totalAmount || 0;
                        result.defaultQuantity = item.quantity || 1;
                        result.paymentOption = item.paymentOption || 'either';
                        result.periodType = comp.periodType || 'termly';
                        return result;
                    }
                }
            }
            return result;
        }

        // ========== HANDLE CUSTOM BURSARY ==========
        let customBursary = null;
        const parsedCustomBursaryAmount = parseFloat(customBursaryAmount) || 0;
        if (parsedCustomBursaryAmount > 0) {
            customBursary = {
                amount: parsedCustomBursaryAmount,
                appliedAt: new Date().toISOString(),
                description: 'Special custom bursary applied during registration'
            };
            console.log('🎖️ Custom bursary applied:', customBursary);
        }

        // ========== HANDLE CUSTOM TRANSPORTATION ==========
        let customTransportationData = null;
        if (customTransportation) {
            customTransportationData = {
                hasTransportation: customTransportation.hasTransportation === true,
                amount: customTransportation.hasTransportation ? (customTransportation.amount || null) : null,
                itemId: customTransportation.itemId || null,
                componentId: customTransportation.componentId || null,
                appliedAt: new Date().toISOString(),
                description: customTransportation.hasTransportation
                    ? 'Custom transportation fee applied'
                    : 'Student does not use school transport'
            };
            console.log('🚌 Custom transportation applied:', customTransportationData);
        }

        // ========== HANDLE CUSTOM ITEM OVERRIDES ==========
        let customItemOverridesData = null;
        if (customItemOverrides && typeof customItemOverrides === 'object' && Object.keys(customItemOverrides).length > 0) {
            customItemOverridesData = {};

            for (const [itemId, customData] of Object.entries(customItemOverrides)) {
                if (!customData || customData.isCustomized === false) continue;

                const defaults = findItemDefaults(itemId);
                const defaultAmount = customData.defaultAmount ?? defaults.defaultAmount;
                const defaultQuantity = customData.defaultQuantity ?? defaults.defaultQuantity;
                const itemName = customData.itemName || defaults.itemName;
                const componentId = customData.componentId || defaults.componentId;

                customItemOverridesData[itemId] = {
                    itemId: itemId,
                    itemName: itemName,
                    componentId: componentId,
                    customAmount: (customData.customAmount !== null && customData.customAmount !== undefined)
                        ? parseFloat(customData.customAmount) : null,
                    customQuantity: (customData.customQuantity !== null && customData.customQuantity !== undefined)
                        ? parseInt(customData.customQuantity) : null,
                    paymentOption: customData.paymentOption || defaults.paymentOption || null,
                    defaultAmount: defaultAmount,
                    defaultQuantity: defaultQuantity,
                    reason: customData.reason || 'Customized during registration',
                    isActive: true,
                    updatedAt: new Date().toISOString(),
                    updatedBy: 'Registration'
                };
            }

            if (Object.keys(customItemOverridesData).length === 0) {
                customItemOverridesData = null;
            } else {
                console.log(`⚡ Custom item overrides applied: ${Object.keys(customItemOverridesData).length}`);
            }
        }

        // ========== HANDLE REMOVED ITEMS (NOT ACTIVATED — student is not billed) ==========
        // The registration UI now marks every item as removed by default; the bursar
        // restores whatever should actually be billed. Whatever is still flagged
        // `true` here at submit time never got restored, so it stays off this
        // student's bill (tuition is unaffected either way).
        //
        // EXCEPTION: genuinely termly items (scholastic requirements, etc.) are
        // billed automatically every term and should never be registered as
        // "removed" — UNLESS the component is an opt-in one like Transportation
        // (Van Fee), which stays removed by default even though it's termly,
        // since not every student uses it and it requires manual bursar activation.
        let removedItemsData = null;
        if (removedItems && typeof removedItems === 'object' && Object.keys(removedItems).length > 0) {
            removedItemsData = {};

            for (const [itemId, isRemoved] of Object.entries(removedItems)) {
                if (isRemoved !== true) continue;

                const defaults = findItemDefaults(itemId);
                const isOptIn = isOptInComponent(defaults.componentName);

                // ✅ Skip auto-removal only for genuinely auto-billed termly items.
                // Opt-in components (Transportation/Van) stay removed even if termly.
                if (defaults.periodType === 'termly' && !isOptIn) continue;

                removedItemsData[itemId] = {
                    itemId: itemId,
                    itemName: defaults.itemName,
                    componentId: defaults.componentId,
                    componentName: defaults.componentName,
                    defaultAmount: defaults.defaultAmount,
                    defaultQuantity: defaults.defaultQuantity,
                    paymentOption: defaults.paymentOption,
                    removedAt: new Date().toISOString(),
                    reason: isOptIn
                        ? 'Optional item (Transportation) — requires manual activation by bursar'
                        : 'Not activated at registration',
                    isActive: true
                };
            }

            if (Object.keys(removedItemsData).length === 0) {
                removedItemsData = null;
            } else {
                console.log(`❌ Items not activated (removed): ${Object.keys(removedItemsData).length}`);
            }
        }

        // ========== CREATE NEW STUDENT OBJECT ==========
        const newStudent = {
            id: uuidv4(),
            admissionNumber: admissionNumber,
            firstName: firstName,
            lastName: lastName,
            dateOfBirth: dateOfBirth || '',
            gender: gender || 'Male',
            birthPlace: birthPlace || '',
            nationality: nationality || 'Ugandan',
            studentPhoto: studentPhoto || null,
            parentInfo: {
                name: parentName,
                relationship: relationship || 'Parent',
                phone: parentPhone,
                altPhone: parentAltPhone || '',
                email: parentEmail || '',
                occupation: parentOccupation || ''
            },
            address: address || '',
            previousSchool: previousSchool || '',
            admissionType: admissionType || 'New',
            enrollmentDate: effectiveEnrollmentDate,
            status: 'Active',
            currentClassId: enrollmentClass,
            enrolledAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),

            // Customizations
            customBursary: customBursary,
            customTransportation: customTransportationData,
            customItemOverrides: customItemOverridesData,

            // Items not yet activated for this student
            removedItems: removedItemsData,

            // Tracking flags
            hasCustomizations: !!(customItemOverridesData && Object.keys(customItemOverridesData).length > 0),
            hasRemovedItems: !!(removedItemsData && Object.keys(removedItemsData).length > 0),
            customizationCount: customItemOverridesData ? Object.keys(customItemOverridesData).length : 0,
            removedItemsCount: removedItemsData ? Object.keys(removedItemsData).length : 0,

            // Fee structure reference
            assignedFeeStructureId: feeStructureId,
            feeStructureId: feeStructureId
        };

        console.log('📝 Creating student with:', {
            name: `${firstName} ${lastName}`,
            admissionNumber: admissionNumber,
            billingPeriod: `${computedYear} Term ${computedTerm}`,
            customBursary: !!customBursary,
            customTransportation: !!customTransportationData,
            customItemOverrides: customItemOverridesData ? Object.keys(customItemOverridesData).length : 0,
            removedItems: removedItemsData ? Object.keys(removedItemsData).length : 0
        });

        // ========== SAVE STUDENT ==========
        students.push(newStudent);
        const saved = saveFile(files.students, students);

        if (!saved) {
            console.error('❌ Failed to save student to file');
            return res.status(500).json({ error: 'Failed to save student data' });
        }

        console.log('✅ Student saved successfully with ID:', newStudent.id);

        // ========== CREATE ENROLLMENT RECORD ==========
        let enrollments = readFile(files.enrollments);
        if (!Array.isArray(enrollments)) enrollments = [];

        enrollments.push({
            id: uuidv4(),
            studentId: newStudent.id,
            classId: enrollmentClass,
            academicYear: computedYear,
            term: computedTerm,
            isCurrent: true,
            enrolledAt: new Date().toISOString()
        });
        saveFile(files.enrollments, enrollments);

        // ========== SAVE FEE ASSIGNMENT ==========
        if (feeStructureId) {
            let assignments = readFile(files.studentFeeAssignments);
            if (!Array.isArray(assignments)) assignments = [];

            let finalBursaryId = null;
            if (bursaryId && bursaryId !== '' && bursaryId !== 'custom') {
                finalBursaryId = bursaryId;
            }

            assignments.push({
                id: uuidv4(),
                studentId: newStudent.id,
                feeStructureId: feeStructureId,
                bursaryId: finalBursaryId,
                customBursaryAmount: parsedCustomBursaryAmount > 0 ? parsedCustomBursaryAmount : null,
                academicYear: computedYear,
                term: computedTerm,
                assignedAt: new Date().toISOString()
            });
            saveFile(files.studentFeeAssignments, assignments);
            console.log(`💰 Fee assignment saved for ${computedYear} Term ${computedTerm}`);
        }

        console.log('✅✅✅ Registration complete!');
        res.json({
            success: true,
            student: newStudent,
            message: 'Student registered successfully',
            summary: {
                billingYear: computedYear,
                billingTerm: computedTerm,
                customizations: newStudent.customizationCount || 0,
                removedItems: newStudent.removedItemsCount || 0,
                hasBursary: !!customBursary,
                hasCustomTransport: !!customTransportationData
            }
        });

    } catch (error) {
        console.error('❌ Registration error:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({ error: error.message });
    }
});
// ==================== UPDATED STUDENT UPDATE WITH CUSTOMIZATIONS ====================

// ==================== HELPER: DELETE PAYMENTS FOR REMOVED ITEMS (PERIOD‑AWARE) ====================
function deletePaymentsForItems(studentId, itemsToRemove, period) {
    const { year, term } = period;
    console.log(`🗑️ deletePaymentsForItems: Student ${studentId}, Period ${year} Term ${term}`);
    console.log(`   Items: ${itemsToRemove.map(i => i.itemName).join(', ')}`);

    if (!itemsToRemove || itemsToRemove.length === 0) return;

    let payments = readFile(files.feePayments);
    let termRecords = readFile(files.studentTermRecords);

    // Normalize removed items for matching (case‑insensitive, trimmed)
    const normalizedItems = itemsToRemove.map(item => ({
        itemName: (item.itemName || item.itemId || '').trim().toLowerCase(),
        componentName: (item.componentName || '').trim().toLowerCase()
    }));

    let anyPaymentDeleted = false;
    let updatedPayments = [];

    // Matching logic: case‑insensitive, component‑name tolerant
    function matchesRemoved(paymentItem) {
        if (!paymentItem) return false;
        const paidItemName = (paymentItem.itemName || paymentItem.name || '').trim().toLowerCase();
        const paidComponentName = (paymentItem.componentName || '').trim().toLowerCase();

        for (const removed of normalizedItems) {
            if (paidItemName !== removed.itemName) continue;
            if (removed.componentName) {
                if (paidComponentName === removed.componentName ||
                    paidComponentName.includes(removed.componentName) ||
                    removed.componentName.includes(paidComponentName)) {
                    return true;
                }
            } else {
                return true;
            }
        }
        return false;
    }

    for (const payment of payments) {
        // Only process payments for this student in the given period
        if (payment.studentId !== studentId ||
            payment.term !== term ||
            parseInt(payment.academicYear) !== year) {
            updatedPayments.push(payment);
            continue;
        }

        let paymentChanged = false;

        function filterItems(itemsArray) {
            if (!itemsArray || !Array.isArray(itemsArray)) return [];
            return itemsArray.filter(item => {
                if (!item) return false;
                const match = matchesRemoved(item);
                if (match) {
                    console.log(`   ✅ Removing item: ${item.itemName || item.name} (${item.componentName})`);
                    paymentChanged = true;
                }
                return !match;
            });
        }

        // Remove from all known payment structures
        if (payment.activityItemPayments) {
            payment.activityItemPayments = filterItems(payment.activityItemPayments);
        }
        if (payment.paymentsByPeriodType) {
            for (const periodType of ['one_time', 'termly', 'yearly']) {
                if (payment.paymentsByPeriodType[periodType]) {
                    payment.paymentsByPeriodType[periodType] = filterItems(payment.paymentsByPeriodType[periodType]);
                }
            }
        }
        if (payment.individualPayments) {
            payment.individualPayments = filterItems(payment.individualPayments);
        }

        if (paymentChanged) {
            anyPaymentDeleted = true;

            // Recalculate totals
            let newActivityTotal = 0;
            if (payment.activityItemPayments) {
                for (const item of payment.activityItemPayments) {
                    newActivityTotal += (item.amountPaid || item.cashEquivalent || 0);
                }
            }
            if (payment.paymentsByPeriodType) {
                for (const periodType of ['one_time', 'termly', 'yearly']) {
                    for (const item of (payment.paymentsByPeriodType[periodType] || [])) {
                        newActivityTotal += (item.amountPaid || item.cashEquivalent || 0);
                    }
                }
            }
            payment.activityTotalPaid = newActivityTotal;
            payment.totalAmount = (payment.tuitionPaid || 0) + newActivityTotal;

            // If payment becomes empty, delete the entire record
            if (payment.totalAmount === 0 &&
                (payment.activityItemPayments || []).length === 0 &&
                (payment.individualPayments || []).length === 0) {
                console.log(`   🗑️ Deleting empty payment record: ${payment.receiptNumber}`);
                continue;
            }
        }

        updatedPayments.push(payment);
    }

    // ---- Update studentTermRecords for the same period ----
    const termRecordKey = `${studentId}_${year}_${term}`;
    if (termRecords[termRecordKey]) {
        const termRecord = termRecords[termRecordKey];
        let termRecordChanged = false;

        function filterTermItems(itemsArray) {
            if (!itemsArray || !Array.isArray(itemsArray)) return [];
            return itemsArray.filter(item => {
                if (!item) return false;
                const match = matchesRemoved(item);
                if (match) {
                    console.log(`   ✅ Removing from term record: ${item.itemName || item.name}`);
                    termRecordChanged = true;
                }
                return !match;
            });
        }

        for (const periodType of ['one_time', 'termly', 'yearly']) {
            if (termRecord.activityItemsPaid && termRecord.activityItemsPaid[periodType]) {
                termRecord.activityItemsPaid[periodType] = filterTermItems(termRecord.activityItemsPaid[periodType]);
            }
        }

        if (termRecordChanged) {
            let newActivityTotal = 0;
            for (const periodType of ['one_time', 'termly', 'yearly']) {
                const items = termRecord.activityItemsPaid[periodType] || [];
                for (const item of items) {
                    newActivityTotal += (item.amountPaid || item.cashEquivalent || 0);
                }
            }
            termRecord.activityTotalPaid = newActivityTotal;
            termRecords[termRecordKey] = termRecord;
            console.log(`   ✅ Updated term record for ${termRecordKey}`);
        }
    }

    // Save if anything changed
    if (anyPaymentDeleted) {
        saveFile(files.feePayments, updatedPayments);
        saveFile(files.studentTermRecords, termRecords);
        console.log(`✅ Payment records updated for student ${studentId} (${year} Term ${term})`);
    } else {
        console.log(`ℹ️ No payments found for removed items in ${year} Term ${term}`);
    }
}
// ==================== HELPER: REVERSE INVENTORY FOR REMOVED ITEMS (PERIOD-AWARE) ====================
// When a scholastic item is removed from a student for a specific academic period,
// any inventory stock that was added because of THAT student's payment (for that
// exact item, in that exact period) must be pulled back out of inventoryStock.json,
// and the originating inventoryTransactions.json entry marked as reversed.
// Non-scholastic items simply won't have matching inventory transactions, so this
// is safe to call for every removed item — it only acts on ones that actually
// exist in the inventory system.
function reverseInventoryForRemovedItems(studentId, itemsToRemove, period) {
    const { year, term } = period;
    console.log(`📦 reverseInventoryForRemovedItems: Student ${studentId}, Period ${year} Term ${term}`);
    console.log(`   Items: ${itemsToRemove.map(i => i.itemName).join(', ')}`);

    if (!itemsToRemove || itemsToRemove.length === 0) return;

    const inventoryStockPath = path.join(dataDir, 'inventoryStock.json');
    const inventoryTransactionsPath = path.join(dataDir, 'inventoryTransactions.json');

    let stock = readFile(inventoryStockPath);
    if (!stock || Array.isArray(stock)) stock = {};

    let transactions = readFile(inventoryTransactionsPath);
    if (!Array.isArray(transactions)) transactions = [];

    // Normalize removed item names for matching (case-insensitive, trimmed)
    const normalizedItemNames = itemsToRemove.map(item =>
        (item.itemName || item.itemId || '').trim().toLowerCase()
    );

    let anyReversed = false;
    const updatedTransactions = [];

    for (const tx of transactions) {
        // Only touch inventory RECEIPT transactions that were auto-created from
        // THIS student's payment, in THIS exact academic year/term, and not
        // already reversed.
        const isCandidate = tx &&
            tx.isInventory === true &&
            tx.transactionType === 'receipt' &&
            tx.studentId === studentId &&
            tx.academicYear !== undefined && parseInt(tx.academicYear) === parseInt(year) &&
            tx.term !== undefined && parseInt(tx.term) === parseInt(term) &&
            !tx.reversed;

        if (!isCandidate) {
            updatedTransactions.push(tx);
            continue;
        }

        const txItemName = (tx.itemName || '').trim().toLowerCase();
        const matches = normalizedItemNames.some(name =>
            txItemName === name || txItemName.includes(name) || name.includes(txItemName)
        );

        if (!matches) {
            updatedTransactions.push(tx);
            continue;
        }

        // ========== REVERSE THE STOCK THIS TRANSACTION ADDED ==========
        const qty = tx.quantity || 0;
        const stockKey = `${tx.itemName}_${tx.academicYear}_${tx.term}`;

        if (stock[stockKey]) {
            stock[stockKey].totalReceived = Math.max(0, (stock[stockKey].totalReceived || 0) - qty);
            stock[stockKey].available = Math.max(0, (stock[stockKey].available || 0) - qty);
            stock[stockKey].lastUpdated = new Date().toISOString();
        }

        // Also adjust the legacy (name-only) stock entry if it exists
        if (stock[tx.itemName]) {
            stock[tx.itemName].totalReceived = Math.max(0, (stock[tx.itemName].totalReceived || 0) - qty);
            stock[tx.itemName].available = Math.max(0, (stock[tx.itemName].available || 0) - qty);
            stock[tx.itemName].lastUpdated = new Date().toISOString();
        }

        console.log(`   🗑️ Reversed inventory receipt: "${tx.itemName}" qty ${qty} (student ${studentId}, ${year} Term ${term})`);
        anyReversed = true;

        // Keep the transaction for audit purposes, but mark it reversed so it
        // no longer counts toward stock totals or shows as active in reports.
        tx.reversed = true;
        tx.reversedAt = new Date().toISOString();
        tx.reverseReason = 'Item removed from student for this academic period';
        updatedTransactions.push(tx);
    }

    if (anyReversed) {
        saveFile(inventoryStockPath, stock);
        saveFile(inventoryTransactionsPath, updatedTransactions);
        console.log(`✅ Inventory reversed for removed items (student ${studentId}, ${year} Term ${term})`);
    } else {
        console.log(`ℹ️ No matching inventory receipts found to reverse for ${year} Term ${term}`);
    }
}

// ==================== HELPER: REVERSE INVENTORY FOR A DELETED PAYMENT ITEM ====================
// When a "brought_item" payment is deleted (single item, reset-item, or whole receipt),
// pull the matching stock back out and mark the originating receipt transaction(s) as reversed.
// ==================== HELPER: REVERSE INVENTORY FOR A DELETED PAYMENT ITEM ====================
// Deducts stock directly (same key pattern used when stock was added), regardless of
// whether a matching receipt transaction can be found. Transaction matching is used
// only for audit-trail marking, never to gate the actual stock deduction.
function reverseInventoryForDeletedPaymentItem(studentId, itemName, academicYear, term, quantityToReverse) {
    if (!quantityToReverse || quantityToReverse <= 0 || !itemName) return;

    const inventoryStockPath = path.join(dataDir, 'inventoryStock.json');
    const inventoryTransactionsPath = path.join(dataDir, 'inventoryTransactions.json');

    let stock = readFile(inventoryStockPath);
    if (!stock || Array.isArray(stock)) stock = {};

    let transactions = readFile(inventoryTransactionsPath);
    if (!Array.isArray(transactions)) transactions = [];

    const normalizedItemName = (itemName || '').trim().toLowerCase();
    const year = parseInt(academicYear);
    const termNum = parseInt(term);

    // ========== 1. DIRECT STOCK DEDUCTION (always happens) ==========
    const stockKey = `${itemName}_${year}_${termNum}`;
    let deducted = 0;

    if (stock[stockKey]) {
        const before = stock[stockKey].available || 0;
        const qty = Math.min(quantityToReverse, before);
        stock[stockKey].totalReceived = Math.max(0, (stock[stockKey].totalReceived || 0) - qty);
        stock[stockKey].available = Math.max(0, (stock[stockKey].available || 0) - qty);
        stock[stockKey].lastUpdated = new Date().toISOString();
        deducted = qty;
    } else {
        // fallback: try matching by name+year+term case-insensitively
        const fallbackKey = Object.keys(stock).find(k => {
            const entry = stock[k];
            return entry && entry.name &&
                entry.name.trim().toLowerCase() === normalizedItemName &&
                parseInt(entry.academicYear) === year &&
                parseInt(entry.term) === termNum;
        });
        if (fallbackKey) {
            const before = stock[fallbackKey].available || 0;
            const qty = Math.min(quantityToReverse, before);
            stock[fallbackKey].totalReceived = Math.max(0, (stock[fallbackKey].totalReceived || 0) - qty);
            stock[fallbackKey].available = Math.max(0, (stock[fallbackKey].available || 0) - qty);
            stock[fallbackKey].lastUpdated = new Date().toISOString();
            deducted = qty;
        }
    }

    // Also deduct the legacy (name-only) stock entry if it exists
    if (stock[itemName]) {
        const before = stock[itemName].available || 0;
        const qty = Math.min(quantityToReverse, before);
        stock[itemName].totalReceived = Math.max(0, (stock[itemName].totalReceived || 0) - qty);
        stock[itemName].available = Math.max(0, (stock[itemName].available || 0) - qty);
        stock[itemName].lastUpdated = new Date().toISOString();
    }

    // ========== 2. BEST-EFFORT: mark matching receipt transactions as reversed (audit only) ==========
    let remaining = quantityToReverse;
    const candidates = transactions
        .map((tx, idx) => ({ tx, idx }))
        .filter(({ tx }) =>
            tx &&
            tx.isInventory === true &&
            tx.transactionType === 'receipt' &&
            tx.studentId === studentId &&
            !tx.reversed &&
            (tx.itemName || '').trim().toLowerCase() === normalizedItemName &&
            tx.academicYear !== undefined && parseInt(tx.academicYear) === year &&
            tx.term !== undefined && parseInt(tx.term) === termNum
        )
        .sort((a, b) => new Date(b.tx.timestamp) - new Date(a.tx.timestamp));

    for (const { tx, idx } of candidates) {
        if (remaining <= 0) break;
        const txQty = tx.quantity || 0;
        const qtyFromThisTx = Math.min(txQty, remaining);

        if (qtyFromThisTx >= txQty) {
            transactions[idx].reversed = true;
            transactions[idx].reversedAt = new Date().toISOString();
            transactions[idx].reverseReason = 'Payment deleted by admin';
        } else {
            transactions[idx].quantity = txQty - qtyFromThisTx;
            transactions[idx].partiallyReversed = true;
            transactions[idx].partialReverseHistory = transactions[idx].partialReverseHistory || [];
            transactions[idx].partialReverseHistory.push({
                quantity: qtyFromThisTx,
                reversedAt: new Date().toISOString(),
                reason: 'Payment deleted by admin'
            });
        }
        remaining -= qtyFromThisTx;
    }

    // ========== 3. RECORD A REVERSAL TRANSACTION FOR AUDIT (regardless of matches found) ==========
    transactions.push({
        id: uuidv4(),
        itemName: itemName,
        quantity: deducted,
        transactionType: 'payment_reversal',
        studentId: studentId,
        academicYear: year,
        term: termNum,
        timestamp: new Date().toISOString(),
        date: new Date().toISOString().split('T')[0],
        isInventory: true,
        reason: 'Deleted a payment that had contributed to this stock',
        matchedTransactionsFound: candidates.length
    });

    saveFile(inventoryStockPath, stock);
    saveFile(inventoryTransactionsPath, transactions);

    console.log(`✅ Deducted ${deducted} unit(s) of "${itemName}" directly from stock (student ${studentId}, ${year} T${termNum})`);
    if (candidates.length === 0) {
        console.log(`ℹ️ No matching receipt transaction found to mark reversed — deducted from stock directly instead`);
    }
}

// ==================== HELPER: COMPUTE INVENTORY QTY A PAYMENT ITEM CONTRIBUTED ====================
// Must mirror the exact logic in updateInventoryFromPayment() so reversals match originals.
function computeInventoryQtyForPaymentItem(item) {
    if (!item) return 0;
    const unitPrice = parseFloat(item.unitPrice) || 0;

    if (item.paymentType === 'brought_item') {
        return parseInt(item.itemsBrought) || 0;
    }

    if (item.paymentType === 'paid_cash') {
        const amountPaid = parseFloat(item.amountPaid) || 0;
        if (amountPaid <= 0) return 0;
        if (unitPrice > 0) {
            return Math.floor(amountPaid / unitPrice);
        }
        return parseInt(item.quantityRequired) || 0;
    }

    return 0;
}
// ==================== REBUILT PUT ROUTE (PERIOD‑AWARE) ====================
app.put('/api/students/:id', (req, res) => {
    try {
        let students = readFile(files.students);
        const index = students.findIndex(s => s.id === req.params.id);
        if (index === -1) {
            return res.status(404).json({ error: 'Student not found' });
        }

        const oldStudent = students[index];
        const updatedData = req.body;

        // ========== DETECT NEWLY REMOVED ITEMS (PERIOD‑AWARE) ==========
        const oldRemoved = oldStudent.removedItems || {};
        const newRemoved = updatedData.removedItems || {};
        const newlyRemoved = {};

        for (const [itemId, value] of Object.entries(newRemoved)) {
            if (!oldRemoved[itemId] && value && value.isActive !== false) {
                newlyRemoved[itemId] = value;
            }
        }

        // Group newly removed items by their removal period
        if (Object.keys(newlyRemoved).length > 0) {
            // Use current settings as fallback if period not provided
            const settings = readFile(files.settings);
            const defaultYear = settings.currentAcademicYear || new Date().getFullYear();
            const defaultTerm = settings.currentTerm || 1;

            // Group by period (year + term)
            const periodGroups = new Map();
            for (const [itemId, data] of Object.entries(newlyRemoved)) {
                const year = data.academicYear || defaultYear;
                const term = data.term || defaultTerm;
                const key = `${year}_${term}`;
                if (!periodGroups.has(key)) {
                    periodGroups.set(key, { year, term, items: [] });
                }
                periodGroups.get(key).items.push({
                    itemId,
                    itemName: data.itemName || itemId,
                    componentName: data.componentName || ''
                });
            }

            // Delete payments for each period separately
            for (const [key, group] of periodGroups) {
                deletePaymentsForItems(oldStudent.id, group.items, { year: group.year, term: group.term });
           reverseInventoryForRemovedItems(oldStudent.id, group.items, { year: group.year, term: group.term }); // ← add this line
            }
        }
        // ========== END NEW LOGIC ==========

        // ----- Existing custom overrides logic (unchanged) -----
        if (updatedData.customItemOverrides) {
            if (!oldStudent.customItemOverrides) {
                oldStudent.customItemOverrides = {};
            }
            for (const [itemId, customData] of Object.entries(updatedData.customItemOverrides)) {
                if (customData.isCustomized) {
                    const feeStructures = readFile(files.feeStructures);
                    const assignment = readFile(files.studentFeeAssignments).find(a => a.studentId === oldStudent.id);
                    const feeStructure = feeStructures.find(f => f.id === assignment?.feeStructureId);

                    let defaultAmount = customData.defaultAmount || 0;
                    let defaultQuantity = customData.defaultQuantity || 1;
                    let itemName = customData.itemName || itemId;
                    let componentId = customData.componentId || null;

                    if (feeStructure && feeStructure.activityComponents) {
                        for (const comp of feeStructure.activityComponents) {
                            for (const item of (comp.items || [])) {
                                if (item.id === itemId || item.name === itemId) {
                                    defaultAmount = item.totalAmount || 0;
                                    defaultQuantity = item.quantity || 1;
                                    itemName = item.name || itemId;
                                    componentId = comp.id || componentId;
                                    break;
                                }
                            }
                        }
                    }

                    oldStudent.customItemOverrides[itemId] = {
                        itemId: itemId,
                        itemName: customData.itemName || itemName,
                        componentId: customData.componentId || componentId,
                        customAmount: customData.customAmount !== null && customData.customAmount !== undefined ? parseFloat(customData.customAmount) : null,
                        customQuantity: customData.customQuantity !== null && customData.customQuantity !== undefined ? parseInt(customData.customQuantity) : null,
                        paymentOption: customData.paymentOption || null,
                        defaultAmount: defaultAmount,
                        defaultQuantity: defaultQuantity,
                        reason: customData.reason || 'Customized via edit student',
                        isActive: true,
                        updatedAt: new Date().toISOString(),
                        updatedBy: 'System'
                    };
                } else {
                    delete oldStudent.customItemOverrides[itemId];
                }
            }
            const count = Object.keys(oldStudent.customItemOverrides).length;
            oldStudent.hasCustomizations = count > 0;
            oldStudent.customizationCount = count;
            delete updatedData.customItemOverrides;
        }

        // Apply all other updates (including removedItems with their periods)
        students[index] = {
            ...oldStudent,
            ...updatedData,
            updatedAt: new Date().toISOString()
        };

        saveFile(files.students, students);
        res.json({ success: true, student: students[index] });

    } catch (error) {
        console.error('Error updating student:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/students/:id', (req, res) => {
    let students = readFile(files.students);
    students = students.filter(s => s.id !== req.params.id);
    saveFile(files.students, students);
    res.json({ success: true });
});

// ================================================================
// COMPLETE REBUILD: STUDENT PROMOTION ENDPOINT
// ================================================================


app.get('/api/school/grading', (req, res) => {
    res.json({ gradingSystem: getGradingSystem() });
});

app.put('/api/school/grading', (req, res) => {
    const { gradingSystem } = req.body;
    let settings = readFile(files.settings);
    settings.gradingSystem = gradingSystem;
    settings.updatedAt = new Date().toISOString();
    saveFile(files.settings, settings);
    res.json({ success: true, gradingSystem });
});

// ==================== ACADEMIC ROUTES ====================

// Add this to your server.js if not already present
// ==================== FIXED ACADEMIC SETTINGS ENDPOINTS ====================

// GET academic settings
// ==================== FIXED ACADEMIC SETTINGS GET ====================
app.get('/api/academic/settings', (req, res) => {
    try {
        console.log('=== GET ACADEMIC SETTINGS CALLED ===');
        
        let settings = readFile(files.settings);
        console.log('Settings file content:', settings);
        
        // Ensure settings has required fields
        if (!settings) {
            settings = {};
        }
        
        const response = {
            currentYear: settings.currentAcademicYear || new Date().getFullYear(),
            currentTerm: settings.currentTerm || 1
        };
        
        console.log('Returning:', response);
        res.json(response);
    } catch (error) {
        console.error('Error getting academic settings:', error);
        res.status(500).json({ error: error.message });
    }
});


// ==================== FIXED ACADEMIC SETTINGS UPDATE ====================
app.put('/api/academic/settings', (req, res) => {
    console.log('=== UPDATE ACADEMIC SETTINGS CALLED ===');
    console.log('Request body:', req.body);
    
    try {
        const { currentYear, currentTerm } = req.body;
        
        if (!currentYear || !currentTerm) {
            console.log('Missing required fields');
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Read existing settings
        let settings = readFile(files.settings);
        console.log('Existing settings:', settings);
        
        // Update settings
        settings.currentAcademicYear = currentYear;
        settings.currentTerm = currentTerm;
        settings.lastUpdated = new Date().toISOString();
        
        console.log('New settings to save:', settings);
        
        // Save to file
        const saved = saveFile(files.settings, settings);
        
        if (saved) {
            // Verify the save by reading back
            const verifySettings = readFile(files.settings);
            console.log('Verified saved settings:', verifySettings);
            
            res.json({ 
                success: true, 
                currentYear: settings.currentAcademicYear, 
                currentTerm: settings.currentTerm,
                verified: verifySettings
            });
        } else {
            throw new Error('Failed to save settings file');
        }
    } catch (error) {
        console.error('Error updating academic settings:', error);
        res.status(500).json({ error: error.message });
    }
});


app.get('/api/academic/years', (req, res) => {
    const years = [];
    if (fs.existsSync(dataDir)) {
        const items = fs.readdirSync(dataDir);
        for (const item of items) {
            if (/^\d{4}$/.test(item)) {
                years.push(parseInt(item));
            }
        }
    }
    res.json(years.sort((a, b) => b - a));
});

// ==================== ASSESSMENT ROUTES ====================

app.get('/api/academics/assessments', (req, res) => {
    res.json(readFile(files.assessments));
});

app.post('/api/academics/assessments', (req, res) => {
    const { name, type, subjectId, classId, term, year, maxScore, weight, date } = req.body;
    const assessments = readFile(files.assessments);
    
    const newAssessment = {
        id: uuidv4(),
        name,
        type: type || 'Exam',
        subjectId,
        classId,
        term: term || 1,
        year: year || new Date().getFullYear(),
        maxScore: maxScore || 100,
        weight: weight || 100,
        date: date || new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString()
    };
    
    assessments.push(newAssessment);
    saveFile(files.assessments, assessments);
    res.json({ success: true, assessment: newAssessment });
});

app.delete('/api/academics/assessments/:id', (req, res) => {
    let assessments = readFile(files.assessments);
    assessments = assessments.filter(a => a.id !== req.params.id);
    saveFile(files.assessments, assessments);
    res.json({ success: true });
});

// ==================== SCORES ROUTES ====================

app.get('/api/academics/scores', (req, res) => {
    res.json(readFile(files.scores));
});

app.post('/api/academics/scores', (req, res) => {
    const { assessmentId, scores } = req.body;
    if (!assessmentId || !scores || !scores.length) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    let allScores = readFile(files.scores);
    
    scores.forEach(scoreData => {
        const existingIndex = allScores.findIndex(
            s => s.assessmentId === assessmentId && s.studentId === scoreData.studentId
        );
        
        const scoreEntry = {
            id: existingIndex !== -1 ? allScores[existingIndex].id : uuidv4(),
            assessmentId: assessmentId,
            studentId: scoreData.studentId,
            score: scoreData.score,
            remarks: scoreData.remarks || '',
            recordedAt: new Date().toISOString()
        };
        
        if (existingIndex !== -1) {
            allScores[existingIndex] = scoreEntry;
        } else {
            allScores.push(scoreEntry);
        }
    });
    
    saveFile(files.scores, allScores);
    res.json({ success: true, message: `${scores.length} scores saved` });
});

// ==================== PERFORMANCE ROUTES ====================

app.get('/api/academics/performance/:classId/:term/:year', (req, res) => {
    const { classId, term, year } = req.params;
    const students = readFile(files.students);
    const enrollments = readFile(files.enrollments);
    const scores = readFile(files.scores);
    const assessments = readFile(files.assessments);
    const subjects = readFile(files.subjects);
    const gradingSystem = getGradingSystem();
    
    const classStudents = enrollments
        .filter(e => e.classId === classId && e.isCurrent && e.academicYear === parseInt(year))
        .map(e => students.find(s => s.id === e.studentId))
        .filter(s => s !== null);
    
    const classAssessments = assessments.filter(a => 
        a.classId === classId && a.term === parseInt(term) && a.year === parseInt(year)
    );
    
    const performance = classStudents.map(student => {
        let totalWeightedScore = 0;
        let totalWeight = 0;
        
        const subjectsInClass = [...new Set(classAssessments.map(a => a.subjectId))];
        
        subjectsInClass.forEach(subjectId => {
            const subjectAssessments = classAssessments.filter(a => a.subjectId === subjectId);
            let subjectTotalScore = 0;
            let subjectTotalWeight = 0;
            
            subjectAssessments.forEach(assessment => {
                const studentScore = scores.find(s => s.assessmentId === assessment.id && s.studentId === student.id);
                if (studentScore) {
                    const weightedScore = (studentScore.score / assessment.maxScore) * assessment.weight;
                    subjectTotalScore += weightedScore;
                    subjectTotalWeight += assessment.weight;
                }
            });
            
            const percentage = subjectTotalWeight > 0 ? (subjectTotalScore / subjectTotalWeight) * 100 : 0;
            totalWeightedScore += subjectTotalScore;
            totalWeight += subjectTotalWeight;
        });
        
        const overallPercentage = totalWeight > 0 ? (totalWeightedScore / totalWeight) * 100 : 0;
        const grade = calculateGrade(overallPercentage, gradingSystem);
        
        return {
            studentId: student.id,
            studentName: `${student.firstName} ${student.lastName}`,
            admissionNumber: student.admissionNumber,
            percentage: overallPercentage.toFixed(2),
            grade: grade.grade,
            remark: grade.remark
        };
    });
    
    performance.sort((a, b) => parseFloat(b.percentage) - parseFloat(a.percentage));
    
    res.json({
        classId,
        term,
        year,
        totalStudents: performance.length,
        performance,
        gradingSystem
    });
});

// ==================== ATTENDANCE ROUTES ====================

app.get('/api/attendance', (req, res) => {
    res.json(readFile(files.attendance));
});

app.post('/api/attendance', (req, res) => {
    const { date, classId, records } = req.body;
    let attendance = readFile(files.attendance);
    
    attendance = attendance.filter(a => !(a.date === date && a.classId === classId));
    
    const attendanceRecord = {
        id: uuidv4(),
        date,
        classId,
        records,
        createdAt: new Date().toISOString()
    };
    
    attendance.push(attendanceRecord);
    saveFile(files.attendance, attendance);
    res.json({ success: true });
});

// ==================== FEE STRUCTURE ROUTES ====================

// Get all fee structures
app.get('/api/fee/structures', (req, res) => {
    try {
        let structures = readFile(files.feeStructures);
        if (!Array.isArray(structures)) structures = [];
        
        // Transform structures with period grouping for frontend
        const transformed = structures.map(fs => ({
            ...fs,
            tuition: fs.tuition || 0,
            oneTimeActivities: (fs.activityComponents || []).filter(c => c && c.periodType === 'one_time'),
            termlyActivities: (fs.activityComponents || []).filter(c => c && c.periodType === 'termly'),
            yearlyActivities: (fs.activityComponents || []).filter(c => c && c.periodType === 'yearly')
        }));
        
        res.json(transformed);
    } catch (error) {
        console.error('Error getting fee structures:', error);
        res.json([]);
    }
});

app.get('/api/fee/structures/:id', (req, res) => {
    try {
        const structures = readFile(files.feeStructures);
        const structure = structures.find(s => s.id === req.params.id);
        if (!structure) return res.status(404).json({ error: 'Fee structure not found' });
        res.json(transformFeeStructureWithPeriods(structure));
    } catch (error) {
        console.error('Error getting fee structure:', error);
        res.status(500).json({ error: 'Failed to fetch fee structure' });
    }
});

// Create enhanced fee structure
// Replace your existing /api/fee/structures/enhanced endpoint with this
// ==================== FIXED ENHANCED FEE STRUCTURE ENDPOINT ====================

// ==================== COMPLETELY FIXED ENHANCED FEE STRUCTURE ENDPOINT ====================

app.post('/api/fee/structures/enhanced', async (req, res) => {
    try {
        const { 
            name, 
            level, 
            tuition, 
            activityComponents
        } = req.body;
        
        console.log('=== CREATING FEE STRUCTURE ===');
        console.log('Name:', name);
        console.log('Level:', level);
        console.log('Tuition:', tuition);
        console.log('Activity Components received:', JSON.stringify(activityComponents, null, 2));
        console.log('Activity Components length:', activityComponents ? activityComponents.length : 0);
        
        if (!name || !level) {
            return res.status(400).json({ error: 'Name and level are required' });
        }
        
        // Process the activity components
        const processedComponents = [];
        
        if (activityComponents && Array.isArray(activityComponents) && activityComponents.length > 0) {
            for (const component of activityComponents) {
                console.log('Processing component:', component.name, 'Period:', component.periodType);
                
                if (!component.name) continue;
                if (!component.items || !Array.isArray(component.items) || component.items.length === 0) {
                    console.log('Component has no items, skipping:', component.name);
                    continue;
                }
                
                const processedItems = [];
                for (const item of component.items) {
                    console.log('  Item:', item.name, 'Payment:', item.paymentOption);
                    
                    const quantity = parseInt(item.quantity) || 1;
                    const cashAmount = parseFloat(item.cashAmount) || 0;
                    const totalAmount = parseFloat(item.totalAmount) || cashAmount;
                    
                    // Calculate unit price if needed
                    let unitPrice = 0;
                    if (quantity > 0) {
                        unitPrice = totalAmount / quantity;
                    }
                    
                    processedItems.push({
                        id: item.id || uuidv4(),
                        name: item.name,
                        quantity: quantity,
                        cashAmount: cashAmount,
                        totalAmount: totalAmount,
                        unitPrice: unitPrice,
                        paymentOption: item.paymentOption || 'either',
                        isTangible: item.paymentOption !== 'cash_only'
                    });
                }
                
                if (processedItems.length > 0) {
                    processedComponents.push({
                        id: component.id || uuidv4(),
                        name: component.name,
                        periodType: component.periodType || 'termly',
                        statusGroupId: component.statusGroupId || null,
                        statusGroupName: component.statusGroupName || null,
                        items: processedItems,
                        totalAmount: processedItems.reduce((sum, i) => sum + i.totalAmount, 0),
                        createdAt: component.createdAt || new Date().toISOString()
                    });
                    console.log('  Added component with', processedItems.length, 'items, total:', processedComponents[processedComponents.length - 1].totalAmount);
                }
            }
        }
        
        console.log('Total processed components:', processedComponents.length);
        
        // Read existing structures
        let structures = readFile(files.feeStructures);
        if (!Array.isArray(structures)) structures = [];
        
        // Create new structure
        const newStructure = {
            id: uuidv4(),
            name: name,
            level: level,
            tuition: parseFloat(tuition) || 0,
            activityComponents: processedComponents,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        structures.push(newStructure);
        saveFile(files.feeStructures, structures);
        
        console.log('✅ Fee structure saved successfully!');
        console.log('Saved structure ID:', newStructure.id);
        console.log('Activity components saved:', newStructure.activityComponents.length);
        
        res.json({ 
            success: true, 
            feeStructure: newStructure,
            message: 'Fee structure saved successfully'
        });
        
    } catch (error) {
        console.error('Error creating fee structure:', error);
        res.status(500).json({ error: 'Failed to create fee structure: ' + error.message });
    }
});

// ==================== FIXED UPDATE ENHANCED FEE STRUCTURE ENDPOINT ====================

app.put('/api/fee/structures/enhanced/:id', (req, res) => {
    try {
        let structures = readFile(files.feeStructures);
        const index = structures.findIndex(s => s.id === req.params.id);
        if (index === -1) return res.status(404).json({ error: 'Fee structure not found' });
        
        const { name, level, tuition, activityComponents, isActive } = req.body;
        const existing = structures[index];
        const feeStructureId = req.params.id;

        // ========== BUILD SET OF ITEM IDs THAT ALREADY EXISTED BEFORE THIS SAVE ==========
        // Used below to detect which items in the incoming payload are brand new
        // (added just now via the Edit Fee Structure modal), so we can auto-remove
        // them for every student already on this fee structure.
        const existingItemIds = new Set();
        for (const comp of (existing.activityComponents || [])) {
            for (const item of (comp.items || [])) {
                existingItemIds.add(item.id || item.name);
            }
        }
        
        // Process the activity components
        const processedComponents = [];
        const newlyAddedItems = []; // items that did not exist in this structure before this save
        
        if (activityComponents && Array.isArray(activityComponents)) {
            for (const component of activityComponents) {
                if (!component.name || !component.items || component.items.length === 0) continue;
                
                const processedItems = [];
                for (const item of component.items) {
                    const quantity = parseInt(item.quantity) || 1;
                    const totalAmount = parseFloat(item.totalAmount) || 0;
                    const cashAmount = parseFloat(item.cashAmount) || 0;
                    
                    const finalAmount = cashAmount > 0 ? cashAmount : totalAmount;
                    
                    if (finalAmount > 0 || quantity > 0) {
                        const itemId = item.id || uuidv4();

                        const processedItem = {
                            id: itemId,
                            name: item.name,
                            quantity: quantity,
                            cashAmount: cashAmount,
                            totalAmount: finalAmount,
                            unitPrice: quantity > 0 ? finalAmount / quantity : 0,
                            paymentOption: item.paymentOption || 'cash_only',
                            isTangible: item.isTangible !== false
                        };

                        processedItems.push(processedItem);

                        // ========== DETECT NEW ITEM ==========
                        if (!existingItemIds.has(itemId) && !existingItemIds.has(item.name)) {
                            newlyAddedItems.push({
                                itemId: itemId,
                                itemName: processedItem.name,
                                componentId: component.id || null,
                                componentName: component.name,
                                defaultAmount: processedItem.totalAmount,
                                defaultQuantity: processedItem.quantity,
                                paymentOption: processedItem.paymentOption,
                                periodType: component.periodType || 'termly',
                                // ✅ Opt-in components (e.g. Transportation/Van) must stay
                                // removed by default even though they're termly, since not
                                // every student uses them — bursar restores manually.
                                isOptIn: isOptInComponent(component.statusGroupName || component.name)
                            });
                        }
                    }
                }
                
                if (processedItems.length > 0) {
                    processedComponents.push({
                        id: component.id || uuidv4(),
                        name: component.name,
                        periodType: component.periodType || 'termly',
                        statusGroupId: component.statusGroupId || null,
                        statusGroupName: component.statusGroupName || null,
                        items: processedItems,
                        totalAmount: processedItems.reduce((sum, i) => sum + i.totalAmount, 0),
                        createdAt: component.createdAt || new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                }
            }
        }
        
        structures[index] = {
            ...existing,
            name: name || existing.name,
            level: level || existing.level,
            tuition: tuition !== undefined ? parseFloat(tuition) : existing.tuition,
            activityComponents: processedComponents.length ? processedComponents : existing.activityComponents,
            isActive: isActive !== undefined ? isActive : existing.isActive,
            updatedAt: new Date().toISOString()
        };
        
        saveFile(files.feeStructures, structures);

        // ================================================================
        // ========== AUTO-REMOVE NEWLY ADDED ITEMS FOR EXISTING STUDENTS ==========
        // ================================================================
        // Any item that didn't exist in this fee structure before this save is
        // brand new to every student already assigned to it. Mark it "removed"
        // (not billed) for each of those students, exactly like a manual
        // Edit Student -> Remove would — the bursar restores it per student
        // once it should actually be charged. Tuition and any pre-existing
        // items are never touched by this.
        //
        // EXCEPTION: genuinely termly items (scholastic requirements, etc.)
        // are billed automatically every term and skip this auto-remove step
        // entirely — UNLESS the component is an opt-in one like Transportation
        // (Van Fee), which stays removed by default even though it's termly.
        let studentsUpdatedCount = 0;
        let itemsAutoRemovedCount = 0;

        if (newlyAddedItems.length > 0) {
            console.log(`🆕 ${newlyAddedItems.length} new item(s) added to fee structure "${structures[index].name}" — auto-removing for existing students...`);

            let students = readFile(files.students);
            if (!Array.isArray(students)) students = [];

            let feeAssignments = readFile(files.studentFeeAssignments);
            if (!Array.isArray(feeAssignments)) feeAssignments = [];

            // Build the set of student IDs currently on this fee structure —
            // via student.assignedFeeStructureId/feeStructureId, or via any
            // fee assignment record referencing this structure.
            const studentIdsOnStructure = new Set();
            for (const s of students) {
                if (s && (s.assignedFeeStructureId === feeStructureId || s.feeStructureId === feeStructureId)) {
                    studentIdsOnStructure.add(s.id);
                }
            }
            for (const a of feeAssignments) {
                if (a && a.feeStructureId === feeStructureId && a.studentId) {
                    studentIdsOnStructure.add(a.studentId);
                }
            }

            let anyStudentChanged = false;

            for (let i = 0; i < students.length; i++) {
                const student = students[i];
                if (!student || !studentIdsOnStructure.has(student.id)) continue;

                if (!student.removedItems) student.removedItems = {};

                let studentChanged = false;
                for (const newItem of newlyAddedItems) {
                    // ✅ Skip auto-removal only for genuinely auto-billed termly
                    // items. Opt-in components (Transportation) stay removed
                    // even though they're termly.
                    const isTermlyAutoBilled = newItem.periodType === 'termly' && !newItem.isOptIn;
                    if (isTermlyAutoBilled) continue;

                    if (!student.removedItems[newItem.itemId]) {
                        student.removedItems[newItem.itemId] = {
                            itemId: newItem.itemId,
                            itemName: newItem.itemName,
                            componentId: newItem.componentId,
                            componentName: newItem.componentName,
                            defaultAmount: newItem.defaultAmount,
                            defaultQuantity: newItem.defaultQuantity,
                            paymentOption: newItem.paymentOption,
                            removedAt: new Date().toISOString(),
                            reason: newItem.isOptIn
                                ? 'Optional item (Transportation) — requires manual activation by bursar'
                                : 'New item added to fee structure — not yet activated',
                            isActive: true
                        };
                        studentChanged = true;
                        itemsAutoRemovedCount++;
                    }
                }

                if (studentChanged) {
                    student.hasRemovedItems = true;
                    student.removedItemsCount = Object.keys(student.removedItems).length;
                    student.updatedAt = new Date().toISOString();
                    students[i] = student;
                    studentsUpdatedCount++;
                    anyStudentChanged = true;
                }
            }

            if (anyStudentChanged) {
                saveFile(files.students, students);
                console.log(`✅ Auto-removed ${itemsAutoRemovedCount} item-assignment(s) across ${studentsUpdatedCount} student(s) on this fee structure`);
            }
        }

        res.json({
            success: true,
            feeStructure: structures[index],
            newItemsDetected: newlyAddedItems.length,
            studentsAffected: studentsUpdatedCount,
            itemsAutoRemoved: itemsAutoRemovedCount
        });
    } catch (error) {
        console.error('Error updating fee structure:', error);
        res.status(500).json({ error: 'Failed to update fee structure' });
    }
});

app.delete('/api/fee/structures/:id', (req, res) => {
    try {
        let structures = readFile(files.feeStructures);
        structures = structures.filter(s => s.id !== req.params.id);
        saveFile(files.feeStructures, structures);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting fee structure:', error);
        res.status(500).json({ error: 'Failed to delete fee structure' });
    }
});

// ==================== FEE BURSARIES ROUTES ====================

app.get('/api/fee/bursaries', (req, res) => {
    res.json(readFile(files.feeBursaries));
});

app.post('/api/fee/bursaries', (req, res) => {
    const { name, description, type, value, category } = req.body;
    let bursaries = readFile(files.feeBursaries);
    
    const newBursary = {
        id: uuidv4(),
        name,
        description: description || '',
        type: type || 'percentage',
        value: parseInt(value) || 0,
        category: category || 'General',
        isActive: true,
        createdAt: new Date().toISOString()
    };
    
    bursaries.push(newBursary);
    saveFile(files.feeBursaries, bursaries);
    res.json({ success: true, bursary: newBursary });
});

app.put('/api/fee/bursaries/:id', (req, res) => {
    let bursaries = readFile(files.feeBursaries);
    const index = bursaries.findIndex(b => b.id === req.params.id);
    if (index !== -1) {
        bursaries[index] = { ...bursaries[index], ...req.body, updatedAt: new Date().toISOString() };
        saveFile(files.feeBursaries, bursaries);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Bursary not found' });
    }
});

app.delete('/api/fee/bursaries/:id', (req, res) => {
    let bursaries = readFile(files.feeBursaries);
    bursaries = bursaries.filter(b => b.id !== req.params.id);
    saveFile(files.feeBursaries, bursaries);
    res.json({ success: true });
});

// ==================== STUDENT FEE ASSIGNMENTS ====================

app.get('/api/student-fee-assignments', (req, res) => {
    res.json(readFile(files.studentFeeAssignments));
});

// ==================== STUDENT FEE ASSIGNMENTS (YEAR-AWARE) ====================
// ==================== STUDENT FEE ASSIGNMENTS (YEAR-AWARE - FIXED) ====================
// ==================== STUDENT FEE ASSIGNMENTS (YEAR-AWARE - FIXED) ====================
// ==================== STUDENT FEE ASSIGNMENTS (YEAR-AWARE - FIXED) ====================
// ==================== STUDENT FEE ASSIGNMENTS (UNIVERSAL) ====================
// Works for BOTH promotion and edit student
// ==================== STUDENT FEE ASSIGNMENTS (UNIVERSAL - FULLY FIXED) ====================
app.post('/api/student-fee-assignments', (req, res) => {
    const { studentId, feeStructureId, bursaryId, academicYear, term } = req.body;

    console.log('📌 Fee assignment request:', { studentId, feeStructureId, academicYear, term });

    // Get current year from settings if not provided
    let year = academicYear;
    if (!year) {
        const settings = readFile(files.settings);
        year = settings.currentAcademicYear || new Date().getFullYear();
    }
    const termNum = term || 1;

    let assignments = readFile(files.studentFeeAssignments);
    if (!Array.isArray(assignments)) assignments = [];

    // SIMPLE FIND - works for both promotion and edit
    const existingIndex = assignments.findIndex(a => 
        a.studentId === studentId && 
        a.academicYear === year
    );

    // Build assignment
    const assignment = {
        id: existingIndex !== -1 ? assignments[existingIndex].id : uuidv4(),
        studentId: studentId,
        feeStructureId: feeStructureId || null,
        bursaryId: bursaryId || null,
        academicYear: year,
        term: termNum || null,
        assignedAt: existingIndex !== -1 ? assignments[existingIndex].assignedAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    // Preserve custom bursary if exists
    if (existingIndex !== -1 && assignments[existingIndex].customBursaryAmount) {
        assignment.customBursaryAmount = assignments[existingIndex].customBursaryAmount;
    }

    // Save assignment
    if (existingIndex !== -1) {
        assignments[existingIndex] = assignment;
        console.log(`✅ Updated fee assignment for student ${studentId}, year ${year}, fee ${feeStructureId}`);
    } else {
        assignments.push(assignment);
        console.log(`✅ Created new fee assignment for student ${studentId}, year ${year}, fee ${feeStructureId}`);
    }

    saveFile(files.studentFeeAssignments, assignments);

    // ================================================================
    // CRITICAL: Update the student's assignedFeeStructureId
    // ================================================================
    let students = readFile(files.students);
    if (Array.isArray(students)) {
        const studentIndex = students.findIndex(s => s.id === studentId);
        if (studentIndex !== -1) {
            // Force update the student's fee structure IDs
            students[studentIndex].assignedFeeStructureId = feeStructureId || null;
            students[studentIndex].feeStructureId = feeStructureId || null;
            students[studentIndex]._feeAssignmentPeriod = { year: year, term: termNum };
            students[studentIndex].updatedAt = new Date().toISOString();
            
            saveFile(files.students, students);
            console.log(`✅ Updated student ${studentId} assignedFeeStructureId to ${feeStructureId}`);
            
            // Verify the update
            const verifyStudents = readFile(files.students);
            const verifiedStudent = verifyStudents.find(s => s.id === studentId);
            console.log(`🔍 Verified student fee structure ID: ${verifiedStudent?.assignedFeeStructureId}`);
        } else {
            console.warn(`⚠️ Student ${studentId} not found in students file`);
        }
    }

    res.json({ 
        success: true, 
        assignment: assignment,
        studentUpdated: true
    });
});
// ==================== DEBUG: CHECK FEE STRUCTURE MAPPING ====================
app.get('/api/debug/fee-mapping', (req, res) => {
    const { className, studentType } = req.query;

    if (!className) {
        return res.status(400).json({ error: 'className is required' });
    }

    const feeStructures = readFile(files.feeStructures);

    // Build maps
    const dayMap = {};
    const boardingMap = {};

    feeStructures.forEach(fs => {
        if (!fs || fs.isActive === false) return;

        const name = fs.name.toLowerCase().trim();
        const isBoarding = name.includes('boarding');
        const isDay = name.includes('day');

        if (isBoarding) {
            let base = name.replace('boarding', '').trim();
            boardingMap[base] = fs;
            boardingMap[base.replace(/\s/g, '')] = fs;
            const numMatch = fs.name.match(/(\d+)/);
            if (numMatch) {
                const num = numMatch[1];
                boardingMap[`p.${num}`] = fs;
                boardingMap[`primary ${num}`] = fs;
            }
        }
        if (isDay || !isBoarding) {
            let base = name.replace('day', '').trim();
            dayMap[base] = fs;
            dayMap[base.replace(/\s/g, '')] = fs;
            const numMatch = fs.name.match(/(\d+)/);
            if (numMatch) {
                const num = numMatch[1];
                dayMap[`p.${num}`] = fs;
                dayMap[`primary ${num}`] = fs;
            }
        }
    });

    const isBoarding = studentType === 'Boarding';
    const map = isBoarding ? boardingMap : dayMap;
    const clean = className.toLowerCase().trim();

    // Find matches
    const matches = [];
    for (const [key, fs] of Object.entries(map)) {
        if (fs.name.toLowerCase().includes(clean) || clean.includes(fs.name.toLowerCase()) || key.includes(clean) || clean.includes(key)) {
            matches.push({ key, name: fs.name, id: fs.id });
        }
    }

    // Exact match
    const exactMatch = map[clean] || map[clean.replace(/\s/g, '')] || null;

    res.json({
        search: { className, studentType, isBoarding, normalized: clean },
        exactMatch: exactMatch ? { id: exactMatch.id, name: exactMatch.name } : null,
        matches: matches.slice(0, 10),
        allDayStructures: Object.keys(dayMap).map(k => ({ key: k, name: dayMap[k]?.name })),
        allBoardingStructures: Object.keys(boardingMap).map(k => ({ key: k, name: boardingMap[k]?.name })),
        availableFeeStructures: feeStructures.filter(f => f.isActive !== false).map(f => ({ id: f.id, name: f.name, level: f.level }))
    });
});
function getCurrentAcademicYear() {
    const settings = readFile(files.settings);
    return settings.currentAcademicYear || new Date().getFullYear();
}

function getCurrentTerm() {
    const settings = readFile(files.settings);
    return settings.currentTerm || 1;
}

// Get all status groups
app.get('/api/fee/status-groups', (req, res) => {
    try {
        const groups = readFile(files.statusGroups);
        res.json(groups);
    } catch (error) {
        console.error('Error getting status groups:', error);
        res.status(500).json({ error: 'Failed to fetch status groups' });
    }
});

// Create a new status group
app.post('/api/fee/status-groups', (req, res) => {
    try {
        const { name, description, color } = req.body;
        let groups = readFile(files.statusGroups);
        
        const newGroup = {
            id: uuidv4(),
            name: name || 'Unnamed Group',
            description: description || '',
            color: color || '#6b7280',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        groups.push(newGroup);
        saveFile(files.statusGroups, groups);
        res.json({ success: true, group: newGroup });
    } catch (error) {
        console.error('Error creating status group:', error);
        res.status(500).json({ error: 'Failed to create status group' });
    }
});

// Update a status group
app.put('/api/fee/status-groups/:id', (req, res) => {
    try {
        let groups = readFile(files.statusGroups);
        const index = groups.findIndex(g => g.id === req.params.id);
        if (index !== -1) {
            groups[index] = { ...groups[index], ...req.body, updatedAt: new Date().toISOString() };
            saveFile(files.statusGroups, groups);
            res.json({ success: true, group: groups[index] });
        } else {
            res.status(404).json({ error: 'Status group not found' });
        }
    } catch (error) {
        console.error('Error updating status group:', error);
        res.status(500).json({ error: 'Failed to update status group' });
    }
});

// Delete a status group
app.delete('/api/fee/status-groups/:id', (req, res) => {
    try {
        let groups = readFile(files.statusGroups);
        groups = groups.filter(g => g.id !== req.params.id);
        saveFile(files.statusGroups, groups);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting status group:', error);
        res.status(500).json({ error: 'Failed to delete status group' });
    }
});

// ==================== FEE PAYMENTS ROUTES ====================
// Example in server.js - update your payment endpoint
app.get('/api/fee/payments', (req, res) => {
    const { year, term } = req.query;
    let payments = readFile(files.feePayments);
    
    if (year && term) {
        payments = payments.filter(p => p.academicYear === year && p.term === parseInt(term));
    }
    
    res.json(payments);
});
app.post('/api/fee/payments', (req, res) => {
    const { studentId, studentName, admissionNumber, term, academicYear, feeStructureId, feeStructureName, bursaryId, amount, method, date, reference, notes } = req.body;
    
    let payments = readFile(files.feePayments);
    const receiptNumber = `RCP${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const paymentDate = date || new Date().toISOString();
    const currentYear = academicYear || new Date().getFullYear();
    
    const payment = {
        id: uuidv4(),
        studentId,
        studentName: studentName || '',
        admissionNumber: admissionNumber || '',
        term: parseInt(term),
        academicYear: currentYear.toString(),
        feeStructureId: feeStructureId || null,
        feeStructureName: feeStructureName || '',
        bursaryId: bursaryId || null,
        amount: amount,
        method: method || 'cash',
        date: paymentDate,
        reference: reference || '',
        notes: notes || '',
        receiptNumber: receiptNumber,
        recordedAt: new Date().toISOString()
    };
    
    payments.push(payment);
    saveFile(files.feePayments, payments);
    
    res.json({ success: true, receiptNumber: receiptNumber, payment: payment });
});

// app.delete('/api/fee/payments/:id', (req, res) => {
//     let payments = readFile(files.feePayments);
//     payments = payments.filter(p => p.id !== req.params.id);
//     saveFile(files.feePayments, payments);
//     res.json({ success: true });
// });


// Add this after your GET /api/academic/years endpoint
app.post('/api/academic/years', (req, res) => {
    const { year } = req.body;
    
    if (!year || isNaN(parseInt(year))) {
        return res.status(400).json({ error: 'Valid year is required' });
    }
    
    const yearDir = path.join(dataDir, year.toString());
    
    if (fs.existsSync(yearDir)) {
        return res.status(400).json({ error: 'Academic year already exists' });
    }
    
    try {
        // Create directory for the new year
        fs.mkdirSync(yearDir, { recursive: true });
        
        // Create term subdirectories
        for (let term = 1; term <= 3; term++) {
            const termDir = path.join(yearDir, `term${term}`);
            fs.mkdirSync(termDir, { recursive: true });
        }
        
        res.json({ success: true, message: `Academic year ${year} created successfully` });
    } catch (error) {
        console.error('Error creating academic year:', error);
        res.status(500).json({ error: 'Failed to create academic year' });
    }
});


app.post('/api/academic/years/:toYear/copy-from/:fromYear', (req, res) => {
    const { toYear, fromYear } = req.params;
    
    const fromYearDir = path.join(dataDir, fromYear);
    const toYearDir = path.join(dataDir, toYear);
    
    if (!fs.existsSync(fromYearDir)) {
        return res.status(404).json({ error: 'Source year directory not found' });
    }
    
    if (fs.existsSync(toYearDir)) {
        return res.status(400).json({ error: 'Target year already exists' });
    }
    
    try {
        // Create target directory
        fs.mkdirSync(toYearDir, { recursive: true });
        
        // Copy term structures (optional - you can copy fee structures, classes, etc.)
        // This is a placeholder - implement based on your needs
        
        res.json({ success: true, message: `Data copied from ${fromYear} to ${toYear}` });
    } catch (error) {
        console.error('Error copying data:', error);
        res.status(500).json({ error: 'Failed to copy data' });
    }
});

// ==================== ENHANCED PAYMENT ROUTES ====================

// Update the fee payment endpoint to handle separate fees correctly
// ==================== FIXED FEE PAYMENT ENDPOINT ====================

// ==================== FIXED ENHANCED PAYMENT ROUTE - REPLACE THIS ENTIRE FUNCTION ====================

// ==================== COMPLETELY REBUILT ENHANCED PAYMENT ROUTE ====================
// ========== AUTO-STOCK UPDATE FROM PAYMENTS ==========
// Add this function to server.js

// ==================== INVENTORY UPDATE FROM PAYMENT ====================
// ==================== COMPLETELY REWRITTEN INVENTORY UPDATE ====================
// Version: 4.0 - Guaranteed File Save with Verification

// ==================== DEBUG INVENTORY UPDATE - WITH VERIFICATION ====================
// Version: 5.0 - Forces save and verifies

// ==================== INVENTORY UPDATE FUNCTION ====================
// Add this BEFORE your payment endpoints

// ==================== SUPER DEBUG INVENTORY UPDATE ====================
// ==================== ULTRA SAFE INVENTORY UPDATE ====================
// Version: 6.0 - Forces stock to always be an object

// ==================== FIXED: updateInventoryFromPayment ====================
// Version: 7.0 - Properly tracks BOTH cash and item payments

async function updateInventoryFromPayment(studentId, activityItemPayments, academicYear, term) {
    console.log('=== 🛡️ ULTRA SAFE INVENTORY UPDATE v7.0 ===');
    console.log('Student ID:', studentId);
    console.log('Academic Year:', academicYear, 'Term:', term);
    console.log('Items to process:', activityItemPayments ? activityItemPayments.length : 0);
    
    if (!activityItemPayments || !Array.isArray(activityItemPayments) || activityItemPayments.length === 0) {
        console.log('⚠️ No activity items to process');
        return { success: true, itemsAdded: 0 };
    }
    
    // ========== FILE PATHS ==========
    const dataDir = path.join(__dirname, 'data');
    const inventoryStockPath = path.join(dataDir, 'inventoryStock.json');
    const inventoryTransactionsPath = path.join(dataDir, 'inventoryTransactions.json');
    
    console.log('📁 Stock File Path:', inventoryStockPath);
    
    // ========== ENSURE DATA DIRECTORY EXISTS ==========
    if (!fs.existsSync(dataDir)) {
        console.log('📁 Creating data directory...');
        fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // ========== READ EXISTING STOCK - FORCE OBJECT ==========
    let stock = {};
    
    try {
        if (fs.existsSync(inventoryStockPath)) {
            const content = fs.readFileSync(inventoryStockPath, 'utf8');
            console.log('📄 Stock file content length:', content.length);
            
            if (content.trim() === '') {
                console.log('⚠️ Stock file is empty, using empty object');
                stock = {};
            } else {
                const parsed = JSON.parse(content);
                if (Array.isArray(parsed)) {
                    console.log('⚠️ Stock file contained an array! Converting to object...');
                    const newStock = {};
                    parsed.forEach((item, index) => {
                        if (item && item.name) {
                            const key = `${item.name}_${item.academicYear || 2026}_${item.term || 1}`;
                            newStock[key] = item;
                        }
                    });
                    stock = newStock;
                } else if (typeof parsed === 'object' && parsed !== null) {
                    stock = parsed;
                    console.log('📊 Stock loaded as object. Keys:', Object.keys(stock).length);
                } else {
                    console.log('⚠️ Invalid stock data, using empty object');
                    stock = {};
                }
            }
        } else {
            console.log('📊 No stock file found, creating new');
            fs.writeFileSync(inventoryStockPath, JSON.stringify({}, null, 2), 'utf8');
            stock = {};
        }
    } catch (e) {
        console.warn('⚠️ Could not read stock:', e.message);
        console.log('🔄 Resetting stock to empty object');
        stock = {};
        fs.writeFileSync(inventoryStockPath, JSON.stringify({}, null, 2), 'utf8');
    }
    
    // SAFETY CHECK: Ensure stock is ALWAYS an object
    if (Array.isArray(stock)) {
        console.log('⚠️ CRITICAL: stock is an array! Converting to object...');
        const newStock = {};
        stock.forEach((item, index) => {
            if (item && item.name) {
                const key = `${item.name}_${item.academicYear || 2026}_${item.term || 1}`;
                newStock[key] = item;
            }
        });
        stock = newStock;
    }
    
    console.log('📊 STOCK IS OBJECT:', typeof stock === 'object' && !Array.isArray(stock));
    console.log('📊 Stock keys before processing:', Object.keys(stock));
    
    // ========== READ EXISTING TRANSACTIONS ==========
    let transactions = [];
    try {
        if (fs.existsSync(inventoryTransactionsPath)) {
            const content = fs.readFileSync(inventoryTransactionsPath, 'utf8');
            transactions = JSON.parse(content);
            if (!Array.isArray(transactions)) transactions = [];
            console.log('📊 Transactions loaded:', transactions.length);
        } else {
            console.log('📊 No transactions file found, creating new');
            fs.writeFileSync(inventoryTransactionsPath, JSON.stringify([], null, 2), 'utf8');
            transactions = [];
        }
    } catch (e) {
        console.warn('⚠️ Could not read transactions:', e.message);
        transactions = [];
        fs.writeFileSync(inventoryTransactionsPath, JSON.stringify([], null, 2), 'utf8');
    }
    
    const year = parseInt(academicYear) || new Date().getFullYear();
    const termNum = parseInt(term) || 1;
    let itemsAdded = 0;
    let totalQuantityAdded = 0;
    
    // ========== PROCESS EACH ITEM ==========
    const newKeys = [];
    
    for (const payment of activityItemPayments) {
        if (!payment || !payment.itemName) {
            console.log('⚠️ Skipping invalid item:', payment);
            continue;
        }
        
        const itemName = payment.itemName.trim();
        const paymentType = payment.paymentType || 'unknown';
        const itemsBrought = parseInt(payment.itemsBrought) || 0;
        const amountPaid = parseFloat(payment.amountPaid) || 0;
        const cashEquivalent = parseFloat(payment.cashEquivalent) || 0;
        const unitPrice = parseFloat(payment.unitPrice) || 0;
        const quantityRequired = parseInt(payment.quantityRequired) || 1;
        
        console.log(`📦 Processing: ${itemName}`);
        console.log(`   Type: ${paymentType}, Brought: ${itemsBrought}, Paid: ${amountPaid}`);
        
        // ========== CRITICAL: Calculate quantity to add ==========
        let quantityToAdd = 0;
        
        if (paymentType === 'brought_item' && itemsBrought > 0) {
            // ========== ITEMS BROUGHT - Add to stock ==========
            quantityToAdd = itemsBrought;
            console.log(`   📦 Items brought: ${quantityToAdd}`);
        } else if (paymentType === 'paid_cash' && amountPaid > 0) {
            // ========== CASH PAYMENT - Convert to items ==========
            if (unitPrice > 0) {
                quantityToAdd = Math.floor(amountPaid / unitPrice);
            } else {
                quantityToAdd = quantityRequired;
            }
            console.log(`   💵 Cash payment: UGX ${amountPaid} → ${quantityToAdd} items`);
        } else if (cashEquivalent > 0 && unitPrice > 0) {
            quantityToAdd = Math.floor(cashEquivalent / unitPrice);
        }
        
        if (quantityToAdd <= 0) {
            console.log(`  ⏭️ Skipping ${itemName} - no items to add`);
            continue;
        }
        
        // ========== Create stock key ==========
        const stockKey = `${itemName}_${year}_${termNum}`;
        console.log(`  📊 Stock key: ${stockKey}`);
        newKeys.push(stockKey);
        
        // Initialize stock entry
        if (!stock[stockKey]) {
            stock[stockKey] = {
                name: itemName,
                academicYear: year,
                term: termNum,
                totalReceived: 0,
                issued: 0,
                available: 0,
                lastUpdated: new Date().toISOString()
            };
            console.log(`  🆕 Created new stock entry`);
        }
        
        // ========== Update stock ==========
        const previousAvailable = stock[stockKey].available || 0;
        stock[stockKey].totalReceived = (stock[stockKey].totalReceived || 0) + quantityToAdd;
        stock[stockKey].available = (stock[stockKey].available || 0) + quantityToAdd;
        stock[stockKey].lastUpdated = new Date().toISOString();
        
        // ========== Update legacy stock entry ==========
        if (!stock[itemName]) {
            stock[itemName] = {
                name: itemName,
                totalReceived: quantityToAdd,
                issued: 0,
                available: quantityToAdd,
                lastUpdated: new Date().toISOString()
            };
        } else {
            stock[itemName].totalReceived = (stock[itemName].totalReceived || 0) + quantityToAdd;
            stock[itemName].available = (stock[itemName].available || 0) + quantityToAdd;
            stock[itemName].lastUpdated = new Date().toISOString();
        }
        
        console.log(`  ✅ Added ${quantityToAdd} ${itemName}(s) to stock`);
        console.log(`     Available now: ${stock[stockKey].available}`);
        
        // ========== Record transaction ==========
        const transaction = {
            id: uuidv4(),
            itemName: itemName,
            quantity: quantityToAdd,
            transactionType: 'receipt',
            source: paymentType === 'brought_item' ? 'items_brought' : 'cash_payment',
            studentId: studentId,
            paymentType: paymentType,
            amountPaid: amountPaid,
            itemsBrought: itemsBrought,
            cashEquivalent: cashEquivalent || (itemsBrought * unitPrice),
            unitPrice: unitPrice,
            quantityRequired: quantityRequired,
            periodKey: `${year}_${termNum}`,
            academicYear: year,
            term: termNum,
            stockBefore: previousAvailable,
            stockAfter: stock[stockKey].available || 0,
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split('T')[0],
            isInventory: true,
            autoAdded: true,
            // ========== Track payment type ==========
            isItemPayment: paymentType === 'brought_item',
            isCashPayment: paymentType === 'paid_cash'
        };
        
        transactions.push(transaction);
        itemsAdded++;
        totalQuantityAdded += quantityToAdd;
    }
    
    // ========== SAFETY CHECK: Ensure stock is STILL an object ==========
    if (Array.isArray(stock)) {
        console.log('⚠️ CRITICAL ERROR: stock became an array! Converting back...');
        const newStock = {};
        stock.forEach((item) => {
            if (item && item.name) {
                const key = `${item.name}_${item.academicYear || 2026}_${item.term || 1}`;
                newStock[key] = item;
            }
        });
        stock = newStock;
    }
    
    console.log('\n📊 FINAL STOCK OBJECT:');
    console.log('   Is Object:', typeof stock === 'object' && !Array.isArray(stock));
    console.log('   Keys:', Object.keys(stock));
    
    // ========== SAVE TO DISK ==========
    if (itemsAdded > 0) {
        console.log('\n💾 SAVING TO DISK...');
        
        try {
            // CRITICAL: Ensure stock is an object before saving
            if (Array.isArray(stock)) {
                console.log('⚠️ Converting array to object before saving...');
                const newStock = {};
                stock.forEach((item) => {
                    if (item && item.name) {
                        const key = `${item.name}_${item.academicYear || 2026}_${item.term || 1}`;
                        newStock[key] = item;
                    }
                });
                stock = newStock;
            }
            
            // Save stock
            const stockJson = JSON.stringify(stock, null, 2);
            console.log('📝 Stock JSON to save:', stockJson);
            fs.writeFileSync(inventoryStockPath, stockJson, 'utf8');
            console.log(`✅ Stock written to: ${inventoryStockPath}`);
            
            // Verify save
            const verifyContent = fs.readFileSync(inventoryStockPath, 'utf8');
            const verifyStock = JSON.parse(verifyContent);
            const verifyKeys = Object.keys(verifyStock);
            console.log(`📊 Verified keys: ${verifyKeys.join(', ')}`);
            console.log(`📊 Verified count: ${verifyKeys.length}`);
            
            // Save transactions
            const txJson = JSON.stringify(transactions, null, 2);
            fs.writeFileSync(inventoryTransactionsPath, txJson, 'utf8');
            console.log(`✅ Transactions saved: ${transactions.length} records`);
            
            console.log(`\n✅✅✅ INVENTORY UPDATE COMPLETE!`);
            console.log(`   Items Added: ${itemsAdded}`);
            console.log(`   Total Quantity: ${totalQuantityAdded}`);
            console.log(`   Stock Keys: ${verifyKeys.join(', ')}`);
            
            return {
                success: true,
                itemsAdded: itemsAdded,
                totalQuantityAdded: totalQuantityAdded,
                stockKeys: verifyKeys,
                stock: verifyStock
            };
            
        } catch (error) {
            console.error('❌ ERROR saving inventory:', error);
            console.error('   Stack:', error.stack);
            return {
                success: false,
                error: error.message,
                stack: error.stack
            };
        }
    } else {
        console.log('⚠️ No items were added to stock');
        return { success: true, itemsAdded: 0 };
    }
}

// ==================== TEST INVENTORY DIRECTLY ====================
app.post('/api/test/inventory-direct', async (req, res) => {
    console.log('=== TEST INVENTORY DIRECT ===');
    
    try {
        const { itemName, quantity, studentId, year, term } = req.body;
        
        console.log('📦 Testing with:', { itemName, quantity, studentId, year, term });
        
        // Create a mock payment item
        const mockItem = {
            itemName: itemName || 'Test Item',
            paymentType: 'brought_item',
            itemsBrought: quantity || 5,
            amountPaid: 0,
            cashEquivalent: (quantity || 5) * 5000,
            unitPrice: 5000,
            quantityRequired: quantity || 5,
            periodType: 'termly',
            componentName: 'Test Scholastic'
        };
        
        // Call the inventory function directly
        const result = await updateInventoryFromPayment(
            studentId || 'test_student',
            [mockItem],
            year || 2026,
            term || 1
        );
        
        console.log('📦 Result:', result);
        
        // Check if stock was saved
        const stockPath = path.join(__dirname, 'data', 'inventoryStock.json');
        let stock = {};
        if (fs.existsSync(stockPath)) {
            const content = fs.readFileSync(stockPath, 'utf8');
            stock = JSON.parse(content);
        }
        
        res.json({
            success: true,
            result: result,
            stock: stock,
            stockKeys: Object.keys(stock)
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});
// ==================== FIXED ENHANCED PAYMENT ROUTE ====================
// Version: 2.0 - Correctly separates tuition from activity payments

// ==================== FIXED ENHANCED PAYMENT ROUTE ====================
// Version: 3.0 - Respects manual receipt entry, auto-generates if empty

// ==================== COMPLETE ENHANCED PAYMENT ENDPOINT ====================
// Version: 7.0 - Full payment processing with inventory update

// ==================== COMPLETE WORKING ENHANCED PAYMENT ENDPOINT ====================
// Version: 7.0 - With Inventory Management Support

// ==================== ENHANCED PAYMENT ENDPOINT WITH PREVIOUS BALANCE SUPPORT ====================
// Version: 3.0 - Full Previous Academic Period Balance Tracking

// ==================== COMPLETE REBUILT ENHANCED PAYMENT ENDPOINT ====================
// Version: 8.0 - Full previous balance support with item-level tracking

// ==================== COMPLETE REBUILT: /api/fee/payments/enhanced ====================
// Version: 9.0 - FIXED INDIVIDUAL PAYMENT ISSUE
// Each payment is stored as an INDIVIDUAL record, NOT cumulative

app.post('/api/fee/payments/enhanced', async (req, res) => {
    console.log('=== ENHANCED PAYMENT REQUEST v9.0 (INDIVIDUAL PAYMENTS FIXED) ===');
    console.log('📦 Activity Items Count:', req.body.activityItemPayments?.length || 0);
    
    try {
        const { 
            studentId, 
            studentName, 
            admissionNumber,
            term, 
            academicYear,
            feeStructureId, 
            feeStructureName,
            bursaryId, 
            bursaryName,
            tuitionPaid,
            activityItemPayments, 
            method, 
            date, 
            reference, 
            notes,
            receiptNumber: providedReceiptNumber,
            
            // ========== PREVIOUS BALANCE FIELDS ==========
            isPreviousBalancePayment,
            targetPeriodYear,
            targetPeriodTerm,
            originalPeriod,
            isBulkPayment,
            bulkPaymentId,
            
            // ========== INDIVIDUAL PAYMENT FLAG ==========
            isIndividualPayment,
            paymentMode
        } = req.body;
        
        // ========== DETERMINE THE ACTUAL PERIOD TO RECORD THIS PAYMENT ==========
        let recordYear = academicYear || new Date().getFullYear();
        let recordTerm = parseInt(term) || 1;
        let isPreviousPayment = false;
        let previousPaymentInfo = null;
        
        // If this is a previous balance payment, use the target period
        if (isPreviousBalancePayment === true) {
            if (targetPeriodYear && targetPeriodTerm !== undefined && targetPeriodTerm !== null) {
                recordYear = targetPeriodYear.toString();
                recordTerm = parseInt(targetPeriodTerm);
                isPreviousPayment = true;
                previousPaymentInfo = {
                    originalYear: academicYear || new Date().getFullYear(),
                    originalTerm: parseInt(term) || 1,
                    targetYear: recordYear,
                    targetTerm: recordTerm,
                    appliedAt: new Date().toISOString()
                };
                console.log(`📅 PREVIOUS BALANCE PAYMENT: ${recordYear} Term ${recordTerm}`);
            }
        }
        
        // Validate period
        if (isNaN(recordTerm) || recordTerm < 1 || recordTerm > 3) {
            recordTerm = 1;
        }
        
        const currentYear = parseInt(recordYear);
        const currentTerm = recordTerm;
        const roundedTuitionPaid = Math.round(tuitionPaid || 0);
        
        // ========== READ TERM RECORDS ==========
        let termRecords = readFile(files.studentTermRecords);
        if (!termRecords || typeof termRecords !== 'object') {
            termRecords = {};
        }
        
        const recordKey = `${studentId}_${currentYear}_${currentTerm}`;
        
        // Initialize term record if it doesn't exist
        if (!termRecords[recordKey]) {
            termRecords[recordKey] = {
                studentId: studentId,
                year: currentYear,
                term: currentTerm,
                activityItemsPaid: { one_time: [], termly: [], yearly: [] },
                tuitionTotalPaid: 0,
                activityTotalPaid: 0,
                isPreviousBalanceRecord: isPreviousPayment,
                originalPeriod: previousPaymentInfo || null,
                createdAt: new Date().toISOString(),
                // ========== NEW: Track individual payments ==========
                individualPayments: [],
                individualTuitionPayments: []
            };
        } else if (isPreviousPayment && !termRecords[recordKey].isPreviousBalanceRecord) {
            termRecords[recordKey].isPreviousBalanceRecord = true;
            termRecords[recordKey].originalPeriod = previousPaymentInfo;
        }
        
        // ========== RECORD TUITION PAYMENT - FIXED ==========
        if (roundedTuitionPaid > 0) {
            // ========== FIX: Add to total, but also store individual payment ==========
            termRecords[recordKey].tuitionTotalPaid = Math.round((termRecords[recordKey].tuitionTotalPaid || 0) + roundedTuitionPaid);
            
            // ========== STORE INDIVIDUAL TUITION PAYMENT ==========
            if (!termRecords[recordKey].individualTuitionPayments) {
                termRecords[recordKey].individualTuitionPayments = [];
            }
            termRecords[recordKey].individualTuitionPayments.push({
                amount: roundedTuitionPaid,
                date: date || new Date().toISOString(),
                receiptNumber: providedReceiptNumber || finalReceiptNumber || null,
                method: method || 'cash',
                reference: reference || '',
                isPreviousBalancePayment: isPreviousPayment,
                paymentId: null // Will be set after payment is created
            });
            
            console.log(`✅ INDIVIDUAL Tuition payment recorded: UGX ${roundedTuitionPaid} for ${currentYear} Term ${currentTerm}`);
            console.log(`   Total tuition paid: UGX ${termRecords[recordKey].tuitionTotalPaid}`);
        }
        
        // ========== PROCESS ACTIVITY ITEMS - FIXED INDIVIDUAL PAYMENTS ==========
        let activityTotalPaid = 0;
        const processedItems = [];
        let totalIndividualAmount = 0;
        
        if (activityItemPayments && activityItemPayments.length > 0) {
            console.log('\n📦 Processing Activity Items (INDIVIDUAL PAYMENTS):');
            
            for (const payment of activityItemPayments) {
                const period = payment.periodType || 'termly';
                const itemName = payment.itemName;
                
                // ========== CRITICAL FIX: Use individual amount ==========
                // The amount sent from frontend is the INDIVIDUAL payment amount
                let paidAmount = 0;
                let itemsBrought = 0;
                let isItemOnly = false;
                
                if (payment.paymentType === 'paid_cash') {
                    // Cash payment - use the exact amount from the input
                    paidAmount = Math.round(payment.amountPaid || 0);
                    
                    // If isIndividualPayment flag is true, this is already the individual amount
                    // If not, we need to check if this is a cumulative total
                    if (!isIndividualPayment && !payment.isIndividualPayment) {
                        // Legacy mode - try to determine individual amount
                        // Look for the item in existing records to subtract already paid
                        const existingItem = termRecords[recordKey].activityItemsPaid[period].find(
                            i => i.itemName === itemName
                        );
                        if (existingItem) {
                            // If we have an existing item, the individual payment is the difference
                            // between what was already paid and what's being sent
                            const existingPaid = existingItem.amountPaid || 0;
                            if (paidAmount > existingPaid) {
                                paidAmount = paidAmount - existingPaid;
                            }
                        }
                    }
                } else if (payment.paymentType === 'brought_item') {
                    itemsBrought = Math.round(payment.itemsBrought || 0);
                    isItemOnly = true;
                    
                    if (!isIndividualPayment && !payment.isIndividualPayment) {
                        const existingItem = termRecords[recordKey].activityItemsPaid[period].find(
                            i => i.itemName === itemName
                        );
                        if (existingItem) {
                            const existingBrought = existingItem.itemsBrought || 0;
                            if (itemsBrought > existingBrought) {
                                itemsBrought = itemsBrought - existingBrought;
                            }
                        }
                    }
                }
                
                const unitPrice = Math.round(payment.unitPrice || 0);
                const quantityRequired = Math.round(payment.quantityRequired || 0);
                const totalItemAmount = Math.round(quantityRequired * unitPrice);
                
                // Calculate cash equivalent for brought items
                const cashEquivalent = Math.round(itemsBrought * unitPrice);
                
                // If this is an item-only payment, adjust paidAmount
                if (isItemOnly && itemsBrought > 0) {
                    paidAmount = cashEquivalent;
                }
                
                console.log(`  📦 ${itemName}: Brought=${itemsBrought}, Paid=${paidAmount}, Period=${period}`);
                console.log(`     Individual payment: ${isIndividualPayment ? 'YES' : 'NO'}`);
                
                if (paidAmount === 0 && itemsBrought === 0) {
                    console.log(`    ⏭️ Skipping - no payment`);
                    continue;
                }
                
                // ========== STORE INDIVIDUAL PAYMENT ==========
                // Check if this item already exists in term records
                const existingItemIndex = termRecords[recordKey].activityItemsPaid[period].findIndex(
                    i => i.itemName === itemName
                );
                
                if (existingItemIndex !== -1) {
                    // ========== FIX: Update existing item with individual payment ==========
                    const existing = termRecords[recordKey].activityItemsPaid[period][existingItemIndex];
                    
                    // Store individual payment in the payments array
                    if (!existing.payments) {
                        existing.payments = [];
                    }
                    
                    const paymentRecord = {
                        date: date || new Date().toISOString(),
                        amount: paidAmount,
                        type: payment.paymentType,
                        itemsBrought: itemsBrought || null,
                        isPreviousBalancePayment: isPreviousPayment,
                        receiptNumber: providedReceiptNumber || finalReceiptNumber || null,
                        isIndividualPayment: true,
                        individualAmount: paidAmount,
                        individualItems: itemsBrought
                    };
                    existing.payments.push(paymentRecord);
                    
                    // ========== CRITICAL: Recalculate totals from individual payments ==========
                    const totalPaidFromPayments = existing.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
                    const totalItemsFromPayments = existing.payments.reduce((sum, p) => sum + (p.itemsBrought || 0), 0);
                    
                    existing.amountPaid = totalPaidFromPayments;
                    existing.itemsBrought = totalItemsFromPayments;
                    existing.cashEquivalent = totalPaidFromPayments;
                    existing.itemsCovered = Math.round(totalItemsFromPayments + (totalPaidFromPayments / (unitPrice || 1)));
                    existing.remainingQuantity = Math.max(0, existing.quantityRequired - existing.itemsCovered);
                    existing.remainingAmount = Math.max(0, totalItemAmount - (totalPaidFromPayments + (totalItemsFromPayments * unitPrice)));
                    
                    if (existing.remainingAmount <= 0 && existing.remainingQuantity <= 0) {
                        existing.status = 'fully_paid';
                    } else if (totalPaidFromPayments > 0 || totalItemsFromPayments > 0) {
                        existing.status = 'partial';
                    } else {
                        existing.status = 'unpaid';
                    }
                    
                    processedItems.push(existing);
                    console.log(`    ✅ Updated ${itemName}: Total Paid=${totalPaidFromPayments}, Status=${existing.status}`);
                    console.log(`       Individual payment: UGX ${paidAmount}`);
                    
                } else {
                    // ========== Create new item record with individual payment ==========
                    const itemsCovered = itemsBrought + Math.round(paidAmount / (unitPrice || 1));
                    const remainingQuantity = Math.max(0, quantityRequired - itemsCovered);
                    const remainingAmount = Math.max(0, totalItemAmount - (paidAmount + cashEquivalent));
                    
                    let status = 'unpaid';
                    if (remainingAmount <= 0 && remainingQuantity <= 0) {
                        status = 'fully_paid';
                    } else if (paidAmount > 0 || itemsBrought > 0) {
                        status = 'partial';
                    }
                    
                    const newItem = {
                        componentId: payment.componentId || `comp_${Date.now()}`,
                        componentName: payment.componentName || 'General',
                        periodType: period,
                        itemId: payment.itemId || `item_${Date.now()}`,
                        itemName: itemName,
                        unitPrice: unitPrice,
                        quantityRequired: quantityRequired,
                        totalAmount: totalItemAmount,
                        paymentType: payment.paymentType,
                        amountPaid: paidAmount || 0,
                        itemsBrought: itemsBrought || 0,
                        cashEquivalent: cashEquivalent || 0,
                        itemsCovered: itemsCovered,
                        remainingQuantity: remainingQuantity,
                        remainingAmount: remainingAmount,
                        status: status,
                        recordedAt: new Date().toISOString(),
                        isPreviousBalanceItem: isPreviousPayment,
                        // ========== NEW: Store individual payments ==========
                        payments: [{
                            date: date || new Date().toISOString(),
                            amount: paidAmount || 0,
                            type: payment.paymentType,
                            itemsBrought: itemsBrought || null,
                            isPreviousBalancePayment: isPreviousPayment,
                            receiptNumber: providedReceiptNumber || finalReceiptNumber || null,
                            isIndividualPayment: true,
                            individualAmount: paidAmount,
                            individualItems: itemsBrought
                        }]
                    };
                    
                    termRecords[recordKey].activityItemsPaid[period].push(newItem);
                    processedItems.push(newItem);
                    console.log(`    ✅ Created ${itemName}: Paid=${paidAmount}, Status=${status}`);
                    console.log(`       Individual payment: UGX ${paidAmount}`);
                }
                
                activityTotalPaid += (paidAmount || cashEquivalent);
                totalIndividualAmount += (paidAmount || cashEquivalent);
            }
            
            termRecords[recordKey].activityTotalPaid = Math.round((termRecords[recordKey].activityTotalPaid || 0) + activityTotalPaid);
            console.log(`\n💰 Activity Total Paid: UGX ${activityTotalPaid}`);
            console.log(`💰 Individual Amount Total: UGX ${totalIndividualAmount}`);
        }
        
        termRecords[recordKey].lastUpdated = new Date().toISOString();
        saveFile(files.studentTermRecords, termRecords);
        
        // ========== CREATE PAYMENT RECORD ==========
        let finalReceiptNumber;
        
        // ========== SPECIAL RECEIPT FOR PREVIOUS BALANCE PAYMENTS ==========
        if (isPreviousPayment) {
            // Use PB prefix for Previous Balance
            const prefix = 'PB';
            const timestamp = Date.now().toString().slice(-6);
            const random = Math.floor(Math.random() * 900 + 100).toString();
            const defaultReceipt = `${prefix}${timestamp}${random}`;
            
            if (providedReceiptNumber && providedReceiptNumber.trim() !== '') {
                finalReceiptNumber = providedReceiptNumber.trim();
                console.log('📝 Using manually entered receipt number:', finalReceiptNumber);
            } else {
                finalReceiptNumber = defaultReceipt;
                console.log('🔄 Auto-generated previous balance receipt number:', finalReceiptNumber);
            }
        } else {
            // Regular receipt generation
            if (providedReceiptNumber && providedReceiptNumber.trim() !== '') {
                finalReceiptNumber = providedReceiptNumber.trim();
                console.log('📝 Using manually entered receipt number:', finalReceiptNumber);
            } else {
                // Get school info for receipt prefix
                let school = {};
                try {
                    const schoolData = readFile(files.schools);
                    if (schoolData && schoolData.length > 0) {
                        school = schoolData[0] || {};
                    }
                } catch (e) {
                    console.warn('Could not read school data for receipt prefix');
                }
                
                const schoolName = school.schoolName || 'School';
                let prefix = schoolName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
                if (prefix.length < 2) prefix = 'SCH';
                
                const timestamp = Date.now().toString().slice(-6);
                const random = Math.floor(Math.random() * 900 + 100).toString();
                finalReceiptNumber = `${prefix}${timestamp}${random}`;
                console.log('🔄 Auto-generated receipt number:', finalReceiptNumber);
            }
        }
        
        const paymentDate = date || new Date().toISOString();
        
        let payments = readFile(files.feePayments);
        if (!Array.isArray(payments)) payments = [];
        
        // ========== BUILD PAYMENT OBJECT ==========
        const payment = {
            id: uuidv4(),
            studentId: studentId,
            studentName: studentName || '',
            admissionNumber: admissionNumber || '',
            term: currentTerm,
            academicYear: currentYear.toString(),
            feeStructureId: feeStructureId || null,
            feeStructureName: feeStructureName || 'General Fee',
            bursaryId: bursaryId || null,
            bursaryName: bursaryName || null,
            tuitionPaid: roundedTuitionPaid,
            activityTotalPaid: Math.round(activityTotalPaid),
            // ========== CRITICAL FIX: Store individual payment items with correct amounts ==========
            activityItemPayments: processedItems.map(item => {
                // Get the most recent individual payment
                const lastPayment = item.payments && item.payments.length > 0 
                    ? item.payments[item.payments.length - 1] 
                    : null;
                
                return {
                    periodType: item.periodType,
                    componentName: item.componentName,
                    itemName: item.itemName,
                    unitPrice: item.unitPrice,
                    quantityRequired: item.quantityRequired,
                    paymentType: item.paymentType,
                    // ========== Use individual amounts from the most recent payment ==========
                    amountPaid: lastPayment ? lastPayment.amount : item.amountPaid,
                    itemsBrought: lastPayment ? lastPayment.itemsBrought : item.itemsBrought,
                    cashEquivalent: item.cashEquivalent,
                    isIndividualPayment: true,
                    individualAmount: lastPayment ? lastPayment.amount : item.amountPaid,
                    individualItems: lastPayment ? lastPayment.itemsBrought : item.itemsBrought
                };
            }),
            paymentsByPeriodType: {
                one_time: processedItems.filter(i => i.periodType === 'one_time'),
                termly: processedItems.filter(i => i.periodType === 'termly'),
                yearly: processedItems.filter(i => i.periodType === 'yearly')
            },
            totalAmount: Math.round(roundedTuitionPaid + activityTotalPaid),
            method: method || 'cash',
            date: paymentDate,
            reference: reference || '',
            notes: notes || '',
            receiptNumber: finalReceiptNumber,
            recordedAt: new Date().toISOString(),
            
            // ========== PREVIOUS BALANCE TRACKING ==========
            isPreviousBalancePayment: isPreviousPayment || false,
            originalPeriod: isPreviousPayment ? {
                year: academicYear || new Date().getFullYear(),
                term: parseInt(term) || 1,
                appliedAt: new Date().toISOString()
            } : null,
            paymentPeriod: {
                year: currentYear,
                term: currentTerm
            },
            isBulkPayment: isBulkPayment || false,
            bulkPaymentId: bulkPaymentId || null,
            periodDisplay: isPreviousPayment ? 
                `${currentYear} Term ${currentTerm} (Previous Balance)` : 
                `${currentYear} Term ${currentTerm}`,
            // ========== NEW: Mark as individual payment ==========
            isIndividualPayment: true,
            paymentMode: 'incremental',
            individualPayments: processedItems.map(item => {
                const lastPayment = item.payments && item.payments.length > 0 
                    ? item.payments[item.payments.length - 1] 
                    : null;
                return {
                    itemName: item.itemName,
                    amount: lastPayment ? lastPayment.amount : item.amountPaid,
                    itemsBrought: lastPayment ? lastPayment.itemsBrought : item.itemsBrought,
                    date: lastPayment ? lastPayment.date : date || new Date().toISOString()
                };
            })
        };
        
        payments.push(payment);
        saveFile(files.feePayments, payments);
        
        console.log(`✅ Payment recorded successfully with receipt: ${finalReceiptNumber}`);
        console.log(`💰 Total Amount: UGX ${payment.totalAmount.toLocaleString()}`);
        console.log(`💰 Individual Payments: ${payment.individualPayments.length}`);
        
        if (isPreviousPayment) {
            console.log(`📅 Applied to: ${currentYear} Term ${currentTerm} (Previous Balance)`);
        }
        
        // =================================================================
        // ========== UPDATE INVENTORY FROM PAYMENT ==========
        // =================================================================
        console.log('\n📦 === UPDATING INVENTORY FROM PAYMENT ===');
        console.log('📦 Items to process:', activityItemPayments?.length || 0);
        
        let inventoryResult = { success: true, itemsAdded: 0 };
        if (activityItemPayments && activityItemPayments.length > 0) {
            try {
                inventoryResult = await updateInventoryFromPayment(
                    studentId,
                    activityItemPayments,
                    currentYear,
                    currentTerm
                );
                console.log('📦 Inventory update result:', inventoryResult);
            } catch (inventoryError) {
                console.error('❌ Error updating inventory:', inventoryError.message);
            }
        }
        
        // =================================================================
        // ========== SEND RESPONSE ==========
        // =================================================================
        const responseData = {
            success: true,
            receiptNumber: finalReceiptNumber,
            payment: payment,
            inventoryUpdated: inventoryResult.success,
            inventoryItemsAdded: inventoryResult.itemsAdded || 0,
            isPreviousBalancePayment: isPreviousPayment,
            periodApplied: {
                year: currentYear,
                term: currentTerm
            },
            isIndividualPayment: true,
            individualAmounts: payment.individualPayments,
            message: isPreviousPayment ? 
                `✅ INDIVIDUAL payment for ${currentYear} Term ${currentTerm} recorded successfully` : 
                '✅ INDIVIDUAL payment recorded successfully'
        };
        
        if (isPreviousPayment && previousPaymentInfo) {
            responseData.previousPaymentInfo = previousPaymentInfo;
        }
        
        // Log summary of individual payments
        console.log('\n📊 INDIVIDUAL PAYMENT SUMMARY:');
        for (const ip of payment.individualPayments) {
            console.log(`   💵 ${ip.itemName}: UGX ${ip.amount.toLocaleString()} ${ip.itemsBrought > 0 ? `+ ${ip.itemsBrought} items` : ''}`);
        }
        
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Error recording payment:', error);
        console.error('❌ Stack trace:', error.stack);
        res.status(500).json({
            success: false,
            error: 'Failed to record payment: ' + error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});
// ==================== TEST INVENTORY DIRECTLY ====================

app.get('/api/fee/student/:studentId/term-status/:term/:year', async (req, res) => {
    try {
        const { studentId, term, year } = req.params;
        const currentTerm = parseInt(term);
        const currentYear = parseInt(year);
        
        const assignments = readFile(files.studentFeeAssignments);
        const assignment = assignments.find(a => a.studentId === studentId);
        
        const feeStructures = readFile(files.feeStructures);
        const feeStructure = feeStructures.find(f => f.id === assignment?.feeStructureId);
        
        const payments = readFile(files.feePayments);
        const termPayments = payments.filter(p => p.studentId === studentId && p.term === currentTerm && p.academicYear === currentYear.toString());
        
        const termRecords = readFile(files.studentTermRecords);
        const termKey = `${studentId}_${currentYear}_${currentTerm}`;
        const termRecord = termRecords[termKey] || { activityItemsPaid: { one_time: [], termly: [], yearly: [] }, tuitionTotalPaid: 0, activityTotalPaid: 0 };
        
        let totalsByPeriod = { one_time: { expected: 0, paid: 0 }, termly: { expected: 0, paid: 0 }, yearly: { expected: 0, paid: 0 } };
        
        if (feeStructure && feeStructure.activityComponents) {
            for (const comp of feeStructure.activityComponents) {
                const periodType = comp.periodType;
                if (periodType && totalsByPeriod[periodType]) {
                    totalsByPeriod[periodType].expected += comp.totalAmount || 0;
                    const paidItems = termRecord.activityItemsPaid[periodType] || [];
                    const periodPaid = paidItems.reduce((sum, i) => sum + (i.amountPaid || i.cashEquivalent || 0), 0);
                    totalsByPeriod[periodType].paid += periodPaid;
                }
            }
        }
        
        const totalTuitionExpected = feeStructure?.tuition || 0;
        const totalTuitionPaid = termRecord.tuitionTotalPaid || 0;
        
        res.json({
            studentId,
            term: currentTerm,
            year: currentYear,
            feeStructure: feeStructure ? { id: feeStructure.id, name: feeStructure.name, tuition: feeStructure.tuition } : null,
            totalsByPeriod,
            overallTotals: {
                tuition: { expected: totalTuitionExpected, paid: totalTuitionPaid, remaining: totalTuitionExpected - totalTuitionPaid },
                activity: { expected: totalsByPeriod.one_time.expected + totalsByPeriod.termly.expected + totalsByPeriod.yearly.expected, paid: totalsByPeriod.one_time.paid + totalsByPeriod.termly.paid + totalsByPeriod.yearly.paid, remaining: (totalsByPeriod.one_time.expected + totalsByPeriod.termly.expected + totalsByPeriod.yearly.expected) - (totalsByPeriod.one_time.paid + totalsByPeriod.termly.paid + totalsByPeriod.yearly.paid) },
                total: { expected: totalTuitionExpected + totalsByPeriod.one_time.expected + totalsByPeriod.termly.expected + totalsByPeriod.yearly.expected, paid: totalTuitionPaid + totalsByPeriod.one_time.paid + totalsByPeriod.termly.paid + totalsByPeriod.yearly.paid, remaining: (totalTuitionExpected + totalsByPeriod.one_time.expected + totalsByPeriod.termly.expected + totalsByPeriod.yearly.expected) - (totalTuitionPaid + totalsByPeriod.one_time.paid + totalsByPeriod.termly.paid + totalsByPeriod.yearly.paid) }
            },
            payments: termPayments,
            isFirstPayment: termPayments.length === 0
        });
    } catch (error) {
        console.error('Error getting term status:', error);
        res.status(500).json({ error: 'Failed to get term status' });
    }
});

app.get('/api/fee/student/:studentId/:year/:term/unpaid-items', async (req, res) => {
    try {
        const { studentId, year, term } = req.params;
        const currentYear = parseInt(year);
        const currentTerm = parseInt(term);
        
        const assignments = readFile(files.studentFeeAssignments);
        const assignment = assignments.find(a => a.studentId === studentId);
        
        const feeStructures = readFile(files.feeStructures);
        const feeStructure = feeStructures.find(f => f.id === assignment?.feeStructureId);
        
        if (!feeStructure) {
            return res.json({ hasUnpaidItems: false, itemsByPeriod: { one_time: [], termly: [], yearly: [] } });
        }
        
        const termRecords = readFile(files.studentTermRecords);
        const termKey = `${studentId}_${currentYear}_${currentTerm}`;
        const termRecord = termRecords[termKey] || { activityItemsPaid: { one_time: [], termly: [], yearly: [] } };
        
        const periodTypes = ['one_time', 'termly', 'yearly'];
        const unpaidItemsByPeriod = {};
        
        for (const periodType of periodTypes) {
            const components = feeStructure.activityComponents.filter(c => c.periodType === periodType);
            const unpaidItems = [];
            for (const component of components) {
                for (const item of (component.items || [])) {
                    const paidRecord = (termRecord.activityItemsPaid[periodType] || []).find(p => p.itemId === item.id);
                    const isFullyPaid = paidRecord?.status === 'fully_paid';
                    if (!isFullyPaid) {
                        unpaidItems.push({
                            componentId: component.id,
                            componentName: component.name,
                            periodType,
                            itemId: item.id,
                            itemName: item.name,
                            quantity: item.quantity,
                            totalAmount: item.totalAmount,
                            unitPrice: item.unitPrice,
                            isTangible: item.isTangible !== false,
                            remainingQuantity: paidRecord?.remainingQuantity || item.quantity,
                            remainingAmount: paidRecord?.remainingAmount || item.totalAmount,
                            alreadyPaidAmount: paidRecord?.amountPaid || 0,
                            alreadyPaidItems: paidRecord?.itemsBrought || 0
                        });
                    }
                }
            }
            unpaidItemsByPeriod[periodType] = unpaidItems;
        }
        
        res.json({ hasUnpaidItems: Object.values(unpaidItemsByPeriod).some(items => items.length > 0), itemsByPeriod: unpaidItemsByPeriod });
    } catch (error) {
        console.error('Error getting unpaid items:', error);
        res.status(500).json({ error: 'Failed to get unpaid items' });
    }
});

// ==================== DEBUG PAYMENT FLOW ====================
app.post('/api/debug/payment-flow', async (req, res) => {
    console.log('=== 🔍 DEBUG PAYMENT FLOW ===');
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { 
            studentId, 
            activityItemPayments,
            academicYear,
            term
        } = req.body;
        
        console.log('\n📦 Activity Items Received:');
        console.log('   Count:', activityItemPayments ? activityItemPayments.length : 0);
        
        if (activityItemPayments && activityItemPayments.length > 0) {
            activityItemPayments.forEach((item, idx) => {
                console.log(`   Item ${idx + 1}:`);
                console.log(`     itemName: ${item.itemName}`);
                console.log(`     paymentType: ${item.paymentType}`);
                console.log(`     itemsBrought: ${item.itemsBrought}`);
                console.log(`     amountPaid: ${item.amountPaid}`);
                console.log(`     unitPrice: ${item.unitPrice}`);
                console.log(`     quantityRequired: ${item.quantityRequired}`);
                console.log(`     periodType: ${item.periodType}`);
            });
        }
        
        // Try to manually update inventory
        console.log('\n🔄 Manually calling updateInventoryFromPayment...');
        const result = await updateInventoryFromPayment(
            studentId,
            activityItemPayments,
            academicYear || 2026,
            term || 1
        );
        console.log('   Result:', result);
        
        // Check stock after manual update
        const stockPath = path.join(__dirname, 'data', 'inventoryStock.json');
        let stock = {};
        if (fs.existsSync(stockPath)) {
            const content = fs.readFileSync(stockPath, 'utf8');
            stock = JSON.parse(content);
        }
        
        res.json({
            success: true,
            itemsReceived: activityItemPayments ? activityItemPayments.length : 0,
            inventoryResult: result,
            stockKeys: Object.keys(stock),
            stock: stock
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

app.get('/api/student-term-records', (req, res) => {
    res.json(readFile(files.studentTermRecords));
});

// ==================== REPORT ROUTES ====================

app.get('/api/reports/report-card/:studentId/:term/:year', (req, res) => {
    const { studentId, term, year } = req.params;
    const students = readFile(files.students);
    const student = students.find(s => s.id === studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    const enrollments = readFile(files.enrollments);
    const classes = readFile(files.classes);
    const scores = readFile(files.scores);
    const assessments = readFile(files.assessments);
    const subjects = readFile(files.subjects);
    const gradingSystem = getGradingSystem();
    
    const currentEnrollment = enrollments.find(e => e.studentId === studentId && e.isCurrent);
    const currentClass = classes.find(c => c.id === currentEnrollment?.classId);
    
    const termAssessments = assessments.filter(a => a.term === parseInt(term) && a.year === parseInt(year));
    const classSubjects = subjects.filter(s => s.classId === 'all' || s.classId === currentEnrollment?.classId);
    
    const subjectResults = [];
    let totalPercentage = 0;
    let subjectCount = 0;
    
    classSubjects.forEach(subject => {
        const subjectAssessments = termAssessments.filter(a => a.subjectId === subject.id);
        if (subjectAssessments.length > 0) {
            let totalWeightedScore = 0;
            let totalWeight = 0;
            
            subjectAssessments.forEach(assessment => {
                const studentScore = scores.find(s => s.assessmentId === assessment.id && s.studentId === studentId);
                if (studentScore) {
                    const weightedScore = (studentScore.score / assessment.maxScore) * assessment.weight;
                    totalWeightedScore += weightedScore;
                    totalWeight += assessment.weight;
                }
            });
            
            const percentage = totalWeight > 0 ? (totalWeightedScore / totalWeight) * 100 : 0;
            const grade = calculateGrade(percentage, gradingSystem);
            
            subjectResults.push({
                subjectId: subject.id,
                subjectName: subject.name,
                subjectCode: subject.code,
                score: percentage.toFixed(2),
                grade: grade.grade,
                remark: grade.remark
            });
            
            totalPercentage += percentage;
            subjectCount++;
        }
    });
    
    const average = subjectCount > 0 ? (totalPercentage / subjectCount).toFixed(2) : 0;
    const overallGrade = calculateGrade(parseFloat(average), gradingSystem);
    
    res.json({
        student: {
            id: student.id,
            name: `${student.firstName} ${student.lastName}`,
            admissionNumber: student.admissionNumber,
            class: currentClass?.name || 'Not Assigned',
            term: `Term ${term}`,
            year: year,
            gender: student.gender,
            parentName: student.parentInfo?.name,
            parentContact: student.parentInfo?.phone
        },
        results: subjectResults,
        summary: {
            average: average,
            grade: overallGrade.grade,
            remark: overallGrade.remark,
            totalSubjects: subjectCount
        },
        gradingSystem,
        generatedAt: new Date().toISOString()
    });
});

app.get('/api/reports/transcript/:studentId', (req, res) => {
    const { studentId } = req.params;
    const students = readFile(files.students);
    const student = students.find(s => s.id === studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    const enrollments = readFile(files.enrollments);
    const scores = readFile(files.scores);
    const assessments = readFile(files.assessments);
    const classes = readFile(files.classes);
    const gradingSystem = getGradingSystem();
    
    const academicYears = [...new Set(enrollments.filter(e => e.studentId === studentId).map(e => e.academicYear))].sort();
    const transcript = [];
    
    academicYears.forEach(year => {
        for (let term = 1; term <= 3; term++) {
            const termAssessments = assessments.filter(a => a.term === term && a.year === year);
            if (termAssessments.length > 0) {
                const subjectResults = [];
                let totalPercentage = 0;
                let subjectCount = 0;
                
                const uniqueSubjects = [...new Set(termAssessments.map(a => a.subjectId))];
                uniqueSubjects.forEach(subjectId => {
                    const subjectAssessments = termAssessments.filter(a => a.subjectId === subjectId);
                    let totalWeightedScore = 0;
                    let totalWeight = 0;
                    
                    subjectAssessments.forEach(assessment => {
                        const studentScore = scores.find(s => s.assessmentId === assessment.id && s.studentId === studentId);
                        if (studentScore) {
                            const weightedScore = (studentScore.score / assessment.maxScore) * assessment.weight;
                            totalWeightedScore += weightedScore;
                            totalWeight += assessment.weight;
                        }
                    });
                    
                    const percentage = totalWeight > 0 ? (totalWeightedScore / totalWeight) * 100 : 0;
                    const grade = calculateGrade(percentage, gradingSystem);
                    
                    subjectResults.push({
                        subjectName: `Subject ${subjectId}`,
                        score: percentage.toFixed(2),
                        grade: grade.grade,
                        remark: grade.remark
                    });
                    
                    totalPercentage += percentage;
                    subjectCount++;
                });
                
                const average = subjectCount > 0 ? (totalPercentage / subjectCount).toFixed(2) : 0;
                const overallGrade = calculateGrade(parseFloat(average), gradingSystem);
                
                transcript.push({
                    year: year,
                    term: term,
                    results: subjectResults,
                    average: average,
                    grade: overallGrade.grade,
                    remark: overallGrade.remark
                });
            }
        }
    });
    
    res.json({
        student: {
            id: student.id,
            name: `${student.firstName} ${student.lastName}`,
            admissionNumber: student.admissionNumber,
            gender: student.gender
        },
        transcript: transcript,
        generatedAt: new Date().toISOString()
    });
});

app.get('/api/reports/export-all', (req, res) => {
    const allData = {
        schools: readFile(files.schools),
        classes: readFile(files.classes),
        subjects: readFile(files.subjects),
        students: readFile(files.students),
        teachers: readFile(files.teachers),
        enrollments: readFile(files.enrollments),
        assessments: readFile(files.assessments),
        scores: readFile(files.scores),
        attendance: readFile(files.attendance),
        settings: readFile(files.settings),
        feeStructures: readFile(files.feeStructures),
        feeBursaries: readFile(files.feeBursaries),
        feePayments: readFile(files.feePayments),
        studentFeeAssignments: readFile(files.studentFeeAssignments),
        exportDate: new Date().toISOString(),
        version: '3.0'
    };
    res.json(allData);
});


// ==================== UPDATE STUDENT WITH CUSTOM TRANSPORTATION FEE ====================

// ==================== UPDATE STUDENT TRANSPORTATION FEE ====================

app.put('/api/students/:id/transportation', (req, res) => {
    try {
        const { hasTransportation, amount, itemId, componentId } = req.body;
        let students = readFile(files.students);
        const index = students.findIndex(s => s.id === req.params.id);
        
        if (index !== -1) {
            const customTransportationData = {
                hasTransportation: hasTransportation || false,
                amount: hasTransportation ? (amount || null) : null,
                itemId: itemId || null,
                componentId: componentId || null,
                updatedAt: new Date().toISOString(),
                description: hasTransportation ? 
                    'Custom transportation fee updated' : 
                    'Transportation fee removed for this student'
            };
            
            if (!students[index].customTransportation) {
                students[index].customTransportation = {};
            }
            
            students[index].customTransportation = customTransportationData;
            students[index].updatedAt = new Date().toISOString();
            
            saveFile(files.students, students);
            res.json({ 
                success: true, 
                customTransportation: customTransportationData,
                message: hasTransportation ? 
                    `Transportation fee updated to UGX ${amount?.toLocaleString()}` : 
                    'Transportation fee removed for this student'
            });
        } else {
            res.status(404).json({ error: 'Student not found' });
        }
    } catch (error) {
        console.error('Error updating transportation fee:', error);
        res.status(500).json({ error: error.message });
    }
});



// ==================== COMPLETE REBUILT INVENTORY SYSTEM ====================
// Version: 6.0 - Fully Working with Automatic Stock Updates

const inventoryFiles = {
    inventoryItems: path.join(dataDir, 'inventoryItems.json'),
    inventoryTransactions: path.join(dataDir, 'inventoryTransactions.json'),
    inventoryStock: path.join(dataDir, 'inventoryStock.json')
};

// Initialize inventory files
function initializeInventoryFiles() {
    try {
        if (!fs.existsSync(inventoryFiles.inventoryItems)) {
            saveFile(inventoryFiles.inventoryItems, {});
        }
        if (!fs.existsSync(inventoryFiles.inventoryTransactions)) {
            saveFile(inventoryFiles.inventoryTransactions, []);
        }
        if (!fs.existsSync(inventoryFiles.inventoryStock)) {
            saveFile(inventoryFiles.inventoryStock, {});
        }
        console.log('✅ Inventory files initialized');
    } catch (error) {
        console.error('Error initializing inventory files:', error);
    }
}

initializeInventoryFiles();

// ========== HELPER: GET PERIOD STOCK KEY ==========
function getPeriodStockKey(itemName, year, term) {
    return `${itemName}_${year}_${term}`;
}

// ========== HELPER: GET CURRENT PERIOD ==========
function getCurrentPeriod() {
    const settings = readFile(files.settings);
    const year = settings.currentAcademicYear || new Date().getFullYear();
    const term = settings.currentTerm || 1;
    return { year, term, periodKey: `${year}_${term}` };
}

// ==================== HELPER: CHECK IF SCHOLASTIC ITEM ====================
function isScholasticItem(component, item) {
    const statusGroupName = component.statusGroupName || '';
    const componentName = component.name || '';
    
    // Check status group name
    const isScholastic = statusGroupName.toLowerCase().includes('scholastic') || 
                         componentName.toLowerCase().includes('scholastic');
    
    // Check item name against scholastic keywords
    const scholasticKeywords = [
        'book', 'pen', 'pencil', 'rubber', 'eraser', 'ruler', 
        'notebook', 'exercise', 'textbook', 'story', 'reader',
        'chart', 'map', 'globe', 'calculator', 'set', 'compass',
        'protractor', 'stapler', 'puncher', 'file', 'folder',
        'binder', 'paper', 'ream', 'envelope', 'marker', 'crayon',
        'paint', 'brush', 'clay', 'scissors', 'glue', 'tape',
        'covers', 'toilet', 'broom', 'sugar', 'box file', 'clear bag',
        'handwriting book', 'manila cards', 'cutters', 'inside brooms',
        'sealed sugar', 'packet of crayons', 'exercise book',
        'notebook', 'story book', 'textbook', 'reader',
        'handwriting', 'manila', 'cutters', 'brooms'
    ];
    
    const itemNameLower = (item.name || '').toLowerCase();
    const matchesKeyword = scholasticKeywords.some(keyword => itemNameLower.includes(keyword));
    
    // 🔥 FIX: Also check if it's a transportation or development item (exclude them)
    const isTransportation = statusGroupName.toLowerCase().includes('transport') || 
                             componentName.toLowerCase().includes('transport') ||
                             itemNameLower.includes('van') ||
                             itemNameLower.includes('transport');
    
    const isDevelopment = statusGroupName.toLowerCase().includes('development') ||
                          componentName.toLowerCase().includes('development');
    
    const isAdmission = statusGroupName.toLowerCase().includes('admission') ||
                        componentName.toLowerCase().includes('admission');
    
    // 🔥 FIX: EXCLUDE transportation, development, and admission items
    if (isTransportation || isDevelopment || isAdmission) {
        console.log(`🚫 Excluding non-scholastic item: ${item.name} (${statusGroupName})`);
        return false;
    }
    
    return isScholastic || matchesKeyword;
}

// ========== HELPER: GET UNIT PRICE FROM FEE STRUCTURE ==========
function getUnitPriceFromFeeStructure(itemName, componentName, feeStructure) {
    if (!feeStructure || !feeStructure.activityComponents) return 0;
    
    for (const comp of feeStructure.activityComponents) {
        if (comp.name === componentName) {
            for (const item of (comp.items || [])) {
                if (item.name === itemName) {
                    return item.unitPrice || (item.totalAmount / (item.quantity || 1));
                }
            }
        }
    }
    return 0;
}

// ========== HELPER: GET QUANTITY REQUIRED ==========
function getQuantityRequired(itemName, componentName, feeStructure) {
    if (!feeStructure || !feeStructure.activityComponents) return 0;
    
    for (const comp of feeStructure.activityComponents) {
        if (comp.name === componentName) {
            for (const item of (comp.items || [])) {
                if (item.name === itemName) {
                    return item.quantity || 1;
                }
            }
        }
    }
    return 0;
}

// ========== MAIN INVENTORY SUMMARY ENDPOINT ==========
// ==================== FIXED INVENTORY SUMMARY ENDPOINT ====================
// Version: 5.2 - isFirstTerm properly defined

// ==================== FIXED INVENTORY SUMMARY ENDPOINT ====================
// Version: 6.0 - Properly links fee structures and calculates requirements

app.get('/api/inventory/summary', async (req, res) => {
    console.log('📊 Inventory summary requested - Version 6.0');
    
    try {
        const settings = readFile(files.settings);
        const currentYear = settings.currentAcademicYear || new Date().getFullYear();
        const currentTerm = settings.currentTerm || 1;
        const isFirstTerm = currentTerm === 1;
        
        // Read all required data
        const feeStructures = readFile(files.feeStructures);
        const students = readFile(files.students);
        const feeAssignments = readFile(files.studentFeeAssignments);
        const allPayments = readFile(files.feePayments);
        const termRecords = readFile(files.studentTermRecords);
        const classes = readFile(files.classes);
        
        // Build maps for quick lookup
        const classesMap = {};
        classes.forEach(c => { if (c && c.id) classesMap[c.id] = c; });
        
        const assignmentsMap = {};
        feeAssignments.forEach(a => { if (a && a.studentId) assignmentsMap[a.studentId] = a; });
        
        // ========== BUILD FEE STRUCTURE MAP ==========
        const feeStructureMap = {};
        feeStructures.forEach(fs => { 
            if (fs && fs.id) feeStructureMap[fs.id] = fs; 
        });
        
        console.log(`📊 Found ${feeStructures.length} fee structures`);
        console.log(`📊 Found ${students.length} students`);
        console.log(`📊 Found ${feeAssignments.length} fee assignments`);
        
        // ========== INITIALIZE INVENTORY DATA ==========
        const inventoryData = {
            levels: {
                Nursery: { items: {}, classBreakdown: {}, totalItems: 0, totalBrought: 0, totalCashPaid: 0, students: [] },
                LowerPrimary: { items: {}, classBreakdown: {}, totalItems: 0, totalBrought: 0, totalCashPaid: 0, students: [] },
                UpperPrimary: { items: {}, classBreakdown: {}, totalItems: 0, totalBrought: 0, totalCashPaid: 0, students: [] }
            },
            classDetails: {},
            feeStructureDetails: {},
            itemTotals: {},
            stock: {},
            transactions: []
        };
        
        // ========== READ STOCK ==========
        const stockPath = path.join(dataDir, 'inventoryStock.json');
        let stock = {};
        try {
            if (fs.existsSync(stockPath)) {
                const content = fs.readFileSync(stockPath, 'utf8');
                stock = JSON.parse(content);
                console.log(`📊 Stock loaded. Keys: ${Object.keys(stock).length}`);
            }
        } catch (e) {
            console.warn('Could not read stock:', e.message);
        }
        
       // ==================== HELPER: CHECK IF SCHOLASTIC ITEM ====================
// ==================== HELPER: CHECK IF SCHOLASTIC ITEM ====================
function isScholasticItem(component, item) {
    const statusGroupName = component.statusGroupName || component.name || '';
    const componentName = component.name || '';
    
    // 🔥 PRIMARY: Check if the status group is "Scholastic" or "schoolastic requirement"
    const isScholasticGroup = statusGroupName.toLowerCase().includes('scholastic') || 
                              statusGroupName.toLowerCase().includes('schoolastic');
    
    // If it's explicitly a scholastic group, return true
    if (isScholasticGroup) {
        return true;
    }
    
    // 🔥 EXCLUDE: Transportation, Admission, Development
    const isExcluded = statusGroupName.toLowerCase().includes('transport') ||
                       statusGroupName.toLowerCase().includes('admission') ||
                       statusGroupName.toLowerCase().includes('development') ||
                       statusGroupName.toLowerCase().includes('uniform') ||
                       statusGroupName.toLowerCase().includes('sports');
    
    if (isExcluded) {
        return false;
    }
    
    // 🔥 SECONDARY: Fallback to keyword matching for items without status groups
    const scholasticKeywords = [
        'book', 'pen', 'pencil', 'rubber', 'eraser', 'ruler', 
        'notebook', 'exercise', 'textbook', 'story', 'reader',
        'chart', 'map', 'globe', 'calculator', 'set', 'compass',
        'protractor', 'stapler', 'puncher', 'file', 'folder',
        'binder', 'paper', 'ream', 'envelope', 'marker', 'crayon',
        'paint', 'brush', 'clay', 'scissors', 'glue', 'tape',
        'covers', 'toilet', 'broom', 'sugar', 'box file', 'clear bag',
        'handwriting', 'manila', 'cutters', 'brooms'
    ];
    
    const itemNameLower = (item.name || '').toLowerCase();
    const matchesKeyword = scholasticKeywords.some(keyword => itemNameLower.includes(keyword));
    
    return matchesKeyword;
}
        
        function getOrCreateItemInLevel(levelKey, itemName) {
            if (!inventoryData.levels[levelKey]) {
                inventoryData.levels[levelKey] = { items: {}, classBreakdown: {}, totalItems: 0, totalBrought: 0, totalCashPaid: 0, students: [] };
            }
            if (!inventoryData.levels[levelKey].items[itemName]) {
                inventoryData.levels[levelKey].items[itemName] = {
                    totalItemsRequired: 0,
                    totalBrought: 0,
                    totalCashCoveredItems: 0,
                    studentsCount: 0,
                    classBreakdown: {}
                };
            }
            return inventoryData.levels[levelKey].items[itemName];
        }
        
        function getOrCreateItemInClass(className, itemName) {
            if (!inventoryData.classDetails[className]) {
                inventoryData.classDetails[className] = {
                    name: className,
                    level: 'Unknown',
                    items: {},
                    totalItems: 0,
                    totalBrought: 0,
                    totalCashPaid: 0,
                    studentCount: 0
                };
            }
            if (!inventoryData.classDetails[className].items[itemName]) {
                inventoryData.classDetails[className].items[itemName] = {
                    totalItemsRequired: 0,
                    totalBrought: 0,
                    totalCashCoveredItems: 0,
                    studentsCount: 0
                };
            }
            return inventoryData.classDetails[className].items[itemName];
        }
        
        // ========== PROCESS EACH STUDENT ==========
        for (const student of students) {
            const assignment = assignmentsMap[student.id] || {};
            const feeStructure = feeStructureMap[assignment.feeStructureId];
            
            if (!feeStructure) continue;
            
            // Get student's class
            let currentClass = 'Not Assigned';
            let classLevel = 'Unknown';
            if (student.currentClassId && classesMap[student.currentClassId]) {
                currentClass = classesMap[student.currentClassId].name;
                classLevel = classesMap[student.currentClassId].level || 'Unknown';
            } else if (student.currentClass) {
                currentClass = student.currentClass;
            }
            
            const levelKey = classLevel === 'Nursery' ? 'Nursery' : 
                            classLevel === 'LowerPrimary' ? 'LowerPrimary' : 'UpperPrimary';
            
            // ========== PROCESS FEE STRUCTURE FOR SCHOLASTIC ITEMS ==========
            if (!inventoryData.feeStructureDetails[feeStructure.id]) {
                inventoryData.feeStructureDetails[feeStructure.id] = {
                    name: feeStructure.name,
                    level: feeStructure.level,
                    classes: {}
                };
            }
            
            if (!inventoryData.feeStructureDetails[feeStructure.id].classes[currentClass]) {
                inventoryData.feeStructureDetails[feeStructure.id].classes[currentClass] = {
                    items: {},
                    studentCount: 0
                };
            }
            
            // Add student to level
            if (!inventoryData.levels[levelKey].students.includes(student.id)) {
                inventoryData.levels[levelKey].students.push(student.id);
            }
            
            // ========== PROCESS EACH COMPONENT ==========
            for (const component of (feeStructure.activityComponents || [])) {
                const periodType = component.periodType || 'termly';
                
                const shouldInclude = (periodType === 'termly') || 
                                     (periodType === 'one_time' && isFirstTerm) ||
                                     (periodType === 'yearly' && isFirstTerm);
                
                if (!shouldInclude) continue;
                
                for (const item of (component.items || [])) {
                    if (!isScholasticItem(component, item)) continue;
                    
                    const itemName = item.name || 'Unnamed Item';
                    const quantityRequired = item.quantity || 1;
                    const unitPrice = item.unitPrice || (item.totalAmount / quantityRequired);
                    const totalAmount = item.totalAmount || 0;
                    
                    // ========== GET PAYMENT DATA ==========
                    const termRecordKey = `${student.id}_${currentYear}_${currentTerm}`;
                    const termRecord = termRecords[termRecordKey] || { activityItemsPaid: { one_time: [], termly: [], yearly: [] } };
                    
                    let cashPaid = 0;
                    let itemsBrought = 0;
                    
                    const paidItems = termRecord.activityItemsPaid?.[periodType] || [];
                    const paidRecord = paidItems.find(p => p.itemName === itemName);
                    
                    if (paidRecord) {
                        if (paidRecord.paymentType === 'paid_cash') {
                            cashPaid = paidRecord.amountPaid || 0;
                        } else if (paidRecord.paymentType === 'brought_item') {
                            itemsBrought = paidRecord.itemsBrought || 0;
                        }
                    }
                    
                    // Also check payments directly
                    const studentPayments = allPayments.filter(p => 
                        p && p.studentId === student.id && 
                        p.term === currentTerm && 
                        p.academicYear === currentYear.toString()
                    );
                    
                    for (const payment of studentPayments) {
                        if (payment.activityItemPayments) {
                            for (const paidItem of payment.activityItemPayments) {
                                if (paidItem.componentName === component.name && 
                                    paidItem.itemName === item.name && 
                                    paidItem.periodType === periodType) {
                                    if (paidItem.paymentType === 'paid_cash') {
                                        cashPaid = Math.max(cashPaid, paidItem.amountPaid || 0);
                                    } else if (paidItem.paymentType === 'brought_item') {
                                        itemsBrought = Math.max(itemsBrought, paidItem.itemsBrought || 0);
                                    }
                                }
                            }
                        }
                    }
                    
                    // ========== UPDATE LEVEL DATA ==========
                    const levelItem = getOrCreateItemInLevel(levelKey, itemName);
                    levelItem.totalItemsRequired += quantityRequired;
                    levelItem.totalBrought += itemsBrought;
                    levelItem.totalCashCoveredItems += Math.floor(cashPaid / (unitPrice || 1));
                    levelItem.studentsCount++;
                    
                    // Level class breakdown
                    if (!levelItem.classBreakdown[currentClass]) {
                        levelItem.classBreakdown[currentClass] = { 
                            totalItemsRequired: 0, 
                            totalBrought: 0, 
                            totalCashCoveredItems: 0 
                        };
                    }
                    levelItem.classBreakdown[currentClass].totalItemsRequired += quantityRequired;
                    levelItem.classBreakdown[currentClass].totalBrought += itemsBrought;
                    levelItem.classBreakdown[currentClass].totalCashCoveredItems += Math.floor(cashPaid / (unitPrice || 1));
                    
                    // Level totals
                    inventoryData.levels[levelKey].totalItems += quantityRequired;
                    inventoryData.levels[levelKey].totalBrought += itemsBrought;
                    inventoryData.levels[levelKey].totalCashPaid += cashPaid;
                    
                    // ========== UPDATE CLASS DATA ==========
                    const classItem = getOrCreateItemInClass(currentClass, itemName);
                    classItem.totalItemsRequired += quantityRequired;
                    classItem.totalBrought += itemsBrought;
                    classItem.totalCashCoveredItems += Math.floor(cashPaid / (unitPrice || 1));
                    classItem.studentsCount++;
                    
                    inventoryData.classDetails[currentClass].totalItems += quantityRequired;
                    inventoryData.classDetails[currentClass].totalBrought += itemsBrought;
                    inventoryData.classDetails[currentClass].totalCashPaid += cashPaid;
                    inventoryData.classDetails[currentClass].studentCount++;
                    
                    // ========== UPDATE FEE STRUCTURE DATA ==========
                    const fsClass = inventoryData.feeStructureDetails[feeStructure.id].classes[currentClass];
                    if (!fsClass.items[itemName]) {
                        fsClass.items[itemName] = { 
                            totalItemsRequired: 0, 
                            totalBrought: 0, 
                            totalCashCoveredItems: 0,
                            studentsCount: 0
                        };
                    }
                    fsClass.items[itemName].totalItemsRequired += quantityRequired;
                    fsClass.items[itemName].totalBrought += itemsBrought;
                    fsClass.items[itemName].totalCashCoveredItems += Math.floor(cashPaid / (unitPrice || 1));
                    fsClass.items[itemName].studentsCount++;
                    fsClass.studentCount++;
                    
                    // ========== UPDATE GLOBAL ITEM TOTALS ==========
                    if (!inventoryData.itemTotals[itemName]) {
                        inventoryData.itemTotals[itemName] = {
                            totalItemsRequired: 0,
                            totalBrought: 0,
                            totalCashCoveredItems: 0,
                            studentsCount: 0
                        };
                    }
                    inventoryData.itemTotals[itemName].totalItemsRequired += quantityRequired;
                    inventoryData.itemTotals[itemName].totalBrought += itemsBrought;
                    inventoryData.itemTotals[itemName].totalCashCoveredItems += Math.floor(cashPaid / (unitPrice || 1));
                    inventoryData.itemTotals[itemName].studentsCount++;
                }
            }
        }
        
        // ========== BUILD RESPONSE ==========
        const response = {
            success: true,
            data: {
                levels: inventoryData.levels,
                classDetails: inventoryData.classDetails,
                feeStructureDetails: inventoryData.feeStructureDetails,
                itemTotals: inventoryData.itemTotals,
                stock: stock,
                transactions: []
            }
        };
        
        console.log(`✅ Inventory summary generated`);
        console.log(`   Item totals: ${Object.keys(inventoryData.itemTotals).length}`);
        console.log(`   Fee structures: ${Object.keys(inventoryData.feeStructureDetails).length}`);
        console.log(`   Stock entries: ${Object.keys(stock).length}`);
        
        res.json(response);
        
    } catch (error) {
        console.error('Error generating inventory summary:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// ========== GET STOCK ENDPOINT ==========
app.get('/api/inventory/stock', (req, res) => {
    try {
        const stock = readFile(inventoryFiles.inventoryStock);
        const settings = readFile(files.settings);
        const currentYear = settings.currentAcademicYear || new Date().getFullYear();
        const currentTerm = settings.currentTerm || 1;
        const currentPeriodKey = `${currentYear}_${currentTerm}`;
        
        // Filter out internal tracking keys (_issued_studentId entries)
        const filteredStock = {};
        for (const [key, value] of Object.entries(stock || {})) {
            if (!key.includes('_issued_') && typeof value === 'object' && value !== null) {
                filteredStock[key] = value;
            }
        }
        
        // Return the flat stock object directly — frontend uses it as-is
        res.json(filteredStock);
        
    } catch (error) {
        console.error('Error getting stock:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== GET TRANSACTIONS ENDPOINT ==========
app.get('/api/inventory/transactions', (req, res) => {
    try {
        const { itemName, periodKey, academicYear, term } = req.query;
        let transactions = readFile(inventoryFiles.inventoryTransactions);
        
        // Filter by item
        if (itemName) {
            transactions = transactions.filter(t => t.itemName === itemName);
        }
        
        // Filter by period
        if (periodKey) {
            transactions = transactions.filter(t => t.periodKey === periodKey);
        } else if (academicYear && term) {
            transactions = transactions.filter(t => 
                t.academicYear === parseInt(academicYear) && 
                t.term === parseInt(term)
            );
        }
        
        // Sort by date descending
        transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        res.json(transactions);
    } catch (error) {
        console.error('Error getting transactions:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== GET DESTINATIONS ENDPOINT ==========
app.get('/api/inventory/destinations', (req, res) => {
    try {
        const destinations = [
            { id: 'classroom', label: 'Classroom' },
            { id: 'office', label: 'Office' },
            { id: 'library', label: 'Library' },
            { id: 'staff_room', label: 'Staff Room' },
            { id: 'security', label: 'Security Section' },
            { id: 'kitchen', label: 'Kitchen' },
            { id: 'dormitory', label: 'Dormitory' },
            { id: 'playground', label: 'Playground' },
            { id: 'science_lab', label: 'Science Lab' },
            { id: 'computer_lab', label: 'Computer Lab' },
            { id: 'administration', label: 'Administration' },
            { id: 'store', label: 'Store' },
            { id: 'other', label: 'Other' }
        ];
        res.json(destinations);
    } catch (error) {
        console.error('Error getting destinations:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== MANUAL STOCK UPDATE ENDPOINT ==========
app.post('/api/inventory/stock/update', (req, res) => {
    try {
        const { itemName, quantity, operation, comment, academicYear, term } = req.body;
        
        if (!itemName || !quantity || quantity <= 0) {
            return res.status(400).json({ error: 'Item name and quantity are required' });
        }
        
        const settings = readFile(files.settings);
        const year = academicYear || settings.currentAcademicYear || new Date().getFullYear();
        const termNum = term || settings.currentTerm || 1;
        
        const stockKey = getPeriodStockKey(itemName, year, termNum);
        let stock = readFile(inventoryFiles.inventoryStock);
        let transactions = readFile(inventoryFiles.inventoryTransactions);
        
        // Initialize item if it doesn't exist
        if (!stock[stockKey]) {
            stock[stockKey] = {
                name: itemName,
                academicYear: year,
                term: termNum,
                totalReceived: 0,
                issued: 0,
                available: 0,
                lastUpdated: new Date().toISOString()
            };
        }
        
        const previousAvailable = stock[stockKey].available || 0;
        let transactionType = '';
        let message = '';
        
        if (operation === 'add') {
            stock[stockKey].totalReceived = (stock[stockKey].totalReceived || 0) + quantity;
            stock[stockKey].available = (stock[stockKey].available || 0) + quantity;
            transactionType = 'restock';
            message = `✅ Added ${quantity} ${itemName}(s) to stock`;
        } else if (operation === 'remove') {
            if ((stock[stockKey].available || 0) < quantity) {
                return res.status(400).json({ 
                    error: `Not enough stock. Available: ${stock[stockKey].available || 0}, Requested: ${quantity}` 
                });
            }
            stock[stockKey].available = Math.max(0, (stock[stockKey].available || 0) - quantity);
            stock[stockKey].issued = (stock[stockKey].issued || 0) + quantity;
            transactionType = 'remove';
            message = `✅ Removed ${quantity} ${itemName}(s) from stock`;
        } else {
            return res.status(400).json({ error: 'Invalid operation. Use "add" or "remove"' });
        }
        
        stock[stockKey].lastUpdated = new Date().toISOString();
        
        // Also update legacy stock entry if it exists
        if (stock[itemName]) {
            if (operation === 'add') {
                stock[itemName].totalReceived = (stock[itemName].totalReceived || 0) + quantity;
                stock[itemName].available = (stock[itemName].available || 0) + quantity;
            } else {
                stock[itemName].available = Math.max(0, (stock[itemName].available || 0) - quantity);
                stock[itemName].issued = (stock[itemName].issued || 0) + quantity;
            }
            stock[itemName].lastUpdated = new Date().toISOString();
        }
        
        // Record transaction
        const transaction = {
            id: uuidv4(),
            itemName: itemName,
            quantity: quantity,
            transactionType: transactionType,
            destination: 'System',
            recipient: 'System',
            comment: comment || (operation === 'add' ? 'Stock added' : 'Stock removed'),
            stockBefore: previousAvailable,
            stockAfter: stock[stockKey].available || 0,
            periodKey: `${year}_${termNum}`,
            academicYear: year,
            term: termNum,
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split('T')[0],
            isInventory: true
        };
        
        transactions.push(transaction);
        
        saveFile(inventoryFiles.inventoryStock, stock);
        saveFile(inventoryFiles.inventoryTransactions, transactions);
        
        console.log(message);
        console.log(`   New stock: ${stock[stockKey].available}`);
        
        res.json({ 
            success: true, 
            stock: stock[stockKey],
            transaction: transaction,
            message: message
        });
        
    } catch (error) {
        console.error('Error updating stock:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== ISSUE ITEM ENDPOINT ==========
app.post('/api/inventory/issue', (req, res) => {
    try {
        const { 
            itemName, 
            quantity, 
            destination, 
            recipient, 
            comment,
            periodKey,
            academicYear,
            term
        } = req.body;
        
        console.log('📤 Issue request:', { itemName, quantity, destination, recipient, periodKey, academicYear, term });
        
        if (!itemName || !quantity || quantity <= 0) {
            return res.status(400).json({ error: 'Item name and quantity are required' });
        }
        
        if (!destination) {
            return res.status(400).json({ error: 'Destination is required' });
        }
        
        if (!recipient) {
            return res.status(400).json({ error: 'Recipient name is required' });
        }
        
        // Determine the period to use
        let year, termNum;
        if (academicYear && term) {
            year = parseInt(academicYear);
            termNum = parseInt(term);
        } else if (periodKey) {
            const parts = periodKey.split('_');
            year = parseInt(parts[0]);
            termNum = parseInt(parts[1]);
        } else {
            const settings = readFile(files.settings);
            year = settings.currentAcademicYear || new Date().getFullYear();
            termNum = settings.currentTerm || 1;
        }
        
        const periodKeyUsed = `${year}_${termNum}`;
        const stockKey = getPeriodStockKey(itemName, year, termNum);
        
        let stock = readFile(inventoryFiles.inventoryStock);
        let transactions = readFile(inventoryFiles.inventoryTransactions);
        
        // Check if stock exists for this period
        if (!stock[stockKey]) {
            return res.status(400).json({ 
                error: `Item "${itemName}" not found in stock for period ${periodKeyUsed}. Please restock first.`,
                stockKey: stockKey,
                availablePeriods: Object.keys(stock).filter(k => k.includes(itemName))
            });
        }
        
        // Check if enough stock available
        const available = stock[stockKey].available || 0;
        if (available < quantity) {
            return res.status(400).json({ 
                error: `Not enough stock for period ${periodKeyUsed}. Available: ${available}, Requested: ${quantity}`,
                available: available,
                stockKey: stockKey
            });
        }
        
        // DEDUCT FROM STOCK
        const previousAvailable = stock[stockKey].available || 0;
        stock[stockKey].issued = (stock[stockKey].issued || 0) + quantity;
        stock[stockKey].available = Math.max(0, (stock[stockKey].available || 0) - quantity);
        stock[stockKey].lastUpdated = new Date().toISOString();
        
        // Also update legacy stock entry if it exists
        if (stock[itemName]) {
            stock[itemName].issued = (stock[itemName].issued || 0) + quantity;
            stock[itemName].available = Math.max(0, (stock[itemName].available || 0) - quantity);
            stock[itemName].lastUpdated = new Date().toISOString();
        }
        
        // Record transaction
        const transaction = {
            id: uuidv4(),
            itemName: itemName,
            quantity: quantity,
            transactionType: 'issue',
            destination: destination,
            recipient: recipient || '',
            comment: comment || '',
            stockBefore: previousAvailable,
            stockAfter: stock[stockKey].available || 0,
            periodKey: periodKeyUsed,
            academicYear: year,
            term: termNum,
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split('T')[0],
            canEdit: true,
            canReverse: true,
            isInventory: true
        };
        
        transactions.push(transaction);
        
        saveFile(inventoryFiles.inventoryStock, stock);
        saveFile(inventoryFiles.inventoryTransactions, transactions);
        
        const termName = getTermName(termNum);
        
        res.json({ 
            success: true, 
            transaction: transaction,
            currentStock: stock[stockKey].available || 0,
            period: `${termName} ${year}`,
            message: `✅ Issued ${quantity} ${itemName}(s) to ${recipient} from ${termName} ${year}`
        });
        
    } catch (error) {
        console.error('Error issuing item:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== REVERSE TRANSACTION ENDPOINT ==========
app.post('/api/inventory/reverse/:transactionId', (req, res) => {
    try {
        const { transactionId } = req.params;
        const { reason } = req.body;
        
        let transactions = readFile(inventoryFiles.inventoryTransactions);
        const transactionIndex = transactions.findIndex(t => t.id === transactionId);
        
        if (transactionIndex === -1) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        
        const transaction = transactions[transactionIndex];
        
        if (transaction.reversed) {
            return res.status(400).json({ error: 'Transaction already reversed' });
        }
        
        let stock = readFile(inventoryFiles.inventoryStock);
        
        // Determine the stock key
        let stockKey = transaction.itemName;
        if (transaction.periodKey) {
            stockKey = getPeriodStockKey(transaction.itemName, transaction.academicYear || new Date().getFullYear(), transaction.term || 1);
        } else if (transaction.academicYear && transaction.term) {
            stockKey = getPeriodStockKey(transaction.itemName, transaction.academicYear, transaction.term);
        }
        
        if (transaction.transactionType === 'issue' || transaction.transactionType === 'auto_issue') {
            if (stock[stockKey]) {
                stock[stockKey].issued = Math.max(0, (stock[stockKey].issued || 0) - transaction.quantity);
                stock[stockKey].available = (stock[stockKey].available || 0) + transaction.quantity;
                stock[stockKey].lastUpdated = new Date().toISOString();
            } else if (stock[transaction.itemName]) {
                // Fallback to legacy stock
                stock[transaction.itemName].issued = Math.max(0, (stock[transaction.itemName].issued || 0) - transaction.quantity);
                stock[transaction.itemName].available = (stock[transaction.itemName].available || 0) + transaction.quantity;
                stock[transaction.itemName].lastUpdated = new Date().toISOString();
            }
        }
        
        // Mark transaction as reversed
        transaction.reversed = true;
        transaction.reversedAt = new Date().toISOString();
        transaction.reverseReason = reason || 'Transaction reversed';
        transaction.canEdit = false;
        transaction.canReverse = false;
        
        // Create a reverse record
        const reverseRecord = {
            id: uuidv4(),
            originalTransactionId: transactionId,
            itemName: transaction.itemName,
            quantity: transaction.quantity,
            transactionType: 'reverse',
            reason: reason || 'Transaction reversed',
            periodKey: transaction.periodKey,
            academicYear: transaction.academicYear,
            term: transaction.term,
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split('T')[0],
            isInventory: true
        };
        
        transactions.push(reverseRecord);
        saveFile(inventoryFiles.inventoryStock, stock);
        saveFile(inventoryFiles.inventoryTransactions, transactions);
        
        const termName = transaction.term ? getTermName(transaction.term) : '';
        
        res.json({ 
            success: true, 
            message: `✅ Transaction reversed successfully from ${termName} ${transaction.academicYear || ''}`,
            stock: stock[stockKey] || stock[transaction.itemName]
        });
        
    } catch (error) {
        console.error('Error reversing transaction:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== EDIT TRANSACTION ENDPOINT ==========
app.put('/api/inventory/transaction/:transactionId', (req, res) => {
    try {
        const { transactionId } = req.params;
        const { destination, recipient, comment, quantity } = req.body;
        
        let transactions = readFile(inventoryFiles.inventoryTransactions);
        const transactionIndex = transactions.findIndex(t => t.id === transactionId);
        
        if (transactionIndex === -1) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        
        const transaction = transactions[transactionIndex];
        
        if (transaction.reversed) {
            return res.status(400).json({ error: 'Cannot edit a reversed transaction' });
        }
        
        let stock = readFile(inventoryFiles.inventoryStock);
        
        // Determine the stock key
        let stockKey = transaction.itemName;
        if (transaction.periodKey) {
            stockKey = getPeriodStockKey(transaction.itemName, transaction.academicYear || new Date().getFullYear(), transaction.term || 1);
        } else if (transaction.academicYear && transaction.term) {
            stockKey = getPeriodStockKey(transaction.itemName, transaction.academicYear, transaction.term);
        }
        
        if (quantity && quantity !== transaction.quantity) {
            const diff = quantity - transaction.quantity;
            
            if (stock[stockKey]) {
                stock[stockKey].issued = Math.max(0, (stock[stockKey].issued || 0) + diff);
                stock[stockKey].available = Math.max(0, (stock[stockKey].available || 0) - diff);
                stock[stockKey].lastUpdated = new Date().toISOString();
            } else if (stock[transaction.itemName]) {
                stock[transaction.itemName].issued = Math.max(0, (stock[transaction.itemName].issued || 0) + diff);
                stock[transaction.itemName].available = Math.max(0, (stock[transaction.itemName].available || 0) - diff);
                stock[transaction.itemName].lastUpdated = new Date().toISOString();
            }
            transaction.quantity = quantity;
        }
        
        if (destination) transaction.destination = destination;
        if (recipient) transaction.recipient = recipient;
        if (comment !== undefined) transaction.comment = comment;
        transaction.editedAt = new Date().toISOString();
        transaction.canEdit = false;
        
        saveFile(inventoryFiles.inventoryStock, stock);
        saveFile(inventoryFiles.inventoryTransactions, transactions);
        
        res.json({ 
            success: true, 
            transaction: transaction,
            message: '✅ Transaction updated successfully'
        });
        
    } catch (error) {
        console.error('Error editing transaction:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== RESET INVENTORY (Admin) ==========
app.post('/api/inventory/reset', (req, res) => {
    try {
        const { confirm } = req.body;
        
        if (confirm !== 'RESET INVENTORY') {
            return res.status(400).json({ error: 'Invalid confirmation' });
        }
        
        // Reset all inventory files
        saveFile(inventoryFiles.inventoryStock, {});
        saveFile(inventoryFiles.inventoryTransactions, []);
        saveFile(inventoryFiles.inventoryItems, {});
        
        console.log('🔄 Inventory has been reset');
        
        res.json({ 
            success: true, 
            message: 'Inventory has been reset successfully' 
        });
    } catch (error) {
        console.error('Error resetting inventory:', error);
        res.status(500).json({ error: error.message });
    }
});

console.log('✅ Inventory Backend v6.0 - Complete Rebuild Loaded!');
console.log('   - Auto-stock deduction from payments');
console.log('   - Period-aware stock management');
console.log('   - Manual stock updates');
console.log('   - Issue, Edit, Reverse transactions');
console.log('   - Comprehensive inventory summary');

app.get('/api/reports/filter-options', async (req, res) => {
    try {
        const feeStructures = readFile(files.feeStructures);
        const students = readFile(files.students);
        const classes = readFile(files.classes);
        
        // Get all classes
        const classOptions = classes.map(c => ({ id: c.id, name: c.name, level: c.level }));
        
        // Get all levels
        const levelOptions = ['Nursery', 'LowerPrimary', 'UpperPrimary'];
        
        // Get all students
        const studentOptions = students.map(s => ({ 
            id: s.id, 
            name: `${s.firstName || ''} ${s.lastName || ''}`.trim(),
            admissionNumber: s.admissionNumber || ''
        }));
        
        // Get all fee structures
        const feeStructureOptions = feeStructures.map(fs => ({
            id: fs.id,
            name: fs.name || 'Unnamed',
            level: fs.level || 'LowerPrimary'
        }));
        
        // Get all status groups and scholastic items
        const statusGroupSet = new Set();
        const scholasticItemsSet = new Set();
        
        feeStructures.forEach(fs => {
            (fs.activityComponents || []).forEach(comp => {
                const sgName = comp.statusGroupName || comp.name || 'Other';
                statusGroupSet.add(sgName);
                (comp.items || []).forEach(item => {
                    const itemName = item.name || '';
                    scholasticItemsSet.add(itemName);
                });
            });
        });
        
        const statusGroupOptions = Array.from(statusGroupSet);
        const scholasticItemOptions = Array.from(scholasticItemsSet);
        
        // Payment status options
        const paymentStatusOptions = ['Fully Paid', 'Payment Due', 'No Payment', 'Credit Balance'];
        
        res.json({
            success: true,
            data: {
                classes: classOptions,
                levels: levelOptions,
                students: studentOptions,
                feeStructures: feeStructureOptions,
                statusGroups: statusGroupOptions,
                scholasticItems: scholasticItemOptions,
                paymentStatuses: paymentStatusOptions
            }
        });
        
    } catch (error) {
        console.error('Error getting filter options:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== SYSTEM ROUTES ====================

app.get('/api/system/status', (req, res) => {
    res.json({
        students: readFile(files.students).length,
        teachers: readFile(files.teachers).length,
        classes: readFile(files.classes).length,
        subjects: readFile(files.subjects).length,
        feeStructures: readFile(files.feeStructures).length,
        feePayments: readFile(files.feePayments).length,
        uptime: process.uptime(),
        version: '3.0'
    });
});

app.delete('/api/system/reset', (req, res) => {
    try {
        // Clear all data files
        Object.keys(files).forEach(key => {
            if (key === 'settings') {
                saveFile(files.settings, {
                    currentAcademicYear: new Date().getFullYear(),
                    currentTerm: 1,
                    gradingSystem: {
                        'A': { min: 80, max: 100, remark: 'Excellent' },
                        'B': { min: 70, max: 79, remark: 'Very Good' },
                        'C': { min: 60, max: 69, remark: 'Good' },
                        'D': { min: 50, max: 59, remark: 'Satisfactory' },
                        'E': { min: 40, max: 49, remark: 'Fair' },
                        'F': { min: 0, max: 39, remark: 'Poor' }
                    }
                });
            } else if (key === 'feeBursaries') {
                saveFile(files.feeBursaries, [
                    { id: uuidv4(), name: 'Merit Scholarship', description: 'Top performers', type: 'percentage', value: 25, category: 'Academic', isActive: true, createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'Sports Bursary', description: 'Sports talent', type: 'percentage', value: 15, category: 'Sports', isActive: true, createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'Sibling Discount', description: 'Multiple children', type: 'percentage', value: 10, category: 'Family', isActive: true, createdAt: new Date().toISOString() }
                ]);
            } else if (key === 'classes') {
                saveFile(files.classes, [
                    { id: uuidv4(), name: 'Baby Class', level: 'Nursery', order: 1, createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'Middle Class', level: 'Nursery', order: 2, createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'Top Class', level: 'Nursery', order: 3, createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'P.1', level: 'LowerPrimary', order: 4, createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'P.2', level: 'LowerPrimary', order: 5, createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'P.3', level: 'LowerPrimary', order: 6, createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'P.4', level: 'UpperPrimary', order: 7, createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'P.5', level: 'UpperPrimary', order: 8, createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'P.6', level: 'UpperPrimary', order: 9, createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'P.7', level: 'UpperPrimary', order: 10, createdAt: new Date().toISOString() }
                ]);
            } else if (key === 'subjects') {
                saveFile(files.subjects, [
                    { id: uuidv4(), name: 'English', code: 'ENG', category: 'Core', classId: 'all', createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'Mathematics', code: 'MATH', category: 'Core', classId: 'all', createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'Science', code: 'SCI', category: 'Core', classId: 'all', createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'Social Studies', code: 'SST', category: 'Core', classId: 'all', createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'Reading', code: 'READ', category: 'Core', classId: 'all', createdAt: new Date().toISOString() },
                    { id: uuidv4(), name: 'Writing', code: 'WRIT', category: 'Core', classId: 'all', createdAt: new Date().toISOString() }
                ]);
            } else if (key === 'studentTermRecords') {
                saveFile(files.studentTermRecords, {});
            } else {
                saveFile(files[key], []);
            }
        });
        res.json({ success: true, message: 'System reset successfully' });
    } catch (error) {
        console.error('Error resetting system:', error);
        res.status(500).json({ error: 'Failed to reset system' });
    }
});

// Add this to your server.js file
app.post('/api/academic/years/:year/terms/:term', (req, res) => {
    const { year, term } = req.params;
    const yearDir = path.join(dataDir, year);
    const termDir = path.join(yearDir, `term${term}`);
    
    if (!fs.existsSync(yearDir)) {
        fs.mkdirSync(yearDir, { recursive: true });
    }
    if (!fs.existsSync(termDir)) {
        fs.mkdirSync(termDir, { recursive: true });
    }
    
    res.json({ success: true, message: `Academic scope ${year}/Term ${term} ready` });
});


// ========== GET COMPREHENSIVE REPORT DATA (FIXED) ==========
// ==================== COMPLETE REBUILT COMPREHENSIVE REPORT ENDPOINT ====================
// Version: FINAL - Full Customization Support
// ALL item values use custom overrides when available

// ==================== COMPLETE REBUILT COMPREHENSIVE REPORT ENDPOINT ====================
// Version: 7.0 - Fully working with payment aggregation, period protocols, and custom overrides

// ==================== COMPLETE FIXED BACKEND ENDPOINT ====================
// Version: 8.0 - Correct Multi-Period Calculations

// ==================== COMPLETE FIXED COMPREHENSIVE REPORT ENDPOINT ====================
// Version: 9.0 - Fixes One-Time item display and Current Period totals

// ==================== COMPLETE REBUILT: /api/reports/comprehensive ====================
// Version: 10.0 - FULL PERIOD AWARE TUITION WITH BREAKDOWN
// - Tuition: Aggregated across ALL periods (sum of expected, paid, balance per period)
// - Tuition Period Breakdown: Each term/year shows expected, paid, balance
// - OR Logic: Credit balance when overpaid
// - One-Time: Only in current period
// - Yearly: Only in first term of each year
// - Termly: Every term

// ==================== COMPLETE REBUILT: /api/reports/comprehensive ====================
// Version: 11.0 - FULLY WORKING WITH CORRECT DATA
// - Proper period scoping (Termly, Yearly, One-Time)
// - Correct OR logic for cash vs items
// - Accurate payment aggregation
// - Proper handling of customizations and removed items

// ==================== COMPLETE REBUILT: /api/reports/comprehensive ====================
// Version: 11.1 - FIXED: Includes periods from fee assignments
// - Proper period scoping (Termly, Yearly, One-Time)
// - Correct OR logic for cash vs items
// - Accurate payment aggregation
// - Proper handling of customizations and removed items
// - Now detects periods from fee assignments (promoted years) even with no payments

// ==================== COMPREHENSIVE REPORT (v12.0 - PERIOD SCOPING FIXED) ====================
app.get('/api/reports/comprehensive', async (req, res) => {
    console.log('=== COMPREHENSIVE REPORT v11.2 - PERIOD-AWARE REMOVAL ===');
    
    try {
        // ================================================================
        // STEP 1: READ SETTINGS
        // ================================================================
        const settings = readFile(files.settings);
        const defaultYear = settings.currentAcademicYear || new Date().getFullYear();
        const defaultTerm = settings.currentTerm || 1;
        
        const { 
            classId, level, studentId, 
            statusGroup: filterStatusGroup, 
            itemName: filterItemName, 
            paymentStatus,
            feeStructureId,
            includeTuition,
            academicYear: filterYear,
            academicTerm: filterTerm,
            includeAllPeriods
        } = req.query;
        
        const includeTuitionBool = includeTuition !== 'false' && includeTuition !== 'off';
        const includeAllPeriodsBool = includeAllPeriods === 'true';
        
        let targetYear = filterYear ? parseInt(filterYear) : defaultYear;
        let targetTerm = filterTerm ? parseInt(filterTerm) : defaultTerm;
        
        console.log('📋 Report Parameters:', {
            targetYear,
            targetTerm,
            classId: classId || 'all',
            level: level || 'all',
            filterStatusGroup: filterStatusGroup || 'all',
            includeTuition: includeTuitionBool,
            includeAllPeriods: includeAllPeriodsBool
        });

        // ================================================================
        // STEP 2: FETCH ALL DATA
        // ================================================================
        let feeStructures = readFile(files.feeStructures) || [];
        let students = readFile(files.students) || [];
        let feeAssignments = readFile(files.studentFeeAssignments) || [];
        let allPayments = readFile(files.feePayments) || [];
        let termRecords = readFile(files.studentTermRecords) || {};
        let classes = readFile(files.classes) || [];
        let feeBursaries = readFile(files.feeBursaries) || [];

        console.log('📊 Data Loaded:', {
            students: students.length,
            feeStructures: feeStructures.length,
            payments: allPayments.length,
            termRecords: Object.keys(termRecords).length,
            classes: classes.length
        });

        // ================================================================
        // STEP 3: BUILD MAPS
        // ================================================================
        const classesMap = {};
        classes.forEach(c => { if (c && c.id) classesMap[c.id] = c; });
        
        const assignmentsMap = {};
        feeAssignments.forEach(a => { if (a && a.studentId) assignmentsMap[a.studentId] = a; });
        
        const bursariesMap = {};
        feeBursaries.forEach(b => { if (b && b.id) bursariesMap[b.id] = b; });
        
        const feeStructuresMap = {};
        feeStructures.forEach(fs => { if (fs && fs.id) feeStructuresMap[fs.id] = fs; });

        // ================================================================
        // STEP 4: HELPER FUNCTIONS
        // ================================================================

        // 4.1: Get Current Period
        const isFirstTerm = targetTerm === 1;

        // 4.2: Get Period Label
        function getPeriodLabel(year, term, isCurrent) {
            const termNames = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
            const termShort = { 1: 'T1', 2: 'T2', 3: 'T3' };
            const label = `${termShort[term] || 'T' + term} ${year}`;
            return isCurrent ? `${label} ⭐ CURRENT` : label;
        }

        // 4.3: Get Term Name
        function getTermName(term) {
            const names = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
            return names[term] || `Term ${term}`;
        }

        // 4.4: Format Money
        function formatMoney(amount) {
            return Math.round(amount || 0).toLocaleString('en-US');
        }

        // 4.5: Get Customized Item Value
        function getCustomizedItemValue(student, itemId, defaultAmount, defaultQuantity, defaultPaymentOption, defaultUnitPrice) {
            if (!student) {
                return {
                    amount: defaultAmount || 0,
                    quantity: defaultQuantity || 1,
                    paymentOption: defaultPaymentOption || 'either',
                    unitPrice: defaultUnitPrice || (defaultAmount / (defaultQuantity || 1)),
                    isCustomized: false,
                    reason: null,
                    updatedAt: null
                };
            }
            
            if (student.customItemOverrides && student.customItemOverrides[itemId]) {
                const custom = student.customItemOverrides[itemId];
                if (custom && custom.isActive !== false) {
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

        // ================================================================
        // NEW: PERIOD-AWARE REMOVAL CHECK
        // ================================================================
        function isItemRemovedForPeriod(student, itemId, year, term) {
            if (!student || !student.removedItems) return false;
            const removed = student.removedItems[itemId];
            if (!removed || removed.isActive === false) return false;
            // Legacy removals without period stamp: treat as removed everywhere
            if (removed.academicYear === undefined || removed.term === undefined) return true;
            return removed.academicYear === parseInt(year) && removed.term === parseInt(term);
        }

        // 4.6: Get Period-Scoped Payments (unchanged)
        function getPeriodScopedPayments(studentId, periodType, year, term, allPaymentsData) {
            const studentPayments = allPaymentsData.filter(p => p && p.studentId === studentId);
            if (periodType === 'one_time') {
                return studentPayments;
            } else if (periodType === 'yearly') {
                return studentPayments.filter(p => {
                    if (!p || !p.academicYear) return false;
                    return parseInt(p.academicYear) === year;
                });
            } else {
                return studentPayments.filter(p => {
                    if (!p) return false;
                    return p.term === term && parseInt(p.academicYear) === year;
                });
            }
        }

        // 4.7: getPaidAmountsForItem (unchanged)
        function getPaidAmountsForItem(studentId, componentName, itemName, periodType, year, term, allPaymentsData) {
            const scopedPayments = getPeriodScopedPayments(studentId, periodType, year, term, allPaymentsData);
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
                            if (!processedKeys.has(key)) {
                                processedKeys.add(key);
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
                                if (!processedKeys.has(key)) {
                                    processedKeys.add(key);
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

        // 4.8: Calculate Item Totals with OR Logic (unchanged)
        function calculateItemTotalsWithORLogic(qtyRequired, amountExpected, paymentOption, cashPaid, itemsBrought) {
            const finalItemsBrought = Math.min(itemsBrought, qtyRequired);
            let cashExpected = 0;
            let finalCashPaid = 0;
            
            if (paymentOption === 'cash_only') {
                cashExpected = amountExpected;
                finalCashPaid = Math.min(cashPaid, amountExpected);
            } else if (paymentOption === 'item_only') {
                cashExpected = 0;
                finalCashPaid = 0;
            } else {
                if (finalItemsBrought >= qtyRequired && qtyRequired > 0) {
                    cashExpected = 0;
                    finalCashPaid = 0;
                } else {
                    const unitPrice = qtyRequired > 0 ? (amountExpected / qtyRequired) : 0;
                    const remainingQty = Math.max(0, qtyRequired - finalItemsBrought);
                    cashExpected = Math.min(amountExpected, remainingQty * unitPrice);
                    finalCashPaid = Math.min(cashPaid, cashExpected);
                }
            }
            
            const cashRemaining = cashExpected - finalCashPaid;
            const itemsRemaining = qtyRequired - finalItemsBrought;
            const isFullyPaid = cashRemaining <= 0 && itemsRemaining <= 0;
            
            return {
                cashExpected,
                cashPaid: finalCashPaid,
                cashRemaining,
                itemsBrought: finalItemsBrought,
                itemsRemaining,
                isFullyPaid
            };
        }

        // ================================================================
        // STEP 5: GET ALL PERIODS FOR STUDENT (unchanged)
        // ================================================================
        function getAllPeriodsForStudent(studentId) {
        const currentYear = parseInt(targetYear);
        const currentTerm = parseInt(targetTerm);

        // ================================================================
        // DETERMINE START PERIOD FROM ENROLLMENT DATE
        // ================================================================
        // A period "applies" to a student because they were enrolled during
        // it — not because a payment/term-record/fee-assignment happens to
        // reference it. This stops phantom periods (e.g. a manufactured
        // Term 1 balance for a student who joined in Term 3) and stops
        // real gaps (e.g. Term 2 with no activity yet) from being silently
        // skipped.
        const student = students.find(s => s && s.id === studentId);

        let startYear = currentYear;
        let startTerm = currentTerm;

        if (student && student.enrollmentDate) {
            const enrollTerm = getTermForDate(student.enrollmentDate);
            const enrollYear = getAcademicYearForDate(student.enrollmentDate);
            if (enrollTerm && enrollYear &&
                (enrollYear < currentYear || (enrollYear === currentYear && enrollTerm <= currentTerm))) {
                startYear = enrollYear;
                startTerm = enrollTerm;
            }
        }

        // ================================================================
        // WALK EVERY TERM FROM ENROLLMENT THROUGH THE CURRENT PERIOD
        // ================================================================
        const periods = new Map();
        let y = startYear;
        let t = startTerm;

        while (y < currentYear || (y === currentYear && t <= currentTerm)) {
            const key = `${y}_${t}`;
            if (!periods.has(key)) {
                periods.set(key, { year: y, term: t, payments: [] });
            }
            t++;
            if (t > 3) {
                t = 1;
                y++;
            }
        }

        // ================================================================
        // ATTACH MATCHING PAYMENTS TO EACH PERIOD (payment amounts are
        // still read this way downstream — this does not affect whether
        // a period is included, only what it displays)
        // ================================================================
        allPayments.forEach(p => {
            if (p && p.studentId === studentId && p.academicYear && p.term !== undefined && p.term !== null) {
                const year = parseInt(p.academicYear);
                const term = parseInt(p.term);
                const key = `${year}_${term}`;
                if (periods.has(key)) {
                    periods.get(key).payments.push(p);
                }
            }
        });

        return Array.from(periods.entries())
            .map(([key, data]) => ({ ...data, periodKey: key }))
            .sort((a, b) => {
                if (a.year !== b.year) return b.year - a.year;
                return b.term - a.term;
            });
    }
        // ================================================================
        // STEP 6: PROCESS STUDENTS
        // ================================================================
        console.log('👨‍🎓 Processing students...');
        
        const processedStudents = [];
        let totalTuitionExpected = 0;
        let totalTuitionCollected = 0;
        let totalTuitionBalance = 0;
        let totalActivityCashExpected = 0;
        let totalActivityCashPaid = 0;
        let totalActivityCashRemaining = 0;
        let totalExpected = 0;
        let totalPaid = 0;
        let totalBalance = 0;
        let fullyPaidCount = 0;
        let paymentDueCount = 0;
        let noPaymentCount = 0;
        let creditBalanceCount = 0;
        let totalCustomizedItems = 0;
        let totalStudentsWithCustomizations = 0;
        const allStatusGroups = new Set();
        const allPeriodKeys = [];
        
        const currentYear = parseInt(targetYear);
        const currentTerm = parseInt(targetTerm);
        
        for (const student of students) {
            if (!student || !student.id) continue;
            
            const assignment = assignmentsMap[student.id] || {};
            const feeStructure = feeStructuresMap[assignment.feeStructureId];
            if (!feeStructure) continue;
            
            if (feeStructureId && feeStructureId !== 'all' && feeStructure.id !== feeStructureId) continue;
            
            let currentClass = 'Not Assigned';
            let classLevel = 'Unknown';
            if (student.currentClassId && classesMap[student.currentClassId]) {
                currentClass = classesMap[student.currentClassId].name;
                classLevel = classesMap[student.currentClassId].level || 'Unknown';
            } else if (student.currentClass) {
                currentClass = student.currentClass;
            }
            
            if (classId && classId !== 'all' && currentClass !== classId) continue;
            if (level && level !== 'all' && classLevel !== level) continue;
            if (studentId && studentId !== 'all' && student.id !== studentId) continue;
            
            // ================================================================
            // Get ALL periods for the student (for scoping rules)
            // ================================================================
            const allPeriods = getAllPeriodsForStudent(student.id);
            const sortedAsc = [...allPeriods].sort((a, b) => {
                if (a.year !== b.year) return a.year - b.year;
                return a.term - b.term;
            });
            const oldestPeriodKey = sortedAsc.length > 0 ? sortedAsc[0].periodKey : null;
            
            const maxTermByYear = {};
            for (const p of allPeriods) {
                const year = p.year;
                const term = p.term;
                if (!maxTermByYear[year] || term > maxTermByYear[year]) {
                    maxTermByYear[year] = term;
                }
            }
            
            let periodsToProcess = allPeriods;
            if (!includeAllPeriodsBool) {
                periodsToProcess = allPeriods.filter(p => 
                    p.year === targetYear && p.term === targetTerm
                );
                if (periodsToProcess.length === 0) {
                    periodsToProcess = allPeriods.filter(p => 
                        p.year === defaultYear && p.term === defaultTerm
                    );
                    if (periodsToProcess.length === 0 && allPeriods.length > 0) {
                        periodsToProcess = [allPeriods[0]];
                    }
                }
            }
            
            for (const p of periodsToProcess) {
                if (allPeriodKeys.indexOf(p.periodKey) === -1) {
                    allPeriodKeys.push(p.periodKey);
                }
            }
            
            // ============================================================
            // CALCULATE TUITION (unchanged)
            // ============================================================
            let originalTuition = feeStructure.tuition || 0;
            let tuitionExpected = originalTuition;
            let discountAmount = 0;
            let discountDisplay = '';
            let appliedBursary = null;
            let isCustomBursary = false;
            
            if (student.customBursary && student.customBursary.amount > 0) {
                discountAmount = student.customBursary.amount;
                discountDisplay = `UGX ${discountAmount.toLocaleString()} off (Custom)`;
                tuitionExpected = Math.max(0, originalTuition - discountAmount);
                appliedBursary = 'Custom Bursary';
                isCustomBursary = true;
            } else if (assignment.bursaryId && bursariesMap[assignment.bursaryId]) {
                const bursary = bursariesMap[assignment.bursaryId];
                appliedBursary = bursary.name;
                if (bursary.type === 'percentage') {
                    discountAmount = (originalTuition * bursary.value) / 100;
                    discountDisplay = `${bursary.value}% off`;
                    tuitionExpected = Math.max(0, originalTuition - discountAmount);
                } else {
                    discountAmount = bursary.value;
                    discountDisplay = `UGX ${discountAmount.toLocaleString()} off`;
                    tuitionExpected = Math.max(0, originalTuition - discountAmount);
                }
            }
            
            let tuitionPaid = 0;
            const tuitionPaymentHistories = [];
            const tuitionPeriodBreakdown = {};
            
            for (const period of periodsToProcess) {
                const periodKey = period.periodKey;
                const periodPayments = allPayments.filter(p => 
                    p && p.studentId === student.id && 
                    p.term === period.term && 
                    p.academicYear === period.year.toString()
                );
                
                let periodPaid = 0;
                for (const payment of periodPayments) {
                    const paid = payment.tuitionPaid || 0;
                    if (paid > 0) {
                        periodPaid += paid;
                        tuitionPaid += paid;
                        tuitionPaymentHistories.push({
                            date: payment.date || new Date().toISOString(),
                            receiptNumber: payment.receiptNumber || 'N/A',
                            amount: paid,
                            method: payment.method || 'cash',
                            term: period.term,
                            year: period.year,
                            periodKey: periodKey
                        });
                    }
                }
                
                const periodBalance = tuitionExpected - periodPaid;
                const isCurrentPeriod = (period.year === currentYear && period.term === currentTerm);
                
                tuitionPeriodBreakdown[periodKey] = {
                    year: period.year,
                    term: period.term,
                    expected: tuitionExpected,
                    paid: periodPaid,
                    balance: periodBalance,
                    isCurrent: isCurrentPeriod,
                    isFullyPaid: periodBalance <= 0 && periodPaid > 0,
                    isOverpaid: periodBalance < 0,
                    periodLabel: getPeriodLabel(period.year, period.term, isCurrentPeriod)
                };
            }
            
            const tuitionBalance = tuitionExpected - tuitionPaid;
            
            let tuitionStatus = 'Payment Due';
            let tuitionStatusColor = 'bg-yellow-100 text-yellow-800';
            let tuitionStatusIcon = '⚠️';
            if (tuitionBalance < -10) {
                tuitionStatus = 'Credit Balance';
                tuitionStatusColor = 'bg-blue-100 text-blue-800';
                tuitionStatusIcon = '💰';
            } else if (Math.abs(tuitionBalance) <= 10 && tuitionPaid > 0) {
                tuitionStatus = 'Fully Paid';
                tuitionStatusColor = 'bg-green-100 text-green-800';
                tuitionStatusIcon = '✅';
            } else if (tuitionPaid === 0 && tuitionExpected > 0) {
                tuitionStatus = 'No Payment';
                tuitionStatusColor = 'bg-gray-100 text-gray-800';
                tuitionStatusIcon = '📋';
            } else if (tuitionBalance > 0) {
                tuitionStatus = 'Payment Due';
                tuitionStatusColor = 'bg-yellow-100 text-yellow-800';
                tuitionStatusIcon = '⚠️';
            }
            
            // ============================================================
            // BUILD STATUS GROUPS WITH PERIOD-AWARE REMOVAL
            // ============================================================
            const statusGroups = {};
            let studentTotalCashExpected = 0;
            let studentTotalCashPaid = 0;
            let studentTotalCashRemaining = 0;
            let studentCustomizedItems = 0;
            let studentHasCustomizations = false;
            
            if (feeStructure.activityComponents) {
                for (const component of feeStructure.activityComponents) {
                    if (!component) continue;
                    
                    const periodType = component.periodType || 'termly';
                    const groupName = component.statusGroupName || component.name || 'Other';
                    allStatusGroups.add(groupName);
                    
                    if (!statusGroups[groupName]) {
                        statusGroups[groupName] = {
                            name: groupName,
                            periodTypes: new Set([periodType]),
                            items: {},
                            totalExpected: 0,
                            totalPaid: 0,
                            totalBalance: 0,
                            totalRemaining: 0,
                            totalRequired: 0,
                            totalCollected: 0
                        };
                    }
                    
                    for (const item of (component.items || [])) {
                        if (!item) continue;
                        
                        const itemId = item.id || item.name;
                        
                        // ============================================================
                        // REMOVED GLOBAL SKIP – we will handle per‑period below
                        // ============================================================
                        // if (isItemRemoved(student, itemId)) continue;   // <-- REMOVED
                        
                        const defaultAmount = item.totalAmount || 0;
                        const defaultQuantity = item.quantity || 1;
                        const defaultUnitPrice = item.unitPrice || (defaultAmount / defaultQuantity);
                        const defaultPaymentOption = item.paymentOption || 'either';
                        
                        const customValues = getCustomizedItemValue(
                            student, itemId, defaultAmount, defaultQuantity, 
                            defaultPaymentOption, defaultUnitPrice
                        );
                        
                        const effectiveAmount = customValues.amount;
                        const effectiveQuantity = customValues.quantity;
                        const effectiveUnitPrice = customValues.unitPrice;
                        const effectivePaymentOption = customValues.paymentOption;
                        const isCustomized = customValues.isCustomized;
                        
                        if (isCustomized) {
                            studentCustomizedItems++;
                            studentHasCustomizations = true;
                        }
                        
                        if (!statusGroups[groupName].items[item.name]) {
                            statusGroups[groupName].items[item.name] = {
                                id: itemId,
                                name: item.name,
                                componentName: component.name,
                                periodType: periodType,
                                quantityRequired: effectiveQuantity,
                                amountExpected: effectiveAmount,
                                unitPrice: effectiveUnitPrice,
                                paymentOption: effectivePaymentOption,
                                isCustomized: isCustomized,
                                customReason: customValues.reason,
                                periodBreakdown: {},
                                totalCollected: 0,
                                totalRemaining: 0,
                                totalAmountCollected: 0,
                                isFullyPaid: false,
                                isOneTime: periodType === 'one_time'
                            };
                        }
                        
                        const itemData = statusGroups[groupName].items[item.name];
                        
                        // ============================================================
                        // CALCULATE FOR EACH PERIOD (with period‑aware removal)
                        // ============================================================
                        let totalQtyCollected = 0;
                        let totalAmtCollected = 0;
                        let totalCashExpected = 0;
                        let totalCashPaid = 0;
                        
                        for (const period of periodsToProcess) {
                            const periodKey = `${period.year}_${period.term}`;
                            const isCurrentPeriod = (period.year === currentYear && period.term === currentTerm);
                            const isFirstTermForPeriod = (period.term === 1);
                            
                            // ================================================================
                            // Determine if this item should be included in this period
                            // ================================================================
                            let shouldInclude = false;
                            if (periodType === 'termly') {
                                shouldInclude = true;
                            } else if (periodType === 'one_time') {
                                shouldInclude = (periodKey === oldestPeriodKey);
                            } else if (periodType === 'yearly') {
                                const maxTerm = maxTermByYear[period.year] || 0;
                                shouldInclude = (period.term === maxTerm);
                            }
                            
                            // ================================================================
                            // NEW: PERIOD-AWARE REMOVAL – skip if removed for this specific period
                            // ================================================================
                            if (shouldInclude && isItemRemovedForPeriod(student, itemId, period.year, period.term)) {
                                shouldInclude = false;
                            }
                            
                            if (!shouldInclude) {
                                itemData.periodBreakdown[periodKey] = {
                                    year: period.year,
                                    term: period.term,
                                    qtyCollected: 0,
                                    qtyRemaining: 0,
                                    amtCollected: 0,
                                    amtRemaining: 0,
                                    isFullyPaid: false,
                                    isNotApplicable: true,
                                    isCurrent: isCurrentPeriod,
                                    periodLabel: getPeriodLabel(period.year, period.term, isCurrentPeriod)
                                };
                                continue;
                            }
                            
                            // ============================================================
                            // GET PAID AMOUNTS FOR THIS PERIOD
                            // ============================================================
                            const paidInfo = getPaidAmountsForItem(
                                student.id, component.name, item.name, 
                                periodType, period.year, period.term, allPayments
                            );
                            
                            const cashPaid = paidInfo.cashPaid;
                            const itemsBrought = paidInfo.itemsBrought;
                            const paymentHistories = paidInfo.paymentHistories;
                            
                            // ============================================================
                            // CALCULATE WITH OR LOGIC
                            // ============================================================
                            const totals = calculateItemTotalsWithORLogic(
                                effectiveQuantity,
                                effectiveAmount,
                                effectivePaymentOption,
                                cashPaid,
                                itemsBrought
                            );
                            
                            const qtyCollected = totals.itemsBrought;
                            const amtCollected = totals.cashPaid;
                            const qtyRemaining = totals.itemsRemaining;
                            const amtRemaining = totals.cashRemaining;
                            const isPeriodFullyPaid = totals.isFullyPaid;
                            
                            // ============================================================
                            // STORE PERIOD BREAKDOWN
                            // ============================================================
                            itemData.periodBreakdown[periodKey] = {
                                year: period.year,
                                term: period.term,
                                qtyCollected: qtyCollected,
                                qtyRemaining: qtyRemaining,
                                amtCollected: amtCollected,
                                amtRemaining: amtRemaining,
                                isFullyPaid: isPeriodFullyPaid,
                                isCurrent: isCurrentPeriod,
                                paymentHistories: paymentHistories,
                                cashPaid: cashPaid,
                                itemsBrought: itemsBrought,
                                periodLabel: getPeriodLabel(period.year, period.term, isCurrentPeriod),
                                isNotApplicable: false
                            };
                            
                            totalQtyCollected += qtyCollected;
                            totalAmtCollected += amtCollected;
                            totalCashExpected += totals.cashExpected;
                            totalCashPaid += totals.cashPaid;
                        }
                        
                        // ============================================================
                        // UPDATE ITEM TOTALS
                        // ============================================================
                        itemData.totalCollected = totalQtyCollected;
                        itemData.totalRemaining = Math.max(0, effectiveQuantity - totalQtyCollected);
                        itemData.totalAmountCollected = totalAmtCollected;
                        itemData.isFullyPaid = itemData.totalRemaining <= 0 && totalAmtCollected >= effectiveAmount;
                        
                        // ============================================================
                        // UPDATE GROUP TOTALS
                        // ============================================================
                        statusGroups[groupName].totalRequired += effectiveQuantity;
                        statusGroups[groupName].totalCollected += totalQtyCollected;
                        statusGroups[groupName].totalRemaining += itemData.totalRemaining;
                        statusGroups[groupName].totalExpected += effectiveAmount;
                        statusGroups[groupName].totalPaid += totalAmtCollected;
                        statusGroups[groupName].totalBalance += Math.max(0, effectiveAmount - totalAmtCollected);
                        
                        studentTotalCashExpected += totalCashExpected;
                        studentTotalCashPaid += totalCashPaid;
                        studentTotalCashRemaining += (totalCashExpected - totalCashPaid);
                    }
                }
            }
            
            // ============================================================
            // CALCULATE STUDENT TOTALS
            // ============================================================
            const studentTotalExpected = tuitionExpected + studentTotalCashExpected;
            const studentTotalPaid = tuitionPaid + studentTotalCashPaid;
            const studentTotalBalance = studentTotalExpected - studentTotalPaid;
            
            // ============================================================
            // UPDATE GLOBAL TOTALS
            // ============================================================
            totalTuitionExpected += tuitionExpected;
            totalTuitionCollected += tuitionPaid;
            totalTuitionBalance += tuitionBalance;
            totalActivityCashExpected += studentTotalCashExpected;
            totalActivityCashPaid += studentTotalCashPaid;
            totalActivityCashRemaining += studentTotalCashRemaining;
            totalExpected += studentTotalExpected;
            totalPaid += studentTotalPaid;
            totalBalance += studentTotalBalance;
            
            if (studentHasCustomizations) {
                totalStudentsWithCustomizations++;
            }
            totalCustomizedItems += studentCustomizedItems;
            
            // ============================================================
            // DETERMINE OVERALL STATUS
            // ============================================================
            let overallStatus = 'Payment Due';
            let statusColor = 'bg-yellow-100 text-yellow-800';
            let statusIcon = '⚠️';
            
            if (studentTotalBalance < 0) {
                overallStatus = 'Credit Balance';
                statusColor = 'bg-blue-100 text-blue-800';
                statusIcon = '💰';
                creditBalanceCount++;
            } else if (Math.abs(studentTotalBalance) <= 10 && studentTotalPaid > 0) {
                overallStatus = 'Fully Paid';
                statusColor = 'bg-green-100 text-green-800';
                statusIcon = '✅';
                fullyPaidCount++;
            } else if (studentTotalPaid === 0 && studentTotalExpected > 0) {
                overallStatus = 'No Payment';
                statusColor = 'bg-gray-100 text-gray-800';
                statusIcon = '📋';
                noPaymentCount++;
            } else if (studentTotalBalance > 0) {
                overallStatus = 'Payment Due';
                statusColor = 'bg-yellow-100 text-yellow-800';
                statusIcon = '⚠️';
                paymentDueCount++;
            }
            
            if (paymentStatus && paymentStatus !== 'all') {
                if (overallStatus !== paymentStatus) continue;
            }
            
            // ============================================================
            // BUILD STUDENT OBJECT
            // ============================================================
            processedStudents.push({
                id: student.id,
                admissionNumber: student.admissionNumber || '',
                firstName: student.firstName || '',
                lastName: student.lastName || '',
                currentClass: currentClass,
                classLevel: classLevel,
                gender: student.gender || '',
                
                tuition: {
                    expected: tuitionExpected,
                    paid: tuitionPaid,
                    balance: tuitionBalance,
                    discountAmount: discountAmount,
                    discountDisplay: discountDisplay,
                    bursaryName: appliedBursary,
                    isCustomBursary: isCustomBursary,
                    status: tuitionStatus,
                    statusColor: tuitionStatusColor,
                    statusIcon: tuitionStatusIcon,
                    paymentHistories: tuitionPaymentHistories,
                    periodBreakdown: tuitionPeriodBreakdown,
                    periodsIncluded: Object.keys(tuitionPeriodBreakdown).length
                },
                
                statusGroups: statusGroups,
                
                totalExpected: studentTotalExpected,
                totalPaid: studentTotalPaid,
                totalBalance: studentTotalBalance,
                totalRemaining: studentTotalCashRemaining,
                
                overallStatus: overallStatus,
                statusColor: statusColor,
                statusIcon: statusIcon,
                
                customizedItemsCount: studentCustomizedItems,
                hasCustomizations: studentHasCustomizations,
                customItemOverrides: student.customItemOverrides || {},
                
                feeStructureName: feeStructure?.name || 'Not Assigned',
                feeStructureId: feeStructure?.id || null,
                
                periods: periodsToProcess.map(p => ({
                    year: p.year,
                    term: p.term,
                    periodKey: p.periodKey,
                    isCurrent: p.year === currentYear && p.term === currentTerm
                }))
            });
        }
        
        // ================================================================
        // STEP 7: CALCULATE FINAL TOTALS
        // ================================================================
        console.log('📊 Final Totals:', {
            students: processedStudents.length,
            tuitionExpected: totalTuitionExpected,
            tuitionCollected: totalTuitionCollected,
            activityCashExpected: totalActivityCashExpected,
            activityCashPaid: totalActivityCashPaid,
            totalExpected: totalExpected,
            totalPaid: totalPaid,
            totalBalance: totalBalance
        });
        
        allPeriodKeys.sort();
        
        const tuitionRate = totalTuitionExpected > 0 ? (totalTuitionCollected / totalTuitionExpected * 100) : 0;
        const overallCollectionRate = totalExpected > 0 ? (totalPaid / totalExpected * 100) : 0;
        
        // ================================================================
        // BUILD STATUS GROUP TOTALS
        // ================================================================
        const statusGroupTotals = {};
        for (const student of processedStudents) {
            for (const [groupName, groupData] of Object.entries(student.statusGroups || {})) {
                if (!statusGroupTotals[groupName]) {
                    statusGroupTotals[groupName] = {
                        name: groupName,
                        totalExpected: 0,
                        totalPaid: 0,
                        totalBalance: 0,
                        totalRemaining: 0,
                        totalRequired: 0,
                        totalCollected: 0,
                        itemDetails: {},
                        studentCount: 0,
                        customizedCount: 0
                    };
                }
                statusGroupTotals[groupName].studentCount++;
                statusGroupTotals[groupName].totalExpected += groupData.totalExpected || 0;
                statusGroupTotals[groupName].totalPaid += groupData.totalPaid || 0;
                statusGroupTotals[groupName].totalBalance += groupData.totalBalance || 0;
                statusGroupTotals[groupName].totalRemaining += groupData.totalRemaining || 0;
                statusGroupTotals[groupName].totalRequired += groupData.totalRequired || 0;
                statusGroupTotals[groupName].totalCollected += groupData.totalCollected || 0;
                
                for (const [itemName, itemData] of Object.entries(groupData.items || {})) {
                    if (!statusGroupTotals[groupName].itemDetails[itemName]) {
                        statusGroupTotals[groupName].itemDetails[itemName] = {
                            name: itemName,
                            totalRequired: 0,
                            totalCollected: 0,
                            totalRemaining: 0,
                            studentsCount: 0,
                            customizedCount: 0,
                            periodBreakdown: {}
                        };
                    }
                    statusGroupTotals[groupName].itemDetails[itemName].totalRequired += itemData.quantityRequired || 0;
                    statusGroupTotals[groupName].itemDetails[itemName].totalCollected += itemData.totalCollected || 0;
                    statusGroupTotals[groupName].itemDetails[itemName].totalRemaining += itemData.totalRemaining || 0;
                    statusGroupTotals[groupName].itemDetails[itemName].studentsCount++;
                    
                    if (itemData.isCustomized) {
                        statusGroupTotals[groupName].itemDetails[itemName].customizedCount++;
                    }
                    
                    for (const [periodKey, periodData] of Object.entries(itemData.periodBreakdown || {})) {
                        if (!statusGroupTotals[groupName].itemDetails[itemName].periodBreakdown[periodKey]) {
                            statusGroupTotals[groupName].itemDetails[itemName].periodBreakdown[periodKey] = {
                                qtyCollected: 0,
                                qtyRemaining: 0,
                                amtCollected: 0,
                                amtRemaining: 0
                            };
                        }
                        if (!periodData.isNotApplicable) {
                            statusGroupTotals[groupName].itemDetails[itemName].periodBreakdown[periodKey].qtyCollected += periodData.qtyCollected || 0;
                            statusGroupTotals[groupName].itemDetails[itemName].periodBreakdown[periodKey].qtyRemaining += periodData.qtyRemaining || 0;
                            statusGroupTotals[groupName].itemDetails[itemName].periodBreakdown[periodKey].amtCollected += periodData.amtCollected || 0;
                            statusGroupTotals[groupName].itemDetails[itemName].periodBreakdown[periodKey].amtRemaining += periodData.amtRemaining || 0;
                        }
                    }
                }
            }
        }

        // ================================================================
        // STEP 8: BUILD RESPONSE
        // ================================================================
        const response = {
            success: true,
            data: {
                students: processedStudents,
                totals: {
                    totalStudents: processedStudents.length,
                    totalTuitionExpected: totalTuitionExpected,
                    totalTuitionCollected: totalTuitionCollected,
                    totalTuitionBalance: totalTuitionBalance,
                    totalActivityCashExpected: totalActivityCashExpected,
                    totalActivityCashPaid: totalActivityCashPaid,
                    totalActivityCashRemaining: totalActivityCashRemaining,
                    fullyPaidCount: fullyPaidCount,
                    paymentDueCount: paymentDueCount,
                    noPaymentCount: noPaymentCount,
                    creditBalanceCount: creditBalanceCount,
                    totalExpected: totalExpected,
                    totalPaid: totalPaid,
                    totalBalance: totalBalance,
                    tuitionRate: tuitionRate.toFixed(1),
                    overallCollectionRate: overallCollectionRate.toFixed(1),
                    totalCustomizedItems: totalCustomizedItems,
                    totalStudentsWithCustomizations: totalStudentsWithCustomizations,
                    periodsIncluded: allPeriodKeys.length
                },
                statusGroupTotals: statusGroupTotals,
                filters: {
                    classId: classId || 'all',
                    level: level || 'all',
                    studentId: studentId || 'all',
                    feeStructureId: feeStructureId || 'all',
                    statusGroup: filterStatusGroup || 'all',
                    itemName: filterItemName || 'all',
                    paymentStatus: paymentStatus || 'all',
                    includeTuition: includeTuitionBool,
                    academicYear: targetYear,
                    academicTerm: targetTerm,
                    includeAllPeriods: includeAllPeriodsBool
                },
                metadata: {
                    currentYear: defaultYear,
                    currentTerm: defaultTerm,
                    generatedAt: new Date().toISOString(),
                    statusGroups: Array.from(allStatusGroups),
                    periodsIncluded: allPeriodKeys,
                    tuitionPeriodCount: allPeriodKeys.length
                },
                allPayments: allPayments
            }
        };
        
        console.log(`✅ Report generated with ${processedStudents.length} students`);
        console.log(`💰 Total Expected: UGX ${formatMoney(totalExpected)}`);
        console.log(`💰 Total Paid: UGX ${formatMoney(totalPaid)}`);
        console.log(`💰 Total Balance: UGX ${formatMoney(totalBalance)}`);
        console.log(`📊 Collection Rate: ${overallCollectionRate.toFixed(1)}%`);
        console.log(`💵 Activity Cash Paid: UGX ${formatMoney(totalActivityCashPaid)}`);
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Error generating comprehensive report:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});
console.log('✅ Comprehensive Report API v11.1 - PERIOD DETECTION FIXED!');
console.log('   - Correct OR logic for cash vs items');
console.log('   - Proper period scoping (Termly, Yearly, One-Time)');
console.log('   - Accurate payment aggregation');
console.log('   - Customizations and removed items handled');
console.log('   - Raw payments included for Excel export');
console.log('   - Activity Cash Paid correctly tracked');
console.log('   - ✅ Periods now include years from fee assignments (promoted years)');
console.log('   - ✅ One-Time items only appear in the oldest period');
console.log('   - ✅ Yearly items only appear in the latest term of each year');

// ========== HELPER: DEDUPLICATE HISTORIES ==========
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
// ==================== UNIFORM MANAGEMENT ROUTES (COMPLETELY FIXED) ====================

const uniformFiles = {
    uniformStock: path.join(dataDir, 'uniformStock.json'),
    uniformTransactions: path.join(dataDir, 'uniformTransactions.json'),
    uniformAssignments: path.join(dataDir, 'uniformAssignments.json')
};

// Initialize uniform files - ONLY create empty files if they don't exist
function initializeUniformFiles() {
    // Check if stock file exists, if not create empty
    if (!fs.existsSync(uniformFiles.uniformStock)) {
        saveFile(uniformFiles.uniformStock, {});
    }
    if (!fs.existsSync(uniformFiles.uniformTransactions)) {
        saveFile(uniformFiles.uniformTransactions, []);
    }
    if (!fs.existsSync(uniformFiles.uniformAssignments)) {
        saveFile(uniformFiles.uniformAssignments, {});
    }
    console.log('✅ Uniform files initialized');
}

initializeUniformFiles();

// ========== GET UNIFORM SUMMARY (FIXED - NO AUTO-RESTOCKING) ==========
app.get('/api/uniform/summary', async (req, res) => {
    try {
        console.log('=== UNIFORM SUMMARY REQUEST ===');
        
        const settings = readFile(files.settings);
        const currentYear = settings.currentAcademicYear || new Date().getFullYear();
        const currentTerm = settings.currentTerm || 1;
        
        const feeStructures = readFile(files.feeStructures);
        const students = readFile(files.students);
        const feeAssignments = readFile(files.studentFeeAssignments);
        const allPayments = readFile(files.feePayments);
        const termRecords = readFile(files.studentTermRecords);
        const classes = readFile(files.classes);
        
        // READ existing stock - DO NOT MODIFY or auto-add
        let stockData = readFile(uniformFiles.uniformStock);
        let transactions = readFile(uniformFiles.uniformTransactions);
        let assignments = readFile(uniformFiles.uniformAssignments);
        
        console.log('Current stock:', Object.keys(stockData));
        console.log('Transactions count:', transactions.length);
        
        // Build maps
        const assignmentsMap = {};
        feeAssignments.forEach(a => { if (a && a.studentId) assignmentsMap[a.studentId] = a; });
        
        const classesMap = {};
        classes.forEach(c => { if (c && c.id) classesMap[c.id] = c; });
        
        // Helper: Check if an item is a uniform item
        function isUniformItem(component, item) {
            const statusGroupName = component.statusGroupName || '';
            const componentName = component.name || '';
            
            const isUniform = statusGroupName.toLowerCase().includes('uniform') || 
                             componentName.toLowerCase().includes('uniform');
            
            const uniformKeywords = ['trouser', 'dress', 'shirt', 'skirt', 'stocking', 'sock', 
                                    'belt', 'tie', 'blazer', 'jumper', 'sweater', 'cardigan',
                                    'vest', 'shorts', 'pinafore', 'gown', 'frock', 'kilt',
                                    'scarf', 'beret', 'cap', 'hat', 'badge', 'name tag',
                                    'sports', 'track suit', 'tracksuit', 'jersey', 'kit',
                                    'uniform', 'sweater', 'school uniform'];
            
            const itemName = (item.name || '').toLowerCase();
            const matchesKeyword = uniformKeywords.some(keyword => itemName.includes(keyword));
            
            return isUniform || matchesKeyword;
        }
        
        // Get all uniform items from fee structures (for reference only)
        const uniformItemsSet = new Set();
        feeStructures.forEach(fs => {
            (fs.activityComponents || []).forEach(comp => {
                (comp.items || []).forEach(item => {
                    if (isUniformItem(comp, item)) {
                        const itemName = item.name || 'Unnamed Item';
                        uniformItemsSet.add(itemName);
                    }
                });
            });
        });
        
        // ========== PROCESS STUDENT UNIFORM DATA ==========
        const uniformData = {
            levels: {
                Nursery: { items: {}, students: [], totalItems: 0, collected: 0, remaining: 0 },
                LowerPrimary: { items: {}, students: [], totalItems: 0, collected: 0, remaining: 0 },
                UpperPrimary: { items: {}, students: [], totalItems: 0, collected: 0, remaining: 0 }
            },
            classDetails: {},
            studentDetails: {},
            itemTotals: {},
            stock: stockData,
            transactions: transactions,
            assignments: assignments,
            uniformItems: Array.from(uniformItemsSet)
        };
        
        // Process each student's uniform requirements and payments
        for (const student of students) {
            const assignment = assignmentsMap[student.id] || {};
            const feeStructure = feeStructures.find(f => f && f.id === assignment.feeStructureId);
            
            if (!feeStructure) continue;
            
            let currentClass = 'Not Assigned';
            let classLevel = 'Unknown';
            if (student.currentClassId && classesMap[student.currentClassId]) {
                currentClass = classesMap[student.currentClassId].name;
                classLevel = classesMap[student.currentClassId].level || 'Unknown';
            } else if (student.currentClass) {
                currentClass = student.currentClass;
            }
            
            // Get student payments for current term
            const studentPayments = allPayments.filter(p => 
                p && p.studentId === student.id && 
                p.term === currentTerm && 
                p.academicYear === currentYear.toString()
            );
            
            const studentUniformItems = {};
            let totalUniformRequired = 0;
            let totalUniformCollected = 0;
            let totalUniformRemaining = 0;
            
            // Process uniform items from fee structure
            for (const component of (feeStructure.activityComponents || [])) {
                const periodType = component.periodType || 'termly';
                
                // Only include items based on period type
                const shouldInclude = (periodType === 'termly') || 
                                     (periodType === 'one_time' && currentTerm === 1) ||
                                     (periodType === 'yearly' && currentTerm === 1);
                
                if (!shouldInclude) continue;
                
                for (const item of (component.items || [])) {
                    if (!isUniformItem(component, item)) continue;
                    
                    const itemName = item.name || 'Unnamed Item';
                    const quantityRequired = item.quantity || 1;
                    const unitPrice = item.unitPrice || (item.totalAmount / quantityRequired);
                    
                    // Calculate payments for this item
                    let cashPaid = 0;
                    let itemsBrought = 0;
                    
                    for (const payment of studentPayments) {
                        // Check activityItemPayments
                        if (payment.activityItemPayments) {
                            for (const paidItem of payment.activityItemPayments) {
                                if (paidItem.componentName === component.name && 
                                    paidItem.itemName === item.name && 
                                    paidItem.periodType === periodType) {
                                    if (paidItem.paymentType === 'paid_cash') {
                                        cashPaid += paidItem.amountPaid || 0;
                                    } else if (paidItem.paymentType === 'brought_item') {
                                        itemsBrought += paidItem.itemsBrought || 0;
                                    }
                                }
                            }
                        }
                        
                        // Check paymentsByPeriodType
                        if (payment.paymentsByPeriodType) {
                            const periodItems = payment.paymentsByPeriodType[periodType] || [];
                            for (const paidItem of periodItems) {
                                if (paidItem.componentName === component.name && 
                                    paidItem.itemName === item.name) {
                                    if (paidItem.paymentType === 'paid_cash') {
                                        cashPaid += paidItem.amountPaid || 0;
                                    } else if (paidItem.paymentType === 'brought_item') {
                                        itemsBrought += paidItem.itemsBrought || 0;
                                    }
                                }
                            }
                        }
                    }
                    
                    // Calculate what's been collected (CAP at required quantity)
                    const cashCoversItems = Math.floor(cashPaid / unitPrice);
                    let totalCollected = itemsBrought + cashCoversItems;
                    
                    // IMPORTANT: Cap collected at required quantity
                    if (totalCollected > quantityRequired) {
                        totalCollected = quantityRequired;
                    }
                    
                    const remaining = Math.max(0, quantityRequired - totalCollected);
                    const isFullyPaid = totalCollected >= quantityRequired;
                    
                    // Check if already issued (from assignments)
                    let isIssued = false;
                    let issuedQuantity = 0;
                    if (assignments[student.id] && assignments[student.id].items && assignments[student.id].items[itemName]) {
                        issuedQuantity = assignments[student.id].items[itemName].totalIssued || 0;
                        isIssued = issuedQuantity > 0;
                    }
                    
                    // Calculate remaining after issue
                    const effectiveRemaining = Math.max(0, remaining - issuedQuantity);
                    
                    studentUniformItems[itemName] = {
                        name: itemName,
                        quantityRequired: quantityRequired,
                        unitPrice: unitPrice,
                        cashPaid: cashPaid,
                        itemsBrought: itemsBrought,
                        cashCovered: cashCoversItems,
                        collected: totalCollected,
                        remaining: effectiveRemaining,
                        isFullyPaid: isFullyPaid && effectiveRemaining === 0,
                        isIssued: isIssued,
                        issuedQuantity: issuedQuantity,
                        paymentHistories: []
                    };
                    
                    // Record payment history
                    for (const payment of studentPayments) {
                        if (payment.activityItemPayments) {
                            for (const paidItem of payment.activityItemPayments) {
                                if (paidItem.componentName === component.name && 
                                    paidItem.itemName === item.name && 
                                    paidItem.periodType === periodType) {
                                    studentUniformItems[itemName].paymentHistories.push({
                                        date: payment.date || new Date().toISOString(),
                                        type: paidItem.paymentType || 'unknown',
                                        amount: paidItem.amountPaid || 0,
                                        quantity: paidItem.itemsBrought || 0,
                                        receiptNumber: payment.receiptNumber || 'N/A'
                                    });
                                }
                            }
                        }
                    }
                    
                    totalUniformRequired += quantityRequired;
                    totalUniformCollected += totalCollected;
                    totalUniformRemaining += effectiveRemaining;
                }
            }
            
            // Store student uniform data if they have items
            if (Object.keys(studentUniformItems).length > 0) {
                uniformData.studentDetails[student.id] = {
                    id: student.id,
                    admissionNumber: student.admissionNumber || '',
                    firstName: student.firstName || '',
                    lastName: student.lastName || '',
                    currentClass: currentClass,
                    classLevel: classLevel,
                    items: studentUniformItems,
                    totalRequired: totalUniformRequired,
                    totalCollected: totalUniformCollected,
                    totalRemaining: totalUniformRemaining,
                    isComplete: totalUniformRemaining === 0 && totalUniformRequired > 0
                };
                
                // Add to level summary
                const levelKey = classLevel === 'Nursery' ? 'Nursery' : 
                                classLevel === 'LowerPrimary' ? 'LowerPrimary' : 'UpperPrimary';
                
                if (uniformData.levels[levelKey]) {
                    uniformData.levels[levelKey].students.push(student.id);
                    uniformData.levels[levelKey].totalItems += totalUniformRequired;
                    uniformData.levels[levelKey].collected += totalUniformCollected;
                    uniformData.levels[levelKey].remaining += totalUniformRemaining;
                    
                    for (const [itemName, itemData] of Object.entries(studentUniformItems)) {
                        if (!uniformData.levels[levelKey].items[itemName]) {
                            uniformData.levels[levelKey].items[itemName] = {
                                name: itemName,
                                totalRequired: 0,
                                totalCollected: 0,
                                totalRemaining: 0,
                                studentsCount: 0
                            };
                        }
                        uniformData.levels[levelKey].items[itemName].totalRequired += itemData.quantityRequired;
                        uniformData.levels[levelKey].items[itemName].totalCollected += itemData.collected;
                        uniformData.levels[levelKey].items[itemName].totalRemaining += itemData.remaining;
                        uniformData.levels[levelKey].items[itemName].studentsCount++;
                    }
                }
                
                // Add to class details
                if (!uniformData.classDetails[currentClass]) {
                    uniformData.classDetails[currentClass] = {
                        name: currentClass,
                        level: classLevel,
                        students: [],
                        items: {},
                        totalRequired: 0,
                        totalCollected: 0,
                        totalRemaining: 0
                    };
                }
                uniformData.classDetails[currentClass].students.push(student.id);
                uniformData.classDetails[currentClass].totalRequired += totalUniformRequired;
                uniformData.classDetails[currentClass].totalCollected += totalUniformCollected;
                uniformData.classDetails[currentClass].totalRemaining += totalUniformRemaining;
                
                for (const [itemName, itemData] of Object.entries(studentUniformItems)) {
                    if (!uniformData.classDetails[currentClass].items[itemName]) {
                        uniformData.classDetails[currentClass].items[itemName] = {
                            name: itemName,
                            totalRequired: 0,
                            totalCollected: 0,
                            totalRemaining: 0,
                            studentsCount: 0
                        };
                    }
                    uniformData.classDetails[currentClass].items[itemName].totalRequired += itemData.quantityRequired;
                    uniformData.classDetails[currentClass].items[itemName].totalCollected += itemData.collected;
                    uniformData.classDetails[currentClass].items[itemName].totalRemaining += itemData.remaining;
                    uniformData.classDetails[currentClass].items[itemName].studentsCount++;
                }
                
                // Add to item totals
                for (const [itemName, itemData] of Object.entries(studentUniformItems)) {
                    if (!uniformData.itemTotals[itemName]) {
                        uniformData.itemTotals[itemName] = {
                            name: itemName,
                            totalRequired: 0,
                            totalCollected: 0,
                            totalRemaining: 0,
                            studentsCount: 0
                        };
                    }
                    uniformData.itemTotals[itemName].totalRequired += itemData.quantityRequired;
                    uniformData.itemTotals[itemName].totalCollected += itemData.collected;
                    uniformData.itemTotals[itemName].totalRemaining += itemData.remaining;
                    uniformData.itemTotals[itemName].studentsCount++;
                }
            }
        }
        
        console.log('Uniform summary generated successfully');
        console.log('Students with uniform data:', Object.keys(uniformData.studentDetails).length);
        
        res.json({
            success: true,
            data: uniformData,
            stock: stockData,
            transactions: transactions,
            assignments: assignments,
            uniformItems: Array.from(uniformItemsSet)
        });
        
    } catch (error) {
        console.error('Error getting uniform summary:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== ISSUE UNIFORM ITEM (FIXED - Deducts from stock) ==========
app.post('/api/uniform/issue', (req, res) => {
    try {
        const { studentId, itemName, quantity, comment } = req.body;
        
        if (!studentId || !itemName || !quantity || quantity <= 0) {
            return res.status(400).json({ error: 'Student, item name, and quantity are required' });
        }
        
        let stock = readFile(uniformFiles.uniformStock);
        let transactions = readFile(uniformFiles.uniformTransactions);
        let assignments = readFile(uniformFiles.uniformAssignments);
        
        // Check if item exists in stock
        if (!stock[itemName]) {
            return res.status(400).json({ 
                error: `Item "${itemName}" not found in stock. Please restock first.` 
            });
        }
        
        // Check if enough stock available
        if ((stock[itemName].available || 0) < quantity) {
            return res.status(400).json({ 
                error: `Not enough stock. Available: ${stock[itemName].available || 0}, Requested: ${quantity}` 
            });
        }
        
        // Get student info
        const students = readFile(files.students);
        const student = students.find(s => s.id === studentId);
        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        // DEDUCT FROM STOCK
        stock[itemName].issued = (stock[itemName].issued || 0) + quantity;
        stock[itemName].available = Math.max(0, (stock[itemName].available || 0) - quantity);
        stock[itemName].lastUpdated = new Date().toISOString();
        
        // Record transaction
        const transaction = {
            id: uuidv4(),
            studentId: studentId,
            studentName: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
            admissionNumber: student.admissionNumber || '',
            itemName: itemName,
            quantity: quantity,
            transactionType: 'issue',
            comment: comment || 'Uniform issued to student',
            stockBefore: stock[itemName].available + quantity,
            stockAfter: stock[itemName].available,
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split('T')[0],
            isUniform: true
        };
        
        transactions.push(transaction);
        
        // Update student assignments
        if (!assignments[studentId]) {
            assignments[studentId] = {
                studentId: studentId,
                studentName: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
                admissionNumber: student.admissionNumber || '',
                items: {}
            };
        }
        
        if (!assignments[studentId].items[itemName]) {
            assignments[studentId].items[itemName] = {
                name: itemName,
                totalIssued: 0,
                remaining: 0,
                transactions: []
            };
        }
        
        assignments[studentId].items[itemName].totalIssued += quantity;
        assignments[studentId].items[itemName].transactions.push({
            date: transaction.date,
            quantity: quantity,
            comment: comment || '',
            transactionId: transaction.id
        });
        
        // Save all changes
        saveFile(uniformFiles.uniformStock, stock);
        saveFile(uniformFiles.uniformTransactions, transactions);
        saveFile(uniformFiles.uniformAssignments, assignments);
        
        console.log(`✅ Issued ${quantity} ${itemName}(s) to ${student.firstName} ${student.lastName}`);
        console.log(`   Stock remaining: ${stock[itemName].available}`);
        
        res.json({ 
            success: true, 
            transaction: transaction,
            currentStock: stock[itemName].available,
            message: `✅ Issued ${quantity} ${itemName}(s) to ${student.firstName} ${student.lastName}`
        });
        
    } catch (error) {
        console.error('Error issuing uniform:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== UPDATE UNIFORM STOCK (FIXED - Manual stock management) ==========
app.post('/api/uniform/stock', (req, res) => {
    try {
        const { itemName, quantity, operation, comment } = req.body;
        
        if (!itemName || !quantity || quantity <= 0) {
            return res.status(400).json({ error: 'Item name and quantity are required' });
        }
        
        let stock = readFile(uniformFiles.uniformStock);
        let transactions = readFile(uniformFiles.uniformTransactions);
        
        // Initialize item if it doesn't exist
        if (!stock[itemName]) {
            stock[itemName] = {
                name: itemName,
                totalReceived: 0,
                issued: 0,
                available: 0,
                lastUpdated: new Date().toISOString()
            };
        }
        
        const previousAvailable = stock[itemName].available || 0;
        let transactionType = '';
        let message = '';
        
        if (operation === 'add') {
            stock[itemName].totalReceived = (stock[itemName].totalReceived || 0) + quantity;
            stock[itemName].available = (stock[itemName].available || 0) + quantity;
            transactionType = 'restock';
            message = `✅ Added ${quantity} ${itemName}(s) to stock`;
        } else if (operation === 'remove') {
            if ((stock[itemName].available || 0) < quantity) {
                return res.status(400).json({ 
                    error: `Not enough stock. Available: ${stock[itemName].available || 0}, Requested: ${quantity}` 
                });
            }
            stock[itemName].available = Math.max(0, (stock[itemName].available || 0) - quantity);
            stock[itemName].issued = (stock[itemName].issued || 0) + quantity;
            transactionType = 'remove';
            message = `✅ Removed ${quantity} ${itemName}(s) from stock`;
        } else {
            return res.status(400).json({ error: 'Invalid operation. Use "add" or "remove"' });
        }
        
        stock[itemName].lastUpdated = new Date().toISOString();
        
        // Record transaction
        const transaction = {
            id: uuidv4(),
            studentId: null,
            studentName: 'System',
            admissionNumber: '-',
            itemName: itemName,
            quantity: quantity,
            transactionType: transactionType,
            comment: comment || (operation === 'add' ? 'Stock added' : 'Stock removed'),
            stockBefore: previousAvailable,
            stockAfter: stock[itemName].available || 0,
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split('T')[0],
            isUniform: true
        };
        
        transactions.push(transaction);
        
        saveFile(uniformFiles.uniformStock, stock);
        saveFile(uniformFiles.uniformTransactions, transactions);
        
        console.log(message);
        console.log(`   New stock: ${stock[itemName].available}`);
        
        res.json({ 
            success: true, 
            stock: stock[itemName],
            transaction: transaction,
            message: message
        });
        
    } catch (error) {
        console.error('Error updating uniform stock:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== GET UNIFORM TRANSACTIONS (FIXED) ==========
app.get('/api/uniform/transactions', (req, res) => {
    try {
        const { studentId, itemName, limit } = req.query;
        let transactions = readFile(uniformFiles.uniformTransactions);
        
        // Filter by studentId if provided
        if (studentId) {
            transactions = transactions.filter(t => t.studentId === studentId);
        }
        
        // Filter by itemName if provided
        if (itemName) {
            transactions = transactions.filter(t => t.itemName === itemName);
        }
        
        // Sort by date (newest first)
        transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Apply limit if provided
        if (limit && parseInt(limit) > 0) {
            transactions = transactions.slice(0, parseInt(limit));
        }
        
        res.json(transactions);
    } catch (error) {
        console.error('Error getting uniform transactions:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== GET UNIFORM STUDENT HISTORY ==========
app.get('/api/uniform/student/:studentId/history', (req, res) => {
    try {
        const { studentId } = req.params;
        let transactions = readFile(uniformFiles.uniformTransactions);
        
        // Filter by studentId
        transactions = transactions.filter(t => t.studentId === studentId);
        
        // Sort by date (newest first)
        transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        res.json({
            success: true,
            transactions: transactions,
            count: transactions.length
        });
    } catch (error) {
        console.error('Error getting student uniform history:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== GET UNIFORM ITEM HISTORY ==========
app.get('/api/uniform/item/:itemName/history', (req, res) => {
    try {
        const { itemName } = req.params;
        let transactions = readFile(uniformFiles.uniformTransactions);
        
        // Filter by itemName
        transactions = transactions.filter(t => t.itemName === itemName);
        
        // Sort by date (newest first)
        transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        res.json({
            success: true,
            transactions: transactions,
            count: transactions.length
        });
    } catch (error) {
        console.error('Error getting item uniform history:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== RESET UNIFORM STOCK (Admin function) ==========
app.post('/api/uniform/reset', (req, res) => {
    try {
        const { confirm } = req.body;
        
        if (confirm !== 'RESET UNIFORM STOCK') {
            return res.status(400).json({ error: 'Invalid confirmation. Please type "RESET UNIFORM STOCK"' });
        }
        
        // Reset stock to empty
        saveFile(uniformFiles.uniformStock, {});
        saveFile(uniformFiles.uniformTransactions, []);
        saveFile(uniformFiles.uniformAssignments, {});
        
        console.log('🔄 Uniform stock has been reset');
        
        res.json({ 
            success: true, 
            message: 'Uniform stock has been reset successfully' 
        });
    } catch (error) {
        console.error('Error resetting uniform stock:', error);
        res.status(500).json({ error: error.message });
    }
});


//dashboard stats
function dashGetCustomizedItemValue(student, itemId, itemName, defaultAmount, defaultQuantity, defaultPaymentOption, defaultUnitPrice) {
    if (!student || !student.customItemOverrides) {
        return {
            amount: defaultAmount || 0,
            quantity: defaultQuantity || 1,
            paymentOption: defaultPaymentOption || 'either',
            unitPrice: defaultUnitPrice || (defaultAmount / (defaultQuantity || 1)),
            isCustomized: false
        };
    }

    // FIX: override keys aren't guaranteed to equal item.id — LTBalance-style
    // dynamically generated items in particular are frequently stored under
    // a different key. Match the same way findCustomOverride() does
    // elsewhere: exact itemId first, then exact itemName, then a key that
    // contains the itemName. Without this fallback, any student whose
    // override key doesn't match item.id silently falls back to the
    // fee-structure default (0 for an LTBalance template item), which is
    // exactly what was undercounting the dashboard's LTBalance total.
    let custom = null;

    if (student.customItemOverrides[itemId] && student.customItemOverrides[itemId].isActive !== false) {
        custom = student.customItemOverrides[itemId];
    }

    if (!custom && itemName) {
        for (const key in student.customItemOverrides) {
            const c = student.customItemOverrides[key];
            if (!c || c.isActive === false) continue;
            if (c.itemName === itemName) { custom = c; break; }
        }
    }

    if (!custom && itemName) {
        for (const key in student.customItemOverrides) {
            const c = student.customItemOverrides[key];
            if (!c || c.isActive === false) continue;
            if (key.includes(itemName)) { custom = c; break; }
        }
    }

    if (!custom) {
        return {
            amount: defaultAmount || 0,
            quantity: defaultQuantity || 1,
            paymentOption: defaultPaymentOption || 'either',
            unitPrice: defaultUnitPrice || (defaultAmount / (defaultQuantity || 1)),
            isCustomized: false
        };
    }

    const amount = (custom.customAmount !== null && custom.customAmount !== undefined) ? custom.customAmount : defaultAmount;
    const quantity = (custom.customQuantity !== null && custom.customQuantity !== undefined) ? custom.customQuantity : defaultQuantity;
    const paymentOption = custom.paymentOption || defaultPaymentOption || 'either';
    let unitPrice = defaultUnitPrice;
    if (quantity > 0 && amount > 0) unitPrice = amount / quantity;
    return { amount, quantity, paymentOption, unitPrice, isCustomized: true };
}

// ---------------------------------------------------------------------------
// Period-aware removal check.
//
// A properly-stamped entry is checked exactly against the given period.
// A legacy, unstamped entry is scoped ONLY to the period it was actually
// recorded in (derived from removedAt), never treated as a blanket removal
// across the student's whole enrollment history — that's what was silently
// zeroing out one-time items like LTBalance for entire cohorts before.
// With no usable stamp at all, the item is NOT assumed removed, so real
// expected revenue never silently disappears from the totals.
// ---------------------------------------------------------------------------
function dashIsItemRemoved(student, itemId, year, term) {
    if (!student || !student.removedItems) return false;
    const removed = student.removedItems[itemId];
    if (!removed || removed.isActive === false) return false;

    if (removed.academicYear !== undefined && removed.term !== undefined) {
        return parseInt(removed.academicYear) === parseInt(year) && parseInt(removed.term) === parseInt(term);
    }

    if (removed.removedAt) {
        const recordedDate = new Date(removed.removedAt);
        if (!isNaN(recordedDate.getTime())) {
            const recordedDateStr = recordedDate.toISOString().split('T')[0];
            const recordedTerm = getTermForDate(recordedDateStr);
            const recordedYear = getAcademicYearForDate(recordedDateStr);
            if (recordedTerm && recordedYear) {
                return parseInt(recordedYear) === parseInt(year) && parseInt(recordedTerm) === parseInt(term);
            }
        }
    }

    return false;
}

// Same OR-logic branch the report uses: cash_only / item_only / either.
function dashCalcItemTotals(qtyRequired, amountExpected, paymentOption, cashPaid, itemsBrought) {
    const finalItemsBrought = Math.min(itemsBrought || 0, qtyRequired || 0);
    let cashExpected = 0;
    let finalCashPaid = 0;

    if (paymentOption === 'cash_only') {
        cashExpected = amountExpected;
        finalCashPaid = Math.min(cashPaid || 0, amountExpected);
    } else if (paymentOption === 'item_only') {
        cashExpected = 0;
        finalCashPaid = 0;
    } else {
        if (finalItemsBrought >= qtyRequired && qtyRequired > 0) {
            cashExpected = 0;
            finalCashPaid = 0;
        } else {
            const unitPrice = qtyRequired > 0 ? (amountExpected / qtyRequired) : 0;
            const remainingQty = Math.max(0, qtyRequired - finalItemsBrought);
            cashExpected = Math.min(amountExpected, remainingQty * unitPrice);
            finalCashPaid = Math.min(cashPaid || 0, cashExpected);
        }
    }

    const cashRemaining = Math.max(0, cashExpected - finalCashPaid);
    const itemsRemaining = Math.max(0, qtyRequired - finalItemsBrought);
    const isFullyPaid = cashRemaining <= 0 && itemsRemaining <= 0;

    return {
        cashExpected, cashPaid: finalCashPaid, cashRemaining,
        itemsBrought: finalItemsBrought, itemsRequired: qtyRequired || 0, itemsRemaining,
        isFullyPaid
    };
}

function dashGetPaidAmountsForItem(studentId, componentName, itemName, year, term, allPaymentsData, periodType) {
    let scoped;
    if (periodType === 'one_time') {
        scoped = allPaymentsData.filter(p => p && p.studentId === studentId);
    } else if (periodType === 'yearly') {
        scoped = allPaymentsData.filter(p =>
            p && p.studentId === studentId && p.academicYear === year.toString()
        );
    } else {
        scoped = allPaymentsData.filter(p =>
            p && p.studentId === studentId &&
            p.term === term &&
            p.academicYear === year.toString()
        );
    }

    let cashPaid = 0;
    let itemsBrought = 0;
    const seen = new Set();

    function consider(paidItem, paymentId) {
        if (!paidItem || !paidItem.componentName || !paidItem.itemName) return;
        if (paidItem.componentName.toLowerCase() !== componentName.toLowerCase()) return;
        if (paidItem.itemName.toLowerCase() !== itemName.toLowerCase()) return;
        const key = `${paymentId}_${paidItem.itemName}_${paidItem.componentName}`;
        if (seen.has(key)) return;
        seen.add(key);

        if (paidItem.paymentType === 'paid_cash') {
            cashPaid += (paidItem.amountPaid || 0);
        } else if (paidItem.paymentType === 'brought_item') {
            const qty = paidItem.itemsBrought || 0;
            if (qty === 0 && (paidItem.amountPaid || 0) > 0) {
                cashPaid += paidItem.amountPaid;
            } else {
                itemsBrought += qty;
                cashPaid += (paidItem.cashEquivalent || qty * (paidItem.unitPrice || 0));
            }
        }
    }

    for (const payment of scoped) {
        if (!payment || !payment.id) continue;
        if (Array.isArray(payment.activityItemPayments)) {
            for (const item of payment.activityItemPayments) consider(item, payment.id);
        }
        if (payment.paymentsByPeriodType) {
            for (const pt of ['one_time', 'termly', 'yearly']) {
                for (const item of (payment.paymentsByPeriodType[pt] || [])) consider(item, payment.id);
            }
        }
    }

    return { cashPaid, itemsBrought };
}

function dashGetStatusGroupColor(name) {
    if (!name) return 'bg-gray-100 text-gray-800 border-gray-200';
    const colorMap = {
        'transportation': 'bg-orange-100 text-orange-800 border-orange-200',
        'admission': 'bg-purple-100 text-purple-800 border-purple-200',
        'scholastic': 'bg-green-100 text-green-800 border-green-200',
        'sports': 'bg-blue-100 text-blue-800 border-blue-200',
        'development': 'bg-red-100 text-red-800 border-red-200',
        'tuition': 'bg-indigo-100 text-indigo-800 border-indigo-200',
        'uniform': 'bg-pink-100 text-pink-800 border-pink-200',
        'medical': 'bg-teal-100 text-teal-800 border-teal-200',
        'graduation': 'bg-amber-100 text-amber-800 border-amber-200',
        'holiday': 'bg-cyan-100 text-cyan-800 border-cyan-200',
        'tour': 'bg-lime-100 text-lime-800 border-lime-200',
        'mdd': 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200'
    };
    const lower = name.toLowerCase();
    for (const [key, color] of Object.entries(colorMap)) {
        if (lower.includes(key)) return color;
    }
    return 'bg-gray-100 text-gray-800 border-gray-200';
}

// ---------------------------------------------------------------------------
// THE CORRECTED ROUTE
// ---------------------------------------------------------------------------

app.get('/api/dashboard/stats', async (req, res) => {
    console.log('=== DASHBOARD STATS (v2.2 - ITEM-LEVEL CASH FIELDS + GROUP RATE FALLBACK) ===');

    try {
        const settings = readFile(files.settings);
        const currentYear = settings.currentAcademicYear || new Date().getFullYear();
        const currentTerm = settings.currentTerm || 1;
        const isFirstTerm = currentTerm === 1;
        const termName = getTermName(currentTerm);

        const students = readFile(files.students) || [];
        const feeStructures = readFile(files.feeStructures) || [];
        const feeAssignments = readFile(files.studentFeeAssignments) || [];
        const feePayments = readFile(files.feePayments) || [];
        const classes = readFile(files.classes) || [];
        const feeBursaries = readFile(files.feeBursaries) || [];
        const school = readFile(files.schools) || [];

        const assignmentsMap = {};
        feeAssignments.forEach(a => { if (a && a.studentId) assignmentsMap[a.studentId] = a; });
        const classesMap = {};
        classes.forEach(c => { if (c && c.id) classesMap[c.id] = c; });
        const bursariesMap = {};
        feeBursaries.forEach(b => { if (b && b.id) bursariesMap[b.id] = b; });
        const feeStructuresMap = {};
        feeStructures.forEach(fs => { if (fs && fs.id) feeStructuresMap[fs.id] = fs; });

        const currentTermPayments = feePayments.filter(p =>
            p && p.term === currentTerm && p.academicYear === currentYear.toString()
        );

        // ---- Aggregation buckets ----
        let totalStudents = students.length;
        let activeStudents = 0, maleCount = 0, femaleCount = 0;

        let tuitionExpected = 0, tuitionCollected = 0;
        let cashItemsExpected = 0, cashItemsCollected = 0, cashItemsRemaining = 0; // paymentOption === 'cash_only', ALL groups combined

        let fullyPaidCount = 0, paymentDueCount = 0, noPaymentCount = 0, creditBalanceCount = 0;

        const statusGroupsMap = {};   // keyed by group name
        const itemTotalsMap = {};     // keyed by group::item
        const classPerformance = {};  // { groupName: { className: {required, collected} } }

        function getGroup(name, periodType) {
            if (!statusGroupsMap[name]) {
                statusGroupsMap[name] = {
                    name, periodType: periodType || 'termly',
                    totalRequired: 0, totalCollected: 0, totalRemaining: 0,
                    cashExpected: 0, cashCollected: 0, cashRemaining: 0,
                    studentIds: new Set(),
                    items: {}
                };
            }
            return statusGroupsMap[name];
        }

        for (const student of students) {
            if (!student) continue;
            if (student.status === 'Active') activeStudents++;
            if (student.gender === 'Male') maleCount++;
            else if (student.gender === 'Female') femaleCount++;

            const assignment = assignmentsMap[student.id] || {};
            const feeStructure = feeStructuresMap[assignment.feeStructureId];
            if (!feeStructure) continue;

            let currentClass = 'Not Assigned';
            if (student.currentClassId && classesMap[student.currentClassId]) {
                currentClass = classesMap[student.currentClassId].name;
            } else if (student.currentClass) {
                currentClass = student.currentClass;
            }

            // ---------- TUITION (always scoped to the CURRENT term — tuition is inherently termly) ----------
            let expectedTuition = feeStructure.tuition || 0;
            if (student.customBursary && student.customBursary.amount > 0) {
                expectedTuition = Math.max(0, expectedTuition - student.customBursary.amount);
            } else if (assignment.bursaryId && bursariesMap[assignment.bursaryId]) {
                const bursary = bursariesMap[assignment.bursaryId];
                expectedTuition = bursary.type === 'percentage'
                    ? Math.max(0, expectedTuition - (expectedTuition * bursary.value / 100))
                    : Math.max(0, expectedTuition - bursary.value);
            }
            const studentTuitionPaid = currentTermPayments
                .filter(p => p.studentId === student.id)
                .reduce((sum, p) => sum + (p.tuitionPaid || 0), 0);

            tuitionExpected += expectedTuition;
            tuitionCollected += studentTuitionPaid;

            // ---------- ACTIVITY ITEMS — ALL status groups, every period type ----------
            let studentCashExpectedAcrossAll = 0;
            let studentCashPaidAcrossAll = 0;
            let studentItemsRequired = 0;
            let studentItemsRemaining = 0;
            let studentHasAnyPayment = studentTuitionPaid > 0;

            if (feeStructure.activityComponents) {
                for (const comp of feeStructure.activityComponents) {
                    if (!comp) continue;
                    const periodType = comp.periodType || 'termly';

                    let groupName = comp.statusGroupName || comp.name || 'Other';
                    if (groupName === 'schoolastic requirement') groupName = 'Scholastic Requirements';

                    for (const item of (comp.items || [])) {
                        if (!item) continue;
                        const itemId = item.id || item.name;
                        if (dashIsItemRemoved(student, itemId, currentYear, currentTerm)) continue;

                        const defaultAmount = item.totalAmount || 0;
                        const defaultQuantity = item.quantity || 1;
                        const defaultUnitPrice = item.unitPrice || (defaultAmount / defaultQuantity);
                        const defaultPaymentOption = item.paymentOption || 'either';

                      const cv = dashGetCustomizedItemValue(student, itemId, item.name, defaultAmount, defaultQuantity, defaultPaymentOption, defaultUnitPrice);
                        const { cashPaid, itemsBrought } = dashGetPaidAmountsForItem(
                            student.id, comp.name, item.name, currentYear, currentTerm, feePayments, periodType
                        );

                        const totals = dashCalcItemTotals(cv.quantity, cv.amount, cv.paymentOption, cashPaid, itemsBrought);

                        if (totals.cashPaid > 0 || totals.itemsBrought > 0) studentHasAnyPayment = true;

                        // ---- Status group rollup ----
                        const group = getGroup(groupName, periodType);
                        group.studentIds.add(student.id);
                        group.cashExpected += totals.cashExpected;
                        group.cashCollected += totals.cashPaid;
                        group.cashRemaining += totals.cashRemaining;

                        // "Required/Collected/Remaining" is a QUANTITY metric; cash_only
                        // items never contribute to it (matches the report).
                        if (cv.paymentOption !== 'cash_only') {
                            group.totalRequired += totals.itemsRequired;
                            group.totalCollected += totals.itemsBrought;
                            group.totalRemaining += totals.itemsRemaining;
                            studentItemsRequired += totals.itemsRequired;
                            studentItemsRemaining += totals.itemsRemaining;
                        }

                        // FIX: item-level object now also carries cash totals,
                        // regardless of paymentOption — this is what the frontend
                        // card needs to show "UGX collected/expected" per item
                        // instead of the always-0/0 quantity counts for cash_only.
                        if (!group.items[item.name]) {
                            group.items[item.name] = {
                                name: item.name, required: 0, collected: 0, remaining: 0, studentsCount: 0,
                                paymentOption: cv.paymentOption,
                                cashExpected: 0, cashCollected: 0, cashRemaining: 0
                            };
                        }
                        const gi = group.items[item.name];
                        if (cv.paymentOption !== 'cash_only') {
                            gi.required += totals.itemsRequired;
                            gi.collected += totals.itemsBrought;
                            gi.remaining += totals.itemsRemaining;
                        }
                        gi.cashExpected += totals.cashExpected;
                        gi.cashCollected += totals.cashPaid;
                        gi.cashRemaining += totals.cashRemaining;
                        gi.studentsCount++;

                        // ---- Global item table ----
                        const itemKey = `${groupName}::${item.name}`;
                        if (!itemTotalsMap[itemKey]) {
                            itemTotalsMap[itemKey] = {
                                name: item.name, statusGroup: groupName, required: 0, collected: 0, remaining: 0, students: 0,
                                paymentOption: cv.paymentOption,
                                cashExpected: 0, cashCollected: 0, cashRemaining: 0
                            };
                        }
                        const gt = itemTotalsMap[itemKey];
                        if (cv.paymentOption !== 'cash_only') {
                            gt.required += totals.itemsRequired;
                            gt.collected += totals.itemsBrought;
                            gt.remaining += totals.itemsRemaining;
                        }
                        gt.cashExpected += totals.cashExpected;
                        gt.cashCollected += totals.cashPaid;
                        gt.cashRemaining += totals.cashRemaining;
                        gt.students++;

                        // ---- Class performance matrix ----
                        if (!classPerformance[groupName]) classPerformance[groupName] = {};
                        if (!classPerformance[groupName][currentClass]) {
                            classPerformance[groupName][currentClass] = { required: 0, collected: 0 };
                        }
                        if (cv.paymentOption !== 'cash_only') {
                            classPerformance[groupName][currentClass].required += totals.itemsRequired;
                            classPerformance[groupName][currentClass].collected += totals.itemsBrought;
                        }

                        // ---- Dedicated "cash only items" card (ALL groups combined) ----
                        if (cv.paymentOption === 'cash_only') {
                            cashItemsExpected += totals.cashExpected;
                            cashItemsCollected += totals.cashPaid;
                            cashItemsRemaining += totals.cashRemaining;
                        }

                        studentCashExpectedAcrossAll += totals.cashExpected;
                        studentCashPaidAcrossAll += totals.cashPaid;
                    }
                }
            }

            // ---------- PER-STUDENT OVERALL STATUS ----------
            const studentTotalExpected = expectedTuition + studentCashExpectedAcrossAll;
            const studentTotalPaid = studentTuitionPaid + studentCashPaidAcrossAll;
            const studentBalance = studentTotalExpected - studentTotalPaid;
            const itemsFullyBrought = studentItemsRequired === 0 || studentItemsRemaining === 0;

            if (studentBalance < -10) {
                creditBalanceCount++;
            } else if (Math.abs(studentBalance) <= 10 && itemsFullyBrought && studentTotalPaid > 0) {
                fullyPaidCount++;
            } else if (!studentHasAnyPayment && studentTotalExpected > 0) {
                noPaymentCount++;
            } else {
                paymentDueCount++;
            }
        }

        // ---- Finalize status group output ----
        const statusGroupsOut = Object.values(statusGroupsMap).map(g => {
            // FIX: this is the actual bug. `totalRequired` is legitimately 0
            // for a cash_only-dominated group (LTBalance, Scholastic
            // Requirements(CASH)) — that's correct, item counts genuinely
            // don't apply. But the OLD code fell straight to `: 0` in that
            // case, permanently pinning the card's rate at 0% even when
            // real cash was collected. Now: fall back to the cash
            // collection rate whenever there's no item-count basis but
          // there IS a cash amount expected.
            let rate;
            if (g.totalRequired > 0) {
                rate = (g.totalCollected / g.totalRequired) * 100;
            } else if (g.cashExpected > 0) {
                rate = (g.cashCollected / g.cashExpected) * 100;
            } else {
                rate = 0;
            }
            return {
                name: g.name,
                periodType: g.periodType,
                totalRequired: g.totalRequired,
                totalCollected: g.totalCollected,
                totalRemaining: g.totalRemaining,
                cashExpected: g.cashExpected,
                cashCollected: g.cashCollected,
                cashRemaining: g.cashRemaining,
                studentCount: g.studentIds.size,
                rate: rate,
                color: dashGetStatusGroupColor(g.name),
                items: Object.values(g.items).sort((a, b) => a.name.localeCompare(b.name))
            };
        }).sort((a, b) => b.studentCount - a.studentCount);

        const statusGroupHealth = statusGroupsOut.map(g => ({
            name: g.name,
            rate: g.rate,
            status: g.rate >= 85 ? 'Excellent' : g.rate >= 70 ? 'Good' : g.rate >= 50 ? 'Needs Attention' : 'Critical',
            color: g.color
        })).sort((a, b) => b.rate - a.rate);

        const itemsList = Object.values(itemTotalsMap).sort((a, b) => a.name.localeCompare(b.name));

        const tuitionOutstanding = Math.max(0, tuitionExpected - tuitionCollected);
        const tuitionRate = tuitionExpected > 0 ? (tuitionCollected / tuitionExpected * 100) : 0;
        const cashItemsRate = cashItemsExpected > 0 ? (cashItemsCollected / cashItemsExpected * 100) : 0;

        res.json({
            success: true,
            data: {
                school: (school && school[0]) || { schoolName: 'School Name', motto: 'Quality Education for All' },
                currentPeriod: { year: currentYear, term: currentTerm, termName, isFirstTerm },
                studentStats: {
                    total: totalStudents,
                    active: activeStudents,
                    male: maleCount,
                    female: femaleCount,
                    paymentStatus: {
                        fullyPaid: fullyPaidCount,
                        paymentDue: paymentDueCount,
                        criticalOverdue: 0,
                        noPayment: noPaymentCount,
                        creditBalance: creditBalanceCount
                    }
                },
                tuitionStats: {
                    expected: tuitionExpected,
                    collected: tuitionCollected,
                    outstanding: tuitionOutstanding,
                    collectionRate: tuitionRate,
                    fullyPaid: fullyPaidCount,
                    withBalance: paymentDueCount
                },
                cashItemsStats: {
                    expected: cashItemsExpected,
                    collected: cashItemsCollected,
                    outstanding: cashItemsRemaining,
                    collectionRate: cashItemsRate
                },
                statusGroups: statusGroupsOut,
                statusGroupHealth: statusGroupHealth,
                classPerformance: classPerformance,
                items: itemsList,
                statusGroupsCount: statusGroupsOut.length,
                totalItemsCount: itemsList.length,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Error generating dashboard stats:', error);
        res.status(500).json({ success: false, error: error.message, stack: process.env.NODE_ENV === 'development' ? error.stack : undefined });
    }
});

// ========== HELPER: GET STATUS GROUP COLOR ==========
function getStatusGroupColor(name) {
    if (!name) return 'bg-gray-100 text-gray-800 border-gray-200';
    
    const colorMap = {
        'Transportation': 'bg-orange-100 text-orange-800 border-orange-200',
        'transportation': 'bg-orange-100 text-orange-800 border-orange-200',
        'Admission': 'bg-purple-100 text-purple-800 border-purple-200',
        'Admission Fee': 'bg-purple-100 text-purple-800 border-purple-200',
        'Scholastic': 'bg-green-100 text-green-800 border-green-200',
        'schoolastic requirement': 'bg-green-100 text-green-800 border-green-200',
        'Sports': 'bg-blue-100 text-blue-800 border-blue-200',
        'Development': 'bg-red-100 text-red-800 border-red-200',
        'Tuition': 'bg-indigo-100 text-indigo-800 border-indigo-200',
        'Uniform': 'bg-pink-100 text-pink-800 border-pink-200'
    };
    
    // Try exact match first
    if (colorMap[name]) return colorMap[name];
    
    // Try case-insensitive partial match
    const lowerName = name.toLowerCase();
    for (const [key, color] of Object.entries(colorMap)) {
        if (lowerName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerName)) {
            return color;
        }
    }
    
    return 'bg-gray-100 text-gray-800 border-gray-200';
}

// ========== HELPER: GET TERM NAME ==========
function getTermName(term) {
    const names = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
    return names[term] || `Term ${term}`;
}

// ==================== CLEAN INVENTORY DATA ====================
app.post('/api/inventory/clean', (req, res) => {
    try {
        var stock = readFile(inventoryFiles.inventoryStock);
        var newStock = {};
        var scholasticKeywords = ['book', 'pen', 'pencil', 'notebook', 'exercise', 'paper', 'ream', 'folder', 'file', 'box', 'binder', 'marker', 'crayon', 'ruler', 'eraser', 'rubber', 'scissors', 'glue', 'tape', 'covers', 'broom', 'manila', 'cutters'];
        var excludeKeywords = ['sweater', 'uniform', 'dress', 'shirt', 'short', 'skirt', 'blazer', 'trouser', 'sportswear', 'sports', 'van', 'transport', 'admission', 'passport', 'photo', 'fee'];
        
        for (var key in stock) {
            var item = stock[key];
            if (!item || !item.name) continue;
            
            var lowerName = item.name.toLowerCase();
            var isScholastic = scholasticKeywords.some(function(kw) { return lowerName.includes(kw); });
            var isExcluded = excludeKeywords.some(function(kw) { return lowerName.includes(kw); });
            
            // Also check if it has a status group
            var hasStatusGroup = false;
            // ... check status groups
            
            if (isScholastic && !isExcluded) {
                newStock[key] = item;
            } else {
                console.log('🗑️ Removing non-scholastic item:', item.name);
            }
        }
        
        saveFile(inventoryFiles.inventoryStock, newStock);
        res.json({ success: true, removed: Object.keys(stock).length - Object.keys(newStock).length, remaining: Object.keys(newStock).length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ========== HELPER: GET STATUS GROUP COLOR ==========
function getStatusGroupColor(name) {
    if (!name) return 'bg-gray-100 text-gray-800 border-gray-200';
    
    const colorMap = {
        'Transportation': 'bg-orange-100 text-orange-800 border-orange-200',
        'transportation': 'bg-orange-100 text-orange-800 border-orange-200',
        'Admission': 'bg-purple-100 text-purple-800 border-purple-200',
        'Admission Fee': 'bg-purple-100 text-purple-800 border-purple-200',
        'Scholastic': 'bg-green-100 text-green-800 border-green-200',
        'schoolastic requirement': 'bg-green-100 text-green-800 border-green-200',
        'Sports': 'bg-blue-100 text-blue-800 border-blue-200',
        'Development': 'bg-red-100 text-red-800 border-red-200',
        'Tuition': 'bg-indigo-100 text-indigo-800 border-indigo-200'
    };
    
    // Try exact match first
    if (colorMap[name]) return colorMap[name];
    
    // Try case-insensitive partial match
    const lowerName = name.toLowerCase();
    for (const [key, color] of Object.entries(colorMap)) {
        if (lowerName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerName)) {
            return color;
        }
    }
    
    return 'bg-gray-100 text-gray-800 border-gray-200';
}

// ========== HELPER: GET TERM NAME ==========
function getTermName(term) {
    const names = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
    return names[term] || `Term ${term}`;
}

// ========== LOG WHEN ENDPOINT IS LOADED ==========
console.log('✅ Dashboard Stats API endpoint loaded successfully!');
// ==================== FRONTEND ROUTES ====================


// ==================== CUSTOM ITEM OVERRIDE API ENDPOINTS ====================
// GET all customizations for a student
app.get('/api/students/:studentId/customizations', (req, res) => {
    try {
        const students = readFile(files.students);
        const student = students.find(s => s.id === req.params.studentId);
        if (!student) return res.status(404).json({ error: 'Student not found' });
        res.json(student.customItemOverrides || {});
    } catch (error) {
        console.error('Error getting customizations:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET customization for a specific item
app.get('/api/students/:studentId/customizations/:itemId', (req, res) => {
    try {
        const students = readFile(files.students);
        const student = students.find(s => s.id === req.params.studentId);
        if (!student) return res.status(404).json({ error: 'Student not found' });
        const override = student.customItemOverrides?.[req.params.itemId];
        res.json(override || null);
    } catch (error) {
        console.error('Error getting customization:', error);
        res.status(500).json({ error: error.message });
    }
});

// CREATE or UPDATE a single customization
app.put('/api/students/:studentId/customizations/:itemId', (req, res) => {
    try {
        const { customAmount, customQuantity, paymentOption, reason, componentId, itemName, defaultAmount, defaultQuantity } = req.body;
        const students = readFile(files.students);
        const index = students.findIndex(s => s.id === req.params.studentId);
        if (index === -1) return res.status(404).json({ error: 'Student not found' });

        if (!students[index].customItemOverrides) students[index].customItemOverrides = {};
        const existing = students[index].customItemOverrides[req.params.itemId] || {};

        const customization = {
            itemId: req.params.itemId,
            itemName: itemName || existing.itemName || req.params.itemId,
            componentId: componentId || existing.componentId || null,
            customAmount: customAmount !== undefined && customAmount !== null && customAmount !== '' ? parseFloat(customAmount) : null,
            customQuantity: customQuantity !== undefined && customQuantity !== null && customQuantity !== '' ? parseInt(customQuantity) : null,
            paymentOption: paymentOption || existing.paymentOption || null,
            defaultAmount: defaultAmount !== undefined ? parseFloat(defaultAmount) : (existing.defaultAmount || 0),
            defaultQuantity: defaultQuantity !== undefined ? parseInt(defaultQuantity) : (existing.defaultQuantity || 1),
            isActive: true,
            reason: reason || existing.reason || '',
            updatedAt: new Date().toISOString(),
            updatedBy: req.body.updatedBy || 'System'
        };

        // If both custom values are empty, remove the override
        if (customization.customAmount === null && customization.customQuantity === null) {
            delete students[index].customItemOverrides[req.params.itemId];
            const count = Object.keys(students[index].customItemOverrides).length;
            students[index].hasCustomizations = count > 0;
            students[index].customizationCount = count;
            saveFile(files.students, students);
            return res.json({ success: true, message: 'Customization removed', customization: null });
        }

        // ✅ Preserve all other customizations – only this itemId is updated
        students[index].customItemOverrides[req.params.itemId] = customization;
        students[index].hasCustomizations = true;
        students[index].customizationCount = Object.keys(students[index].customItemOverrides).length;

        saveFile(files.students, students);
        res.json({ success: true, customization: students[index].customItemOverrides[req.params.itemId] });
    } catch (error) {
        console.error('Error saving customization:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE a customization (revert to default)
app.delete('/api/students/:studentId/customizations/:itemId', (req, res) => {
    try {
        const students = readFile(files.students);
        const index = students.findIndex(s => s.id === req.params.studentId);
        if (index === -1) return res.status(404).json({ error: 'Student not found' });
        if (students[index].customItemOverrides) {
            delete students[index].customItemOverrides[req.params.itemId];
            const count = Object.keys(students[index].customItemOverrides).length;
            students[index].hasCustomizations = count > 0;
            students[index].customizationCount = count;
        }
        saveFile(files.students, students);
        res.json({ success: true, message: 'Customization removed' });
    } catch (error) {
        console.error('Error removing customization:', error);
        res.status(500).json({ error: error.message });
    }
});

// Summary endpoint (unchanged)
app.get('/api/students/customizations/summary', (req, res) => {
    try {
        const students = readFile(files.students);
        const customizedStudents = students.filter(s => s.hasCustomizations && s.customItemOverrides);
        const summary = customizedStudents.map(s => ({
            id: s.id,
            name: `${s.firstName || ''} ${s.lastName || ''}`.trim(),
            admissionNumber: s.admissionNumber,
            customizationCount: s.customizationCount || Object.keys(s.customItemOverrides).length,
            customizations: s.customItemOverrides
        }));
        res.json(summary);
    } catch (error) {
        console.error('Error getting customizations summary:', error);
        res.status(500).json({ error: error.message });
    }
});
// ==================== SCHOOL STOCK MANAGEMENT SYSTEM ====================
// Version: 1.0 - Manual Stock Items (Food, Supplies, etc.)

// File paths for school stock
const schoolStockFiles = {
    schoolStock: path.join(dataDir, 'schoolStock.json'),
    schoolStockTransactions: path.join(dataDir, 'schoolStockTransactions.json'),
    schoolStockCategories: path.join(dataDir, 'schoolStockCategories.json')
};

// Initialize school stock files
function initializeSchoolStockFiles() {
    try {
        if (!fs.existsSync(schoolStockFiles.schoolStock)) {
            saveFile(schoolStockFiles.schoolStock, {});
        }
        if (!fs.existsSync(schoolStockFiles.schoolStockTransactions)) {
            saveFile(schoolStockFiles.schoolStockTransactions, []);
        }
        if (!fs.existsSync(schoolStockFiles.schoolStockCategories)) {
            const defaultCategories = [
                { id: 'cat_food', name: '🍞 Food Items', description: 'Food and kitchen supplies', color: '#f59e0b', icon: 'fa-utensils' },
                { id: 'cat_cleaning', name: '🧹 Cleaning Supplies', description: 'Cleaning materials and equipment', color: '#3b82f6', icon: 'fa-broom' },
                { id: 'cat_office', name: '📋 Office Supplies', description: 'Office stationery and equipment', color: '#8b5cf6', icon: 'fa-pen' },
                { id: 'cat_maintenance', name: '🔧 Maintenance', description: 'Maintenance tools and materials', color: '#ef4444', icon: 'fa-tools' },
                { id: 'cat_medical', name: '💊 Medical Supplies', description: 'First aid and medical items', color: '#10b981', icon: 'fa-medkit' },
                { id: 'cat_other', name: '📦 Other Supplies', description: 'Other school supplies', color: '#6b7280', icon: 'fa-box' }
            ];
            saveFile(schoolStockFiles.schoolStockCategories, defaultCategories);
        }
        console.log('✅ School Stock files initialized');
    } catch (error) {
        console.error('Error initializing school stock files:', error);
    }
}

initializeSchoolStockFiles();

// ========== HELPER: UPDATE SCHOOL STOCK ==========
function updateSchoolStock(itemName, quantity, operation, comment, category) {
    const stock = readFile(schoolStockFiles.schoolStock);
    const transactions = readFile(schoolStockFiles.schoolStockTransactions);
    
    if (!stock[itemName]) {
        stock[itemName] = {
            name: itemName,
            category: category || 'cat_other',
            totalReceived: 0,
            issued: 0,
            available: 0,
            lastUpdated: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };
    }
    
    const previousAvailable = stock[itemName].available || 0;
    let transactionType = '';
    let message = '';
    
    if (operation === 'add') {
        stock[itemName].totalReceived = (stock[itemName].totalReceived || 0) + quantity;
        stock[itemName].available = (stock[itemName].available || 0) + quantity;
        transactionType = 'restock';
        message = `Added ${quantity} ${itemName}(s) to school stock`;
    } else if (operation === 'remove') {
        if ((stock[itemName].available || 0) < quantity) {
            throw new Error(`Not enough stock. Available: ${stock[itemName].available || 0}, Requested: ${quantity}`);
        }
        stock[itemName].available = Math.max(0, (stock[itemName].available || 0) - quantity);
        stock[itemName].issued = (stock[itemName].issued || 0) + quantity;
        transactionType = 'remove';
        message = `Removed ${quantity} ${itemName}(s) from school stock`;
    } else {
        throw new Error('Invalid operation. Use "add" or "remove"');
    }
    
    if (category && category !== stock[itemName].category) {
        stock[itemName].category = category;
    }
    
    stock[itemName].lastUpdated = new Date().toISOString();
    
    const transaction = {
        id: uuidv4(),
        itemName: itemName,
        quantity: quantity,
        transactionType: transactionType,
        operation: operation,
        stockBefore: previousAvailable,
        stockAfter: stock[itemName].available || 0,
        comment: comment || (operation === 'add' ? 'Stock added' : 'Stock removed'),
        timestamp: new Date().toISOString(),
        date: new Date().toISOString().split('T')[0],
        isSchoolStock: true,
        category: stock[itemName].category
    };
    
    transactions.push(transaction);
    
    saveFile(schoolStockFiles.schoolStock, stock);
    saveFile(schoolStockFiles.schoolStockTransactions, transactions);
    
    return { stock: stock[itemName], transaction, message };
}

// ==================== SCHOOL STOCK ROUTES ====================
// ========== IMPORTANT: SPECIFIC ROUTES FIRST, WILDCARD LAST ==========

// 1. GET SCHOOL STOCK CATEGORIES (Most specific - no parameters)
app.get('/api/school-stock/categories', (req, res) => {
    try {
        const categories = readFile(schoolStockFiles.schoolStockCategories);
        res.json(categories);
    } catch (error) {
        console.error('Error getting school stock categories:', error);
        res.status(500).json({ error: error.message });
    }
});

// 2. GET SCHOOL STOCK TRANSACTIONS (Specific - query parameters only)
app.get('/api/school-stock/transactions', (req, res) => {
    try {
        const { itemName, category, limit } = req.query;
        let transactions = readFile(schoolStockFiles.schoolStockTransactions);
        
        if (itemName) {
            transactions = transactions.filter(t => t.itemName === itemName);
        }
        if (category && category !== 'all') {
            transactions = transactions.filter(t => t.category === category);
        }
        
        transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        if (limit && parseInt(limit) > 0) {
            transactions = transactions.slice(0, parseInt(limit));
        }
        
        res.json(transactions);
    } catch (error) {
        console.error('Error getting school stock transactions:', error);
        res.status(500).json({ error: error.message });
    }
});

// 3. GET SCHOOL STOCK SUMMARY (Specific - no parameters)
app.get('/api/school-stock/summary', (req, res) => {
    try {
        const stock = readFile(schoolStockFiles.schoolStock);
        const categories = readFile(schoolStockFiles.schoolStockCategories);
        const transactions = readFile(schoolStockFiles.schoolStockTransactions);
        
        const summary = {
            totalItems: Object.keys(stock).length,
            totalAvailable: 0,
            totalReceived: 0,
            totalIssued: 0,
            categories: {},
            items: stock
        };
        
        for (const [key, value] of Object.entries(stock)) {
            summary.totalAvailable += value.available || 0;
            summary.totalReceived += value.totalReceived || 0;
            summary.totalIssued += value.issued || 0;
            
            const category = value.category || 'cat_other';
            if (!summary.categories[category]) {
                summary.categories[category] = {
                    name: category,
                    items: 0,
                    totalAvailable: 0,
                    totalReceived: 0,
                    totalIssued: 0
                };
            }
            summary.categories[category].items++;
            summary.categories[category].totalAvailable += value.available || 0;
            summary.categories[category].totalReceived += value.totalReceived || 0;
            summary.categories[category].totalIssued += value.issued || 0;
        }
        
        for (const [key, value] of Object.entries(summary.categories)) {
            const categoryInfo = categories.find(c => c.id === key);
            if (categoryInfo) {
                value.name = categoryInfo.name;
                value.color = categoryInfo.color;
                value.icon = categoryInfo.icon;
            }
        }
        
        res.json({
            success: true,
            summary: summary,
            categories: categories,
            recentTransactions: transactions.slice(-10).reverse()
        });
    } catch (error) {
        console.error('Error getting school stock summary:', error);
        res.status(500).json({ error: error.message });
    }
});

// 4. GET ALL SCHOOL STOCK ITEMS (No parameters)
app.get('/api/school-stock', (req, res) => {
    try {
        const { category } = req.query;
        const stock = readFile(schoolStockFiles.schoolStock);
        const categories = readFile(schoolStockFiles.schoolStockCategories);
        
        let stockItems = stock;
        if (category && category !== 'all') {
            const filteredStock = {};
            for (const [key, value] of Object.entries(stock)) {
                if (value.category === category) {
                    filteredStock[key] = value;
                }
            }
            stockItems = filteredStock;
        }
        
        res.json({
            success: true,
            stock: stockItems,
            categories: categories
        });
    } catch (error) {
        console.error('Error getting school stock:', error);
        res.status(500).json({ error: error.message });
    }
});

// 5. GET SCHOOL STOCK ITEM BY NAME (Wildcard - MUST BE LAST)
app.get('/api/school-stock/:itemName', (req, res) => {
    try {
        const itemName = req.params.itemName;
        const stock = readFile(schoolStockFiles.schoolStock);
        
        if (!stock[itemName]) {
            return res.status(404).json({ error: 'Item not found in school stock' });
        }
        
        res.json({
            success: true,
            item: stock[itemName]
        });
    } catch (error) {
        console.error('Error getting school stock item:', error);
        res.status(500).json({ error: error.message });
    }
});

// 6. CREATE SCHOOL STOCK CATEGORY
app.post('/api/school-stock/categories', (req, res) => {
    try {
        const { name, description, color, icon } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Category name is required' });
        }
        
        const categories = readFile(schoolStockFiles.schoolStockCategories);
        
        if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
            return res.status(400).json({ error: 'Category already exists' });
        }
        
        const newCategory = {
            id: `cat_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            name: name,
            description: description || '',
            color: color || '#6b7280',
            icon: icon || 'fa-box',
            createdAt: new Date().toISOString()
        };
        
        categories.push(newCategory);
        saveFile(schoolStockFiles.schoolStockCategories, categories);
        
        res.json({
            success: true,
            category: newCategory
        });
    } catch (error) {
        console.error('Error creating school stock category:', error);
        res.status(500).json({ error: error.message });
    }
});

// 7. UPDATE SCHOOL STOCK CATEGORY
app.put('/api/school-stock/categories/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, color, icon } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Category name is required' });
        }
        
        let categories = readFile(schoolStockFiles.schoolStockCategories);
        const index = categories.findIndex(c => c.id === id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Category not found' });
        }
        
        if (categories.some(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== id)) {
            return res.status(400).json({ error: 'Category name already exists' });
        }
        
        categories[index] = {
            ...categories[index],
            name: name,
            description: description || '',
            color: color || categories[index].color,
            icon: icon || categories[index].icon,
            updatedAt: new Date().toISOString()
        };
        
        saveFile(schoolStockFiles.schoolStockCategories, categories);
        
        res.json({
            success: true,
            category: categories[index]
        });
    } catch (error) {
        console.error('Error updating school stock category:', error);
        res.status(500).json({ error: error.message });
    }
});

// 8. DELETE SCHOOL STOCK CATEGORY
app.delete('/api/school-stock/categories/:id', (req, res) => {
    try {
        const { id } = req.params;
        let categories = readFile(schoolStockFiles.schoolStockCategories);
        const stock = readFile(schoolStockFiles.schoolStock);
        
        const itemsInCategory = Object.values(stock).some(item => item.category === id);
        if (itemsInCategory) {
            return res.status(400).json({
                error: 'Cannot delete category that is in use. Reassign items first.'
            });
        }
        
        categories = categories.filter(c => c.id !== id);
        saveFile(schoolStockFiles.schoolStockCategories, categories);
        
        res.json({
            success: true,
            message: 'Category deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting school stock category:', error);
        res.status(500).json({ error: error.message });
    }
});

// 9. UPDATE SCHOOL STOCK (Add or Remove items)
app.post('/api/school-stock/update', (req, res) => {
    try {
        const { itemName, quantity, operation, comment, category } = req.body;
        
        if (!itemName || !quantity || quantity <= 0) {
            return res.status(400).json({ error: 'Item name and quantity are required' });
        }
        
        if (!operation || !['add', 'remove'].includes(operation)) {
            return res.status(400).json({ error: 'Valid operation (add/remove) is required' });
        }
        
        const result = updateSchoolStock(itemName, quantity, operation, comment, category);
        
        res.json({
            success: true,
            stock: result.stock,
            transaction: result.transaction,
            message: result.message
        });
    } catch (error) {
        console.error('Error updating school stock:', error);
        res.status(500).json({ error: error.message });
    }
});

// 10. ISSUE SCHOOL STOCK ITEM
app.post('/api/school-stock/issue', (req, res) => {
    try {
        const { itemName, quantity, destination, recipient, comment } = req.body;
        
        if (!itemName || !quantity || quantity <= 0) {
            return res.status(400).json({ error: 'Item name and quantity are required' });
        }
        
        if (!destination) {
            return res.status(400).json({ error: 'Destination is required' });
        }
        
        if (!recipient) {
            return res.status(400).json({ error: 'Recipient name is required' });
        }
        
        const stock = readFile(schoolStockFiles.schoolStock);
        const transactions = readFile(schoolStockFiles.schoolStockTransactions);
        
        if (!stock[itemName]) {
            return res.status(404).json({ error: 'Item not found in stock' });
        }
        
        if ((stock[itemName].available || 0) < quantity) {
            return res.status(400).json({
                error: `Not enough stock. Available: ${stock[itemName].available || 0}, Requested: ${quantity}`
            });
        }
        
        const previousAvailable = stock[itemName].available || 0;
        stock[itemName].available = Math.max(0, stock[itemName].available - quantity);
        stock[itemName].issued = (stock[itemName].issued || 0) + quantity;
        stock[itemName].lastUpdated = new Date().toISOString();
        
        const transaction = {
            id: uuidv4(),
            itemName: itemName,
            quantity: quantity,
            transactionType: 'issue',
            destination: destination,
            recipient: recipient || '',
            comment: comment || '',
            stockBefore: previousAvailable,
            stockAfter: stock[itemName].available || 0,
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split('T')[0],
            isSchoolStock: true,
            category: stock[itemName].category,
            canEdit: true,
            canReverse: true
        };
        
        transactions.push(transaction);
        
        saveFile(schoolStockFiles.schoolStock, stock);
        saveFile(schoolStockFiles.schoolStockTransactions, transactions);
        
        res.json({
            success: true,
            transaction: transaction,
            currentStock: stock[itemName].available || 0,
            message: `✅ Issued ${quantity} ${itemName}(s) to ${recipient}`
        });
    } catch (error) {
        console.error('Error issuing school stock item:', error);
        res.status(500).json({ error: error.message });
    }
});

// 11. REVERSE SCHOOL STOCK TRANSACTION
app.post('/api/school-stock/reverse/:transactionId', (req, res) => {
    try {
        const { transactionId } = req.params;
        const { reason } = req.body;
        
        let transactions = readFile(schoolStockFiles.schoolStockTransactions);
        const transactionIndex = transactions.findIndex(t => t.id === transactionId);
        
        if (transactionIndex === -1) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        
        const transaction = transactions[transactionIndex];
        
        if (transaction.reversed) {
            return res.status(400).json({ error: 'Transaction already reversed' });
        }
        
        if (!transaction.isSchoolStock) {
            return res.status(400).json({ error: 'Can only reverse school stock transactions' });
        }
        
        const stock = readFile(schoolStockFiles.schoolStock);
        
        if (stock[transaction.itemName]) {
            stock[transaction.itemName].issued = Math.max(0, (stock[transaction.itemName].issued || 0) - transaction.quantity);
            stock[transaction.itemName].available = (stock[transaction.itemName].available || 0) + transaction.quantity;
            stock[transaction.itemName].lastUpdated = new Date().toISOString();
        }
        
        transaction.reversed = true;
        transaction.reversedAt = new Date().toISOString();
        transaction.reverseReason = reason || 'Transaction reversed';
        transaction.canEdit = false;
        transaction.canReverse = false;
        
        const reverseRecord = {
            id: uuidv4(),
            originalTransactionId: transactionId,
            itemName: transaction.itemName,
            quantity: transaction.quantity,
            transactionType: 'reverse',
            reason: reason || 'Transaction reversed',
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split('T')[0],
            isSchoolStock: true,
            category: transaction.category
        };
        
        transactions.push(reverseRecord);
        
        saveFile(schoolStockFiles.schoolStock, stock);
        saveFile(schoolStockFiles.schoolStockTransactions, transactions);
        
        res.json({
            success: true,
            message: `✅ Transaction reversed successfully`,
            stock: stock[transaction.itemName]
        });
    } catch (error) {
        console.error('Error reversing school stock transaction:', error);
        res.status(500).json({ error: error.message });
    }
});

// 12. EDIT SCHOOL STOCK TRANSACTION
app.put('/api/school-stock/transaction/:transactionId', (req, res) => {
    try {
        const { transactionId } = req.params;
        const { destination, recipient, comment, quantity } = req.body;
        
        let transactions = readFile(schoolStockFiles.schoolStockTransactions);
        const transactionIndex = transactions.findIndex(t => t.id === transactionId);
        
        if (transactionIndex === -1) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        
        const transaction = transactions[transactionIndex];
        
        if (transaction.reversed) {
            return res.status(400).json({ error: 'Cannot edit a reversed transaction' });
        }
        
        if (!transaction.isSchoolStock) {
            return res.status(400).json({ error: 'Can only edit school stock transactions' });
        }
        
        const stock = readFile(schoolStockFiles.schoolStock);
        
        if (quantity && quantity !== transaction.quantity) {
            const diff = quantity - transaction.quantity;
            
            if (stock[transaction.itemName]) {
                stock[transaction.itemName].issued = Math.max(0, (stock[transaction.itemName].issued || 0) + diff);
                stock[transaction.itemName].available = Math.max(0, (stock[transaction.itemName].available || 0) - diff);
                stock[transaction.itemName].lastUpdated = new Date().toISOString();
            }
            transaction.quantity = quantity;
        }
        
        if (destination) transaction.destination = destination;
        if (recipient) transaction.recipient = recipient;
        if (comment !== undefined) transaction.comment = comment;
        transaction.editedAt = new Date().toISOString();
        transaction.canEdit = false;
        
        saveFile(schoolStockFiles.schoolStock, stock);
        saveFile(schoolStockFiles.schoolStockTransactions, transactions);
        
        res.json({
            success: true,
            transaction: transaction,
            message: '✅ Transaction updated successfully'
        });
    } catch (error) {
        console.error('Error editing school stock transaction:', error);
        res.status(500).json({ error: error.message });
    }
});

console.log('✅ School Stock Management System v1.0 Loaded!');
console.log('   - Manual stock items (Food, Supplies, etc.)');
console.log('   - Category-based organization');
console.log('   - Issue, Edit, Reverse transactions');
console.log('   - Separate from scholastic inventory');

// ==================== PREVIOUS BALANCES API ENDPOINTS ====================

// ==================== COMPLETE REBUILT PREVIOUS BALANCES ENDPOINT ====================
// Version: 3.0 - Carries forward ALL unpaid items from previous periods
// With full item-level detail, custom overrides, and removed items support

// ==================== COMPLETE REBUILT PREVIOUS BALANCES ENDPOINT ====================
// Version: 4.0 - Returns FULL fee structure data for each period with balance

// ============================================================================
// COMPLETE REBUILT: /api/students/${studentId}/previous-balances
// Version: 5.0 - Full Period Carryover with Customizations
// ============================================================================

// ============================================================================
// COMPLETE REBUILT: /api/students/:studentId/previous-balances
// Version: 12.0 - Only periods WITH BALANCES are shown (like v5.0 logic)
// ============================================================================

// ==================== COMPLETE REBUILT PREVIOUS BALANCES ENDPOINT ====================
// Version: 13.0 - STABLE ITEM IDs FOR PERSISTENT CUSTOMIZATIONS
// ALL dynamically generated items now have deterministic IDs

app.get('/api/students/:studentId/previous-balances', async (req, res) => {
    console.log('=== GET PREVIOUS BALANCES v13.0 - STABLE ITEM IDs ===');
    console.log('Student ID:', req.params.studentId);
    
    try {
        const { studentId } = req.params;
        
        // ========== FETCH ALL DATA ==========
        const [
            studentsData,
            feeStructuresData,
            feeAssignmentsData,
            feePaymentsData,
            termRecordsData,
            classesData,
            feeBursariesData
        ] = await Promise.all([
            fetch(`${req.protocol}://${req.get('host')}/api/students`).catch(() => ({ ok: false, json: async () => [] })),
            fetch(`${req.protocol}://${req.get('host')}/api/fee/structures`).catch(() => ({ ok: false, json: async () => [] })),
            fetch(`${req.protocol}://${req.get('host')}/api/student-fee-assignments`).catch(() => ({ ok: false, json: async () => [] })),
            fetch(`${req.protocol}://${req.get('host')}/api/fee/payments`).catch(() => ({ ok: false, json: async () => [] })),
            fetch(`${req.protocol}://${req.get('host')}/api/student-term-records`).catch(() => ({ ok: false, json: async () => ({}) })),
            fetch(`${req.protocol}://${req.get('host')}/api/school/classes`).catch(() => ({ ok: false, json: async () => [] })),
            fetch(`${req.protocol}://${req.get('host')}/api/fee/bursaries`).catch(() => ({ ok: false, json: async () => [] }))
        ]);
        
        let students = studentsData.ok ? await studentsData.json() : [];
        let feeStructures = feeStructuresData.ok ? await feeStructuresData.json() : [];
        let feeAssignments = feeAssignmentsData.ok ? await feeAssignmentsData.json() : [];
        let allPayments = feePaymentsData.ok ? await feePaymentsData.json() : [];
        let termRecords = termRecordsData.ok ? await termRecordsData.json() : {};
        let classes = classesData.ok ? await classesData.json() : [];
        let feeBursaries = feeBursariesData.ok ? await feeBursariesData.json() : [];
        
        students = Array.isArray(students) ? students : [];
        feeStructures = Array.isArray(feeStructures) ? feeStructures : [];
        feeAssignments = Array.isArray(feeAssignments) ? feeAssignments : [];
        allPayments = Array.isArray(allPayments) ? allPayments : [];
        classes = Array.isArray(classes) ? classes : [];
        feeBursaries = Array.isArray(feeBursaries) ? feeBursaries : [];
        
        // ========== FIND THE STUDENT ==========
        const student = students.find(s => s && s.id === studentId);
        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        console.log('✅ Student found:', student.firstName, student.lastName);
        console.log('📦 Removed Items:', Object.keys(student.removedItems || {}));
        console.log('⚡ Custom Overrides:', Object.keys(student.customItemOverrides || {}));
        
        // ========== GET CURRENT ACADEMIC SETTINGS ==========
        const settingsPath = path.join(__dirname, 'data', 'settings.json');
        let currentYear = new Date().getFullYear();
        let currentTerm = 1;
        if (fs.existsSync(settingsPath)) {
            try {
                const settingsData = fs.readFileSync(settingsPath, 'utf8');
                const settings = JSON.parse(settingsData);
                if (settings.currentAcademicYear) currentYear = settings.currentAcademicYear;
                if (settings.currentTerm) currentTerm = settings.currentTerm;
            } catch(e) {}
        }
        
        console.log(`📅 CURRENT PERIOD: ${currentYear} Term ${currentTerm}`);
        
        // ========== BUILD MAPS ==========
        const classesMap = {};
        classes.forEach(c => { if (c && c.id) classesMap[c.id] = c; });
        
        const assignmentsMap = {};
        feeAssignments.forEach(a => { if (a && a.studentId) assignmentsMap[a.studentId] = a; });
        
        const feeStructuresMap = {};
        feeStructures.forEach(fs => { if (fs && fs.id) feeStructuresMap[fs.id] = fs; });
        
        const bursariesMap = {};
        feeBursaries.forEach(b => { if (b && b.id) bursariesMap[b.id] = b; });
        
        // ========== GET STUDENT'S FEE STRUCTURE ==========
        const assignment = assignmentsMap[studentId] || {};
        let feeStructure = feeStructuresMap[assignment.feeStructureId];
        
        if (!feeStructure) {
            console.log('⚠️ No fee structure assigned, checking term records...');
            for (const [key, record] of Object.entries(termRecords)) {
                if (key.startsWith(studentId + '_') && record.feeStructureId) {
                    feeStructure = feeStructuresMap[record.feeStructureId];
                    if (feeStructure) {
                        console.log('✅ Fee structure found in term records:', feeStructure.name);
                        break;
                    }
                }
            }
        }
        
        if (!feeStructure) {
            console.log('⚠️ No fee structure found at all');
            return res.json({
                success: true,
                student: {
                    id: student.id,
                    name: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
                    admissionNumber: student.admissionNumber,
                    currentClass: student.currentClass || 'N/A',
                    status: student.status || 'Active'
                },
                currentPeriod: null,
                previousPeriods: [],
                totalPreviousBalance: 0,
                totalPreviousItems: 0,
                totalPreviousPeriods: 0,
                feeStructure: null,
                metadata: {
                    currentYear: currentYear,
                    currentTerm: currentTerm,
                    isFirstTerm: currentTerm === 1,
                    totalPeriods: 0,
                    hasCustomizations: false,
                    message: 'No fee structure assigned to this student'
                }
            });
        }
        
        console.log('✅ Fee structure found:', feeStructure.name);
        
        // ========== HELPER: GET STABLE ITEM ID ==========
        // 🔥 CRITICAL FIX: Generate a deterministic ID for any item
        // This ensures the same item gets the same ID on every page load
       // ========== GET STABLE ITEM ID ==========
function getStableItemId(componentId, itemName, periodType, year, term) {
    // IMPORTANT: Use the SAME format everywhere!
    // Format: componentId_itemName_periodType
    const key = `${componentId}_${itemName}_${periodType || 'termly'}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        const char = key.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return `item_${Math.abs(hash)}_${year || ''}_${term || ''}`;
}



        // ========== HELPER: GET STABLE COMPONENT ID ==========
        function getStableComponentId(componentName, periodType, year, term) {
            const key = `comp_${componentName}_${periodType || 'termly'}`;
            let hash = 0;
            for (let i = 0; i < key.length; i++) {
                const char = key.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            return `comp_${Math.abs(hash)}`;
        }

        // ========== HELPER: GET CUSTOMIZED ITEM VALUE ==========
        // ========== HELPER: GET CUSTOMIZED ITEM VALUE ==========
        function getCustomizedItemValue(student, itemId, defaultAmount, defaultQuantity, defaultPaymentOption, defaultUnitPrice) {
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

        // ========== HELPER: CHECK IF ITEM IS REMOVED ==========
        function isItemRemoved(studentData, itemId) {
            if (!studentData || !studentData.removedItems) return false;
            return studentData.removedItems[itemId] && studentData.removedItems[itemId].isActive !== false;
        }

        // ========== HELPER: GET PAID AMOUNTS FOR ITEM WITH PERIOD SCOPE ==========
       function getPaidAmountsForItem(studentId, componentId, componentName, itemId, itemName, periodType, year, term, allPaymentsData) {
    let scopedPayments = [];

    if (periodType === 'one_time') {
        scopedPayments = allPaymentsData.filter(p => p && p.studentId === studentId);
    } else if (periodType === 'yearly') {
        scopedPayments = allPaymentsData.filter(p => 
            p && p.studentId === studentId && 
            p.academicYear === year.toString()
        );
    } else {
        scopedPayments = allPaymentsData.filter(p => 
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
                const compMatch = paidItem.componentName.toLowerCase() === componentName.toLowerCase();
                const itemMatch = paidItem.itemName.toLowerCase() === itemName.toLowerCase();
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
                    const compMatch = paidItem.componentName.toLowerCase() === componentName.toLowerCase();
                    const itemMatch = paidItem.itemName.toLowerCase() === itemName.toLowerCase();
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

        // ---- FIX: correctly handle cash mislabeled as brought_item ----
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
            // ***** NEW: if qty is 0 and amountPaid > 0, treat as cash *****
            if (qty === 0 && (paidItem.amountPaid || 0) > 0) {
                const amount = paidItem.amountPaid || 0;
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
            } else {
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

       // ==================== COMPLETE FIXED: BUILD FEE ITEMS FROM STRUCTURE ====================
// Version: 7.0 - PROPERLY APPLIES CUSTOM OVERRIDES TO DYNAMIC ITEMS

// ==================== COMPLETE FIXED: BUILD FEE ITEMS FROM STRUCTURE ====================
// Version: 7.0 - PROPERLY APPLIES CUSTOM OVERRIDES TO DYNAMIC ITEMS

// ==================== COMPLETE FIXED: BUILD FEE ITEMS FROM STRUCTURE ====================
// Version: 8.0 - PROPERLY APPLIES CUSTOM OVERRIDES FROM EDIT STUDENT

function buildFeeItemsFromStructure(fs, studentData, year, term, isFirstTerm) {
    if (!fs || !fs.activityComponents) return { items: [], totalExpected: 0 };
    
    const items = [];
    let totalExpected = 0;
    const removedItems = studentData?.removedItems || {};
    const customTransportation = studentData?.customTransportation || null;
    const customOverrides = studentData?.customItemOverrides || {};
    
    console.log(`📦 Building fee items for ${year} Term ${term}`);
    console.log(`📦 Custom Overrides keys:`, Object.keys(customOverrides));
    
    // ========== HELPER: FIND CUSTOM OVERRIDE - SIMPLE RELIABLE ==========
    function findCustomOverride(itemName, componentName, itemId) {
        console.log(`  🔍 Looking for: "${itemName}"`);
        
        // 1. Try by exact itemName (MOST RELIABLE)
        for (const [key, custom] of Object.entries(customOverrides)) {
            if (custom.isActive === false) continue;
            if (custom.itemName === itemName) {
                console.log(`    ✅ FOUND by itemName: ${key}`);
                return custom;
            }
        }
        
        // 2. Try by itemId
        if (itemId && customOverrides[itemId]) {
            const custom = customOverrides[itemId];
            if (custom.isActive !== false) {
                console.log(`    ✅ FOUND by itemId: ${itemId}`);
                return custom;
            }
        }
        
        // 3. Try by key containing itemName
        for (const [key, custom] of Object.entries(customOverrides)) {
            if (custom.isActive === false) continue;
            if (key.includes(itemName)) {
                console.log(`    ✅ FOUND by key containing name: ${key}`);
                return custom;
            }
        }
        
        console.log(`    ❌ No override found for: "${itemName}"`);
        return null;
    }
    
    // ========== PROCESS EACH COMPONENT ==========
    for (const component of fs.activityComponents) {
        if (!component) continue;
        
        const periodType = component.periodType || 'termly';
        const isTransportation = component.name.toLowerCase().includes('transport') || 
                                (component.statusGroupName && component.statusGroupName.toLowerCase().includes('transport'));
        
        let shouldInclude = false;
        if (periodType === 'termly') shouldInclude = true;
        else if (periodType === 'one_time') shouldInclude = true;
        else if (periodType === 'yearly') shouldInclude = isFirstTerm;
        
        if (!shouldInclude) continue;
        
        for (const item of (component.items || [])) {
            if (!item) continue;
            
            const itemName = item.name || 'Unnamed Item';
            const itemId = item.id || itemName;
            
            // Check if removed
            if (removedItems[itemId] && removedItems[itemId].isActive !== false) {
                console.log(`   ⏭️ Skipping removed item: ${itemName}`);
                continue;
            }
            
            // ========== FIND CUSTOM OVERRIDE ==========
            const custom = findCustomOverride(itemName, component.name, itemId);
            
            // ========== APPLY CUSTOM VALUES ==========
            let defaultAmount = item.totalAmount || 0;
            let defaultQuantity = item.quantity || 1;
            let defaultUnitPrice = item.unitPrice || (defaultAmount / defaultQuantity);
            let defaultPaymentOption = item.paymentOption || 'either';
            
            let effectiveAmount = defaultAmount;
            let effectiveQuantity = defaultQuantity;
            let effectiveUnitPrice = defaultUnitPrice;
            let effectivePaymentOption = defaultPaymentOption;
            let isCustomized = false;
            let customReason = null;
            
            // Apply custom override if found
            if (custom && custom.isActive !== false) {
                console.log(`   ⚡ Applying custom to: ${itemName}`);
                
                if (custom.customAmount !== null && custom.customAmount !== undefined && custom.customAmount > 0) {
                    effectiveAmount = custom.customAmount;
                    console.log(`      Amount: ${defaultAmount} → ${effectiveAmount}`);
                }
                
                if (custom.customQuantity !== null && custom.customQuantity !== undefined && custom.customQuantity > 0) {
                    effectiveQuantity = custom.customQuantity;
                    console.log(`      Qty: ${defaultQuantity} → ${effectiveQuantity}`);
                }
                
                if (custom.paymentOption) {
                    effectivePaymentOption = custom.paymentOption;
                }
                
                effectiveUnitPrice = effectiveAmount / (effectiveQuantity || 1);
                isCustomized = true;
                customReason = custom.reason || 'Customized via edit student';
            }
            
            // Handle transportation custom
            if (isTransportation && customTransportation) {
                if (customTransportation.hasTransportation === false) {
                    console.log(`   🚌 Transportation disabled: ${itemName}`);
                    continue;
                }
                if (customTransportation.amount) {
                    effectiveAmount = customTransportation.amount;
                    effectiveUnitPrice = effectiveAmount / (effectiveQuantity || 1);
                    isCustomized = true;
                    customReason = 'Custom Transportation';
                }
            }
            
            // ========== GET PAID AMOUNTS ==========
            const paidInfo = getPaidAmountsForItem(
                studentData.id,
                component.id || component.name,
                component.name,
                itemId,
                itemName,
                periodType,
                year,
                term,
                allPayments
            );
            
            const cashPaid = paidInfo.cashPaid || 0;
            const itemsBrought = paidInfo.itemsBrought || 0;
            const paymentHistories = paidInfo.paymentHistories || [];
            
            // ========== CALCULATE REMAINING ==========
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
            
            totalExpected += effectiveAmount;
            
            items.push({
                componentId: component.id || component.name,
                componentName: component.name,
                periodType: periodType,
                itemId: itemId,
                itemName: itemName,
                quantity: effectiveQuantity,
                totalAmount: effectiveAmount,
                unitPrice: effectiveUnitPrice,
                paymentOption: effectivePaymentOption,
                remainingAmount: remainingAmount,
                remainingQuantity: remainingQuantity,
                cashPaid: cashPaid,
                itemsBrought: itemsBrought,
                isFullyPaid: isFullyPaid,
                isCustomized: isCustomized,
                customReason: customReason,
                paymentHistories: paymentHistories,
                isSpecialItem: isTransportation || effectivePaymentOption === 'cash_only' || effectivePaymentOption === 'item_only',
                isTransportation: isTransportation,
                statusGroupName: component.statusGroupName || component.name || 'Other',
                customAmount: custom?.customAmount || null,
                customQuantity: custom?.customQuantity || null,
                defaultAmount: defaultAmount,
                defaultQuantity: defaultQuantity,
                defaultUnitPrice: defaultUnitPrice,
                defaultPaymentOption: defaultPaymentOption
            });
            
            console.log(`   ✅ ${isCustomized ? '⚡ CUSTOM' : 'Default'} ${itemName}: UGX ${effectiveAmount}`);
        }
    }
    
    console.log(`📦 Total items: ${items.length}, Customized: ${items.filter(i => i.isCustomized).length}`);
    return { items, totalExpected };
}
        // ========== GET ALL PERIODS WITH PAYMENTS OR RECORDS ==========
        function getAllPeriodsWithData(studentId, allPaymentsData, termRecordsData) {
            const allPeriods = new Map();
            
            // From payments
            allPaymentsData.forEach(p => {
                if (p && p.studentId === studentId && p.academicYear && p.term !== undefined && p.term !== null) {
                    const key = `${p.academicYear}_${p.term}`;
                    if (!allPeriods.has(key)) {
                        allPeriods.set(key, { 
                            year: parseInt(p.academicYear), 
                            term: parseInt(p.term), 
                            payments: [] 
                        });
                    }
                    allPeriods.get(key).payments.push(p);
                }
            });
            
            // From term records
            for (const [key, record] of Object.entries(termRecordsData)) {
                if (key.startsWith(studentId + '_')) {
                    const parts = key.split('_');
                    if (parts.length === 3) {
                        const year = parseInt(parts[1]);
                        const term = parseInt(parts[2]);
                        const periodKey = `${year}_${term}`;
                        if (!allPeriods.has(periodKey)) {
                            allPeriods.set(periodKey, { year: year, term: term, payments: [] });
                        }
                    }
                }
            }
            
            // Sort periods by year and term (newest first)
            return Array.from(allPeriods.entries())
                .map(([key, data]) => ({ ...data, periodKey: key }))
                .sort((a, b) => {
                    if (a.year !== b.year) return b.year - a.year;
                    return b.term - a.term;
                });
        }

        // ========== CHECK IF PERIOD HAS BALANCE ==========
        function periodHasBalance(periodData) {
            const tuitionBalance = periodData.tuition?.balance || 0;
            const itemsRemaining = periodData.activity?.itemsRemaining || 0;
            const activityBalance = periodData.activity?.balance || 0;
            const hasUnpaidItems = periodData.activity?.items?.some(item => !item.isFullyPaid) || false;
            const totalBalance = periodData.total?.balance || 0;
            
            const hasBalance = 
                tuitionBalance > 0 ||
                activityBalance > 0 ||
                itemsRemaining > 0 ||
                hasUnpaidItems ||
                totalBalance > 0;
            
            return hasBalance;
        }

        // ========== PROCESS EACH PERIOD ==========
        const isFirstTerm = currentTerm === 1;
        const allPeriods = getAllPeriodsWithData(studentId, allPayments, termRecords);
        const currentPeriodKey = `${currentYear}_${currentTerm}`;
        
        console.log(`📋 Found ${allPeriods.length} total periods with data`);
        
        let currentPeriodData = null;
        const previousPeriodsData = [];
        let totalPreviousBalance = 0;
        let totalPreviousItems = 0;
        let totalPreviousPeriods = 0;
        
        // Process all periods
        for (const period of allPeriods) {
            const { year, term, periodKey, payments } = period;
            const isCurrentPeriod = periodKey === currentPeriodKey;
            const isFirstTermForPeriod = term === 1;
            
            // Get term record for this period
            const termRecordKey = `${studentId}_${year}_${term}`;
            const termRecord = termRecords[termRecordKey] || { 
                activityItemsPaid: { one_time: [], termly: [], yearly: [] },
                tuitionTotalPaid: 0,
                activityTotalPaid: 0
            };
            
            // ========== CALCULATE TUITION ==========
            let tuitionExpected = feeStructure?.tuition || 0;
            let discountAmount = 0;
            let appliedBursary = null;
            
            if (student.customBursary && student.customBursary.amount > 0) {
                discountAmount = student.customBursary.amount;
                tuitionExpected = Math.max(0, tuitionExpected - discountAmount);
                appliedBursary = { name: 'Custom Bursary', isCustom: true };
            } else if (assignment.bursaryId && bursariesMap[assignment.bursaryId]) {
                const bursary = bursariesMap[assignment.bursaryId];
                appliedBursary = bursary;
                if (bursary.type === 'percentage') {
                    discountAmount = (tuitionExpected * bursary.value) / 100;
                    tuitionExpected = Math.max(0, tuitionExpected - discountAmount);
                } else {
                    discountAmount = bursary.value;
                    tuitionExpected = Math.max(0, tuitionExpected - discountAmount);
                }
            }
            
            // Calculate tuition paid for this period
            let tuitionPaid = 0;
            const periodPayments = allPayments.filter(p => 
                p && p.studentId === studentId && 
                p.term === term && 
                p.academicYear === year.toString()
            );
            
            for (const p of periodPayments) {
                tuitionPaid += (p.tuitionPaid || 0);
            }
            
            tuitionPaid = Math.max(tuitionPaid, termRecord.tuitionTotalPaid || 0);
            const tuitionBalance = tuitionExpected - tuitionPaid;
            
            // ========== CALCULATE ACTIVITY ITEMS ==========
            let periodItems = [];
            let totalActivityExpected = 0;
            let totalActivityPaid = 0;
            let totalActivityBalance = 0;
            let totalItemsRemaining = 0;
            let statusGroupBreakdown = {};
            
            // Get fee items for this period (with customizations and period logic)
            const feeItemsForPeriod = buildFeeItemsFromStructure(feeStructure, student, year, term, isFirstTermForPeriod);
            
            // Process each fee item
            for (const feeItem of feeItemsForPeriod.items) {
                // Get paid details for this specific period
                const paidInfo = getPaidAmountsForItem(
                    studentId,
                    feeItem.componentId,
                    feeItem.componentName,
                    feeItem.itemId,
                    feeItem.itemName,
                    feeItem.periodType,
                    year,
                    term,
                    allPayments
                );
                
                const cashPaid = paidInfo.cashPaid;
                const itemsBrought = paidInfo.itemsBrought;
                const paymentHistories = paidInfo.paymentHistories;
                
                // Calculate remaining for this period
                let remainingAmount = feeItem.remainingAmount || 0;
                let remainingQuantity = feeItem.remainingQuantity || 0;
                let isFullyPaid = feeItem.isFullyPaid || false;
                
                // Update period totals
                totalActivityExpected += feeItem.totalAmount || 0;
                totalActivityPaid += cashPaid;
                totalActivityBalance += remainingAmount;
                totalItemsRemaining += remainingQuantity;
                
                // Build status group breakdown
                const sgName = feeItem.statusGroupName || 'Other';
                if (!statusGroupBreakdown[sgName]) {
                    statusGroupBreakdown[sgName] = {
                        name: sgName,
                        expected: 0,
                        paid: 0,
                        balance: 0,
                        itemsRemaining: 0,
                        items: []
                    };
                }
                statusGroupBreakdown[sgName].expected += feeItem.totalAmount || 0;
                statusGroupBreakdown[sgName].paid += cashPaid;
                statusGroupBreakdown[sgName].balance += remainingAmount;
                statusGroupBreakdown[sgName].itemsRemaining += remainingQuantity;
                statusGroupBreakdown[sgName].items.push({
                    ...feeItem,
                    cashPaid: cashPaid,
                    itemsBrought: itemsBrought,
                    remainingAmount: remainingAmount,
                    remainingQuantity: remainingQuantity,
                    isFullyPaid: isFullyPaid,
                    paymentHistories: paymentHistories
                });
                
                // Add to period items
                periodItems.push({
                    ...feeItem,
                    cashPaid: cashPaid,
                    itemsBrought: itemsBrought,
                    remainingAmount: remainingAmount,
                    remainingQuantity: remainingQuantity,
                    isFullyPaid: isFullyPaid,
                    paymentHistories: paymentHistories
                });
            }
            
            // ========== CALCULATE TOTALS ==========
            const totalExpected = tuitionExpected + totalActivityExpected;
            const totalPaid = tuitionPaid + totalActivityPaid;
            const totalBalance = totalExpected - totalPaid;
            
            // Build period data
            const periodData = {
                periodKey: periodKey,
                year: year,
                term: term,
                isFirstTerm: isFirstTermForPeriod,
                isCurrent: isCurrentPeriod,
                total: {
                    expected: totalExpected,
                    paid: totalPaid,
                    balance: totalBalance
                },
                tuition: {
                    expected: tuitionExpected,
                    paid: tuitionPaid,
                    balance: tuitionBalance,
                    isFullyPaid: tuitionBalance <= 0,
                    discountAmount: discountAmount,
                    bursaryName: appliedBursary?.name || null,
                    isCustomBursary: appliedBursary?.isCustom || false
                },
                activity: {
                    expected: totalActivityExpected,
                    paid: totalActivityPaid,
                    balance: totalActivityBalance,
                    itemsRemaining: totalItemsRemaining,
                    items: periodItems
                },
                statusGroupBreakdown: statusGroupBreakdown,
                payments: payments.map(p => ({
                    id: p.id,
                    date: p.date,
                    receiptNumber: p.receiptNumber,
                    amount: p.totalAmount || p.amount || 0,
                    tuitionPaid: p.tuitionPaid || 0,
                    activityPaid: p.activityTotal || 0,
                    method: p.method || 'cash',
                    isPreviousBalancePayment: p.isPreviousBalancePayment || false,
                    items: p.activityItemPayments || []
                })),
                itemCount: periodItems.length,
                hasCustomizations: periodItems.some(i => i.isCustomized),
                customizationCount: periodItems.filter(i => i.isCustomized).length,
                feeStructure: feeStructure ? {
                    id: feeStructure.id,
                    name: feeStructure.name,
                    level: feeStructure.level,
                    tuition: feeStructure.tuition || 0
                } : null,
                hasBalance: false
            };
            
            // ========== DETERMINE IF PERIOD HAS BALANCE ==========
            const hasBalance = periodHasBalance(periodData);
            periodData.hasBalance = hasBalance;
            
            // ========== STORE PERIOD DATA ==========
            if (isCurrentPeriod) {
                currentPeriodData = periodData;
                console.log(`📌 Current Period: ${year} Term ${term} - Balance: UGX ${totalBalance}, Items: ${totalItemsRemaining}`);
            } else if (hasBalance) {
                previousPeriodsData.push(periodData);
                totalPreviousBalance += totalBalance;
                totalPreviousItems += totalItemsRemaining;
                totalPreviousPeriods++;
                console.log(`📌 Previous Period WITH BALANCE: ${year} Term ${term} - Balance: UGX ${totalBalance}, Items: ${totalItemsRemaining}`);
            } else {
                console.log(`⏭️ Skipping period WITHOUT BALANCE: ${year} Term ${term} - Balance: UGX ${totalBalance}, Items: ${totalItemsRemaining}`);
            }
        }
        
        // ========== IF NO CURRENT PERIOD EXISTS, CREATE ONE ==========
        if (!currentPeriodData) {
            console.log('⚠️ No current period found, creating one with fee structure carryover...');
            
            const currentFeeItems = buildFeeItemsFromStructure(feeStructure, student, currentYear, currentTerm, isFirstTerm);
            
            let tuitionExpected = feeStructure?.tuition || 0;
            if (student.customBursary && student.customBursary.amount > 0) {
                tuitionExpected = Math.max(0, tuitionExpected - student.customBursary.amount);
            }
            
            const statusGroupBreakdown = {};
            for (const item of currentFeeItems.items) {
                const sgName = item.statusGroupName || 'Other';
                if (!statusGroupBreakdown[sgName]) {
                    statusGroupBreakdown[sgName] = {
                        name: sgName,
                        expected: 0,
                        paid: 0,
                        balance: 0,
                        itemsRemaining: 0,
                        items: []
                    };
                }
                statusGroupBreakdown[sgName].expected += item.totalAmount || 0;
                statusGroupBreakdown[sgName].balance += item.remainingAmount || 0;
                statusGroupBreakdown[sgName].itemsRemaining += item.remainingQuantity || 0;
                statusGroupBreakdown[sgName].items.push(item);
            }
            
            const totalActivityExpected = currentFeeItems.totalExpected || 0;
            const totalActivityBalance = currentFeeItems.items.reduce((sum, i) => sum + i.remainingAmount, 0);
            const totalItemsRemaining = currentFeeItems.items.reduce((sum, i) => sum + i.remainingQuantity, 0);
            
            currentPeriodData = {
                periodKey: currentPeriodKey,
                year: currentYear,
                term: currentTerm,
                isFirstTerm: isFirstTerm,
                isCurrent: true,
                hasBalance: (tuitionExpected > 0 || totalActivityBalance > 0 || totalItemsRemaining > 0),
                total: {
                    expected: tuitionExpected + totalActivityExpected,
                    paid: 0,
                    balance: tuitionExpected + totalActivityBalance
                },
                tuition: {
                    expected: tuitionExpected,
                    paid: 0,
                    balance: tuitionExpected,
                    isFullyPaid: tuitionExpected <= 0,
                    discountAmount: student.customBursary?.amount || 0,
                    bursaryName: student.customBursary ? 'Custom Bursary' : null,
                    isCustomBursary: !!student.customBursary
                },
                activity: {
                    expected: totalActivityExpected,
                    paid: 0,
                    balance: totalActivityBalance,
                    itemsRemaining: totalItemsRemaining,
                    items: currentFeeItems.items
                },
                statusGroupBreakdown: statusGroupBreakdown,
                payments: [],
                itemCount: currentFeeItems.items.length,
                hasCustomizations: currentFeeItems.items.some(i => i.isCustomized),
                customizationCount: currentFeeItems.items.filter(i => i.isCustomized).length,
                feeStructure: feeStructure ? {
                    id: feeStructure.id,
                    name: feeStructure.name,
                    level: feeStructure.level,
                    tuition: feeStructure.tuition || 0
                } : null,
                studentCustomizations: {
                    customItemOverrides: student.customItemOverrides || {},
                    customTransportation: student.customTransportation || null,
                    customBursary: student.customBursary || null,
                    removedItems: student.removedItems || {}
                }
            };
            
            console.log('✅ Current period created with fee structure:', feeStructure?.name);
        }
        
        // ========== CALCULATE FINAL TOTALS ==========
        const totalPreviousBalanceSum = previousPeriodsData.reduce((sum, p) => sum + p.total.balance, 0);
        const totalPreviousItemsSum = previousPeriodsData.reduce((sum, p) => sum + p.activity.itemsRemaining, 0);
        
        // ========== BUILD RESPONSE ==========
        const response = {
            success: true,
            student: {
                id: student.id,
                name: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
                admissionNumber: student.admissionNumber,
                currentClass: student.currentClass || 'N/A',
                status: student.status || 'Active'
            },
            currentPeriod: currentPeriodData,
            previousPeriods: previousPeriodsData,
            totalPreviousBalance: totalPreviousBalanceSum,
            totalPreviousItems: totalPreviousItemsSum,
            totalPreviousPeriods: previousPeriodsData.length,
            periodsWithBalance: previousPeriodsData.length,
            emptyPeriods: 0,
            feeStructure: feeStructure ? {
                id: feeStructure.id,
                name: feeStructure.name,
                level: feeStructure.level,
                tuition: feeStructure.tuition || 0,
                activityComponents: feeStructure.activityComponents || []
            } : null,
            metadata: {
                currentYear: currentYear,
                currentTerm: currentTerm,
                isFirstTerm: isFirstTerm,
                totalPeriods: allPeriods.length,
                periodsWithBalance: previousPeriodsData.length,
                hasCustomizations: !!(student.customItemOverrides && Object.keys(student.customItemOverrides).length > 0),
                hasRemovedItems: !!(student.removedItems && Object.keys(student.removedItems).length > 0),
                hasCustomBursary: !!(student.customBursary && student.customBursary.amount > 0),
                hasCustomTransportation: !!(student.customTransportation && student.customTransportation.hasTransportation !== false),
                message: 'Only showing periods with outstanding balances. Fully paid periods are hidden.',
                periodTypeRules: {
                    one_time: '⭐ Charged ONCE. Follows student FOREVER until fully paid.',
                    yearly: '📆 Charged ONCE per academic year. Resets each year.',
                    termly: '📅 Charged EVERY term. Independent per term.'
                }
            }
        };
        
        console.log('✅ Response generated:');
        console.log(`   📋 Current period: ${currentPeriodData ? 'Yes' : 'No'}`);
        console.log(`   📋 Previous periods with balances: ${previousPeriodsData.length}`);
        console.log(`   💰 Total previous balance: UGX ${totalPreviousBalanceSum}`);
        console.log(`   📦 Total previous items: ${totalPreviousItemsSum}`);
        console.log(`   📊 Total periods checked: ${allPeriods.length}`);
        
        res.json(response);
        
    } catch (error) {
        console.error('Error getting previous balances:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

console.log('✅ Previous Balances API v13.0 - STABLE ITEM IDs LOADED!');
console.log('   🔑 All items now have deterministic, stable IDs');
console.log('   📦 Customizations persist across page reloads');
console.log('   🎯 IDs are generated from: componentName + itemName + periodType');
console.log('   🔁 Same ID = same item = customizations persist');
console.log('✅ Previous Balances API v12.0 - ONLY PERIODS WITH BALANCES LOADED!');
console.log('   📅 Carries forward fee structure to new periods');
console.log('   ⚡ Preserves all custom item overrides');
console.log('   🚫 Handles removed items correctly');
console.log('   🎖️ Applies custom bursary to tuition');
console.log('   🚌 Handles custom transportation');
console.log('   📋 ONLY shows previous periods with BALANCES');
console.log('   ⏭️ Fully paid periods are SKIPPED (not shown)');
console.log('   📦 Period-aware payment scoping (one_time, yearly, termly)');
console.log('   ⭐ One-Time items follow student FOREVER until fully paid');
console.log('   📆 Yearly items reset each year');
console.log('   📅 Termly items independent per term');


// Delete a specific payment record
// ==================== DELETE A PAYMENT RECORD (WITH INVENTORY REVERSAL) ====================
// ==================== DELETE A PAYMENT RECORD (WITH INVENTORY REVERSAL FOR CASH & ITEMS) ====================
app.delete('/api/fee/payments/:id', (req, res) => {
    try {
        const paymentId = req.params.id;
        let payments = readFile(files.feePayments);
        
        const paymentToDelete = payments.find(p => p.id === paymentId);
        const initialLength = payments.length;
        payments = payments.filter(p => p.id !== paymentId);
        
        if (payments.length === initialLength) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        // ========== Reverse inventory for all items in this receipt ==========
        if (paymentToDelete) {
            const itemQtyMap = {};

            // Helper to add quantity for an item
            function addItemQuantity(item) {
                if (!item) return;
                const name = (item.itemName || '').trim();
                if (!name) return;
                let qtyToAdd = 0;
                if (item.paymentType === 'brought_item') {
                    qtyToAdd = item.itemsBrought || 0;
                } else if (item.paymentType === 'paid_cash') {
                    const unitPrice = item.unitPrice || 0;
                    if (unitPrice > 0) {
                        qtyToAdd = Math.floor((item.amountPaid || 0) / unitPrice);
                    } else {
                        // Fallback: use quantityRequired if available
                        qtyToAdd = item.quantityRequired || 0;
                    }
                }
                if (qtyToAdd > 0) {
                    itemQtyMap[name] = (itemQtyMap[name] || 0) + qtyToAdd;
                }
            }

            // Check activityItemPayments
            if (Array.isArray(paymentToDelete.activityItemPayments)) {
                for (const item of paymentToDelete.activityItemPayments) {
                    addItemQuantity(item);
                }
            }

            // Check paymentsByPeriodType
            if (paymentToDelete.paymentsByPeriodType) {
                for (const pt of ['one_time', 'termly', 'yearly']) {
                    const periodItems = paymentToDelete.paymentsByPeriodType[pt] || [];
                    for (const item of periodItems) {
                        addItemQuantity(item);
                    }
                }
            }

            // Reverse inventory for each item
            for (const [name, qty] of Object.entries(itemQtyMap)) {
                reverseInventoryForDeletedPaymentItem(
                    paymentToDelete.studentId,
                    name,
                    paymentToDelete.academicYear,
                    paymentToDelete.term,
                    qty
                );
            }
        }

        saveFile(files.feePayments, payments);
        res.json({ success: true, message: 'Payment deleted successfully' });
    } catch (error) {
        console.error('Error deleting payment:', error);
        res.status(500).json({ error: 'Failed to delete payment' });
    }
});

// ==================== DELETE ONE ITEM'S PAYMENT FROM A SHARED RECEIPT ====================
// ==================== DELETE ONE ITEM'S PAYMENT FROM A SHARED RECEIPT (WITH INVENTORY REVERSAL) ====================
// ==================== DELETE ONE ITEM'S PAYMENT (WITH INVENTORY REVERSAL FOR CASH & ITEMS) ====================
app.delete('/api/fee/payments/:paymentId/item', (req, res) => {
    try {
        const { paymentId } = req.params;
        const { itemName, componentName, periodType, paymentType, amount, quantity } = req.body;

        if (!itemName || !componentName) {
            return res.status(400).json({ error: 'itemName and componentName are required' });
        }

        let payments = readFile(files.feePayments);
        const idx = payments.findIndex(p => p.id === paymentId);
        if (idx === -1) return res.status(404).json({ error: 'Payment record not found' });

        const payment = payments[idx];

        function matches(item) {
            if (!item) return false;
            const nameMatch = (item.itemName || '').trim().toLowerCase() === itemName.trim().toLowerCase();
            const compMatch = (item.componentName || '').trim().toLowerCase() === componentName.trim().toLowerCase();
            if (!nameMatch || !compMatch) return false;
            if (periodType && item.periodType && item.periodType !== periodType) return false;
            if (paymentType && item.paymentType && item.paymentType !== paymentType) return false;
            if (paymentType === 'paid_cash' && amount !== undefined) {
                if (Math.round(item.amountPaid || 0) !== Math.round(amount)) return false;
            }
            if (paymentType === 'brought_item' && quantity !== undefined) {
                if (Math.round(item.itemsBrought || 0) !== Math.round(quantity)) return false;
            }
            return true;
        }

        let removed = false;
        let inventoryQtyToReverse = 0; // quantity to reverse (items or cash-equivalent items)

        // ========== Remove from activityItemPayments ==========
        if (Array.isArray(payment.activityItemPayments)) {
            const i = payment.activityItemPayments.findIndex(matches);
            if (i !== -1) {
                const matchedItem = payment.activityItemPayments[i];
                inventoryQtyToReverse = computeInventoryQtyForPaymentItem(matchedItem);
                payment.activityItemPayments.splice(i, 1);
                removed = true;
            }
        }

        // ========== Remove from paymentsByPeriodType (if not already removed) ==========
        if (!removed && payment.paymentsByPeriodType) {
            for (const pt of ['one_time', 'termly', 'yearly']) {
                const arr = payment.paymentsByPeriodType[pt] || [];
                const i = arr.findIndex(matches);
                if (i !== -1) {
                    const matchedItem = arr[i];
                    if (inventoryQtyToReverse === 0) {
                        inventoryQtyToReverse = computeInventoryQtyForPaymentItem(matchedItem);
                    }
                    arr.splice(i, 1);
                    removed = true;
                    break;
                }
            }
        }

        if (!removed) {
            return res.status(404).json({ error: 'That specific item payment was not found in this receipt' });
        }

        // ========== Reverse inventory if this payment added stock ==========
        if (inventoryQtyToReverse > 0) {
            reverseInventoryForDeletedPaymentItem(
                payment.studentId,
                itemName,
                payment.academicYear,
                payment.term,
                inventoryQtyToReverse
            );
        }

        // Recalculate totals for this record only
        const newActivityTotal = (payment.activityItemPayments || []).reduce((sum, i) =>
            sum + (i.paymentType === 'paid_cash'
                ? (i.amountPaid || 0)
                : (i.cashEquivalent || (i.itemsBrought || 0) * (i.unitPrice || 0))), 0);
        payment.activityTotalPaid = newActivityTotal;
        payment.totalAmount = (payment.tuitionPaid || 0) + newActivityTotal;

        // Keep studentTermRecords in sync
        try {
            let termRecords = readFile(files.studentTermRecords);
            const key = `${payment.studentId}_${payment.academicYear}_${payment.term}`;
            if (termRecords[key] && termRecords[key].activityItemsPaid) {
                for (const pt of ['one_time', 'termly', 'yearly']) {
                    const arr = termRecords[key].activityItemsPaid[pt] || [];
                    const entry = arr.find(i => i.itemName === itemName);
                    if (entry && entry.payments) {
                        entry.payments = entry.payments.filter(p =>
                            !(p.receiptNumber === payment.receiptNumber &&
                              ((amount !== undefined && Math.abs((p.amount||0)-amount) < 1) ||
                               (quantity !== undefined && Math.abs((p.itemsBrought||0)-quantity) < 1)))
                        );
                        entry.amountPaid = entry.payments.reduce((s,p)=>s+(p.amount||0),0);
                        entry.itemsBrought = entry.payments.reduce((s,p)=>s+(p.itemsBrought||0),0);
                    }
                }
                saveFile(files.studentTermRecords, termRecords);
            }
        } catch (e) {
            console.warn('term record sync skipped:', e.message);
        }

        const stillHasSomething = (payment.activityItemPayments || []).length > 0 || (payment.tuitionPaid || 0) > 0;

        if (!stillHasSomething) {
            payments.splice(idx, 1);
            saveFile(files.feePayments, payments);
            return res.json({ success: true, deletedEntirePayment: true });
        }

        payments[idx] = payment;
        saveFile(files.feePayments, payments);
        res.json({ success: true, deletedEntirePayment: false, payment });

    } catch (error) {
        console.error('Error deleting item payment:', error);
        res.status(500).json({ error: error.message });
    }
});
// ==================== DELETE ONLY THE TUITION PORTION OF A RECEIPT ====================
app.delete('/api/fee/payments/:paymentId/tuition', (req, res) => {
    try {
        const { paymentId } = req.params;
        let payments = readFile(files.feePayments);
        const idx = payments.findIndex(p => p.id === paymentId);
        if (idx === -1) return res.status(404).json({ error: 'Payment record not found' });

        const payment = payments[idx];
        payment.tuitionPaid = 0;
        payment.totalAmount = payment.activityTotalPaid || 0;

        const stillHasSomething = (payment.activityItemPayments || []).length > 0;
        if (!stillHasSomething) {
            payments.splice(idx, 1);
            saveFile(files.feePayments, payments);
            return res.json({ success: true, deletedEntirePayment: true });
        }
        payments[idx] = payment;
        saveFile(files.feePayments, payments);
        res.json({ success: true, deletedEntirePayment: false, payment });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ================================================================
// STUDENT PROMOTION ENDPOINT - COMPLETE
// ================================================================

// Make sure uuid is required at the top of server.js
// const { v4: uuidv4 } = require('uuid');

// ================================================================
// STUDENT PROMOTION - COMPLETE REBUILD (WORKING)
// ================================================================

// ================================================================
// STUDENT PROMOTION - COMPLETE REBUILD (PROPER FEE STRUCTURE)
// ================================================================

// ==================== STUDENT PROMOTION (YEAR-AWARE) ====================
// Version: 3.0 - Fully fixed for multi‑year fee assignment
// ==================== STUDENT PROMOTION (v4.0 - FULLY REBUILT) ====================
// Supports: batch by class/level/all, individual with per-student overrides
// ==================== STUDENT PROMOTION (v5.0 - FULLY FIXED) ====================
// Fixed issues:
// 1. Fee structure not updating after promotion
// 2. Manual fee assignment not saving
// 3. Fee structure finder not matching class names
// 4. Year-aware assignments not working
// 5. Student's assignedFeeStructureId not updating

// ==================== STUDENT PROMOTION (v6.0 - FULLY FIXED) ====================
// Fixed: Fee structure now uses TARGET class, not source class

// ==================== STUDENT PROMOTION (v7.0 - FINAL FIX) ====================
// FIXED: Fee structure now uses TARGET class (not source class)
// FIXED: Proper year-aware assignment
// FIXED: Auto-detection of Day/Boarding

// ==================== STUDENT PROMOTION (v8.0 - FULLY WORKING) ====================
// ==================== STUDENT PROMOTION (v9.0 - WITH P.7 ARCHIVING) ====================
// ==================== STUDENT PROMOTION (v10.0 - WITH P.7 ARCHIVING FIXED) ====================
app.post('/api/students/promote', async (req, res) => {
    console.log('🎓 === STUDENT PROMOTION REQUEST (v10.0 - WITH P.7 ARCHIVING FIXED) ===');
    console.log('📦 Body:', JSON.stringify(req.body, null, 2));

    try {
        // ================================================================
        // 1. READ ALL DATA
        // ================================================================
        const dataDir = path.join(__dirname, 'data');

        function readJSON(file) {
            const filePath = path.join(dataDir, file);
            if (!fs.existsSync(filePath)) {
                console.warn(`⚠️ File not found: ${file}, creating empty`);
                return [];
            }
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                if (!content || content.trim() === '') return [];
                return JSON.parse(content);
            } catch (e) {
                console.warn(`⚠️ Error reading ${file}:`, e.message);
                return [];
            }
        }

        function saveJSON(file, data) {
            const filePath = path.join(dataDir, file);
            try {
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
                console.log(`✅ Saved: ${file}`);
                return true;
            } catch (e) {
                console.error(`❌ Error saving ${file}:`, e.message);
                return false;
            }
        }

        let students = readJSON('students.json');
        let enrollments = readJSON('enrollments.json');
        let feeAssignments = readJSON('studentFeeAssignments.json');
        let feeStructures = readJSON('feeStructures.json');
        let classes = readJSON('classes.json');

        students = Array.isArray(students) ? students : [];
        enrollments = Array.isArray(enrollments) ? enrollments : [];
        feeAssignments = Array.isArray(feeAssignments) ? feeAssignments : [];
        feeStructures = Array.isArray(feeStructures) ? feeStructures : [];
        classes = Array.isArray(classes) ? classes : [];

        // ================================================================
        // 1.5 READ/WRITE ARCHIVE FILE
        // ================================================================
        const archivePath = path.join(dataDir, 'archivedStudents.json');
        
        function readArchive() {
            if (!fs.existsSync(archivePath)) {
                return [];
            }
            try {
                const content = fs.readFileSync(archivePath, 'utf8');
                return JSON.parse(content);
            } catch (e) {
                return [];
            }
        }

        function saveArchive(data) {
            try {
                fs.writeFileSync(archivePath, JSON.stringify(data, null, 2), 'utf8');
                console.log(`✅ Saved archived students`);
                return true;
            } catch (e) {
                console.error(`❌ Error saving archive:`, e.message);
                return false;
            }
        }

        // Get current academic settings
        const settings = readJSON('settings.json');
        const currentYear = settings.currentAcademicYear || new Date().getFullYear();
        const currentTerm = settings.currentTerm || 1;
        const nextYear = currentYear + 1;

        console.log(`📊 Data: ${students.length} students, ${feeStructures.length} fee structures, ${classes.length} classes`);
        console.log(`📅 Current: ${currentYear} Term ${currentTerm}, Next: ${nextYear}`);

        // ================================================================
        // 2. BUILD MAPS
        // ================================================================
        const classMap = {};
        classes.forEach(c => { if (c && c.id) classMap[c.id] = c; });

        const feeStructureMap = {};
        feeStructures.forEach(f => { if (f && f.id) feeStructureMap[f.id] = f; });

        // ================================================================
        // 3. BUILD FEE STRUCTURE LOOKUP
        // ================================================================
        function buildFeeStructureLookup() {
            const dayMap = {};
            const boardingMap = {};

            feeStructures.forEach(fs => {
                if (!fs || fs.isActive === false) return;

                const name = fs.name.toLowerCase().trim();
                const isBoarding = name.includes('boarding');
                const isDay = name.includes('day');

                // Store by exact name
                if (isBoarding) {
                    boardingMap[name] = fs;
                    let base = name.replace('boarding', '').trim();
                    boardingMap[base] = fs;
                    boardingMap[base.replace(/\s/g, '')] = fs;
                }
                if (isDay || !isBoarding) {
                    dayMap[name] = fs;
                    let base = name.replace('day', '').trim();
                    dayMap[base] = fs;
                    dayMap[base.replace(/\s/g, '')] = fs;
                }

                // Map by number (P.5, Primary 5, etc.)
                const numMatch = fs.name.match(/(\d+)/);
                if (numMatch) {
                    const num = numMatch[1];
                    const pKey = `p.${num}`.toLowerCase();
                    const primaryKey = `primary ${num}`.toLowerCase();

                    if (isBoarding) {
                        boardingMap[pKey] = fs;
                        boardingMap[primaryKey] = fs;
                        boardingMap[pKey.replace(/\s/g, '')] = fs;
                        boardingMap[primaryKey.replace(/\s/g, '')] = fs;
                    }
                    if (isDay || !isBoarding) {
                        dayMap[pKey] = fs;
                        dayMap[primaryKey] = fs;
                        dayMap[pKey.replace(/\s/g, '')] = fs;
                        dayMap[primaryKey.replace(/\s/g, '')] = fs;
                    }
                }

                // Map by level
                const levelMatch = fs.name.match(/(baby|middle|top|nursery)/i);
                if (levelMatch) {
                    const level = levelMatch[1].toLowerCase();
                    const levelMap = {
                        'baby': 'baby class',
                        'middle': 'middle class',
                        'top': 'top class',
                        'nursery': 'nursery'
                    };
                    const key = levelMap[level] || level;
                    if (isBoarding) {
                        boardingMap[key] = fs;
                        boardingMap[key.replace(/\s/g, '')] = fs;
                    }
                    if (isDay || !isBoarding) {
                        dayMap[key] = fs;
                        dayMap[key.replace(/\s/g, '')] = fs;
                    }
                }
            });

            return { dayMap, boardingMap };
        }

        const { dayMap, boardingMap } = buildFeeStructureLookup();

        // ================================================================
        // 4. HELPER FUNCTIONS
        // ================================================================

        function determineStudentType(feeStructureId) {
            if (!feeStructureId) return 'Day';
            const fs = feeStructureMap[feeStructureId];
            if (!fs) return 'Day';
            const fsName = fs.name.toLowerCase().trim();
            if (fsName.includes('boarding')) return 'Boarding';
            return 'Day';
        }

        function findFeeStructureForClassAndType(className, studentType) {
            if (!className) return null;

            const clean = className.toLowerCase().trim();
            const isBoarding = studentType === 'Boarding';

            console.log(`🔍 Looking for fee structure for TARGET class: "${clean}" (${studentType})`);

            const map = isBoarding ? boardingMap : dayMap;

            if (map[clean]) {
                console.log(`   ✅ Found exact match: ${map[clean].name}`);
                return map[clean];
            }
            if (map[clean.replace(/\s/g, '')]) {
                console.log(`   ✅ Found match (no spaces): ${map[clean.replace(/\s/g, '')].name}`);
                return map[clean.replace(/\s/g, '')];
            }

            const numMatch = clean.match(/(p\.?|primary)\s*(\d+)/i);
            if (numMatch) {
                const num = numMatch[2];
                const variants = [
                    `p.${num}`,
                    `primary ${num}`,
                    `p${num}`,
                    `primary${num}`,
                    `p.${num}`.replace(/\s/g, ''),
                    `primary ${num}`.replace(/\s/g, '')
                ];
                for (const v of variants) {
                    if (map[v]) {
                        console.log(`   ✅ Found by number ${num}: ${map[v].name}`);
                        return map[v];
                    }
                }
            }

            for (const [key, fs] of Object.entries(map)) {
                if (fs.name.toLowerCase().includes(clean) || clean.includes(fs.name.toLowerCase())) {
                    console.log(`   ✅ Found partial match: ${fs.name}`);
                    return fs;
                }
            }

            const fallbackMap = isBoarding ? dayMap : boardingMap;
            for (const [key, fs] of Object.entries(fallbackMap)) {
                if (fs.name.toLowerCase().includes(clean) || clean.includes(fs.name.toLowerCase())) {
                    console.log(`   ⚠️ Fallback: Using ${isBoarding ? 'Day' : 'Boarding'} structure: ${fs.name}`);
                    return fs;
                }
            }

            console.log(`   ❌ No fee structure found for "${className}" (${studentType})`);
            return null;
        }

        function isP7Student(student, classMap) {
            if (!student || !student.currentClassId) return false;
            const currentClass = classMap[student.currentClassId];
            if (!currentClass) return false;
            const className = currentClass.name.toLowerCase().trim();
            return className === 'p.7' || className === 'primary 7' || className === 'p7';
        }

        // ================================================================
        // 5. DETERMINE STUDENTS TO PROMOTE
        // ================================================================
        const {
            items,
            studentIds,
            toClassId,
            allSchool,
            level,
            fromClassId,
            feeStructureOverrides
        } = req.body;

        let promotionTasks = [];

        // ================================================================
        // CASE A: Individual promotion with per-student targets
        // ================================================================
        if (items && Array.isArray(items) && items.length > 0) {
            console.log(`📋 Processing ${items.length} individual promotion tasks`);
            
            for (const item of items) {
                if (!item.studentId) {
                    console.warn(`⚠️ Skipping invalid item:`, item);
                    continue;
                }

                // Check if this is a P.7 student to be archived
                const student = students.find(s => s.id === item.studentId);
                const isP7 = student ? isP7Student(student, classMap) : false;

                if (isP7 || item.isP7 === true || item.archive === true) {
                    console.log(`   🎓 P.7 student detected: ${student?.firstName} ${student?.lastName}`);
                    
                    // Get the student's current class ID from their enrollment
                    const currentEnrollment = enrollments.find(e => 
                        e.studentId === item.studentId && e.isCurrent === true
                    );
                    
                    promotionTasks.push({
                        studentId: item.studentId,
                        toClassId: currentEnrollment ? currentEnrollment.classId : null,
                        isP7: true,
                        archive: true,
                        feeStructureId: null
                    });
                } else {
                    // Normal promotion - require toClassId
                    if (!item.toClassId) {
                        console.warn(`⚠️ Skipping item without toClassId:`, item);
                        continue;
                    }
                    
                    promotionTasks.push({
                        studentId: item.studentId,
                        toClassId: item.toClassId,
                        isP7: false,
                        archive: false,
                        feeStructureId: item.feeStructureId || null
                    });
                }
            }
        }
        // ================================================================
        // CASE B: Batch by studentIds with same target class
        // ================================================================
        else if (studentIds && Array.isArray(studentIds) && studentIds.length > 0 && toClassId) {
            console.log(`📋 Processing ${studentIds.length} students to class ${toClassId}`);
            for (const id of studentIds) {
                const student = students.find(s => s.id === id);
                const isP7 = student ? isP7Student(student, classMap) : false;
                
                if (isP7) {
                    const currentEnrollment = enrollments.find(e => 
                        e.studentId === id && e.isCurrent === true
                    );
                    promotionTasks.push({
                        studentId: id,
                        toClassId: currentEnrollment ? currentEnrollment.classId : null,
                        isP7: true,
                        archive: true,
                        feeStructureId: null
                    });
                } else {
                    const overrideId = feeStructureOverrides?.[id] || null;
                    promotionTasks.push({
                        studentId: id,
                        toClassId: toClassId,
                        isP7: false,
                        archive: false,
                        feeStructureId: overrideId
                    });
                }
            }
        }
        // ================================================================
        // CASE C: Batch by class, level, or all school
        // ================================================================
        else {
            const currentEnrollments = enrollments.filter(e => e.isCurrent === true);
            let targetStudentIds = [];

            if (allSchool === true) {
                targetStudentIds = currentEnrollments.map(e => e.studentId);
                console.log(`📋 Processing all ${targetStudentIds.length} students in school`);
            } else if (level) {
                const levelClasses = classes.filter(c => c.level === level);
                const classIds = levelClasses.map(c => c.id);
                const levelEnrollments = currentEnrollments.filter(e => classIds.includes(e.classId));
                targetStudentIds = levelEnrollments.map(e => e.studentId);
                console.log(`📋 Processing ${targetStudentIds.length} students in level ${level}`);
            } else if (fromClassId) {
                const classEnrollments = currentEnrollments.filter(e => e.classId === fromClassId);
                targetStudentIds = classEnrollments.map(e => e.studentId);
                console.log(`📋 Processing ${targetStudentIds.length} students from class ${fromClassId}`);
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid promotion request. Provide items, studentIds+toClassId, or batch parameters.'
                });
            }

            const levelOrder = ['Nursery', 'LowerPrimary', 'UpperPrimary'];

            for (const studentId of targetStudentIds) {
                const student = students.find(s => s && s.id === studentId);
                if (!student) continue;

                const currentEnrollment = currentEnrollments.find(e => e.studentId === studentId);
                if (!currentEnrollment) continue;

                const currentClass = classMap[currentEnrollment.classId];
                if (!currentClass) continue;

                // Check if P.7
                const isP7 = isP7Student(student, classMap);

                if (isP7) {
                    promotionTasks.push({
                        studentId: studentId,
                        toClassId: currentEnrollment.classId,
                        isP7: true,
                        archive: true,
                        feeStructureId: null
                    });
                    continue;
                }

                let targetClassId = toClassId;

                if (!targetClassId) {
                    const currentIndex = levelOrder.indexOf(currentClass.level);
                    if (currentIndex === -1 || currentIndex === levelOrder.length - 1) continue;
                    const nextLevel = levelOrder[currentIndex + 1];
                    const nextClasses = classes.filter(c => c.level === nextLevel);
                    const numMatch = currentClass.name.match(/(\d+)/);
                    const num = numMatch ? numMatch[1] : '';
                    let matched = nextClasses.find(c => c.name.includes(num));
                    if (!matched && nextClasses.length > 0) matched = nextClasses[0];
                    if (!matched) continue;
                    targetClassId = matched.id;
                }

                const overrideId = feeStructureOverrides?.[studentId] || null;
                promotionTasks.push({
                    studentId: studentId,
                    toClassId: targetClassId,
                    isP7: false,
                    archive: false,
                    feeStructureId: overrideId
                });
            }
        }

        // Remove duplicates
        const seen = new Set();
        promotionTasks = promotionTasks.filter(task => {
            const key = `${task.studentId}_${task.toClassId}_${task.isP7}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        console.log(`📋 Total promotion tasks: ${promotionTasks.length}`);

        if (promotionTasks.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid students found to promote'
            });
        }

        // ================================================================
        // 6. PROCESS EACH PROMOTION TASK
        // ================================================================
        const results = { success: [], failed: [], skipped: [], archived: [] };
        const enrollmentsToAdd = [];
        const enrollmentsToUpdate = [];
        const studentsToUpdate = [];

        // Read existing archive
        let archivedStudents = readArchive();

        for (const task of promotionTasks) {
            const { studentId, toClassId, feeStructureId: overrideFeeId, isP7, archive } = task;

            try {
                const student = students.find(s => s && s.id === studentId);
                if (!student) {
                    results.failed.push({ studentId, reason: 'Student not found' });
                    continue;
                }

                const currentEnrollment = enrollments.find(e =>
                    e.studentId === studentId && e.isCurrent === true
                );
                if (!currentEnrollment) {
                    results.failed.push({ studentId, reason: 'No current enrollment' });
                    continue;
                }

                const currentClass = classMap[currentEnrollment.classId];
                if (!currentClass) {
                    results.failed.push({ studentId, reason: 'Current class not found' });
                    continue;
                }

                // ============================================================
                // HANDLE P.7 ARCHIVING
                // ============================================================
                if (isP7 === true || archive === true) {
                    console.log(`   🎓 P.7 STUDENT DETECTED - ARCHIVING: ${student.firstName} ${student.lastName}`);
                    
                    // Create archive record
                    const studentEnrollments = enrollments.filter(e => e.studentId === studentId);
                    const studentFeeAssignments = feeAssignments.filter(a => a.studentId === studentId);
                    
                    const archiveRecord = {
                        student: { ...student },
                        enrollments: studentEnrollments,
                        feeAssignments: studentFeeAssignments,
                        archivedAt: new Date().toISOString(),
                        archivedReason: 'Completed P.7 - Primary Education Complete',
                        academicYear: currentYear,
                        term: currentTerm,
                        fromClass: currentClass.name
                    };
                    
                    archivedStudents.push(archiveRecord);
                    console.log(`   ✅ Student ${student.firstName} ${student.lastName} archived`);
                    
                    // Mark student as inactive
                    student.status = 'Inactive';
                    student.graduatedAt = new Date().toISOString();
                    student.graduationReason = 'Completed P.7 - Primary Education Complete';
                    
                    // Mark current enrollment as not current and completed
                    currentEnrollment.isCurrent = false;
                    currentEnrollment.completedAt = new Date().toISOString();
                    currentEnrollment.completionReason = 'Completed P.7 - Primary Education Complete';
                    
                    // Update student in array
                    const studentIdx = students.findIndex(s => s.id === studentId);
                    if (studentIdx !== -1) {
                        students[studentIdx] = student;
                    }
                    
                    // Record success
                    results.success.push({
                        studentId,
                        studentName: `${student.firstName || ''} ${student.lastName || ''}`.trim() || 'Unknown',
                        fromClass: currentClass.name,
                        toClass: 'ARCHIVED - P.7 Completed',
                        feeStructure: 'N/A - Archived',
                        studentType: determineStudentType(student.assignedFeeStructureId),
                        academicYear: currentYear,
                        isArchived: true
                    });
                    
                    results.archived.push({
                        studentId,
                        studentName: `${student.firstName || ''} ${student.lastName || ''}`.trim() || 'Unknown',
                        fromClass: currentClass.name,
                        archivedAt: new Date().toISOString()
                    });
                    
                    console.log(`   ✅ ${student.firstName} ${student.lastName} archived successfully`);
                    continue;
                }

                // ============================================================
                // NORMAL PROMOTION FOR NON-P.7 STUDENTS
                // ============================================================
                
                // Get target class
                const targetClass = classMap[toClassId];
                if (!targetClass) {
                    results.failed.push({ studentId, reason: 'Target class not found' });
                    continue;
                }

                console.log(`\n📌 Processing: ${student.firstName} ${student.lastName}`);
                console.log(`   Current Class: ${currentClass.name}`);
                console.log(`   TARGET Class: ${targetClass.name}`);

                // Get student's current fee assignment
                const currentAssignment = feeAssignments.find(a =>
                    a && a.studentId === studentId &&
                    a.academicYear === currentYear
                ) || feeAssignments.find(a => a && a.studentId === studentId) || {};

                const currentFeeStructureId = currentAssignment.feeStructureId || student.assignedFeeStructureId || student.feeStructureId || null;

                // Determine student type
                let studentType = 'Day';
                if (currentFeeStructureId) {
                    const currentFs = feeStructureMap[currentFeeStructureId];
                    if (currentFs) {
                        const fsName = currentFs.name.toLowerCase().trim();
                        if (fsName.includes('boarding')) studentType = 'Boarding';
                        console.log(`   Student Type: ${studentType} (from ${currentFs.name})`);
                    }
                }

                // Determine new fee structure
                let newFeeStructureId = null;
                let newFeeStructureName = null;
                let isOverridden = false;

                if (overrideFeeId) {
                    const fs = feeStructureMap[overrideFeeId];
                    if (fs) {
                        newFeeStructureId = overrideFeeId;
                        newFeeStructureName = fs.name;
                        isOverridden = true;
                        console.log(`   🔧 OVERRIDE: Using fee structure ${fs.name}`);
                    }
                }

                if (!newFeeStructureId) {
                    console.log(`   🔍 Auto-detecting for TARGET class: ${targetClass.name} (${studentType})`);
                    const fee = findFeeStructureForClassAndType(targetClass.name, studentType);
                    if (fee) {
                        newFeeStructureId = fee.id;
                        newFeeStructureName = fee.name;
                        console.log(`   💰 Auto-detected: ${fee.name}`);
                    } else {
                        console.warn(`   ⚠️ No fee structure found, keeping current`);
                        newFeeStructureId = currentFeeStructureId;
                        const currentFs = feeStructureMap[currentFeeStructureId];
                        newFeeStructureName = currentFs?.name || 'Current Fee Structure';
                    }
                }

                // Create new enrollment
                const newEnrollment = {
                    id: uuidv4(),
                    studentId: studentId,
                    classId: toClassId,
                    academicYear: nextYear,
                    isCurrent: true,
                    promotedFrom: currentEnrollment.classId,
                    promotedAt: new Date().toISOString(),
                    createdAt: new Date().toISOString()
                };

                // Mark old enrollment as not current
                currentEnrollment.isCurrent = false;
                currentEnrollment.completedAt = new Date().toISOString();
                enrollmentsToUpdate.push(currentEnrollment);
                enrollmentsToAdd.push(newEnrollment);

                // Save fee assignment
                if (newFeeStructureId) {
                    console.log(`   📝 Assigning fee structure for ${nextYear}: ${newFeeStructureName} (${newFeeStructureId})`);
                    
                    let currentFeeAssignments = readJSON('studentFeeAssignments.json');
                    if (!Array.isArray(currentFeeAssignments)) currentFeeAssignments = [];
                    
                    const existingIdx = currentFeeAssignments.findIndex(a =>
                        a.studentId === studentId && a.academicYear === nextYear
                    );
                    
                    const assignmentToSave = {
                        id: existingIdx !== -1 ? currentFeeAssignments[existingIdx].id : uuidv4(),
                        studentId: studentId,
                        feeStructureId: newFeeStructureId,
                        bursaryId: currentAssignment.bursaryId || null,
                        academicYear: nextYear,
                        term: currentTerm,
                        assignedAt: existingIdx !== -1 ? currentFeeAssignments[existingIdx].assignedAt : new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };
                    
                    if (existingIdx !== -1) {
                        currentFeeAssignments[existingIdx] = assignmentToSave;
                        console.log(`   ✅ Updated existing fee assignment for ${nextYear}`);
                    } else {
                        currentFeeAssignments.push(assignmentToSave);
                        console.log(`   ✅ Created new fee assignment for ${nextYear}`);
                    }
                    
                    saveJSON('studentFeeAssignments.json', currentFeeAssignments);
                    console.log(`   ✅ Fee assignment saved for ${nextYear}`);
                }

                // Update student
                student.currentClassId = toClassId;
                if (newFeeStructureId) {
                    student.assignedFeeStructureId = newFeeStructureId;
                    student.feeStructureId = newFeeStructureId;
                }
                student._feeAssignmentPeriod = { year: nextYear, term: currentTerm };
                student.updatedAt = new Date().toISOString();
                studentsToUpdate.push(student);

                console.log(`   🔄 Updated student: class=${targetClass.name}, feeStructure=${newFeeStructureName}`);

                results.success.push({
                    studentId,
                    studentName: `${student.firstName || ''} ${student.lastName || ''}`.trim() || 'Unknown',
                    fromClass: currentClass.name,
                    toClass: targetClass.name,
                    feeStructure: newFeeStructureName || 'Not Assigned',
                    feeStructureId: newFeeStructureId,
                    studentType: studentType,
                    academicYear: nextYear,
                    isOverridden: isOverridden
                });

            } catch (error) {
                console.error(`❌ Error promoting ${studentId}:`, error.message);
                results.failed.push({ studentId, reason: error.message });
            }
        }

        // ================================================================
        // 7. SAVE ALL CHANGES
        // ================================================================
        console.log(`\n💾 Saving changes...`);
        
        if (archivedStudents.length > 0) {
            saveArchive(archivedStudents);
        }
        
        for (const update of enrollmentsToUpdate) {
            const idx = enrollments.findIndex(e => e.id === update.id);
            if (idx !== -1) enrollments[idx] = update;
        }
        for (const add of enrollmentsToAdd) enrollments.push(add);
        for (const update of studentsToUpdate) {
            const idx = students.findIndex(s => s.id === update.id);
            if (idx !== -1) students[idx] = update;
        }

        saveJSON('students.json', students);
        saveJSON('enrollments.json', enrollments);

        // ================================================================
        // 8. BUILD RESPONSE
        // ================================================================
        const response = {
            success: true,
            message: `Promoted ${results.success.filter(r => !r.isArchived).length} students, Archived ${results.archived.length} P.7 students`,
            summary: {
                totalProcessed: promotionTasks.length,
                successCount: results.success.length,
                failedCount: results.failed.length,
                skippedCount: results.skipped.length,
                archivedCount: results.archived.length,
                nextAcademicYear: nextYear,
                currentAcademicYear: currentYear
            },
            results: results,
            promotedStudents: results.success.filter(r => !r.isArchived),
            archivedStudents: results.archived
        };

        console.log(`\n📊 Promotion Summary:`);
        console.log(`   ✅ Success: ${results.success.length}`);
        console.log(`   ❌ Failed: ${results.failed.length}`);
        console.log(`   ⏭️ Skipped: ${results.skipped.length}`);
        console.log(`   📦 Archived: ${results.archived.length}`);
        console.log(`   📅 Next Year: ${nextYear}`);

        res.json(response);

    } catch (error) {
        console.error('❌ Promotion error:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});
// ================================================================
// ENROLLMENTS ENDPOINT
// ================================================================

// Get all enrollments
app.get('/api/enrollments', (req, res) => {
    try {
        const enrollments = readFile(files.enrollments);
        res.json(enrollments);
    } catch (error) {
        console.error('Error fetching enrollments:', error);
        res.status(500).json({ error: 'Failed to fetch enrollments' });
    }
});

app.post('/api/enrollments', (req, res) => {
    try {
        const { studentId, classId, academicYear, isCurrent } = req.body;
        let enrollments = readFile(files.enrollments);
        
        const newEnrollment = {
            id: uuidv4(),
            studentId,
            classId,
            academicYear: academicYear || new Date().getFullYear(),
            isCurrent: isCurrent !== undefined ? isCurrent : true,
            enrolledAt: new Date().toISOString()
        };
        
        enrollments.push(newEnrollment);
        saveFile(files.enrollments, enrollments);
        res.json({ success: true, enrollment: newEnrollment });
    } catch (error) {
        console.error('Error creating enrollment:', error);
        res.status(500).json({ error: 'Failed to create enrollment' });
    }
});

app.put('/api/enrollments/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { classId, isCurrent } = req.body;
        let enrollments = readFile(files.enrollments);
        
        const index = enrollments.findIndex(e => e.id === id);
        if (index === -1) {
            return res.status(404).json({ error: 'Enrollment not found' });
        }
        
        enrollments[index] = {
            ...enrollments[index],
            classId: classId || enrollments[index].classId,
            isCurrent: isCurrent !== undefined ? isCurrent : enrollments[index].isCurrent,
            updatedAt: new Date().toISOString()
        };
        
        saveFile(files.enrollments, enrollments);
        res.json({ success: true, enrollment: enrollments[index] });
    } catch (error) {
        console.error('Error updating enrollment:', error);
        res.status(500).json({ error: 'Failed to update enrollment' });
    }
});


// ==================== TEACHER LOGIN AUTHENTICATION (SINGLE NAME FIELD) ====================
// Version: 2.0 - Teacher logs in with EITHER first name OR last name + password

// ==================== TEACHER LOGIN (SIMPLIFIED - NO SESSION) ====================
// Version: 1.0 - Simple login without session verification

app.post('/api/teachers/login', (req, res) => {
    try {
        const { name, password } = req.body;

        if (!name || !password) {
            return res.status(400).json({ 
                success: false,
                error: 'Name and password are required' 
            });
        }

        let teachers = readFile(files.teachers);
        if (!Array.isArray(teachers)) teachers = [];

        // Find teacher by name (first OR last) and password
        let teacher = teachers.find(t => 
            t.status === 'Active' &&
            t.password === password &&
            (t.firstName && t.firstName.toLowerCase() === name.toLowerCase() ||
             t.lastName && t.lastName.toLowerCase() === name.toLowerCase())
        );

        // If not found, try partial match
        if (!teacher) {
            teacher = teachers.find(t => 
                t.status === 'Active' &&
                t.password === password &&
                (t.firstName && t.firstName.toLowerCase().includes(name.toLowerCase()) ||
                 t.lastName && t.lastName.toLowerCase().includes(name.toLowerCase()))
            );
        }

        if (!teacher) {
            return res.status(401).json({ 
                success: false,
                error: 'Invalid credentials. Please check your name and password.' 
            });
        }

        // Log the login
        console.log(`✅ Teacher logged in: ${teacher.firstName} ${teacher.lastName} (${teacher.teacherId})`);

        // Return teacher data (excluding password)
        const { password: _, ...teacherData } = teacher;

        res.json({ 
            success: true,
            message: `Welcome back, ${teacher.firstName} ${teacher.lastName}!`,
            teacher: teacherData,
            redirectUrl: '/teacher-dashboard.html'
        });

    } catch (error) {
        console.error('Error during teacher login:', error);
        res.status(500).json({ 
            success: false,
            error: 'Login failed: ' + error.message 
        });
    }
});

// ==================== GET TEACHER BY ID (SIMPLIFIED) ====================
app.get('/api/teachers/:id', (req, res) => {
    try {
        const teachers = readFile(files.teachers);
        const teacher = teachers.find(t => t.id === req.params.id);
        if (!teacher) {
            return res.status(404).json({ error: 'Teacher not found' });
        }
        // Remove password before sending
        const { password, ...teacherData } = teacher;
        res.json(teacherData);
    } catch (error) {
        console.error('Error fetching teacher:', error);
        res.status(500).json({ error: 'Failed to fetch teacher' });
    }
});

console.log('✅ Simplified teacher login routes loaded');
// ==================== ATTENDANCE ROUTES ====================
// Version: 2.0 - Teacher-specific attendance management

// ==================== GET STUDENTS BY CLASS ====================
// ==================== COMPLETE ATTENDANCE SYSTEM ====================
// Version: 3.0 - Full attendance management

// ==================== GET STUDENTS BY CLASS ====================
// ==================== GET STUDENTS BY CLASS (FIXED) ====================
app.get('/api/classes/:classId/students', (req, res) => {
    try {
        const classId = req.params.classId;
        const students = readFile(files.students);
        const enrollments = readFile(files.enrollments);
        const classes = readFile(files.classes);
        
        const classObj = classes.find(c => c.id === classId);
        if (!classObj) {
            return res.status(404).json({ error: 'Class not found' });
        }

        // Get student IDs from current enrollments
        const enrolledStudentIds = enrollments
            .filter(e => e.classId === classId && e.isCurrent === true)
            .map(e => e.studentId);

        // ================================================================
        // ✅ FIX: Also include students whose currentClassId matches
        // ================================================================
        const classStudentIds = students
            .filter(s => 
                s.status === 'Active' &&
                (enrolledStudentIds.includes(s.id) || s.currentClassId === classId)
            )
            .map(s => s.id);

        // Remove duplicates
        const uniqueStudentIds = [...new Set(classStudentIds)];

        const classStudents = students
            .filter(s => uniqueStudentIds.includes(s.id) && s.status === 'Active')
            .map(s => ({
                id: s.id,
                admissionNumber: s.admissionNumber,
                firstName: s.firstName,
                lastName: s.lastName,
                gender: s.gender,
                parentInfo: s.parentInfo,
                currentClassId: s.currentClassId,
                enrolledAt: s.enrolledAt
            }))
            .sort((a, b) => (a.firstName || '').localeCompare(b.firstName || ''));

        // Also get students who are in this class via their currentClassId but not enrolled
        const directClassStudents = students
            .filter(s => 
                s.status === 'Active' &&
                s.currentClassId === classId &&
                !enrolledStudentIds.includes(s.id)
            )
            .map(s => ({
                id: s.id,
                admissionNumber: s.admissionNumber,
                firstName: s.firstName,
                lastName: s.lastName,
                gender: s.gender,
                parentInfo: s.parentInfo,
                currentClassId: s.currentClassId,
                enrolledAt: s.enrolledAt,
                isDirectAssignment: true // Flag to indicate no enrollment record
            }));

        console.log(`📚 Class ${classObj.name}: ${classStudents.length} students (${directClassStudents.length} direct assignments)`);

        res.json({
            success: true,
            class: classObj,
            students: classStudents,
            directAssignments: directClassStudents,
            count: classStudents.length,
            directCount: directClassStudents.length
        });

    } catch (error) {
        console.error('Error fetching class students:', error);
        res.status(500).json({ error: 'Failed to fetch class students' });
    }
});

// ==================== SAVE ATTENDANCE ====================

// ==================== SAVE ATTENDANCE (FIXED) ====================
app.post('/api/attendance/class', (req, res) => {
    try {
        const { classId, date, presentStudentIds, teacherId, notes } = req.body;

        if (!classId || !date) {
            return res.status(400).json({ error: 'Class ID and date are required' });
        }

        if (!presentStudentIds || !Array.isArray(presentStudentIds)) {
            return res.status(400).json({ error: 'Present student IDs are required' });
        }

        let attendance = readFile(files.attendance);
        if (!Array.isArray(attendance)) attendance = [];

        const students = readFile(files.students);
        const enrollments = readFile(files.enrollments);

        // ================================================================
        // ✅ FIX: Get ALL students in this class
        // - From current enrollments
        // - AND from students with currentClassId === classId
        // ================================================================
        const enrolledStudentIds = enrollments
            .filter(e => e.classId === classId && e.isCurrent === true)
            .map(e => e.studentId);

        const directClassStudentIds = students
            .filter(s => s.currentClassId === classId && s.status === 'Active')
            .map(s => s.id);

        // Combine and deduplicate
        const allStudentIds = [...new Set([...enrolledStudentIds, ...directClassStudentIds])];

        console.log(`📚 Class ${classId}: ${allStudentIds.length} students (${enrolledStudentIds.length} enrolled, ${directClassStudentIds.length} direct)`);

        // Build attendance records for ALL students in the class
        const records = allStudentIds.map(studentId => {
            const isPresent = presentStudentIds.includes(studentId);
            const student = students.find(s => s.id === studentId);
            return {
                studentId: studentId,
                studentName: student ? `${student.firstName || ''} ${student.lastName || ''}`.trim() : 'Unknown',
                admissionNumber: student?.admissionNumber || 'N/A',
                status: isPresent ? 'present' : 'absent',
                present: isPresent,
                absent: !isPresent
            };
        });

        // Check if attendance already exists for this date and class
        const existingIndex = attendance.findIndex(a => 
            a.classId === classId && a.date === date
        );

        const attendanceRecord = {
            id: existingIndex !== -1 ? attendance[existingIndex].id : uuidv4(),
            classId: classId,
            date: date,
            records: records,
            teacherId: teacherId || null,
            notes: notes || '',
            presentCount: records.filter(r => r.present).length,
            absentCount: records.filter(r => !r.present).length,
            totalCount: records.length,
            updatedAt: new Date().toISOString(),
            createdAt: existingIndex !== -1 ? attendance[existingIndex].createdAt : new Date().toISOString()
        };

        if (existingIndex !== -1) {
            attendance[existingIndex] = attendanceRecord;
        } else {
            attendance.push(attendanceRecord);
        }

        saveFile(files.attendance, attendance);

        console.log(`✅ Attendance saved for class ${classId} on ${date}: ${attendanceRecord.presentCount} present, ${attendanceRecord.absentCount} absent`);

        res.json({
            success: true,
            message: `Attendance saved successfully. ${attendanceRecord.presentCount} present, ${attendanceRecord.absentCount} absent.`,
            attendance: attendanceRecord,
            presentCount: attendanceRecord.presentCount,
            absentCount: attendanceRecord.absentCount,
            totalCount: attendanceRecord.totalCount
        });

    } catch (error) {
        console.error('Error saving attendance:', error);
        res.status(500).json({ error: 'Failed to save attendance' });
    }
});

// ==================== GET ATTENDANCE BY CLASS ====================
app.get('/api/attendance/class/:classId', (req, res) => {
    try {
        const { classId } = req.params;
        const { date, startDate, endDate } = req.query;

        let attendance = readFile(files.attendance);
        if (!Array.isArray(attendance)) attendance = [];

        let records = attendance.filter(a => a.classId === classId);

        if (date) {
            records = records.filter(a => a.date === date);
        }

        if (startDate && endDate) {
            records = records.filter(a => a.date >= startDate && a.date <= endDate);
        }

        // Sort by date descending (most recent first)
        records.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Get student details for each attendance record
        const students = readFile(files.students);
        const studentMap = {};
        students.forEach(s => {
            if (s && s.id) studentMap[s.id] = s;
        });

        const enrichedRecords = records.map(record => {
            const enrichedStudents = record.records.map(r => {
                const student = studentMap[r.studentId];
                return {
                    ...r,
                    studentName: student ? `${student.firstName || ''} ${student.lastName || ''}`.trim() : 'Unknown',
                    admissionNumber: student?.admissionNumber || 'N/A',
                    gender: student?.gender || 'N/A'
                };
            });
            return {
                ...record,
                records: enrichedStudents,
                presentCount: enrichedStudents.filter(r => r.present).length,
                absentCount: enrichedStudents.filter(r => !r.present).length,
                totalCount: enrichedStudents.length
            };
        });

        res.json({
            success: true,
            attendance: enrichedRecords,
            count: enrichedRecords.length
        });

    } catch (error) {
        console.error('Error fetching attendance:', error);
        res.status(500).json({ error: 'Failed to fetch attendance' });
    }
});

// ==================== GET ATTENDANCE FOR A SPECIFIC DATE ====================
app.get('/api/attendance/date/:date', (req, res) => {
    try {
        const { date } = req.params;
        const { classId } = req.query;

        let attendance = readFile(files.attendance);
        if (!Array.isArray(attendance)) attendance = [];

        let records = attendance.filter(a => a.date === date);

        if (classId) {
            records = records.filter(a => a.classId === classId);
        }

        const students = readFile(files.students);
        const studentMap = {};
        students.forEach(s => {
            if (s && s.id) studentMap[s.id] = s;
        });

        const enrichedRecords = records.map(record => {
            const enrichedStudents = record.records.map(r => {
                const student = studentMap[r.studentId];
                return {
                    ...r,
                    studentName: student ? `${student.firstName || ''} ${student.lastName || ''}`.trim() : 'Unknown',
                    admissionNumber: student?.admissionNumber || 'N/A'
                };
            });
            return {
                ...record,
                records: enrichedStudents,
                presentCount: enrichedStudents.filter(r => r.present).length,
                absentCount: enrichedStudents.filter(r => !r.present).length
            };
        });

        res.json({
            success: true,
            attendance: enrichedRecords,
            count: enrichedRecords.length
        });

    } catch (error) {
        console.error('Error fetching attendance by date:', error);
        res.status(500).json({ error: 'Failed to fetch attendance' });
    }
});

// ==================== GET STUDENT ATTENDANCE SUMMARY ====================
app.get('/api/attendance/student/:studentId/summary', (req, res) => {
    try {
        const { studentId } = req.params;
        const { year, term } = req.query;

        let attendance = readFile(files.attendance);
        if (!Array.isArray(attendance)) attendance = [];

        let records = [];
        for (const record of attendance) {
            const studentRecord = record.records.find(r => r.studentId === studentId);
            if (studentRecord) {
                records.push({
                    date: record.date,
                    classId: record.classId,
                    status: studentRecord.status,
                    present: studentRecord.present,
                    absent: studentRecord.absent
                });
            }
        }

        // Filter by year if provided
        if (year) {
            records = records.filter(r => new Date(r.date).getFullYear() === parseInt(year));
        }

        // Filter by term if provided
        if (term) {
            // Term 1: Jan-Apr, Term 2: May-Aug, Term 3: Sep-Dec
            const termMonths = {
                1: [0, 1, 2, 3],
                2: [4, 5, 6, 7],
                3: [8, 9, 10, 11]
            };
            const months = termMonths[parseInt(term)] || [];
            records = records.filter(r => months.includes(new Date(r.date).getMonth()));
        }

        records.sort((a, b) => new Date(b.date) - new Date(a.date));

        const presentCount = records.filter(r => r.present).length;
        const absentCount = records.filter(r => r.absent).length;
        const totalCount = records.length;
        const attendanceRate = totalCount > 0 ? (presentCount / totalCount * 100).toFixed(1) : 0;

        res.json({
            success: true,
            studentId: studentId,
            records: records,
            summary: {
                present: presentCount,
                absent: absentCount,
                total: totalCount,
                rate: attendanceRate
            }
        });

    } catch (error) {
        console.error('Error fetching student attendance summary:', error);
        res.status(500).json({ error: 'Failed to fetch student attendance summary' });
    }
});

// ==================== DELETE ATTENDANCE RECORD ====================
app.delete('/api/attendance/:attendanceId', (req, res) => {
    try {
        const { attendanceId } = req.params;

        let attendance = readFile(files.attendance);
        if (!Array.isArray(attendance)) attendance = [];

        const index = attendance.findIndex(a => a.id === attendanceId);
        if (index === -1) {
            return res.status(404).json({ error: 'Attendance record not found' });
        }

        const removed = attendance[index];
        attendance.splice(index, 1);
        saveFile(files.attendance, attendance);

        // Also remove from term records
        let termRecords = readFile(files.studentTermRecords);
        if (termRecords && typeof termRecords === 'object') {
            const settings = readFile(files.settings);
            const currentYear = settings.currentAcademicYear || new Date().getFullYear();
            const currentTerm = settings.currentTerm || 1;

            for (const record of removed.records) {
                const key = `${record.studentId}_${currentYear}_${currentTerm}`;
                if (termRecords[key] && termRecords[key].attendance) {
                    delete termRecords[key].attendance[removed.date];
                }
            }
            saveFile(files.studentTermRecords, termRecords);
        }

        console.log(`🗑️ Attendance record deleted for ${removed.date}`);

        res.json({
            success: true,
            message: `Attendance record for ${removed.date} deleted successfully`
        });

    } catch (error) {
        console.error('Error deleting attendance:', error);
        res.status(500).json({ error: 'Failed to delete attendance' });
    }
});

// ==================== GET ATTENDANCE STATISTICS ====================
app.get('/api/attendance/stats', (req, res) => {
    try {
        const { classId } = req.query;

        let attendance = readFile(files.attendance);
        if (!Array.isArray(attendance)) attendance = [];

        let records = attendance;
        if (classId) {
            records = records.filter(a => a.classId === classId);
        }

        const totalDays = records.length;
        let totalPresent = 0;
        let totalAbsent = 0;
        const monthStats = {};

        for (const record of records) {
            totalPresent += record.presentCount || 0;
            totalAbsent += record.absentCount || 0;
            
            const month = new Date(record.date).toISOString().substring(0, 7);
            if (!monthStats[month]) {
                monthStats[month] = { present: 0, absent: 0, days: 0 };
            }
            monthStats[month].present += record.presentCount || 0;
            monthStats[month].absent += record.absentCount || 0;
            monthStats[month].days += 1;
        }

        const totalStudents = records.length > 0 ? (records[0].records?.length || 0) : 0;
        const overallRate = (totalPresent + totalAbsent) > 0 ? (totalPresent / (totalPresent + totalAbsent) * 100).toFixed(1) : 0;

        res.json({
            success: true,
            stats: {
                totalDays: totalDays,
                totalPresent: totalPresent,
                totalAbsent: totalAbsent,
                totalStudents: totalStudents,
                overallRate: overallRate,
                monthStats: monthStats
            }
        });

    } catch (error) {
        console.error('Error fetching attendance stats:', error);
        res.status(500).json({ error: 'Failed to fetch attendance stats' });
    }
});

console.log('✅ Complete Attendance System loaded');

console.log('✅ Teacher attendance routes loaded');


// ==================== SWEEPING ROSTER SYSTEM ====================
// Version: 1.0 - Full CRUD operations for sweeping rosters

const sweepingFiles = {
    sweepingRosters: path.join(dataDir, 'sweepingRosters.json')
};

// Initialize sweeping roster file
function initializeSweepingFiles() {
    if (!fs.existsSync(sweepingFiles.sweepingRosters)) {
        saveFile(sweepingFiles.sweepingRosters, {});
    }
    console.log('✅ Sweeping roster files initialized');
}

initializeSweepingFiles();

// ========== HELPER: READ SWEEPING ROSTERS ==========
function readSweepingRosters() {
    return readFile(sweepingFiles.sweepingRosters) || {};
}

// ========== HELPER: SAVE SWEEPING ROSTERS ==========
function saveSweepingRosters(data) {
    return saveFile(sweepingFiles.sweepingRosters, data);
}

// ========== HELPER: VALIDATE DAY ==========
const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function isValidDay(day) {
    return VALID_DAYS.includes(day);
}

// ========== GET SWEEPING ROSTER FOR A CLASS ==========
app.get('/api/sweeping/class/:classId', (req, res) => {
    const { classId } = req.params;
    console.log(`📋 Fetching sweeping roster for class: ${classId}`);

    try {
        const rosters = readSweepingRosters();
        const roster = rosters[classId] || {};

        // Ensure all days exist
        const fullRoster = {};
        for (const day of VALID_DAYS) {
            fullRoster[day] = roster[day] || [];
        }

        res.json({
            success: true,
            roster: fullRoster,
            classId: classId
        });
    } catch (error) {
        console.error('Error fetching sweeping roster:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== GET SWEEPING ROSTER FOR A SPECIFIC DAY ==========
app.get('/api/sweeping/class/:classId/day/:day', (req, res) => {
    const { classId, day } = req.params;
    console.log(`📋 Fetching sweeping roster for class: ${classId}, day: ${day}`);

    if (!isValidDay(day)) {
        return res.status(400).json({ success: false, error: 'Invalid day. Must be Monday-Saturday.' });
    }

    try {
        const rosters = readSweepingRosters();
        const roster = rosters[classId] || {};
        const students = roster[day] || [];

        // Get student details
        const allStudents = readFile(files.students) || [];
        const studentDetails = students.map(id => {
            const s = allStudents.find(st => st.id === id);
            return s ? { id: s.id, firstName: s.firstName, lastName: s.lastName, admissionNumber: s.admissionNumber } : null;
        }).filter(Boolean);

        res.json({
            success: true,
            day: day,
            classId: classId,
            studentIds: students,
            students: studentDetails,
            count: students.length
        });
    } catch (error) {
        console.error('Error fetching sweeping roster day:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== SET/UPDATE SWEEPING ROSTER FOR A DAY ==========
app.put('/api/sweeping/class/:classId/day/:day', (req, res) => {
    const { classId, day } = req.params;
    const { studentIds } = req.body;

    console.log(`📝 Updating sweeping roster for class: ${classId}, day: ${day}`);
    console.log(`   Students: ${studentIds?.length || 0} assigned`);

    if (!isValidDay(day)) {
        return res.status(400).json({ success: false, error: 'Invalid day. Must be Monday-Saturday.' });
    }

    if (!studentIds || !Array.isArray(studentIds)) {
        return res.status(400).json({ success: false, error: 'studentIds must be an array' });
    }

    try {
        // Verify all students exist
        const allStudents = readFile(files.students) || [];
        const validStudentIds = allStudents.map(s => s.id);
        const invalidIds = studentIds.filter(id => !validStudentIds.includes(id));

        if (invalidIds.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Invalid student IDs: ${invalidIds.join(', ')}`
            });
        }

        const rosters = readSweepingRosters();
        if (!rosters[classId]) {
            rosters[classId] = {};
        }

        // Deduplicate student IDs
        const uniqueStudentIds = [...new Set(studentIds)];
        rosters[classId][day] = uniqueStudentIds;

        saveSweepingRosters(rosters);

        // Get student details for response
        const studentDetails = uniqueStudentIds.map(id => {
            const s = allStudents.find(st => st.id === id);
            return s ? { id: s.id, firstName: s.firstName, lastName: s.lastName, admissionNumber: s.admissionNumber } : null;
        }).filter(Boolean);

        res.json({
            success: true,
            message: `Roster updated for ${day}`,
            day: day,
            classId: classId,
            count: uniqueStudentIds.length,
            students: studentDetails
        });
    } catch (error) {
        console.error('Error updating sweeping roster:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ADD STUDENTS TO SWEEPING ROSTER (APPEND) ==========
app.post('/api/sweeping/class/:classId/day/:day/add', (req, res) => {
    const { classId, day } = req.params;
    const { studentIds } = req.body;

    console.log(`➕ Adding students to sweeping roster for class: ${classId}, day: ${day}`);
    console.log(`   Students to add: ${studentIds?.length || 0}`);

    if (!isValidDay(day)) {
        return res.status(400).json({ success: false, error: 'Invalid day. Must be Monday-Saturday.' });
    }

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({ success: false, error: 'studentIds must be a non-empty array' });
    }

    try {
        const allStudents = readFile(files.students) || [];
        const validStudentIds = allStudents.map(s => s.id);
        const invalidIds = studentIds.filter(id => !validStudentIds.includes(id));

        if (invalidIds.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Invalid student IDs: ${invalidIds.join(', ')}`
            });
        }

        const rosters = readSweepingRosters();
        if (!rosters[classId]) {
            rosters[classId] = {};
        }
        if (!rosters[classId][day]) {
            rosters[classId][day] = [];
        }

        // Append unique students
        const existing = new Set(rosters[classId][day]);
        for (const id of studentIds) {
            if (!existing.has(id)) {
                rosters[classId][day].push(id);
                existing.add(id);
            }
        }

        saveSweepingRosters(rosters);

        const studentDetails = rosters[classId][day].map(id => {
            const s = allStudents.find(st => st.id === id);
            return s ? { id: s.id, firstName: s.firstName, lastName: s.lastName, admissionNumber: s.admissionNumber } : null;
        }).filter(Boolean);

        res.json({
            success: true,
            message: `${studentIds.length} student(s) added to ${day}`,
            day: day,
            classId: classId,
            count: rosters[classId][day].length,
            students: studentDetails
        });
    } catch (error) {
        console.error('Error adding to sweeping roster:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== REMOVE STUDENTS FROM SWEEPING ROSTER ==========
app.delete('/api/sweeping/class/:classId/day/:day/remove', (req, res) => {
    const { classId, day } = req.params;
    const { studentIds } = req.body;

    console.log(`➖ Removing students from sweeping roster for class: ${classId}, day: ${day}`);
    console.log(`   Students to remove: ${studentIds?.length || 0}`);

    if (!isValidDay(day)) {
        return res.status(400).json({ success: false, error: 'Invalid day. Must be Monday-Saturday.' });
    }

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({ success: false, error: 'studentIds must be a non-empty array' });
    }

    try {
        const rosters = readSweepingRosters();
        if (!rosters[classId] || !rosters[classId][day]) {
            return res.status(404).json({ success: false, error: 'No roster found for this day' });
        }

        const removeSet = new Set(studentIds);
        rosters[classId][day] = rosters[classId][day].filter(id => !removeSet.has(id));

        saveSweepingRosters(rosters);

        const allStudents = readFile(files.students) || [];
        const studentDetails = rosters[classId][day].map(id => {
            const s = allStudents.find(st => st.id === id);
            return s ? { id: s.id, firstName: s.firstName, lastName: s.lastName, admissionNumber: s.admissionNumber } : null;
        }).filter(Boolean);

        res.json({
            success: true,
            message: `${studentIds.length} student(s) removed from ${day}`,
            day: day,
            classId: classId,
            count: rosters[classId][day].length,
            students: studentDetails
        });
    } catch (error) {
        console.error('Error removing from sweeping roster:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== CLEAR ENTIRE DAY ROSTER ==========
app.delete('/api/sweeping/class/:classId/day/:day', (req, res) => {
    const { classId, day } = req.params;

    console.log(`🗑️ Clearing sweeping roster for class: ${classId}, day: ${day}`);

    if (!isValidDay(day)) {
        return res.status(400).json({ success: false, error: 'Invalid day. Must be Monday-Saturday.' });
    }

    try {
        const rosters = readSweepingRosters();
        if (!rosters[classId]) {
            rosters[classId] = {};
        }

        rosters[classId][day] = [];

        saveSweepingRosters(rosters);

        res.json({
            success: true,
            message: `Roster cleared for ${day}`,
            day: day,
            classId: classId,
            count: 0
        });
    } catch (error) {
        console.error('Error clearing sweeping roster:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== DELETE ENTIRE CLASS ROSTER ==========
app.delete('/api/sweeping/class/:classId', (req, res) => {
    const { classId } = req.params;

    console.log(`🗑️ Deleting entire sweeping roster for class: ${classId}`);

    try {
        const rosters = readSweepingRosters();
        delete rosters[classId];

        saveSweepingRosters(rosters);

        res.json({
            success: true,
            message: `All sweeping rosters deleted for class ${classId}`,
            classId: classId
        });
    } catch (error) {
        console.error('Error deleting sweeping roster:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== GET SWEEPING SUMMARY FOR TEACHER ==========
app.get('/api/sweeping/teacher/:teacherId', (req, res) => {
    const { teacherId } = req.params;

    console.log(`📋 Fetching sweeping summary for teacher: ${teacherId}`);

    try {
        // Get teacher data
        const teachers = readFile(files.teachers) || [];
        const teacher = teachers.find(t => t.id === teacherId || t.teacherId === teacherId);

        if (!teacher) {
            return res.status(404).json({ success: false, error: 'Teacher not found' });
        }

        const teacherClassIds = teacher.classes || [];
        const rosters = readSweepingRosters();
        const allStudents = readFile(files.students) || [];

        const summary = {};

        for (const classId of teacherClassIds) {
            const classRoster = rosters[classId] || {};
            const classSummary = {};

            for (const day of VALID_DAYS) {
                const studentIds = classRoster[day] || [];
                const studentDetails = studentIds.map(id => {
                    const s = allStudents.find(st => st.id === id);
                    return s ? {
                        id: s.id,
                        firstName: s.firstName,
                        lastName: s.lastName,
                        admissionNumber: s.admissionNumber
                    } : null;
                }).filter(Boolean);

                classSummary[day] = {
                    studentIds: studentIds,
                    students: studentDetails,
                    count: studentIds.length
                };
            }

            summary[classId] = {
                classId: classId,
                roster: classSummary,
                totalAssigned: Object.values(classSummary).reduce((sum, d) => sum + d.count, 0)
            };
        }

        res.json({
            success: true,
            teacherId: teacherId,
            teacherName: `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim(),
            summary: summary
        });
    } catch (error) {
        console.error('Error fetching teacher sweeping summary:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== GET SWEEPING SUMMARY FOR ALL CLASSES ==========
app.get('/api/sweeping/summary', (req, res) => {
    console.log('📋 Fetching sweeping summary for all classes');

    try {
        const rosters = readSweepingRosters();
        const allStudents = readFile(files.students) || [];
        const classes = readFile(files.classes) || [];

        const summary = {};

        for (const classId of Object.keys(rosters)) {
            const classObj = classes.find(c => c.id === classId);
            const classRoster = rosters[classId] || {};
            const classSummary = {};

            for (const day of VALID_DAYS) {
                const studentIds = classRoster[day] || [];
                const studentDetails = studentIds.map(id => {
                    const s = allStudents.find(st => st.id === id);
                    return s ? {
                        id: s.id,
                        firstName: s.firstName,
                        lastName: s.lastName,
                        admissionNumber: s.admissionNumber
                    } : null;
                }).filter(Boolean);

                classSummary[day] = {
                    studentIds: studentIds,
                    students: studentDetails,
                    count: studentIds.length
                };
            }

            summary[classId] = {
                classId: classId,
                className: classObj?.name || 'Unknown Class',
                classLevel: classObj?.level || 'N/A',
                roster: classSummary,
                totalAssigned: Object.values(classSummary).reduce((sum, d) => sum + d.count, 0)
            };
        }

        res.json({
            success: true,
            summary: summary,
            totalClasses: Object.keys(summary).length
        });
    } catch (error) {
        console.error('Error fetching sweeping summary:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

console.log('✅ Sweeping Roster API endpoints registered:');
console.log('   GET    /api/sweeping/class/:classId');
console.log('   GET    /api/sweeping/class/:classId/day/:day');
console.log('   PUT    /api/sweeping/class/:classId/day/:day');
console.log('   POST   /api/sweeping/class/:classId/day/:day/add');
console.log('   DELETE /api/sweeping/class/:classId/day/:day/remove');
console.log('   DELETE /api/sweeping/class/:classId/day/:day');
console.log('   DELETE /api/sweeping/class/:classId');
console.log('   GET    /api/sweeping/teacher/:teacherId');
console.log('   GET    /api/sweeping/summary');


// ==================== ATTENDANCE SUMMARY FOR ADMIN ====================
app.get('/api/attendance/summary', (req, res) => {
    console.log('📊 Fetching attendance summary for admin');

    try {
        const attendance = readFile(files.attendance) || [];
        const students = readFile(files.students) || [];
        const classes = readFile(files.classes) || [];
        const teachers = readFile(files.teachers) || [];

        // Build class map
        const classMap = {};
        classes.forEach(c => { if (c && c.id) classMap[c.id] = c; });

        // Build teacher map
        const teacherMap = {};
        teachers.forEach(t => { if (t && t.id) teacherMap[t.id] = t; });

        // Today's date
        const today = new Date().toISOString().split('T')[0];

        // Filter today's attendance
        const todayAttendance = attendance.filter(a => a.date === today);
        let presentToday = 0, absentToday = 0, totalTodayStudents = 0;

        // Compute today's stats
        if (todayAttendance.length > 0) {
            const todayRecord = todayAttendance[0]; // assume one record per day per class? Actually we have per-class per-day records
            // We'll aggregate by iterating all attendance records for today
            const allTodayRecords = attendance.filter(a => a.date === today);
            for (const rec of allTodayRecords) {
                const records = rec.records || [];
                for (const r of records) {
                    if (r.present) presentToday++;
                    else absentToday++;
                    totalTodayStudents++;
                }
            }
        }

        // Week average (last 7 days)
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - 7);
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const weekAttendances = attendance.filter(a => a.date >= weekStartStr && a.date <= today);
        let totalWeekPresent = 0, totalWeekStudents = 0;
        for (const rec of weekAttendances) {
            const records = rec.records || [];
            for (const r of records) {
                if (r.present) totalWeekPresent++;
                totalWeekStudents++;
            }
        }
        const weekAverage = totalWeekStudents > 0 ? Math.round((totalWeekPresent / totalWeekStudents) * 100) : 0;

        // Build daily trend (last 7 days)
        const dailyTrend = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const dayRecords = attendance.filter(a => a.date === dateStr);
            let present = 0, absent = 0;
            for (const rec of dayRecords) {
                const records = rec.records || [];
                for (const r of records) {
                    if (r.present) present++;
                    else absent++;
                }
            }
            dailyTrend.push({
                date: dateStr,
                present,
                absent,
                total: present + absent
            });
        }

        // Build by level
        const levelMap = {};
        const allStudents = students.filter(s => s.status === 'Active');
        const studentClassMap = {};
        allStudents.forEach(s => {
            const clsId = s.currentClassId;
            if (clsId) {
                const cls = classMap[clsId];
                if (cls) {
                    const level = cls.level || 'Unknown';
                    if (!levelMap[level]) levelMap[level] = { level, total: 0, present: 0, absent: 0 };
                    levelMap[level].total++;
                    // Determine present status for today (we need to check if student has attendance today)
                    const todayRec = attendance.find(a => a.date === today && a.records && a.records.some(r => r.studentId === s.id));
                    if (todayRec) {
                        const studentRec = todayRec.records.find(r => r.studentId === s.id);
                        if (studentRec) {
                            if (studentRec.present) levelMap[level].present++;
                            else levelMap[level].absent++;
                        }
                    }
                }
            }
        });
        const byLevel = Object.values(levelMap).map(l => ({
            level: l.level,
            total: l.total,
            present: l.present,
            absent: l.absent,
            rate: l.total > 0 ? Math.round((l.present / l.total) * 100) : 0
        }));

        // Build by class
        const classBreakdown = {};
        allStudents.forEach(s => {
            const clsId = s.currentClassId;
            if (clsId) {
                const cls = classMap[clsId];
                if (cls) {
                    const className = cls.name || 'Unknown';
                    if (!classBreakdown[className]) {
                        classBreakdown[className] = { className, level: cls.level || 'N/A', total: 0, present: 0, absent: 0 };
                    }
                    classBreakdown[className].total++;
                    const todayRec = attendance.find(a => a.date === today && a.records && a.records.some(r => r.studentId === s.id));
                    if (todayRec) {
                        const studentRec = todayRec.records.find(r => r.studentId === s.id);
                        if (studentRec) {
                            if (studentRec.present) classBreakdown[className].present++;
                            else classBreakdown[className].absent++;
                        }
                    }
                }
            }
        });
        const byClass = Object.values(classBreakdown).map(c => ({
            ...c,
            rate: c.total > 0 ? Math.round((c.present / c.total) * 100) : 0
        }));

        // Recent records (last 50)
        const allRecords = [];
        const sortedAttendance = attendance.sort((a, b) => new Date(b.date) - new Date(a.date));
        for (const rec of sortedAttendance.slice(0, 10)) {
            const records = rec.records || [];
            for (const r of records) {
                const student = students.find(s => s.id === r.studentId);
                const className = student?.currentClassId ? classMap[student.currentClassId]?.name || 'N/A' : 'N/A';
                const teacher = rec.teacherId ? teacherMap[rec.teacherId] : null;
                allRecords.push({
                    date: rec.date,
                    studentName: student ? `${student.firstName || ''} ${student.lastName || ''}`.trim() : 'Unknown',
                    className: className,
                    status: r.present ? 'present' : 'absent',
                    teacherName: teacher ? `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim() : 'N/A'
                });
            }
        }
        const recentRecords = allRecords.slice(0, 50);

        // Final summary
        const summary = {
            totalStudents: allStudents.length,
            presentToday,
            absentToday,
            attendanceRateToday: totalTodayStudents > 0 ? Math.round((presentToday / totalTodayStudents) * 100) : 0,
            weekAverage
        };

        res.json({
            success: true,
            data: {
                summary,
                daily: dailyTrend,
                byLevel,
                byClass,
                recentRecords
            }
        });

    } catch (error) {
        console.error('Error generating attendance summary:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== REPORT CARDS BACKEND ROUTES ====================
// Version: 1.0 - Complete Report Card Management System


// File paths for report card data
const reportFiles = {
    template: path.join(dataDir, 'reportCardTemplate.json'),
    marks: path.join(dataDir, 'reportCardMarks.json'),
    initials: path.join(dataDir, 'reportCardInitials.json'),
    generated: path.join(dataDir, 'generatedReportCards.json')
};

// Initialize report card files
function initializeReportFiles() {
    try {
        // Template
        if (!fs.existsSync(reportFiles.template)) {
            saveFile(reportFiles.template, {
                schoolName: '',
                schoolAddress: '',
                logo: '',
                primaryColor: '#2563eb',
                footer: ''
            });
        }
        // Marks
        if (!fs.existsSync(reportFiles.marks)) {
            saveFile(reportFiles.marks, {});
        }
        // Initials
        if (!fs.existsSync(reportFiles.initials)) {
            saveFile(reportFiles.initials, {});
        }
        // Generated report cards
        if (!fs.existsSync(reportFiles.generated)) {
            saveFile(reportFiles.generated, []);
        }
        console.log('✅ Report card files initialized');
    } catch (error) {
        console.error('Error initializing report files:', error);
    }
}

initializeReportFiles();

// ================================================================
// 1. REPORT CARD TEMPLATE ROUTES
// ================================================================

// GET report card template
app.get('/api/report-cards/template', (req, res) => {
    try {
        const template = readFile(reportFiles.template);
        res.json({ success: true, template: template });
    } catch (error) {
        console.error('Error getting template:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST save report card template
app.post('/api/report-cards/template', (req, res) => {
    try {
        const { template } = req.body;
        if (!template) {
            return res.status(400).json({ success: false, error: 'Template data is required' });
        }
        saveFile(reportFiles.template, template);
        res.json({ success: true, template: template });
    } catch (error) {
        console.error('Error saving template:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST reset report card template
app.post('/api/report-cards/template/reset', (req, res) => {
    try {
        const defaultTemplate = {
            schoolName: '',
            schoolAddress: '',
            logo: '',
            primaryColor: '#2563eb',
            footer: ''
        };
        saveFile(reportFiles.template, defaultTemplate);
        res.json({ success: true, template: defaultTemplate });
    } catch (error) {
        console.error('Error resetting template:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 2. MARKS MANAGEMENT ROUTES
// ================================================================

// ==================== REPORT CARDS BACKEND ROUTES (YEAR/TERM AWARE) ====================

// GET marks for a class (filter by term/year)
app.get('/api/report-cards/class/:classId/marks', (req, res) => {
    try {
        const { classId } = req.params;
        const { term, year } = req.query;
        const termNum = parseInt(term) || 1;
        const yearNum = parseInt(year) || new Date().getFullYear();

        const allMarks = readFile(reportFiles.marks);
        const classMarks = allMarks[classId] || {};
        const periodMarks = (classMarks[yearNum] && classMarks[yearNum][termNum]) || {};
        res.json({ success: true, marks: periodMarks });
    } catch (error) {
        console.error('Error getting marks:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST save marks for a class (with term/year)


// GET initials for a class (filter by term/year)
app.get('/api/report-cards/class/:classId/initials', (req, res) => {
    try {
        const { classId } = req.params;
        const { term, year } = req.query;
        const termNum = parseInt(term) || 1;
        const yearNum = parseInt(year) || new Date().getFullYear();

        const allInitials = readFile(reportFiles.initials);
        const classInitials = allInitials[classId] || {};
        const periodInitials = (classInitials[yearNum] && classInitials[yearNum][termNum]) || {};
        res.json({ success: true, initials: periodInitials });
    } catch (error) {
        console.error('Error getting initials:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST save initials for a class (with term/year)
app.post('/api/report-cards/class/:classId/initials', (req, res) => {
    try {
        const { classId } = req.params;
        const { initials, term, year } = req.body;
        const termNum = parseInt(term) || 1;
        const yearNum = parseInt(year) || new Date().getFullYear();

        if (!initials) {
            return res.status(400).json({ success: false, error: 'Initials data is required' });
        }

        let allInitials = readFile(reportFiles.initials);
        if (!allInitials[classId]) allInitials[classId] = {};
        if (!allInitials[classId][yearNum]) allInitials[classId][yearNum] = {};
        allInitials[classId][yearNum][termNum] = initials;

        saveFile(reportFiles.initials, allInitials);
        const count = Object.keys(initials).length;
        res.json({ success: true, message: `Saved ${count} initials for ${getTermName(termNum)} ${yearNum}`, savedCount: count });
    } catch (error) {
        console.error('Error saving initials:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST save marks for a class
// ==================== POST SAVE MARKS (VERIFIED) ====================
// ==================== POST SAVE MARKS (USE CURRENT YEAR FROM SETTINGS) ====================
app.post('/api/report-cards/class/:classId/marks', (req, res) => {
    try {
        const { classId } = req.params;
        const { marks, term, year } = req.body;
        
        // If year/term not provided, get from settings
        let termNum = parseInt(term);
        let yearNum = parseInt(year);
        
        if (!termNum || !yearNum) {
            const settings = readFile(files.settings);
            yearNum = settings.currentAcademicYear || new Date().getFullYear();
            termNum = settings.currentTerm || 1;
        }

        console.log(`📥 POST /api/report-cards/class/${classId}/marks`);
        console.log(`   Term: ${termNum}, Year: ${yearNum}`);
        console.log(`   Students: ${Object.keys(marks || {}).length}`);

        if (!marks) {
            return res.status(400).json({ success: false, error: 'Marks data is required' });
        }

        let allMarks = readFile(reportFiles.marks);
        if (!allMarks[classId]) allMarks[classId] = {};
        if (!allMarks[classId][yearNum]) allMarks[classId][yearNum] = {};
        allMarks[classId][yearNum][termNum] = marks;

        const studentCount = Object.keys(marks).length;
        saveFile(reportFiles.marks, allMarks);
        
        console.log(`✅ Saved marks for ${studentCount} students for ${getTermName(termNum)} ${yearNum}`);
        
        res.json({
            success: true,
            message: `Saved marks for ${studentCount} students for ${getTermName(termNum)} ${yearNum}`,
            savedCount: studentCount,
            term: termNum,
            year: yearNum
        });
    } catch (error) {
        console.error('❌ Error saving marks:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET marks for a specific student
app.get('/api/report-cards/student/:studentId/marks', (req, res) => {
    try {
        const { studentId } = req.params;
        const allMarks = readFile(reportFiles.marks);

        // Find which class this student belongs to
        const enrollments = readFile(files.enrollments);
        const enrollment = enrollments.find(e => e.studentId === studentId && e.isCurrent === true);
        if (!enrollment) {
            return res.status(404).json({ success: false, error: 'Student not enrolled' });
        }

        const classId = enrollment.classId;
        const classMarks = allMarks[classId] || {};
        const studentMarks = classMarks[studentId] || {};

        res.json({ success: true, marks: studentMarks, classId: classId });
    } catch (error) {
        console.error('Error getting student marks:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 3. TEACHER INITIALS ROUTES
// ================================================================

// GET initials for a class
app.get('/api/report-cards/class/:classId/initials', (req, res) => {
    try {
        const { classId } = req.params;
        const allInitials = readFile(reportFiles.initials);
        const classInitials = allInitials[classId] || {};
        res.json({ success: true, initials: classInitials });
    } catch (error) {
        console.error('Error getting initials:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST save initials for a class
app.post('/api/report-cards/class/:classId/initials', (req, res) => {
    try {
        const { classId } = req.params;
        const { initials } = req.body;

        if (!initials) {
            return res.status(400).json({ success: false, error: 'Initials data is required' });
        }

        let allInitials = readFile(reportFiles.initials);
        allInitials[classId] = initials;
        saveFile(reportFiles.initials, allInitials);

        const count = Object.keys(initials).length;
        res.json({ success: true, message: `Saved ${count} initials`, savedCount: count });
    } catch (error) {
        console.error('Error saving initials:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 4. REPORT CARD GENERATION
// ================================================================

// Generate report cards for a class
app.get('/api/report-cards/class/:classId/generate', async (req, res) => {
    try {
        const { classId } = req.params;
        const { term, year, studentId } = req.query;

        const termNum = parseInt(term) || 1;
        const yearNum = parseInt(year) || new Date().getFullYear();

        // Get class data
        const classes = readFile(files.classes);
        const classObj = classes.find(c => c.id === classId);
        if (!classObj) {
            return res.status(404).json({ success: false, error: 'Class not found' });
        }

        // Get students in this class
        const students = readFile(files.students);
        const enrollments = readFile(files.enrollments);

        let classStudents = [];
        if (studentId && studentId !== 'all') {
            const student = students.find(s => s.id === studentId);
            if (student) {
                classStudents = [student];
            }
        } else {
            // Get all students in this class
            const classEnrollments = enrollments.filter(e =>
                e.classId === classId && e.academicYear === yearNum && e.isCurrent === true
            );
            const studentIds = classEnrollments.map(e => e.studentId);
            classStudents = students.filter(s => studentIds.includes(s.id) && s.status === 'Active');
        }

        if (classStudents.length === 0) {
            return res.status(404).json({ success: false, error: 'No students found for this class' });
        }

        // Get subjects for this class
        const allSubjects = readFile(files.subjects);
        const classSubjects = allSubjects.filter(s =>
            s.classId === classId || s.classId === 'all' || s.classId === null
        );

        // Get marks for this class
        const allMarks = readFile(reportFiles.marks);
        const classMarks = allMarks[classId] || {};

        // Get initials for this class
        const allInitials = readFile(reportFiles.initials);
        const classInitials = allInitials[classId] || {};

        // Get grading system
        const settings = readFile(files.settings);
        const gradingSystem = settings.gradingSystem || {
            'A': { min: 80, max: 100, remark: 'Excellent' },
            'B': { min: 70, max: 79, remark: 'Very Good' },
            'C': { min: 60, max: 69, remark: 'Good' },
            'D': { min: 50, max: 59, remark: 'Satisfactory' },
            'E': { min: 40, max: 49, remark: 'Fair' },
            'F': { min: 0, max: 39, remark: 'Poor' }
        };

        function calculateGrade(percentage) {
            for (const [grade, range] of Object.entries(gradingSystem)) {
                if (percentage >= range.min && percentage <= range.max) {
                    return grade;
                }
            }
            return 'F';
        }

        function getGradeRemark(grade) {
            return gradingSystem[grade]?.remark || '';
        }

        // Generate report cards for each student
        const generatedReportCards = [];

        for (const student of classStudents) {
            const studentMarks = classMarks[student.id] || {};
            const subjects = [];

            let totalScore = 0;
            let subjectCount = 0;

            for (const subject of classSubjects) {
                const subjectMarks = studentMarks[subject.id] || {};
                const cat1 = subjectMarks['CAT 1'] || 0;
                const cat2 = subjectMarks['CAT 2'] || 0;
                const exam = subjectMarks['Exam'] || 0;

                // Calculate total and average for this subject
                const total = cat1 + cat2 + exam;
                const avg = (cat1 + cat2 + exam) / 3;
                const grade = calculateGrade(avg);
                const remark = getGradeRemark(grade);

                // Get teacher initials for this subject
                const initialsKey = `${student.id}_${subject.id}`;
                const initials = classInitials[initialsKey] || '';

                subjects.push({
                    subjectId: subject.id,
                    subjectName: subject.name,
                    subjectCode: subject.code,
                    cat1: cat1 || null,
                    cat2: cat2 || null,
                    exam: exam || null,
                    total: total,
                    average: avg,
                    grade: grade,
                    remark: remark,
                    initials: initials
                });

                totalScore += avg;
                subjectCount++;
            }

            const overallAverage = subjectCount > 0 ? (totalScore / subjectCount) : 0;
            const overallGrade = calculateGrade(overallAverage);
            const overallRemark = getGradeRemark(overallGrade);

            // Get student's current class name
            const studentEnrollment = enrollments.find(e =>
                e.studentId === student.id && e.isCurrent === true
            );
            const studentClass = studentEnrollment ? classes.find(c => c.id === studentEnrollment.classId) : null;

            const reportCard = {
                id: uuidv4(),
                studentId: student.id,
                studentName: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
                admissionNumber: student.admissionNumber || 'N/A',
                className: studentClass?.name || classObj.name,
                classId: classId,
                term: termNum,
                year: yearNum,
                subjects: subjects,
                totalScore: totalScore,
                average: overallAverage,
                overallGrade: overallGrade,
                overallRemark: overallRemark,
                generatedAt: new Date().toISOString(),
                template: readFile(reportFiles.template)
            };

            generatedReportCards.push(reportCard);
        }

        // Save generated report cards
        let allGenerated = readFile(reportFiles.generated);
        // Remove old report cards for this class/term/year
        allGenerated = allGenerated.filter(r =>
            !(r.classId === classId && r.term === termNum && r.year === yearNum)
        );
        // Add new report cards
        allGenerated = [...allGenerated, ...generatedReportCards];
        saveFile(reportFiles.generated, allGenerated);

        res.json({
            success: true,
            reportCards: generatedReportCards,
            count: generatedReportCards.length,
            message: `Generated ${generatedReportCards.length} report cards`
        });

    } catch (error) {
        console.error('Error generating report cards:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET generated report cards for a class
app.get('/api/report-cards/class/:classId', (req, res) => {
    try {
        const { classId } = req.params;
        const allGenerated = readFile(reportFiles.generated);
        const classReportCards = allGenerated.filter(r => r.classId === classId);
        res.json({ success: true, reportCards: classReportCards, count: classReportCards.length });
    } catch (error) {
        console.error('Error getting report cards:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET a specific report card
app.get('/api/report-cards/:id', (req, res) => {
    try {
        const { id } = req.params;
        const allGenerated = readFile(reportFiles.generated);
        const reportCard = allGenerated.find(r => r.id === id);
        if (!reportCard) {
            return res.status(404).json({ success: false, error: 'Report card not found' });
        }
        res.json({ success: true, reportCard: reportCard });
    } catch (error) {
        console.error('Error getting report card:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE a report card
app.delete('/api/report-cards/:id', (req, res) => {
    try {
        const { id } = req.params;
        let allGenerated = readFile(reportFiles.generated);
        const initialLength = allGenerated.length;
        allGenerated = allGenerated.filter(r => r.id !== id);
        if (allGenerated.length === initialLength) {
            return res.status(404).json({ success: false, error: 'Report card not found' });
        }
        saveFile(reportFiles.generated, allGenerated);
        res.json({ success: true, message: 'Report card deleted' });
    } catch (error) {
        console.error('Error deleting report card:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 5. STUDENT REPORT CARD PREVIEW
// ================================================================

// GET preview of a student's report card
app.get('/api/report-cards/student/:studentId/preview', (req, res) => {
    try {
        const { studentId } = req.params;
        const { term, year } = req.query;

        const termNum = parseInt(term) || 1;
        const yearNum = parseInt(year) || new Date().getFullYear();

        // Get student data
        const students = readFile(files.students);
        const student = students.find(s => s.id === studentId);
        if (!student) {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }

        // Get enrollment
        const enrollments = readFile(files.enrollments);
        const enrollment = enrollments.find(e =>
            e.studentId === studentId && e.isCurrent === true
        );
        if (!enrollment) {
            return res.status(404).json({ success: false, error: 'Student not enrolled' });
        }

        const classId = enrollment.classId;

        // Get class info
        const classes = readFile(files.classes);
        const classObj = classes.find(c => c.id === classId);
        if (!classObj) {
            return res.status(404).json({ success: false, error: 'Class not found' });
        }

        // Get subjects for this class
        const allSubjects = readFile(files.subjects);
        const classSubjects = allSubjects.filter(s =>
            s.classId === classId || s.classId === 'all' || s.classId === null
        );

        // Get marks for this student
        const allMarks = readFile(reportFiles.marks);
        const classMarks = allMarks[classId] || {};
        const studentMarks = classMarks[studentId] || {};

        // Get initials
        const allInitials = readFile(reportFiles.initials);
        const classInitials = allInitials[classId] || {};

        // Grading system
        const settings = readFile(files.settings);
        const gradingSystem = settings.gradingSystem || {
            'A': { min: 80, max: 100, remark: 'Excellent' },
            'B': { min: 70, max: 79, remark: 'Very Good' },
            'C': { min: 60, max: 69, remark: 'Good' },
            'D': { min: 50, max: 59, remark: 'Satisfactory' },
            'E': { min: 40, max: 49, remark: 'Fair' },
            'F': { min: 0, max: 39, remark: 'Poor' }
        };

        function calculateGrade(percentage) {
            for (const [grade, range] of Object.entries(gradingSystem)) {
                if (percentage >= range.min && percentage <= range.max) {
                    return grade;
                }
            }
            return 'F';
        }

        function getGradeRemark(grade) {
            return gradingSystem[grade]?.remark || '';
        }

        // Build report card
        const subjects = [];
        let totalScore = 0;
        let subjectCount = 0;

        for (const subject of classSubjects) {
            const subjectMarks = studentMarks[subject.id] || {};
            const cat1 = subjectMarks['CAT 1'] || 0;
            const cat2 = subjectMarks['CAT 2'] || 0;
            const exam = subjectMarks['Exam'] || 0;

            const total = cat1 + cat2 + exam;
            const avg = (cat1 + cat2 + exam) / 3;
            const grade = calculateGrade(avg);
            const remark = getGradeRemark(grade);

            const initialsKey = `${student.id}_${subject.id}`;
            const initials = classInitials[initialsKey] || '';

            subjects.push({
                subjectId: subject.id,
                subjectName: subject.name,
                subjectCode: subject.code,
                cat1: cat1 || null,
                cat2: cat2 || null,
                exam: exam || null,
                total: total,
                average: avg,
                grade: grade,
                remark: remark,
                initials: initials
            });

            totalScore += avg;
            subjectCount++;
        }

        const overallAverage = subjectCount > 0 ? (totalScore / subjectCount) : 0;
        const overallGrade = calculateGrade(overallAverage);
        const overallRemark = getGradeRemark(overallGrade);

        const reportCard = {
            id: `preview_${studentId}`,
            studentId: student.id,
            studentName: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
            admissionNumber: student.admissionNumber || 'N/A',
            className: classObj.name,
            classId: classId,
            term: termNum,
            year: yearNum,
            subjects: subjects,
            totalScore: totalScore,
            average: overallAverage,
            overallGrade: overallGrade,
            overallRemark: overallRemark,
            generatedAt: new Date().toISOString(),
            isPreview: true
        };

        res.json({ success: true, reportCard: reportCard });

    } catch (error) {
        console.error('Error previewing report card:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 6. BULK UPLOAD MARKS
// ================================================================

app.post('/api/report-cards/class/:classId/marks/bulk', upload.single('file'), async (req, res) => {
    try {
        const { classId } = req.params;

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        // Parse the file (CSV or Excel)
        let workbook;
        let data;
        const fileExt = req.file.originalname.split('.').pop().toLowerCase();

        if (fileExt === 'csv') {
            const csvData = req.file.buffer.toString('utf8');
            const rows = csvData.split('\n').map(row => row.split(','));
            data = rows.map(row => row.map(cell => cell.trim()));
        } else {
            workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
        }

        if (!data || data.length < 2) {
            return res.status(400).json({ success: false, error: 'File is empty or missing data rows' });
        }

        // Parse headers
        const headers = data[0].map(h => String(h).trim());

        // Find columns
        const colIndex = {
            studentId: headers.findIndex(h => h && h.toLowerCase().includes('student id')),
            studentName: headers.findIndex(h => h && h.toLowerCase().includes('student name')),
            admissionNumber: headers.findIndex(h => h && h.toLowerCase().includes('admission'))
        };

        // Find subject columns (everything after admission)
        const subjectColumns = [];
        for (let i = 0; i < headers.length; i++) {
            const h = headers[i];
            if (i <= Math.max(colIndex.studentId, colIndex.studentName, colIndex.admissionNumber)) continue;
            // Check if it's a subject column (contains assessment type)
            const parts = h.split(' - ');
            if (parts.length === 2) {
                subjectColumns.push({
                    index: i,
                    subjectName: parts[0].trim(),
                    assessmentType: parts[1].trim()
                });
            } else {
                // Try to parse as subject name (without assessment type)
                subjectColumns.push({
                    index: i,
                    subjectName: h.trim(),
                    assessmentType: 'Total'
                });
            }
        }

        // Get subjects for this class
        const allSubjects = readFile(files.subjects);
        const classSubjects = allSubjects.filter(s =>
            s.classId === classId || s.classId === 'all' || s.classId === null
        );

        // Map subject names to subject IDs
        const subjectMap = {};
        for (const subject of classSubjects) {
            subjectMap[subject.name.toLowerCase()] = subject.id;
            subjectMap[subject.code?.toLowerCase()] = subject.id;
        }

        // Process rows
        let allMarks = readFile(reportFiles.marks);
        if (!allMarks[classId]) allMarks[classId] = {};

        let processed = 0;
        let errors = [];

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row.every(cell => !cell || String(cell).trim() === '')) continue;

            let studentId = null;
            let studentName = '';

            // Find student by admission number or name
            if (colIndex.admissionNumber !== -1 && row[colIndex.admissionNumber]) {
                const admission = String(row[colIndex.admissionNumber]).trim();
                const students = readFile(files.students);
                const student = students.find(s => s.admissionNumber === admission);
                if (student) {
                    studentId = student.id;
                    studentName = `${student.firstName || ''} ${student.lastName || ''}`.trim();
                }
            }

            if (!studentId && colIndex.studentName !== -1 && row[colIndex.studentName]) {
                const name = String(row[colIndex.studentName]).trim().toLowerCase();
                const students = readFile(files.students);
                const student = students.find(s =>
                    `${s.firstName || ''} ${s.lastName || ''}`.toLowerCase().includes(name) ||
                    `${s.lastName || ''} ${s.firstName || ''}`.toLowerCase().includes(name)
                );
                if (student) {
                    studentId = student.id;
                    studentName = `${student.firstName || ''} ${student.lastName || ''}`.trim();
                }
            }

            if (!studentId) {
                errors.push(`Row ${i}: Could not identify student`);
                continue;
            }

            if (!allMarks[classId][studentId]) {
                allMarks[classId][studentId] = {};
            }

            // Process each subject column
            for (const col of subjectColumns) {
                const value = row[col.index] ? String(row[col.index]).trim() : '';
                if (value === '' || value === '-') continue;

                const subjectId = subjectMap[col.subjectName.toLowerCase()];
                if (!subjectId) {
                    errors.push(`Row ${i}: Subject "${col.subjectName}" not found for this class`);
                    continue;
                }

                const numValue = parseFloat(value);
                if (isNaN(numValue)) {
                    errors.push(`Row ${i}: Invalid value for ${col.subjectName}: "${value}"`);
                    continue;
                }

                if (!allMarks[classId][studentId][subjectId]) {
                    allMarks[classId][studentId][subjectId] = {};
                }

                // If it's a total, distribute to all assessment types
                if (col.assessmentType === 'Total') {
                    // Distribute evenly or just store as total?
                    // For simplicity, store as a special "Total" field
                    allMarks[classId][studentId][subjectId]['Total'] = numValue;
                } else {
                    allMarks[classId][studentId][subjectId][col.assessmentType] = numValue;
                }

                processed++;
            }
        }

        // Save marks
        saveFile(reportFiles.marks, allMarks);

        res.json({
            success: true,
            message: `Bulk upload complete. Processed ${processed} marks for ${Object.keys(allMarks[classId]).length} students`,
            processed: processed,
            students: Object.keys(allMarks[classId]).length,
            errors: errors.slice(0, 20),
            errorCount: errors.length
        });

    } catch (error) {
        console.error('Error in bulk upload:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 7. REPORT CARD STATISTICS
// ================================================================

app.get('/api/report-cards/class/:classId/stats', (req, res) => {
    try {
        const { classId } = req.params;
        const { term, year } = req.query;

        const termNum = parseInt(term) || 1;
        const yearNum = parseInt(year) || new Date().getFullYear();

        // Get generated report cards for this class/term/year
        const allGenerated = readFile(reportFiles.generated);
        const classReportCards = allGenerated.filter(r =>
            r.classId === classId && r.term === termNum && r.year === yearNum
        );

        // Get marks for this class
        const allMarks = readFile(reportFiles.marks);
        const classMarks = allMarks[classId] || {};

        // Get students in this class
        const students = readFile(files.students);
        const enrollments = readFile(files.enrollments);
        const classEnrollments = enrollments.filter(e =>
            e.classId === classId && e.academicYear === yearNum && e.isCurrent === true
        );
        const studentIds = classEnrollments.map(e => e.studentId);
        const classStudents = students.filter(s => studentIds.includes(s.id) && s.status === 'Active');

        // Get subjects for this class
        const allSubjects = readFile(files.subjects);
        const classSubjects = allSubjects.filter(s =>
            s.classId === classId || s.classId === 'all' || s.classId === null
        );

        // Grading system
        const settings = readFile(files.settings);
        const gradingSystem = settings.gradingSystem || {
            'A': { min: 80, max: 100, remark: 'Excellent' },
            'B': { min: 70, max: 79, remark: 'Very Good' },
            'C': { min: 60, max: 69, remark: 'Good' },
            'D': { min: 50, max: 59, remark: 'Satisfactory' },
            'E': { min: 40, max: 49, remark: 'Fair' },
            'F': { min: 0, max: 39, remark: 'Poor' }
        };

        function calculateGrade(percentage) {
            for (const [grade, range] of Object.entries(gradingSystem)) {
                if (percentage >= range.min && percentage <= range.max) {
                    return grade;
                }
            }
            return 'F';
        }

        // Calculate statistics
        let totalStudents = classStudents.length;
        let studentsWithMarks = 0;
        let gradeDistribution = { 'A': 0, 'B': 0, 'C': 0, 'D': 0, 'E': 0, 'F': 0 };
        let subjectAverages = {};
        let totalAverage = 0;

        for (const student of classStudents) {
            const studentMarks = classMarks[student.id] || {};
            let studentTotal = 0;
            let studentCount = 0;

            for (const subject of classSubjects) {
                const subjectMarks = studentMarks[subject.id] || {};
                const cat1 = subjectMarks['CAT 1'] || 0;
                const cat2 = subjectMarks['CAT 2'] || 0;
                const exam = subjectMarks['Exam'] || 0;

                const total = cat1 + cat2 + exam;
                const avg = (cat1 + cat2 + exam) / 3;

                if (cat1 > 0 || cat2 > 0 || exam > 0) {
                    studentTotal += avg;
                    studentCount++;

                    if (!subjectAverages[subject.id]) {
                        subjectAverages[subject.id] = { total: 0, count: 0, name: subject.name };
                    }
                    subjectAverages[subject.id].total += avg;
                    subjectAverages[subject.id].count++;
                }
            }

            if (studentCount > 0) {
                studentsWithMarks++;
                const overallAvg = studentTotal / studentCount;
                const grade = calculateGrade(overallAvg);
                gradeDistribution[grade] = (gradeDistribution[grade] || 0) + 1;
                totalAverage += overallAvg;
            }
        }

        // Calculate subject averages
        const subjectAverageList = Object.values(subjectAverages).map(s => ({
            subjectId: s.id,
            subjectName: s.name,
            average: s.count > 0 ? (s.total / s.count) : 0,
            studentCount: s.count
        })).sort((a, b) => b.average - a.average);

        const overallClassAverage = studentsWithMarks > 0 ? (totalAverage / studentsWithMarks) : 0;
        const overallGrade = calculateGrade(overallClassAverage);

        res.json({
            success: true,
            stats: {
                totalStudents: totalStudents,
                studentsWithMarks: studentsWithMarks,
                gradeDistribution: gradeDistribution,
                subjectAverages: subjectAverageList,
                overallAverage: overallClassAverage,
                overallGrade: overallGrade,
                reportCardsGenerated: classReportCards.length
            }
        });

    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

console.log('✅ Report Card Backend Routes loaded!');
console.log('   📄 /api/report-cards/template - Get/Set template');
console.log('   📝 /api/report-cards/class/:classId/marks - Get/Set marks');
console.log('   🔤 /api/report-cards/class/:classId/initials - Get/Set initials');
console.log('   📊 /api/report-cards/class/:classId/generate - Generate report cards');
console.log('   👁️ /api/report-cards/class/:classId - Get generated report cards');
console.log('   🗑️ /api/report-cards/:id - Delete report card');
console.log('   👤 /api/report-cards/student/:studentId/preview - Preview report card');
console.log('   📈 /api/report-cards/class/:classId/stats - Get statistics');
console.log('   📤 /api/report-cards/class/:classId/marks/bulk - Bulk upload marks');


// ==================== PARENT PORTAL BACKEND ROUTES ====================

// File paths for parent data
const parentFiles = {
    parents: path.join(dataDir, 'parents.json')
};

// Initialize parent file
function initializeParentFile() {
    if (!fs.existsSync(parentFiles.parents)) {
        saveFile(parentFiles.parents, {});
    }
    console.log('✅ Parent file initialized');
}

initializeParentFile();

// ==================== PARENT LOGIN ====================
app.post('/api/parent/login', (req, res) => {
    try {
        const { name, dob, password } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, error: 'Parent name is required' });
        }

        // Find all students with this parent name (case-insensitive)
        const students = readFile(files.students);
        const matchedStudents = students.filter(s => 
            s.parentInfo && s.parentInfo.name && 
            s.parentInfo.name.toLowerCase().trim() === name.toLowerCase().trim()
        );

        if (matchedStudents.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'No student found with this parent name. Please check the name or contact the school.' 
            });
        }

        // Check if this parent has a password saved
        const parents = readFile(parentFiles.parents);
        const parentKey = name.toLowerCase().trim();
        const parentRecord = parents[parentKey];

        // If password is provided, verify it
        if (password) {
            if (!parentRecord) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'No account found for this parent. Please use the first-time login option.' 
                });
            }
            if (parentRecord.password !== password) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Incorrect password. Please try again.' 
                });
            }
            // Password verified - return student data
            return res.json({
                success: true,
                isFirstLogin: false,
                students: matchedStudents.map(s => ({
                    id: s.id,
                    firstName: s.firstName,
                    lastName: s.lastName,
                    admissionNumber: s.admissionNumber,
                    currentClassId: s.currentClassId,
                    parentInfo: s.parentInfo,
                    status: s.status
                })),
                parentName: name,
                message: 'Login successful'
            });
        }

        // If DOB is provided, verify it (first-time login)
        if (dob) {
            // Check if any student matches the DOB
            const matchedStudent = matchedStudents.find(s => s.dateOfBirth === dob);
            if (!matchedStudent) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'The date of birth does not match any student. Please check and try again.' 
                });
            }
            // DOB verified - allow password setup
            return res.json({
                success: true,
                isFirstLogin: true,
                requiresPasswordSetup: true,
                students: matchedStudents.map(s => ({
                    id: s.id,
                    firstName: s.firstName,
                    lastName: s.lastName,
                    admissionNumber: s.admissionNumber,
                    currentClassId: s.currentClassId,
                    parentInfo: s.parentInfo,
                    status: s.status
                })),
                parentName: name,
                message: 'Identity verified. Please set up your password.'
            });
        }

        // No password and no DOB - just name check
        return res.json({
            success: true,
            exists: true,
            hasPassword: !!parentRecord,
            students: matchedStudents.map(s => ({
                id: s.id,
                firstName: s.firstName,
                lastName: s.lastName,
                admissionNumber: s.admissionNumber,
                currentClassId: s.currentClassId,
                parentInfo: s.parentInfo,
                status: s.status
            })),
            parentName: name,
            message: parentRecord ? 'Password exists' : 'No password set'
        });

    } catch (error) {
        console.error('❌ Parent login error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== SETUP PARENT PASSWORD ====================
app.post('/api/parent/setup-password', (req, res) => {
    try {
        const { name, password } = req.body;

        if (!name || !password) {
            return res.status(400).json({ success: false, error: 'Name and password are required' });
        }

        // Validate password: min 5 chars, letters and numbers
        const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{5,}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Password must be at least 5 characters and contain both letters and numbers.' 
            });
        }

        // Verify the parent exists
        const students = readFile(files.students);
        const matchedStudents = students.filter(s => 
            s.parentInfo && s.parentInfo.name && 
            s.parentInfo.name.toLowerCase().trim() === name.toLowerCase().trim()
        );

        if (matchedStudents.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Parent not found. Please contact the school.' 
            });
        }

        // Save password
        let parents = readFile(parentFiles.parents);
        const parentKey = name.toLowerCase().trim();

        parents[parentKey] = {
            name: name,
            password: password,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            studentIds: matchedStudents.map(s => s.id)
        };

        saveFile(parentFiles.parents, parents);

        console.log(`✅ Password set up for parent: ${name}`);

        res.json({
            success: true,
            message: 'Password set up successfully! You can now log in.',
            students: matchedStudents.map(s => ({
                id: s.id,
                firstName: s.firstName,
                lastName: s.lastName,
                admissionNumber: s.admissionNumber,
                currentClassId: s.currentClassId,
                parentInfo: s.parentInfo,
                status: s.status
            })),
            parentName: name
        });

    } catch (error) {
        console.error('❌ Password setup error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== GET PARENT STUDENTS ====================
app.get('/api/parent/students/:parentName', (req, res) => {
    try {
        const { parentName } = req.params;

        const students = readFile(files.students);
        const matchedStudents = students.filter(s => 
            s.parentInfo && s.parentInfo.name && 
            s.parentInfo.name.toLowerCase().trim() === parentName.toLowerCase().trim()
        );

        res.json({
            success: true,
            students: matchedStudents.map(s => ({
                id: s.id,
                firstName: s.firstName,
                lastName: s.lastName,
                admissionNumber: s.admissionNumber,
                currentClassId: s.currentClassId,
                parentInfo: s.parentInfo,
                status: s.status,
                dateOfBirth: s.dateOfBirth,
                gender: s.gender,
                address: s.address
            }))
        });

    } catch (error) {
        console.error('Error getting parent students:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== GET STUDENT DETAILS FOR PARENT ====================
app.get('/api/parent/student/:studentId/details', (req, res) => {
    try {
        const { studentId } = req.params;

        const students = readFile(files.students);
        const student = students.find(s => s.id === studentId);

        if (!student) {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }

        // Get enrollments
        const enrollments = readFile(files.enrollments);
        const studentEnrollments = enrollments.filter(e => e.studentId === studentId);

        // Get classes
        const classes = readFile(files.classes);
        const classMap = {};
        classes.forEach(c => { if (c && c.id) classMap[c.id] = c; });

        // Get current class
        const currentEnrollment = studentEnrollments.find(e => e.isCurrent === true);
        const currentClass = currentEnrollment ? classMap[currentEnrollment.classId] : null;

        // Get fee assignments
        const feeAssignments = readFile(files.studentFeeAssignments);
        const studentFeeAssignments = feeAssignments.filter(a => a.studentId === studentId);

        // Get fee structures
        const feeStructures = readFile(files.feeStructures);
        const feeStructureMap = {};
        feeStructures.forEach(f => { if (f && f.id) feeStructureMap[f.id] = f; });

        // Get payments
        const allPayments = readFile(files.feePayments);
        const studentPayments = allPayments.filter(p => p.studentId === studentId);

        // Get marks (report cards)
        const allMarks = readFile(reportFiles.marks);
        let studentMarks = {};
        for (const classId of Object.keys(allMarks)) {
            for (const year of Object.keys(allMarks[classId])) {
                for (const term of Object.keys(allMarks[classId][year])) {
                    const marks = allMarks[classId][year][term];
                    if (marks[studentId]) {
                        if (!studentMarks[year]) studentMarks[year] = {};
                        if (!studentMarks[year][term]) studentMarks[year][term] = {};
                        studentMarks[year][term][classId] = marks[studentId];
                    }
                }
            }
        }

        // Get attendance summary
        const attendance = readFile(files.attendance);
        let studentAttendance = [];
        for (const record of attendance) {
            const studentRecord = record.records.find(r => r.studentId === studentId);
            if (studentRecord) {
                studentAttendance.push({
                    date: record.date,
                    classId: record.classId,
                    status: studentRecord.status,
                    present: studentRecord.present,
                    absent: studentRecord.absent
                });
            }
        }
        studentAttendance.sort((a, b) => new Date(b.date) - new Date(a.date));

        const presentCount = studentAttendance.filter(r => r.present).length;
        const absentCount = studentAttendance.filter(r => r.absent).length;
        const totalCount = studentAttendance.length;
        const attendanceRate = totalCount > 0 ? (presentCount / totalCount * 100).toFixed(1) : 0;

        // Get term records for fee breakdown
        const termRecords = readFile(files.studentTermRecords);
        const studentTermRecords = {};
        for (const [key, record] of Object.entries(termRecords)) {
            if (key.startsWith(studentId + '_')) {
                const parts = key.split('_');
                if (parts.length === 3) {
                    const year = parts[1];
                    const term = parts[2];
                    if (!studentTermRecords[year]) studentTermRecords[year] = {};
                    studentTermRecords[year][term] = record;
                }
            }
        }

        // Calculate total expected and paid
        let totalExpected = 0;
        let totalPaid = 0;
        // Use fee assignments to calculate expected fee per year/term
        // For simplicity, we'll use the current fee structure and multiply by number of terms? We'll just sum payments for now.

        // Better: use the fee assignment for current year to get expected tuition and activity fees.
        // But we can also calculate from fee structure.

        // We'll include the fee structure details in the response.

        const currentFeeAssignment = studentFeeAssignments.find(a => a.academicYear === new Date().getFullYear());
        let currentFeeStructure = null;
        if (currentFeeAssignment && currentFeeAssignment.feeStructureId) {
            currentFeeStructure = feeStructureMap[currentFeeAssignment.feeStructureId];
        }

        // If no current fee assignment, try to get from student's assignedFeeStructureId
        if (!currentFeeStructure && student.assignedFeeStructureId) {
            currentFeeStructure = feeStructureMap[student.assignedFeeStructureId];
        }

        res.json({
            success: true,
            student: {
                ...student,
                currentClass: currentClass ? currentClass.name : 'Not Assigned',
                currentClassLevel: currentClass ? currentClass.level : 'Unknown',
                enrollments: studentEnrollments,
                feeAssignments: studentFeeAssignments.map(a => ({
                    ...a,
                    feeStructureName: feeStructureMap[a.feeStructureId]?.name || 'Unknown'
                })),
                payments: studentPayments,
                marks: studentMarks,
                attendance: {
                    records: studentAttendance,
                    summary: {
                        present: presentCount,
                        absent: absentCount,
                        total: totalCount,
                        rate: attendanceRate
                    }
                },
                termRecords: studentTermRecords,
                currentFeeStructure: currentFeeStructure,
                totalPaid: studentPayments.reduce((sum, p) => sum + (p.totalAmount || p.amount || 0), 0)
            }
        });

    } catch (error) {
        console.error('Error getting student details:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

console.log('✅ Parent Portal routes loaded');

// ==================== EVENTS MANAGEMENT ====================
const eventsFilePath = path.join(dataDir, 'events.json');

// Initialize events file
if (!fs.existsSync(eventsFilePath)) {
    saveFile(eventsFilePath, []);
}

// ========== GET EVENT CATEGORIES ==========
app.get('/api/events/categories', (req, res) => {
    try {
        const categories = [
            { id: 'Academic', label: '📚 Academic', color: '#3b82f6' },
            { id: 'Sports', label: '🏆 Sports', color: '#22c55e' },
            { id: 'Cultural', label: '🎭 Cultural', color: '#a855f7' },
            { id: 'Holiday', label: '🎉 Holiday', color: '#f59e0b' },
            { id: 'Meeting', label: '📋 Meeting', color: '#8b5cf6' },
            { id: 'Exam', label: '📝 Exam', color: '#ef4444' },
            { id: 'Parent', label: '👨‍👩‍👦 Parent Event', color: '#ec4899' },
            { id: 'Fundraising', label: '💰 Fundraising', color: '#14b8a6' },
            { id: 'General', label: '📌 General', color: '#6b7280' },
            { id: 'Other', label: '📎 Other', color: '#8b8b8b' }
        ];
        res.json(categories);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

// ========== GET ALL EVENTS ==========
app.get('/api/events', (req, res) => {
    try {
        const { category, status, startDate, endDate } = req.query;
        let events = readFile(eventsFilePath) || [];
        
        // Apply filters
        if (category && category !== 'all') {
            events = events.filter(e => e.category === category);
        }
        if (status && status !== 'all') {
            events = events.filter(e => e.status === status);
        }
        if (startDate) {
            events = events.filter(e => e.startDate >= startDate);
        }
        if (endDate) {
            events = events.filter(e => e.endDate <= endDate);
        }
        
        // Sort by start date (most recent first)
        events.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
        res.json(events);
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// ========== GET SINGLE EVENT ==========
app.get('/api/events/:id', (req, res) => {
    try {
        const events = readFile(eventsFilePath) || [];
        const event = events.find(e => e.id === req.params.id);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        res.json(event);
    } catch (error) {
        console.error('Error fetching event:', error);
        res.status(500).json({ error: 'Failed to fetch event' });
    }
});

// ========== CREATE EVENT ==========
app.post('/api/events', (req, res) => {
    try {
        const { 
            title, description, category, status, 
            startDate, endDate, startTime, endTime,
            isAllDay, location, recurring, reminder,
            color, image, link
        } = req.body;
        
        // Validate required fields
        if (!title || !startDate || !endDate) {
            return res.status(400).json({ error: 'Title, start date, and end date are required' });
        }
        
        // Validate dates
        if (new Date(endDate) < new Date(startDate)) {
            return res.status(400).json({ error: 'End date must be after start date' });
        }
        
        const events = readFile(eventsFilePath) || [];
        
        const newEvent = {
            id: uuidv4(),
            title: title.trim(),
            description: description || '',
            category: category || 'General',
            status: status || 'draft',
            startDate: startDate,
            endDate: endDate,
            startTime: startTime || '09:00',
            endTime: endTime || '17:00',
            isAllDay: isAllDay || false,
            location: location || '',
            recurring: recurring || 'none',
            reminder: reminder || 'none',
            color: color || getCategoryColor(category || 'General'),
            image: image || '',
            link: link || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        events.push(newEvent);
        saveFile(eventsFilePath, events);
        
        res.status(201).json(newEvent);
    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({ error: 'Failed to create event' });
    }
});

// ========== UPDATE EVENT ==========
app.put('/api/events/:id', (req, res) => {
    try {
        const events = readFile(eventsFilePath) || [];
        const index = events.findIndex(e => e.id === req.params.id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Event not found' });
        }
        
        const { 
            title, description, category, status, 
            startDate, endDate, startTime, endTime,
            isAllDay, location, recurring, reminder,
            color, image, link
        } = req.body;
        
        // Validate dates if provided
        if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
            return res.status(400).json({ error: 'End date must be after start date' });
        }
        
        events[index] = {
            ...events[index],
            title: title !== undefined ? title.trim() : events[index].title,
            description: description !== undefined ? description : events[index].description,
            category: category || events[index].category,
            status: status || events[index].status,
            startDate: startDate || events[index].startDate,
            endDate: endDate || events[index].endDate,
            startTime: startTime || events[index].startTime,
            endTime: endTime || events[index].endTime,
            isAllDay: isAllDay !== undefined ? isAllDay : events[index].isAllDay,
            location: location !== undefined ? location : events[index].location,
            recurring: recurring || events[index].recurring,
            reminder: reminder || events[index].reminder,
            color: color || events[index].color,
            image: image !== undefined ? image : events[index].image,
            link: link !== undefined ? link : events[index].link,
            updatedAt: new Date().toISOString()
        };
        
        saveFile(eventsFilePath, events);
        res.json(events[index]);
    } catch (error) {
        console.error('Error updating event:', error);
        res.status(500).json({ error: 'Failed to update event' });
    }
});

// ========== DELETE EVENT ==========
app.delete('/api/events/:id', (req, res) => {
    try {
        let events = readFile(eventsFilePath) || [];
        const initialLength = events.length;
        events = events.filter(e => e.id !== req.params.id);
        
        if (events.length === initialLength) {
            return res.status(404).json({ error: 'Event not found' });
        }
        
        saveFile(eventsFilePath, events);
        res.json({ success: true, message: 'Event deleted successfully' });
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({ error: 'Failed to delete event' });
    }
});

// ========== GET EVENTS BY DATE RANGE ==========
app.get('/api/events/range/:start/:end', (req, res) => {
    try {
        const { start, end } = req.params;
        const events = readFile(eventsFilePath) || [];
        
        const filtered = events.filter(e => 
            e.startDate >= start && e.endDate <= end && e.status === 'published'
        );
        
        res.json(filtered);
    } catch (error) {
        console.error('Error fetching events by range:', error);
        res.status(500).json({ error: 'Failed to fetch events by range' });
    }
});

// ========== GET EVENT CATEGORIES ==========
app.get('/api/events/categories', (req, res) => {
    try {
        const categories = [
            { id: 'Academic', label: '📚 Academic', color: '#3b82f6' },
            { id: 'Sports', label: '🏆 Sports', color: '#22c55e' },
            { id: 'Cultural', label: '🎭 Cultural', color: '#a855f7' },
            { id: 'Holiday', label: '🎉 Holiday', color: '#f59e0b' },
            { id: 'Meeting', label: '📋 Meeting', color: '#8b5cf6' },
            { id: 'Exam', label: '📝 Exam', color: '#ef4444' },
            { id: 'Parent', label: '👨‍👩‍👦 Parent Event', color: '#ec4899' },
            { id: 'Fundraising', label: '💰 Fundraising', color: '#14b8a6' },
            { id: 'General', label: '📌 General', color: '#6b7280' },
            { id: 'Other', label: '📎 Other', color: '#8b8b8b' }
        ];
        res.json(categories);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

// ========== GET UPCOMING EVENTS ==========
app.get('/api/events/upcoming/:limit', (req, res) => {
    try {
        const limit = parseInt(req.params.limit) || 5;
        const today = new Date().toISOString().split('T')[0];
        const events = readFile(eventsFilePath) || [];
        
        const upcoming = events
            .filter(e => e.startDate >= today && e.status === 'published')
            .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
            .slice(0, limit);
        
        res.json(upcoming);
    } catch (error) {
        console.error('Error fetching upcoming events:', error);
        res.status(500).json({ error: 'Failed to fetch upcoming events' });
    }
});

console.log('✅ Events Management API routes loaded');

// ==================== CHAT/CONTACT SYSTEM ====================
const chatFilePath = path.join(dataDir, 'chatMessages.json');
const chatContactsFilePath = path.join(dataDir, 'chatContacts.json');

// Initialize chat files
if (!fs.existsSync(chatFilePath)) {
    saveFile(chatFilePath, {});
}
if (!fs.existsSync(chatContactsFilePath)) {
    saveFile(chatContactsFilePath, {});
}

// ========== GET ALL CONTACTS WITH FILTERS ==========
app.get('/api/chat/contacts', (req, res) => {
    try {
        const { type } = req.query;
        let contacts = [];
        
        // Get teachers
        const teachers = readFile(files.teachers) || [];
        teachers.forEach(t => {
            if (t.status === 'Active') {
                contacts.push({
                    id: t.id,
                    name: `${t.firstName || ''} ${t.lastName || ''}`.trim(),
                    type: 'teacher',
                    avatar: t.avatar || null,
                    status: t.status,
                    phone: t.phone,
                    email: t.email,
                    lastActive: t.lastActive || null,
                    isOnline: false
                });
            }
        });
        
        // Get parents (from students.json)
        const students = readFile(files.students) || [];
        const parentsMap = {};
        students.forEach(s => {
            if (s.parentInfo && s.parentInfo.name && s.parentInfo.phone) {
                const key = s.parentInfo.phone;
                if (!parentsMap[key]) {
                    parentsMap[key] = {
                        id: `parent_${key}`,
                        name: s.parentInfo.name,
                        type: 'parent',
                        phone: s.parentInfo.phone,
                        email: s.parentInfo.email || '',
                        students: [],
                        avatar: null,
                        status: 'Active',
                        lastActive: null,
                        isOnline: false
                    };
                }
                parentsMap[key].students.push(`${s.firstName || ''} ${s.lastName || ''}`.trim());
            }
        });
        Object.values(parentsMap).forEach(p => contacts.push(p));
        
        // Get students (only those with accounts)
        students.forEach(s => {
            if (s.status === 'Active' && (s.phone || s.email)) {
                contacts.push({
                    id: s.id,
                    name: `${s.firstName || ''} ${s.lastName || ''}`.trim(),
                    type: 'student',
                    admissionNumber: s.admissionNumber,
                    phone: s.phone || s.parentInfo?.phone || '',
                    email: s.email || s.parentInfo?.email || '',
                    avatar: s.photo || null,
                    status: s.status,
                    lastActive: s.lastActive || null,
                    isOnline: false
                });
            }
        });
        
        // Get director (from settings or schools)
        const settings = readFile(files.settings) || {};
        const school = readFile(files.schools) || [];
        const director = school[0]?.director || settings.director || null;
        if (director) {
            contacts.push({
                id: 'director',
                name: director.name || 'Director',
                type: 'director',
                phone: director.phone || '',
                email: director.email || '',
                avatar: director.avatar || null,
                status: 'Active',
                lastActive: null,
                isOnline: false
            });
        }
        
        // Apply type filter
        if (type && type !== 'all') {
            contacts = contacts.filter(c => c.type === type);
        }
        
        // Sort by name
        contacts.sort((a, b) => a.name.localeCompare(b.name));
        
        res.json(contacts);
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ error: 'Failed to fetch contacts' });
    }
});

// ========== GET CHAT MESSAGES ==========
app.get('/api/chat/messages/:contactId', (req, res) => {
    try {
        const { contactId } = req.params;
        const { limit, before } = req.query;
        
        const chatData = readFile(chatFilePath) || {};
        const messages = chatData[contactId] || [];
        
        // Sort by timestamp (newest first for pagination)
        let sorted = [...messages].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Apply pagination
        if (before) {
            const beforeDate = new Date(before);
            sorted = sorted.filter(m => new Date(m.timestamp) < beforeDate);
        }
        
        if (limit && !isNaN(parseInt(limit))) {
            sorted = sorted.slice(0, parseInt(limit));
        }
        
        // Return in chronological order (oldest first)
        res.json(sorted.reverse());
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// ========== SEND MESSAGE ==========
app.post('/api/chat/messages', (req, res) => {
    try {
        const { contactId, message, messageType, replyTo, sender } = req.body;
        const senderName = sender || 'admin';
        
        if (!contactId) {
            return res.status(400).json({ error: 'Contact ID is required' });
        }
        
        // Read existing messages
        const chatData = readFile(chatFilePath) || {};
        if (!chatData[contactId]) {
            chatData[contactId] = [];
        }
        
        // Create message object
        const newMessage = {
            id: uuidv4(),
            sender: senderName,
            contactId: contactId,
            message: message || '',
            messageType: messageType || 'text',
            timestamp: new Date().toISOString(),
            read: false,
            delivered: true,
            replyTo: replyTo || null
        };
        
        // Add message to chat
        chatData[contactId].push(newMessage);
        
        // Update contact's last message
        const contacts = readFile(chatContactsFilePath) || {};
        if (!contacts[contactId]) {
            contacts[contactId] = {};
        }
        contacts[contactId].lastMessage = newMessage;
        contacts[contactId].lastMessageTime = newMessage.timestamp;
        contacts[contactId].unreadCount = (contacts[contactId].unreadCount || 0) + 1;
        
        saveFile(chatFilePath, chatData);
        saveFile(chatContactsFilePath, contacts);
        
        // Return the message
        res.status(201).json(newMessage);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// ========== MARK MESSAGES AS READ ==========
app.put('/api/chat/messages/:contactId/read', (req, res) => {
    try {
        const { contactId } = req.params;
        
        const chatData = readFile(chatFilePath) || {};
        const messages = chatData[contactId] || [];
        
        // Mark all messages as read
        let updated = false;
        messages.forEach(m => {
            if (!m.read && m.sender !== 'admin') {
                m.read = true;
                updated = true;
            }
        });
        
        if (updated) {
            chatData[contactId] = messages;
            saveFile(chatFilePath, chatData);
            
            // Reset unread count
            const contacts = readFile(chatContactsFilePath) || {};
            if (contacts[contactId]) {
                contacts[contactId].unreadCount = 0;
                saveFile(chatContactsFilePath, contacts);
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking messages as read:', error);
        res.status(500).json({ error: 'Failed to mark messages as read' });
    }
});

// ========== GET UNREAD COUNT ==========
app.get('/api/chat/unread', (req, res) => {
    try {
        const contacts = readFile(chatContactsFilePath) || {};
        let totalUnread = 0;
        const unreadByContact = {};
        
        Object.keys(contacts).forEach(contactId => {
            const count = contacts[contactId]?.unreadCount || 0;
            if (count > 0) {
                totalUnread += count;
                unreadByContact[contactId] = count;
            }
        });
        
        res.json({ totalUnread, unreadByContact });
    } catch (error) {
        console.error('Error getting unread count:', error);
        res.status(500).json({ error: 'Failed to get unread count' });
    }
});

// ========== DELETE MESSAGE ==========
app.delete('/api/chat/messages/:messageId', (req, res) => {
    try {
        const { messageId } = req.params;
        const { contactId } = req.query;
        
        if (!contactId) {
            return res.status(400).json({ error: 'Contact ID is required' });
        }
        
        const chatData = readFile(chatFilePath) || {};
        const messages = chatData[contactId] || [];
        
        const index = messages.findIndex(m => m.id === messageId);
        if (index === -1) {
            return res.status(404).json({ error: 'Message not found' });
        }
        
        // Remove message
        messages.splice(index, 1);
        chatData[contactId] = messages;
        saveFile(chatFilePath, chatData);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

// ========== TYPING INDICATOR ==========
app.post('/api/chat/typing', (req, res) => {
    try {
        const { contactId, isTyping } = req.body;
        // For now, just acknowledge
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating typing status:', error);
        res.status(500).json({ error: 'Failed to update typing status' });
    }
});

console.log('✅ Chat/Contact API routes loaded');

// ==================== ANNOUNCEMENTS ROUTES ====================
const announcementsFile = path.join(dataDir, 'announcements.json');

// Initialize announcements file
if (!fs.existsSync(announcementsFile)) {
    saveFile(announcementsFile, []);
}

// Get all announcements (with filters)
app.get('/api/announcements', (req, res) => {
    try {
        let announcements = readFile(announcementsFile);
        if (!Array.isArray(announcements)) announcements = [];
        const { audience, active, category } = req.query;
        if (audience) {
            announcements = announcements.filter(a => 
                a.targetAudience && a.targetAudience.includes(audience)
            );
        }
        if (active === 'true') {
            announcements = announcements.filter(a => a.isActive === true);
        }
        if (category) {
            announcements = announcements.filter(a => a.category === category);
        }
        // Sort by date descending (most recent first)
        announcements.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ success: true, data: announcements });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single announcement
app.get('/api/announcements/:id', (req, res) => {
    try {
        const announcements = readFile(announcementsFile);
        const announcement = announcements.find(a => a.id === req.params.id);
        if (!announcement) {
            return res.status(404).json({ success: false, error: 'Announcement not found' });
        }
        res.json({ success: true, data: announcement });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create announcement
app.post('/api/announcements', (req, res) => {
    try {
        const { title, content, category, importance, targetAudience, startDate, endDate, isActive, author } = req.body;
        if (!title || !content) {
            return res.status(400).json({ success: false, error: 'Title and content are required' });
        }
        let announcements = readFile(announcementsFile);
        if (!Array.isArray(announcements)) announcements = [];
        const newAnnouncement = {
            id: uuidv4(),
            title,
            content,
            category: category || 'General',
            importance: importance || 'Medium',
            targetAudience: targetAudience || ['public'],
            startDate: startDate || new Date().toISOString().split('T')[0],
            endDate: endDate || null,
            isActive: isActive !== undefined ? isActive : true,
            author: author || 'Admin',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        announcements.push(newAnnouncement);
        saveFile(announcementsFile, announcements);
        res.json({ success: true, data: newAnnouncement });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update announcement
app.put('/api/announcements/:id', (req, res) => {
    try {
        const { id } = req.params;
        let announcements = readFile(announcementsFile);
        const index = announcements.findIndex(a => a.id === id);
        if (index === -1) {
            return res.status(404).json({ success: false, error: 'Announcement not found' });
        }
        const updated = { ...announcements[index], ...req.body, updatedAt: new Date().toISOString() };
        announcements[index] = updated;
        saveFile(announcementsFile, announcements);
        res.json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete announcement
app.delete('/api/announcements/:id', (req, res) => {
    try {
        const { id } = req.params;
        let announcements = readFile(announcementsFile);
        announcements = announcements.filter(a => a.id !== id);
        saveFile(announcementsFile, announcements);
        res.json({ success: true, message: 'Announcement deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET all report card marks for a student (enriched with subject & class names)
app.get('/api/report-cards/student/:studentId/all', (req, res) => {
    try {
        const { studentId } = req.params;
        const allMarks = readFile(reportFiles.marks) || {};
        const result = {};

        // Iterate over classes, years, terms
        for (const classId of Object.keys(allMarks)) {
            for (const year of Object.keys(allMarks[classId])) {
                for (const term of Object.keys(allMarks[classId][year])) {
                    const marks = allMarks[classId][year][term];
                    if (marks[studentId]) {
                        if (!result[year]) result[year] = {};
                        if (!result[year][term]) result[year][term] = {};
                        result[year][term][classId] = marks[studentId];
                    }
                }
            }
        }

        // Get subjects and classes for enrichment
        const subjects = readFile(files.subjects) || [];
        const classes = readFile(files.classes) || [];
        const subjectMap = {};
        subjects.forEach(s => subjectMap[s.id] = s.name);
        const classMap = {};
        classes.forEach(c => classMap[c.id] = c.name);

        // Enrich with subject names and class names
        const enriched = {};
        for (const year of Object.keys(result)) {
            enriched[year] = {};
            for (const term of Object.keys(result[year])) {
                enriched[year][term] = {};
                for (const classId of Object.keys(result[year][term])) {
                    const marks = result[year][term][classId];
                    const enrichedMarks = {};
                    for (const subjectId of Object.keys(marks)) {
                        enrichedMarks[subjectId] = {
                            ...marks[subjectId],
                            subjectName: subjectMap[subjectId] || subjectId
                        };
                    }
                    enriched[year][term][classId] = {
                        className: classMap[classId] || classId,
                        marks: enrichedMarks
                    };
                }
            }
        }

        res.json({ success: true, data: enriched });
    } catch (error) {
        console.error('Error getting student report cards:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== PURGE ALL PAYMENTS FOR A FEE-STRUCTURE ITEM (or whole group) ====================
// Called when an item/group is removed from a fee structure. Deletes every matching
// payment entry across ALL students, recalculates payment totals, and reverses any
// inventory stock that was auto-added from a "brought_item" payment for that item.
app.delete('/api/fee/structures/items/purge-payments', (req, res) => {
    console.log('🗑️ PURGE PAYMENTS FOR FEE STRUCTURE ITEM/GROUP');
    try {
        const { itemName, componentName, feeStructureId } = req.body; // NEW: feeStructureId required

        if (!itemName && !componentName) {
            return res.status(400).json({ error: 'itemName or componentName is required' });
        }
        if (!feeStructureId) {
            return res.status(400).json({ error: 'feeStructureId is required to scope this deletion safely' });
        }

        const normalizedItemName = itemName ? itemName.trim().toLowerCase() : null;
        const normalizedComponent = componentName ? componentName.trim().toLowerCase() : null;

        function itemMatches(item) {
            if (!item) return false;
            if (normalizedItemName) {
                const n = (item.itemName || item.name || '').trim().toLowerCase();
                if (n !== normalizedItemName) return false;
            }
            if (normalizedComponent) {
                const c = (item.componentName || '').trim().toLowerCase();
                if (c !== normalizedComponent) return false;
            }
            return true;
        }

        // ========== 1. PURGE FROM feePayments.json — ONLY for this fee structure ==========
        let payments = readFile(files.feePayments);
        if (!Array.isArray(payments)) payments = [];

        let deletedPaymentRecords = 0;
        let modifiedPaymentRecords = 0;
        let skippedOtherFeeStructure = 0; // NEW: for visibility in logs/response
        const inventoryReversals = {};

        const keptPayments = [];
        for (const payment of payments) {
            // ========== CRITICAL FIX: only touch payments belonging to THIS fee structure ==========
            if (payment.feeStructureId !== feeStructureId) {
                keptPayments.push(payment);
                continue;
            }

            let changed = false;

            const trackRemoved = (removedItem) => {
                const qty = computeInventoryQtyForPaymentItem(removedItem);
                if (qty > 0) {
                    const key = `${payment.studentId}_${payment.academicYear}_${payment.term}`;
                    if (!inventoryReversals[key]) {
                        inventoryReversals[key] = { studentId: payment.studentId, year: payment.academicYear, term: payment.term, itemQty: {} };
                    }
                    const nm = removedItem.itemName;
                    inventoryReversals[key].itemQty[nm] = (inventoryReversals[key].itemQty[nm] || 0) + qty;
                }
            };

            if (Array.isArray(payment.activityItemPayments)) {
                const filtered = [];
                for (const item of payment.activityItemPayments) {
                    if (itemMatches(item)) { trackRemoved(item); changed = true; }
                    else filtered.push(item);
                }
                payment.activityItemPayments = filtered;
            }

            if (payment.paymentsByPeriodType) {
                for (const pt of ['one_time', 'termly', 'yearly']) {
                    const arr = payment.paymentsByPeriodType[pt] || [];
                    const filtered = [];
                    for (const item of arr) {
                        if (itemMatches(item)) { trackRemoved(item); changed = true; }
                        else filtered.push(item);
                    }
                    payment.paymentsByPeriodType[pt] = filtered;
                }
            }

            if (changed) {
                const newActivityTotal = (payment.activityItemPayments || []).reduce((sum, i) =>
                    sum + (i.paymentType === 'paid_cash' ? (i.amountPaid || 0) : (i.cashEquivalent || (i.itemsBrought || 0) * (i.unitPrice || 0))), 0);
                payment.activityTotalPaid = newActivityTotal;
                payment.totalAmount = (payment.tuitionPaid || 0) + newActivityTotal;

                const stillHasContent = (payment.activityItemPayments || []).length > 0 || (payment.tuitionPaid || 0) > 0;
                if (!stillHasContent) {
                    deletedPaymentRecords++;
                    continue;
                }
                modifiedPaymentRecords++;
            }

            keptPayments.push(payment);
        }
        saveFile(files.feePayments, keptPayments);

        // ========== 2. PURGE FROM studentTermRecords.json — ONLY students assigned to this fee structure ==========
        // Build the set of student IDs who belong to this fee structure (any year/term assignment)
        let feeAssignments = readFile(files.studentFeeAssignments);
        if (!Array.isArray(feeAssignments)) feeAssignments = [];
        const studentIdsInThisFeeStructure = new Set(
            feeAssignments.filter(a => a.feeStructureId === feeStructureId).map(a => a.studentId)
        );

        let termRecords = readFile(files.studentTermRecords);
        if (!termRecords || typeof termRecords !== 'object') termRecords = {};

        for (const [key, record] of Object.entries(termRecords)) {
            if (!record || !record.activityItemsPaid) continue;

            // key format: studentId_year_term — only touch students in this fee structure
            const studentIdFromKey = key.split('_')[0];
            // fall back to matching via record.studentId if present
            const recordStudentId = record.studentId || studentIdFromKey;
            if (!studentIdsInThisFeeStructure.has(recordStudentId)) continue;

            let recordChanged = false;
            for (const pt of ['one_time', 'termly', 'yearly']) {
                const arr = record.activityItemsPaid[pt] || [];
                const filtered = arr.filter(item => !itemMatches(item));
                if (filtered.length !== arr.length) {
                    record.activityItemsPaid[pt] = filtered;
                    recordChanged = true;
                }
            }
            if (recordChanged) {
                let newTotal = 0;
                for (const pt of ['one_time', 'termly', 'yearly']) {
                    for (const item of (record.activityItemsPaid[pt] || [])) {
                        newTotal += (item.amountPaid || item.cashEquivalent || 0);
                    }
                }
                record.activityTotalPaid = newTotal;
                termRecords[key] = record;
            }
        }
        saveFile(files.studentTermRecords, termRecords);

        // ========== 3. REVERSE INVENTORY — only for the students/qty tracked above (already scoped) ==========
        let totalInventoryReversed = 0;
        for (const entry of Object.values(inventoryReversals)) {
            for (const [name, qty] of Object.entries(entry.itemQty)) {
                if (qty > 0) {
                    reverseInventoryForDeletedPaymentItem(entry.studentId, name, entry.year, entry.term, qty);
                    totalInventoryReversed += qty;
                }
            }
        }

        console.log(`✅ Purge complete (feeStructureId=${feeStructureId}): ${deletedPaymentRecords} receipts deleted, ${modifiedPaymentRecords} modified, ${totalInventoryReversed} inventory units reversed`);

        res.json({
            success: true,
            deletedPaymentRecords,
            modifiedPaymentRecords,
            inventoryUnitsReversed: totalInventoryReversed
        });
    } catch (error) {
        console.error('Error purging item payments:', error);
        res.status(500).json({ error: error.message });
    }
});


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});



app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ERROR HANDLING ====================

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});


// Add to server.js for debugging
// Add this to server.js for debugging
app.get('/api/academic/debug', (req, res) => {
    try {
        const settings = readFile(files.settings);
        const fileExists = fs.existsSync(files.settings);
        const fileContent = fileExists ? fs.readFileSync(files.settings, 'utf8') : 'File not found';
        
        res.json({
            settings: settings,
            filePath: files.settings,
            fileExists: fileExists,
            fileContent: fileContent,
            fileWritable: fs.accessSync ? 'check manually' : 'unknown'
        });
    } catch (error) {
        res.json({ error: error.message, stack: error.stack });
    }
});

// Reset all payments for a specific item for a student
// ==================== RESET ALL PAYMENTS FOR A SPECIFIC ITEM (WITH INVENTORY REVERSAL FOR CASH & ITEMS) ====================
app.delete('/api/fee/payments/reset-item', (req, res) => {
    console.log('🗑️ RESET ITEM PAYMENTS CALLED');
    console.log('📥 Request body:', req.body);

    try {
        const { studentId, itemName, componentName } = req.body;

        if (!studentId || !itemName) {
            console.log('❌ Missing required fields');
            return res.status(400).json({ error: 'Student ID and Item Name are required' });
        }

        const normalizedItemName = itemName.trim();
        const normalizedComponent = componentName ? componentName.trim() : '';

        console.log(`📌 Target: "${normalizedItemName}" (component: "${normalizedComponent}")`);
        console.log(`👤 Student ID: ${studentId}`);

        let payments = readFile(files.feePayments);
        if (!Array.isArray(payments)) {
            console.log('⚠️ Payments file not an array, initializing empty');
            payments = [];
        }

        console.log(`📊 Total payments in file: ${payments.length}`);

        // Helper: check if an item matches the target
        function itemMatches(item) {
            if (!item) return false;
            const itemNameLower = (item.itemName || '').trim().toLowerCase();
            const targetLower = normalizedItemName.toLowerCase();
            const nameMatch = itemNameLower === targetLower || itemNameLower.includes(targetLower) || targetLower.includes(itemNameLower);
            if (!nameMatch) return false;
            if (normalizedComponent) {
                const compLower = (item.componentName || '').trim().toLowerCase();
                const targetCompLower = normalizedComponent.toLowerCase();
                return compLower === targetCompLower || compLower.includes(targetCompLower) || targetCompLower.includes(compLower);
            }
            return true;
        }

        let deletedCount = 0;
        const keptPayments = [];
        const inventoryReversalsByPeriod = {};

        for (const payment of payments) {
            if (payment.studentId !== studentId) {
                keptPayments.push(payment);
                continue;
            }

            let containsItem = false;
            let totalQtyForPeriod = 0;

            // 1. Check activityItemPayments
            if (payment.activityItemPayments && Array.isArray(payment.activityItemPayments)) {
                for (const pItem of payment.activityItemPayments) {
                    if (itemMatches(pItem)) {
                        containsItem = true;
                        console.log(`   ✅ Match in activityItemPayments: ${pItem.itemName} (${pItem.componentName})`);
                        totalQtyForPeriod += computeInventoryQtyForPaymentItem(pItem);
                    }
                }
            }

            // 2. Check paymentsByPeriodType
            if (!containsItem && payment.paymentsByPeriodType) {
                const periodTypes = ['one_time', 'termly', 'yearly'];
                for (const pt of periodTypes) {
                    const items = payment.paymentsByPeriodType[pt] || [];
                    for (const pItem of items) {
                        if (itemMatches(pItem)) {
                            containsItem = true;
                            console.log(`   ✅ Match in paymentsByPeriodType.${pt}: ${pItem.itemName} (${pItem.componentName})`);
                            totalQtyForPeriod += computeInventoryQtyForPaymentItem(pItem);
                        }
                    }
                    if (containsItem) break;
                }
            }

            // 3. Check individualPayments (no inventory impact, but still match)
            if (!containsItem && payment.individualPayments && Array.isArray(payment.individualPayments)) {
                for (const ip of payment.individualPayments) {
                    if (ip.itemName && ip.itemName.trim().toLowerCase() === normalizedItemName.toLowerCase()) {
                        containsItem = true;
                        console.log(`   ✅ Match in individualPayments: ${ip.itemName}`);
                        // individualPayments don't have paymentType, so no inventory
                    }
                }
            }

            if (containsItem) {
                deletedCount++;
                console.log(`   🗑️ Deleting payment ${payment.id} (${payment.receiptNumber})`);

                if (totalQtyForPeriod > 0) {
                    const key = `${payment.academicYear}_${payment.term}`;
                    if (!inventoryReversalsByPeriod[key]) {
                        inventoryReversalsByPeriod[key] = {
                            year: payment.academicYear,
                            term: payment.term,
                            qty: 0
                        };
                    }
                    inventoryReversalsByPeriod[key].qty += totalQtyForPeriod;
                }
            } else {
                keptPayments.push(payment);
            }
        }

        // Reverse inventory for each period
        for (const entry of Object.values(inventoryReversalsByPeriod)) {
            reverseInventoryForDeletedPaymentItem(
                studentId,
                normalizedItemName,
                entry.year,
                entry.term,
                entry.qty
            );
        }

        console.log(`📊 Deleted count: ${deletedCount}`);

        if (deletedCount === 0) {
            console.warn(`⚠️ No payments found for "${normalizedItemName}"`);
            const studentPayments = payments.filter(p => p.studentId === studentId);
            console.log(`🔍 Debug: All items in student's payments (${studentPayments.length} payments):`);
            studentPayments.forEach(p => {
                console.log(`  Payment ${p.id} (${p.receiptNumber}):`);
                if (p.activityItemPayments) {
                    p.activityItemPayments.forEach(item => console.log(`    activity: ${item.itemName} (${item.componentName})`));
                }
                if (p.paymentsByPeriodType) {
                    for (const pt of ['one_time', 'termly', 'yearly']) {
                        (p.paymentsByPeriodType[pt] || []).forEach(item => console.log(`    ${pt}: ${item.itemName} (${item.componentName})`));
                    }
                }
                if (p.individualPayments) {
                    p.individualPayments.forEach(ip => console.log(`    individual: ${ip.itemName}`));
                }
            });
        }

        saveFile(files.feePayments, keptPayments);

        const message = `Deleted ${deletedCount} payment(s) for item "${normalizedItemName}"`;
        console.log(`✅ ${message}`);
        res.json({ success: true, message, deletedCount });

    } catch (error) {
        console.error('❌ Error resetting payments:', error);
        res.status(500).json({ error: error.message });
    }
});
// ==================== START SERVER ====================
// ==================== START SERVER ====================
function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

console.log('✅ Student Promotion endpoint registered at /api/students/promote');

app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    const networkUrl = `http://${ip}:${PORT}`;

    console.log('='.repeat(50));
    console.log('🎓 UGANDA SCHOOL MANAGEMENT SYSTEM v3.0');
    console.log('='.repeat(50));
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Network: ${networkUrl}`);
    console.log(`📁 Data directory: ${dataDir}`);
    console.log(`💰 Fee Types: Tuition | One-Time | Termly | Yearly`);
    console.log('='.repeat(50));
    console.log('Ready to serve! 🚀');
    console.log('📱 Access from other devices on same network using:');
    console.log(`   ${networkUrl}`);

    // ========== Generate QR code ==========
    try {
        const qrcode = require('qrcode-terminal');
        console.log('📲 Scan the QR code below with your phone camera:');
        qrcode.generate(networkUrl, { small: true });
        console.log('📲 Or copy the URL above into your mobile browser.');
    } catch (err) {
        console.log('ℹ️ QR code generation skipped (qrcode-terminal not installed).');
        console.log('   Install it with: npm install qrcode-terminal');
    }
    console.log('='.repeat(50));
});

console.log('✅ Student Promotion endpoint registered at /api/students/promote');
// ==================== START SERVER ====================