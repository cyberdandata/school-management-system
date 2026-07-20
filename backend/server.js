const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
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
    res.json(syncManager.getStatus());
});

// Trigger manual sync
app.post('/api/sync/trigger', async (req, res) => {
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
const dataDir = path.join(__dirname, 'data');

// Ensure data directory exists
// Ensure data directory exists with proper permissions
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Created data directory: ${dataDir}`);
}

// Also ensure each file's parent directory exists before writing


// Define all file paths - FIXED: Use consistent naming
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

// ==================== HELPER FUNCTIONS ====================
// ==================== FIXED READ FILE FUNCTION ====================
// ==================== CORRECTED READ FILE FUNCTION ====================
function saveFile(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`📁 Created directory: ${dir}`);
        }
        
        const jsonData = JSON.stringify(data, null, 2);
        fs.writeFileSync(filePath, jsonData, 'utf8');
        
        // ✅ Verify the file was written
        if (fs.existsSync(filePath)) {
            const written = fs.readFileSync(filePath, 'utf8');
            console.log(`✅ File saved: ${filePath}`);
            console.log(`📄 Content length: ${written.length} bytes`);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`❌ Error writing ${filePath}:`, error);
        return false;
    }
}

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

function saveFile(filePath, data) {
    try {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`📁 Created directory: ${dir}`);
        }
        
        // Write the file
        const jsonData = JSON.stringify(data, null, 2);
        fs.writeFileSync(filePath, jsonData, 'utf8');
        
        // Verify the file was written
        if (fs.existsSync(filePath)) {
            const written = fs.readFileSync(filePath, 'utf8');
            console.log(`✅ File saved: ${filePath}`);
            console.log(`📄 Content length: ${written.length} bytes`);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`❌ Error writing ${filePath}:`, error.message);
        return false;
    }
}
// ==================== FIXED SAVE FILE FUNCTION ====================
function saveFile(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`📁 Created directory: ${dir}`);
        }
        
        const jsonData = JSON.stringify(data, null, 2);
        fs.writeFileSync(filePath, jsonData, 'utf8');
        
        // ✅ Verify the file was written
        if (fs.existsSync(filePath)) {
            const written = fs.readFileSync(filePath, 'utf8');
            console.log(`✅ File saved: ${filePath}`);
            console.log(`📄 Content length: ${written.length} bytes`);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`❌ Error writing ${filePath}:`, error);
        return false;
    }
}


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

// ==================== TEACHER ROUTES ====================

app.get('/api/teachers', (req, res) => {
    res.json(readFile(files.teachers));
});

app.get('/api/teachers/:id', (req, res) => {
    const teachers = readFile(files.teachers);
    const teacher = teachers.find(t => t.id === req.params.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
    res.json(teacher);
});

app.post('/api/teachers', (req, res) => {
    const { firstName, lastName, gender, phone, email, qualification, specialization, subjects, classes, joinedAt } = req.body;
    const teachers = readFile(files.teachers);
    
    const teacherId = `TCH${new Date().getFullYear()}${String(teachers.length + 1).padStart(4, '0')}`;
    
    const newTeacher = {
        id: uuidv4(),
        teacherId,
        firstName,
        lastName,
        gender: gender || 'Male',
        phone,
        email: email || '',
        qualification: qualification || '',
        specialization: specialization || '',
        subjects: subjects || [],
        classes: classes || [],
        joinedAt: joinedAt || new Date().toISOString().split('T')[0],
        status: 'Active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    teachers.push(newTeacher);
    saveFile(files.teachers, teachers);
    res.json({ success: true, teacher: newTeacher });
});

app.put('/api/teachers/:id', (req, res) => {
    let teachers = readFile(files.teachers);
    const index = teachers.findIndex(t => t.id === req.params.id);
    if (index !== -1) {
        teachers[index] = { ...teachers[index], ...req.body, updatedAt: new Date().toISOString() };
        saveFile(files.teachers, teachers);
        res.json({ success: true, teacher: teachers[index] });
    } else {
        res.status(404).json({ error: 'Teacher not found' });
    }
});

app.delete('/api/teachers/:id', (req, res) => {
    let teachers = readFile(files.teachers);
    teachers = teachers.filter(t => t.id !== req.params.id);
    saveFile(files.teachers, teachers);
    res.json({ success: true });
});

// ==================== STUDENT ROUTES ====================

// ==================== FIXED GET STUDENTS ENDPOINT ====================

// ==================== FIXED GET STUDENTS ENDPOINT - PRESERVES CUSTOM FIELDS ====================

app.get('/api/students', (req, res) => {
    try {
        const students = readFile(files.students);
        const enrollments = readFile(files.enrollments);
        const classes = readFile(files.classes);
        
        // Create a map for quick class lookup
        const classMap = {};
        classes.forEach(c => {
            classMap[c.id] = c;
        });
        
        // Process each student - PRESERVE ALL FIELDS including customizations
        const studentsWithClass = students.map(student => {
            const currentEnrollment = enrollments.find(e => e.studentId === student.id && e.isCurrent);
            const currentClass = currentEnrollment ? classMap[currentEnrollment.classId] : null;
            
            // Return the student with ALL original fields preserved
            return { 
                ...student,  // This preserves ALL fields including customItemOverrides
                currentClass: currentClass?.name || null,
                currentClassId: currentEnrollment?.classId || null
            };
        });
        
        console.log(`✅ Returning ${studentsWithClass.length} students with custom fields preserved`);
        
        res.json(studentsWithClass);
    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({ error: 'Failed to fetch students' });
    }
});

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
        
        const currentEnrollment = enrollments.find(e => e.studentId === student.id && e.isCurrent);
        const currentClass = currentEnrollment ? classes.find(c => c.id === currentEnrollment.classId) : null;
        
        // Return student with ALL original fields preserved
        const result = {
            ...student,  // This preserves ALL fields including customItemOverrides
            currentClass: currentClass?.name || null,
            currentClassId: currentEnrollment?.classId || null,
            enrollments: enrollments.filter(e => e.studentId === student.id),
            scores: scores.filter(s => s.studentId === student.id).map(s => ({
                ...s,
                assessment: assessments.find(a => a.id === s.assessmentId)
            }))
        };
        
        console.log(`✅ Returning student ${student.firstName} ${student.lastName} with all fields`);
        
        res.json(result);
    } catch (error) {
        console.error('Error fetching student:', error);
        res.status(500).json({ error: 'Failed to fetch student' });
    }
});


// ==================== IMPORT STUDENTS FROM EXCEL ====================
app.post('/api/students/import', upload.single('file'), async (req, res) => {
    console.log('=== STUDENT IMPORT v4.0 - DAY vs BOARDING FIXED ===');
    
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
                
                if (existingStudent) {
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
                    studentId = uuidv4();
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
                        enrolledAt: new Date().toISOString(),
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };
                    students.push(studentData);
                    results.success++;
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
                            assignedAt: new Date().toISOString()
                        });
                    }
                    
                    results.feeAssignments.push({
                        studentId: studentId,
                        feeStructureId: feeStructureId,
                        feeStructureName: matchedFeeStructureName || 'Unknown',
                        isBoarding: isBoardingDetected
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
        
        console.log(`✅ Import complete: ${results.success} successful, ${results.failed} failed`);
        console.log(`   Class assignments: ${results.classAssignments.length}`);
        console.log(`   Fee assignments: ${results.feeAssignments.length}`);
        
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
        
        if (results.errors.length > 0) {
            responseMessage += `\n⚠️ Errors:\n${results.errors.slice(0, 10).join('\n')}`;
            if (results.errors.length > 10) {
                responseMessage += `\n... and ${results.errors.length - 10} more errors`;
            }
        }
        
        res.json({
            success: true,
            message: responseMessage,
            results: results
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
    console.log('=== REGISTRATION REQUEST RECEIVED ===');
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
            removedItems        // NEW: Items to remove (student does not pay)
        } = req.body;
        
        // Validate required fields
        if (!firstName || !lastName || !gender || !parentName || !parentPhone || !address || !enrollmentClass || !feeStructureId) {
            console.log('Missing required fields');
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Read existing data
        let students = readFile(files.students);
        if (!Array.isArray(students)) students = [];
        
        // Generate admission number
        const currentYear = academicYear || new Date().getFullYear();
        const nextNumber = String(students.length + 1).padStart(4, '0');
        const admissionNumber = `STU${currentYear}${nextNumber}`;
        
        // Handle custom bursary
        let customBursary = null;
        if (customBursaryAmount && customBursaryAmount > 0) {
            customBursary = {
                amount: customBursaryAmount,
                appliedAt: new Date().toISOString(),
                description: 'Special custom bursary applied during registration'
            };
            console.log('Custom bursary applied:', customBursary);
        }
        
        // Handle custom transportation
        let customTransportationData = null;
        if (customTransportation) {
            customTransportationData = {
                hasTransportation: customTransportation.hasTransportation === true,
                amount: customTransportation.hasTransportation ? (customTransportation.amount || null) : null,
                itemId: customTransportation.itemId || null,
                componentId: customTransportation.componentId || null,
                appliedAt: new Date().toISOString(),
                description: customTransportation.hasTransportation ? 
                    'Custom transportation fee applied' : 
                    'Student does not use school transport'
            };
            console.log('Custom transportation applied:', customTransportationData);
        }
        
        // ========== HANDLE CUSTOM ITEM OVERRIDES ==========
        let customItemOverridesData = null;
        if (customItemOverrides && Object.keys(customItemOverrides).length > 0) {
            customItemOverridesData = {};
            
            // Fetch the fee structure to get default values
            const feeStructures = readFile(files.feeStructures);
            const feeStructure = feeStructures.find(f => f.id === feeStructureId);
            
            for (const [itemId, customData] of Object.entries(customItemOverrides)) {
                if (customData.isCustomized) {
                    // Find the item in the fee structure to get defaults
                    let defaultAmount = customData.defaultAmount || 0;
                    let defaultQuantity = customData.defaultQuantity || 1;
                    let itemName = customData.itemName || itemId;
                    let componentId = customData.componentId || null;
                    
                    // Try to find the item in the fee structure if defaults not provided
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
                    
                    customItemOverridesData[itemId] = {
                        itemId: itemId,
                        itemName: customData.itemName || itemName,
                        componentId: customData.componentId || componentId,
                        customAmount: customData.customAmount !== null && customData.customAmount !== undefined ? parseFloat(customData.customAmount) : null,
                        customQuantity: customData.customQuantity !== null && customData.customQuantity !== undefined ? parseInt(customData.customQuantity) : null,
                        paymentOption: customData.paymentOption || null,
                        defaultAmount: defaultAmount,
                        defaultQuantity: defaultQuantity,
                        reason: customData.reason || 'Customized during registration',
                        isActive: true,
                        updatedAt: new Date().toISOString(),
                        updatedBy: 'Registration'
                    };
                }
            }
            
            console.log('Custom item overrides applied:', Object.keys(customItemOverridesData).length);
        }
        
        // ========== HANDLE REMOVED ITEMS (Student does not pay) ==========
        let removedItemsData = null;
        if (removedItems && Object.keys(removedItems).length > 0) {
            removedItemsData = {};
            
            // Fetch the fee structure to get item details
            const feeStructures = readFile(files.feeStructures);
            const feeStructure = feeStructures.find(f => f.id === feeStructureId);
            
            for (const [itemId, isRemoved] of Object.entries(removedItems)) {
                if (isRemoved === true) {
                    let itemName = itemId;
                    let componentName = 'Unknown Component';
                    let componentId = null;
                    let defaultAmount = 0;
                    let defaultQuantity = 1;
                    let paymentOption = 'either';
                    
                    // Try to find the item in the fee structure
                    if (feeStructure && feeStructure.activityComponents) {
                        for (const comp of feeStructure.activityComponents) {
                            for (const item of (comp.items || [])) {
                                if (item.id === itemId || item.name === itemId) {
                                    itemName = item.name || itemId;
                                    componentName = comp.name || 'Unknown Component';
                                    componentId = comp.id || null;
                                    defaultAmount = item.totalAmount || 0;
                                    defaultQuantity = item.quantity || 1;
                                    paymentOption = item.paymentOption || 'either';
                                    break;
                                }
                            }
                            if (componentId) break;
                        }
                    }
                    
                    removedItemsData[itemId] = {
                        itemId: itemId,
                        itemName: itemName,
                        componentId: componentId,
                        componentName: componentName,
                        defaultAmount: defaultAmount,
                        defaultQuantity: defaultQuantity,
                        paymentOption: paymentOption,
                        removedAt: new Date().toISOString(),
                        reason: 'Removed during registration',
                        isActive: true
                    };
                }
            }
            
            console.log('Removed items applied:', Object.keys(removedItemsData).length);
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
            
            // ========== NEW: REMOVED ITEMS ==========
            removedItems: removedItemsData,
            
            // Tracking flags
            hasCustomizations: customItemOverridesData && Object.keys(customItemOverridesData).length > 0,
            hasRemovedItems: removedItemsData && Object.keys(removedItemsData).length > 0,
            customizationCount: customItemOverridesData ? Object.keys(customItemOverridesData).length : 0,
            removedItemsCount: removedItemsData ? Object.keys(removedItemsData).length : 0,
            
            // Fee structure reference
            assignedFeeStructureId: feeStructureId
        };
        
        console.log('Creating student with:', {
            name: `${firstName} ${lastName}`,
            admissionNumber: admissionNumber,
            customBursary: customBursary ? true : false,
            customTransportation: customTransportationData ? true : false,
            customItemOverrides: customItemOverridesData ? Object.keys(customItemOverridesData).length : 0,
            removedItems: removedItemsData ? Object.keys(removedItemsData).length : 0
        });
        
        // Save student
        students.push(newStudent);
        const saved = saveFile(files.students, students);
        
        if (!saved) {
            console.error('Failed to save student to file');
            return res.status(500).json({ error: 'Failed to save student data' });
        }
        
        console.log('Student saved successfully with ID:', newStudent.id);
        
        // Create enrollment record
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
        
        // Save fee assignment
        if (feeStructureId) {
            let assignments = readFile(files.studentFeeAssignments);
            if (!Array.isArray(assignments)) assignments = [];
            
            let finalBursaryId = null;
            if (bursaryId === 'custom') {
                finalBursaryId = null;
            } else if (bursaryId && bursaryId !== '') {
                finalBursaryId = bursaryId;
            }
            
            assignments.push({
                id: uuidv4(),
                studentId: newStudent.id,
                feeStructureId: feeStructureId,
                bursaryId: finalBursaryId,
                customBursaryAmount: customBursaryAmount > 0 ? customBursaryAmount : null,
                assignedAt: new Date().toISOString()
            });
            saveFile(files.studentFeeAssignments, assignments);
        }
        
        console.log('Registration complete!');
        res.json({ 
            success: true, 
            student: newStudent,
            message: 'Student registered successfully',
            summary: {
                customizations: newStudent.customizationCount || 0,
                removedItems: newStudent.removedItemsCount || 0,
                hasBursary: customBursary ? true : false,
                hasCustomTransport: customTransportationData ? true : false
            }
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== UPDATED STUDENT UPDATE WITH CUSTOMIZATIONS ====================

app.put('/api/students/:id', (req, res) => {
    try {
        let students = readFile(files.students);
        const index = students.findIndex(s => s.id === req.params.id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        const student = students[index];
        const updatedData = req.body;
        
        // Handle custom item overrides if provided
        if (updatedData.customItemOverrides) {
            // Merge with existing overrides
            if (!student.customItemOverrides) {
                student.customItemOverrides = {};
            }
            
            // For each override, update or add
            for (const [itemId, customData] of Object.entries(updatedData.customItemOverrides)) {
                if (customData.isCustomized) {
                    // Fetch the fee structure to get default values if needed
                    const feeStructures = readFile(files.feeStructures);
                    const assignment = readFile(files.studentFeeAssignments).find(a => a.studentId === student.id);
                    const feeStructure = feeStructures.find(f => f.id === assignment?.feeStructureId);
                    
                    let defaultAmount = customData.defaultAmount || 0;
                    let defaultQuantity = customData.defaultQuantity || 1;
                    let itemName = customData.itemName || itemId;
                    let componentId = customData.componentId || null;
                    
                    // Try to find the item in the fee structure if defaults not provided
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
                    
                    student.customItemOverrides[itemId] = {
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
                    // Remove customization if not marked as customized
                    delete student.customItemOverrides[itemId];
                }
            }
            
            // Update counts
            const count = Object.keys(student.customItemOverrides).length;
            student.hasCustomizations = count > 0;
            student.customizationCount = count;
            
            // Remove the customItemOverrides from updatedData to avoid overwriting
            delete updatedData.customItemOverrides;
        }
        
        // Apply all other updates
        students[index] = { 
            ...student, 
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

app.post('/api/students/promote', (req, res) => {
    const { studentIds, toClassId, academicYear } = req.body;
    if (!studentIds || !studentIds.length) {
        return res.status(400).json({ error: 'No students selected' });
    }
    
    let enrollments = readFile(files.enrollments);
    const currentYear = academicYear || new Date().getFullYear();
    const nextYear = currentYear + 1;
    
    studentIds.forEach(studentId => {
        const currentEnrollment = enrollments.find(e => e.studentId === studentId && e.isCurrent);
        if (currentEnrollment) {
            currentEnrollment.isCurrent = false;
            currentEnrollment.completedAt = new Date().toISOString();
        }
        
        enrollments.push({
            id: uuidv4(),
            studentId: studentId,
            classId: toClassId,
            academicYear: nextYear,
            isCurrent: true,
            promotedFrom: currentEnrollment?.classId,
            promotedAt: new Date().toISOString()
        });
    });
    
    saveFile(files.enrollments, enrollments);
    res.json({ success: true, promotedCount: studentIds.length });
});

// ==================== GRADING SYSTEM ROUTES ====================

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
        
        // Process the activity components
        const processedComponents = [];
        
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
                        processedItems.push({
                            id: item.id || uuidv4(),
                            name: item.name,
                            quantity: quantity,
                            cashAmount: cashAmount,
                            totalAmount: finalAmount,
                            unitPrice: quantity > 0 ? finalAmount / quantity : 0,
                            paymentOption: item.paymentOption || 'cash_only',
                            isTangible: item.isTangible !== false
                        });
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
        res.json({ success: true, feeStructure: structures[index] });
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

app.post('/api/student-fee-assignments', (req, res) => {
    const { studentId, feeStructureId, bursaryId } = req.body;
    let assignments = readFile(files.studentFeeAssignments);
    
    const existingIndex = assignments.findIndex(a => a.studentId === studentId);
    const assignment = {
        id: existingIndex !== -1 ? assignments[existingIndex].id : uuidv4(),
        studentId,
        feeStructureId: feeStructureId || null,
        bursaryId: bursaryId || null,
        assignedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    if (existingIndex !== -1) assignments[existingIndex] = assignment;
    else assignments.push(assignment);
    
    saveFile(files.studentFeeAssignments, assignments);
    res.json({ success: true });
});

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

app.delete('/api/fee/payments/:id', (req, res) => {
    let payments = readFile(files.feePayments);
    payments = payments.filter(p => p.id !== req.params.id);
    saveFile(files.feePayments, payments);
    res.json({ success: true });
});


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

app.get('/api/reports/comprehensive', async (req, res) => {
    console.log('=== COMPREHENSIVE REPORT v11.0 - FULLY REBUILT ===');
    
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

        // 4.6: Check if Item is Removed
        function isItemRemoved(student, itemId) {
            if (!student || !student.removedItems) return false;
            return student.removedItems[itemId] && student.removedItems[itemId].isActive !== false;
        }

        // 4.7: Get Period-Scoped Payments (CRITICAL FIX)
      // In the /api/reports/comprehensive endpoint, find this section:

// ================================================================
// FIXED: Get Period-Scoped Payments
// ================================================================
// ================================================================
// COMPLETE FIX: getPeriodScopedPayments - Correct Yearly Scoping
// ================================================================
// ================================================================
// PERMANENT FIX: getPeriodScopedPayments
// ================================================================
function getPeriodScopedPayments(studentId, periodType, year, term, allPaymentsData) {
    // Get all payments for this student
    const studentPayments = allPaymentsData.filter(p => p && p.studentId === studentId);
    
    if (periodType === 'one_time') {
        // One-Time: Check ALL payments FOREVER
        return studentPayments;
    } 
    else if (periodType === 'yearly') {
        // ✅ PERMANENT FIX: Yearly - Check ALL terms in the SAME academic year
        // This ensures Development Fee (paid in Term 1) is found
        return studentPayments.filter(p => {
            if (!p || !p.academicYear) return false;
            return parseInt(p.academicYear) === year;
        });
    } 
    else {
        // Termly: Check ONLY the CURRENT term
        return studentPayments.filter(p => {
            if (!p) return false;
            return p.term === term && parseInt(p.academicYear) === year;
        });
    }
}

// ================================================================
// FIXED: getPaidAmountsForItem - With Debug Logging
// ================================================================
function getPaidAmountsForItem(studentId, componentName, itemName, periodType, year, term, allPaymentsData) {
    console.log(`🔍 getPaidAmountsForItem: ${itemName} (${periodType}) for ${studentId}`);
    
    const scopedPayments = getPeriodScopedPayments(studentId, periodType, year, term, allPaymentsData);
    
    let cashPaid = 0;
    let itemsBrought = 0;
    const paymentHistories = [];
    const processedKeys = new Set();
    
    console.log(`   📊 Processing ${scopedPayments.length} payments for ${itemName}`);
    
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
                    if (!processedKeys.has(key)) {
                        processedKeys.add(key);
                        
                        if (paidItem.paymentType === 'paid_cash') {
                            const amount = (paidItem.amountPaid || 0);
                            cashPaid += amount;
                            console.log(`   💵 Found cash payment: ${itemName} = UGX ${amount}`);
                            paymentHistories.push({
                                type: 'cash',
                                amount: amount,
                                date: payment.date || new Date().toISOString(),
                                receiptNumber: payment.receiptNumber || 'N/A'
                            });
                        } else if (paidItem.paymentType === 'brought_item') {
                            const qty = (paidItem.itemsBrought || 0);
                            itemsBrought += qty;
                            console.log(`   📦 Found items brought: ${itemName} = ${qty}`);
                            paymentHistories.push({
                                type: 'item',
                                quantity: qty,
                                date: payment.date || new Date().toISOString(),
                                receiptNumber: payment.receiptNumber || 'N/A'
                            });
                        }
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
                        if (!processedKeys.has(key)) {
                            processedKeys.add(key);
                            
                            if (paidItem.paymentType === 'paid_cash') {
                                const amount = (paidItem.amountPaid || 0);
                                cashPaid += amount;
                                console.log(`   💵 Found cash payment (byPeriodType): ${itemName} = UGX ${amount}`);
                                paymentHistories.push({
                                    type: 'cash',
                                    amount: amount,
                                    date: payment.date || new Date().toISOString(),
                                    receiptNumber: payment.receiptNumber || 'N/A'
                                });
                            } else if (paidItem.paymentType === 'brought_item') {
                                const qty = (paidItem.itemsBrought || 0);
                                itemsBrought += qty;
                                console.log(`   📦 Found items brought (byPeriodType): ${itemName} = ${qty}`);
                                paymentHistories.push({
                                    type: 'item',
                                    quantity: qty,
                                    date: payment.date || new Date().toISOString(),
                                    receiptNumber: payment.receiptNumber || 'N/A'
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    
    console.log(`   📊 Result for ${itemName}: cashPaid=${cashPaid}, itemsBrought=${itemsBrought}`);
    
    return { cashPaid, itemsBrought, paymentHistories };
}

        // 4.8: Get Paid Amounts for Item with Period Scoping
        function getPaidAmountsForItem(studentId, componentName, itemName, periodType, year, term, allPaymentsData) {
            const scopedPayments = getPeriodScopedPayments(studentId, periodType, year, term, allPaymentsData);
            
            let cashPaid = 0;
            let itemsBrought = 0;
            const paymentHistories = [];
            const uniquePaymentItems = new Map();
            const processedKeys = new Set();
            
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
                            if (!processedKeys.has(key)) {
                                processedKeys.add(key);
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

        // 4.9: Calculate Item Totals with OR Logic (CRITICAL FIX)
        function calculateItemTotalsWithORLogic(qtyRequired, amountExpected, paymentOption, cashPaid, itemsBrought) {
            const finalItemsBrought = Math.min(itemsBrought, qtyRequired);
            let cashExpected = 0;
            let finalCashPaid = 0;
            
            if (paymentOption === 'cash_only') {
                // Cash Only: Only money matters
                cashExpected = amountExpected;
                finalCashPaid = Math.min(cashPaid, amountExpected);
            } else if (paymentOption === 'item_only') {
                // Item Only: NO cash expected, NO cash paid
                cashExpected = 0;
                finalCashPaid = 0;
            } else {
                // 'either' - OR Logic
                if (finalItemsBrought >= qtyRequired && qtyRequired > 0) {
                    // Fully paid by items → 0 cash needed
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
        // STEP 5: GET ALL PERIODS FOR STUDENT
        // ================================================================
        function getAllPeriodsForStudent(studentId) {
            const periods = new Map();
            
            // From payments
            allPayments.forEach(p => {
                if (p && p.studentId === studentId && p.academicYear && p.term !== undefined && p.term !== null) {
                    const key = `${p.academicYear}_${p.term}`;
                    if (!periods.has(key)) {
                        periods.set(key, { 
                            year: parseInt(p.academicYear), 
                            term: parseInt(p.term), 
                            payments: [] 
                        });
                    }
                    periods.get(key).payments.push(p);
                }
            });
            
            // From term records
            for (const [key, record] of Object.entries(termRecords)) {
                if (key.startsWith(studentId + '_')) {
                    const parts = key.split('_');
                    if (parts.length === 3) {
                        const year = parseInt(parts[1]);
                        const term = parseInt(parts[2]);
                        const periodKey = `${year}_${term}`;
                        if (!periods.has(periodKey)) {
                            periods.set(periodKey, { year, term, payments: [] });
                        }
                    }
                }
            }
            
            // If no periods, add default
            if (periods.size === 0) {
                const key = `${defaultYear}_${defaultTerm}`;
                periods.set(key, { year: defaultYear, term: defaultTerm, payments: [] });
            }
            
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
            
            // Get fee assignment
            const assignment = assignmentsMap[student.id] || {};
            const feeStructure = feeStructuresMap[assignment.feeStructureId];
            if (!feeStructure) continue;
            
            // Apply fee structure filter
            if (feeStructureId && feeStructureId !== 'all' && feeStructure.id !== feeStructureId) continue;
            
            // Get student's class
            let currentClass = 'Not Assigned';
            let classLevel = 'Unknown';
            if (student.currentClassId && classesMap[student.currentClassId]) {
                currentClass = classesMap[student.currentClassId].name;
                classLevel = classesMap[student.currentClassId].level || 'Unknown';
            } else if (student.currentClass) {
                currentClass = student.currentClass;
            }
            
            // Apply class filters
            if (classId && classId !== 'all' && currentClass !== classId) continue;
            if (level && level !== 'all' && classLevel !== level) continue;
            if (studentId && studentId !== 'all' && student.id !== studentId) continue;
            
            // Get all periods
            const allPeriods = getAllPeriodsForStudent(student.id);
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
            
            // Collect period keys
            for (const p of periodsToProcess) {
                if (allPeriodKeys.indexOf(p.periodKey) === -1) {
                    allPeriodKeys.push(p.periodKey);
                }
            }
            
            // ============================================================
            // CALCULATE TUITION
            // ============================================================
            let originalTuition = feeStructure.tuition || 0;
            let tuitionExpected = originalTuition;
            let discountAmount = 0;
            let discountDisplay = '';
            let appliedBursary = null;
            let isCustomBursary = false;
            
            // Apply bursary
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
            
            // Get tuition payments
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
            
            // Determine tuition status
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
            // BUILD STATUS GROUPS WITH CORRECT DATA
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
                        
                        // Check if removed
                        if (isItemRemoved(student, itemId)) continue;
                        
                        const defaultAmount = item.totalAmount || 0;
                        const defaultQuantity = item.quantity || 1;
                        const defaultUnitPrice = item.unitPrice || (defaultAmount / defaultQuantity);
                        const defaultPaymentOption = item.paymentOption || 'either';
                        
                        // Get custom values
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
                        
                        // Initialize item data
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
                        // CALCULATE FOR EACH PERIOD
                        // ============================================================
                        let totalQtyCollected = 0;
                        let totalAmtCollected = 0;
                        let totalCashExpected = 0;
                        let totalCashPaid = 0;
                        
                        for (const period of periodsToProcess) {
                            const periodKey = `${period.year}_${period.term}`;
                            const isCurrentPeriod = (period.year === currentYear && period.term === currentTerm);
                            const isFirstTermForPeriod = (period.term === 1);
                            
                            // Determine if this item should be included in this period
                            let shouldInclude = false;
                            if (periodType === 'termly') {
                                shouldInclude = true;
                            } else if (periodType === 'one_time') {
                                shouldInclude = true; // One-Time is always included
                            } else if (periodType === 'yearly') {
                                shouldInclude = isFirstTermForPeriod;
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
            
            // Apply payment status filter
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
                // ============================================================
                // CRITICAL: Include raw payments for Excel export
                // ============================================================
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

console.log('✅ Comprehensive Report API v11.0 - FULLY REBUILT!');
console.log('   - Correct OR logic for cash vs items');
console.log('   - Proper period scoping (Termly, Yearly, One-Time)');
console.log('   - Accurate payment aggregation');
console.log('   - Customizations and removed items handled');
console.log('   - Raw payments included for Excel export');
console.log('   - Activity Cash Paid correctly tracked');

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

// ==================== DASHBOARD STATISTICS ENDPOINT ====================
// Version: 3.1 - FIXED: Uses currentAcademicSettings

// ==================== DASHBOARD STATISTICS ENDPOINT ====================
// Version: 4.0 - COMPLETE REBUILD - Works with any data structure

// ==================== COMPLETE REBUILT DASHBOARD STATS ENDPOINT ====================
// Version: 3.0 - Tuition-Only Financial Cards + Complete Statistics

app.get('/api/dashboard/stats', async (req, res) => {
    console.log('=== DASHBOARD STATS REQUESTED ===');
    console.log('📍 Starting dashboard statistics generation...');
    
    try {
        // ========== STEP 1: READ SETTINGS ==========
        let currentYear = new Date().getFullYear();
        let currentTerm = 1;
        
        try {
            const settingsPath = path.join(dataDir, 'settings.json');
            if (fs.existsSync(settingsPath)) {
                const settingsData = fs.readFileSync(settingsPath, 'utf8');
                const settings = JSON.parse(settingsData);
                if (settings.currentAcademicYear) currentYear = settings.currentAcademicYear;
                if (settings.currentTerm) currentTerm = settings.currentTerm;
                console.log(`📅 Settings: Year ${currentYear}, Term ${currentTerm}`);
            }
        } catch (e) {
            console.warn('Could not read settings:', e.message);
        }
        
        const isFirstTerm = currentTerm === 1;
        const termName = getTermName(currentTerm);
        
        // ========== STEP 2: READ ALL DATA FILES ==========
        console.log('📂 Reading data files...');
        
        let students = [];
        let feeStructures = [];
        let feeAssignments = [];
        let feePayments = [];
        let termRecords = {};
        let classes = [];
        let feeBursaries = [];
        let school = [];
        let statusGroupsFromFile = [];
        
        try { students = readFile(files.students) || []; } catch(e) { console.warn('Students read error:', e.message); }
        try { feeStructures = readFile(files.feeStructures) || []; } catch(e) { console.warn('Fee structures read error:', e.message); }
        try { feeAssignments = readFile(files.studentFeeAssignments) || []; } catch(e) { console.warn('Fee assignments read error:', e.message); }
        try { feePayments = readFile(files.feePayments) || []; } catch(e) { console.warn('Fee payments read error:', e.message); }
        try { termRecords = readFile(files.studentTermRecords) || {}; } catch(e) { console.warn('Term records read error:', e.message); }
        try { classes = readFile(files.classes) || []; } catch(e) { console.warn('Classes read error:', e.message); }
        try { feeBursaries = readFile(files.feeBursaries) || []; } catch(e) { console.warn('Fee bursaries read error:', e.message); }
        try { school = readFile(files.schools) || []; } catch(e) { console.warn('School read error:', e.message); }
        try { statusGroupsFromFile = readFile(files.statusGroups) || []; } catch(e) { console.warn('Status groups read error:', e.message); }
        
        console.log(`📊 Data loaded: ${students.length} students, ${feeStructures.length} fee structures, ${feePayments.length} payments`);
        
        // ========== STEP 3: BUILD MAPS FOR QUICK LOOKUP ==========
        console.log('🔍 Building lookup maps...');
        
        const assignmentsMap = {};
        feeAssignments.forEach(a => { 
            if (a && a.studentId) assignmentsMap[a.studentId] = a; 
        });
        
        const classesMap = {};
        classes.forEach(c => { 
            if (c && c.id) classesMap[c.id] = c; 
        });
        
        const bursariesMap = {};
        feeBursaries.forEach(b => { 
            if (b && b.id) bursariesMap[b.id] = b; 
        });
        
        const feeStructuresMap = {};
        feeStructures.forEach(fs => { 
            if (fs && fs.id) feeStructuresMap[fs.id] = fs; 
        });
        
        // ========== STEP 4: FILTER PAYMENTS FOR CURRENT TERM ==========
        const currentTermPayments = feePayments.filter(p => 
            p && p.term === currentTerm && p.academicYear === currentYear.toString()
        );
        
        // ========== STEP 5: PROCESS STUDENTS ==========
        console.log('👨‍🎓 Processing students...');
        
        let totalStudents = students.length;
        let activeStudents = students.filter(s => s && s.status === 'Active').length;
        let maleCount = 0;
        let femaleCount = 0;
        
        // TUITION-ONLY STATS
        let tuitionExpected = 0;
        let tuitionCollected = 0;
        let tuitionFullyPaidCount = 0;
        let tuitionPaymentDueCount = 0;
        let tuitionNoPaymentCount = 0;
        let tuitionCreditBalanceCount = 0;
        
        // STATUS GROUP STATS
        const statusGroupsMap = {};
        const allItemsMap = {};
        const allStatusGroupNames = new Set();
        
        // First, extract all status groups and items from fee structures
        feeStructures.forEach(fs => {
            if (!fs || !fs.activityComponents) return;
            
            fs.activityComponents.forEach(comp => {
                if (!comp) return;
                
                let sgName = comp.statusGroupName || comp.name || 'Ungrouped';
                if (sgName === 'schoolastic requirement') sgName = 'Scholastic';
                if (sgName.toLowerCase().includes('transport')) sgName = 'Transportation';
                if (sgName.toLowerCase().includes('admission')) sgName = 'Admission';
                
                const sgId = comp.statusGroupId || 'sg_' + sgName.replace(/[^a-zA-Z0-9]/g, '_');
                
                if (!statusGroupsMap[sgId]) {
                    statusGroupsMap[sgId] = {
                        id: sgId,
                        name: sgName,
                        periodType: comp.periodType || 'termly',
                        totalRequired: 0,
                        totalCollected: 0,
                        totalRemaining: 0,
                        studentCount: 0,
                        items: {},
                        classBreakdown: {},
                        color: getStatusGroupColor(sgName),
                        components: []
                    };
                    allStatusGroupNames.add(sgName);
                }
                
                // Process items
                (comp.items || []).forEach(item => {
                    if (!item) return;
                    const itemName = item.name || 'Unnamed Item';
                    const quantityRequired = item.quantity || 1;
                    const totalAmount = item.totalAmount || 0;
                    const unitPrice = item.unitPrice || (totalAmount / quantityRequired);
                    
                    if (!statusGroupsMap[sgId].items[itemName]) {
                        statusGroupsMap[sgId].items[itemName] = {
                            name: itemName,
                            required: 0,
                            collected: 0,
                            remaining: 0,
                            unitPrice: unitPrice,
                            paymentOption: item.paymentOption || 'either',
                            totalAmount: 0,
                            studentsCount: 0
                        };
                    }
                    statusGroupsMap[sgId].items[itemName].required += quantityRequired;
                    statusGroupsMap[sgId].items[itemName].totalAmount += totalAmount;
                    
                    // Global items map
                    if (!allItemsMap[itemName]) {
                        allItemsMap[itemName] = {
                            name: itemName,
                            statusGroup: sgName,
                            required: 0,
                            collected: 0,
                            remaining: 0,
                            students: 0,
                            totalAmount: 0,
                            unitPrice: unitPrice
                        };
                    }
                    allItemsMap[itemName].required += quantityRequired;
                    allItemsMap[itemName].totalAmount += totalAmount;
                });
            });
        });
        
        // Process each student for status groups and tuition
        for (const student of students) {
            if (!student) continue;
            
            // Count gender
            if (student.gender === 'Male') maleCount++;
            else if (student.gender === 'Female') femaleCount++;
            
            // ========== CALCULATE TUITION ==========
            const assignment = assignmentsMap[student.id] || {};
            const feeStructure = feeStructuresMap[assignment.feeStructureId];
            
            if (feeStructure) {
                let expectedTuition = feeStructure.tuition || 0;
                
                // Apply custom bursary from student record first
                if (student.customBursary && student.customBursary.amount > 0) {
                    expectedTuition = Math.max(0, expectedTuition - student.customBursary.amount);
                } else if (assignment.bursaryId && bursariesMap[assignment.bursaryId]) {
                    const bursary = bursariesMap[assignment.bursaryId];
                    if (bursary) {
                        if (bursary.type === 'percentage') {
                            expectedTuition = Math.max(0, expectedTuition - (expectedTuition * bursary.value / 100));
                        } else {
                            expectedTuition = Math.max(0, expectedTuition - bursary.value);
                        }
                    }
                }
                
                tuitionExpected += expectedTuition;
                
                // Get tuition payments for this student
                const studentPayments = currentTermPayments.filter(p => 
                    p && p.studentId === student.id
                );
                
                const tuitionPaid = studentPayments.reduce((sum, p) => sum + (p.tuitionPaid || 0), 0);
                tuitionCollected += tuitionPaid;
                
                // Track tuition status
                const tuitionBalance = expectedTuition - tuitionPaid;
                if (Math.abs(tuitionBalance) <= 10 && tuitionPaid > 0) {
                    tuitionFullyPaidCount++;
                } else if (tuitionBalance < -10) {
                    tuitionCreditBalanceCount++;
                } else if (tuitionPaid === 0 && expectedTuition > 0) {
                    tuitionNoPaymentCount++;
                } else if (tuitionBalance > 0 && tuitionPaid > 0) {
                    tuitionPaymentDueCount++;
                }
            }
            
            // ========== PROCESS STATUS GROUPS FOR THIS STUDENT ==========
            const studentAssignment = assignmentsMap[student.id] || {};
            const studentFeeStructure = feeStructuresMap[studentAssignment.feeStructureId];
            
            if (!studentFeeStructure) continue;
            
            // Get student's class
            let currentClass = 'Not Assigned';
            let classLevel = 'Unknown';
            if (student.currentClassId && classesMap[student.currentClassId]) {
                currentClass = classesMap[student.currentClassId].name;
                classLevel = classesMap[student.currentClassId].level || 'Unknown';
            } else if (student.currentClass) {
                currentClass = student.currentClass;
            }
            
            // Get student's term record
            const termRecordKey = student.id + '_' + currentYear + '_' + currentTerm;
            const termRecord = termRecords[termRecordKey] || { 
                activityItemsPaid: { one_time: [], termly: [], yearly: [] },
                tuitionTotalPaid: 0,
                activityTotalPaid: 0
            };
            
            // Get student payments for this term
            const studentPayments = currentTermPayments.filter(p => 
                p && p.studentId === student.id
            );
            
            // Process each component in the fee structure
            if (studentFeeStructure.activityComponents) {
                for (const comp of studentFeeStructure.activityComponents) {
                    if (!comp) continue;
                    
                    const periodType = comp.periodType || 'termly';
                    const shouldInclude = (periodType === 'termly') || 
                                         (periodType === 'one_time' && isFirstTerm) ||
                                         (periodType === 'yearly' && isFirstTerm);
                    
                    if (!shouldInclude) continue;
                    
                    let sgName = comp.statusGroupName || comp.name || 'Ungrouped';
                    if (sgName === 'schoolastic requirement') sgName = 'Scholastic';
                    if (sgName.toLowerCase().includes('transport')) sgName = 'Transportation';
                    if (sgName.toLowerCase().includes('admission')) sgName = 'Admission';
                    
                    const sgId = comp.statusGroupId || 'sg_' + sgName.replace(/[^a-zA-Z0-9]/g, '_');
                    
                    if (!statusGroupsMap[sgId]) {
                        statusGroupsMap[sgId] = {
                            id: sgId,
                            name: sgName,
                            periodType: periodType,
                            totalRequired: 0,
                            totalCollected: 0,
                            totalRemaining: 0,
                            studentCount: 0,
                            items: {},
                            classBreakdown: {},
                            color: getStatusGroupColor(sgName),
                            components: []
                        };
                    }
                    
                    // Process each item in the component
                    for (const item of (comp.items || [])) {
                        if (!item) continue;
                        const itemName = item.name || 'Unnamed Item';
                        const quantityRequired = item.quantity || 1;
                        const totalAmount = item.totalAmount || 0;
                        const unitPrice = item.unitPrice || (totalAmount / quantityRequired);
                        const paymentOption = item.paymentOption || 'either';
                        
                        // Calculate what's been paid for this item
                        let cashPaid = 0;
                        let itemsBrought = 0;
                        
                        // Check payments
                        for (const payment of studentPayments) {
                            if (!payment) continue;
                            
                            // Check activityItemPayments
                            if (payment.activityItemPayments) {
                                for (const paidItem of payment.activityItemPayments) {
                                    if (!paidItem) continue;
                                    if (paidItem.itemName === itemName && 
                                        paidItem.componentName === comp.name &&
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
                                    if (!paidItem) continue;
                                    if (paidItem.itemName === itemName && 
                                        paidItem.componentName === comp.name) {
                                        if (paidItem.paymentType === 'paid_cash') {
                                            cashPaid += paidItem.amountPaid || 0;
                                        } else if (paidItem.paymentType === 'brought_item') {
                                            itemsBrought += paidItem.itemsBrought || 0;
                                        }
                                    }
                                }
                            }
                        }
                        
                        // Also check term record
                        const periodItems = termRecord.activityItemsPaid?.[periodType] || [];
                        const paidRecord = periodItems.find(p => p && p.itemName === itemName);
                        if (paidRecord) {
                            cashPaid = Math.max(cashPaid, paidRecord.amountPaid || 0);
                            itemsBrought = Math.max(itemsBrought, paidRecord.itemsBrought || 0);
                        }
                        
                        // Calculate collected quantity (cap at required)
                        const cashCoversItems = unitPrice > 0 ? Math.floor(cashPaid / unitPrice) : 0;
                        const totalCollected = Math.min(itemsBrought + cashCoversItems, quantityRequired);
                        const remaining = Math.max(0, quantityRequired - totalCollected);
                        
                        // Update status group totals
                        if (statusGroupsMap[sgId]) {
                            statusGroupsMap[sgId].totalRequired += quantityRequired;
                            statusGroupsMap[sgId].totalCollected += totalCollected;
                            statusGroupsMap[sgId].totalRemaining += remaining;
                            statusGroupsMap[sgId].studentCount = (statusGroupsMap[sgId].studentCount || 0) + 1;
                            
                            // Update item totals
                            if (statusGroupsMap[sgId].items[itemName]) {
                                statusGroupsMap[sgId].items[itemName].collected += totalCollected;
                                statusGroupsMap[sgId].items[itemName].remaining += remaining;
                                statusGroupsMap[sgId].items[itemName].studentsCount++;
                            }
                            
                            // Update class breakdown
                            if (!statusGroupsMap[sgId].classBreakdown[currentClass]) {
                                statusGroupsMap[sgId].classBreakdown[currentClass] = { 
                                    required: 0, 
                                    collected: 0, 
                                    remaining: 0 
                                };
                            }
                            statusGroupsMap[sgId].classBreakdown[currentClass].required += quantityRequired;
                            statusGroupsMap[sgId].classBreakdown[currentClass].collected += totalCollected;
                            statusGroupsMap[sgId].classBreakdown[currentClass].remaining += remaining;
                        }
                        
                        // Update global items map
                        if (allItemsMap[itemName]) {
                            allItemsMap[itemName].collected += totalCollected;
                            allItemsMap[itemName].remaining += remaining;
                            allItemsMap[itemName].students++;
                        }
                    }
                }
            }
        }
        
        // ========== CALCULATE TOTALS ==========
        const tuitionOutstanding = Math.max(0, tuitionExpected - tuitionCollected);
        const tuitionRate = tuitionExpected > 0 ? (tuitionCollected / tuitionExpected * 100) : 0;
        
        // ========== BUILD STATUS GROUP HEALTH ==========
        const statusGroupHealth = [];
        for (const sgId in statusGroupsMap) {
            const sg = statusGroupsMap[sgId];
            const rate = sg.totalRequired > 0 ? (sg.totalCollected / sg.totalRequired * 100) : 0;
            let health = 'Excellent';
            if (rate < 50) health = 'Critical';
            else if (rate < 70) health = 'Needs Attention';
            else if (rate < 85) health = 'Good';
            
            statusGroupHealth.push({
                id: sgId,
                name: sg.name,
                rate: rate,
                status: health,
                color: sg.color || 'bg-gray-100 text-gray-800 border-gray-200'
            });
        }
        statusGroupHealth.sort((a, b) => b.rate - a.rate);
        
        // ========== BUILD ITEMS LIST ==========
        const itemsList = [];
        for (const itemName in allItemsMap) {
            const item = allItemsMap[itemName];
            itemsList.push({
                name: itemName,
                statusGroup: item.statusGroup,
                required: item.required,
                collected: item.collected,
                remaining: item.remaining,
                students: item.students,
                totalAmount: item.totalAmount
            });
        }
        itemsList.sort((a, b) => a.name.localeCompare(b.name));
        
        // ========== BUILD RECENT PAYMENTS ==========
        const sortedPayments = [...currentTermPayments]
            .filter(p => p && p.date)
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 10);
        
        const recentPayments = [];
        for (const payment of sortedPayments) {
            if (!payment) continue;
            const student = students.find(s => s && s.id === payment.studentId);
            let itemNames = [];
            
            if (payment.activityItemPayments) {
                itemNames = payment.activityItemPayments
                    .filter(i => i && i.itemName)
                    .map(i => i.itemName);
            }
            
            const totalAmount = payment.totalAmount || payment.amount || 0;
            
            // Only include payments with amount > 0 or items
            if (totalAmount > 0 || itemNames.length > 0) {
                recentPayments.push({
                    date: payment.date,
                    receiptNumber: payment.receiptNumber || 'N/A',
                    studentName: payment.studentName || (student ? (student.firstName || '') + ' ' + (student.lastName || '') : 'Unknown'),
                    amount: totalAmount,
                    method: payment.method || 'cash',
                    items: itemNames.slice(0, 3).join(', ') + (itemNames.length > 3 ? ' +' + (itemNames.length - 3) + ' more' : ''),
                    itemCount: itemNames.length
                });
            }
        }
        
        // ========== CALCULATE STATUS GROUP COUNT ==========
        const statusGroupsCount = Object.keys(statusGroupsMap).length;
        const totalItemsCount = Object.keys(allItemsMap).length;
        
        // ========== BUILD RESPONSE ==========
        const responseData = {
            success: true,
            data: {
                school: school && school.length > 0 && school[0] ? school[0] : { 
                    schoolName: 'School Name', 
                    motto: 'Quality Education for All' 
                },
                currentPeriod: {
                    year: currentYear,
                    term: currentTerm,
                    termName: termName,
                    isFirstTerm: isFirstTerm
                },
                studentStats: {
                    total: totalStudents,
                    active: activeStudents,
                    male: maleCount,
                    female: femaleCount,
                    paymentStatus: {
                        fullyPaid: tuitionFullyPaidCount,
                        paymentDue: tuitionPaymentDueCount,
                        criticalOverdue: 0,
                        noPayment: tuitionNoPaymentCount,
                        creditBalance: tuitionCreditBalanceCount
                    }
                },
                // ===== TUITION-ONLY FINANCIAL STATS =====
                tuitionStats: {
                    expected: tuitionExpected,
                    collected: tuitionCollected,
                    outstanding: tuitionOutstanding,
                    collectionRate: tuitionRate,
                    fullyPaid: tuitionFullyPaidCount,
                    withBalance: tuitionPaymentDueCount
                },
                // ===== STATUS GROUP STATS =====
                statusGroups: Object.values(statusGroupsMap),
                statusGroupHealth: statusGroupHealth,
                items: itemsList,
                recentPayments: recentPayments,
                statusGroupsCount: statusGroupsCount,
                totalItemsCount: totalItemsCount,
                timestamp: new Date().toISOString()
            }
        };
        
        console.log(`✅ Dashboard stats generated successfully!`);
        console.log(`   📊 ${responseData.data.studentStats.total} students`);
        console.log(`   🏷️ ${responseData.data.statusGroupsCount} status groups`);
        console.log(`   📦 ${responseData.data.totalItemsCount} items`);
        console.log(`   💰 Tuition Collected: UGX ${tuitionCollected.toLocaleString()}`);
        console.log(`   💰 Tuition Expected: UGX ${tuitionExpected.toLocaleString()}`);
        console.log(`   💰 Tuition Rate: ${tuitionRate.toFixed(1)}%`);
        
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Error generating dashboard stats:', error);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
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
        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }
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
        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }
        const override = student.customItemOverrides?.[req.params.itemId];
        res.json(override || null);
    } catch (error) {
        console.error('Error getting customization:', error);
        res.status(500).json({ error: error.message });
    }
});

// CREATE or UPDATE customization for a specific item
app.put('/api/students/:studentId/customizations/:itemId', (req, res) => {
    try {
        const { customAmount, customQuantity, paymentOption, reason, componentId } = req.body;
        const students = readFile(files.students);
        const index = students.findIndex(s => s.id === req.params.studentId);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        if (!students[index].customItemOverrides) {
            students[index].customItemOverrides = {};
        }
        
        // Get existing or create new
        const existing = students[index].customItemOverrides[req.params.itemId] || {};
        
        students[index].customItemOverrides[req.params.itemId] = {
            itemId: req.params.itemId,
            componentId: componentId || existing.componentId || null,
            customAmount: customAmount !== undefined && customAmount !== null && customAmount !== '' ? parseFloat(customAmount) : null,
            customQuantity: customQuantity !== undefined && customQuantity !== null && customQuantity !== '' ? parseInt(customQuantity) : null,
            paymentOption: paymentOption || existing.paymentOption || null,
            isActive: true,
            reason: reason || existing.reason || '',
            updatedAt: new Date().toISOString(),
            updatedBy: req.body.updatedBy || 'System'
        };
        
        // Also store a summary on the student for quick access
        students[index].hasCustomizations = true;
        students[index].customizationCount = Object.keys(students[index].customItemOverrides).length;
        
        saveFile(files.students, students);
        
        res.json({ 
            success: true, 
            customization: students[index].customItemOverrides[req.params.itemId]
        });
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
        
        if (index === -1) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        if (students[index].customItemOverrides) {
            delete students[index].customItemOverrides[req.params.itemId];
            
            // Update count
            const count = Object.keys(students[index].customItemOverrides).length;
            students[index].hasCustomizations = count > 0;
            students[index].customizationCount = count;
        }
        
        saveFile(files.students, students);
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing customization:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET all students with customizations (for reporting)
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

// ==================== CUSTOM ITEM OVERRIDE API ENDPOINTS ====================

// GET all customizations for a student
app.get('/api/students/:studentId/customizations', (req, res) => {
    try {
        const students = readFile(files.students);
        const student = students.find(s => s.id === req.params.studentId);
        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }
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
        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }
        const override = student.customItemOverrides?.[req.params.itemId];
        res.json(override || null);
    } catch (error) {
        console.error('Error getting customization:', error);
        res.status(500).json({ error: error.message });
    }
});

// CREATE or UPDATE customization for a specific item
app.put('/api/students/:studentId/customizations/:itemId', (req, res) => {
    try {
        const { customAmount, customQuantity, paymentOption, reason, componentId, itemName, defaultAmount, defaultQuantity } = req.body;
        const students = readFile(files.students);
        const index = students.findIndex(s => s.id === req.params.studentId);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        if (!students[index].customItemOverrides) {
            students[index].customItemOverrides = {};
        }
        
        // Get existing or create new
        const existing = students[index].customItemOverrides[req.params.itemId] || {};
        
        // Build the customization object
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
        
        // If both customAmount and customQuantity are null/empty, remove the customization
        if (customization.customAmount === null && customization.customQuantity === null) {
            delete students[index].customItemOverrides[req.params.itemId];
            const count = Object.keys(students[index].customItemOverrides).length;
            students[index].hasCustomizations = count > 0;
            students[index].customizationCount = count;
            saveFile(files.students, students);
            return res.json({ 
                success: true, 
                message: 'Customization removed (no values provided)',
                customization: null
            });
        }
        
        students[index].customItemOverrides[req.params.itemId] = customization;
        students[index].hasCustomizations = true;
        students[index].customizationCount = Object.keys(students[index].customItemOverrides).length;
        
        saveFile(files.students, students);
        
        res.json({ 
            success: true, 
            customization: students[index].customItemOverrides[req.params.itemId],
            message: 'Customization saved successfully'
        });
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
        
        if (index === -1) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        if (students[index].customItemOverrides) {
            delete students[index].customItemOverrides[req.params.itemId];
            
            const count = Object.keys(students[index].customItemOverrides).length;
            students[index].hasCustomizations = count > 0;
            students[index].customizationCount = count;
        }
        
        saveFile(files.students, students);
        res.json({ 
            success: true, 
            message: 'Customization removed successfully'
        });
    } catch (error) {
        console.error('Error removing customization:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET all students with customizations (for reporting)
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
app.delete('/api/fee/payments/:id', (req, res) => {
    try {
        const paymentId = req.params.id;
        let payments = readFile(files.feePayments);
        const initialLength = payments.length;
        payments = payments.filter(p => p.id !== paymentId);
        if (payments.length === initialLength) {
            return res.status(404).json({ error: 'Payment not found' });
        }
        saveFile(files.feePayments, payments);
        res.json({ success: true, message: 'Payment deleted successfully' });
    } catch (error) {
        console.error('Error deleting payment:', error);
        res.status(500).json({ error: 'Failed to delete payment' });
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

        // Read payments file
        let payments = readFile(files.feePayments);
        if (!Array.isArray(payments)) {
            console.log('⚠️ Payments file not an array, initializing empty');
            payments = [];
        }

        console.log(`📊 Total payments in file: ${payments.length}`);

        // Helper: check if an item matches the target (case‑insensitive, trimmed, and substring fallback)
        function itemMatches(item) {
            if (!item) return false;
            const itemNameLower = (item.itemName || '').trim().toLowerCase();
            const targetLower = normalizedItemName.toLowerCase();
            // Exact match or contains
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

        for (const payment of payments) {
            // Skip if not this student
            if (payment.studentId !== studentId) {
                keptPayments.push(payment);
                continue;
            }

            let containsItem = false;

            // 1. Check activityItemPayments
            if (payment.activityItemPayments && Array.isArray(payment.activityItemPayments)) {
                for (const pItem of payment.activityItemPayments) {
                    if (itemMatches(pItem)) {
                        containsItem = true;
                        console.log(`   ✅ Match in activityItemPayments: ${pItem.itemName} (${pItem.componentName})`);
                        break;
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
                            break;
                        }
                    }
                    if (containsItem) break;
                }
            }

            // 3. Check individualPayments
            if (!containsItem && payment.individualPayments && Array.isArray(payment.individualPayments)) {
                for (const ip of payment.individualPayments) {
                    if (ip.itemName && ip.itemName.trim().toLowerCase() === normalizedItemName.toLowerCase()) {
                        containsItem = true;
                        console.log(`   ✅ Match in individualPayments: ${ip.itemName}`);
                        break;
                    }
                }
            }

            if (containsItem) {
                deletedCount++;
                console.log(`   🗑️ Deleting payment ${payment.id} (${payment.receiptNumber})`);
            } else {
                keptPayments.push(payment);
            }
        }

        console.log(`📊 Deleted count: ${deletedCount}`);

        // If no payments were deleted, log all student payments for debugging
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

        // Save the filtered payments
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

// ==================== START SERVER ====================

app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('='.repeat(50));
    console.log('🎓 UGANDA SCHOOL MANAGEMENT SYSTEM v3.0');
    console.log('='.repeat(50));
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Network: http://${ip}:${PORT}`);
    console.log(`📁 Data directory: ${dataDir}`);
    console.log(`💰 Fee Types: Tuition | One-Time | Termly | Yearly`);
    console.log('='.repeat(50));
    console.log('Ready to serve! 🚀');
    console.log('📱 Access from other devices on same network using:');
    console.log(`   http://${ip}:${PORT}`);
    console.log('='.repeat(50));
});