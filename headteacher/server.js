// ==================== HEAD TEACHER DASHBOARD - server.js ====================
// Port: 5000
// Complete dashboard for Director/Head Teacher

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.HEADTEACHER_PORT || 5000;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== PATHS ====================
const sharedDataDir = path.join(__dirname, '..', 'shared', 'data');
const headDataDir = path.join(__dirname, 'data');

// Ensure directories exist
if (!fs.existsSync(sharedDataDir)) fs.mkdirSync(sharedDataDir, { recursive: true });
if (!fs.existsSync(headDataDir)) fs.mkdirSync(headDataDir, { recursive: true });

// ==================== FILE PATHS ====================
const files = {
    // Shared data (read from financial system)
    students: path.join(sharedDataDir, 'students.json'),
    classes: path.join(sharedDataDir, 'classes.json'),
    subjects: path.join(sharedDataDir, 'subjects.json'),
    feeStructures: path.join(sharedDataDir, 'feeStructures.json'),
    feePayments: path.join(sharedDataDir, 'feePayments.json'),
    feeBursaries: path.join(sharedDataDir, 'feeBursaries.json'),
    studentFeeAssignments: path.join(sharedDataDir, 'studentFeeAssignments.json'),
    
    // Inventory (shared)
    inventoryStock: path.join(sharedDataDir, 'inventoryStock.json'),
    inventoryTransactions: path.join(sharedDataDir, 'inventoryTransactions.json'),
    
    // Uniform (shared)
    uniformStock: path.join(sharedDataDir, 'uniformStock.json'),
    uniformTransactions: path.join(sharedDataDir, 'uniformTransactions.json'),
    uniformAssignments: path.join(sharedDataDir, 'uniformAssignments.json'),
    
    // Academic (shared)
    reportCards: path.join(sharedDataDir, 'reportCards.json'),
    studentProgress: path.join(sharedDataDir, 'studentProgress.json'),
    teacherAssignments: path.join(sharedDataDir, 'teacherAssignments.json'),
    
    // Head teacher specific
    schoolSettings: path.join(headDataDir, 'schoolSettings.json'),
    announcements: path.join(headDataDir, 'announcements.json'),
    staff: path.join(headDataDir, 'staff.json'),
    dashboardCache: path.join(headDataDir, 'dashboardCache.json')
};

// ==================== READ/WRITE HELPERS ====================
function readFile(filePath, defaultData) {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        }
        return defaultData || (Array.isArray(defaultData) ? [] : {});
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
        return defaultData || (Array.isArray(defaultData) ? [] : {});
    }
}

function saveFile(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error);
        return false;
    }
}

// ==================== INITIALIZE DATA ====================
function initializeHeadData() {
    // Initialize school settings
    if (!fs.existsSync(files.schoolSettings)) {
        saveFile(files.schoolSettings, {
            schoolName: 'Eden Christian School',
            motto: 'Quality Education for All',
            established: '2020',
            address: 'Kampala, Uganda',
            phone: '+256 700 000 000',
            email: 'info@edenschool.ug',
            logo: '',
            academicYear: new Date().getFullYear(),
            terms: [
                { id: 1, name: 'First Term', start: `${new Date().getFullYear()}-01-10`, end: `${new Date().getFullYear()}-04-10`, isActive: true },
                { id: 2, name: 'Second Term', start: `${new Date().getFullYear()}-05-10`, end: `${new Date().getFullYear()}-08-10`, isActive: false },
                { id: 3, name: 'Third Term', start: `${new Date().getFullYear()}-09-10`, end: `${new Date().getFullYear()}-12-10`, isActive: false }
            ],
            currentTerm: 1
        });
    }
    
    // Initialize announcements
    if (!fs.existsSync(files.announcements)) {
        saveFile(files.announcements, []);
    }
    
    // Initialize staff
    if (!fs.existsSync(files.staff)) {
        saveFile(files.staff, []);
    }
    
    console.log('✅ Head Teacher data initialized');
}

initializeHeadData();

// ==================== AUTHENTICATION (Single Admin) ====================
const ADMIN_CREDENTIALS = {
    username: 'admin',
    password: 'admin123',
    role: 'headteacher'
};

app.post('/api/head/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        const token = uuidv4();
        // Store session
        const sessions = readFile(path.join(headDataDir, 'sessions.json'), {});
        sessions[token] = {
            username,
            role: 'headteacher',
            loginTime: new Date().toISOString()
        };
        saveFile(path.join(headDataDir, 'sessions.json'), sessions);
        
        res.json({
            success: true,
            token,
            user: {
                username: ADMIN_CREDENTIALS.username,
                role: 'headteacher'
            }
        });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.post('/api/head/verify', (req, res) => {
    const { token } = req.body;
    const sessions = readFile(path.join(headDataDir, 'sessions.json'), {});
    const session = sessions[token];
    
    if (!session) {
        return res.status(401).json({ error: 'Invalid session' });
    }
    
    res.json({ success: true, user: session });
});

app.post('/api/head/logout', (req, res) => {
    const { token } = req.body;
    const sessions = readFile(path.join(headDataDir, 'sessions.json'), {});
    delete sessions[token];
    saveFile(path.join(headDataDir, 'sessions.json'), sessions);
    res.json({ success: true });
});

// ==================== DASHBOARD STATISTICS ====================
app.get('/api/head/dashboard', async (req, res) => {
    try {
        // Read all data
        const students = readFile(files.students, []);
        const classes = readFile(files.classes, []);
        const teachers = readFile(files.teacherAssignments, []);
        const payments = readFile(files.feePayments, []);
        const feeStructures = readFile(files.feeStructures, []);
        const inventory = readFile(files.inventoryStock, {});
        const uniform = readFile(files.uniformStock, {});
        const reportCards = readFile(files.reportCards, []);
        const progress = readFile(files.studentProgress, []);
        
        // Get current term
        const settings = readFile(files.schoolSettings, {});
        const currentTerm = settings.currentTerm || 1;
        const currentYear = settings.academicYear || new Date().getFullYear();
        
        // ========== STUDENT STATISTICS ==========
        const totalStudents = students.length;
        const activeStudents = students.filter(s => s.status === 'Active').length;
        const maleCount = students.filter(s => s.gender === 'Male').length;
        const femaleCount = students.filter(s => s.gender === 'Female').length;
        
        // Students by class
        const classStats = {};
        classes.forEach(cls => {
            const count = students.filter(s => s.currentClassId === cls.id).length;
            classStats[cls.name] = count;
        });
        
        // Students by level
        const levelStats = {
            Nursery: students.filter(s => {
                const cls = classes.find(c => c.id === s.currentClassId);
                return cls && cls.level === 'Nursery';
            }).length,
            LowerPrimary: students.filter(s => {
                const cls = classes.find(c => c.id === s.currentClassId);
                return cls && cls.level === 'LowerPrimary';
            }).length,
            UpperPrimary: students.filter(s => {
                const cls = classes.find(c => c.id === s.currentClassId);
                return cls && cls.level === 'UpperPrimary';
            }).length
        };
        
        // ========== FINANCIAL STATISTICS ==========
        const currentTermPayments = payments.filter(p => p.term === currentTerm && p.academicYear === currentYear.toString());
        
        const totalCollected = currentTermPayments.reduce((sum, p) => sum + (p.totalAmount || p.amount || 0), 0);
        const totalTransactions = currentTermPayments.length;
        
        // Payment methods breakdown
        const paymentMethods = {};
        currentTermPayments.forEach(p => {
            const method = p.method || 'cash';
            paymentMethods[method] = (paymentMethods[method] || 0) + (p.totalAmount || p.amount || 0);
        });
        
        // Fee structure stats
        const feeStructureStats = feeStructures.map(fs => {
            const assigned = students.filter(s => {
                const assignment = readFile(files.studentFeeAssignments, []).find(a => a.studentId === s.id);
                return assignment && assignment.feeStructureId === fs.id;
            });
            const structurePayments = currentTermPayments.filter(p => p.feeStructureId === fs.id);
            const collected = structurePayments.reduce((sum, p) => sum + (p.totalAmount || p.amount || 0), 0);
            const expected = assigned.length * (fs.tuition || 0);
            
            return {
                id: fs.id,
                name: fs.name,
                students: assigned.length,
                expected: expected,
                collected: collected,
                rate: expected > 0 ? (collected / expected * 100).toFixed(1) : 0
            };
        });
        
        // ========== INVENTORY STATISTICS ==========
        const inventoryItems = Object.values(inventory).filter(item => item && typeof item === 'object' && item.name);
        const totalInventoryItems = inventoryItems.length;
        const totalInventoryValue = inventoryItems.reduce((sum, item) => sum + (item.unitPrice || 0) * (item.available || 0), 0);
        const lowStockItems = inventoryItems.filter(item => (item.available || 0) < 5).length;
        const outOfStockItems = inventoryItems.filter(item => (item.available || 0) === 0).length;
        
        // Inventory by category
        const inventoryByCategory = {};
        inventoryItems.forEach(item => {
            const category = item.category || 'Uncategorized';
            if (!inventoryByCategory[category]) inventoryByCategory[category] = 0;
            inventoryByCategory[category] += item.available || 0;
        });
        
        // ========== UNIFORM STATISTICS ==========
        const uniformItems = Object.values(uniform).filter(item => item && typeof item === 'object' && item.name);
        const totalUniformItems = uniformItems.length;
        const totalUniformValue = uniformItems.reduce((sum, item) => sum + (item.unitPrice || 0) * (item.available || 0), 0);
        const uniformLowStock = uniformItems.filter(item => (item.available || 0) < 5).length;
        const uniformOutOfStock = uniformItems.filter(item => (item.available || 0) === 0).length;
        
        // Uniform by size
        const uniformBySize = {};
        uniformItems.forEach(item => {
            const size = item.size || 'One Size';
            if (!uniformBySize[size]) uniformBySize[size] = 0;
            uniformBySize[size] += item.available || 0;
        });
        
        // ========== ACADEMIC STATISTICS ==========
        const currentTermReportCards = reportCards.filter(rc => rc.term === currentTerm && rc.year === currentYear);
        const totalReportCards = currentTermReportCards.length;
        
        // Calculate average scores
        let totalAverage = 0;
        let passedCount = 0;
        let failedCount = 0;
        let gradeDistribution = {};
        
        currentTermReportCards.forEach(card => {
            if (card.subjects && card.subjects.length > 0) {
                const avg = card.subjects.reduce((sum, s) => sum + s.score, 0) / card.subjects.length;
                totalAverage += avg;
                
                if (avg >= 50) passedCount++;
                else failedCount++;
                
                // Grade distribution
                const grade = avg >= 80 ? 'A' : avg >= 70 ? 'B' : avg >= 60 ? 'C' : avg >= 50 ? 'D' : avg >= 40 ? 'E' : 'F';
                gradeDistribution[grade] = (gradeDistribution[grade] || 0) + 1;
            }
        });
        
        const averageScore = totalReportCards > 0 ? (totalAverage / totalReportCards).toFixed(1) : 0;
        
        // Progression stats
        const promotedCount = progress.filter(p => p.status === 'promoted').length;
        const retainedCount = progress.filter(p => p.status === 'retained').length;
        
        // ========== TEACHER STATISTICS ==========
        const totalTeachers = teachers.length;
        const activeTeachers = teachers.filter(t => t.isActive !== false).length;
        
        // ========== RECENT ACTIVITIES ==========
        const recentPayments = currentTermPayments
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 10)
            .map(p => ({
                date: p.date,
                receiptNumber: p.receiptNumber,
                studentName: p.studentName,
                amount: p.totalAmount || p.amount || 0,
                method: p.method || 'cash'
            }));
        
        // ========== BUILD RESPONSE ==========
        const dashboardData = {
            // School Info
            school: {
                name: settings.schoolName || 'School Name',
                motto: settings.motto || 'Quality Education for All',
                address: settings.address || '',
                phone: settings.phone || '',
                email: settings.email || '',
                currentTerm: currentTerm,
                currentYear: currentYear,
                termName: getTermName(currentTerm)
            },
            
            // Student Stats
            students: {
                total: totalStudents,
                active: activeStudents,
                male: maleCount,
                female: femaleCount,
                byClass: classStats,
                byLevel: levelStats
            },
            
            // Financial Stats
            financial: {
                totalCollected: totalCollected,
                totalTransactions: totalTransactions,
                paymentMethods: paymentMethods,
                feeStructureStats: feeStructureStats
            },
            
            // Inventory Stats
            inventory: {
                totalItems: totalInventoryItems,
                totalValue: totalInventoryValue,
                lowStock: lowStockItems,
                outOfStock: outOfStockItems,
                byCategory: inventoryByCategory
            },
            
            // Uniform Stats
            uniform: {
                totalItems: totalUniformItems,
                totalValue: totalUniformValue,
                lowStock: uniformLowStock,
                outOfStock: uniformOutOfStock,
                bySize: uniformBySize
            },
            
            // Academic Stats
            academic: {
                totalReportCards: totalReportCards,
                averageScore: averageScore,
                passedCount: passedCount,
                failedCount: failedCount,
                gradeDistribution: gradeDistribution,
                promotedCount: promotedCount,
                retainedCount: retainedCount
            },
            
            // Teacher Stats
            teachers: {
                total: totalTeachers,
                active: activeTeachers
            },
            
            // Recent Activities
            recentPayments: recentPayments,
            
            // Timestamp
            generatedAt: new Date().toISOString()
        };
        
        // Cache the dashboard data
        saveFile(files.dashboardCache, dashboardData);
        
        res.json({
            success: true,
            data: dashboardData
        });
        
    } catch (error) {
        console.error('Error generating dashboard:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== GET CACHED DASHBOARD ====================
app.get('/api/head/dashboard/cached', (req, res) => {
    const cached = readFile(files.dashboardCache, null);
    if (cached) {
        res.json({ success: true, data: cached });
    } else {
        res.status(404).json({ error: 'No cached data available' });
    }
});

// ==================== ANNOUNCEMENTS ====================
app.get('/api/head/announcements', (req, res) => {
    const announcements = readFile(files.announcements, []);
    res.json(announcements);
});

app.post('/api/head/announcements', (req, res) => {
    const { title, content, type, priority } = req.body;
    
    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content required' });
    }
    
    const announcements = readFile(files.announcements, []);
    const newAnnouncement = {
        id: uuidv4(),
        title,
        content,
        type: type || 'general',
        priority: priority || 'normal',
        createdAt: new Date().toISOString(),
        isActive: true
    };
    
    announcements.unshift(newAnnouncement);
    saveFile(files.announcements, announcements);
    
    res.json({ success: true, announcement: newAnnouncement });
});

app.put('/api/head/announcements/:id', (req, res) => {
    const { id } = req.params;
    const { title, content, type, priority, isActive } = req.body;
    
    let announcements = readFile(files.announcements, []);
    const index = announcements.findIndex(a => a.id === id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Announcement not found' });
    }
    
    announcements[index] = {
        ...announcements[index],
        title: title || announcements[index].title,
        content: content || announcements[index].content,
        type: type || announcements[index].type,
        priority: priority || announcements[index].priority,
        isActive: isActive !== undefined ? isActive : announcements[index].isActive,
        updatedAt: new Date().toISOString()
    };
    
    saveFile(files.announcements, announcements);
    res.json({ success: true, announcement: announcements[index] });
});

app.delete('/api/head/announcements/:id', (req, res) => {
    const { id } = req.params;
    let announcements = readFile(files.announcements, []);
    announcements = announcements.filter(a => a.id !== id);
    saveFile(files.announcements, announcements);
    res.json({ success: true });
});

// ==================== STAFF MANAGEMENT ====================
app.get('/api/head/staff', (req, res) => {
    const staff = readFile(files.staff, []);
    res.json(staff);
});

app.post('/api/head/staff', (req, res) => {
    const { firstName, lastName, role, email, phone, department, joinDate, salary } = req.body;
    
    if (!firstName || !lastName || !role || !email) {
        return res.status(400).json({ error: 'Required fields missing' });
    }
    
    const staff = readFile(files.staff, []);
    const newStaff = {
        id: uuidv4(),
        firstName,
        lastName,
        role,
        email,
        phone: phone || '',
        department: department || '',
        joinDate: joinDate || new Date().toISOString().split('T')[0],
        salary: salary || 0,
        isActive: true,
        createdAt: new Date().toISOString()
    };
    
    staff.push(newStaff);
    saveFile(files.staff, staff);
    
    res.json({ success: true, staff: newStaff });
});

app.put('/api/head/staff/:id', (req, res) => {
    const { id } = req.params;
    let staff = readFile(files.staff, []);
    const index = staff.findIndex(s => s.id === id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Staff not found' });
    }
    
    staff[index] = {
        ...staff[index],
        ...req.body,
        updatedAt: new Date().toISOString()
    };
    
    saveFile(files.staff, staff);
    res.json({ success: true, staff: staff[index] });
});

app.delete('/api/head/staff/:id', (req, res) => {
    const { id } = req.params;
    let staff = readFile(files.staff, []);
    staff = staff.filter(s => s.id !== id);
    saveFile(files.staff, staff);
    res.json({ success: true });
});

// ==================== SCHOOL SETTINGS ====================
app.get('/api/head/settings', (req, res) => {
    const settings = readFile(files.schoolSettings, {});
    res.json(settings);
});

app.put('/api/head/settings', (req, res) => {
    const settings = readFile(files.schoolSettings, {});
    const updatedSettings = {
        ...settings,
        ...req.body,
        updatedAt: new Date().toISOString()
    };
    
    saveFile(files.schoolSettings, updatedSettings);
    res.json({ success: true, settings: updatedSettings });
});

// ==================== EXPORT REPORTS ====================
app.get('/api/head/export/financial', (req, res) => {
    const payments = readFile(files.feePayments, []);
    const students = readFile(files.students, []);
    
    const data = payments.map(p => {
        const student = students.find(s => s.id === p.studentId);
        return {
            Date: p.date,
            'Receipt No': p.receiptNumber,
            Student: p.studentName || student?.firstName + ' ' + student?.lastName || 'Unknown',
            'Admission No': p.admissionNumber || student?.admissionNumber || '',
            Term: p.term,
            Year: p.academicYear,
            Amount: p.totalAmount || p.amount || 0,
            Method: p.method || 'cash',
            'Fee Structure': p.feeStructureName || '',
            Bursary: p.bursaryName || 'None',
            Notes: p.notes || ''
        };
    });
    
    res.json({ success: true, data });
});

app.get('/api/head/export/students', (req, res) => {
    const students = readFile(files.students, []);
    const classes = readFile(files.classes, []);
    const payments = readFile(files.feePayments, []);
    
    const data = students.map(s => {
        const cls = classes.find(c => c.id === s.currentClassId);
        const studentPayments = payments.filter(p => p.studentId === s.id);
        const totalPaid = studentPayments.reduce((sum, p) => sum + (p.totalAmount || p.amount || 0), 0);
        
        return {
            'Admission No': s.admissionNumber || '',
            'First Name': s.firstName || '',
            'Last Name': s.lastName || '',
            Gender: s.gender || '',
            Class: cls?.name || 'Not Assigned',
            Status: s.status || 'Active',
            'Parent Name': s.parentInfo?.name || '',
            'Parent Phone': s.parentInfo?.phone || '',
            'Parent Email': s.parentInfo?.email || '',
            Address: s.address || '',
            'Total Payments': studentPayments.length,
            'Total Paid': totalPaid,
            'Enrollment Date': s.enrolledAt || ''
        };
    });
    
    res.json({ success: true, data });
});

// ==================== INVENTORY SUMMARY ====================
app.get('/api/head/inventory/summary', (req, res) => {
    const inventory = readFile(files.inventoryStock, {});
    const transactions = readFile(files.inventoryTransactions, []);
    
    const items = Object.values(inventory).filter(item => item && typeof item === 'object' && item.name);
    
    const summary = {
        totalItems: items.length,
        totalAvailable: items.reduce((sum, item) => sum + (item.available || 0), 0),
        totalReceived: items.reduce((sum, item) => sum + (item.totalReceived || 0), 0),
        totalIssued: items.reduce((sum, item) => sum + (item.issued || 0), 0),
        items: items.map(item => ({
            name: item.name,
            available: item.available || 0,
            received: item.totalReceived || 0,
            issued: item.issued || 0,
            unitPrice: item.unitPrice || 0,
            category: item.category || 'Uncategorized'
        })),
        recentTransactions: transactions.slice(-20).reverse()
    };
    
    res.json({ success: true, data: summary });
});

// ==================== UNIFORM SUMMARY ====================
app.get('/api/head/uniform/summary', (req, res) => {
    const uniform = readFile(files.uniformStock, {});
    const transactions = readFile(files.uniformTransactions, []);
    const assignments = readFile(files.uniformAssignments, {});
    
    const items = Object.values(uniform).filter(item => item && typeof item === 'object' && item.name);
    
    const summary = {
        totalItems: items.length,
        totalAvailable: items.reduce((sum, item) => sum + (item.available || 0), 0),
        totalReceived: items.reduce((sum, item) => sum + (item.totalReceived || 0), 0),
        totalIssued: items.reduce((sum, item) => sum + (item.issued || 0), 0),
        items: items.map(item => ({
            name: item.name,
            available: item.available || 0,
            received: item.totalReceived || 0,
            issued: item.issued || 0,
            unitPrice: item.unitPrice || 0,
            size: item.size || 'One Size'
        })),
        assignments: Object.keys(assignments).length,
        recentTransactions: transactions.slice(-20).reverse()
    };
    
    res.json({ success: true, data: summary });
});

// ==================== ACADEMIC SUMMARY ====================
app.get('/api/head/academic/summary', (req, res) => {
    const reportCards = readFile(files.reportCards, []);
    const progress = readFile(files.studentProgress, []);
    const teachers = readFile(files.teacherAssignments, []);
    const classes = readFile(files.classes, []);
    
    const settings = readFile(files.schoolSettings, {});
    const currentTerm = settings.currentTerm || 1;
    const currentYear = settings.academicYear || new Date().getFullYear();
    
    const termCards = reportCards.filter(rc => rc.term === currentTerm && rc.year === currentYear);
    
    // Subject performance
    const subjectPerformance = {};
    termCards.forEach(card => {
        (card.subjects || []).forEach(subj => {
            if (!subjectPerformance[subj.subjectName]) {
                subjectPerformance[subj.subjectName] = { scores: [], count: 0 };
            }
            subjectPerformance[subj.subjectName].scores.push(subj.score || 0);
            subjectPerformance[subj.subjectName].count++;
        });
    });
    
    const subjectAverages = Object.entries(subjectPerformance).map(([name, data]) => ({
        name,
        average: data.count > 0 ? (data.scores.reduce((a, b) => a + b, 0) / data.count).toFixed(1) : 0,
        count: data.count
    })).sort((a, b) => b.average - a.average);
    
    const summary = {
        totalReportCards: termCards.length,
        subjectAverages: subjectAverages,
        topSubjects: subjectAverages.slice(0, 5),
        lowestSubjects: subjectAverages.slice(-5).reverse(),
        promotedCount: progress.filter(p => p.status === 'promoted').length,
        retainedCount: progress.filter(p => p.status === 'retained').length,
        teacherCount: teachers.length,
        classCount: classes.length
    };
    
    res.json({ success: true, data: summary });
});

// ==================== HELPER FUNCTIONS ====================
function getTermName(term) {
    const names = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
    return names[term] || `Term ${term}`;
}

// ==================== FRONTEND ROUTE ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('👔 HEAD TEACHER DASHBOARD v1.0');
    console.log('='.repeat(60));
    console.log(`✅ Server running at: http://localhost:${PORT}`);
    console.log(`📁 Data directory: ${headDataDir}`);
    console.log('='.repeat(60));
    console.log('📊 Dashboard Features:');
    console.log('   - Complete School Statistics');
    console.log('   - Student Analytics');
    console.log('   - Financial Summary');
    console.log('   - Inventory Overview');
    console.log('   - Uniform Management');
    console.log('   - Academic Performance');
    console.log('   - Staff Management');
    console.log('   - Announcements');
    console.log('='.repeat(60));
    console.log('🔑 Login: admin / admin123');
    console.log('='.repeat(60));
});