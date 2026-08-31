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
                        enrollmentDate: new Date().toISOString().split('T')[0],
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
                        e.academicYear === currentYear &&
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
                            academicYear: currentYear,
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
                            academicYear: currentYear,
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
            enrollmentDate: enrollmentDate || new Date().toISOString().split('T')[0],
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
            academicYear: parseInt(currentYear),
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
                academicYear: parseInt(currentYear),
                assignedAt: new Date().toISOString()
            });
            saveFile(files.studentFeeAssignments, assignments);
            console.log(`💰 Fee assignment saved for academic year ${currentYear}`);
        }

        console.log('✅✅✅ Registration complete!');
        res.json({
            success: true,
            student: newStudent,
            message: 'Student registered successfully',
            summary: {
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
            stock[stockKey].available = Math.max(0, (stock[stockKey].availabl